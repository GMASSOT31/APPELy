// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/** Lot 4 : tableau de bord Direction, relances, messages ciblés, absences prévues, historique. Données fictives. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupWorld, type Client } from './helpers'
import { schoolToday } from '../worker/routes/calls'
import { dayMask, isoWeekday } from '../src/domain/schedule'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let B: { id: string; dir: Client }
let t1: { client: Client; membershipId: string; userId: string }
let t2: { client: Client; membershipId: string; userId: string }
let ce1: string
let cp: string
let ce1Slot: string
let cpSlot: string
let bClass: string
let statuses: { present: string; absent: string }
let ce1Students: { id: string; firstName: string }[]
let cpStudents: { id: string; firstName: string }[]

const today = schoolToday()
// Date d'appel : aujourd'hui, ou samedi si l'on est dimanche (pas de créneau le dimanche).
const date = isoWeekday(today) === 7 ? new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10) : today
const isToday = date === today
const ALL_DAYS = dayMask([1, 2, 3, 4, 5, 6])
const url = (s: string, p = '') => `/api/schools/${s}${p}`
const callUrl = (c: string, sl: string, d = date) => url(A.id, `/classes/${c}/calls/${d}/${sl}`)
let rid = 0
const requestId = () => `req-${Date.now()}-${rid++}`
const dashboard = async (c: Client = A.dir) => (await c.get(url(A.id, `/dashboard?date=${date}`))).data
const rowOf = (d: any, classId: string) => d.rows.find((r: any) => r.classId === classId)

async function member(role: string) {
  const m = await world.member(A.id, A.dir, role)
  const me = (await m.client.get('/api/me')).data
  return { ...m, userId: me.user.id as string }
}

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
  B = await world.school('École B')
  await A.dir.post(url(A.id, '/settings/weekdays'), { closedWeekdays: 0 })
  const rows = [
    ...Array.from({ length: 25 }, (_, i) => ({ firstName: `Élève${String(i + 1).padStart(2, '0')}`, className: 'CE1 A' })),
    ...Array.from({ length: 20 }, (_, i) => ({ firstName: `Enfant${String(i + 1).padStart(2, '0')}`, className: 'CP A' })),
  ]
  const imp = await A.dir.post(url(A.id, '/imports'), { rows, classLevels: { 'CE1 A': ['CE1'], 'CP A': ['CP'] } })
  ce1 = imp.data.classesCreated.find((c: any) => c.name === 'CE1 A').id
  cp = imp.data.classesCreated.find((c: any) => c.name === 'CP A').id
  // Élèves, classes et créneaux existent depuis longtemps (pour l'historique).
  await world.env.DB.batch([
    world.env.DB.prepare(`UPDATE students SET active_from = '2026-01-01'`),
    world.env.DB.prepare(`UPDATE classes SET created_at = '2026-01-01T00:00:00.000Z'`),
  ])
  const d1 = (await A.dir.get(url(A.id, `/classes/${ce1}`))).data
  const d2 = (await A.dir.get(url(A.id, `/classes/${cp}`))).data
  ce1Students = d1.students
  cpStudents = d2.students
  ce1Slot = d1.slots[0].id
  cpSlot = d2.slots[0].id
  // CE1 : heure limite dépassée (minuit) ; CP : heure limite en fin de journée.
  await A.dir.post(url(A.id, `/classes/${ce1}/slots/${ce1Slot}`), { name: 'Appel du matin', halfDay: 'am', weekdays: ALL_DAYS, dueTime: '00:00' })
  await A.dir.post(url(A.id, `/classes/${cp}/slots/${cpSlot}`), { name: 'Appel du matin', halfDay: 'am', weekdays: ALL_DAYS, dueTime: '23:59' })
  await world.env.DB.prepare(`UPDATE call_slots SET created_at = '2026-01-01T00:00:00.000Z'`).run()
  const st = (await A.dir.get(url(A.id, '/settings'))).data.statuses
  statuses = { present: st.find((s: any) => s.category === 'PRESENT').id, absent: st.find((s: any) => s.category === 'ABSENT').id }
  t1 = await member('enseignant')
  t2 = await member('enseignant')
  await A.dir.post(url(A.id, `/classes/${ce1}/teachers`), { membershipId: t1.membershipId })
  await A.dir.post(url(A.id, `/classes/${cp}/teachers`), { membershipId: t2.membershipId })
  bClass = (await B.dir.post(url(B.id, '/classes'), { name: 'CE1 B', levels: ['CE1'] })).data.id
})
afterAll(() => world.proxy.dispose())

describe('P5 – tableau de bord « Aujourd’hui »', () => {
  it('liste chaque classe et créneau avec état, enseignant et effectif attendu', async () => {
    const d = await dashboard()
    expect(d.date).toBe(date)
    expect(d.closure).toBeNull()
    expect(d.activeDistributions).toBe(0)
    expect(d.rows.map((r: any) => r.className)).toEqual(['CP A', 'CE1 A']) // ordre scolaire des niveaux
    const r = rowOf(d, ce1)
    expect(r).toMatchObject({ tab: 'am', expected: 25, counts: null, validatedAt: null, teachers: [expect.stringMatching(/Personne/)] })
    expect(r.state).toBe('late') // heure limite dépassée (ou jour passé)
    expect(rowOf(d, cp).state).toBe(isToday ? 'pending' : 'late')
  })

  it('un appel validé apparaît immédiatement, avec effectifs et aperçu des absents', async () => {
    const entries = Object.fromEntries(ce1Students.map((s) => [s.id, statuses.present]))
    entries[ce1Students[3].id] = statuses.absent
    entries[ce1Students[9].id] = statuses.absent
    const v = await t1.client.post(callUrl(ce1, ce1Slot) + '/validate', { baseVersion: 0, requestId: requestId(), entries })
    expect(v.status).toBe(200)
    const r = rowOf(await dashboard(), ce1)
    expect(r).toMatchObject({ state: 'validated', expected: 25, counts: { present: 23, absent: 2, other: 0 }, corrected: false })
    expect(r.validatedBy).toMatch(/Personne/)
    expect(r.absentees.map((a: any) => a.name)).toEqual([ce1Students[3].firstName, ce1Students[9].firstName])
  })

  it('créneaux supplémentaires : onglet « Autres créneaux »', async () => {
    const s = await A.dir.post(url(A.id, `/classes/${cp}/slots`), { name: 'Cantine', halfDay: 'am', weekdays: ALL_DAYS, dueTime: '11:30' })
    const pm = await A.dir.post(url(A.id, `/classes/${cp}/slots`), { name: 'Après-midi', halfDay: 'pm', weekdays: ALL_DAYS, dueTime: '14:00' })
    const d = await dashboard()
    const tabs = Object.fromEntries(d.rows.filter((r: any) => r.classId === cp).map((r: any) => [r.slot.name, r.tab]))
    expect(tabs).toEqual({ 'Appel du matin': 'am', Cantine: 'other', 'Après-midi': 'pm' })
    await A.dir.post(url(A.id, `/classes/${cp}/slots/${s.data.id}/archive`))
    await A.dir.post(url(A.id, `/classes/${cp}/slots/${pm.data.id}/archive`))
  })

  it('jour de fermeture : aucune ligne, motif affiché', async () => {
    await A.dir.post(url(A.id, '/closures'), { label: 'Pont de l’Ascension', startDate: '2026-05-15', endDate: '2026-05-15' })
    const d = (await A.dir.get(url(A.id, '/dashboard?date=2026-05-15'))).data
    expect(d).toMatchObject({ closure: 'Pont de l’Ascension', rows: [] })
  })

  it('réservé à la direction de l’école', async () => {
    expect((await t1.client.get(url(A.id, '/dashboard'))).status).toBe(403)
    expect((await B.dir.get(url(A.id, '/dashboard'))).status).toBe(403)
    expect((await A.dir.get(url(A.id, '/dashboard?date=2026-02-30'))).status).toBe(400)
  })
})

describe('relance de l’enseignant', () => {
  it.runIf(isToday)('la direction relance un appel non fait : l’enseignant le voit', async () => {
    const r = await A.dir.post(callUrl(cp, cpSlot) + '/remind')
    expect(r.status).toBe(200)
    const again = await A.dir.post(callUrl(cp, cpSlot) + '/remind')
    expect(again.data).toMatchObject({ repeat: true, remindedAt: r.data.remindedAt }) // pas de relance en rafale
    const day = (await t2.client.get(url(A.id, '/my-day'))).data
    expect(day.classes[0].slots[0].remindedAt).toBe(r.data.remindedAt)
    expect((await t2.client.get(callUrl(cp, cpSlot))).data.remindedAt).toBe(r.data.remindedAt)
    expect(rowOf(await dashboard(), cp).remindedAt).toBe(r.data.remindedAt)
    // L'autre enseignant n'est pas concerné.
    expect((await t1.client.get(url(A.id, '/my-day'))).data.classes[0].slots[0].remindedAt).toBeNull()
  })

  it.runIf(isToday)('appel déjà validé : pas de relance', async () => {
    expect((await A.dir.post(callUrl(ce1, ce1Slot) + '/remind')).data.error.code).toBe('ALREADY_DONE')
  })

  it('seulement pour les appels du jour, par la direction de l’école', async () => {
    expect((await A.dir.post(callUrl(cp, cpSlot, '2026-03-02') + '/remind')).data.error.code).toBe('NOT_TODAY')
    expect((await t1.client.post(callUrl(cp, cpSlot, today) + '/remind')).status).toBe(403)
    expect((await B.dir.post(callUrl(cp, cpSlot, today) + '/remind')).status).toBe(403)
    // Classe de l'école A demandée via l'école B : introuvable.
    expect((await B.dir.post(url(B.id, `/classes/${cp}/calls/${today}/${cpSlot}/remind`))).status).toBe(404)
  })
})

describe('messages ciblés (§8.2)', () => {
  let schoolMsg: string
  it('école entière, niveau, sélection de classes : chacun voit ce qui le concerne', async () => {
    schoolMsg = (await A.dir.post(url(A.id, '/messages'), { body: 'Exercice incendie à 10 h', targetKind: 'school', startDate: date, endDate: today })).data.id
    await A.dir.post(url(A.id, '/messages'), { body: 'Photo de classe des CE1', targetKind: 'levels', targets: ['CE1'], priority: 'important', startDate: date, endDate: today })
    await A.dir.post(url(A.id, '/messages'), { body: 'Sortie piscine du CP', targetKind: 'classes', targets: [cp], startDate: date, endDate: today })
    await A.dir.post(url(A.id, '/messages'), { body: 'Message de la semaine prochaine', targetKind: 'school', startDate: '2099-01-05', endDate: '2099-01-09' })
    const ce1Call = (await t1.client.get(callUrl(ce1, ce1Slot))).data
    expect(ce1Call.messages.map((m: any) => m.body)).toEqual(['Photo de classe des CE1', 'Exercice incendie à 10 h']) // important d'abord
    const cpCall = (await t2.client.get(callUrl(cp, cpSlot))).data
    expect(cpCall.messages.map((m: any) => m.body).sort()).toEqual(['Exercice incendie à 10 h', 'Sortie piscine du CP'])
    const day = (await t1.client.get(url(A.id, '/my-day'))).data
    expect(day.messages.map((m: any) => m.body)).toEqual(['Photo de classe des CE1', 'Exercice incendie à 10 h'])
    expect(day.messages[0].classes).toEqual(['CE1 A'])
    const list = (await A.dir.get(url(A.id, '/messages'))).data.messages
    expect(list.map((m: any) => m.scope).sort()).toEqual(['CE1', 'CP A', 'Toute l’école', 'Toute l’école'])
    expect(list.find((m: any) => m.startDate === '2099-01-05').state).toBe('upcoming')
  })

  it('un message retiré n’est plus affiché', async () => {
    expect((await A.dir.post(url(A.id, `/messages/${schoolMsg}/archive`))).status).toBe(200)
    const ce1Call = (await t1.client.get(callUrl(ce1, ce1Slot))).data
    expect(ce1Call.messages.map((m: any) => m.body)).toEqual(['Photo de classe des CE1'])
  })

  it('saisies invalides refusées', async () => {
    const post = (b: object) => A.dir.post(url(A.id, '/messages'), { targetKind: 'school', body: 'Bonjour', ...b })
    expect((await post({ body: '   ' })).status).toBe(400)
    expect((await post({ body: 'x'.repeat(501) })).status).toBe(400)
    expect((await post({ startDate: '2099-01-10', endDate: '2099-01-05' })).status).toBe(400)
    expect((await post({ startDate: '2020-01-01', endDate: '2020-01-02' })).status).toBe(400)
    expect((await post({ targetKind: 'levels', targets: ['CE7'] })).status).toBe(400)
    expect((await post({ targetKind: 'classes', targets: [] })).status).toBe(400)
  })

  it('cloisonnement : classe d’une autre école, message d’une autre école, enseignant', async () => {
    expect((await A.dir.post(url(A.id, '/messages'), { body: 'Intrus', targetKind: 'classes', targets: [bClass] })).data.error.code).toBe('INVALID_TARGET')
    expect((await B.dir.post(url(A.id, '/messages'), { body: 'Intrus', targetKind: 'school' })).status).toBe(403)
    expect((await B.dir.get(url(A.id, '/messages'))).status).toBe(403)
    const aMsg = (await A.dir.get(url(A.id, '/messages'))).data.messages[0].id
    expect((await B.dir.post(url(B.id, `/messages/${aMsg}/archive`))).status).toBe(404)
    expect((await t1.client.post(url(A.id, '/messages'), { body: 'Hello', targetKind: 'school' })).status).toBe(403)
    expect((await t1.client.post(url(A.id, `/messages/${aMsg}/archive`))).status).toBe(403)
    // Les messages de l'école A ne s'affichent jamais dans l'école B.
    const bSlot = (await B.dir.get(url(B.id, `/classes/${bClass}`))).data.slots[0].id
    const bCall = (await B.dir.get(url(B.id, `/classes/${bClass}/calls/${date}/${bSlot}`))).data
    expect(bCall.messages).toEqual([])
  })
})

describe('absences prévues (§8.3)', () => {
  let absId: string
  it('la direction enregistre une absence : élève prépositionné Absent, « à vérifier »', async () => {
    const r = await A.dir.post(url(A.id, '/absences'), {
      studentId: cpStudents[4].id,
      startDate: date,
      endDate: today,
      halfDays: 'day',
      reason: 'Raison familiale',
    })
    expect(r.status).toBe(201)
    absId = r.data.id
    const call = (await t2.client.get(callUrl(cp, cpSlot))).data
    expect(call.plannedAbsences).toEqual({ [cpStudents[4].id]: 'Raison familiale' })
    expect(call.call).toBeNull() // rien n'est validé : la présence constatée reste à vérifier
    expect(rowOf(await dashboard(), cp).plannedAbsences).toBe(1)
  })

  it('une absence l’après-midi ne concerne pas l’appel du matin', async () => {
    await A.dir.post(url(A.id, '/absences'), { studentId: cpStudents[5].id, startDate: date, endDate: today, halfDays: 'pm', reason: 'Rendez-vous' })
    const call = (await t2.client.get(callUrl(cp, cpSlot))).data
    expect(Object.keys(call.plannedAbsences)).toEqual([cpStudents[4].id])
  })

  it('la présence constatée prime : l’élève peut être validé présent', async () => {
    const entries = Object.fromEntries(cpStudents.map((s) => [s.id, statuses.present]))
    const v = await t2.client.post(callUrl(cp, cpSlot) + '/validate', { baseVersion: 0, requestId: requestId(), entries })
    expect(v.status).toBe(200)
    const call = (await t2.client.get(callUrl(cp, cpSlot))).data
    expect(call.call.entries[cpStudents[4].id]).toBe(statuses.present)
  })

  it('enseignant habilité : seulement pour les élèves de ses classes', async () => {
    const ok = await t1.client.post(url(A.id, '/absences'), { studentId: ce1Students[0].id, startDate: today, halfDays: 'am', reason: 'Voyage' })
    expect(ok.status).toBe(201)
    expect((await t1.client.post(url(A.id, '/absences'), { studentId: cpStudents[0].id, startDate: today, reason: 'Voyage' })).status).toBe(403)
    expect((await t1.client.post(url(A.id, `/absences/${absId}/cancel`))).status).toBe(403)
    const mine = (await t1.client.get(url(A.id, '/absences'))).data
    expect(mine.classes.map((c: any) => c.name)).toEqual(['CE1 A'])
    expect(mine.absences.map((a: any) => a.studentId)).toEqual([ce1Students[0].id])
    expect((await A.dir.get(url(A.id, '/absences'))).data.absences).toHaveLength(3)
  })

  it('motif libre, dates passées ou incohérentes refusés', async () => {
    const post = (b: object) => A.dir.post(url(A.id, '/absences'), { studentId: cpStudents[1].id, startDate: today, reason: 'Rendez-vous', ...b })
    expect((await post({ reason: 'Rendez-vous chez le médecin' })).data.error.code).toBe('INVALID_REASON')
    expect((await post({ startDate: '2020-01-01', endDate: '2020-01-02' })).status).toBe(400)
    expect((await post({ startDate: '2099-01-10', endDate: '2099-01-05' })).status).toBe(400)
    expect((await post({ halfDays: 'soir' })).status).toBe(400)
  })

  it('annulation : l’absence ne prépositionne plus l’élève', async () => {
    expect((await A.dir.post(url(A.id, `/absences/${absId}/cancel`))).status).toBe(200)
    expect((await A.dir.post(url(A.id, `/absences/${absId}/cancel`))).status).toBe(404)
    expect((await A.dir.get(url(A.id, '/absences'))).data.absences.map((a: any) => a.id)).not.toContain(absId)
  })

  it('cloisonnement : élève ou absence d’une autre école', async () => {
    expect((await B.dir.post(url(B.id, '/absences'), { studentId: cpStudents[1].id, startDate: today, reason: 'Voyage' })).status).toBe(404)
    expect((await B.dir.post(url(A.id, '/absences'), { studentId: cpStudents[1].id, startDate: today, reason: 'Voyage' })).status).toBe(403)
    expect((await B.dir.get(url(A.id, '/absences'))).status).toBe(403)
    const a = (await A.dir.get(url(A.id, '/absences'))).data.absences[0].id
    expect((await B.dir.post(url(B.id, `/absences/${a}/cancel`))).status).toBe(404)
    expect((await B.dir.get(url(B.id, '/absences'))).data.absences).toEqual([])
  })
})

describe('historique (§9)', () => {
  const from = new Date(Date.parse(date) - 10 * 86400_000).toISOString().slice(0, 10)
  it('appels faits et non faits, filtrables par classe, personne et état', async () => {
    // Correction d'un appel du CE1 pour avoir l'état « corrigé ».
    const c = (await A.dir.get(callUrl(ce1, ce1Slot))).data
    const entries = { ...c.call.entries, [ce1Students[3].id]: statuses.present }
    await A.dir.post(callUrl(ce1, ce1Slot) + '/validate', { baseVersion: 1, requestId: requestId(), entries, reason: 'Arrivé en retard' })
    const end = date
    const get = async (q = '') => (await A.dir.get(url(A.id, `/history?from=${from}&to=${end}${q}`))).data
    const all = await get()
    const atDate = all.rows.filter((r: any) => r.date === date)
    expect(atDate.map((r: any) => [r.className, r.state])).toEqual([
      ['CP A', 'validated'],
      ['CE1 A', 'corrected'],
    ])
    expect(all.rows.filter((r: any) => r.state === 'missing').length).toBeGreaterThan(0)
    expect(all.rows.every((r: any) => r.date >= from && r.date <= end)).toBe(true)
    expect(all.rows.find((r: any) => r.state === 'corrected')).toMatchObject({ version: 2, counts: { present: 24, absent: 1, other: 0 } })
    expect((await get(`&classId=${cp}`)).rows.every((r: any) => r.classId === cp)).toBe(true)
    expect((await get('&state=missing')).rows.every((r: any) => r.state === 'missing')).toBe(true)
    // Par personne : t1 a validé le CE1 (corrigé ensuite par la direction), t2 a validé le CP.
    expect((await get(`&userId=${t1.userId}`)).rows.map((r: any) => r.className)).toEqual(['CE1 A'])
    expect((await get(`&userId=${t2.userId}`)).rows.map((r: any) => r.className)).toEqual(['CP A'])
    expect(all.people.map((p: any) => p.id)).toEqual(expect.arrayContaining([t1.userId, t2.userId]))
  })

  it('période trop longue ou dates invalides refusées', async () => {
    expect((await A.dir.get(url(A.id, '/history?from=2026-01-01&to=2026-06-01'))).data.error.code).toBe('RANGE_TOO_LONG')
    expect((await A.dir.get(url(A.id, '/history?from=2026-03-10&to=2026-03-01'))).status).toBe(400)
    expect((await A.dir.get(url(A.id, '/history?state=inconnu'))).status).toBe(400)
  })

  it('réservé à la direction de l’école', async () => {
    expect((await t1.client.get(url(A.id, '/history'))).status).toBe(403)
    expect((await B.dir.get(url(A.id, '/history'))).status).toBe(403)
    expect((await B.dir.get(url(B.id, '/history'))).data.rows).toEqual([])
  })
})
