/**
 * Règles pures du lot 4 (tableau de bord Direction, messages ciblés, absences prévues),
 * partagées entre le navigateur et le Worker (cahier des charges §8).
 */
import type { HalfDay } from './schedule'

// ---------- État d'un appel sur le tableau de bord ----------

/** 'distributed' : classe entièrement répartie, les classes d'accueil font l'appel (lot 5). */
export type CallState = 'validated' | 'pending' | 'late' | 'distributed'

/**
 * Validé ; en attente ; ou en retard : jour passé non fait, ou heure limite dépassée aujourd'hui.
 * Les heures sont au format « HH:MM » dans le fuseau de l'école.
 */
export function callState(o: { validated: boolean; date: string; today: string; nowTime: string; dueTime: string | null }): CallState {
  if (o.validated) return 'validated'
  if (o.date < o.today) return 'late'
  if (o.date > o.today) return 'pending'
  return o.dueTime !== null && o.nowTime > o.dueTime ? 'late' : 'pending'
}

export type DashTab = 'am' | 'pm' | 'other'

/**
 * Onglets du tableau de bord : pour chaque classe, le premier créneau du matin va dans « Matin »,
 * le premier de l'après-midi dans « Après-midi », les créneaux supplémentaires dans « Autres créneaux ».
 * Les créneaux doivent être fournis dans l'ordre d'affichage de la classe.
 */
export function assignTabs(slots: { id: string; class_id: string; half_day: HalfDay }[]): Map<string, DashTab> {
  const seen = new Set<string>()
  const out = new Map<string, DashTab>()
  for (const s of slots) {
    const key = `${s.class_id}:${s.half_day}`
    out.set(s.id, seen.has(key) ? 'other' : s.half_day)
    seen.add(key)
  }
  return out
}

export interface DashRowSummary {
  state: CallState
  counts: { present: number; absent: number; other: number } | null
}

/** Indicateurs d'un onglet : appels attendus, validés, en attente, en retard, présents, absents. */
export function summarize(rows: DashRowSummary[]) {
  const k = { expected: rows.length, validated: 0, pending: 0, late: 0, distributed: 0, present: 0, absent: 0, other: 0 }
  for (const r of rows) {
    k[r.state]++
    if (r.counts) {
      k.present += r.counts.present
      k.absent += r.counts.absent
      k.other += r.counts.other
    }
  }
  return k
}

// ---------- Messages ciblés ----------

export type MessageTargetKind = 'school' | 'levels' | 'classes'
export const MESSAGE_MAX = 500
export const MESSAGE_PRIORITIES = ['normal', 'important'] as const
export type MessagePriority = (typeof MESSAGE_PRIORITIES)[number]

export interface MessageTarget {
  target_kind: MessageTargetKind
  targets: string[]
}

/** Un message s'applique-t-il à cette classe ? (école entière, un de ses niveaux, ou classe choisie) */
export function messageApplies(m: MessageTarget, cls: { id: string; levels: string[] }): boolean {
  if (m.target_kind === 'school') return true
  if (m.target_kind === 'levels') return cls.levels.some((l) => m.targets.includes(l))
  return m.targets.includes(cls.id)
}

/** Message visible ce jour-là : non retiré et dans sa période de visibilité (bornes incluses). */
export function messageVisible(m: { start_date: string; end_date: string; archived_at: string | null }, date: string): boolean {
  return !m.archived_at && m.start_date <= date && date <= m.end_date
}

/** Messages importants d'abord, puis les plus récents. */
export function sortMessages<T extends { priority: string; created_at: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => Number(b.priority === 'important') - Number(a.priority === 'important') || b.created_at.localeCompare(a.created_at),
  )
}

// ---------- Absences prévues ----------

export type PlannedHalfDays = 'day' | 'am' | 'pm'

/**
 * Motifs courts proposés : aucun champ libre, pour ne jamais inciter à détailler la santé
 * d'un enfant (§8.3).
 */
export const PLANNED_REASONS = ['Raison familiale', 'Rendez-vous', 'Voyage', 'Activité extérieure', 'Autre motif'] as const
export const PLANNED_MAX_DAYS = 62

export const PLANNED_HALF_LABELS: Record<PlannedHalfDays, string> = {
  day: 'Journée entière',
  am: 'Matin',
  pm: 'Après-midi',
}

/** Une absence prévue couvre-t-elle cette date et cette demi-journée ? */
export function plannedCovers(
  a: { start_date: string; end_date: string; half_days: PlannedHalfDays; cancelled_at?: string | null },
  date: string,
  half: HalfDay,
): boolean {
  if (a.cancelled_at) return false
  if (date < a.start_date || date > a.end_date) return false
  return a.half_days === 'day' || a.half_days === half
}

/** Nombre de jours entre deux dates « AAAA-MM-JJ » (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000)
}

/** Date « AAAA-MM-JJ » décalée de n jours (calcul en UTC, sans effet de fuseau). */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)
}
