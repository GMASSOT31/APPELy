import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { WeekdayPicker } from '../components/schoolForms'
import { STATUS_COLOR_CLASSES, todayIso } from '../lib/schoolFormat'
import { Button, Card, ErrorBox, Field, Spinner } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { useDirection } from '../lib/school'

type Category = 'PRESENT' | 'ABSENT' | 'AUTRE'
interface Status {
  id: string
  label: string
  color: string
  category: Category
}
interface Settings {
  closedWeekdays: number
  statuses: Status[]
  closures: { id: string; start_date: string; end_date: string; label: string }[]
}

const CATEGORY_LABELS: Record<Category, string> = { PRESENT: 'Compte comme présent', ABSENT: 'Compte comme absent', AUTRE: 'Autre' }

export default function SchoolSettings() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const base = `/api/schools/${schoolId}`
  const [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api<Settings>(`${base}/settings`).then(setData, (e) => setError(e.message))
  }, [base])
  useEffect(load, [load])

  if (!membership) return <Navigate to="/" replace />

  async function run(path: string, body: unknown = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return false
    setError('')
    try {
      await api(path, body)
      load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  return (
    <Shell title={membership.schoolName}>
      <SchoolNav schoolId={schoolId} />
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <StatusesSection statuses={data.statuses} base={base} run={run} />

          <section>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Jours sans classe</h2>
            <Card>
              <WeekdayPicker
                legend="Jours où l’école est fermée chaque semaine"
                value={data.closedWeekdays}
                onChange={(v) => run(`${base}/settings/weekdays`, { closedWeekdays: v })}
              />
            </Card>
          </section>

          <ClosuresSection closures={data.closures} base={base} run={run} reload={load} />
        </div>
      )}
    </Shell>
  )
}

type Run = (path: string, body?: unknown, confirmText?: string) => Promise<boolean>

function StatusesSection({ statuses, base, run }: { statuses: Status[]; base: string; run: Run }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">États d’appel</h2>
        {editing === null && statuses.length < 6 && (
          <Button variant="ghost" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Ajouter un état
          </Button>
        )}
      </div>
      <Card flush>
        <p className="border-b border-line px-4 py-3 text-sm text-muted">
          L’ordre détermine le cycle d’un tap pendant l’appel. Chaque état compte comme présent, absent ou autre dans les totaux.
        </p>
        <ul className="divide-y divide-line">
          {statuses.map((s, i) =>
            editing === s.id ? (
              <li key={s.id} className="p-4">
                <StatusForm
                  initial={s}
                  onCancel={() => setEditing(null)}
                  onSave={async (b) => {
                    if (await run(`${base}/statuses/${s.id}`, b)) setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`size-4 shrink-0 rounded-full ${STATUS_COLOR_CLASSES[s.color]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-sm text-muted">{CATEGORY_LABELS[s.category]}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    disabled={i === 0}
                    aria-label={`Monter ${s.label}`}
                    onClick={() => run(`${base}/statuses/${s.id}/move`, { direction: 'up' })}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={i === statuses.length - 1}
                    aria-label={`Descendre ${s.label}`}
                    onClick={() => run(`${base}/statuses/${s.id}/move`, { direction: 'down' })}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(s.id)}>
                    Modifier
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => run(`${base}/statuses/${s.id}/archive`, {}, `Retirer l’état « ${s.label} » ? L’historique reste lisible.`)}
                  >
                    Retirer
                  </Button>
                </span>
              </li>
            ),
          )}
          {editing === 'new' && (
            <li className="p-4">
              <StatusForm
                onCancel={() => setEditing(null)}
                onSave={async (b) => {
                  if (await run(`${base}/statuses`, b)) setEditing(null)
                }}
              />
            </li>
          )}
        </ul>
      </Card>
    </section>
  )
}

function StatusForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Status
  onSave: (b: { label: string; color: string; category: Category }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [color, setColor] = useState(initial?.color ?? 'primary')
  const [category, setCategory] = useState<Category>(initial?.category ?? 'PRESENT')
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ label, color, category })
      }}
    >
      <Field label="Libellé" placeholder="Présent cantine" required maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Couleur</legend>
        <div className="flex gap-2">
          {Object.entries(STATUS_COLOR_CLASSES).map(([k, cls]) => (
            <button
              key={k}
              type="button"
              aria-pressed={color === k}
              aria-label={k}
              onClick={() => setColor(k)}
              className={`size-10 rounded-full ${cls} ${color === k ? 'ring-4 ring-ink/25' : ''}`}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Dans les totaux</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ring-1 ${
                category === c ? 'bg-primary text-white ring-primary' : 'bg-white ring-line'
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit">Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

function ClosuresSection({
  closures,
  base,
  run,
  reload,
}: {
  closures: Settings['closures']
  base: string
  run: Run
  reload: () => void
}) {
  const [label, setLabel] = useState('')
  const [start, setStart] = useState(todayIso())
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api(`${base}/closures`, { label, startDate: start, endDate: end || start })
      setLabel('')
      setEnd('')
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Vacances et fermetures</h2>
      <Card flush>
        <form onSubmit={add} className="grid gap-3 border-b border-line p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label="Motif" placeholder="Vacances de Noël" required value={label} onChange={(e) => setLabel(e.target.value)} />
          <Field label="Du" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label="Au (inclus)" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          <Button type="submit">Ajouter</Button>
          {error && (
            <div className="sm:col-span-4">
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}
        </form>
        {closures.length === 0 ? (
          <p className="p-4 text-sm text-muted">Aucune fermeture à venir.</p>
        ) : (
          <ul className="divide-y divide-line">
            {closures.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-sm text-muted">
                    {c.start_date === c.end_date ? formatDate(c.start_date) : `du ${formatDate(c.start_date)} au ${formatDate(c.end_date)}`}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => run(`${base}/closures/${c.id}/delete`, {}, `Supprimer « ${c.label} » ?`)}>
                  Supprimer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
