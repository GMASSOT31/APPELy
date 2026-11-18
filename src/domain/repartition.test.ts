import { describe, expect, it } from 'vitest'
import { changedStudents, coverageOf, diffAssignments, expandAssignments, planSlots, rebalance, type AssignmentRow } from './repartition'
import { dayMask } from './schedule'

const WED_SAT_SUN = dayMask([3, 6, 7])

describe('lot 5 – demi-journées d’une répartition', () => {
  it('journée entière sur plusieurs jours, sans mercredi ni week-end ni fermeture', () => {
    // Lundi 23 → lundi 30 novembre 2026, avec un pont le vendredi 27.
    const s = planSlots('2026-11-23', '2026-11-30', 'day', WED_SAT_SUN, [{ start_date: '2026-11-27', end_date: '2026-11-27', label: 'Pont' }])
    expect(s.map((x) => `${x.date}:${x.half}`)).toEqual([
      '2026-11-23:am',
      '2026-11-23:pm',
      '2026-11-24:am',
      '2026-11-24:pm',
      '2026-11-26:am',
      '2026-11-26:pm',
      '2026-11-30:am',
      '2026-11-30:pm',
    ])
  })
  it('matin seulement ; journée fermée = aucune demi-journée', () => {
    expect(planSlots('2026-11-23', '2026-11-24', 'am', WED_SAT_SUN, []).map((x) => x.half)).toEqual(['am', 'am'])
    expect(planSlots('2026-11-25', '2026-11-25', 'day', WED_SAT_SUN, [])).toEqual([])
  })
})

describe('lot 5 – modifications sans écraser un appel confirmé', () => {
  const slots = planSlots('2026-11-23', '2026-11-23', 'day', WED_SAT_SUN, [])
  const current = expandAssignments({ e1: 'cp', e2: 'ce1b', e3: null }, slots).map((r, i) => ({ ...r, id: `r${i}` }))

  it('ne touche que les affectations qui changent', () => {
    const want = expandAssignments({ e1: 'cp', e2: 'ce2', e3: null }, slots)
    const d = diffAssignments(current, want, () => false)
    expect(d.end.map((r) => r.studentId)).toEqual(['e2', 'e2'])
    expect(d.insert).toEqual([
      { studentId: 'e2', hostClassId: 'ce2', date: '2026-11-23', half: 'am' },
      { studentId: 'e2', hostClassId: 'ce2', date: '2026-11-23', half: 'pm' },
    ])
    expect(d.frozenChanges).toBe(0)
  })

  it('un élève déjà compté le matin reste dans sa classe d’accueil ce matin-là', () => {
    const want = expandAssignments({ e1: 'ce2', e2: 'ce1b', e3: null }, slots)
    const counted = (r: AssignmentRow) => r.studentId === 'e1' && r.half === 'am'
    const d = diffAssignments(current, want, counted)
    expect(d.end.map((r) => `${r.studentId}:${r.half}`)).toEqual(['e1:pm'])
    expect(d.insert.map((r) => `${r.studentId}:${r.half}:${r.hostClassId}`)).toEqual(['e1:pm:ce2'])
    expect(d.frozenChanges).toBe(1)
  })

  it('annulation = tout terminer sauf ce qui est figé', () => {
    const d = diffAssignments(current, [], (r) => r.half === 'am')
    expect(d.end.every((r) => r.half === 'pm')).toBe(true)
    expect(d.end).toHaveLength(3)
    expect(d.insert).toEqual([])
  })

  it('liste des élèves déplacés', () => {
    expect(changedStudents({ a: 'x', b: 'y', c: null }, { a: 'x', b: 'z', c: 'x' })).toEqual([
      { studentId: 'b', from: 'y', to: 'z' },
      { studentId: 'c', from: null, to: 'x' },
    ])
  })
})

describe('lot 5 – équilibrage avec choix manuels conservés', () => {
  const hosts = [
    { id: 'cp', name: 'CP A', expected: 20 },
    { id: 'ce1b', name: 'CE1 B', expected: 24 },
    { id: 'ce2', name: 'CE2 A', expected: 22 },
  ]
  const students = Array.from({ length: 24 }, (_, i) => ({ id: `e${i}` }))

  it('les élèves épinglés comptent dans l’effectif projeté ; les absents connus ne sont pas répartis', () => {
    const pinned: Record<string, string | null> = { e0: 'ce1b', e1: 'ce1b', e2: null }
    const r = rebalance(students.filter((s) => s.id !== 'e2'), hosts, pinned)
    expect(r.assignments.e0).toBe('ce1b')
    expect(r.assignments.e2).toBeUndefined()
    expect(Object.keys(r.assignments)).toHaveLength(23)
    const totals = Object.values(r.projected)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
    expect(totals.reduce((a, b) => a + b, 0)).toBe(66 + 23)
  })

  it('même proposition à chaque relance (ordre stable)', () => {
    expect(rebalance(students, hosts, {})).toEqual(rebalance(students, hosts, {}))
  })
})

describe('lot 5 – couverture de la classe répartie', () => {
  it('confirmé = état saisi dans l’appel d’accueil validé, ou absent connu', () => {
    expect(
      coverageOf([
        { hostClassId: 'cp', category: 'PRESENT' },
        { hostClassId: 'cp', category: 'ABSENT' },
        { hostClassId: 'ce2', category: null },
        { hostClassId: null, category: null },
      ]),
    ).toEqual({ total: 4, confirmed: 3, present: 1, absent: 2, complete: false })
    expect(coverageOf([]).complete).toBe(false)
  })
})
