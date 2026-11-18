import { audit, type Env } from '../lib/auth'
import { badRequest, json } from '../lib/http'
import { toCsv, toXlsx, type Cell, type Sheet } from '../lib/spreadsheet'
import { buildHistory, direction, type HistoryRow } from './direction'

/**
 * Exports de l'historique (§9, lot 6) : CSV, XLSX et données de la page imprimable (PDF via l'impression
 * du navigateur). Réservés à la direction de l'école, toujours derrière la session : jamais de lien public.
 * Chaque export est inscrit au journal d'audit (format, période, filtres, nombre de lignes).
 */

const FORMATS = ['csv', 'xlsx', 'print'] as const
type Format = (typeof FORMATS)[number]
/** Garde-fou de taille pour le détail par élève (≈ 2 mois d'appels d'une grande école). */
export const EXPORT_MAX_ENTRIES = 25_000

export const STATE_LABELS: Record<HistoryRow['state'], string> = {
  validated: 'Validé',
  corrected: 'Corrigé',
  missing: 'Non fait',
  distributed: 'Répartie',
}
const STATE_HELP: Record<HistoryRow['state'], string> = {
  validated: 'Appel validé, sans correction.',
  corrected: 'Appel validé puis corrigé (le numéro de version augmente à chaque correction).',
  missing: 'Aucun appel validé pour ce créneau alors que des élèves étaient attendus.',
  distributed: 'Classe répartie : ses élèves ont été appelés dans leurs classes d’accueil.',
}
const CATEGORY_LABELS: Record<string, string> = { PRESENT: 'Présent', ABSENT: 'Absent', AUTRE: 'Autre' }
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

interface EntryRow {
  call_id: string
  first_name: string
  last_name: string | null
  label: string
  category: string
  hosted_from: string | null
}

export async function exportHistory(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const p = new URL(req.url).searchParams
  const format = p.get('format') as Format
  if (!FORMATS.includes(format)) throw badRequest('INVALID_FORMAT', 'Format d’export inconnu.')
  const detail = p.get('detail') === '1'
  const h = await buildHistory(env, schoolId, p)

  const [statusesR, entriesR] = await env.DB.batch([
    env.DB.prepare('SELECT label, category, archived_at FROM attendance_statuses WHERE school_id = ? ORDER BY archived_at IS NOT NULL, position').bind(
      schoolId,
    ),
    // Détail nominatif seulement s'il est demandé (données minimisées par défaut).
    detail
      ? env.DB.prepare(
          `SELECT e.call_id, s.first_name, s.last_name, st.label, st.category, hc.name AS hosted_from
             FROM attendance_entries e
             JOIN attendance_calls c ON c.id = e.call_id
             JOIN students s ON s.id = e.student_id
             JOIN attendance_statuses st ON st.id = e.status_id
             LEFT JOIN classes hc ON hc.id = e.hosted_from_class_id
            WHERE c.school_id = ? AND c.slot_date BETWEEN ? AND ?
            ORDER BY e.hosted_from_class_id IS NOT NULL, hc.name, s.first_name COLLATE NOCASE, s.last_name COLLATE NOCASE`,
        ).bind(schoolId, h.from, h.to)
      : env.DB.prepare('SELECT 1 WHERE 0'),
  ])
  const statuses = statusesR.results as { label: string; category: string; archived_at: string | null }[]
  const callIds = new Set(h.rows.map((r) => r.callId).filter(Boolean))
  const entries = (entriesR.results as EntryRow[]).filter((e) => callIds.has(e.call_id))
  if (entries.length > EXPORT_MAX_ENTRIES)
    throw badRequest('EXPORT_TOO_LARGE', 'Export trop volumineux : réduisez la période ou choisissez une classe.')

  const filters = describeFilters(p, h)
  await audit(env, {
    actor: u.id,
    schoolId,
    action: 'history.exported',
    objectType: 'history',
    details: { format, detail, from: h.from, to: h.to, filters, rows: h.rows.length, entries: entries.length },
  }).then((s) => s.run())

  const dateTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('fr-FR', { timeZone: h.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)).replace(',', '')
      : ''
  const legend = statuses.map((s) => ({ label: s.label, category: CATEGORY_LABELS[s.category] ?? s.category, archived: !!s.archived_at }))
  const exportedAt = new Date().toISOString()

  if (format === 'print') {
    const byCall = new Map<string, { name: string; status: string; category: string; hostedFrom: string | null }[]>()
    for (const e of entries)
      byCall.set(e.call_id, [
        ...(byCall.get(e.call_id) ?? []),
        { name: `${e.first_name} ${e.last_name ?? ''}`.trim(), status: e.label, category: e.category, hostedFrom: e.hosted_from },
      ])
    return json({
      schoolName: h.schoolName,
      from: h.from,
      to: h.to,
      exportedAt: dateTime(exportedAt),
      exportedBy: u.displayName,
      filters,
      detail,
      legend,
      states: Object.entries(STATE_LABELS).map(([k, label]) => ({ key: k, label, help: STATE_HELP[k as HistoryRow['state']] })),
      rows: h.rows.map((r) => ({
        date: r.date,
        className: r.className,
        slotName: r.slot.name,
        state: r.state,
        version: r.version,
        expected: r.expected,
        counts: r.counts,
        validatedAt: dateTime(r.validatedAt),
        updatedAt: r.state === 'corrected' ? dateTime(r.updatedAt) : '',
        by: r.by,
        hosted: r.hosted,
        distribution: r.distribution ? { total: r.distribution.total, confirmed: r.distribution.confirmed } : null,
        entries: r.callId ? (byCall.get(r.callId) ?? []) : [],
      })),
    })
  }

  const summaryHeader: Cell[] = [
    'Date',
    'Jour',
    'Classe',
    'Créneau',
    'Statut',
    'Version',
    'Élèves attendus',
    'Présents',
    'Absents',
    'Autres',
    'Validé le',
    'Corrigé le',
    'Dernière saisie par',
    'Élèves accueillis',
    'Répartition',
  ]
  const callCells = (r: HistoryRow): Cell[] => [
    r.date,
    WEEKDAYS[new Date(`${r.date}T12:00:00Z`).getUTCDay()],
    r.className,
    r.slot.name,
    STATE_LABELS[r.state],
    r.version,
  ]
  const summary: Cell[][] = [
    summaryHeader,
    ...h.rows.map((r) => [
      ...callCells(r),
      r.expected,
      r.counts?.present ?? null,
      r.counts?.absent ?? null,
      r.counts?.other ?? null,
      dateTime(r.validatedAt),
      r.state === 'corrected' ? dateTime(r.updatedAt) : '',
      r.by,
      r.hosted ? `${r.hosted.count} (${r.hosted.from.join(', ')})` : '',
      r.distribution ? `${r.distribution.confirmed}/${r.distribution.total} élèves répartis confirmés` : '',
    ]),
  ]
  const byCallId = new Map(h.rows.filter((r) => r.callId).map((r) => [r.callId!, r]))
  const detailRows: Cell[][] = [
    ['Date', 'Jour', 'Classe', 'Créneau', 'Statut de l’appel', 'Version', 'Prénom', 'Nom', 'État', 'Catégorie', 'Accueilli de'],
    ...entries.map((e) => {
      const r = byCallId.get(e.call_id)!
      return [...callCells(r), e.first_name, e.last_name ?? '', e.label, CATEGORY_LABELS[e.category] ?? e.category, e.hosted_from ?? '']
    }),
  ]
  const legendRows: Cell[][] = [
    ['Légende', 'Signification'],
    ['École', h.schoolName],
    ['Période', `du ${h.from} au ${h.to}`],
    ['Filtres', filters.length ? filters.join(' · ') : 'aucun'],
    ['Exporté le', `${dateTime(exportedAt)} par ${u.displayName}`],
    ['', ''],
    ['Statut de l’appel', ''],
    ...Object.entries(STATE_LABELS).map(([k, l]): Cell[] => [l, STATE_HELP[k as HistoryRow['state']]]),
    ['', ''],
    ['États d’appel de l’école', 'Catégorie'],
    ...legend.map((s): Cell[] => [s.label, s.category + (s.archived ? ' (état archivé)' : '')]),
  ]

  const base = `appely-historique-${h.from}_${h.to}${detail ? '-detail' : ''}`
  const headers = (type: string, ext: string) => ({
    'content-type': type,
    'content-disposition': `attachment; filename="${base}.${ext}"`,
    'cache-control': 'no-store',
  })
  if (format === 'csv') return new Response(toCsv(detail ? detailRows : summary), { headers: headers('text/csv; charset=utf-8', 'csv') })
  const sheets: Sheet[] = [
    { name: 'Appels', rows: summary, widths: [11, 10, 12, 16, 10, 8, 9, 9, 9, 8, 16, 16, 22, 18, 26] },
    ...(detail ? [{ name: 'Détail par élève', rows: detailRows, widths: [11, 10, 12, 16, 14, 8, 16, 16, 18, 10, 14] }] : []),
    { name: 'Légende', rows: legendRows, widths: [28, 70] },
  ]
  return new Response(await toXlsx(sheets), {
    headers: headers('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'),
  })
}

function describeFilters(p: URLSearchParams, h: Awaited<ReturnType<typeof buildHistory>>): string[] {
  const out: string[] = []
  const cls = p.get('classId')
  if (cls) out.push(`Classe : ${h.classes.find((c) => c.id === cls)?.name ?? 'classe archivée'}`)
  const user = p.get('userId')
  if (user) out.push(`Fait par : ${h.people.find((x) => x.id === user)?.display_name ?? 'personne inconnue'}`)
  const state = p.get('state') as HistoryRow['state'] | null
  if (state) out.push(`État : ${STATE_LABELS[state]}`)
  if (p.get('distribution') === '1') out.push('Seulement les répartitions')
  return out
}
