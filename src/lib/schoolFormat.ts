import { daysOf, halfDayBit, SCHOOL_WEEKDAYS, WEEKDAY_SHORT } from '../domain/schedule'

export const openDays = (closed: number) => SCHOOL_WEEKDAYS.filter((d) => !(closed & (1 << (d - 1))))

/** Résumé lisible d'une présence attendue. */
export function scheduleSummary(pattern: number | null, closedWeekdays: number): string {
  if (pattern === null) return 'Tous les jours'
  const parts: string[] = []
  for (const d of openDays(closedWeekdays)) {
    const am = (pattern & halfDayBit(d, 'am')) !== 0
    const pm = (pattern & halfDayBit(d, 'pm')) !== 0
    if (am && pm) parts.push(WEEKDAY_SHORT[d])
    else if (am) parts.push(`${WEEKDAY_SHORT[d]} matin`)
    else if (pm) parts.push(`${WEEKDAY_SHORT[d]} a-m`)
  }
  return parts.length ? parts.join(', ') : 'Jamais attendu'
}

export function weekdaysSummary(mask: number): string {
  const d = daysOf(mask)
  return d.length ? d.map((x) => WEEKDAY_SHORT[x]).join(', ') : 'Aucun jour'
}

export const STATUS_COLOR_CLASSES: Record<string, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  primary: 'bg-primary',
  amber: 'bg-amber-400',
  violet: 'bg-violet-500',
  neutral: 'bg-slate-400',
}

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** « 09:00 » → « 9 h 00 ». */
export const formatDue = (t: string) => `${Number(t.slice(0, 2))} h ${t.slice(3)}`

/** Heure locale « 09:12 » d'un horodatage serveur. */
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** « mardi 17 novembre » pour une date AAAA-MM-JJ. */
export const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
