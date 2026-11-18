import { type Env } from './lib/auth'
import { ensureMigrated } from './lib/migrate'
import { errorResponse, notFound } from './lib/http'
import { assertSameOrigin, getMe, getSetup, postLogin, postLogout, postSetup } from './routes/auth'
import { acceptInvitation, getInvitation } from './routes/invitations'
import { createSchool, listSchools, reinviteDirection, setSchoolStatus } from './routes/admin'
import { inviteMember, listMembers, resetMember, revokeInvitation, revokeMember } from './routes/school'

type Handler = (env: Env, req: Request, params: string[], origin: string) => Promise<Response>

const ID = '([0-9a-f-]{36})'
const TOKEN = '([A-Za-z0-9_-]{20,100})'

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/setup$/, (env) => getSetup(env)],
  ['POST', /^\/api\/setup$/, (env, req) => postSetup(env, req)],
  ['POST', /^\/api\/auth\/login$/, (env, req) => postLogin(env, req)],
  ['POST', /^\/api\/auth\/logout$/, (env, req) => postLogout(env, req)],
  ['GET', /^\/api\/me$/, (env, req) => getMe(env, req)],
  ['GET', new RegExp(`^/api/invitations/${TOKEN}$`), (env, _r, [t]) => getInvitation(env, t)],
  ['POST', new RegExp(`^/api/invitations/${TOKEN}/accept$`), (env, req, [t]) => acceptInvitation(env, req, t)],
  ['GET', /^\/api\/admin\/schools$/, (env, req) => listSchools(env, req)],
  ['POST', /^\/api\/admin\/schools$/, (env, req, _p, o) => createSchool(env, req, o)],
  ['POST', new RegExp(`^/api/admin/schools/${ID}/invitation$`), (env, req, [s], o) => reinviteDirection(env, req, s, o)],
  ['POST', new RegExp(`^/api/admin/schools/${ID}/status$`), (env, req, [s]) => setSchoolStatus(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/members$`), (env, req, [s]) => listMembers(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/invitations$`), (env, req, [s], o) => inviteMember(env, req, s, o)],
  ['POST', new RegExp(`^/api/schools/${ID}/invitations/${ID}/revoke$`), (env, req, [s, i]) => revokeInvitation(env, req, s, i)],
  ['POST', new RegExp(`^/api/schools/${ID}/members/${ID}/revoke$`), (env, req, [s, m]) => revokeMember(env, req, s, m)],
  ['POST', new RegExp(`^/api/schools/${ID}/members/${ID}/reset$`), (env, req, [s, m], o) => resetMember(env, req, s, m, o)],
]

export async function handleApi(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url)
    if (req.method !== 'GET') assertSameOrigin(req)
    await ensureMigrated(env.DB)
    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re)
      if (m && method === req.method) return await handler(env, req, m.slice(1), url.origin)
    }
    throw notFound()
  } catch (e) {
    return errorResponse(e)
  }
}

export default {
  async fetch(req: Request, env: Env & { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) {
      const res = await handleApi(req, env)
      res.headers.set('x-content-type-options', 'nosniff')
      res.headers.set('referrer-policy', 'no-referrer')
      return res
    }
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>
