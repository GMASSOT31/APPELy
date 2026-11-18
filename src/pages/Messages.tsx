import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Megaphone, Send, Trash2 } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Button, Card, ErrorBox, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { useDirection } from '../lib/school'
import { LEVELS } from '../domain/schedule'
import { MESSAGE_MAX, type MessageTargetKind } from '../domain/direction'

interface Msg {
  id: string
  body: string
  priority: string
  startDate: string
  endDate: string
  targetKind: MessageTargetKind
  scope: string
  author: string
  state: 'past' | 'current' | 'upcoming'
}
interface Data {
  today: string
  classes: { id: string; name: string; levels: string[] }[]
  messages: Msg[]
}

const period = (m: { startDate: string; endDate: string }) =>
  m.startDate === m.endDate ? `le ${formatDate(m.startDate)}` : `du ${formatDate(m.startDate)} au ${formatDate(m.endDate)}`

/** Messages ciblés de la direction (§8.2) : composer et retirer. */
export default function Messages() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api<Data>(`/api/schools/${schoolId}/messages`).then(setData, (e) => setError(e.message))
  }, [schoolId])
  useEffect(load, [load])

  if (!membership) return <Navigate to="/" replace />

  async function archive(id: string) {
    try {
      await api(`/api/schools/${schoolId}/messages/${id}/archive`, {})
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    }
  }

  const visible = data?.messages.filter((m) => m.state !== 'past') ?? []
  return (
    <Shell title="Messages" subtitle="Affichés sur l’écran d’appel et l’accueil des enseignants concernés, sans fenêtre bloquante.">
      <SchoolNav schoolId={schoolId} />
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        !error && <Spinner />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Composer schoolId={schoolId} data={data} onDone={load} />
          <section aria-labelledby="msg-list">
            <h2 id="msg-list" className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
              En cours et à venir
            </h2>
            {visible.length === 0 ? (
              <Card className="text-sm text-muted">Aucun message en cours.</Card>
            ) : (
              <ul className="grid gap-2">
                {visible.map((m) => (
                  <li key={m.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.priority === 'important' && <Badge tone="warning">Important</Badge>}
                        <Badge tone={m.state === 'current' ? 'success' : 'info'}>{m.state === 'current' ? 'Visible' : 'À venir'}</Badge>
                        <span className="text-sm font-semibold">{m.scope}</span>
                      </div>
                      <p className="mt-2 break-words whitespace-pre-line">{m.body}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted">
                          {period(m)} · {m.author}
                        </p>
                        <Button variant="ghost" onClick={() => void archive(m.id)} aria-label={`Retirer le message « ${m.body.slice(0, 40)} »`}>
                          <Trash2 className="size-4" aria-hidden /> Retirer
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Shell>
  )
}

function Composer({ schoolId, data, onDone }: { schoolId: string; data: Data; onDone: () => void }) {
  const [params] = useSearchParams()
  const preset = params.get('classe')
  const presetOk = !!preset && data.classes.some((c) => c.id === preset)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<MessageTargetKind>(presetOk ? 'classes' : 'school')
  const [levels, setLevels] = useState<string[]>([])
  const [classes, setClasses] = useState<string[]>(presetOk ? [preset!] : [])
  const [start, setStart] = useState(data.today)
  const [end, setEnd] = useState(data.today)
  const [important, setImportant] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const id = useId()
  const usedLevels = LEVELS.filter((l) => data.classes.some((c) => c.levels.includes(l)))

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setDone(false)
    if (kind === 'levels' && !levels.length) return setError('Choisissez au moins un niveau.')
    if (kind === 'classes' && !classes.length) return setError('Choisissez au moins une classe.')
    setLoading(true)
    try {
      await api(`/api/schools/${schoolId}/messages`, {
        body,
        targetKind: kind,
        targets: kind === 'levels' ? levels : kind === 'classes' ? classes : [],
        startDate: start,
        endDate: end,
        priority: important ? 'important' : 'normal',
      })
      setBody('')
      setImportant(false)
      setDone(true)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    } finally {
      setLoading(false)
    }
  }

  const chip = (checked: boolean) =>
    `inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium ring-1 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary ${
      checked ? 'bg-surface text-primary-strong ring-primary' : 'bg-white ring-line'
    }`

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Megaphone className="size-5 text-primary" aria-hidden /> Nouveau message
        </h2>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-body`} className="text-sm font-medium">
            Message
          </label>
          <textarea
            id={`${id}-body`}
            required
            rows={3}
            maxLength={MESSAGE_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ex. : exercice incendie à 10 h, sortie par l’escalier B."
            className="rounded-xl bg-white px-3.5 py-2.5 text-base ring-1 ring-line focus:ring-2 focus:ring-primary focus:outline-none"
          />
          <span className="text-xs text-muted">
            {body.length}/{MESSAGE_MAX} · Pas d’information médicale ou sensible sur un élève.
          </span>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">À qui ?</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['school', 'Toute l’école'],
                ['levels', 'Un ou plusieurs niveaux'],
                ['classes', 'Des classes choisies'],
              ] as [MessageTargetKind, string][]
            ).map(([v, label]) => (
              <label key={v} className={chip(kind === v)}>
                <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          {kind === 'levels' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Niveaux">
              {usedLevels.map((l) => (
                <label key={l} className={chip(levels.includes(l))}>
                  <input type="checkbox" checked={levels.includes(l)} onChange={() => setLevels(toggle(levels, l))} className="size-4 accent-primary" />
                  {l}
                </label>
              ))}
              {usedLevels.length === 0 && <p className="text-sm text-muted">Aucune classe pour l’instant.</p>}
            </div>
          )}
          {kind === 'classes' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Classes">
              {data.classes.map((c) => (
                <label key={c.id} className={chip(classes.includes(c.id))}>
                  <input
                    type="checkbox"
                    checked={classes.includes(c.id)}
                    onChange={() => setClasses(toggle(classes, c.id))}
                    className="size-4 accent-primary"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Visible du
            <input
              type="date"
              required
              min={data.today}
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (end < e.target.value) setEnd(e.target.value)
              }}
              className="min-h-11 min-w-0 rounded-xl bg-white px-3 text-base ring-1 ring-line"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            au (inclus)
            <input
              type="date"
              required
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="min-h-11 min-w-0 rounded-xl bg-white px-3 text-base ring-1 ring-line"
            />
          </label>
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} className="size-5 accent-primary" />
          Important (affiché en premier et en couleur)
        </label>
        <ErrorBox>{error}</ErrorBox>
        {done && <SuccessBox>Message publié. Il apparaît sur l’écran d’appel des classes concernées.</SuccessBox>}
        <div>
          <Button type="submit" loading={loading}>
            {!loading && <Send className="size-4" aria-hidden />} Publier le message
          </Button>
        </div>
      </form>
    </Card>
  )
}
