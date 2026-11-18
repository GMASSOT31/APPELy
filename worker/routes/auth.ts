import {
  audit,
  checkRateLimit,
  createSession,
  getUser,
  nowIso,
  recordFailure,
  requireUser,
  sessionCookie,
  type Env,
} from '../lib/auth'
import { hashPassword, newId, timingSafeEqualStrings, verifyPassword } from '../lib/crypto'
import { badRequest, conflict, email, forbidden, HttpError, json, password, readJson, str } from '../lib/http'

async function superadminExists(env: Env) {
  return !!(await env.DB.prepare('SELECT 1 FROM users WHERE is_superadmin = 1 LIMIT 1').first())
}

export async function getSetup(env: Env) {
  return json({ needed: !(await superadminExists(env)), configured: !!env.ADMIN_SETUP_CODE })
}

/** Création du tout premier superadmin, protégée par le code secret ADMIN_SETUP_CODE. */
export async function postSetup(env: Env, req: Request) {
  if (!env.ADMIN_SETUP_CODE) throw new HttpError(503, 'SETUP_NOT_CONFIGURED', 'Installation non configurée.')
  if (await superadminExists(env)) throw conflict('ALREADY_SETUP', 'L’installation est déjà faite.')
  const body = await readJson(req)
  const ip = req.headers.get('cf-connecting-ip') ?? 'local'
  await checkRateLimit(env, [`setup:${ip}`])
  const code = typeof body.code === 'string' ? body.code : ''
  if (!timingSafeEqualStrings(code, env.ADMIN_SETUP_CODE)) {
    await recordFailure(env, [`setup:${ip}`])
    throw forbidden()
  }
  const id = newId()
  const mail = email(body.email)
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, email, display_name, password_hash, is_superadmin, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(id, mail, str(body.displayName, 'nom'), await hashPassword(password(body.password)), nowIso()),
    await audit(env, { actor: id, action: 'superadmin.setup', objectType: 'user', objectId: id }),
  ])
  const { cookie } = await createSession(env, id)
  return json({ ok: true }, { headers: { 'set-cookie': cookie } })
}

export async function postLogin(env: Env, req: Request) {
  const body = await readJson(req)
  const mail = email(body.email)
  const pwd = typeof body.password === 'string' ? body.password : ''
  const keys = [`email:${mail}`, `ip:${req.headers.get('cf-connecting-ip') ?? 'local'}`]
  await checkRateLimit(env, keys)
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(mail)
    .first<{ id: string; password_hash: string | null }>()
  const ok = await verifyPassword(pwd, user?.password_hash ?? null)
  if (!user || !ok) {
    await recordFailure(env, keys)
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect.')
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(keys[0]),
    // Journal des accès (lot 6) : connexion réussie, sans adresse IP ni appareil (données minimisées).
    await audit(env, { actor: user.id, action: 'auth.login', objectType: 'user', objectId: user.id }),
  ])
  const { cookie } = await createSession(env, user.id)
  return json({ ok: true }, { headers: { 'set-cookie': cookie } })
}

export async function postLogout(env: Env, req: Request) {
  const u = await getUser(env, req)
  if (u) await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(nowIso(), u.sessionId).run()
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie('', 0) } })
}

export async function getMe(env: Env, req: Request) {
  const u = await requireUser(env, req)
  const now = nowIso()
  const { results } = await env.DB.prepare(
    `SELECT m.school_id, s.name AS school_name, s.status, m.role, m.active_to
       FROM memberships m JOIN schools s ON s.id = m.school_id
      WHERE m.user_id = ? AND m.revoked_at IS NULL AND m.active_from <= ? AND (m.active_to IS NULL OR m.active_to > ?)
      ORDER BY s.name`,
  )
    .bind(u.id, now, now)
    .all<{ school_id: string; school_name: string; status: string; role: string; active_to: string | null }>()
  return json({
    user: { id: u.id, email: u.email, displayName: u.displayName, isSuperadmin: u.isSuperadmin },
    memberships: results.map((r) => ({
      schoolId: r.school_id,
      schoolName: r.school_name,
      schoolStatus: r.status,
      role: r.role,
      activeTo: r.active_to,
    })),
  })
}

export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(req.url).origin) throw forbidden()
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.startsWith('application/json')) throw badRequest('INVALID_CONTENT_TYPE', 'Requête invalide.')
}
