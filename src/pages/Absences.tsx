import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, X } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Button, Card, ErrorBox, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError, formatDate } from '../lib/api'
import { useSession } from '../lib/session'
import { PLANNED_HALF_LABELS, type PlannedHalfDays } from '../domain/direction'

interface Absence {
  id: string
  studentId: string
  studentName: string
  className: string
  startDate: string
  endDate: string
  halfDays: PlannedHalfDays
  reason: string
  author: string
}
interface Data {
  today: string
  reasons: string[]
  classes: { id: string; name: string; students: { id: string; firstName: string; lastName: string | null }[] }[]
  absences: Absence[]
}

const inputCls = 'min-h-11 min-w-0 rounded-xl bg-white px-3 text-base ring-1 ring-line focus:ring-2 focus:ring-primary focus:outline-none'

/**
 * Absences prévues (§8.3) : direction (toutes les classes) ou enseignant / remplaçant (ses classes).
 * L'élève est prépositionné « Absent » sur l'appel, mais reste « à vérifier ».
 */
export default function Absences() {
  const { schoolId = '' } = useParams()
  const { me } = useSession()
  const membership = me?.memberships.find((m) => m.schoolId === schoolId)
  const isDirection = membership?.role === 'direction'
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api<Data>(`/api/schools/${schoolId}/absences`).then(setData, (e) => setError(e.message))
  }, [schoolId])
  useEffect(load, [load])

  if (me && !membership) return <Navigate to="/" replace />

  async function cancel(a: Absence) {
    try {
      await api(`/api/schools/${schoolId}/absences/${a.id}/cancel`, {})
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    }
  }

  return (
    <Shell title="Absences prévues" subtitle="Pour préparer l’appel : la présence constatée reste toujours à vérifier.">
      {isDirection ? (
        <SchoolNav schoolId={schoolId} />
      ) : (
        <Link to="/enseignant" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Retour
        </Link>
      )}
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        !error && <Spinner />
      ) : data.classes.length === 0 ? (
        <Card className="text-sm text-muted">Aucune classe accessible.</Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <NewAbsence schoolId={schoolId} data={data} onDone={load} />
          <section aria-labelledby="abs-list">
            <h2 id="abs-list" className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
              Aujourd’hui et à venir
            </h2>
            {data.absences.length === 0 ? (
              <Card className="text-sm text-muted">Aucune absence prévue.</Card>
            ) : (
              <Card flush>
                <ul className="divide-y divide-line">
                  {data.absences.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {a.studentName} <span className="font-normal text-muted">· {a.className}</span>
                        </p>
                        <p className="text-sm text-muted">
                          {a.startDate === a.endDate ? `Le ${formatDate(a.startDate)}` : `Du ${formatDate(a.startDate)} au ${formatDate(a.endDate)}`} ·{' '}
                          {PLANNED_HALF_LABELS[a.halfDays]} · {a.reason}
                        </p>
                        <p className="text-xs text-muted">Enregistrée par {a.author}</p>
                      </div>
                      <Button variant="ghost" onClick={() => void cancel(a)} aria-label={`Annuler l’absence prévue de ${a.studentName}`}>
                        <X className="size-4" aria-hidden /> Annuler
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>
      )}
    </Shell>
  )
}

function NewAbsence({ schoolId, data, onDone }: { schoolId: string; data: Data; onDone: () => void }) {
  const [classId, setClassId] = useState(data.classes.length === 1 ? data.classes[0].id : '')
  const [studentId, setStudentId] = useState('')
  const [start, setStart] = useState(data.today)
  const [end, setEnd] = useState(data.today)
  const [half, setHalf] = useState<PlannedHalfDays>('day')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [loading, setLoading] = useState(false)
  const students = data.classes.find((c) => c.id === classId)?.students ?? []

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setDone('')
    setLoading(true)
    try {
      await api(`/api/schools/${schoolId}/absences`, { studentId, startDate: start, endDate: end, halfDays: half, reason })
      const s = students.find((x) => x.id === studentId)
      setDone(`Absence prévue enregistrée pour ${s?.firstName ?? 'l’élève'}.`)
      setStudentId('')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarPlus className="size-5 text-primary" aria-hidden /> Nouvelle absence prévue
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Classe
            <select
              required
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value)
                setStudentId('')
              }}
              className={inputCls}
            >
              <option value="">Choisir…</option>
              {data.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Élève
            <select required value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={!classId} className={inputCls}>
              <option value="">Choisir…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {`${s.firstName} ${s.lastName ?? ''}`.trim()}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Du
            <input
              type="date"
              required
              min={data.today}
              value={start}
              onChange={(e) => {
                setStart(e.target.value)
                if (end < e.target.value) setEnd(e.target.value)
              }}
              className={inputCls}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Au (inclus)
            <input type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Demi-journée
            <select value={half} onChange={(e) => setHalf(e.target.value as PlannedHalfDays)} className={inputCls}>
              {(Object.keys(PLANNED_HALF_LABELS) as PlannedHalfDays[]).map((h) => (
                <option key={h} value={h}>
                  {PLANNED_HALF_LABELS[h]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Motif
            <select required value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              <option value="">Choisir…</option>
              {data.reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          Motif court, choisi dans la liste : aucune information de santé. Sur l’appel, l’élève sera prépositionné « Absent » avec la
          mention « absence prévue », à vérifier par l’enseignant.
        </p>
        <ErrorBox>{error}</ErrorBox>
        {done && <SuccessBox>{done}</SuccessBox>}
        <div>
          <Button type="submit" loading={loading}>
            Enregistrer l’absence prévue
          </Button>
        </div>
      </form>
    </Card>
  )
}
