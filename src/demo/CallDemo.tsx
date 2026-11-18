import { useMemo, useState } from 'react'
import { Check, MessageSquare, RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_STATUSES,
  applyTap,
  canValidate,
  computeTotals,
  initialEntries,
  type CallEntry,
} from '../domain/attendance'
import { DEMO_CLASS } from './fixtures'

const statusById = new Map(DEFAULT_STATUSES.map((s) => [s.id, s]))

/**
 * Démonstration locale de la grille d'appel (lot 0).
 * Utilise les vraies règles métier, mais RIEN n'est enregistré : le backend arrive au lot 1-3.
 */
export function CallDemo() {
  const studentIds = useMemo(() => DEMO_CLASS.students.map((s) => s.id), [])
  const [entries, setEntries] = useState<CallEntry[]>(() => initialEntries(studentIds, DEFAULT_STATUSES))
  const [validatedAt, setValidatedAt] = useState<string | null>(null)
  const totals = computeTotals(entries, DEFAULT_STATUSES)
  const check = canValidate(entries, DEFAULT_STATUSES)
  const names = new Map(DEMO_CLASS.students.map((s) => [s.id, s.firstName]))

  function tap(id: string) {
    setValidatedAt(null)
    setEntries((e) => applyTap(e, id, DEFAULT_STATUSES))
  }

  function reset() {
    setValidatedAt(null)
    setEntries(initialEntries(studentIds, DEFAULT_STATUSES))
  }

  return (
    <section
      aria-label="Démonstration de l’appel"
      className="mx-auto w-full max-w-md rounded-[1.75rem] bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-line"
    >
      <header className="mb-3 text-center">
        <h2 className="text-lg font-bold">{DEMO_CLASS.name}</h2>
        <p className="text-sm text-muted">{DEMO_CLASS.slot}</p>
      </header>

      <div className="mb-3 flex gap-2.5 rounded-xl bg-surface p-3 text-sm">
        <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          <span className="font-semibold">Message de la direction</span>
          <br />
          <span className="text-muted">{DEMO_CLASS.message}</span>
        </p>
      </div>

      <p className="mb-2 text-xs text-muted">
        Touchez un élève pour changer son état. Les cartes en pointillés sont « à vérifier » jusqu’à la validation.
      </p>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map((e) => {
          const s = statusById.get(e.statusId)!
          const absent = s.category === 'ABSENT'
          return (
            <li key={e.studentId}>
              <button
                type="button"
                onClick={() => tap(e.studentId)}
                aria-label={`${names.get(e.studentId)} : ${s.label}${e.prefilled ? ', à vérifier' : ''}. Toucher pour changer.`}
                className={[
                  'flex min-h-14 w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors',
                  absent ? 'bg-danger/12 ring-1 ring-danger/50' : 'bg-success/10 ring-1 ring-success/40',
                  e.prefilled ? 'ring-dashed' : '',
                ].join(' ')}
                style={e.prefilled ? { outline: '1px dashed rgb(24 44 89 / 0.18)', outlineOffset: '-4px' } : undefined}
              >
                <span
                  className={[
                    'grid size-6 shrink-0 place-items-center rounded-full text-white',
                    absent ? 'bg-danger' : 'bg-success',
                  ].join(' ')}
                >
                  {absent ? <X className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{names.get(e.studentId)}</span>
                  <span className={['block text-xs', absent ? 'text-danger-ink' : 'text-success-ink'].join(' ')}>
                    {s.label}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2" aria-live="polite">
        <div className="rounded-xl bg-success/10 p-3 text-center">
          <div className="text-2xl font-bold text-success-ink">{totals.byCategory.PRESENT}</div>
          <div className="text-xs text-success-ink">Présents</div>
        </div>
        <div className="rounded-xl bg-danger/12 p-3 text-center">
          <div className="text-2xl font-bold text-danger-ink">{totals.byCategory.ABSENT}</div>
          <div className="text-xs text-danger-ink">Absents</div>
        </div>
      </div>

      {validatedAt ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-success/12 p-3 text-sm" role="status">
          <span className="font-medium text-success-ink">
            Appel validé à {validatedAt} (démo : non enregistré)
          </span>
          <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-muted hover:text-ink">
            <RotateCcw className="size-4" aria-hidden /> Recommencer
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!check.ok}
          onClick={() => setValidatedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white transition-colors hover:bg-primary-strong disabled:opacity-50"
        >
          <Check className="size-5" aria-hidden /> Valider l’appel
        </button>
      )}
    </section>
  )
}
