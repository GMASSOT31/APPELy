import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, History, MoreHorizontal, Pencil, X } from 'lucide-react'
import { Shell } from '../components/Shell'
import { MessageList, ReminderNotice, type DirectionMessage } from '../components/DirectionMessages'
import { Button, Card, ErrorBox, Spinner } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { STATUS_COLOR_CLASSES } from '../lib/schoolFormat'
import { parisToday } from '../lib/school'

interface Status {
  id: string
  label: string
  color: string
  category: 'PRESENT' | 'ABSENT' | 'AUTRE'
  active: boolean
}
interface Revision {
  version: number
  by: string
  at: string
  reason: string | null
  changes: { studentId: string; from: string; to: string }[] | null
}
interface CallData {
  class: { id: string; name: string }
  slot: { id: string; name: string; halfDay: 'am' | 'pm'; dueTime: string | null }
  date: string
  noCallReason: string | null
  statuses: Status[]
  students: { id: string; firstName: string; lastName: string | null }[]
  messages: DirectionMessage[]
  /** Absences prévues : élève → motif. Prépositionné Absent, toujours « à vérifier ». */
  plannedAbsences: Record<string, string>
  remindedAt: string | null
  call: null | {
    version: number
    status: 'validated' | 'corrected'
    remark: string | null
    entries: Record<string, string>
    validatedAt: string
    updatedAt: string
    updatedBy: string
    revisions: Revision[]
  }
}
interface Draft {
  baseVersion: number
  entries: Record<string, string>
  touched: string[]
  remark: string
  reason: string
}

/** « Présent cantine » → « présents cantine » au pluriel (accord du premier mot). */
function pluralLabel(label: string, n: number) {
  const [head, ...rest] = label.toLowerCase().split(' ')
  const h = n > 1 && !/[sx]$/.test(head) ? `${head}s` : head
  return [h, ...rest].join(' ')
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function readDraft(key: string): Draft | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as Draft) : null
  } catch {
    return null
  }
}
function writeDraft(key: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(key, JSON.stringify(d))
    else localStorage.removeItem(key)
  } catch {
    /* stockage indisponible : le brouillon n'est simplement pas conservé */
  }
}

export default function CallPage() {
  const { schoolId = '', classId = '', date = '', slotId = '' } = useParams()
  const navigate = useNavigate()
  const path = `/api/schools/${schoolId}/classes/${classId}/calls/${date}/${slotId}`
  const draftKey = `appely:draft:${classId}:${date}:${slotId}`

  const [data, setData] = useState<CallData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [remark, setRemark] = useState('')
  const [reason, setReason] = useState('')
  const [showRemark, setShowRemark] = useState(false)
  const [editing, setEditing] = useState(false)
  const [restored, setRestored] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const requestIdRef = useRef<string | null>(null)

  const load = useCallback(
    async (opts: { keepDraft: boolean } = { keepDraft: true }) => {
      try {
        const d = await api<CallData>(path)
        setData(d)
        const active = d.statuses.filter((s) => s.active)
        const present = active.find((s) => s.category === 'PRESENT')
        const absent = active.find((s) => s.category === 'ABSENT')
        const base = d.call
          ? d.call.entries
          : Object.fromEntries(d.students.map((s) => [s.id, (d.plannedAbsences[s.id] && absent ? absent.id : present?.id) ?? '']))
        const draft = opts.keepDraft ? readDraft(draftKey) : null
        const ids = new Set(d.students.map((s) => s.id))
        // Brouillon restauré seulement s'il porte sur la même version et les mêmes élèves.
        if (draft && draft.baseVersion === (d.call?.version ?? 0) && Object.keys(draft.entries).every((k) => ids.has(k))) {
          setEntries({ ...base, ...draft.entries })
          setTouched(new Set(draft.touched))
          setRemark(draft.remark)
          setReason(draft.reason)
          setEditing(!!d.call)
          setRestored(true)
        } else {
          writeDraft(draftKey, null)
          setEntries(base)
          setTouched(new Set())
          setRemark(d.call?.remark ?? '')
          setReason('')
          setEditing(false)
          setRestored(false)
        }
        setShowRemark(!!d.call?.remark)
      } catch (e) {
        setLoadError((e as Error).message)
      }
    },
    [path, draftKey],
  )
  useEffect(() => {
    void load()
  }, [load])

  const statusById = useMemo(() => new Map(data?.statuses.map((s) => [s.id, s]) ?? []), [data])
  const cycle = useMemo(() => data?.statuses.filter((s) => s.active) ?? [], [data])
  const directPicker = cycle.length > 2
  const locked = !!data?.call && !editing
  const dirty = data
    ? data.call
      ? Object.entries(entries).some(([k, v]) => data.call!.entries[k] !== v) || (remark.trim() || null) !== data.call.remark
      : touched.size > 0 || remark.trim() !== ''
    : false

  // Brouillon local à chaque modification ; avertissement si l'on quitte avec un appel non transmis.
  useEffect(() => {
    if (!data || !dirty) return
    writeDraft(draftKey, { baseVersion: data.call?.version ?? 0, entries, touched: [...touched], remark, reason })
    requestIdRef.current = null // contenu modifié : nouvelle tentative
  }, [data, dirty, entries, touched, remark, reason, draftKey])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (loadError)
    return (
      <Shell title="Appel">
        <ErrorBox>{loadError}</ErrorBox>
      </Shell>
    )
  if (!data) return <Spinner />

  function tap(id: string) {
    if (locked) return
    setNotice('')
    const i = cycle.findIndex((s) => s.id === entries[id])
    setEntries({ ...entries, [id]: cycle[(i + 1) % cycle.length].id })
    setTouched(new Set(touched).add(id))
  }
  function pick(id: string, statusId: string) {
    setEntries({ ...entries, [id]: statusId })
    setTouched(new Set(touched).add(id))
    setMenuFor(null)
  }

  async function submit() {
    if (!data || sending) return
    setSending(true)
    setError('')
    requestIdRef.current ??= crypto.randomUUID()
    try {
      await api(`${path}/validate`, {
        baseVersion: data.call?.version ?? 0,
        requestId: requestIdRef.current,
        entries,
        remark,
        reason: data.call ? reason : undefined,
      })
      writeDraft(draftKey, null)
      requestIdRef.current = null
      setNotice(data.call ? 'Correction enregistrée.' : 'Appel validé et enregistré.')
      await load({ keepDraft: false })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(e.message)
        writeDraft(draftKey, null)
        await load({ keepDraft: false })
      } else if (e instanceof ApiError && e.code === 'NETWORK') {
        setError('Non transmis : l’appel est gardé sur cet appareil. Vérifiez le réseau et appuyez de nouveau sur « Valider ».')
      } else setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    } finally {
      setSending(false)
    }
  }

  const counts = new Map<string, number>()
  for (const v of Object.values(entries)) counts.set(v, (counts.get(v) ?? 0) + 1)
  const isToday = date === parisToday()
  const name = (id: string) => {
    const s = data.students.find((x) => x.id === id)
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Élève'
  }

  return (
    <Shell title={`${data.class.name} · ${data.slot.name}`} subtitle={isToday ? 'Aujourd’hui' : formatDate(date)}>
      <button
        type="button"
        // Retour à la page d'origine (accueil, tableau de bord, historique), sinon à l'accueil.
        onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/'))}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden /> Retour
      </button>
      {(data.messages.length > 0 || (data.remindedAt && !data.call)) && (
        <div className="mb-3 grid gap-2">
          {data.remindedAt && !data.call && !data.noCallReason && <ReminderNotice at={data.remindedAt} />}
          <MessageList messages={data.messages} />
        </div>
      )}

      {data.noCallReason ? (
        <Card className="text-center">
          <p className="font-semibold">Pas d’appel</p>
          <p className="mt-1 text-sm text-muted">{data.noCallReason}</p>
        </Card>
      ) : data.students.length === 0 ? (
        <Card className="text-center">
          <p className="font-semibold">Aucun élève attendu sur ce créneau</p>
          <p className="mt-1 text-sm text-muted">Il n’y a pas d’appel à valider. Vérifiez la liste de la classe avec la direction si c’est inattendu.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-28">
          {data.call && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/12 px-4 py-3 text-sm text-success-ink">
              <span className="inline-flex items-center gap-2 font-semibold">
                <Check className="size-4" aria-hidden />
                {data.call.status === 'corrected'
                  ? `Corrigé à ${time(data.call.updatedAt)} par ${data.call.updatedBy}`
                  : `Validé à ${time(data.call.validatedAt)} par ${data.call.updatedBy}`}
              </span>
              {!editing && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden /> Corriger
                </Button>
              )}
            </div>
          )}
          {notice && !data.call && <p role="status">{notice}</p>}
          {restored && dirty && (
            <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800" role="status">
              Brouillon retrouvé : enregistré sur cet appareil, <strong>pas encore transmis</strong>.
            </p>
          )}
          {!data.call && (
            <p className="text-sm text-muted">
              Touchez les élèves absents{directPicker ? ' (ou « ⋯ » pour choisir un état)' : ''}, puis validez. Les cartes en
              pointillés sont <strong>à vérifier</strong>.
              {Object.keys(data.plannedAbsences).length > 0 && ' Les absences prévues sont déjà marquées « Absent » : vérifiez si l’élève est là.'}
            </p>
          )}
          {editing && <p className="text-sm font-medium text-primary-strong">Mode correction : touchez les élèves à modifier.</p>}

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.students.map((s) => {
              const st = statusById.get(entries[s.id])
              const unverified = !data.call && !touched.has(s.id)
              const planned = !data.call ? data.plannedAbsences[s.id] : undefined
              const tone = st ? STATUS_COLOR_CLASSES[st.color] : 'bg-slate-300'
              return (
                <li key={s.id} className="relative">
                  <button
                    type="button"
                    onClick={() => tap(s.id)}
                    disabled={locked}
                    aria-label={`${s.firstName} ${s.lastName ?? ''} : ${st?.label ?? '?'}${planned ? `, absence prévue (${planned})` : ''}${unverified ? ', à vérifier' : ''}${locked ? '' : '. Toucher pour changer.'}`}
                    className={[
                      'flex min-h-16 w-full items-center gap-2.5 rounded-xl bg-white px-3 py-2 text-left ring-1 transition-colors disabled:cursor-default',
                      st?.category === 'ABSENT' ? 'bg-danger/8 ring-danger/50' : st?.category === 'AUTRE' ? 'ring-amber-300' : 'ring-success/35',
                      directPicker && !locked ? 'pr-12' : '',
                    ].join(' ')}
                    style={unverified ? { outline: '1.5px dashed rgb(24 44 89 / 0.25)', outlineOffset: '-5px' } : undefined}
                  >
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-white ${tone}`}>
                      {st?.category === 'ABSENT' ? <X className="size-4" strokeWidth={3} /> : <Check className="size-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.firstName}</span>
                      <span className="block truncate text-xs text-muted">
                        {s.lastName ? `${s.lastName} · ` : ''}
                        {st?.label}
                      </span>
                      {planned && (
                        <span className="block truncate text-xs font-semibold text-amber-800" title={planned}>
                          Absence prévue
                        </span>
                      )}
                    </span>
                  </button>
                  {directPicker && !locked && (
                    <>
                      <button
                        type="button"
                        aria-label={`Choisir l’état de ${s.firstName}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === s.id}
                        onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                        className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface"
                      >
                        <MoreHorizontal className="size-5" aria-hidden />
                      </button>
                      {menuFor === s.id && (
                        <ul role="menu" className="absolute top-full right-0 z-20 mt-1 w-52 rounded-xl bg-white p-1 shadow-lg ring-1 ring-line">
                          {cycle.map((x) => (
                            <li key={x.id} role="none">
                              <button
                                role="menuitem"
                                type="button"
                                autoFocus={x.id === entries[s.id]}
                                onClick={() => pick(s.id, x.id)}
                                onKeyDown={(e) => e.key === 'Escape' && setMenuFor(null)}
                                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface"
                              >
                                <span className={`size-3 rounded-full ${STATUS_COLOR_CLASSES[x.color]}`} aria-hidden />
                                {x.label}
                                {x.id === entries[s.id] && <Check className="ml-auto size-4 text-primary" aria-hidden />}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          {(showRemark || !locked) && (
            <div>
              {!showRemark ? (
                <button type="button" onClick={() => setShowRemark(true)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">
                  <ChevronDown className="size-4" aria-hidden /> Ajouter une remarque
                </button>
              ) : (
                <label className="grid gap-1.5 text-sm font-medium">
                  Remarque générale (facultative)
                  <input
                    maxLength={200}
                    disabled={locked}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="Ex. : sortie à la bibliothèque"
                    className="min-h-11 rounded-xl bg-white px-3.5 text-base ring-1 ring-line disabled:bg-canvas"
                  />
                  <span className="text-xs font-normal text-muted">Pas d’information médicale ou sensible.</span>
                </label>
              )}
            </div>
          )}

          {editing && (
            <label className="grid gap-1.5 text-sm font-medium">
              Motif de la correction (facultatif)
              <input
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex. : arrivé en retard"
                className="min-h-11 rounded-xl bg-white px-3.5 text-base ring-1 ring-line"
              />
            </label>
          )}

          {data.call && data.call.revisions.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={showHistory}
                onClick={() => setShowHistory(!showHistory)}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
              >
                <History className="size-4" aria-hidden /> Historique ({data.call.revisions.length})
              </button>
              {showHistory && (
                <Card flush>
                  <ol className="divide-y divide-line text-sm">
                    {data.call.revisions.map((r) => (
                      <li key={r.version} className="px-4 py-3">
                        <p className="font-medium">
                          {r.version === 1 ? 'Validation' : `Correction n° ${r.version - 1}`} · {formatDate(r.at)} à {time(r.at)} · {r.by}
                        </p>
                        {r.reason && <p className="text-muted">Motif : {r.reason}</p>}
                        {r.changes?.map((c) => (
                          <p key={c.studentId} className="text-muted">
                            {name(c.studentId)} : {statusById.get(c.from)?.label ?? '?'} → {statusById.get(c.to)?.label ?? '?'}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
          )}

          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      {!data.noCallReason && data.students.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex flex-1 flex-wrap gap-1.5 text-sm" aria-live="polite">
              {cycle
                .concat(data.statuses.filter((s) => !s.active && counts.get(s.id)))
                .map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 font-semibold ring-1 ring-line">
                    <span className={`size-2.5 rounded-full ${STATUS_COLOR_CLASSES[s.color]}`} aria-hidden />
                    {counts.get(s.id) ?? 0} {pluralLabel(s.label, counts.get(s.id) ?? 0)}
                  </span>
                ))}
              <span className="inline-flex items-center px-1 text-muted">/ {data.students.length}</span>
            </div>
            {locked ? (
              notice && <span className="text-sm font-semibold text-success-ink">{notice}</span>
            ) : (
              <div className="flex w-full gap-2 sm:w-auto">
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      writeDraft(draftKey, null)
                      void load({ keepDraft: false })
                    }}
                  >
                    Annuler
                  </Button>
                )}
                <Button className="min-h-12 flex-1 text-base sm:flex-none sm:px-8" loading={sending} disabled={editing && !dirty} onClick={submit}>
                  <Check className="size-5" aria-hidden /> {editing ? 'Enregistrer la correction' : 'Valider l’appel'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  )
}
