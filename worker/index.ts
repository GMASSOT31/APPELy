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
import { archiveMessage, createMessage, getDashboard, getHistory, listMessages, remindCall } from './routes/direction'
import { cancelAbsence, createAbsence, listAbsences } from './routes/absences'
import {
  cancelDistribution,
  createDistribution,
  getDistribution,
  listDistributions,
  prepareDistribution,
  updateDistribution,
} from './routes/distributions'
import { exportHistory } from './routes/exports'
import { createDemoSchool, deleteDemoSchool } from './routes/demo'

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
  // Lot 7 : école de démonstration (données fictives)
  ['POST', /^\/api\/admin\/demo-school$/, (env, req, _p, o) => createDemoSchool(env, req, o)],
  ['POST', new RegExp(`^/api/admin/schools/${ID}/delete-demo$`), (env, req, [s]) => deleteDemoSchool(env, req, s)],
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
  // Lot 4 : direction (tableau de bord, relances, messages, absences prévues, historique)
  ['GET', new RegExp(`^/api/schools/${ID}/dashboard$`), (env, req, [s]) => getDashboard(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/classes/${ID}/calls/${DATE}/${ID}/remind$`), (env, req, [s, c, d, sl]) => remindCall(env, req, s, c, d, sl)],
  ['GET', new RegExp(`^/api/schools/${ID}/messages$`), (env, req, [s]) => listMessages(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/messages$`), (env, req, [s]) => createMessage(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/messages/${ID}/archive$`), (env, req, [s, m]) => archiveMessage(env, req, s, m)],
  ['GET', new RegExp(`^/api/schools/${ID}/absences$`), (env, req, [s]) => listAbsences(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/absences$`), (env, req, [s]) => createAbsence(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/absences/${ID}/cancel$`), (env, req, [s, a]) => cancelAbsence(env, req, s, a)],
  ['GET', new RegExp(`^/api/schools/${ID}/history$`), (env, req, [s]) => getHistory(env, req, s)],
  // Lot 6 : exports de l'historique (CSV, XLSX, page imprimable)
  ['GET', new RegExp(`^/api/schools/${ID}/history/export$`), (env, req, [s]) => exportHistory(env, req, s)],
  // Lot 5 : répartitions temporaires
  ['GET', new RegExp(`^/api/schools/${ID}/distributions$`), (env, req, [s]) => listDistributions(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/distributions/prepare$`), (env, req, [s]) => prepareDistribution(env, req, s)],
  ['POST', new RegExp(`^/api/schools/${ID}/distributions$`), (env, req, [s]) => createDistribution(env, req, s)],
  ['GET', new RegExp(`^/api/schools/${ID}/distributions/${ID}$`), (env, req, [s, p]) => getDistribution(env, req, s, p)],
  ['POST', new RegExp(`^/api/schools/${ID}/distributions/${ID}$`), (env, req, [s, p]) => updateDistribution(env, req, s, p)],
  ['POST', new RegExp(`^/api/schools/${ID}/distributions/${ID}/cancel$`), (env, req, [s, p]) => cancelDistribution(env, req, s, p)],
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

/**
 * En-têtes de sécurité des réponses d'API (lot 6). Les pages et fichiers statiques reçoivent les leurs
 * via `public/_headers` (CSP, HSTS, etc.).
 */
export function withApiHeaders(res: Response): Response {
  const h = res.headers
  h.set('x-content-type-options', 'nosniff')
  h.set('referrer-policy', 'no-referrer')
  h.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  h.set('x-frame-options', 'DENY')
  h.set('cross-origin-resource-policy', 'same-origin')
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  if (!h.has('cache-control')) h.set('cache-control', 'no-store')
  return res
}

export default {
  async fetch(req: Request, env: Env & { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) {
      return withApiHeaders(await handleApi(req, env))
    }
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>
