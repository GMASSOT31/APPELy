import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLOSED_WEEKDAYS,
  closureFor,
  dayMask,
  fullPattern,
  halfDayBit,
  isExpected,
  isValidDate,
  isoWeekday,
  levelRank,
} from './schedule'
import { buildPreview, guessMapping, nameKey, parseCsv } from './importRows'

describe('calendrier et présence attendue', () => {
  it('jour de la semaine sans fuseau horaire', () => {
    expect(isoWeekday('2026-11-16')).toBe(1) // lundi
    expect(isoWeekday('2026-11-22')).toBe(7) // dimanche
  })

  it('mercredi fermé par défaut, vacances prises en compte', () => {
    expect(closureFor('2026-11-18', DEFAULT_CLOSED_WEEKDAYS, [])).toBe('Pas de classe ce jour-là')
    expect(closureFor('2026-11-19', DEFAULT_CLOSED_WEEKDAYS, [])).toBeNull()
    const vac = [{ start_date: '2026-12-19', end_date: '2027-01-04', label: 'Vacances de Noël' }]
    expect(closureFor('2026-12-22', DEFAULT_CLOSED_WEEKDAYS, vac)).toBe('Vacances de Noël')
  })

  it('« même liste tous les jours » et emploi du temps daté', () => {
    const s = {
      id: 'e1',
      active_from: '2026-09-01',
      active_to: null,
      schedules: [{ valid_from: '2026-11-23', pattern: halfDayBit(1, 'am') }],
    }
    expect(isExpected(s, '2026-11-17', 'pm')).toBe(true) // avant le changement : tous les jours
    expect(isExpected(s, '2026-11-23', 'am')).toBe(true) // lundi matin
    expect(isExpected(s, '2026-11-23', 'pm')).toBe(false) // lundi après-midi
    expect(isExpected(s, '2026-11-24', 'am')).toBe(false) // mardi
  })

  it('arrivée et départ datés', () => {
    const s = { id: 'e2', active_from: '2026-11-20', active_to: '2026-12-01', schedules: [] }
    expect(isExpected(s, '2026-11-19', 'am')).toBe(false)
    expect(isExpected(s, '2026-11-20', 'am')).toBe(true)
    expect(isExpected(s, '2026-12-02', 'am')).toBe(false)
  })

  it('motif complet selon les jours ouverts', () => {
    expect(fullPattern(dayMask([3, 6, 7])) & halfDayBit(3, 'am')).toBe(0)
    expect(fullPattern(dayMask([3, 6, 7])) & halfDayBit(4, 'pm')).not.toBe(0)
  })

  it('validation des dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2028-02-29')).toBe(true)
  })

  it('tri des classes par niveau scolaire', () => {
    expect(levelRank(['CE1'])).toBeGreaterThan(levelRank(['CP']))
    expect(levelRank(['GS', 'CP'])).toBe(levelRank(['GS']))
  })
})

describe('import CSV', () => {
  it('séparateur point-virgule, guillemets, BOM, lignes vides', () => {
    const rows = parseCsv('﻿Prénom;Nom;Classe\r\n"Zoé";"Dupont; fils";CP A\r\n\r\nNoé;Durand;CP A\n')
    expect(rows).toEqual([
      ['Prénom', 'Nom', 'Classe'],
      ['Zoé', 'Dupont; fils', 'CP A'],
      ['Noé', 'Durand', 'CP A'],
    ])
  })

  it('séparateur virgule', () => {
    expect(parseCsv('prenom,nom\nA,B')).toEqual([
      ['prenom', 'nom'],
      ['A', 'B'],
    ])
  })

  it('détection des colonnes', () => {
    expect(guessMapping(['Nom', 'Prénom', 'Classe'])).toEqual({ firstName: 1, lastName: 0, className: 2 })
    expect(guessMapping(['Prénom'])).toEqual({ firstName: 0, lastName: null, className: null })
    expect(guessMapping(['A', 'B'])).toBeNull()
  })

  it('prévisualisation : ok, doublons, erreurs, nouvelle classe', () => {
    const preview = buildPreview(
      [
        ['Zoé', 'Dupont', 'CP A'],
        ['zoe', 'dupont', 'CP A'],
        ['', 'Sans prénom', 'CP A'],
        ['Noé', 'Durand', 'CE1 Z'],
        ['Lina', 'Bernard', 'CP A'],
      ],
      { firstName: 0, lastName: 1, className: 2 },
      { firstLine: 2, defaultClass: null, existing: [{ name: 'CP A', studentKeys: new Set([nameKey('Lina', 'Bernard')]) }] },
    )
    expect(preview.map((p) => [p.line, p.status, p.newClass ?? false])).toEqual([
      [2, 'ok', false],
      [3, 'duplicate', false],
      [4, 'error', false],
      [5, 'ok', true],
      [6, 'duplicate', false],
    ])
  })

  it('classe par défaut quand le fichier n’a pas de colonne classe', () => {
    const p = buildPreview([['Ali']], { firstName: 0, lastName: null, className: null }, { firstLine: 1, defaultClass: 'CM1 A', existing: [] })
    expect(p[0]).toMatchObject({ className: 'CM1 A', status: 'ok' })
  })
})
