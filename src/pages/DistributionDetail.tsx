import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Copy, Pencil, Printer, XCircle } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Button, Card, ErrorBox, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { useDirection } from '../lib/school'
import { timeOf } from '../lib/schoolFormat'
import { periodLabel, type PlanHalfDays } from '../domain/repartition'
import { cap, nextSchoolDay, WHEN_BADGE, type PlanSummary } from '../lib/distribution'

interface Detail {
  today: string
  plan: {
    id: string
    version: number
    state: 'active' | 'cancelled'
    sourceClassId: string
    sourceName: string
    startDate: string
    endDate: string
    halfDays: PlanHalfDays
    when: PlanSummary['when']
    hosts: { classId: string; capacity: number | null; className: string }[]
  }
  groups: { classId: string | null; className: string; students: { id: string; name: string }[] }[]
  coverage: {
    date: string
    half: 'am' | 'pm'
    total: number
    confirmed: number
    present: number
    absent: number
    complete: boolean
    hosts: { classId: string; className: string; total: number; confirmed: number }[]
  }[]
  focus: null | {
    date: string
    half: 'am' | 'pm'
    students: { id: string; name: string; hostName: string | null; status: string | null; category: string | null }[]
  }
  changes: {
    version: number
    action: 'created' | 'updated' | 'cancelled'
    at: string
    by: string
    frozen: number
    moved: { name: string; from: string | null; to: string | null }[]
  }[]
}

const HALF = { am: 'matin', pm: 'après-midi' } as const
const ACTION = { created: 'Création', updated: 'Modification', cancelled: 'Annulation' } as const
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const action = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-line bg-white hover:bg-surface'

/** Détail d'une répartition : couverture remontée des classes d'accueil, feuilles par classe, historique. */
export default function DistributionDetail() {
  const { schoolId = '', planId = '' } = useParams()
  const location = useLocation()
  const membership = useDirection(schoolId)
  const [data, setData] = useState<Detail | null>(null)
  const [closedWeekdays, setClosedWeekdays] = useState(100)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState((location.state as { notice?: string } | null)?.notice ?? '')
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const requestIdRef = useRef<string | null>(null)

  const load = useCallback(
    () =>
      api<Detail>(`/api/schools/${schoolId}/distributions/${planId}`).then(
        (d) => {
          setData(d)
          setError('')
        },
        (e) => setError(e.message),
      ),
    [schoolId, planId],
  )
  useEffect(() => {
    if (!membership) return
    void load()
    api<{ school: { closedWeekdays: number } }>(`/api/schools/${schoolId}/overview`).then(
      (o) => setClosedWeekdays(o.school.closedWeekdays),
      () => undefined,
    )
  }, [load, membership, schoolId])

  if (!membership) return <Navigate to="/" replace />

  async function cancel() {
    if (!data) return
    setCancelling(true)
    requestIdRef.current ??= crypto.randomUUID()
    try {
      const r = await api<{ frozen: number }>(`/api/schools/${schoolId}/distributions/${planId}/cancel`, {
        baseVersion: data.plan.version,
        requestId: requestIdRef.current,
      })
      requestIdRef.current = null
      setConfirming(false)
      setNotice(
        `Répartition annulée : les élèves reviennent dans leur classe. Les classes concernées sont informées.${
          r.frozen ? ' Les demi-journées déjà comptées dans un appel validé sont conservées.' : ''
        }`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    } finally {
      setCancelling(false)
      await load()
    }
  }

  const p = data?.plan
  const editable = p && p.state === 'active' && p.endDate >= data!.today
  const repeatDate = p ? nextSchoolDay(p.endDate < data!.today ? data!.today : p.endDate, closedWeekdays) : ''

  return (
    <Shell title={p ? `${p.sourceName} répartie` : 'Répartition'} subtitle={p ? cap(periodLabel(p.startDate, p.endDate, p.halfDays)) : undefined}>
      <div className="print:hidden">
        <SchoolNav schoolId={schoolId} />
        <Link to={`/ecole/${schoolId}/repartitions`} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Toutes les répartitions
        </Link>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {!data || !p ? (
        !error && <Spinner />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {notice && (
            <div className="print:hidden">
              <SuccessBox>{notice}</SuccessBox>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Badge tone={WHEN_BADGE[p.when].tone}>{WHEN_BADGE[p.when].label}</Badge>
            <span className="text-sm text-muted">vers {p.hosts.map((h) => h.className).join(', ')}</span>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {editable && (
              <Link to={`/ecole/${schoolId}/repartitions/${planId}/modifier`} className={action}>
                <Pencil className="size-4" aria-hidden /> Modifier
              </Link>
            )}
            <Link to={`/ecole/${schoolId}/repartitions/nouvelle?classe=${p.sourceClassId}&date=${repeatDate}&creneau=${p.halfDays}&reprendre=1`} className={action}>
              <Copy className="size-4" aria-hidden /> Refaire le {shortDay(repeatDate)}
            </Link>
            <button type="button" className={action} onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Imprimer les feuilles
            </button>
            {editable && !confirming && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                <XCircle className="size-4" aria-hidden /> Annuler la répartition
              </Button>
            )}
          </div>
          {confirming && (
            <Card className="ring-2 ring-danger/40 print:hidden">
              <p className="font-semibold">Annuler cette répartition ?</p>
              <p className="mt-1 text-sm text-muted">
                Les élèves reviennent dans l’appel de {p.sourceName}. Les demi-journées déjà comptées dans un appel validé restent enregistrées. Les
                classes concernées sont informées.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" loading={cancelling} onClick={cancel}>
                  Oui, annuler la répartition
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Non, la garder
                </Button>
              </div>
            </Card>
          )}

          {data.coverage.length > 0 && (
            <section aria-labelledby="cov" className="print:hidden">
              <h2 id="cov" className="mb-2 text-lg font-semibold">
                Présences remontées
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.coverage.map((c) => (
                  <li key={`${c.date}:${c.half}`}>
                    <Card className={`h-full ${c.complete ? 'ring-1 ring-success/40' : ''}`}>
                      <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                        <span>
                          {cap(shortDay(c.date))} · {HALF[c.half]}
                        </span>
                        <Badge tone={c.complete ? 'success' : c.confirmed ? 'warning' : 'neutral'}>
                          {c.complete && <CheckCircle2 className="mr-1 size-3.5" aria-hidden />}
                          {c.confirmed}/{c.total} confirmés
                        </Badge>
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {c.hosts.map((h) => `${h.className} ${h.confirmed}/${h.total}`).join(' · ')}
                        {c.confirmed > 0 && ` · ${c.present} présent${c.present > 1 ? 's' : ''}, ${c.absent} absent${c.absent > 1 ? 's' : ''}`}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.focus && (
            <section aria-labelledby="reg" className="print:hidden">
              <h2 id="reg" className="mb-2 text-lg font-semibold">
                Où sont les élèves · {shortDay(data.focus.date)} {HALF[data.focus.half]}
              </h2>
              <Card flush>
                <ul className="divide-y divide-line text-sm">
                  {data.focus.students.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted">
                        {s.hostName ? `en ${s.hostName} · ` : ''}
                        {s.hostName === null ? (
                          'Absent connu'
                        ) : s.status ? (
                          <strong className={s.category === 'PRESENT' ? 'text-success-ink' : 'text-danger-ink'}>{s.status}</strong>
                        ) : (
                          'appel pas encore fait'
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <section aria-labelledby="sheets">
            <h2 id="sheets" className="mb-2 text-lg font-semibold print:hidden">
              Feuilles de répartition
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 print:block">
              {data.groups.map((g) => (
                <Card key={g.classId ?? 'absents'} className="break-inside-avoid print:mb-6 print:break-after-page print:shadow-none">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Feuille de répartition · {cap(periodLabel(p.startDate, p.endDate, p.halfDays))}</p>
                  <p className="mt-1 text-lg font-semibold">{g.className}</p>
                  {g.classId && (
                    <p className="text-sm text-muted">
                      Élèves accueillis de {p.sourceName} : {g.students.length}
                    </p>
                  )}
                  <ol className="mt-2 list-decimal pl-5 text-sm">
                    {g.students.map((s) => (
                      <li key={s.id} className="py-0.5">
                        {s.name}
                      </li>
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="hist" className="print:hidden">
            <h2 id="hist" className="mb-2 text-lg font-semibold">
              Historique
            </h2>
            <Card flush>
              <ol className="divide-y divide-line text-sm">
                {data.changes.map((c) => (
                  <li key={c.version} className="px-4 py-3">
                    <p className="font-medium">
                      {ACTION[c.action]} · {formatDate(c.at)} à {timeOf(c.at)} · {c.by}
                    </p>
                    {c.moved.map((m) => (
                      <p key={m.name} className="text-muted">
                        {m.name} : {m.from ?? '—'} → {m.to ?? '—'}
                      </p>
                    ))}
                    {c.frozen > 0 && (
                      <p className="text-muted">
                        {c.frozen} affectation{c.frozen > 1 ? 's' : ''} déjà comptée{c.frozen > 1 ? 's' : ''} dans un appel validé conservée{c.frozen > 1 ? 's' : ''}.
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          </section>
        </div>
      )}
    </Shell>
  )
}
