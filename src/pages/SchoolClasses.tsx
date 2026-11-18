import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight, Plus, Upload } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { LevelPicker } from '../components/schoolForms'
import { Badge, Button, Card, ErrorBox, Field, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useDirection, type Overview, type OverviewClass } from '../lib/school'
import { LEVELS } from '../domain/schedule'

export default function SchoolClasses() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(() => {
    api<Overview>(`/api/schools/${schoolId}/overview`).then(setData, (e) => setError(e.message))
  }, [schoolId])
  useEffect(load, [load])

  if (!membership) return <Navigate to="/" replace />

  // Regroupement visuel par niveau (premier niveau de la classe).
  const groups = new Map<string, OverviewClass[]>()
  for (const c of data?.classes ?? []) {
    const key = c.levels[0] ?? 'Sans niveau'
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const empty = data && data.classes.length === 0

  return (
    <Shell title={membership.schoolName} subtitle={data ? `Année scolaire ${data.school.academicYear}` : undefined}>
      <SchoolNav schoolId={schoolId} />
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Link
          to={`/ecole/${schoolId}/import`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line hover:bg-surface"
        >
          <Upload className="size-4" aria-hidden /> Importer des élèves
        </Link>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4" aria-hidden /> Nouvelle classe
          </Button>
        )}
      </div>
      {showForm && (
        <NewClassForm
          schoolId={schoolId}
          onDone={() => {
            setShowForm(false)
            load()
          }}
        />
      )}
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        <Spinner />
      ) : empty ? (
        <Card className="text-center">
          <p className="font-semibold">Aucune classe pour l’instant</p>
          <p className="mt-1 text-sm text-muted">
            Créez vos classes une par une, ou importez directement une liste d’élèves (CSV ou Excel) : les classes
            manquantes seront créées.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {[...groups.entries()].map(([level, classes]) => (
            <section key={level} aria-labelledby={`lvl-${level}`}>
              <h2 id={`lvl-${level}`} className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                {level}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {classes.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/ecole/${schoolId}/classes/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-transparent hover:ring-primary/40"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{c.name}</span>
                          {c.levels.length === 0 && <Badge tone="warning">Niveau à préciser</Badge>}
                          {c.levels.length > 1 && <Badge tone="info">{c.levels.join('-')}</Badge>}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {c.studentCount} élève{c.studentCount > 1 ? 's' : ''} ·{' '}
                          {c.teachers.length ? c.teachers.join(', ') : 'aucun enseignant affecté'}
                        </span>
                      </span>
                      <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Shell>
  )
}

function NewClassForm({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [levels, setLevels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!levels.length) return setError('Choisissez au moins un niveau.')
    setError('')
    setLoading(true)
    try {
      await api(`/api/schools/${schoolId}/classes`, { name, levels })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-4">
        <h2 className="font-semibold">Nouvelle classe</h2>
        <Field
          label="Nom de la classe"
          placeholder="CP A"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            // Pré-sélection du niveau d'après le nom (« CE1 B » → CE1).
            const guess = LEVELS.find((l) => new RegExp(`^${l}\\b`, 'i').test(e.target.value.trim()))
            if (guess && levels.length === 0) setLevels([guess])
          }}
        />
        <LevelPicker value={levels} onChange={setLevels} />
        <ErrorBox>{error}</ErrorBox>
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Créer la classe
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  )
}
