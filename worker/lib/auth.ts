import { newId, randomToken, sha256 } from './crypto'
import { forbidden, HttpError, unauthorized } from './http'

export interface Env {
  DB: D1Database
  /** Code secret à usage unique pour créer le premier superadmin (variable secrète Cloudflare). */
  ADMIN_SETUP_CODE?: string
}

export type Role = 'direction' | 'enseignant' | 'remplacant'

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  isSuperadmin: boolean
  sessionId: string
}

export const SESSION_COOKIE = 'appely_session'
const SESSION_DAYS = 30

export const nowIso = () => new Date().toISOString()
export const addHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

export async function createSession(env: Env, userId: string): Promise<{ cookie: string }> {
  const token = randomToken()
  await env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(newId(), await sha256(token), userId, nowIso(), addHours(24 * SESSION_DAYS))
    .run()
  return { cookie: sessionCookie(token, SESSION_DAYS * 86400) }
}

export function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export async function getUser(env: Env, req: Request): Promise<CurrentUser | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, u.id, u.email, u.display_name, u.is_superadmin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(await sha256(token), nowIso())
    .first<{ session_id: string; id: string; email: string; display_name: string; is_superadmin: number }>()
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isSuperadmin: row.is_superadmin === 1,
    sessionId: row.session_id,
  }
}

export async function requireUser(env: Env, req: Request): Promise<CurrentUser> {
  const u = await getUser(env, req)
  if (!u) throw unauthorized()
  return u
}

export function requireSuperadmin(u: CurrentUser) {
  if (!u.isSuperadmin) throw forbidden()
}

/**
 * Contrôle d'accès à une école : rattachement actif (non révoqué, dans sa période)
 * à une école active, avec l'un des rôles autorisés. C'est l'équivalent applicatif
 * des politiques RLS : toute route d'école doit passer par ici.
 */
export async function requireSchoolRole(env: Env, u: CurrentUser, schoolId: string, roles: Role[]) {
  const now = nowIso()
  const m = await env.DB.prepare(
    `SELECT m.id, m.role, s.status FROM memberships m JOIN schools s ON s.id = m.school_id
      WHERE m.user_id = ? AND m.school_id = ? AND m.revoked_at IS NULL
        AND m.active_from <= ? AND (m.active_to IS NULL OR m.active_to > ?)`,
  )
    .bind(u.id, schoolId, now, now)
    .first<{ id: string; role: Role; status: string }>()
  if (!m || !roles.includes(m.role)) throw forbidden()
  if (m.status !== 'active') throw new HttpError(403, 'SCHOOL_SUSPENDED', 'Cette école est suspendue.')
  return m
}

export async function audit(
  env: Env,
  e: { actor: string | null; schoolId?: string | null; action: string; objectType?: string; objectId?: string; details?: unknown },
) {
  return env.DB.prepare(
    'INSERT INTO audit_events (id, at, actor_user_id, school_id, action, object_type, object_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    newId(),
    nowIso(),
    e.actor,
    e.schoolId ?? null,
    e.action,
    e.objectType ?? null,
    e.objectId ?? null,
    e.details === undefined ? null : JSON.stringify(e.details),
  )
}

/** Limitation des tentatives : 5 échecs par 15 minutes et par clé (adresse ou IP). */
const WINDOW_MIN = 15
const MAX_FAILURES = 5

export async function checkRateLimit(env: Env, keys: string[]) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString()
  for (const key of keys) {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?')
      .bind(key, since)
      .first<{ n: number }>()
    if ((r?.n ?? 0) >= MAX_FAILURES)
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Trop de tentatives. Réessayez dans 15 minutes.')
  }
}

export async function recordFailure(env: Env, keys: string[]) {
  const at = nowIso()
  await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(k, at)))
}
