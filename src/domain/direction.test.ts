import { describe, expect, it } from 'vitest'
import { addDays, assignTabs, callState, daysBetween, messageApplies, messageVisible, plannedCovers, sortMessages, summarize } from './direction'

describe('état d’un appel sur le tableau de bord', () => {
  const base = { date: '2026-11-17', today: '2026-11-17', nowTime: '09:15', dueTime: '09:00' }
  it('validé, en retard après l’heure limite, en attente avant', () => {
    expect(callState({ ...base, validated: true })).toBe('validated')
    expect(callState({ ...base, validated: false })).toBe('late')
    expect(callState({ ...base, validated: false, nowTime: '08:59' })).toBe('pending')
    expect(callState({ ...base, validated: false, nowTime: '09:00' })).toBe('pending')
  })
  it('sans heure limite : jamais en retard le jour même ; jour passé non fait = en retard', () => {
    expect(callState({ ...base, validated: false, dueTime: null, nowTime: '18:00' })).toBe('pending')
    expect(callState({ ...base, validated: false, date: '2026-11-16', nowTime: '07:00' })).toBe('late')
    expect(callState({ ...base, validated: false, date: '2026-11-18' })).toBe('pending')
  })
})

describe('onglets matin / après-midi / autres créneaux', () => {
  it('premier créneau de chaque demi-journée, les suivants dans « autres »', () => {
    const t = assignTabs([
      { id: 'a1', class_id: 'A', half_day: 'am' },
      { id: 'a2', class_id: 'A', half_day: 'am' },
      { id: 'b1', class_id: 'B', half_day: 'am' },
      { id: 'a3', class_id: 'A', half_day: 'pm' },
    ])
    expect(Object.fromEntries(t)).toEqual({ a1: 'am', a2: 'other', b1: 'am', a3: 'pm' })
  })
  it('indicateurs cohérents', () => {
    const k = summarize([
      { state: 'validated', counts: { present: 23, absent: 2, other: 0 } },
      { state: 'validated', counts: { present: 18, absent: 1, other: 1 } },
      { state: 'late', counts: null },
      { state: 'pending', counts: null },
    ])
    expect(k).toEqual({ expected: 4, validated: 2, pending: 1, late: 1, present: 41, absent: 3, other: 1 })
  })
})

describe('messages ciblés', () => {
  const cls = { id: 'c1', levels: ['CE1', 'CE2'] }
  it('école, niveau (classes à double niveau), sélection de classes', () => {
    expect(messageApplies({ target_kind: 'school', targets: [] }, cls)).toBe(true)
    expect(messageApplies({ target_kind: 'levels', targets: ['CE2'] }, cls)).toBe(true)
    expect(messageApplies({ target_kind: 'levels', targets: ['CP'] }, cls)).toBe(false)
    expect(messageApplies({ target_kind: 'classes', targets: ['c2', 'c1'] }, cls)).toBe(true)
    expect(messageApplies({ target_kind: 'classes', targets: ['c2'] }, cls)).toBe(false)
  })
  it('période de visibilité bornes incluses, message retiré invisible', () => {
    const m = { start_date: '2026-11-17', end_date: '2026-11-18', archived_at: null }
    expect(messageVisible(m, '2026-11-16')).toBe(false)
    expect(messageVisible(m, '2026-11-17')).toBe(true)
    expect(messageVisible(m, '2026-11-18')).toBe(true)
    expect(messageVisible({ ...m, archived_at: '2026-11-17T08:00:00Z' }, '2026-11-17')).toBe(false)
  })
  it('importants d’abord, puis les plus récents', () => {
    const l = sortMessages([
      { id: 1, priority: 'normal', created_at: '2026-11-17T08:00' },
      { id: 2, priority: 'important', created_at: '2026-11-16T08:00' },
      { id: 3, priority: 'normal', created_at: '2026-11-17T09:00' },
    ])
    expect(l.map((x) => x.id)).toEqual([2, 3, 1])
  })
})

describe('absences prévues', () => {
  const a = { start_date: '2026-11-17', end_date: '2026-11-19', half_days: 'am' as const }
  it('date et demi-journée couvertes, annulation', () => {
    expect(plannedCovers(a, '2026-11-18', 'am')).toBe(true)
    expect(plannedCovers(a, '2026-11-18', 'pm')).toBe(false)
    expect(plannedCovers(a, '2026-11-20', 'am')).toBe(false)
    expect(plannedCovers({ ...a, half_days: 'day' }, '2026-11-19', 'pm')).toBe(true)
    expect(plannedCovers({ ...a, cancelled_at: '2026-11-16' }, '2026-11-18', 'am')).toBe(false)
  })
  it('calcul de dates sans effet de fuseau', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26') // passage à l'heure d'hiver
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-11-01', '2026-11-18')).toBe(17)
  })
})
