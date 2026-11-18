import { addHours, audit, createSession, nowIso, type Env, type Role } from '../lib/auth'
import { hashPassword, newId, randomToken, sha256, verifyPassword } from '../lib/crypto'
import { HttpError, json, password, readJson, str } from '../lib/http'

export const INVITATION_HOURS = 72

export interface NewInvitation {
  kind: 'invite' | 'reset'
  schoolId: string
  email: string
  displayName: string
  role: Role
  accessUntil: string | null
  invitedBy: string | null
}

/** Prépare l'insertion d'une invitation ; renvoie l'instruction SQL et le chemin du lien (jeton en clair, jamais stocké). */
export async function prepareInvitation(env: Env, inv: NewInvitation) {
  const token = randomToken()
  const id = newId()
  const stmt = env.DB.prepare(
    `INSERT INTO invitations (id, token_hash, kind, school_id, email, display_name, role, access_until, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    await sha256(token),
    inv.kind,
    inv.schoolId,
    inv.email,
    inv.displayName,
    inv.role,
    inv.accessUntil,
    inv.invitedBy,
    addHours(INVITATION_HOURS),
    nowIso(),
  )
  return { id, stmt, path: `/invitation/${token}` }
}

interface InvitationRow {
  id: string
  kind: 'invite' | 'reset'
  school_id: string
  school_name: string
  school_status: string
  email: string
  display_name: string
  role: Role
  access_until: string | null
}

async function findValid(env: Env, token: string): Promise<InvitationRow> {
  const row = await env.DB.prepare(
    `SELECT i.id, i.kind, i.school_id, s.name AS school_name, s.status AS school_status, i.email, i.display_name, i.role, i.access_until
       FROM invitations i JOIN schools s ON s.id = i.school_id
      WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
  )
    .bind(await sha256(token), nowIso())
    .first<InvitationRow>()
  if (!row || row.school_status === 'suspended')
    throw new HttpError(410, 'INVITATION_INVALID', 'Ce lien n’est plus valable. Demandez-en un nouveau.')
  return row
}

export async function getInvitation(env: Env, token: string) {
  const inv = await findValid(env, token)
  const existing = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(inv.email).first()
  return json({
    kind: inv.kind,
    schoolName: inv.school_name,
    role: inv.role,
    email: inv.email,
    displayName: inv.display_name,
    accessUntil: inv.access_until,
    existingAccount: inv.kind === 'invite' && !!existing,
  })
}

export async function acceptInvitation(env: Env, req: Request, token: string) {
  const inv = await findValid(env, token)
  const body = await readJson(req)
  const pwd = password(body.password)
  const now = nowIso()
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(inv.email)
    .first<{ id: string; password_hash: string | null }>()

  // Un compte existant (déjà rattaché à une autre école) prouve son identité avec son mot de passe actuel.
  if (inv.kind === 'invite' && user?.password_hash && !(await verifyPassword(pwd, user.password_hash)))
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Ce compte existe déjà : saisissez son mot de passe actuel.')
  if (inv.kind === 'reset' && !user) throw new HttpError(410, 'INVITATION_INVALID', 'Ce lien n’est plus valable.')

  // Consommation atomique du lien : un seul usage même en cas de double clic.
  const claim = await env.DB.prepare('UPDATE invitations SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(now, inv.id)
    .run()
  if (claim.meta.changes !== 1) throw new HttpError(410, 'INVITATION_INVALID', 'Ce lien a déjà été utilisé.')

  const userId = user?.id ?? newId()
  const stmts: D1PreparedStatement[] = []
  try {
    if (inv.kind === 'reset') {
      stmts.push(
        env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pwd), userId),
        env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId),
        await audit(env, { actor: userId, schoolId: inv.school_id, action: 'password.reset', objectType: 'user', objectId: userId }),
      )
    } else {
      if (!user) {
        const name = body.displayName === undefined ? inv.display_name : str(body.displayName, 'nom', { max: 100 })
        stmts.push(
          env.DB.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(
            userId,
            inv.email,
            name,
            await hashPassword(pwd),
            now,
          ),
        )
      } else if (!user.password_hash) {
        // Compte en cours de réinitialisation : seul son lien de réinitialisation peut fixer le mot de passe.
        throw new HttpError(409, 'ACCOUNT_RESET_PENDING', 'Ce compte attend une réinitialisation de mot de passe.')
      }
      stmts.push(
        env.DB.prepare(
          `INSERT INTO memberships (id, user_id, school_id, role, active_from, active_to, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, school_id) DO UPDATE SET
             role = excluded.role, active_from = excluded.active_from, active_to = excluded.active_to, revoked_at = NULL`,
        ).bind(newId(), userId, inv.school_id, inv.role, now, inv.access_until, now),
        await audit(env, {
          actor: userId,
          schoolId: inv.school_id,
          action: 'invitation.accepted',
          objectType: 'invitation',
          objectId: inv.id,
          details: { role: inv.role },
        }),
      )
      if (inv.role === 'direction')
        stmts.push(env.DB.prepare(`UPDATE schools SET status = 'active' WHERE id = ? AND status = 'invited'`).bind(inv.school_id))
    }
    await env.DB.batch(stmts)
  } catch (e) {
    // Le lot a échoué (transaction annulée) : on rend le lien à nouveau utilisable.
    await env.DB.prepare('UPDATE invitations SET used_at = NULL WHERE id = ?').bind(inv.id).run()
    throw e
  }
  const { cookie } = await createSession(env, userId)
  return json({ ok: true }, { headers: { 'set-cookie': cookie } })
}
