import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BellRing, CalendarX, CheckCircle2, ChevronRight, Circle, Shuffle } from 'lucide-react'
import { Shell } from '../components/Shell'
import { DistributionNotices, MessageList, type DirectionMessage, type DistributionNotice } from '../components/DirectionMessages'
import { timeOf } from '../lib/schoolFormat'
import { Card, Spinner } from '../components/ui'
import { api, formatDate, ROLE_LABELS } from '../lib/api'
import { callPath } from '../lib/school'
import { useSession } from '../lib/session'

interface DaySlot {
  id: string
  name: string
  halfDay: 'am' | 'pm'
  dueTime: string | null
  validatedAt: string | null
  remindedAt: string | null
  /** Classe entièrement répartie : pas d'appel à faire, les classes d'accueil s'en chargent. */
  distributed: boolean
  awayCount: number
  hostedCount: number
  hostedFrom: string[]
}
interface Day {
  today: string
  closure: string | null
  messages: DirectionMessage[]
  distributionNotices: DistributionNotice[]
  classes: { id: string; name: string; slots: DaySlot[] }[]
}

const AUTO_OPEN_KEY = 'appely:auto-opened'
/** Relances et messages de la direction : actualisation légère toutes les 60 s. */
const REFRESH_MS = 60_000

/**
 * Accueil enseignant : les appels du jour. S'il n'y a qu'un seul appel à faire, il s'ouvre
 * directement (une fois par jour et par session), pour un appel en quelques secondes.
 */
export default function Teacher() {
  const { me } = useSession()
  const navigate = useNavigate()
  const [days, setDays] = useState<Record<string, Day | null>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!me) return
    let first = true
    const fetchAll = () =>
      Promise.all(
        me.memberships.map((m) =>
          api<Day>(`/api/schools/${m.schoolId}/my-day`).then(
            (d) => [m.schoolId, d] as const,
            () => [m.schoolId, null] as const,
          ),
        ),
      ).then((entries) => {
        // Actualisation : on ne remplace pas une donnée affichée par une erreur réseau passagère.
        setDays((prev) => Object.fromEntries(entries.map(([sid, d]) => [sid, d ?? prev[sid] ?? null])))
        setLoaded(true)
        if (!first) return
        first = false
        const pending = entries.flatMap(([sid, d]) =>
          (d?.classes ?? []).flatMap((c) => c.slots.filter((s) => !s.validatedAt && !s.distributed).map((s) => callPath(sid, c.id, d!.today, s.id))),
        )
        try {
          const today = entries.find(([, d]) => d)?.[1]?.today
          if (pending.length === 1 && today && sessionStorage.getItem(AUTO_OPEN_KEY) !== today) {
            sessionStorage.setItem(AUTO_OPEN_KEY, today)
            navigate(pending[0])
          }
        } catch {
          /* stockage indisponible : pas d'ouverture automatique */
        }
      })
    void fetchAll()
    const timer = setInterval(() => document.visibilityState === 'visible' && void fetchAll(), REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && void fetchAll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [me, navigate])

  return (
    <Shell title={`Bonjour ${me?.user.displayName ?? ''}`}>
      {!loaded ? (
        <Spinner />
      ) : (
        <div className="grid gap-5">
          {me?.memberships.map((m) => {
            const d = days[m.schoolId]
            return (
              <section key={m.schoolId}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
                    {m.schoolName} · {ROLE_LABELS[m.role]}
                    {m.activeTo && ` jusqu’au ${formatDate(m.activeTo)}`}
                  </h2>
                  {d && d.classes.length > 0 && (
                    <Link
                      to={`/ecole/${m.schoolId}/absences`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-surface"
                    >
                      <CalendarX className="size-4" aria-hidden /> Absences prévues
                    </Link>
                  )}
                </div>
                {d && (d.messages.length > 0 || d.distributionNotices?.length > 0) && (
                  <div className="mb-3 grid gap-2">
                    <DistributionNotices notices={d.distributionNotices ?? []} showClasses={d.classes.length > 1} />
                    <MessageList messages={d.messages} showClasses={d.classes.length > 1} />
                  </div>
                )}
                {!d || d.classes.length === 0 ? (
                  <Card className="text-sm text-muted">
                    Aucune classe ne vous est encore affectée. La direction peut vous affecter une classe depuis sa page.
                  </Card>
                ) : d.closure ? (
                  <Card className="text-sm text-muted">Pas d’appel aujourd’hui : {d.closure}.</Card>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {d.classes.flatMap((c) =>
                      c.slots.length === 0
                        ? [
                            <li key={c.id}>
                              <Card className="text-sm text-muted">
                                <span className="font-semibold text-ink">{c.name}</span> · pas d’appel prévu aujourd’hui
                              </Card>
                            </li>,
                          ]
                        : c.slots.map((s) => (
                            <li key={`${c.id}-${s.id}`}>
                              <Link
                                to={callPath(m.schoolId, c.id, d.today, s.id)}
                                className={`flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] ring-1 ${
                                  s.validatedAt || s.distributed ? 'bg-white ring-transparent' : 'bg-primary text-white ring-primary'
                                }`}
                              >
                                {s.distributed ? (
                                  <Shuffle className="size-6 shrink-0 text-primary" aria-hidden />
                                ) : s.validatedAt ? (
                                  <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
                                ) : (
                                  <Circle className="size-6 shrink-0 text-white/70" aria-hidden />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block font-semibold">
                                    {c.name} · {s.name}
                                  </span>
                                  <span className={`block text-sm ${s.validatedAt || s.distributed ? 'text-muted' : 'text-white/85'}`}>
                                    {s.distributed
                                      ? 'Classe répartie : pas d’appel à faire, voir où sont vos élèves'
                                      : s.validatedAt
                                      ? `Validé à ${new Date(s.validatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                                      : `À faire${s.dueTime ? ` avant ${Number(s.dueTime.slice(0, 2))} h ${s.dueTime.slice(3)}` : ''}`}
                                  </span>
                                  {s.hostedCount > 0 && (
                                    <span className={`block text-sm font-semibold ${s.validatedAt ? 'text-primary-strong' : 'text-white'}`}>
                                      + {s.hostedCount} élève{s.hostedCount > 1 ? 's' : ''} accueilli{s.hostedCount > 1 ? 's' : ''} ({s.hostedFrom.join(', ')})
                                    </span>
                                  )}
                                  {!s.distributed && s.awayCount > 0 && (
                                    <span className={`block text-sm ${s.validatedAt ? 'text-muted' : 'text-white/85'}`}>
                                      {s.awayCount} élève{s.awayCount > 1 ? 's' : ''} réparti{s.awayCount > 1 ? 's' : ''} ailleurs
                                    </span>
                                  )}
                                  {s.remindedAt && !s.validatedAt && !s.distributed && (
                                    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-danger-ink">
                                      <BellRing className="size-3.5" aria-hidden /> Relance de la direction à {timeOf(s.remindedAt)}
                                    </span>
                                  )}
                                </span>
                                <ChevronRight className="size-5 shrink-0" aria-hidden />
                              </Link>
                            </li>
                          )),
                    )}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

