import type { PlanHalfDays } from '../domain/repartition'
import { addDays } from '../domain/direction'

export interface PlanSummary {
  id: string
  sourceClassId: string
  sourceName: string
  startDate: string
  endDate: string
  halfDays: PlanHalfDays
  hosts: string[]
  state: 'active' | 'cancelled'
  when: 'current' | 'upcoming' | 'past' | 'cancelled'
  students: number
  author: string
}

export const WHEN_BADGE: Record<PlanSummary['when'], { tone: 'success' | 'info' | 'neutral' | 'danger'; label: string }> = {
  current: { tone: 'success', label: 'En cours' },
  upcoming: { tone: 'info', label: 'À venir' },
  past: { tone: 'neutral', label: 'Terminée' },
  cancelled: { tone: 'danger', label: 'Annulée' },
}

export const primaryLink =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong'

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)


/** Prochain jour d'école après une date (jours fermés de la semaine exclus). */
export function nextSchoolDay(date: string, closedWeekdays: number) {
  let d = addDays(date, 1)
  for (let i = 0; i < 7; i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay() || 7
    if (!(closedWeekdays & (1 << (wd - 1)))) return d
    d = addDays(d, 1)
  }
  return d
}
