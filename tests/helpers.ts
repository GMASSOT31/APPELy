/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
import { getPlatformProxy } from 'wrangler'
import { handleApi } from '../worker/index'
import type { Env } from '../worker/lib/auth'

export const ORIGIN = 'https://appely.test'
export const SETUP_CODE = 'code-de-test-123456'

export class Client {
  cookie = ''
  env: Env
  ip: string
  constructor(env: Env, ip = '10.0.0.1') {
    this.env = env
    this.ip = ip
  }
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip }
    if (this.cookie) headers.cookie = this.cookie
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await handleApi(
      new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      this.env,
    )
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    return { status: res.status, data: (await res.json()) as any }
  }
  /** Réponse brute (fichiers d'export). */
  async raw(path: string, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'cf-connecting-ip': this.ip, ...headers }
    if (this.cookie) h.cookie = this.cookie
    return handleApi(new Request(ORIGIN + path, { headers: h }), this.env)
  }
  get = (p: string) => this.call('GET', p)
  post = (p: string, b: unknown = {}) => this.call('POST', p, b)
}

/** Base D1 locale vierge + un superadmin, et une fonction pour créer une école avec sa direction. */
export async function setupWorld() {
  const proxy = await getPlatformProxy({ persist: false })
  const env: Env = { DB: (proxy.env as { DB: D1Database }).DB, ADMIN_SETUP_CODE: SETUP_CODE }
  const admin = new Client(env)
  await admin.post('/api/setup', { code: SETUP_CODE, email: 'admin@exemple.test', displayName: 'Admin', password: 'motdepasse-admin' })
  let n = 0
  async function accept(url: string, password: string) {
    const c = new Client(env, `10.1.${n}.${n++}`)
    const r = await c.post(`/api/invitations/${url.split('/invitation/')[1]}/accept`, { password })
    if (r.status !== 200) throw new Error(JSON.stringify(r.data))
    return c
  }
  async function school(name: string) {
    const r = await admin.post('/api/admin/schools', { name, directionEmail: `dir.${n}@exemple.test` })
    const dir = await accept(r.data.inviteUrl, 'motdepasse-direction')
    return { id: r.data.school.id as string, dir }
  }
  async function member(schoolId: string, dir: Client, role: string, extra: object = {}) {
    const email = `p${n}.${role}@exemple.test`
    const r = await dir.post(`/api/schools/${schoolId}/invitations`, { email, displayName: `Personne ${n}`, role, ...extra })
    const c = await accept(r.data.inviteUrl, 'motdepasse-personne')
    const members = (await dir.get(`/api/schools/${schoolId}/members`)).data.members
    return { client: c, membershipId: members.find((m: any) => m.email === email).id as string }
  }
  return { proxy, env, admin, school, member }
}
