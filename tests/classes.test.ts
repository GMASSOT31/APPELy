// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/** Lot 2 : classes, élèves, présence attendue, créneaux, états, import. Données fictives. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupWorld, type Client } from './helpers'
import { dayMask, halfDayBit } from '../src/domain/schedule'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let B: { id: string; dir: Client }
const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
  B = await world.school('École B')
})
afterAll(() => world.proxy.dispose())

const url = (s: string, p = '') => `/api/schools/${s}${p}`

describe('classes', () => {
  it('création, niveaux, regroupement par niveau et créneau par défaut', async () => {
    expect((await A.dir.post(url(A.id, '/classes'), { name: 'CE1 A', levels: ['CE1'] })).status).toBe(201)
    expect((await A.dir.post(url(A.id, '/classes'), { name: 'CP A', levels: ['CP'] })).status).toBe(201)
    expect((await A.dir.post(url(A.id, '/classes'), { name: 'GS-CP', levels: ['CP', 'GS'] })).status).toBe(201)
    const o = (await A.dir.get(url(A.id, '/overview'))).data
    expect(o.classes.map((c: any) => c.name)).toEqual(['GS-CP', 'CP A', 'CE1 A'])
    expect(o.classes[0].levels).toEqual(['GS', 'CP'])
    const cp = o.classes[1]
    const detail = (await A.dir.get(url(A.id, `/classes/${cp.id}`))).data
    expect(detail.slots).toEqual([expect.objectContaining({ name: 'Appel du matin', half_day: 'am', weekdays: dayMask([1, 2, 4, 5]) })])
  })

  it('refuse un nom en double et des niveaux invalides', async () => {
    expect((await A.dir.post(url(A.id, '/classes'), { name: 'cp a', levels: ['CP'] })).data.error.code).toBe('CLASS_EXISTS')
    expect((await A.dir.post(url(A.id, '/classes'), { name: 'X', levels: ['6e'] })).data.error.code).toBe('INVALID_LEVELS')
  })

  it('archivage refusé tant que la classe a des élèves', async () => {
    const r = await A.dir.post(url(A.id, '/classes'), { name: 'Temporaire', levels: ['CM1'] })
    await A.dir.post(url(A.id, `/classes/${r.data.id}/students`), { firstName: 'Élève' })
    expect((await A.dir.post(url(A.id, `/classes/${r.data.id}/archive`))).data.error.code).toBe('CLASS_NOT_EMPTY')
  })
})

describe('élèves et présence attendue', () => {
  let classId: string
  let studentId: string
  beforeAll(async () => {
    classId = (await A.dir.post(url(A.id, '/classes'), { name: 'CM2 A', levels: ['CM2'] })).data.id
    studentId = (await A.dir.post(url(A.id, `/classes/${classId}/students`), { firstName: 'Léa', lastName: 'Martin' })).data.id
  })

  it('doublon refusé (accents et casse ignorés)', async () => {
    expect((await A.dir.post(url(A.id, `/classes/${classId}/students`), { firstName: 'LEA', lastName: 'martin' })).data.error.code).toBe(
      'DUPLICATE_STUDENT',
    )
  })

  it('emploi du temps daté : nouvelle version sans réécrire le passé', async () => {
    const pattern = halfDayBit(1, 'am') | halfDayBit(2, 'am')
    expect((await A.dir.post(url(A.id, `/students/${studentId}/schedule`), { pattern, validFrom: tomorrow })).status).toBe(200)
    expect((await A.dir.post(url(A.id, `/students/${studentId}/schedule`), { pattern, validFrom: '2020-01-01' })).data.error.code).toBe(
      'PAST_DATE',
    )
    const s = (await A.dir.get(url(A.id, `/classes/${classId}`))).data.students[0]
    expect(s.pattern).toBeNull() // aujourd'hui : toujours « tous les jours »
    expect(s.upcoming).toEqual([{ validFrom: tomorrow, pattern }])
  })

  it('« même liste tous les jours » pour toute la classe', async () => {
    expect((await A.dir.post(url(A.id, `/classes/${classId}/schedule`), { pattern: null, validFrom: tomorrow })).status).toBe(200)
    const s = (await A.dir.get(url(A.id, `/classes/${classId}`))).data.students[0]
    expect(s.upcoming).toEqual([{ validFrom: tomorrow, pattern: null }])
  })

  it('changement de classe et départ', async () => {
    const other = (await A.dir.post(url(A.id, '/classes'), { name: 'CM2 B', levels: ['CM2'] })).data.id
    expect((await A.dir.post(url(A.id, `/students/${studentId}`), { firstName: 'Léa', lastName: 'Martin', classId: other })).status).toBe(200)
    expect((await A.dir.get(url(A.id, `/classes/${other}`))).data.students).toHaveLength(1)
    expect((await A.dir.post(url(A.id, `/students/${studentId}/leave`), { date: tomorrow })).status).toBe(200)
    expect((await A.dir.get(url(A.id, `/classes/${other}`))).data.students).toHaveLength(0)
  })
})

describe('enseignants affectés', () => {
  it('l’enseignant voit sa classe, pas les autres, et ne peut rien configurer', async () => {
    const t = await world.member(A.id, A.dir, 'enseignant')
    const classId = (await A.dir.post(url(A.id, '/classes'), { name: 'CE2 A', levels: ['CE2'] })).data.id
    expect((await A.dir.post(url(A.id, `/classes/${classId}/teachers`), { membershipId: t.membershipId })).status).toBe(201)
    expect((await A.dir.post(url(A.id, `/classes/${classId}/teachers`), { membershipId: t.membershipId })).data.error.code).toBe('ALREADY_ASSIGNED')
    const mine = (await t.client.get(url(A.id, '/my-classes'))).data.classes
    expect(mine.map((c: any) => c.name)).toEqual(['CE2 A'])
    expect((await t.client.get(url(A.id, `/classes/${classId}`))).status).toBe(403)
    expect((await t.client.post(url(A.id, '/classes'), { name: 'Pirate', levels: ['CP'] })).status).toBe(403)
    expect((await t.client.post(url(A.id, `/classes/${classId}/students`), { firstName: 'X' })).status).toBe(403)
  })
})

describe('créneaux d’appel', () => {
  it('ajout d’un appel l’après-midi, modification, suppression', async () => {
    const classId = (await A.dir.post(url(A.id, '/classes'), { name: 'MS A', levels: ['MS'] })).data.id
    const r = await A.dir.post(url(A.id, `/classes/${classId}/slots`), { name: 'Appel de l’après-midi', halfDay: 'pm', weekdays: dayMask([1, 2, 4, 5]), dueTime: '13:45' })
    expect(r.status).toBe(201)
    expect((await A.dir.post(url(A.id, `/classes/${classId}/slots/${r.data.id}`), { name: 'Après-midi', halfDay: 'pm', weekdays: dayMask([1, 4]), dueTime: '25:00' })).data.error.code).toBe('INVALID_TIME')
    expect((await A.dir.post(url(A.id, `/classes/${classId}/slots/${r.data.id}/archive`))).status).toBe(200)
    expect((await A.dir.get(url(A.id, `/classes/${classId}`))).data.slots).toHaveLength(1)
  })
})

describe('états d’appel personnalisés', () => {
  it('Présent / Absent par défaut, ajout d’un état, ordre, garde-fous', async () => {
    let s = (await A.dir.get(url(A.id, '/settings'))).data
    expect(s.statuses.map((x: any) => [x.label, x.category])).toEqual([['Présent', 'PRESENT'], ['Absent', 'ABSENT']])
    expect(s.closedWeekdays).toBe(dayMask([3, 6, 7]))
    const cantine = await A.dir.post(url(A.id, '/statuses'), { label: 'Présent cantine', color: 'primary', category: 'PRESENT' })
    expect(cantine.status).toBe(201)
    expect((await A.dir.post(url(A.id, '/statuses'), { label: 'Sans catégorie', color: 'primary' })).data.error.code).toBe('INVALID_CATEGORY')
    await A.dir.post(url(A.id, `/statuses/${cantine.data.id}/move`), { direction: 'up' })
    s = (await A.dir.get(url(A.id, '/settings'))).data
    expect(s.statuses.map((x: any) => x.label)).toEqual(['Présent', 'Présent cantine', 'Absent'])
    const absent = s.statuses.find((x: any) => x.label === 'Absent')
    expect((await A.dir.post(url(A.id, `/statuses/${absent.id}/archive`))).data.error.code).toBe('STATUS_COVERAGE')
    expect((await A.dir.post(url(A.id, `/statuses/${cantine.data.id}/archive`))).status).toBe(200)
  })

  it('jours sans classe et fermetures', async () => {
    expect((await A.dir.post(url(A.id, '/settings/weekdays'), { closedWeekdays: dayMask([6, 7]) })).status).toBe(200)
    const c = await A.dir.post(url(A.id, '/closures'), { label: 'Vacances', startDate: tomorrow, endDate: tomorrow })
    expect(c.status).toBe(201)
    let s = (await A.dir.get(url(A.id, '/settings'))).data
    expect(s.closedWeekdays).toBe(dayMask([6, 7]))
    expect(s.closures).toHaveLength(1)
    await A.dir.post(url(A.id, `/closures/${c.data.id}/delete`))
    s = (await A.dir.get(url(A.id, '/settings'))).data
    expect(s.closures).toHaveLength(0)
  })
})

describe('P2 – import d’élèves', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ firstName: `Prénom${i + 1}`, lastName: `Nom${i + 1}`, className: 'CE2 B' }))

  it('import de 25 élèves avec création de la classe, puis annulation', async () => {
    const r = await A.dir.post(url(A.id, '/imports'), { rows, classLevels: { 'CE2 B': ['CE2'] } })
    expect(r.status).toBe(201)
    expect(r.data.students).toBe(25)
    expect(r.data.classesCreated).toEqual([expect.objectContaining({ name: 'CE2 B', levels: ['CE2'] })])
    const classId = r.data.classesCreated[0].id
    const detail = (await A.dir.get(url(A.id, `/classes/${classId}`))).data
    expect(detail.students).toHaveLength(25)
    expect(detail.slots).toHaveLength(1)
    // Un nouvel import identique est refusé (doublons).
    expect((await A.dir.post(url(A.id, '/imports'), { rows })).data.error.code).toBe('DUPLICATES')
    expect((await A.dir.post(url(A.id, `/imports/${r.data.importId}/cancel`))).status).toBe(200)
    expect((await A.dir.get(url(A.id, `/classes/${classId}`))).status).toBe(404)
    expect((await A.dir.post(url(A.id, `/imports/${r.data.importId}/cancel`))).status).toBe(404)
  })

  it('doublons à l’intérieur du fichier et lignes invalides refusés', async () => {
    expect((await A.dir.post(url(A.id, '/imports'), { rows: [rows[0], { ...rows[0], firstName: 'prénom1' }] })).data.error.code).toBe('DUPLICATES')
    expect((await A.dir.post(url(A.id, '/imports'), { rows: [{ firstName: '', className: 'X' }] })).data.error.code).toBe('INVALID_ROW')
  })
})

describe('P11 – isolation entre écoles (lot 2)', () => {
  it('la direction B ne lit ni ne modifie les classes, élèves, états de A', async () => {
    const o = (await A.dir.get(url(A.id, '/overview'))).data
    const cls = o.classes[0]
    const statuses = (await A.dir.get(url(A.id, '/settings'))).data.statuses

    expect((await B.dir.get(url(A.id, '/overview'))).status).toBe(403)
    expect((await B.dir.get(url(A.id, `/classes/${cls.id}`))).status).toBe(403)
    // Avec l'identifiant de son école mais un objet de l'école A : introuvable.
    expect((await B.dir.get(url(B.id, `/classes/${cls.id}`))).status).toBe(404)
    expect((await B.dir.post(url(B.id, `/classes/${cls.id}`), { name: 'Volée', levels: ['CP'] })).status).toBe(404)
    expect((await B.dir.post(url(B.id, `/classes/${cls.id}/students`), { firstName: 'Intrus' })).status).toBe(404)
    const aStudent = (await A.dir.post(url(A.id, `/classes/${cls.id}/students`), { firstName: 'Sami' })).data.id
    expect(aStudent).toBeTruthy()
    expect((await B.dir.post(url(B.id, `/students/${aStudent}`), { firstName: 'X' })).status).toBe(404)
    expect((await B.dir.post(url(B.id, `/students/${aStudent}/leave`), {})).status).toBe(404)
    expect((await B.dir.post(url(B.id, `/students/${aStudent}/schedule`), { pattern: null })).status).toBe(404)
    expect((await B.dir.post(url(B.id, `/statuses/${statuses[0].id}/archive`))).status).toBe(404)
    // Une classe de B ne peut pas recevoir un élève déplacé depuis A, ni l'inverse.
    const bClass = (await B.dir.post(url(B.id, '/classes'), { name: 'CP B', levels: ['CP'] })).data.id
    expect((await A.dir.post(url(A.id, `/students/${aStudent}`), { firstName: 'Sami', classId: bClass })).status).toBe(404)
    // Un enseignant de B ne peut pas être affecté à une classe de A.
    const tB = await world.member(B.id, B.dir, 'enseignant')
    expect((await A.dir.post(url(A.id, `/classes/${cls.id}/teachers`), { membershipId: tB.membershipId })).status).toBe(404)
  })
})
