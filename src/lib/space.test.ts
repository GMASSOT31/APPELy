import { describe, expect, it } from 'vitest'
import type { Me } from './api'
import { spaceFor } from './space'

const me = (memberships: Me['memberships'], isSuperadmin = false): Me => ({
  user: { id: 'u1', email: 'test@exemple.test', displayName: 'Test', isSuperadmin },
  memberships,
})
const m = (schoolId: string, role: 'direction' | 'enseignant' | 'remplacant') => ({
  schoolId, schoolName: 'École fictive', schoolStatus: 'active', role, activeTo: null,
})

describe('interface affichée en haut de l’écran', () => {
  it('Admin, Direction ou Enseignant selon la page', () => {
    const dir = me([m('A', 'direction')])
    expect(spaceFor('/admin', me([], true))).toBe('admin')
    expect(spaceFor('/ecole/A', dir)).toBe('direction')
    expect(spaceFor('/ecole/A/historique', dir)).toBe('direction')
    expect(spaceFor('/enseignant', me([m('A', 'enseignant')]))).toBe('enseignant')
  })

  it('écran d’appel : Direction pour la direction de l’école, Enseignant sinon (remplaçant compris)', () => {
    const url = '/appel/A/c1/2026-11-19/s1'
    expect(spaceFor(url, me([m('A', 'direction')]))).toBe('direction')
    expect(spaceFor(url, me([m('A', 'enseignant')]))).toBe('enseignant')
    expect(spaceFor(url, me([m('A', 'remplacant')]))).toBe('enseignant')
    // Direction d'une autre école mais enseignant ici : Enseignant.
    expect(spaceFor(url, me([m('B', 'direction'), m('A', 'enseignant')]))).toBe('enseignant')
  })

  it('rien quand on n’est pas connecté ou hors des interfaces', () => {
    expect(spaceFor('/ecole/A', null)).toBeNull()
    expect(spaceFor('/sans-acces', me([]))).toBeNull()
    expect(spaceFor('/confidentialite', me([m('A', 'direction')]))).toBeNull()
  })
})
