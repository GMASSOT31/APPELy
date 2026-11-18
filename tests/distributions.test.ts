// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/**
 * Lot 5 : répartitions temporaires (§7). Scénario de recette : CE1 A (24 élèves) réparti vers
 * CP A (20), CE1 B (24) et CE2 A (22). Données strictement fictives.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupWorld, type Client } from './helpers'
import { schoolToday } from '../worker/routes/calls'
import { addDays } from '../src/domain/direction'
import { rebalance } from '../src/domain/repartition'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let B: { id: string; dir: Client }
const cls: Record<string, string> = {}
const slot: Record<string, string> = {}
const students: Record<string, { id: string; firstName: string }[]> = {}
const teacher: Record<string, Client> = {}
let statuses: { present: string; absent: string }
let bClass: string
let planId: string
let choice: Record<string, string | null>

const today = schoolToday()
const tomorrow = addDays(today, 1)
const url = (s: string, p = '') => `/api/schools/${s}${p}`
const callUrl = (c: string) => url(A.id, `/classes/${cls[c]}/calls/${today}/${slot[c]}`)
let rid = 0
const requestId = () => `req-${Date.now()}-${rid++}`
const db = () => world.env.DB
const rowOf = (d: any, name: string) => d.rows.find((r: any) => r.classId === cls[name])
const dashboard = async () => (await A.dir.get(url(A.id, '/dashboard'))).data

async function validate(c: string, who: Client, override: Record<string, string> = {}) {
  const call = (await who.get(callUrl(c))).data
  const entries = Object.fromEntries(call.students.map((s: any) => [s.id, override[s.id] ?? call.call?.entries[s.id] ?? statuses.present]))
  return who.post(callUrl(c) + '/validate', { baseVersion: call.call?.version ?? 0, requestId: requestId(), entries })
}

async function activeRows(where = '1 = 1', ...binds: unknown[]) {
  return (
    await db()
      .prepare(`SELECT * FROM distribution_assignments WHERE ended_at IS NULL AND ${where}`)
      .bind(...binds)
      .all<any>()
  ).results
}

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
  B = await world.school('École B')
  await A.dir.post(url(A.id, '/settings/weekdays'), { closedWeekdays: 0 })
  const sizes: [string, string, number][] = [
    ['CE1 A', 'CE1', 24],
    ['CP A', 'CP', 20],
    ['CE1 B', 'CE1', 24],
    ['CE2 A', 'CE2', 22],
  ]
  const rows = sizes.flatMap(([name, , k]) =>
    Array.from({ length: k }, (_, i) => ({ firstName: `${name.replace(' ', '')}-Enfant${String(i + 1).padStart(2, '0')}`, className: name })),
  )
  const imp = await A.dir.post(url(A.id, '/imports'), { rows, classLevels: Object.fromEntries(sizes.map(([n, l]) => [n, [l]])) })
  for (const [name] of sizes) cls[name] = imp.data.classesCreated.find((c: any) => c.name === name).id
  await db().prepare(`UPDATE students SET active_from = '2026-01-01'`).run()
  // Appel du matin tous les jours (y compris le dimanche, pour que le test tourne chaque jour).
  await db().prepare(`UPDATE call_slots SET weekdays = 127, due_time = '23:59'`).run()
  for (const [name] of sizes) {
    const d = (await A.dir.get(url(A.id, `/classes/${cls[name]}`))).data
    students[name] = d.students
    slot[name] = d.slots[0].id
    const m = await world.member(A.id, A.dir, 'enseignant')
    await A.dir.post(url(A.id, `/classes/${cls[name]}/teachers`), { membershipId: m.membershipId })
    teacher[name] = m.client
  }
  const st = (await A.dir.get(url(A.id, '/settings'))).data.statuses
  statuses = { present: st.find((s: any) => s.category === 'PRESENT').id, absent: st.find((s: any) => s.category === 'ABSENT').id }
  bClass = (await B.dir.post(url(B.id, '/classes'), { name: 'CM1 B', levels: ['CM1'] })).data.id
})
afterAll(() => world.proxy.dispose())

const hosts = () => ['CP A', 'CE1 B', 'CE2 A'].map((n) => ({ classId: cls[n], capacity: null }))

describe('P6 – la direction répartit CE1 A', () => {
  it('préparation : effectifs habituels des classes et élèves à répartir', async () => {
    const r = await A.dir.get(url(A.id, `/distributions/prepare?classId=${cls['CE1 A']}&from=${today}&to=${today}&halfDays=day`))
    expect(r.status).toBe(200)
    const exp = Object.fromEntries(r.data.classes.map((c: any) => [c.name, c.expected]))
    expect(exp).toMatchObject({ 'CP A': 20, 'CE1 B': 24, 'CE2 A': 22, 'CE1 A': 24 })
    expect(r.data.students).toHaveLength(24)
    expect(r.data.slotCount).toBe(2)
    expect(r.data.last).toBeNull()
  })

  it('proposition équilibrée sur l’effectif projeté (30 / 30 / 30)', () => {
    const p = rebalance(
      students['CE1 A'].map((s) => ({ id: s.id })),
      [
        { id: cls['CP A'], name: 'CP A', expected: 20 },
        { id: cls['CE1 B'], name: 'CE1 B', expected: 24 },
        { id: cls['CE2 A'], name: 'CE2 A', expected: 22 },
      ],
      {},
    )
    expect(Object.values(p.projected)).toEqual([30, 30, 30])
    choice = p.assignments
  })

  it('refuse une répartition incomplète, une capacité dépassée ou une date passée', async () => {
    const base = { sourceClassId: cls['CE1 A'], startDate: today, endDate: today, halfDays: 'day', hosts: hosts() }
    const partial = { ...choice }
    delete partial[students['CE1 A'][0].id]
    expect((await A.dir.post(url(A.id, '/distributions'), { ...base, choice: partial, requestId: requestId() })).data.error.code).toBe('UNASSIGNED')
    const allCp = Object.fromEntries(students['CE1 A'].map((s) => [s.id, cls['CP A']]))
    const cap = await A.dir.post(url(A.id, '/distributions'), {
      ...base,
      hosts: [{ classId: cls['CP A'], capacity: 28 }],
      choice: allCp,
      requestId: requestId(),
    })
    expect(cap).toMatchObject({ status: 409, data: { error: { code: 'OVER_CAPACITY' } } })
    const past = await A.dir.post(url(A.id, '/distributions'), { ...base, startDate: addDays(today, -1), choice, requestId: requestId() })
    expect(past.data.error.code).toBe('PAST_DATE')
    const self = await A.dir.post(url(A.id, '/distributions'), { ...base, hosts: [{ classId: cls['CE1 A'], capacity: null }], choice, requestId: requestId() })
    expect(self.data.error.code).toBe('INVALID_HOSTS')
  })

  it('valide : les 24 élèves affectés exactement une fois par demi-journée (idempotent)', async () => {
    const body = { sourceClassId: cls['CE1 A'], startDate: today, endDate: today, halfDays: 'day', hosts: hosts(), choice, requestId: requestId() }
    const r = await A.dir.post(url(A.id, '/distributions'), body)
    expect(r.status).toBe(201)
    planId = r.data.id
    const again = await A.dir.post(url(A.id, '/distributions'), body) // double tap
    expect(again.data).toMatchObject({ id: planId, replay: true })
    const rows = await activeRows('plan_id = ?', planId)
    expect(rows).toHaveLength(48) // 24 élèves × matin + après-midi
    for (const half of ['am', 'pm']) {
      const ids = rows.filter((x) => x.half_day === half).map((x) => x.student_id)
      expect(new Set(ids).size).toBe(24)
      expect(ids.sort()).toEqual(students['CE1 A'].map((s) => s.id).sort())
    }
    const per = (name: string) => rows.filter((x) => x.half_day === 'am' && x.host_class_id === cls[name]).length
    expect([per('CP A'), per('CE1 B'), per('CE2 A')]).toEqual([10, 6, 8])
    // La classe d'inscription ne change pas.
    const c = await db().prepare('SELECT COUNT(*) AS n FROM students WHERE class_id = ?').bind(cls['CE1 A']).first<{ n: number }>()
    expect(c?.n).toBe(24)
  })

  it('une seule affectation active par élève et créneau : seconde répartition refusée', async () => {
    const r = await A.dir.post(url(A.id, '/distributions'), {
      sourceClassId: cls['CE1 A'],
      startDate: today,
      endDate: tomorrow,
      halfDays: 'am',
      hosts: hosts(),
      choice,
      requestId: requestId(),
    })
    expect(r).toMatchObject({ status: 409, data: { error: { code: 'ALREADY_DISTRIBUTED' } } })
    // Même en contournant les contrôles, la base refuse le doublon.
    const one = (await activeRows('plan_id = ? AND half_day = ?', planId, 'am'))[0]
    await expect(
      db()
        .prepare(
          `INSERT INTO distribution_assignments (id, plan_id, school_id, student_id, source_class_id, host_class_id, slot_date, half_day, created_by, created_at)
           SELECT 'x', plan_id, school_id, student_id, source_class_id, host_class_id, slot_date, half_day, created_by, created_at FROM distribution_assignments WHERE id = ?`,
        )
        .bind(one.id)
        .run(),
    ).rejects.toThrow(/UNIQUE/)
  })

  it('pas de chaîne : une classe répartie n’accueille pas, une classe d’accueil n’est pas répartie', async () => {
    const cpChoice = Object.fromEntries(students['CP A'].map((s) => [s.id, cls['CE1 A']]))
    const r = await A.dir.post(url(A.id, '/distributions'), {
      sourceClassId: cls['CP A'],
      startDate: today,
      endDate: today,
      halfDays: 'am',
      hosts: [{ classId: cls['CE1 A'], capacity: null }],
      choice: cpChoice,
      requestId: requestId(),
    })
    expect(r.status).toBe(409)
    expect(['HOST_DISTRIBUTED', 'SOURCE_HOSTING']).toContain(r.data.error.code)
  })

  it('les trois enseignants d’accueil et celui de CE1 A sont informés', async () => {
    for (const n of ['CP A', 'CE1 B', 'CE2 A']) {
      const d = (await teacher[n].get(url(A.id, '/my-day'))).data
      expect(d.distributionNotices).toHaveLength(1)
      expect(d.distributionNotices[0].body).toMatch(/Vous accueillez \d+ élèves de CE1 A/)
      expect(d.classes[0].slots[0]).toMatchObject({ hostedFrom: ['CE1 A'], distributed: false })
    }
    const src = (await teacher['CE1 A'].get(url(A.id, '/my-day'))).data
    expect(src.distributionNotices[0].body).toMatch(/CE1 A est répartie .* 10 élèves en CP A, 6 élèves en CE1 B, 8 élèves en CE2 A/)
    expect(src.classes[0].slots[0]).toMatchObject({ distributed: true, awayCount: 24 })
  })

  it('tableau de bord : répartition active, CE1 A « Répartie » 0/24, accueil visible', async () => {
    const d = await dashboard()
    expect(d.activeDistributions).toBe(1)
    const r = rowOf(d, 'CE1 A')
    expect(r.state).toBe('distributed')
    expect(r.distribution).toMatchObject({ total: 24, confirmed: 0, complete: false })
    expect(r.distribution.hosts.map((h: any) => [h.className, h.total])).toEqual([
      ['CP A', 10],
      ['CE1 B', 6],
      ['CE2 A', 8],
    ])
    expect(rowOf(d, 'CP A')).toMatchObject({ expected: 30, hosted: { count: 10, from: ['CE1 A'] } })
  })
})

describe('P7 – les classes d’accueil font l’appel', () => {
  it('élèves accueillis visibles séparément, avec leur classe d’origine', async () => {
    const call = (await teacher['CP A'].get(callUrl('CP A'))).data
    expect(call.students).toHaveLength(30)
    const hosted = call.students.filter((s: any) => s.hostedFrom)
    expect(hosted).toHaveLength(10)
    expect(hosted.every((s: any) => s.hostedFrom.name === 'CE1 A')).toBe(true)
    // Élèves de la classe d'abord, élèves accueillis ensuite.
    expect(call.students.slice(0, 20).every((s: any) => !s.hostedFrom)).toBe(true)
    expect(call.notices[0].body).toMatch(/Vous accueillez 10 élèves/)
  })

  it('la classe d’origine n’a pas d’appel à faire (pas de double présence)', async () => {
    const call = (await teacher['CE1 A'].get(callUrl('CE1 A'))).data
    expect(call.students).toHaveLength(0)
    expect(call.distributed).toHaveLength(24)
    const v = await validate('CE1 A', teacher['CE1 A'])
    expect(v).toMatchObject({ status: 409, data: { error: { code: 'NO_STUDENTS' } } })
  })

  it('les présences remontent à la classe d’origine et la couverture progresse', async () => {
    const call = (await teacher['CP A'].get(callUrl('CP A'))).data
    const absentHosted = call.students.find((s: any) => s.hostedFrom).id
    expect((await validate('CP A', teacher['CP A'], { [absentHosted]: statuses.absent })).status).toBe(200)
    const e = await db().prepare('SELECT hosted_from_class_id AS h FROM attendance_entries WHERE student_id = ?').bind(absentHosted).first<{ h: string }>()
    expect(e?.h).toBe(cls['CE1 A'])
    const reg = (await teacher['CE1 A'].get(callUrl('CE1 A'))).data.distributed
    expect(reg.find((s: any) => s.id === absentHosted)).toMatchObject({ hostName: 'CP A', status: 'Absent', category: 'ABSENT' })
    expect(reg.filter((s: any) => s.status).length).toBe(10)
    const r = rowOf(await dashboard(), 'CE1 A')
    expect(r.distribution).toMatchObject({ total: 24, confirmed: 10, present: 9, absent: 1 })
    expect(rowOf(await dashboard(), 'CP A')).toMatchObject({ state: 'validated', expected: 30, counts: { present: 29, absent: 1 }, hosted: { count: 10 } })
  })

  it('un élève n’apparaît dans aucun autre appel du même créneau', async () => {
    const all = new Map<string, number>()
    for (const n of ['CE1 A', 'CP A', 'CE1 B', 'CE2 A'])
      for (const s of (await A.dir.get(callUrl(n))).data.students) all.set(s.id, (all.get(s.id) ?? 0) + 1)
    expect([...all.values()].every((k) => k === 1)).toBe(true)
    expect(all.size).toBe(90)
  })
})

describe('P8 – la direction corrige la répartition', () => {
  it('déplacement propagé ; un élève déjà compté reste dans son appel validé', async () => {
    const prev = (await A.dir.get(url(A.id, `/distributions/${planId}`))).data
    const fromCp = Object.keys(choice).find((id) => choice[id] === cls['CP A'])!
    const fromCe1b = Object.keys(choice).find((id) => choice[id] === cls['CE1 B'])!
    const next = { ...choice, [fromCp]: cls['CE2 A'], [fromCe1b]: cls['CE2 A'] }
    const body = {
      startDate: today,
      endDate: today,
      halfDays: 'day',
      hosts: hosts(),
      choice: next,
      baseVersion: prev.plan.version,
      requestId: requestId(),
    }
    const r = await A.dir.post(url(A.id, `/distributions/${planId}`), body)
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ version: 2, moved: 2, frozen: 1 })
    expect((await A.dir.post(url(A.id, `/distributions/${planId}`), body)).data).toMatchObject({ replay: true })
    // Élève de CP A : compté ce matin dans l'appel validé de CP A → reste en CP A le matin, CE2 A l'après-midi.
    const cpRows = await activeRows('student_id = ?', fromCp)
    expect(Object.fromEntries(cpRows.map((x) => [x.half_day, x.host_class_id]))).toEqual({ am: cls['CP A'], pm: cls['CE2 A'] })
    // Élève de CE1 B (appel pas encore fait) : déplacé dès ce matin, l'ancienne affectation est conservée en historique.
    const ce1bRows = await activeRows('student_id = ?', fromCe1b)
    expect(ce1bRows.every((x) => x.host_class_id === cls['CE2 A'])).toBe(true)
    const ended = (await db().prepare('SELECT COUNT(*) AS n FROM distribution_assignments WHERE student_id = ? AND ended_at IS NOT NULL').bind(fromCe1b).first<{ n: number }>())!
    expect(ended.n).toBe(2)
    const ce2 = (await teacher['CE2 A'].get(callUrl('CE2 A'))).data
    expect(ce2.students.filter((s: any) => s.hostedFrom)).toHaveLength(9)
    expect(ce2.notices[0].body).toMatch(/modifiée : vous accueillez maintenant 10 élèves/)
    const detail = (await A.dir.get(url(A.id, `/distributions/${planId}`))).data
    expect(detail.changes[0]).toMatchObject({ version: 2, action: 'updated', frozen: 1 })
    expect(detail.changes[0].moved).toHaveLength(2)
    expect(choice[fromCp]).toBe(cls['CP A'])
    choice = next
  })

  it('modification concurrente refusée au lieu d’écraser', async () => {
    const r = await A.dir.post(url(A.id, `/distributions/${planId}`), {
      startDate: today,
      endDate: today,
      halfDays: 'day',
      hosts: hosts(),
      choice,
      baseVersion: 1,
      requestId: requestId(),
    })
    expect(r).toMatchObject({ status: 409, data: { error: { code: 'STALE_PLAN' } } })
  })

  it('élève ajouté après la validation de la classe d’accueil : à intégrer par une correction', async () => {
    expect((await validate('CE2 A', teacher['CE2 A'])).status).toBe(200)
    const moving = Object.keys(choice).find((id) => choice[id] === cls['CE1 B'])!
    const detail = (await A.dir.get(url(A.id, `/distributions/${planId}`))).data
    choice = { ...choice, [moving]: cls['CE2 A'] }
    const r = await A.dir.post(url(A.id, `/distributions/${planId}`), {
      startDate: today,
      endDate: today,
      halfDays: 'day',
      hosts: hosts(),
      choice,
      baseVersion: detail.plan.version,
      requestId: requestId(),
    })
    expect(r.status).toBe(200)
    const call = (await teacher['CE2 A'].get(callUrl('CE2 A'))).data
    expect(call.students.find((s: any) => s.id === moving)).toMatchObject({ pending: true, hostedFrom: { name: 'CE1 A' } })
    expect((await validate('CE2 A', teacher['CE2 A'])).data.version).toBe(2)
    expect((await teacher['CE1 B'].get(callUrl('CE1 B'))).data.students.some((s: any) => s.id === moving)).toBe(false)
    expect((await validate('CE1 B', teacher['CE1 B'])).status).toBe(200)
    const row = rowOf(await dashboard(), 'CE1 A')
    expect(row.distribution).toMatchObject({ total: 24, confirmed: 24, complete: true })
  })

  it('annulation : les demi-journées déjà comptées restent, le reste revient à la classe d’origine', async () => {
    const detail = (await A.dir.get(url(A.id, `/distributions/${planId}`))).data
    const r = await A.dir.post(url(A.id, `/distributions/${planId}/cancel`), { baseVersion: detail.plan.version, requestId: requestId() })
    expect(r.status).toBe(200)
    expect(await activeRows('plan_id = ? AND half_day = ?', planId, 'pm')).toHaveLength(0)
    expect(await activeRows('plan_id = ? AND half_day = ?', planId, 'am')).toHaveLength(24)
    const src = (await teacher['CE1 A'].get(url(A.id, '/my-day'))).data
    expect(src.distributionNotices[0].body).toMatch(/annulée/)
    expect((await A.dir.get(url(A.id, '/distributions'))).data.plans[0]).toMatchObject({ id: planId, state: 'cancelled', when: 'cancelled' })
    expect((await A.dir.post(url(A.id, `/distributions/${planId}/cancel`), { baseVersion: r.data.version, requestId: requestId() })).status).toBe(409)
  })

  it('réutiliser la dernière répartition : proposée à la préparation du lendemain', async () => {
    const r = await A.dir.get(url(A.id, `/distributions/prepare?classId=${cls['CE1 A']}&from=${tomorrow}&to=${tomorrow}&halfDays=am`))
    expect(r.data.last).toMatchObject({ id: planId })
    expect(Object.keys(r.data.last.choice)).toHaveLength(24)
    const created = await A.dir.post(url(A.id, '/distributions'), {
      sourceClassId: cls['CE1 A'],
      startDate: tomorrow,
      endDate: tomorrow,
      halfDays: 'am',
      hosts: r.data.last.hosts,
      choice: r.data.last.choice,
      requestId: requestId(),
    })
    expect(created.status).toBe(201)
  })
})

describe('historique et cloisonnement', () => {
  it('historique : filtre « répartition » et classe répartie', async () => {
    const h = (await A.dir.get(url(A.id, `/history?from=${today}&to=${today}&distribution=1`))).data
    const names = h.rows.map((r: any) => r.className).sort()
    expect(names).toEqual(['CE1 A', 'CE1 B', 'CE2 A', 'CP A'])
    expect(h.rows.find((r: any) => r.className === 'CP A').hosted).toMatchObject({ count: 10, from: ['CE1 A'] })
    // CE1 A n'a pas d'appel ce matin (tous comptés ailleurs) : « Répartie » avec sa couverture, jamais « non fait ».
    expect(h.rows.find((r: any) => r.className === 'CE1 A')).toMatchObject({ state: 'distributed', distribution: { total: 24, confirmed: 24 } })
    expect((await A.dir.get(url(A.id, `/history?from=${today}&to=${today}&state=distributed`))).data.rows).toHaveLength(1)
    const all = (await A.dir.get(url(A.id, `/history?from=${today}&to=${today}`))).data
    expect(all.rows.some((r: any) => r.className === 'CE1 A' && r.state === 'missing')).toBe(false)
  })

  it('une autre école ne lit ni ne modifie jamais les répartitions', async () => {
    expect((await B.dir.get(url(A.id, '/distributions'))).status).toBe(403)
    expect((await B.dir.get(url(A.id, `/distributions/${planId}`))).status).toBe(403)
    expect((await B.dir.get(url(A.id, `/distributions/prepare?classId=${cls['CE1 A']}`))).status).toBe(403)
    expect((await B.dir.post(url(A.id, `/distributions/${planId}/cancel`), { baseVersion: 1, requestId: requestId() })).status).toBe(403)
    // Par l'URL de sa propre école : le plan de A est introuvable.
    expect((await B.dir.get(url(B.id, `/distributions/${planId}`))).status).toBe(404)
    expect((await B.dir.get(url(B.id, `/distributions/prepare?planId=${planId}`))).status).toBe(404)
    expect((await B.dir.get(url(B.id, `/distributions/prepare?classId=${cls['CE1 A']}`))).status).toBe(404)
    // Classe d'accueil d'une autre école refusée.
    const bStudent = await B.dir.post(url(B.id, `/classes/${bClass}/students`), { firstName: 'Bastien' })
    expect(bStudent.status).toBe(201)
    const r = await B.dir.post(url(B.id, '/distributions'), {
      sourceClassId: bClass,
      startDate: tomorrow,
      endDate: tomorrow,
      halfDays: 'am',
      hosts: [{ classId: cls['CP A'], capacity: null }],
      choice: {},
      requestId: requestId(),
    })
    expect(r).toMatchObject({ status: 400, data: { error: { code: 'INVALID_HOSTS' } } })
  })

  it('les enseignants ne gèrent pas les répartitions', async () => {
    expect((await teacher['CP A'].get(url(A.id, '/distributions'))).status).toBe(403)
    expect((await teacher['CP A'].post(url(A.id, `/distributions/${planId}/cancel`), {})).status).toBe(403)
  })
})
