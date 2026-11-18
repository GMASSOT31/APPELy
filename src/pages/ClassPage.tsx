import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Shell } from '../components/Shell'
import { LevelPicker, ScheduleEditor, WeekdayPicker } from '../components/schoolForms'
import { scheduleSummary, todayIso, weekdaysSummary } from '../lib/schoolFormat'
import { Badge, Button, Card, ErrorBox, Field, Spinner } from '../components/ui'
import { api, ApiError, formatDate, ROLE_LABELS, type Role } from '../lib/api'
import { DEFAULT_SLOT_WEEKDAYS } from '../domain/schedule'
import { callPath, parisToday, useDirection, type Overview } from '../lib/school'

interface Student {
  id: string
  firstName: string
  lastName: string | null
  pattern: number | null
  upcoming: { validFrom: string; pattern: number | null }[]
}
interface Slot {
  id: string
  name: string
  half_day: 'am' | 'pm'
  weekdays: number
  due_time: string | null
}
interface ClassDetail {
  class: { id: string; name: string; levels: string[] }
  students: Student[]
  slots: Slot[]
  teachers: { id: string; display_name: string; role: Role }[]
  candidates: { id: string; display_name: string; role: Role }[]
}

export default function ClassPage() {
  const { schoolId = '', classId = '' } = useParams()
  const membership = useDirection(schoolId)
  const navigate = useNavigate()
  const [data, setData] = useState<ClassDetail | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const base = `/api/schools/${schoolId}`
  const load = useCallback(() => {
    api<ClassDetail>(`${base}/classes/${classId}`).then(setData, (e) => setError(e.message))
    api<Overview>(`${base}/overview`).then(setOverview, () => undefined)
  }, [base, classId])
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

  const closed = overview?.school.closedWeekdays ?? 0

  return (
    <Shell title={data?.class.name ?? 'Classe'} subtitle={membership.schoolName}>
      <Link to={`/ecole/${schoolId}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Toutes les classes
      </Link>
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        <Spinner />
      ) : (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-6">
          {editing ? (
            <ClassEditForm
              base={base}
              detail={data}
              onDone={() => {
                setEditing(false)
                load()
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {data.class.levels.length ? (
                data.class.levels.map((l) => (
                  <Badge key={l} tone="info">
                    {l}
                  </Badge>
                ))
              ) : (
                <Badge tone="warning">Niveau à préciser</Badge>
              )}
              <Button variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Renommer / niveaux
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await run(`${base}/classes/${classId}/archive`, {}, `Archiver la classe ${data.class.name} ?`))
                    navigate(`/ecole/${schoolId}`)
                }}
              >
                <Trash2 className="size-4" aria-hidden /> Archiver
              </Button>
            </div>
          )}

          <TeachersSection data={data} run={run} base={`${base}/classes/${classId}`} />
          <StudentsSection
            data={data}
            base={base}
            classId={classId}
            closed={closed}
            classes={overview?.classes ?? []}
            run={run}
            reload={load}
          />
          <SlotsSection data={data} base={`${base}/classes/${classId}`} run={run} schoolId={schoolId} classId={classId} />
        </div>
      )}
    </Shell>
  )
}

type Run = (path: string, body?: unknown, confirmText?: string) => Promise<boolean>

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function ClassEditForm({ base, detail, onDone }: { base: string; detail: ClassDetail; onDone: () => void }) {
  const [name, setName] = useState(detail.class.name)
  const [levels, setLevels] = useState<string[]>(detail.class.levels)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await api(`${base}/classes/${detail.class.id}`, { name, levels })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    }
  }
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nom de la classe" required value={name} onChange={(e) => setName(e.target.value)} />
        <LevelPicker value={levels} onChange={setLevels} />
        <ErrorBox>{error}</ErrorBox>
        <div className="flex gap-2">
          <Button type="submit">Enregistrer</Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  )
}

function TeachersSection({ data, run, base }: { data: ClassDetail; run: Run; base: string }) {
  const assigned = new Set(data.teachers.map((t) => t.display_name))
  const available = data.candidates.filter((c) => !assigned.has(c.display_name))
  return (
    <Section title="Enseignants">
      <Card className="grid gap-3">
        {data.teachers.length === 0 ? (
          <p className="text-sm text-muted">Aucun enseignant affecté : personne ne pourra faire l’appel de cette classe.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.teachers.map((t) => (
              <li key={t.id} className="inline-flex items-center gap-1 rounded-full bg-surface py-1 pr-1 pl-3 text-sm font-medium">
                {t.display_name}
                {t.role !== 'enseignant' && <span className="text-xs text-muted">({ROLE_LABELS[t.role]})</span>}
                <button
                  type="button"
                  aria-label={`Retirer ${t.display_name} de la classe`}
                  onClick={() => run(`${base}/teachers/${t.id}/remove`, {}, `Retirer ${t.display_name} de la classe ?`)}
                  className="grid size-8 place-items-center rounded-full text-muted hover:bg-white hover:text-danger-ink"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {available.length > 0 && (
          <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
            Affecter une personne
            <select
              className="min-h-11 rounded-xl bg-white px-3 ring-1 ring-line"
              value=""
              onChange={(e) => e.target.value && run(`${base}/teachers`, { membershipId: e.target.value })}
            >
              <option value="">Choisir…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name} · {ROLE_LABELS[c.role]}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>
    </Section>
  )
}

function StudentsSection({
  data,
  base,
  classId,
  closed,
  classes,
  run,
  reload,
}: {
  data: ClassDetail
  base: string
  classId: string
  closed: number
  classes: Overview['classes']
  run: Run
  reload: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [addError, setAddError] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [classSchedule, setClassSchedule] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setAddError('')
    try {
      await api(`${base}/classes/${classId}/students`, { firstName, lastName })
      setFirstName('')
      setLastName('')
      reload()
      firstRef.current?.focus() // saisie à la chaîne
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    }
  }

  return (
    <Section
      title={`Élèves (${data.students.length})`}
      action={
        data.students.length > 0 && (
          <Button variant="ghost" onClick={() => setClassSchedule(!classSchedule)}>
            Présence de toute la classe
          </Button>
        )
      }
    >
      {classSchedule && (
        <ScheduleForm
          title="Présence attendue de toute la classe"
          initial={null}
          closed={closed}
          onCancel={() => setClassSchedule(false)}
          onSave={async (pattern, validFrom) => {
            if (await run(`${base}/classes/${classId}/schedule`, { pattern, validFrom })) setClassSchedule(false)
          }}
        />
      )}
      <Card flush>
        <form onSubmit={add} className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Prénom" required ref={firstRef} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Field label="Nom (facultatif)" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <Button type="submit">
            <Plus className="size-4" aria-hidden /> Ajouter
          </Button>
          {addError && (
            <div className="sm:col-span-3">
              <ErrorBox>{addError}</ErrorBox>
            </div>
          )}
        </form>
        {data.students.length === 0 ? (
          <p className="p-4 text-sm text-muted">Aucun élève. Ajoutez-les ci-dessus ou importez une liste.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.students.map((s) =>
              editId === s.id ? (
                <li key={s.id} className="p-4">
                  <StudentEditor
                    student={s}
                    base={base}
                    classId={classId}
                    classes={classes}
                    closed={closed}
                    onDone={() => {
                      setEditId(null)
                      reload()
                    }}
                    run={run}
                  />
                </li>
              ) : (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.firstName} {s.lastName}
                    </p>
                    <p className="text-sm text-muted">
                      {scheduleSummary(s.pattern, closed)}
                      {s.upcoming.map((u) => (
                        <span key={u.validFrom}>
                          {' '}
                          · à partir du {formatDate(u.validFrom)} : {scheduleSummary(u.pattern, closed)}
                        </span>
                      ))}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setEditId(s.id)} aria-label={`Modifier ${s.firstName}`}>
                    <Pencil className="size-4" aria-hidden /> Modifier
                  </Button>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </Section>
  )
}

function ScheduleForm({
  title,
  initial,
  closed,
  onSave,
  onCancel,
}: {
  title: string
  initial: number | null
  closed: number
  onSave: (pattern: number | null, validFrom: string) => void
  onCancel: () => void
}) {
  const [pattern, setPattern] = useState<number | null>(initial)
  const [validFrom, setValidFrom] = useState(todayIso())
  return (
    <Card className="mb-3 grid gap-4">
      <h3 className="font-semibold">{title}</h3>
      <ScheduleEditor value={pattern} closedWeekdays={closed} onChange={setPattern} />
      <Field
        label="À partir du"
        type="date"
        min={todayIso()}
        value={validFrom}
        onChange={(e) => setValidFrom(e.target.value)}
        hint="Les appels déjà passés ne sont pas modifiés."
      />
      <div className="flex gap-2">
        <Button type="button" onClick={() => onSave(pattern, validFrom)}>
          Enregistrer
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </Card>
  )
}

function StudentEditor({
  student,
  base,
  classId,
  classes,
  closed,
  onDone,
  run,
}: {
  student: Student
  base: string
  classId: string
  classes: Overview['classes']
  closed: number
  onDone: () => void
  run: Run
}) {
  const [firstName, setFirstName] = useState(student.firstName)
  const [lastName, setLastName] = useState(student.lastName ?? '')
  const [target, setTarget] = useState(classId)
  const [error, setError] = useState('')
  const [pattern, setPattern] = useState<number | null>(student.pattern)
  const [validFrom, setValidFrom] = useState(todayIso())
  const scheduleChanged = pattern !== student.pattern

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api(`${base}/students/${student.id}`, { firstName, lastName, classId: target })
      if (scheduleChanged) await api(`${base}/students/${student.id}/schedule`, { pattern, validFrom })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prénom" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Field label="Nom (facultatif)" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
        Classe
        <select className="min-h-11 rounded-xl bg-white px-3 ring-1 ring-line" value={target} onChange={(e) => setTarget(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2">
        <span className="text-sm font-medium">Présence attendue</span>
        <ScheduleEditor value={pattern} closedWeekdays={closed} onChange={setPattern} />
        {scheduleChanged && (
          <Field
            label="Nouvelle présence à partir du"
            type="date"
            min={todayIso()}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        )}
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button
          type="button"
          variant="danger"
          className="sm:ml-auto"
          onClick={async () => {
            if (
              await run(
                `${base}/students/${student.id}/leave`,
                { date: todayIso() },
                `${student.firstName} quitte l’école aujourd’hui ? L’élève restera dans l’historique.`,
              )
            )
              onDone()
          }}
        >
          Départ de l’élève
        </Button>
      </div>
    </form>
  )
}

function SlotsSection({
  data,
  base,
  run,
  schoolId,
  classId,
}: {
  data: ClassDetail
  base: string
  run: Run
  schoolId: string
  classId: string
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  return (
    <Section
      title="Appels"
      action={
        editing === null && (
          <Button variant="ghost" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Ajouter un appel
          </Button>
        )
      }
    >
      <Card flush>
        {data.slots.length === 0 && editing !== 'new' && (
          <p className="p-4 text-sm text-muted">Aucun appel prévu pour cette classe.</p>
        )}
        <ul className="divide-y divide-line">
          {data.slots.map((s) =>
            editing === s.id ? (
              <li key={s.id} className="p-4">
                <SlotForm
                  initial={s}
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    if (await run(`${base}/slots/${s.id}`, body)) setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-muted">
                    {s.half_day === 'am' ? 'Matin' : 'Après-midi'} · {weekdaysSummary(s.weekdays)}
                    {s.due_time && ` · avant ${Number(s.due_time.slice(0, 2))} h ${s.due_time.slice(3)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Link
                    to={callPath(schoolId, classId, parisToday(), s.id)}
                    className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-primary-strong hover:bg-surface"
                  >
                    Appel du jour
                  </Link>
                  <Button variant="ghost" onClick={() => setEditing(s.id)}>
                    Modifier
                  </Button>
                  <Button variant="ghost" onClick={() => run(`${base}/slots/${s.id}/archive`, {}, `Supprimer « ${s.name} » ?`)}>
                    Supprimer
                  </Button>
                </div>
              </li>
            ),
          )}
          {editing === 'new' && (
            <li className="p-4">
              <SlotForm
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  if (await run(`${base}/slots`, body)) setEditing(null)
                }}
              />
            </li>
          )}
        </ul>
      </Card>
    </Section>
  )
}

function SlotForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Slot
  onSave: (body: { name: string; halfDay: 'am' | 'pm'; weekdays: number; dueTime: string | null }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? 'Appel de l’après-midi')
  const [halfDay, setHalfDay] = useState<'am' | 'pm'>(initial?.half_day ?? 'pm')
  const [weekdays, setWeekdays] = useState(initial?.weekdays ?? DEFAULT_SLOT_WEEKDAYS)
  const [dueTime, setDueTime] = useState(initial?.due_time ?? (initial ? '' : '13:45'))
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ name, halfDay, weekdays, dueTime: dueTime || null })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom de l’appel" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Heure limite (facultatif)"
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          hint="Alerte la direction si l’appel n’est pas fait."
        />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Demi-journée</legend>
        <div className="flex gap-2">
          {(['am', 'pm'] as const).map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={halfDay === h}
              onClick={() => setHalfDay(h)}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold ring-1 ${
                halfDay === h ? 'bg-primary text-white ring-primary' : 'bg-white ring-line'
              }`}
            >
              {h === 'am' ? 'Matin' : 'Après-midi'}
            </button>
          ))}
        </div>
      </fieldset>
      <WeekdayPicker legend="Jours" value={weekdays} onChange={setWeekdays} days={[1, 2, 3, 4, 5, 6]} />
      <div className="flex gap-2">
        <Button type="submit">Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  )
}
