/**
 * Présence attendue et calendrier (cahier des charges §5.2). Fonctions pures,
 * partagées entre le navigateur et le Worker.
 *
 * Jours : 1 = lundi … 7 = dimanche (ISO). Demi-journées : 'am' (matin), 'pm' (après-midi).
 */

export type HalfDay = 'am' | 'pm'
export const SCHOOL_WEEKDAYS = [1, 2, 3, 4, 5, 6] as const
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
}
export const WEEKDAY_SHORT: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam', 7: 'Dim' }

/** Mercredi, samedi, dimanche fermés par défaut. */
export const DEFAULT_CLOSED_WEEKDAYS = dayMask([3, 6, 7])
/** Lundi, mardi, jeudi, vendredi : un appel par défaut. */
export const DEFAULT_SLOT_WEEKDAYS = dayMask([1, 2, 4, 5])

export function dayMask(days: number[]): number {
  return days.reduce((m, d) => m | (1 << (d - 1)), 0)
}

export function daysOf(mask: number): number[] {
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => mask & (1 << (d - 1)))
}

export function halfDayBit(weekday: number, half: HalfDay): number {
  return 1 << ((weekday - 1) * 2 + (half === 'pm' ? 1 : 0))
}

/** Masque « toutes les demi-journées d'école » selon les jours fermés. */
export function fullPattern(closedWeekdays: number): number {
  let p = 0
  for (const d of SCHOOL_WEEKDAYS) {
    if (closedWeekdays & (1 << (d - 1))) continue
    p |= halfDayBit(d, 'am') | halfDayBit(d, 'pm')
  }
  return p
}

export function isValidPattern(p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < 1 << 12
}

/** Jour ISO (1-7) d'une date « AAAA-MM-JJ », calculé sans fuseau horaire. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 ? 7 : wd
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export interface Closure {
  start_date: string
  end_date: string
  label: string
}

/** Journée sans classe : jour fermé de la semaine, ou période de fermeture (vacances, férié…). */
export function closureFor(date: string, closedWeekdays: number, closures: Closure[]): string | null {
  if (closedWeekdays & (1 << (isoWeekday(date) - 1))) return 'Pas de classe ce jour-là'
  const c = closures.find((x) => x.start_date <= date && date <= x.end_date)
  return c ? c.label : null
}

export interface ScheduleVersion {
  valid_from: string
  pattern: number | null
}

/** Version d'emploi du temps applicable à une date : la plus récente dont valid_from ≤ date. */
export function patternAt(versions: ScheduleVersion[], date: string): number | null | undefined {
  let best: ScheduleVersion | undefined
  for (const v of versions) if (v.valid_from <= date && (!best || v.valid_from > best.valid_from)) best = v
  return best ? best.pattern : undefined
}

export interface StudentForExpectation {
  id: string
  active_from: string
  active_to: string | null
  schedules: ScheduleVersion[]
}

/**
 * Élèves attendus pour une demi-journée : inscrits à cette date, et dont l'emploi du temps
 * applicable inclut la demi-journée (pattern NULL = tous les jours d'école).
 */
export function isExpected(s: StudentForExpectation, date: string, half: HalfDay): boolean {
  if (s.active_from > date) return false
  if (s.active_to && s.active_to < date) return false
  const p = patternAt(s.schedules, date)
  if (p === null || p === undefined) return true
  return (p & halfDayBit(isoWeekday(date), half)) !== 0
}

export const LEVELS = ['TPS', 'PS', 'MS', 'GS', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'] as const
export type Level = (typeof LEVELS)[number]

/** Rang d'affichage d'une classe : par son premier niveau, dans l'ordre scolaire. */
export function levelRank(levels: string[]): number {
  const ranks = levels.map((l) => LEVELS.indexOf(l as Level)).filter((i) => i >= 0)
  return ranks.length ? Math.min(...ranks) : LEVELS.length
}
