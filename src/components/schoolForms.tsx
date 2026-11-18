import { useId } from 'react'
import { openDays } from '../lib/schoolFormat'
import { halfDayBit, LEVELS, WEEKDAY_SHORT, type HalfDay } from '../domain/schedule'

/** Sélecteur de niveaux (1 à 3), en puces accessibles au clavier. */
export function LevelPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Niveau(x)</legend>
      <div className="flex flex-wrap gap-1.5">
        {LEVELS.map((l) => {
          const on = value.includes(l)
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== l) : value.length < 3 ? [...value, l] : value)}
              className={`min-h-11 min-w-12 rounded-lg px-2.5 text-sm font-semibold ring-1 ${
                on ? 'bg-primary text-white ring-primary' : 'bg-white text-ink ring-line hover:bg-surface'
              }`}
            >
              {l}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Choix de jours de la semaine (masque de bits, lundi = bit 0). */
export function WeekdayPicker({
  value,
  onChange,
  days = [1, 2, 3, 4, 5, 6, 7],
  legend,
}: {
  value: number
  onChange: (v: number) => void
  days?: number[]
  legend: string
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const bit = 1 << (d - 1)
          const on = (value & bit) !== 0
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(value ^ bit)}
              className={`min-h-11 min-w-12 rounded-lg px-2.5 text-sm font-semibold ring-1 ${
                on ? 'bg-primary text-white ring-primary' : 'bg-white text-ink ring-line hover:bg-surface'
              }`}
            >
              {WEEKDAY_SHORT[d]}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}


/**
 * Présence attendue : « Même liste tous les jours » (null) ou grille jours × demi-journées.
 */
export function ScheduleEditor({
  value,
  closedWeekdays,
  onChange,
}: {
  value: number | null
  closedWeekdays: number
  onChange: (v: number | null) => void
}) {
  const id = useId()
  const days = openDays(closedWeekdays)
  const all = days.reduce((p, d) => p | halfDayBit(d, 'am') | halfDayBit(d, 'pm'), 0)
  return (
    <div className="grid gap-3">
      <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2.5 text-sm font-medium">
        <input
          id={id}
          type="checkbox"
          className="size-5 accent-primary"
          checked={value === null}
          onChange={(e) => onChange(e.target.checked ? null : all)}
        />
        Même liste tous les jours
      </label>
      {value !== null && (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="sr-only">Demi-journée</th>
                {days.map((d) => (
                  <th key={d} scope="col" className="px-1 pb-1 font-medium text-muted">
                    {WEEKDAY_SHORT[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['am', 'pm'] as HalfDay[]).map((h) => (
                <tr key={h}>
                  <th scope="row" className="pr-2 text-left font-medium text-muted">
                    {h === 'am' ? 'Matin' : 'Après-midi'}
                  </th>
                  {days.map((d) => {
                    const bit = halfDayBit(d, h)
                    const on = (value & bit) !== 0
                    return (
                      <td key={d} className="p-0.5">
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${WEEKDAY_SHORT[d]} ${h === 'am' ? 'matin' : 'après-midi'}`}
                          onClick={() => onChange(value ^ bit)}
                          className={`grid size-11 place-items-center rounded-lg text-xs font-bold ring-1 ${
                            on ? 'bg-success/15 text-success-ink ring-success/50' : 'bg-white text-muted/60 ring-line'
                          }`}
                        >
                          {on ? '✓' : '–'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

