import type { Env } from './auth'
import { messageApplies, messageVisible, sortMessages, type MessageTarget, type MessageTargetKind } from '../../src/domain/direction'

/** Date du jour dans le fuseau de l'école (Europe/Paris par défaut). */
export function schoolToday(timezone = 'Europe/Paris', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Heure courante « HH:MM » dans le fuseau de l'école. */
export function schoolNowTime(timezone = 'Europe/Paris', now = new Date()): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

export interface MessageRow {
  id: string
  target_kind: MessageTargetKind
  targets: string
  body: string
  priority: string
  start_date: string
  end_date: string
  created_at: string
  archived_at: string | null
}

/** Requête des messages visibles un jour donné (à passer dans un lot D1). */
export function visibleMessagesQuery(env: Env, schoolId: string, date: string) {
  return env.DB.prepare(
    `SELECT id, target_kind, targets, body, priority, start_date, end_date, created_at, archived_at FROM direction_messages
      WHERE school_id = ? AND archived_at IS NULL AND start_date <= ? AND end_date >= ?`,
  ).bind(schoolId, date, date)
}

/** Messages applicables à une classe, importants d'abord. */
export function messagesForClass(rows: MessageRow[], cls: { id: string; levels: string[] }, date: string) {
  return sortMessages(
    rows.filter((m) => messageVisible(m, date) && messageApplies({ target_kind: m.target_kind, targets: JSON.parse(m.targets) } as MessageTarget, cls)),
  )
}

export function scopeLabel(kind: MessageTargetKind, targets: string[], classNames: Map<string, string>): string {
  if (kind === 'school') return 'Toute l’école'
  if (kind === 'levels') return targets.join(', ')
  return targets.map((id) => classNames.get(id) ?? 'classe retirée').join(', ')
}

export const publicMessage = (m: MessageRow) => ({ id: m.id, body: m.body, priority: m.priority, startDate: m.start_date, endDate: m.end_date })
