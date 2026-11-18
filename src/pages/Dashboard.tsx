import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AlertTriangle, BellRing, CheckCircle2, Clock, ExternalLink, Megaphone, RefreshCw, Shuffle } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Button, Card, ErrorBox, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { callPath, useDirection } from '../lib/school'
import { dayLabel, formatDue, timeOf } from '../lib/schoolFormat'
import { summarize, type CallState, type DashTab } from '../domain/direction'
import { primaryLink } from '../lib/distribution'

interface Row {
  classId: string
  className: string
  levels: string[]
  teachers: string[]
  slot: { id: string; name: string; halfDay: 'am' | 'pm'; dueTime: string | null }
  tab: DashTab
  state: CallState
  expected: number
  counts: { present: number; absent: number; other: number } | null
  validatedAt: string | null
  updatedAt: string | null
  validatedBy: string | null
  corrected: boolean
  absentees: { name: string; label: string }[]
  plannedAbsences: number
  remindedAt: string | null
  /** Lot 5 : élèves répartis ailleurs, avec la couverture remontée des classes d'accueil. */
  distribution: null | {
    planId: string
    total: number
    confirmed: number
    present: number
    absent: number
    complete: boolean
    hosts: { className: string; total: number; confirmed: number }[]
  }
  hosted: null | { count: number; from: string[] }
}
interface DashboardData {
  date: string
  today: string
  nowTime: string
  closure: string | null
  activeDistributions: number
  rows: Row[]
}

/** Sondage léger : toutes les 30 s quand l'onglet est visible, et dès qu'on y revient. */
const REFRESH_MS = 30_000

const TABS: { id: DashTab; label: string }[] = [
  { id: 'am', label: 'Matin' },
  { id: 'pm', label: 'Après-midi' },
  { id: 'other', label: 'Autres créneaux' },
]

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

/** Tableau de bord « Aujourd'hui » de la direction (§8.1). */
export default function Dashboard() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [tab, setTab] = useState<DashTab | null>(null)
  const [reminding, setReminding] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const d = await api<DashboardData>(`/api/schools/${schoolId}/dashboard`)
      setData(d)
      setError('')
      setStale(false)
      setUpdatedAt(new Date())
      // Onglet par défaut : l'après-midi à partir de midi s'il y a des appels, sinon le premier non vide.
      setTab((t) => {
        if (t) return t
        const has = (x: DashTab) => d.rows.some((r) => r.tab === x)
        if (d.nowTime >= '12:00' && has('pm')) return 'pm'
        return (['am', 'pm', 'other'] as DashTab[]).find(has) ?? 'am'
      })
    } catch (e) {
      // On garde les dernières données affichées, avec une mention claire.
      if (e instanceof ApiError && e.code === 'NETWORK') setStale(true)
      else setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    if (!membership) return
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [load, membership])

  if (!membership) return <Navigate to="/" replace />

  async function remind(r: Row) {
    if (!data) return
    const key = `${r.classId}:${r.slot.id}`
    setReminding(key)
    setNotice('')
    try {
      const res = await api<{ remindedAt: string; repeat?: boolean }>(
        `/api/schools/${schoolId}/classes/${r.classId}/calls/${data.date}/${r.slot.id}/remind`,
        {},
      )
      setNotice(
        res.repeat
          ? `${r.className} : relance déjà envoyée à ${timeOf(res.remindedAt)}.`
          : `${r.className} : relance envoyée. L’enseignant la voit dans son application.`,
      )
      await load()
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Erreur inattendue.')
      await load()
    } finally {
      setReminding(null)
    }
  }

  const counts = Object.fromEntries(TABS.map((t) => [t.id, data?.rows.filter((r) => r.tab === t.id).length ?? 0])) as Record<DashTab, number>
  const rows = data?.rows.filter((r) => r.tab === tab) ?? []
  const k = summarize(rows)
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = r.levels[0] ?? 'Sans niveau'
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const tabs = TABS.filter((t) => t.id !== 'other' || counts.other > 0)

  return (
    <Shell title={membership.schoolName} subtitle={data ? `Aujourd’hui · ${dayLabel(data.date)}` : undefined}>
      <SchoolNav schoolId={schoolId} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          {stale ? (
            <span className="font-semibold text-danger-ink">Connexion perdue : affichage du {updatedAt ? timeOf(updatedAt.toISOString()) : '—'}, nouvel essai automatique.</span>
          ) : updatedAt ? (
            <>Mis à jour automatiquement · {updatedAt.toLocaleTimeString('fr-FR')}</>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/ecole/${schoolId}/repartitions/nouvelle`} className={primaryLink}>
            <Shuffle className="size-4" aria-hidden /> Répartir une classe
          </Link>
          <Button variant="secondary" onClick={() => void load()} loading={loading} aria-label="Actualiser maintenant">
            {!loading && <RefreshCw className="size-4" aria-hidden />} Actualiser
          </Button>
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {notice && (
        <p role="status" className="mb-3 rounded-xl bg-surface px-4 py-2.5 text-sm font-medium text-primary-strong">
          {notice}
        </p>
      )}

      {!data ? (
        !error && <Spinner />
      ) : data.closure ? (
        <Card className="text-center">
          <p className="font-semibold">Pas d’appel aujourd’hui</p>
          <p className="mt-1 text-sm text-muted">{data.closure}</p>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card className="text-center">
          <p className="font-semibold">Aucun appel prévu aujourd’hui</p>
          <p className="mt-1 text-sm text-muted">
            Créez des classes et leurs appels depuis l’onglet{' '}
            <Link className="font-semibold text-primary underline" to={`/ecole/${schoolId}/classes`}>
              Classes
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div role="tablist" aria-label="Créneaux" className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-line">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="dash-panel"
                onClick={() => setTab(t.id)}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold whitespace-nowrap ${
                  tab === t.id ? 'bg-primary text-white' : 'text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                {t.label} <span className="font-normal">({counts[t.id]})</span>
              </button>
            ))}
          </div>

          <div id="dash-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="grid grid-cols-[minmax(0,1fr)] gap-4">
            {k.late > 0 && (
              <div role="alert" className="flex items-center gap-2 rounded-xl bg-danger/12 px-4 py-3 text-sm font-semibold text-danger-ink">
                <AlertTriangle className="size-5 shrink-0" aria-hidden />
                {plural(k.late, 'appel non fait', 'appels non faits')} après l’heure limite.
              </div>
            )}

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <Kpi label="Classes attendues" value={k.expected} />
              <Kpi label="Appels validés" value={k.validated} tone="success" />
              <Kpi label="En attente" value={k.pending} />
              <Kpi label="En retard" value={k.late} tone={k.late ? 'danger' : undefined} />
              <Kpi label="Présents" value={k.present} />
              <Kpi label="Absents" value={k.absent} />
              <Kpi label="Répartitions actives" value={data.activeDistributions} to={`/ecole/${schoolId}/repartitions`} />
            </dl>

            {rows.length === 0 && <Card className="text-sm text-muted">Aucun appel sur ce créneau aujourd’hui.</Card>}
            {[...groups.entries()].map(([level, list]) => (
              <section key={level} aria-labelledby={`lvl-${level}`}>
                <h2 id={`lvl-${level}`} className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                  {level}
                </h2>
                <ul className="grid gap-2 lg:grid-cols-2">
                  {list.map((r) => (
                    <ClassRow
                      key={`${r.classId}:${r.slot.id}`}
                      r={r}
                      schoolId={schoolId}
                      date={data.date}
                      canRemind={data.date === data.today}
                      reminding={reminding === `${r.classId}:${r.slot.id}`}
                      onRemind={() => void remind(r)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </Shell>
  )
}

function Kpi({ label, value, tone, to }: { label: string; value: number; tone?: 'success' | 'danger'; to?: string }) {
  return (
    <div className={`relative rounded-xl px-3 py-2.5 ring-1 ${tone === 'danger' ? 'bg-danger/10 ring-danger/40' : 'bg-white ring-line'} ${to ? 'hover:bg-surface' : ''}`}>
      <dt className="text-xs font-medium text-muted">
        {to ? (
          <Link to={to} className="after:absolute after:inset-0 after:content-['']">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className={`text-2xl font-bold tabular-nums ${tone === 'success' ? 'text-success-ink' : tone === 'danger' ? 'text-danger-ink' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function StateBadge({ r }: { r: Row }) {
  if (r.state === 'distributed' && r.distribution)
    return (
      <Badge tone={r.distribution.complete ? 'success' : 'info'}>
        <Shuffle className="mr-1 size-3.5" aria-hidden />
        Répartie · {r.distribution.confirmed}/{r.distribution.total} confirmés
      </Badge>
    )
  if (r.state === 'validated')
    return (
      <Badge tone="success">
        <CheckCircle2 className="mr-1 size-3.5" aria-hidden />
        {r.corrected ? 'Corrigé' : 'Validé'} à {timeOf(r.validatedAt!)}
      </Badge>
    )
  if (r.state === 'late')
    return (
      <Badge tone="danger">
        <AlertTriangle className="mr-1 size-3.5" aria-hidden />
        En retard{r.slot.dueTime ? ` (limite ${formatDue(r.slot.dueTime)})` : ''}
      </Badge>
    )
  return (
    <Badge tone="neutral">
      <Clock className="mr-1 size-3.5" aria-hidden />
      En attente{r.slot.dueTime ? ` · avant ${formatDue(r.slot.dueTime)}` : ''}
    </Badge>
  )
}

function ClassRow({
  r,
  schoolId,
  date,
  canRemind,
  reminding,
  onRemind,
}: {
  r: Row
  schoolId: string
  date: string
  canRemind: boolean
  reminding: boolean
  onRemind: () => void
}) {
  const action = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-line bg-white hover:bg-surface'
  return (
    <li>
      <Card className={`h-full ${r.state === 'late' ? 'ring-2 ring-danger/50' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">
              {r.className} <span className="font-normal text-muted">· {r.slot.name}</span>
            </p>
            <p className="truncate text-sm text-muted">{r.teachers.length ? r.teachers.join(', ') : 'Aucun enseignant affecté'}</p>
          </div>
          <StateBadge r={r} />
        </div>
        <p className="mt-2 text-sm">
          {r.state === 'distributed' ? (
            <span className="text-muted">
              Élèves dans les classes d’accueil
              {r.distribution && r.distribution.confirmed > 0 && ` · ${plural(r.distribution.present, 'présent')}, ${plural(r.distribution.absent, 'absent')}`}
            </span>
          ) : r.counts ? (
            <>
              <strong className="text-success-ink">{plural(r.counts.present, 'présent')}</strong> ·{' '}
              <strong className={r.counts.absent ? 'text-danger-ink' : ''}>{plural(r.counts.absent, 'absent')}</strong>
              {r.counts.other > 0 && <> · {plural(r.counts.other, 'autre')}</>} <span className="text-muted">/ {r.expected}</span>
              {r.validatedBy && <span className="text-muted"> · par {r.validatedBy}</span>}
            </>
          ) : (
            <span className="text-muted">{plural(r.expected, 'élève attendu', 'élèves attendus')}</span>
          )}
          {r.plannedAbsences > 0 && <span className="text-muted"> · {plural(r.plannedAbsences, 'absence prévue', 'absences prévues')}</span>}
        </p>
        {r.hosted && (
          <p className="mt-1 text-sm font-medium text-primary-strong">
            dont {plural(r.hosted.count, 'élève accueilli', 'élèves accueillis')} ({r.hosted.from.join(', ')})
          </p>
        )}
        {r.distribution && (
          <p className="mt-1 text-sm break-words">
            <span className="font-medium">{r.state === 'distributed' ? 'Appels des élèves répartis' : `${plural(r.distribution.total, 'élève réparti', 'élèves répartis')} ailleurs`} : </span>
            <span className="text-muted">
              {r.distribution.hosts.map((h) => `${h.className} ${h.confirmed}/${h.total}`).join(' · ')}
              {r.distribution.total > r.distribution.hosts.reduce((a, h) => a + h.total, 0) &&
                ` · ${plural(r.distribution.total - r.distribution.hosts.reduce((a, h) => a + h.total, 0), 'absent connu', 'absents connus')}`}
            </span>
          </p>
        )}
        {r.absentees.length > 0 && (
          <p className="mt-1 text-sm break-words text-muted">
            {r.absentees
              .slice(0, 6)
              .map((a) => (a.label === 'Absent' ? a.name : `${a.name} (${a.label.toLowerCase()})`))
              .join(', ')}
            {r.absentees.length > 6 && ` et ${r.absentees.length - 6} autres`}
          </p>
        )}
        {r.remindedAt && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-danger-ink">
            <BellRing className="size-4" aria-hidden /> Relancé à {timeOf(r.remindedAt)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to={callPath(schoolId, r.classId, date, r.slot.id)} className={action} aria-label={`Ouvrir l’appel de ${r.className}, ${r.slot.name}`}>
            <ExternalLink className="size-4" aria-hidden /> Ouvrir l’appel
          </Link>
          <Link to={`/ecole/${schoolId}/messages?classe=${r.classId}`} className={action} aria-label={`Envoyer un message à ${r.className}`}>
            <Megaphone className="size-4" aria-hidden /> Message
          </Link>
          {r.distribution && (
            <Link to={`/ecole/${schoolId}/repartitions/${r.distribution.planId}`} className={action} aria-label={`Voir la répartition de ${r.className}`}>
              <Shuffle className="size-4" aria-hidden /> Voir la répartition
            </Link>
          )}
          {r.state !== 'validated' && r.state !== 'distributed' && canRemind && (
            <Button variant={r.state === 'late' ? 'danger' : 'secondary'} loading={reminding} onClick={onRemind} aria-label={`Relancer l’enseignant de ${r.className}`}>
              {!reminding && <BellRing className="size-4" aria-hidden />} Relancer
            </Button>
          )}
        </div>
      </Card>
    </li>
  )
}
