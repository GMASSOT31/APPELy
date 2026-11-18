import { BellRing, Megaphone, Shuffle } from 'lucide-react'
import { timeOf } from '../lib/schoolFormat'

export interface DirectionMessage {
  id: string
  body: string
  priority: 'normal' | 'important' | string
  startDate: string
  endDate: string
  classes?: string[]
}

/**
 * Mot de la direction (§8.2) : affiché dans la page, jamais en fenêtre bloquante,
 * sans accusé de lecture. Les messages importants sont en tête et en couleur.
 */
export function MessageList({ messages, showClasses }: { messages: DirectionMessage[]; showClasses?: boolean }) {
  if (!messages.length) return null
  return (
    <ul aria-label="Messages de la direction" className="grid gap-2">
      {messages.map((m) => {
        const important = m.priority === 'important'
        return (
          <li
            key={m.id}
            className={`flex gap-3 rounded-xl px-4 py-3 text-sm ring-1 ${
              important ? 'bg-amber-50 text-amber-900 ring-amber-300' : 'bg-surface text-ink ring-primary/15'
            }`}
          >
            <Megaphone className={`mt-0.5 size-4 shrink-0 ${important ? 'text-amber-700' : 'text-primary'}`} aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
                {important ? 'Important · ' : ''}Message de la direction
                {showClasses && m.classes?.length ? ` · ${m.classes.join(', ')}` : ''}
              </p>
              <p className="mt-0.5 break-words whitespace-pre-line">{m.body}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Relance de la direction pour un appel non fait : notification interne, non bloquante. */
export function ReminderNotice({ at, className = '' }: { at: string; className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2.5 text-sm font-semibold text-danger-ink ${className}`}>
      <BellRing className="size-4 shrink-0" aria-hidden />
      La direction vous a relancé à {timeOf(at)} : l’appel n’est pas encore fait.
    </p>
  )
}

export interface DistributionNotice {
  id: string
  classId: string
  className?: string
  body: string
  at: string
}

/** Notifications internes de répartition (§10) : création, modification, annulation, sans fenêtre bloquante. */
export function DistributionNotices({ notices, showClasses }: { notices: DistributionNotice[]; showClasses?: boolean }) {
  if (!notices.length) return null
  return (
    <ul aria-label="Répartitions" className="grid gap-2">
      {notices.map((n) => (
        <li key={n.id} className="flex gap-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink ring-1 ring-primary/25">
          <Shuffle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
              Répartition{showClasses && n.className ? ` · ${n.className}` : ''} · {timeOf(n.at)}
            </p>
            <p className="mt-0.5 break-words">{n.body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
