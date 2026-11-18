import { type Env } from './lib/auth'
import { ensureMigrated } from './lib/migrate'
import { errorResponse, notFound } from './lib/http'
import { assertSameOrigin, getMe, getSetup, postLogin, postLogout, postSetup } from './routes/auth'
import { acceptInvitation, getInvitation } from './routes/invitations'
import { createSchool, listSchools, reinviteDirection, setSchoolStatus } from './routes/admin'
import { inviteMember, listMembers, resetMember, revokeInvitation, revokeMember } from './routes/school'
import {
  addStudent,
  archiveClass,
  archiveSlot,
  assignTeacher,
  cancelImport,
  createClass,
  createSlot,
  getClass,
  getOverview,
  importStudents,
  myClasses,
  setClassSchedule,
  setSchedule,
  studentLeaves,
  unassignTeacher,
  updateClass,
  updateSlot,
  updateStudent,
} from './routes/classes'
import {
  addClosure,
  archiveStatus,
  createStatus,
  deleteClosure,
  getSettings,
  moveStatus,
  setClosedWeekdays,
  updateStatus,
} from './routes/settings'
import { getCall, myDay, validateCall } from './routes/calls'

type Handler = (env: Env, req: Request, params: string[], origin: string) => Promise<Response>

const ID = '([0-9a-f-]{36})'
const TOKEN = '([A-Za-z0-9_-]{20,100})'
const DATE = '(\\d{4}-\\d{2}-\\d{2})'

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
  // Lot 2 : classes, élèves, créneaux, réglages, import
  ['GET', new RegExp(`^/api/schools/${ID}/overview$`), (env, req, [s]) => getOverview(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/my-classes$`), (env, req, [s]) => myClasses(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes$`), (env, req, [s]) => createClass(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/classes/${ID}$`), (env, req, [s, c]) => getClass(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}$`), (env, req, [s, c]) => updateClass(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/archive$`), (env, req, [s, c]) => archiveClass(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/teachers$`), (env, req, [s, c]) => assignTeacher(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/teachers/${ID}/remove$`), (env, req, [s, c, a]) => unassignTeacher(env, req, s, c, a)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/students$`), (env, req, [s, c]) => addStudent(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/schedule$`), (env, req, [s, c]) => setClassSchedule(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/slots$`), (env, req, [s, c]) => createSlot(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/slots/${ID}$`), (env, req, [s, c, sl]) => updateSlot(env, req, s, c, sl)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/slots/${ID}/archive$`), (env, req, [s, c, sl]) => archiveSlot(env, req, s, c, sl)],
  ['POST', new RegExp(`^/api/schools/${ID}/students/${ID}$`), (env, req, [s, st]) => updateStudent(env, req, s, st)],
  ['POST', new RegExp(`^/api/schools/${ID}/students/${ID}/leave$`), (env, req, [s, st]) => studentLeaves(env, req, s, st)],
  ['POST', new RegExp(`^/api/schools/${ID}/students/${ID}/schedule$`), (env, req, [s, st]) => setSchedule(env, req, s, st)],
  ['POST', new RegExp(`^/api/schools/${ID}/imports$`), (env, req, [s]) => importStudents(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/imports/${ID}/cancel$`), (env, req, [s, i]) => cancelImport(env, req, s, i)],
  ['GET', new RegExp(`^/api/schools/${ID}/settings$`), (env, req, [s]) => getSettings(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/settings/weekdays$`), (env, req, [s]) => setClosedWeekdays(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/closures$`), (env, req, [s]) => addClosure(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/closures/${ID}/delete$`), (env, req, [s, c]) => deleteClosure(env, req, s, c)],
  ['POST', new RegExp(`^/api/schools/${ID}/statuses$`), (env, req, [s]) => createStatus(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/statuses/${ID}$`), (env, req, [s, st]) => updateStatus(env, req, s, st)],
  ['POST', new RegExp(`^/api/schools/${ID}/statuses/${ID}/move$`), (env, req, [s, st]) => moveStatus(env, req, s, st)],
  ['POST', new RegExp(`^/api/schools/${ID}/statuses/${ID}/archive$`), (env, req, [s, st]) => archiveStatus(env, req, s, st)],
  // Lot 3 : appel
  ['GET', new RegExp(`^/api/schools/${ID}/my-day$`), (env, req, [s]) => myDay(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/classes/${ID}/calls/${DATE}/${ID}$`), (env, req, [s, c, d, sl]) => getCall(env, req, s, c, d, sl)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/calls/${DATE}/${ID}/validate$`), (env, req, [s, c, d, sl]) => validateCall(env, req, s, c, d, sl)],
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
