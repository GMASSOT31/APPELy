// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/**
 * Tests d'intégration de l'API sur une vraie base D1 locale (Miniflare), sans réseau.
 * Données strictement fictives.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { handleApi } from '../worker/index'
import type { Env } from '../worker/lib/auth'

const ORIGIN = 'https://appely.test'
const SETUP_CODE = 'code-de-test-123456'
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>
let env: Env

class Client {
  cookie = ''
  ip: string
  constructor(ip = '10.0.0.1') {
    this.ip = ip
  }
  async call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip, ...extraHeaders }
    if (this.cookie) headers.cookie = this.cookie
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await handleApi(
      new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
    )
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    const data = (await res.json()) as any
    return { status: res.status, data }
  }
  get = (p: string) => this.call('GET', p)
  post = (p: string, b: unknown = {}) => this.call('POST', p, b)
}

const tokenOf = (url: string) => url.split('/invitation/')[1]

async function accept(url: string, password: string, ip?: string) {
  const c = new Client(ip)
  const r = await c.post(`/api/invitations/${tokenOf(url)}/accept`, { password })
  return { c, r }
}

let admin: Client
let dirA: Client
let schoolA: string
let schoolB: string
let dirB: Client

beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: false })
  env = { DB: (proxy.env as { DB: D1Database }).DB, ADMIN_SETUP_CODE: SETUP_CODE }

  admin = new Client()
  expect((await admin.get('/api/setup')).data).toEqual({ needed: true, configured: true })
  expect((await admin.post('/api/setup', { code: SETUP_CODE, email: 'admin@exemple.test', displayName: 'Admin', password: 'motdepasse-admin' })).status).toBe(200)

  const a = await admin.post('/api/admin/schools', { name: 'École des Tilleuls', directionEmail: 'dir.a@exemple.test', directionName: 'Directrice A' })
  expect(a.status).toBe(201)
  schoolA = a.data.school.id
  ;({ c: dirA } = await accept(a.data.inviteUrl, 'motdepasse-dir-a'))

  const b = await admin.post('/api/admin/schools', { name: 'École des Platanes', directionEmail: 'dir.b@exemple.test' })
  schoolB = b.data.school.id
  ;({ c: dirB } = await accept(b.data.inviteUrl, 'motdepasse-dir-b'))
})

afterAll(() => proxy?.dispose())

describe('P1 – installation et création d’école', () => {
  it('le code d’installation ne sert qu’une fois', async () => {
    const r = await new Client('10.0.0.9').post('/api/setup', { code: SETUP_CODE, email: 'x@exemple.test', displayName: 'X', password: 'motdepasse-x123' })
    expect(r.status).toBe(409)
  })

  it('l’école passe de « invitation en attente » à « active » quand la direction active son compte', async () => {
    const c = await admin.post('/api/admin/schools', { name: 'École du Port', directionEmail: 'dir.c@exemple.test' })
    let list = (await admin.get('/api/admin/schools')).data.schools
    expect(list.find((s: any) => s.id === c.data.school.id).status).toBe('invited')
    const { c: dirC, r } = await accept(c.data.inviteUrl, 'motdepasse-dir-c')
    expect(r.status).toBe(200)
    list = (await admin.get('/api/admin/schools')).data.schools
    expect(list.find((s: any) => s.id === c.data.school.id).status).toBe('active')
    const me = (await dirC.get('/api/me')).data
    expect(me.memberships).toEqual([expect.objectContaining({ schoolName: 'École du Port', role: 'direction' })])
  })

  it('un lien d’invitation est à usage unique', async () => {
    const c = await admin.post('/api/admin/schools', { name: 'École Unique', directionEmail: 'dir.u@exemple.test' })
    expect((await accept(c.data.inviteUrl, 'motdepasse-dir-u')).r.status).toBe(200)
    const again = await accept(c.data.inviteUrl, 'autre-motdepasse')
    expect(again.r.status).toBe(410)
  })

  it('un mot de passe trop court est refusé', async () => {
    const c = await admin.post('/api/admin/schools', { name: 'École Courte', directionEmail: 'dir.k@exemple.test' })
    expect((await accept(c.data.inviteUrl, 'court')).r.data.error.code).toBe('WEAK_PASSWORD')
  })

  it('seul le superadmin gère les écoles', async () => {
    expect((await dirA.get('/api/admin/schools')).status).toBe(403)
    expect((await dirA.post('/api/admin/schools', { name: 'Pirate', directionEmail: 'p@exemple.test' })).status).toBe(403)
    expect((await new Client().get('/api/admin/schools')).status).toBe(401)
  })

  it('le superadmin n’accède pas aux données internes d’une école', async () => {
    expect((await admin.get(`/api/schools/${schoolA}/members`)).status).toBe(403)
  })
})

describe('Connexion', () => {
  it('connexion, session, déconnexion', async () => {
    const c = new Client('10.0.1.1')
    expect((await c.post('/api/auth/login', { email: 'DIR.A@exemple.test', password: 'motdepasse-dir-a' })).status).toBe(200)
    expect((await c.get('/api/me')).data.user.email).toBe('dir.a@exemple.test')
    await c.post('/api/auth/logout')
    expect((await c.get('/api/me')).status).toBe(401)
  })

  it('limite les tentatives après 5 échecs', async () => {
    const c = new Client('10.0.2.2')
    for (let i = 0; i < 5; i++)
      expect((await c.post('/api/auth/login', { email: 'dir.b@exemple.test', password: 'mauvais-mdp' })).status).toBe(401)
    const blocked = await c.post('/api/auth/login', { email: 'dir.b@exemple.test', password: 'motdepasse-dir-b' })
    expect(blocked.status).toBe(429)
  })

  it('refuse une requête venant d’un autre site (CSRF)', async () => {
    const r = await dirA.call('POST', `/api/schools/${schoolA}/invitations`, { email: 'e@exemple.test', displayName: 'E', role: 'enseignant' }, { origin: 'https://pirate.test' })
    expect(r.status).toBe(403)
  })
})

describe('P11 – isolation entre écoles', () => {
  it('la direction de l’école A ne voit ni ne modifie l’école B', async () => {
    expect((await dirA.get(`/api/schools/${schoolB}/members`)).status).toBe(403)
    expect((await dirA.post(`/api/schools/${schoolB}/invitations`, { email: 'x@exemple.test', displayName: 'X', role: 'direction' })).status).toBe(403)
    const membersB = (await dirB.get(`/api/schools/${schoolB}/members`)).data.members
    const mid = membersB[0].id
    expect((await dirA.post(`/api/schools/${schoolA}/members/${mid}/revoke`)).status).toBe(404)
    expect((await dirA.post(`/api/schools/${schoolB}/members/${mid}/revoke`)).status).toBe(403)
  })
})

describe('Invitations par la direction, rôles et révocation', () => {
  it('enseignant : invité, connecté, sans accès aux fonctions de direction', async () => {
    const inv = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'ens.a@exemple.test', displayName: 'Enseignant A', role: 'enseignant' })
    expect(inv.status).toBe(201)
    const { c: ens } = await accept(inv.data.inviteUrl, 'motdepasse-ens-a')
    expect((await ens.get('/api/me')).data.memberships[0].role).toBe('enseignant')
    expect((await ens.get(`/api/schools/${schoolA}/members`)).status).toBe(403)
    expect((await ens.post(`/api/schools/${schoolA}/invitations`, { email: 'y@exemple.test', displayName: 'Y', role: 'direction' })).status).toBe(403)
  })

  it('remplaçant : date de fin obligatoire', async () => {
    const r = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'rem@exemple.test', displayName: 'Remplaçant', role: 'remplacant' })
    expect(r.data.error.code).toBe('INVALID_DATE')
    const until = new Date(Date.now() + 7 * 86400_000).toISOString()
    const ok = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'rem@exemple.test', displayName: 'Remplaçant', role: 'remplacant', accessUntil: until })
    const { c: rem } = await accept(ok.data.inviteUrl, 'motdepasse-rempl')
    expect((await rem.get('/api/me')).data.memberships[0]).toMatchObject({ role: 'remplacant', activeTo: until })
  })

  it('remplaçant : plus aucun accès après expiration', async () => {
    const until = new Date(Date.now() + 1500).toISOString()
    // Contournement de la validation « date future » : on insère directement un rattachement court.
    const inv = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'rem2@exemple.test', displayName: 'R2', role: 'remplacant', accessUntil: new Date(Date.now() + 86400_000).toISOString() })
    const { c: rem } = await accept(inv.data.inviteUrl, 'motdepasse-rempl2')
    await env.DB.prepare(`UPDATE memberships SET active_to = ? WHERE user_id = (SELECT id FROM users WHERE email = 'rem2@exemple.test')`).bind(until).run()
    expect((await rem.get('/api/me')).data.memberships).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 1600))
    expect((await rem.get('/api/me')).data.memberships).toHaveLength(0)
  })

  it('révocation d’un accès', async () => {
    const inv = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'ens.r@exemple.test', displayName: 'À révoquer', role: 'enseignant' })
    const { c: ens } = await accept(inv.data.inviteUrl, 'motdepasse-ens-r')
    const m = (await dirA.get(`/api/schools/${schoolA}/members`)).data.members.find((x: any) => x.email === 'ens.r@exemple.test')
    expect((await dirA.post(`/api/schools/${schoolA}/members/${m.id}/revoke`)).status).toBe(200)
    expect((await ens.get('/api/me')).data.memberships).toHaveLength(0)
  })

  it('une direction ne peut pas retirer son propre accès', async () => {
    const me = (await dirA.get(`/api/schools/${schoolA}/members`)).data.members.find((x: any) => x.is_me)
    expect((await dirA.post(`/api/schools/${schoolA}/members/${me.id}/revoke`)).data.error.code).toBe('SELF_REVOKE')
  })

  it('réinitialisation forcée : ancien mot de passe et sessions invalidés, nouveau lien unique', async () => {
    const inv = await dirA.post(`/api/schools/${schoolA}/invitations`, { email: 'ens.z@exemple.test', displayName: 'Oublieux', role: 'enseignant' })
    const { c: ens } = await accept(inv.data.inviteUrl, 'ancien-motdepasse')
    const m = (await dirA.get(`/api/schools/${schoolA}/members`)).data.members.find((x: any) => x.email === 'ens.z@exemple.test')
    const reset = await dirA.post(`/api/schools/${schoolA}/members/${m.id}/reset`)
    expect(reset.status).toBe(200)
    expect((await ens.get('/api/me')).status).toBe(401)
    expect((await new Client('10.0.3.3').post('/api/auth/login', { email: 'ens.z@exemple.test', password: 'ancien-motdepasse' })).status).toBe(401)
    expect((await accept(reset.data.resetUrl, 'nouveau-motdepasse')).r.status).toBe(200)
    expect((await new Client('10.0.3.4').post('/api/auth/login', { email: 'ens.z@exemple.test', password: 'nouveau-motdepasse' })).status).toBe(200)
  })

  it('compte existant dans une autre école : doit prouver son mot de passe', async () => {
    const inv = await dirB.post(`/api/schools/${schoolB}/invitations`, { email: 'ens.a@exemple.test', displayName: 'Enseignant A', role: 'enseignant' })
    expect((await accept(inv.data.inviteUrl, 'pas-le-bon-mdp')).r.status).toBe(401)
    expect((await accept(inv.data.inviteUrl, 'motdepasse-ens-a')).r.status).toBe(200)
    const c = new Client('10.0.4.4')
    await c.post('/api/auth/login', { email: 'ens.a@exemple.test', password: 'motdepasse-ens-a' })
    expect((await c.get('/api/me')).data.memberships).toHaveLength(2)
  })
})

describe('Suspension', () => {
  it('une école suspendue bloque l’accès de ses membres, puis se réactive', async () => {
    expect((await admin.post(`/api/admin/schools/${schoolB}/status`, { status: 'suspended' })).data.status).toBe('suspended')
    expect((await dirB.get(`/api/schools/${schoolB}/members`)).data.error.code).toBe('SCHOOL_SUSPENDED')
    expect((await admin.post(`/api/admin/schools/${schoolB}/status`, { status: 'active' })).data.status).toBe('active')
    expect((await dirB.get(`/api/schools/${schoolB}/members`)).status).toBe(200)
  })
})

describe('Audit', () => {
  it('les actions sensibles sont journalisées', async () => {
    const { results } = await env.DB.prepare('SELECT action FROM audit_events').all<{ action: string }>()
    const actions = new Set(results.map((r) => r.action))
    for (const a of ['superadmin.setup', 'school.created', 'invitation.accepted', 'member.invited', 'member.revoked', 'member.reset', 'password.reset', 'school.suspended'])
      expect(actions).toContain(a)
  })
})
