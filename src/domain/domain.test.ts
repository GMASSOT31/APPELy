import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATUSES,
  applyTap,
  callToOpen,
  parisHalfDay,
  canValidate,
  computeTotals,
  initialEntries,
  nextStatusId,
  requiresDirectPicker,
  type AttendanceStatus,
} from './attendance'
import { DistributionError, checkDistribution, proposeDistribution } from './repartition'

const ids = (n: number, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

describe('appel', () => {
  it('scénario standard : 25 élèves, 2 absents = 2 taps puis validation', () => {
    let entries = initialEntries(ids(25), DEFAULT_STATUSES)
    entries = applyTap(entries, 's3', DEFAULT_STATUSES)
    entries = applyTap(entries, 's17', DEFAULT_STATUSES)
    const t = computeTotals(entries, DEFAULT_STATUSES)
    expect(t.byCategory).toEqual({ PRESENT: 23, ABSENT: 2, AUTRE: 0 })
    expect(t.recorded).toBe(t.expected)
    expect(canValidate(entries, DEFAULT_STATUSES)).toEqual({ ok: true })
  })

  it('les élèves préremplis restent marqués « à vérifier »', () => {
    const entries = applyTap(initialEntries(ids(3), DEFAULT_STATUSES), 's2', DEFAULT_STATUSES)
    expect(entries.map((e) => e.prefilled)).toEqual([true, false, true])
  })

  it('avec deux états, un second tap revient à Présent', () => {
    expect(nextStatusId(DEFAULT_STATUSES, 'present')).toBe('absent')
    expect(nextStatusId(DEFAULT_STATUSES, 'absent')).toBe('present')
    expect(requiresDirectPicker(DEFAULT_STATUSES)).toBe(false)
  })

  it('avec un 3e état, le tap avance et la sélection directe devient obligatoire', () => {
    const statuses: AttendanceStatus[] = [
      ...DEFAULT_STATUSES,
      { id: 'cantine', label: 'Présent cantine', category: 'PRESENT', tone: 'success', order: 2, active: true },
    ]
    expect(nextStatusId(statuses, 'absent')).toBe('cantine')
    expect(nextStatusId(statuses, 'cantine')).toBe('present')
    expect(requiresDirectPicker(statuses)).toBe(true)
  })

  it('une classe sans élève attendu ne peut pas être validée', () => {
    expect(canValidate([], DEFAULT_STATUSES)).toEqual({ ok: false, reason: 'NO_STUDENTS' })
  })
})

describe('répartition', () => {
  const hosts = [
    { id: 'cpa', name: 'CP A', expected: 20 },
    { id: 'ce1b', name: 'CE1 B', expected: 24 },
    { id: 'ce2a', name: 'CE2 A', expected: 22 },
  ]
  const students = ids(24).map((id) => ({ id }))

  it('scénario de recette : CE1 A (24) vers CP A, CE1 B et CE2 A', () => {
    const r = proposeDistribution(students, hosts)
    expect(Object.keys(r.assignments)).toHaveLength(24)
    expect(r.projected).toEqual({ cpa: 30, ce1b: 30, ce2a: 30 })
    expect(checkDistribution(students, hosts, r.assignments)).toEqual([])
  })

  it('est déterministe', () => {
    expect(proposeDistribution(students, hosts)).toEqual(proposeDistribution(students, hosts))
  })

  it('respecte les exclusions et les capacités', () => {
    const r = proposeDistribution(
      [{ id: 'a', excludedHostIds: ['cpa'] }, { id: 'b' }],
      [
        { id: 'cpa', name: 'CP A', expected: 10 },
        { id: 'ce2a', name: 'CE2 A', expected: 25, capacity: 26 },
      ],
    )
    expect(r.assignments).toEqual({ a: 'ce2a', b: 'cpa' })
  })

  it('bloque si la capacité est insuffisante', () => {
    expect(() =>
      proposeDistribution([{ id: 'a' }, { id: 'b' }], [{ id: 'x', name: 'X', expected: 5, capacity: 6 }]),
    ).toThrow(DistributionError)
  })

  it('détecte un élève non affecté après correction manuelle', () => {
    expect(checkDistribution([{ id: 'a' }], hosts, {})).toEqual([{ type: 'UNASSIGNED', id: 'a' }])
  })
})

describe('appel ouvert directement (lot 7)', () => {
  const am = { halfDay: 'am' as const, id: 'matin' }
  const pm = { halfDay: 'pm' as const, id: 'apres-midi' }
  it('un seul appel à faire : il s’ouvre', () => {
    expect(callToOpen([pm], 'am')).toBe(pm)
  })
  it('matin et après-midi à faire : celui de la demi-journée en cours', () => {
    expect(callToOpen([am, pm], 'am')).toBe(am)
    expect(callToOpen([am, pm], 'pm')).toBe(pm)
  })
  it('plusieurs appels sur la même demi-journée : la liste', () => {
    expect(callToOpen([am, { ...am, id: 'autre' }], 'am')).toBeNull()
    expect(callToOpen([], 'am')).toBeNull()
  })
  it('demi-journée en cours à Paris', () => {
    expect(parisHalfDay(new Date('2026-11-18T10:59:00Z'))).toBe('am') // 11 h 59 à Paris
    expect(parisHalfDay(new Date('2026-11-18T11:00:00Z'))).toBe('pm')
  })
})
