import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, History, Scale, Undo2 } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Button, Card, ErrorBox, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { parisToday, useDirection } from '../lib/school'
import { DistributionError, PLAN_HALF_LABELS, PLAN_MAX_DAYS, periodLabel, rebalance, type PlanHalfDays } from '../domain/repartition'
import { addDays } from '../domain/direction'

interface HostSpec {
  classId: string
  capacity: number | null
}
interface PlanData {
  id: string
  version: number
  state: 'active' | 'cancelled'
  sourceClassId: string
  startDate: string
  endDate: string
  halfDays: PlanHalfDays
  hosts: HostSpec[]
  choice: Record<string, string | null>
}
interface Prep {
  today: string
  closedWeekdays: number
  period: { startDate: string; endDate: string; halfDays: PlanHalfDays }
  slotCount: number
  classes: { id: string; name: string; levels: string[]; expected: number; distributed: boolean; hosting: boolean }[]
  students: { id: string; firstName: string; lastName: string | null; partial: boolean; busy: boolean }[]
  last: null | { id: string; startDate: string; endDate: string; halfDays: PlanHalfDays; hosts: HostSpec[]; choice: Record<string, string | null> }
  plan: PlanData | null
}
interface Form {
  sourceId: string
  start: string
  end: string
  half: PlanHalfDays
}

const inputCls = 'min-h-11 w-full min-w-0 rounded-xl bg-white px-3 text-base ring-1 ring-line focus:ring-2 focus:ring-primary focus:outline-none disabled:bg-canvas'
const ABSENT = 'absent'
const studentName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim()

/**
 * « Répartir une classe » (§7.1) : classe d'origine, période, classes d'accueil et capacités, proposition
 * équilibrée par l'algorithme, correction élève par élève, aperçu par classe, puis validation.
 * Sert aussi à modifier une répartition existante.
 */
export default function DistributionEditor() {
  const { schoolId = '', planId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const membership = useDirection(schoolId)
  const isEdit = !!planId
  const [form, setForm] = useState<Form | null>(() =>
    isEdit ? null : { sourceId: params.get('classe') ?? '', start: params.get('date') ?? parisToday(), end: params.get('date') ?? parisToday(), half: (params.get('creneau') as PlanHalfDays) || 'day' },
  )
  const [prep, setPrep] = useState<Prep | null>(null)
  const [hosts, setHosts] = useState<Record<string, string>>({})
  const [choice, setChoice] = useState<Record<string, string | null>>({})
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  const autoReuse = useRef(params.get('reprendre') === '1')
  const editLoaded = useRef(false)

  const query = useCallback(
    (f: Form | null) => {
      const q = new URLSearchParams()
      if (planId) q.set('planId', planId)
      if (f) {
        if (f.sourceId) q.set('classId', f.sourceId)
        q.set('from', f.start)
        q.set('to', f.end)
        q.set('halfDays', f.half)
      }
      return api<Prep>(`/api/schools/${schoolId}/distributions/prepare?${q}`)
    },
    [schoolId, planId],
  )

  function applyPlan(p: { hosts: HostSpec[]; choice: Record<string, string | null> }, students: Prep['students']) {
    const ids = new Set(students.map((s) => s.id))
    setHosts(Object.fromEntries(p.hosts.map((h) => [h.classId, h.capacity ? String(h.capacity) : ''])))
    const c = Object.fromEntries(Object.entries(p.choice).filter(([id, h]) => ids.has(id) && (h === null || p.hosts.some((x) => x.classId === h))))
    setChoice(c)
    setPinned(new Set(Object.keys(c)))
  }

  // Modification : on charge le plan, puis on remplit le formulaire avec ses valeurs.
  useEffect(() => {
    if (!isEdit || editLoaded.current || !membership) return
    editLoaded.current = true
    query(null).then(
      (d) => {
        if (!d.plan) return
        setForm({ sourceId: d.plan.sourceClassId, start: d.plan.startDate, end: d.plan.endDate, half: d.plan.halfDays })
        setPrep(d)
        applyPlan(d.plan, d.students)
      },
      (e) => setError(e.message),
    )
  }, [isEdit, query, membership])

  // Rechargement des effectifs et des élèves à chaque changement de classe ou de période.
  useEffect(() => {
    if (!form || !membership) return
    if (isEdit && !prep) return
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      query(form).then(
        (d) => {
          if (!alive) return
          setPrep(d)
          setError('')
          setLoading(false)
          const ids = new Set(d.students.map((s) => s.id))
          setChoice((c) => Object.fromEntries(Object.entries(c).filter(([id]) => ids.has(id))))
          if (autoReuse.current && d.last) {
            autoReuse.current = false
            applyPlan(d.last, d.students)
            setNotice('Dernière répartition de cette classe reprise : vérifiez-la puis validez.')
          }
        },
        (e) => {
          if (!alive) return
          setError(e.message)
          setLoading(false)
        },
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prep sert seulement à attendre le chargement initial
  }, [form, query, membership, isEdit])

  useEffect(() => {
    requestIdRef.current = null // contenu modifié : nouvelle tentative
  }, [form, hosts, choice])

  const hostList = useMemo(() => (prep?.classes ?? []).filter((c) => c.id in hosts && c.id !== form?.sourceId), [prep, hosts, form])
  const students = useMemo(() => prep?.students ?? [], [prep])
  const capacityOf = (id: string) => {
    const v = Number(hosts[id])
    return hosts[id] && Number.isInteger(v) && v > 0 ? v : undefined
  }
  const counts = new Map<string, number>()
  for (const s of students) {
    const h = choice[s.id]
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  const unassigned = students.filter((s) => !(s.id in choice))
  const absents = students.filter((s) => choice[s.id] === null)
  const over = hostList.filter((h) => capacityOf(h.id) !== undefined && h.expected + (counts.get(h.id) ?? 0) > capacityOf(h.id)!)
  const busy = students.filter((s) => s.busy)

  if (!membership) return <Navigate to="/" replace />

  const setF = (patch: Partial<Form>) => {
    if (!form) return
    const next = { ...form, ...patch }
    if (next.end < next.start) next.end = next.start
    if (patch.sourceId !== undefined && patch.sourceId !== form.sourceId) {
      setChoice({})
      setPinned(new Set())
      setHosts((h) => Object.fromEntries(Object.entries(h).filter(([id]) => id !== patch.sourceId)))
    }
    setForm(next)
    setNotice('')
  }

  function toggleHost(id: string, on: boolean) {
    setHosts((h) => {
      const n = { ...h }
      if (on) n[id] = ''
      else delete n[id]
      return n
    })
    if (!on) {
      // Les élèves placés dans une classe décochée sont à replacer.
      setChoice((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== id)))
      setPinned((p) => new Set([...p].filter((sid) => choice[sid] !== id)))
    }
  }

  function setStudent(id: string, value: string) {
    setNotice('')
    const c = { ...choice }
    const p = new Set(pinned)
    if (value === '') {
      delete c[id]
      p.delete(id)
    } else {
      c[id] = value === ABSENT ? null : value
      p.add(id)
    }
    setChoice(c)
    setPinned(p)
  }

  function propose() {
    setError('')
    if (!hostList.length) return setError('Cochez au moins une classe d’accueil.')
    const keep = Object.fromEntries([...pinned].filter((id) => id in choice).map((id) => [id, choice[id]]))
    try {
      const r = rebalance(
        students.map((s) => ({ id: s.id })),
        hostList.map((h) => ({ id: h.id, name: h.name, expected: h.expected, capacity: capacityOf(h.id) })),
        keep,
      )
      const next: Record<string, string | null> = { ...keep, ...r.assignments }
      setChoice(next)
      setNotice(
        `Proposition faite : ${hostList.map((h) => `${h.name} ${r.projected[h.id]}`).join(' · ')} élèves au total.${
          Object.keys(keep).length ? ' Vos choix manuels sont conservés.' : ''
        }`,
      )
    } catch (e) {
      if (e instanceof DistributionError)
        setError('Places insuffisantes dans les classes d’accueil : augmentez une capacité ou cochez une autre classe.')
      else throw e
    }
  }

  async function submit() {
    if (!form || !prep || sending) return
    setSending(true)
    setError('')
    requestIdRef.current ??= crypto.randomUUID()
    const body = {
      sourceClassId: form.sourceId,
      startDate: form.start,
      endDate: form.end,
      halfDays: form.half,
      hosts: hostList.map((h) => ({ classId: h.id, capacity: capacityOf(h.id) ?? null })),
      choice,
      requestId: requestIdRef.current,
      baseVersion: prep.plan?.version,
    }
    try {
      const r = await api<{ id?: string; frozen?: number; moved?: number }>(
        isEdit ? `/api/schools/${schoolId}/distributions/${planId}` : `/api/schools/${schoolId}/distributions`,
        body,
      )
      const frozen = r.frozen ? ` ${r.frozen} affectation${r.frozen > 1 ? 's' : ''} déjà comptée${r.frozen > 1 ? 's' : ''} dans un appel validé n’${r.frozen > 1 ? 'ont' : 'a'} pas été changée${r.frozen > 1 ? 's' : ''}.` : ''
      navigate(`/ecole/${schoolId}/repartitions/${isEdit ? planId : r.id}`, {
        state: { notice: (isEdit ? 'Répartition modifiée. Les classes concernées sont informées.' : 'Répartition validée. Les enseignants concernés sont informés.') + frozen },
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
      if (e instanceof ApiError && e.status === 409) {
        const d = await query(form).catch(() => null)
        if (d) setPrep(d)
      }
    } finally {
      setSending(false)
    }
  }

  const classes = prep?.classes ?? []
  const source = classes.find((c) => c.id === form?.sourceId)
  const started = isEdit && !!prep?.plan && prep.plan.startDate < prep.today
  const ready = !!form?.sourceId && hostList.length > 0 && students.length > 0 && unassigned.length === 0 && over.length === 0 && !busy.length
  const back = isEdit ? `/ecole/${schoolId}/repartitions/${planId}` : `/ecole/${schoolId}/repartitions`

  return (
    <Shell title={isEdit ? 'Modifier la répartition' : 'Répartir une classe'} subtitle={source ? `${source.name}${form ? ` · ${periodLabel(form.start, form.end, form.half)}` : ''}` : undefined}>
      <SchoolNav schoolId={schoolId} />
      <Link to={back} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Retour
      </Link>
      {!form || !prep ? (
        error ? <ErrorBox>{error}</ErrorBox> : <Spinner />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-32">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">1. Classe et période</h2>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1.5 text-sm font-medium min-[400px]:col-span-2 lg:col-span-1">
                Classe à répartir
                <select value={form.sourceId} disabled={isEdit} onChange={(e) => setF({ sourceId: e.target.value })} className={inputCls}>
                  <option value="">— Choisir —</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Du
                <input type="date" value={form.start} min={prep.today} disabled={started} onChange={(e) => e.target.value && setF({ start: e.target.value })} className={inputCls} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Au
                <input
                  type="date"
                  value={form.end}
                  min={form.start < prep.today ? prep.today : form.start}
                  max={addDays(form.start, PLAN_MAX_DAYS - 1)}
                  onChange={(e) => e.target.value && setF({ end: e.target.value })}
                  className={inputCls}
                />
              </label>
              <fieldset className="grid gap-1.5 min-[400px]:col-span-2 lg:col-span-1">
                <legend className="mb-1.5 text-sm font-medium">Créneaux</legend>
                <div className="flex rounded-xl bg-white p-1 ring-1 ring-line">
                  {(Object.keys(PLAN_HALF_LABELS) as PlanHalfDays[]).map((h) => (
                    <label
                      key={h}
                      className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg px-2 text-sm whitespace-nowrap font-semibold has-focus-visible:ring-2 has-focus-visible:ring-primary ${
                        form.half === h ? 'bg-primary text-white' : 'text-muted hover:bg-surface'
                      }`}
                    >
                      <input type="radio" name="half" value={h} checked={form.half === h} onChange={() => setF({ half: h })} className="sr-only" />
                      {h === 'day' ? 'Journée' : PLAN_HALF_LABELS[h]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className="mt-2 text-sm text-muted" aria-live="polite">
              {prep.slotCount === 0
                ? 'Aucune demi-journée d’école sur cette période (jour sans classe ou fermeture).'
                : `${prep.slotCount} demi-journée${prep.slotCount > 1 ? 's' : ''} d’école · ${PLAN_MAX_DAYS} jours au plus.`}
              {started && ' La répartition a commencé : sa date de début ne change plus.'}
            </p>
            {!isEdit && prep.last && form.sourceId && (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  applyPlan(prep.last!, students)
                  setNotice('Dernière répartition de cette classe reprise : vérifiez-la puis validez.')
                }}
              >
                <History className="size-4" aria-hidden /> Reprendre la dernière répartition ({periodLabel(prep.last.startDate, prep.last.endDate, prep.last.halfDays)})
              </Button>
            )}
          </Card>

          {form.sourceId && (
            <Card>
              <h2 className="mb-1 text-lg font-semibold">2. Classes d’accueil</h2>
              <p className="mb-3 text-sm text-muted">Effectif habituel sur la période. La capacité (facultative) est l’effectif total maximal après accueil.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {classes
                  .filter((c) => c.id !== form.sourceId)
                  .map((c) => {
                    const checked = c.id in hosts
                    const unavailable = c.distributed && !checked
                    return (
                      <li key={c.id} className={`rounded-xl px-3 py-2 ring-1 ${checked ? 'bg-surface ring-primary/40' : 'ring-line'}`}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3">
                          <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={checked} disabled={unavailable} onChange={(e) => toggleHost(c.id, e.target.checked)} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{c.name}</span>
                            <span className="block text-sm text-muted">
                              {unavailable ? 'Déjà répartie sur cette période' : `${c.expected} élève${c.expected > 1 ? 's' : ''} habituellement${c.hosting ? ' (accueil compris)' : ''}`}
                            </span>
                          </span>
                        </label>
                        {checked && (
                          <label className="mt-1 flex flex-wrap items-center gap-2 pb-1 text-sm">
                            Capacité max.
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={60}
                              value={hosts[c.id]}
                              placeholder="—"
                              onChange={(e) => setHosts({ ...hosts, [c.id]: e.target.value })}
                              className="min-h-11 w-24 rounded-xl bg-white px-3 text-base ring-1 ring-line"
                              aria-label={`Capacité maximale de ${c.name}`}
                            />
                          </label>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </Card>
          )}

          {form.sourceId && (
            <Card flush>
              <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
                <div>
                  <h2 className="text-lg font-semibold">3. Élèves ({students.length})</h2>
                  <p className="text-sm text-muted">Chaque élève va dans une seule classe, pour toute la période. Un élève déjà connu absent n’est pas réparti.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={propose} disabled={!hostList.length || !students.length}>
                    <Scale className="size-4" aria-hidden /> Proposer une répartition équilibrée
                  </Button>
                  {pinned.size > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPinned(new Set())
                        setNotice('Choix manuels effacés : « Proposer » répartira de nouveau tous les élèves.')
                      }}
                    >
                      <Undo2 className="size-4" aria-hidden /> Effacer les choix manuels
                    </Button>
                  )}
                </div>
              </div>
              {notice && (
                <p role="status" className="mx-5 mb-3 rounded-xl bg-surface px-4 py-2.5 text-sm font-medium text-primary-strong">
                  {notice}
                </p>
              )}
              {students.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted">{loading ? 'Chargement…' : 'Aucun élève de cette classe n’est attendu sur cette période.'}</p>
              ) : (
                <ul className={`divide-y divide-line border-t border-line ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                  {students.map((s) => {
                    const v = choice[s.id]
                    return (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-5 py-2.5">
                        <span className="min-w-0">
                          <span className="font-medium">{studentName(s)}</span>{' '}
                          {pinned.has(s.id) && <Badge tone="neutral">choix manuel</Badge>}
                          {s.partial && <span className="block text-xs text-muted">Pas attendu à chaque demi-journée</span>}
                          {s.busy && <span className="block text-xs font-semibold text-danger-ink">Déjà dans une autre répartition</span>}
                        </span>
                        <select
                          aria-label={`Classe d’accueil de ${studentName(s)}`}
                          value={v === undefined ? '' : v === null ? ABSENT : v}
                          onChange={(e) => setStudent(s.id, e.target.value)}
                          className={`${inputCls} sm:w-64 ${v === undefined ? 'ring-2 ring-amber-400' : ''}`}
                        >
                          <option value="">— À placer —</option>
                          {hostList.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                          <option value={ABSENT}>Absent connu (ne pas répartir)</option>
                        </select>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          )}

          {form.sourceId && hostList.length > 0 && students.length > 0 && (
            <section aria-labelledby="apercu">
              <h2 id="apercu" className="mb-2 text-lg font-semibold">
                4. Aperçu par classe
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {hostList.map((h) => {
                  const k = counts.get(h.id) ?? 0
                  const total = h.expected + k
                  const c = capacityOf(h.id)
                  const names = students.filter((s) => choice[s.id] === h.id).map(studentName)
                  return (
                    <li key={h.id}>
                      <Card className={`h-full ${c !== undefined && total > c ? 'ring-2 ring-danger/60' : ''}`}>
                        <p className="font-semibold">{h.name}</p>
                        <p className="text-sm">
                          {h.expected} + <strong>{k} accueilli{k > 1 ? 's' : ''}</strong> = <strong>{total}</strong> élèves
                          {c !== undefined && <span className={total > c ? 'font-semibold text-danger-ink' : 'text-muted'}> (capacité {c})</span>}
                        </p>
                        {names.length > 0 && <p className="mt-1 text-sm break-words text-muted">{names.join(', ')}</p>}
                      </Card>
                    </li>
                  )
                })}
                {absents.length > 0 && (
                  <li>
                    <Card className="h-full">
                      <p className="font-semibold">Absents connus</p>
                      <p className="mt-1 text-sm break-words text-muted">{absents.map(studentName).join(', ')}</p>
                    </Card>
                  </li>
                )}
              </ul>
            </section>
          )}
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      {form?.sourceId && prep && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <p className="flex-1 text-sm" aria-live="polite">
              {students.length === 0 ? (
                <span className="text-muted">Aucun élève à répartir.</span>
              ) : unassigned.length ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                  <AlertTriangle className="size-4" aria-hidden /> {unassigned.length} élève{unassigned.length > 1 ? 's' : ''} à placer sur {students.length}
                </span>
              ) : over.length ? (
                <span className="font-semibold text-danger-ink">Capacité dépassée : {over.map((h) => h.name).join(', ')}</span>
              ) : busy.length ? (
                <span className="font-semibold text-danger-ink">Des élèves sont déjà dans une autre répartition sur cette période.</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-success-ink">
                  <Check className="size-4" aria-hidden /> {students.length} élèves placés, aucun oubli ni doublon
                </span>
              )}
            </p>
            <Button className="min-h-12 w-full text-base sm:w-auto sm:px-8" disabled={!ready} loading={sending} onClick={submit}>
              <Check className="size-5" aria-hidden /> {isEdit ? 'Enregistrer les modifications' : 'Valider la répartition'}
            </Button>
          </div>
        </div>
      )}
    </Shell>
  )
}

