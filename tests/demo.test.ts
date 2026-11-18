// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/** Lot 7 : école de démonstration (données fictives, recréable). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, setupWorld } from './helpers'
import { buildDemoData, DEMO_PAST_DAYS, demoPassword, pastSchoolDays } from '../worker/lib/demo'
import { schoolToday } from '../worker/routes/calls'
import { isoWeekday } from '../src/domain/schedule'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let demo: any

const login = async (email: string, password: string) => {
  const c = new Client(world.env, `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`)
  const r = await c.post('/api/auth/login', { email, password })
  return { c, status: r.status }
}

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
})
afterAll(() => world.proxy.dispose())

describe('données de démonstration (fonctions pures)', () => {
  it('construit une école cohérente et fictive', () => {
    let n = 0
    const d = buildDemoData('2026-11-18', 'abcd', () => `id-${n++}`)
    expect(d.classes.map((c) => c.name)).toEqual(['PS-MS', 'GS', 'CP A', 'CE1 A', 'CE1 B', 'CE2 A', 'CM1-CM2'])
    const size = (name: string) => d.students.filter((s) => s.classId === d.classes.find((c) => c.name === name)!.id).length
    expect([size('CE1 A'), size('CP A'), size('CE1 B'), size('CE2 A')]).toEqual([24, 20, 24, 22])
    const names = d.students.map((s) => `${s.firstName} ${s.lastName}`)
    expect(new Set(names).size).toBe(names.length)
    expect(d.calls).toHaveLength(DEMO_PAST_DAYS * d.classes.length)
    expect(new Set(d.absences.map((a) => `${a.callId}#${a.studentId}`)).size).toBe(d.absences.length)
    expect(d.accounts.map((a) => a.email)).toContain('direction.abcd@demo.appely.test')
    // Déterministe : même code, mêmes élèves.
    let m = 0
    expect(buildDemoData('2026-11-18', 'abcd', () => `id-${m++}`).students).toEqual(d.students)
  })

  it('ne prend que des jours d’école passés (pas de dimanche, pas aujourd’hui)', () => {
    const days = pastSchoolDays('2026-11-18', 8)
    expect(days).toHaveLength(8)
    expect(days.every((x) => x < '2026-11-18' && isoWeekday(x) !== 7)).toBe(true)
    expect(days[days.length - 1]).toBe('2026-11-17')
  })

  it('mot de passe lisible et assez long', () => {
    expect(demoPassword(new Uint8Array(16))).toMatch(/^Demo-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
  })
})

describe('école de démonstration (API)', () => {
  it('réservée au superadmin', async () => {
    expect((await A.dir.post('/api/admin/demo-school')).status).toBe(403)
    expect((await new Client(world.env).post('/api/admin/demo-school')).status).toBe(401)
  })

  it('le superadmin crée l’école de démonstration et reçoit les identifiants une fois', async () => {
    const r = await world.admin.post('/api/admin/demo-school')
    expect(r.status).toBe(201)
    demo = r.data
    expect(demo.password).toMatch(/^Demo-/)
    expect(demo.accounts.map((a: any) => a.role)).toEqual(['direction', 'enseignant', 'enseignant', 'remplacant'])
    expect(demo.counts.students).toBe(160)
    const list = (await world.admin.get('/api/admin/schools')).data.schools
    const s = list.find((x: any) => x.id === demo.school.id)
    expect(s).toMatchObject({ status: 'active', is_demo: 1 })
    // Pas de nom d'élève dans la réponse du superadmin.
    expect(JSON.stringify(r.data)).not.toMatch(/Tilleul [A-Z]|Abeille|Fougère/)
  })

  it('une seule école de démonstration à la fois', async () => {
    expect((await world.admin.post('/api/admin/demo-school')).status).toBe(409)
  })

  it('les comptes fonctionnent : direction (tableau de bord, historique) et enseignant (appel du jour)', async () => {
    const dir = await login(demo.accounts[0].email, demo.password)
    expect(dir.status).toBe(200)
    const sid = demo.school.id
    const dash = await dir.c.get(`/api/schools/${sid}/dashboard`)
    expect(dash.status).toBe(200)
    const hist = (await dir.c.get(`/api/schools/${sid}/history`)).data
    expect(hist.rows.filter((r: any) => r.state === 'validated').length).toBeGreaterThan(0)

    const t = await login(demo.accounts[1].email, demo.password)
    const day = (await t.c.get(`/api/schools/${sid}/my-day`)).data
    expect(day.classes.map((c: any) => c.name)).toEqual(['CE1 A'])
    if (isoWeekday(schoolToday()) !== 7) {
      const slot = day.classes[0].slots[0]
      const call = await t.c.get(`/api/schools/${sid}/classes/${day.classes[0].id}/calls/${schoolToday()}/${slot.id}`)
      expect(call.status).toBe(200)
      expect(call.data.students).toHaveLength(24)
      // L'absence prévue de démonstration prépositionne un élève « Absent ».
      expect(JSON.stringify(call.data)).toMatch(/Rendez-vous/)
    }
    // Remplaçant : accès limité dans le temps.
    const rp = await login(demo.accounts[3].email, demo.password)
    expect((await rp.c.get(`/api/schools/${sid}/my-day`)).data.classes.map((c: any) => c.name)).toEqual(['CE2 A'])
  })

  it('cloisonnement : la démonstration ne voit pas l’école A, et inversement', async () => {
    const dir = await login(demo.accounts[0].email, demo.password)
    expect((await dir.c.get(`/api/schools/${A.id}/dashboard`)).status).toBe(403)
    expect((await dir.c.get(`/api/schools/${A.id}/overview`)).status).toBe(403)
    expect((await A.dir.get(`/api/schools/${demo.school.id}/overview`)).status).toBe(403)
    // La direction de démonstration ne peut pas supprimer l'école.
    expect((await dir.c.post(`/api/admin/schools/${demo.school.id}/delete-demo`)).status).toBe(403)
  })

  it('seule une école de démonstration peut être supprimée entièrement', async () => {
    expect((await world.admin.post(`/api/admin/schools/${A.id}/delete-demo`)).status).toBe(404)
    expect((await A.dir.get(`/api/schools/${A.id}/overview`)).status).toBe(200)
  })

  it('suppression complète puis recréation (rejouable)', async () => {
    const r = await world.admin.post(`/api/admin/schools/${demo.school.id}/delete-demo`)
    expect(r.status).toBe(200)
    expect((await login(demo.accounts[0].email, demo.password)).status).toBe(401)
    const list = (await world.admin.get('/api/admin/schools')).data.schools
    expect(list.some((x: any) => x.id === demo.school.id)).toBe(false)
    const again = await world.admin.post('/api/admin/demo-school')
    expect(again.status).toBe(201)
    expect(again.data.password).not.toBe(demo.password)
    expect((await login(again.data.accounts[0].email, again.data.password)).status).toBe(200)
  })
})
