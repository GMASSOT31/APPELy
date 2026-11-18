// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/** Lot 3 : appel enseignant (P4, P9 et cas particuliers du §6). Données fictives. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupWorld, type Client } from './helpers'
import { schoolToday } from '../worker/routes/calls'
import { dayMask, isoWeekday } from '../src/domain/schedule'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let B: { id: string; dir: Client }
let teacher: { client: Client; membershipId: string }
let classId: string
let slotId: string
let statuses: { present: string; absent: string }
let students: { id: string; firstName: string }[]
let importId: string

// Date d'appel : aujourd'hui (heure de Paris), ou samedi si l'on est dimanche.
const today = schoolToday()
const date = isoWeekday(today) === 7 ? new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10) : today
const ALL_DAYS = dayMask([1, 2, 3, 4, 5, 6])
const url = (s: string, p = '') => `/api/schools/${s}${p}`
const callUrl = (d = date, c = () => classId, sl = () => slotId) => url(A.id, `/classes/${c()}/calls/${d}/${sl()}`)
let rid = 0
const requestId = () => `req-${Date.now()}-${rid++}`

function allPresent(extra: Record<string, string> = {}) {
  return { ...Object.fromEntries(students.map((s) => [s.id, statuses.present])), ...extra }
}

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
  B = await world.school('École B')
  await A.dir.post(url(A.id, '/settings/weekdays'), { closedWeekdays: 0 })
  const rows = Array.from({ length: 25 }, (_, i) => ({ firstName: `Élève${String(i + 1).padStart(2, '0')}`, className: 'CE1 A' }))
  const imp = await A.dir.post(url(A.id, '/imports'), { rows, classLevels: { 'CE1 A': ['CE1'] } })
  importId = imp.data.importId
  classId = imp.data.classesCreated[0].id
  // Les élèves sont inscrits depuis longtemps (l'import les inscrit à partir d'aujourd'hui).
  await world.env.DB.prepare(`UPDATE students SET active_from = '2026-01-01'`).run()
  const detail = (await A.dir.get(url(A.id, `/classes/${classId}`))).data
  students = detail.students
  slotId = detail.slots[0].id
  await A.dir.post(url(A.id, `/classes/${classId}/slots/${slotId}`), { name: 'Appel du matin', halfDay: 'am', weekdays: ALL_DAYS, dueTime: '09:00' })
  const st = (await A.dir.get(url(A.id, '/settings'))).data.statuses
  statuses = { present: st.find((s: any) => s.category === 'PRESENT').id, absent: st.find((s: any) => s.category === 'ABSENT').id }
  teacher = await world.member(A.id, A.dir, 'enseignant')
  await A.dir.post(url(A.id, `/classes/${classId}/teachers`), { membershipId: teacher.membershipId })
})
afterAll(() => world.proxy.dispose())

describe('P4 – l’enseignant fait l’appel', () => {
  it('retrouve sa classe et son créneau du jour', async () => {
    const r = (await teacher.client.get(url(A.id, '/my-day'))).data
    expect(r.today).toBe(today)
    if (date === today) expect(r.classes[0].slots).toEqual([expect.objectContaining({ id: slotId, validatedAt: null })])
  })

  it('voit les 25 élèves attendus, dans un ordre stable, sans appel enregistré', async () => {
    const r = (await teacher.client.get(callUrl())).data
    expect(r.noCallReason).toBeNull()
    expect(r.students).toHaveLength(25)
    expect(r.students.map((s: any) => s.firstName)).toEqual([...r.students.map((s: any) => s.firstName)].sort())
    expect(r.call).toBeNull()
  })

  it('2 absents + validation : appel enregistré, horodaté, version 1', async () => {
    const entries = allPresent({ [students[2].id]: statuses.absent, [students[7].id]: statuses.absent })
    const r = await teacher.client.post(callUrl() + '/validate', { baseVersion: 0, requestId: 'premier-appel-1', entries, remark: 'Sortie à 15 h' })
    expect(r.status).toBe(200)
    expect(r.data.version).toBe(1)
    const c = (await teacher.client.get(callUrl())).data.call
    expect(c.version).toBe(1)
    expect(Object.values(c.entries).filter((x) => x === statuses.absent)).toHaveLength(2)
    expect(c.remark).toBe('Sortie à 15 h')
    expect(c.updatedBy).toMatch(/Personne/)
    expect(c.revisions).toHaveLength(1)
  })

  it('double tap / renvoi réseau : aucun appel dupliqué', async () => {
    const entries = allPresent({ [students[2].id]: statuses.absent, [students[7].id]: statuses.absent })
    const r = await teacher.client.post(callUrl() + '/validate', { baseVersion: 0, requestId: 'premier-appel-1', entries })
    expect(r.data).toMatchObject({ ok: true, version: 1, replay: true })
    const c = (await teacher.client.get(callUrl())).data.call
    expect(c.revisions).toHaveLength(1)
  })

  it('une validation concurrente (autre appareil) est refusée sans écraser', async () => {
    const r = await A.dir.post(callUrl() + '/validate', { baseVersion: 0, requestId: requestId(), entries: allPresent() })
    expect(r.data.error.code).toBe('STALE_CALL')
    const c = (await teacher.client.get(callUrl())).data.call
    expect(Object.values(c.entries).filter((x) => x === statuses.absent)).toHaveLength(2)
  })
})

describe('P9 – correction d’appel', () => {
  it('ancienne et nouvelle valeurs, auteur, date et justification conservés', async () => {
    const entries = allPresent({ [students[2].id]: statuses.absent }) // l'élève 8 est finalement présent
    const r = await A.dir.post(callUrl() + '/validate', { baseVersion: 1, requestId: requestId(), entries, remark: 'Sortie à 15 h', reason: 'Arrivé en retard' })
    expect(r.data.version).toBe(2)
    const c = (await teacher.client.get(callUrl())).data.call
    expect(c.status).toBe('corrected')
    expect(c.revisions[0]).toMatchObject({
      version: 2,
      reason: 'Arrivé en retard',
      changes: [{ studentId: students[7].id, from: statuses.absent, to: statuses.present }],
    })
    expect(c.revisions[1]).toMatchObject({ version: 1, changes: null })
  })

  it('une correction sur une version périmée est refusée', async () => {
    const r = await teacher.client.post(callUrl() + '/validate', { baseVersion: 1, requestId: requestId(), entries: allPresent() })
    expect(r.data.error.code).toBe('STALE_CALL')
  })

  it('sans changement : pas de nouvelle version', async () => {
    const entries = allPresent({ [students[2].id]: statuses.absent })
    const r = await teacher.client.post(callUrl() + '/validate', { baseVersion: 2, requestId: requestId(), entries, remark: 'Sortie à 15 h' })
    expect(r.data).toMatchObject({ version: 2, unchanged: true })
  })

  it('deux corrections identiques envoyées en même temps : une seule version créée', async () => {
    const entries = allPresent()
    const id = requestId()
    const [a, b] = await Promise.all([
      teacher.client.post(callUrl() + '/validate', { baseVersion: 2, requestId: id, entries }),
      teacher.client.post(callUrl() + '/validate', { baseVersion: 2, requestId: id, entries }),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    const c = (await teacher.client.get(callUrl())).data.call
    expect(c.version).toBe(3)
    expect(c.revisions.map((x: any) => x.version)).toEqual([3, 2, 1])
  })
})

describe('intégrité des données envoyées', () => {
  it('un élève manquant, en trop, ou un état inconnu est refusé', async () => {
    const base = { baseVersion: 3, requestId: requestId() }
    const missing = allPresent()
    delete (missing as any)[students[0].id]
    expect((await teacher.client.post(callUrl() + '/validate', { ...base, entries: missing })).data.error.code).toBe('STUDENTS_CHANGED')
    expect((await teacher.client.post(callUrl() + '/validate', { ...base, entries: allPresent({ 'intrus-123': statuses.present }) })).data.error.code).toBe(
      'STUDENTS_CHANGED',
    )
    expect((await teacher.client.post(callUrl() + '/validate', { ...base, entries: allPresent({ [students[0].id]: 'inconnu' }) })).data.error.code).toBe(
      'INVALID_STATUS',
    )
  })

  it('appel d’un jour à venir refusé', async () => {
    expect((await teacher.client.get(callUrl('2099-01-05'))).data.error.code).toBe('FUTURE_DATE')
  })
})

describe('cas particuliers', () => {
  it('journée sans classe : pas d’appel possible', async () => {
    const past = '2026-03-02' // un lundi passé
    await A.dir.post(url(A.id, '/closures'), { label: 'Fermeture exceptionnelle', startDate: past, endDate: past })
    const r = (await teacher.client.get(callUrl(past))).data
    expect(r.noCallReason).toBe('Fermeture exceptionnelle')
    expect((await teacher.client.post(callUrl(past) + '/validate', { baseVersion: 0, requestId: requestId(), entries: allPresent() })).data.error.code).toBe(
      'NO_CALL',
    )
  })

  it('classe sans élève attendu : état explicite, pas de validation trompeuse', async () => {
    const empty = (await A.dir.post(url(A.id, '/classes'), { name: 'CM2 vide', levels: ['CM2'] })).data.id
    const sl = (await A.dir.get(url(A.id, `/classes/${empty}`))).data.slots[0].id
    await A.dir.post(url(A.id, `/classes/${empty}/slots/${sl}`), { name: 'Appel', halfDay: 'am', weekdays: ALL_DAYS, dueTime: null })
    const u = callUrl(date, () => empty, () => sl)
    expect((await A.dir.get(u)).data.students).toEqual([])
    expect((await A.dir.post(u + '/validate', { baseVersion: 0, requestId: requestId(), entries: {} })).data.error.code).toBe('NO_STUDENTS')
  })

  it('emploi du temps : un élève non attendu ce jour-là n’apparaît pas', async () => {
    const past = '2026-03-03' // mardi
    await world.env.DB.prepare(`INSERT INTO student_schedules (id, student_id, valid_from, pattern, created_at) VALUES ('sch-1', ?, '2026-01-01', 1, '2026-01-01')`)
      .bind(students[24].id)
      .run() // lundi matin seulement
    const r = (await teacher.client.get(callUrl(past))).data
    expect(r.students).toHaveLength(24)
    expect(r.students.map((s: any) => s.id)).not.toContain(students[24].id)
  })

  it('un élève changé de classe après l’appel reste dans l’appel validé', async () => {
    const other = (await A.dir.post(url(A.id, '/classes'), { name: 'CE1 B', levels: ['CE1'] })).data.id
    await A.dir.post(url(A.id, `/students/${students[0].id}`), { firstName: students[0].firstName, classId: other })
    const r = (await teacher.client.get(callUrl())).data
    expect(r.students.map((s: any) => s.id)).toContain(students[0].id)
    expect(r.students).toHaveLength(25)
  })

  it('l’import ne peut plus être annulé une fois des appels faits', async () => {
    expect((await A.dir.post(url(A.id, `/imports/${importId}/cancel`))).data.error.code).toBe('IMPORT_IN_USE')
  })
})

describe('accès', () => {
  it('enseignant non affecté, autre école, remplaçant expiré : refusés', async () => {
    const other = await world.member(A.id, A.dir, 'enseignant')
    expect((await other.client.get(callUrl())).status).toBe(403)
    expect((await B.dir.get(callUrl())).status).toBe(403)
    expect((await B.dir.get(`/api/schools/${B.id}/classes/${classId}/calls/${date}/${slotId}`)).status).toBe(404)
    const rem = await world.member(A.id, A.dir, 'remplacant', { accessUntil: new Date(Date.now() + 86400_000).toISOString() })
    await A.dir.post(url(A.id, `/classes/${classId}/teachers`), { membershipId: rem.membershipId })
    expect((await rem.client.get(callUrl())).status).toBe(200)
    await world.env.DB.prepare(`UPDATE memberships SET active_to = '2020-01-01T00:00:00.000Z' WHERE id = ?`).bind(rem.membershipId).run()
    expect((await rem.client.get(callUrl())).status).toBe(403)
  })

  it('un enseignant retiré de la classe perd l’accès à l’appel', async () => {
    const t2 = await world.member(A.id, A.dir, 'enseignant')
    await A.dir.post(url(A.id, `/classes/${classId}/teachers`), { membershipId: t2.membershipId })
    expect((await t2.client.get(callUrl())).status).toBe(200)
    const a = (await A.dir.get(url(A.id, `/classes/${classId}`))).data.teachers.find((t: any) => t.display_name.startsWith('Personne') && t.role === 'enseignant')
    const all = (await A.dir.get(url(A.id, `/classes/${classId}`))).data.teachers
    const mine = all.filter((t: any) => t.role === 'enseignant').at(-1) ?? a
    await A.dir.post(url(A.id, `/classes/${classId}/teachers/${mine.id}/remove`))
    expect((await t2.client.get(callUrl())).status).toBe(403)
  })
})
