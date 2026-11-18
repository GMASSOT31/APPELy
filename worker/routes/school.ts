import { audit, nowIso, requireSchoolRole, requireUser, type Env, type Role } from '../lib/auth'
import { badRequest, conflict, email, json, notFound, readJson, str } from '../lib/http'
import { prepareInvitation } from './invitations'

const ROLES: Role[] = ['direction', 'enseignant', 'remplacant']
const MAX_REPLACEMENT_DAYS = 366

export async function listMembers(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  const now = nowIso()
  const members = await env.DB.prepare(
    `SELECT m.id, u.display_name, u.email, m.role, m.active_to, u.id = ? AS is_me
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.school_id = ? AND m.revoked_at IS NULL AND (m.active_to IS NULL OR m.active_to > ?)
      ORDER BY CASE m.role WHEN 'direction' THEN 0 WHEN 'enseignant' THEN 1 ELSE 2 END, u.display_name`,
  )
    .bind(u.id, schoolId, now)
    .all()
  const invitations = await env.DB.prepare(
    `SELECT id, display_name, email, role, access_until, expires_at FROM invitations
      WHERE school_id = ? AND kind = 'invite' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
  )
    .bind(schoolId, now)
    .all()
  return json({ members: members.results, invitations: invitations.results })
}

export async function inviteMember(env: Env, req: Request, schoolId: string, origin: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  const body = await readJson(req)
  const role = body.role as Role
  if (!ROLES.includes(role)) throw badRequest('INVALID_ROLE', 'Rôle invalide.')
  const mail = email(body.email)
  const displayName = str(body.displayName, 'nom', { max: 100 })

  let accessUntil: string | null = null
  if (role === 'remplacant') {
    const d = typeof body.accessUntil === 'string' ? new Date(body.accessUntil) : null
    if (!d || isNaN(d.getTime()) || d.getTime() <= Date.now() || d.getTime() > Date.now() + MAX_REPLACEMENT_DAYS * 86400_000)
      throw badRequest('INVALID_DATE', 'Indiquez une date de fin d’accès valide (moins d’un an).')
    accessUntil = d.toISOString()
  }

  const now = nowIso()
  const already = await env.DB.prepare(
    `SELECT 1 FROM memberships m JOIN users us ON us.id = m.user_id
      WHERE m.school_id = ? AND us.email = ? AND m.revoked_at IS NULL AND (m.active_to IS NULL OR m.active_to > ?)`,
  )
    .bind(schoolId, mail, now)
    .first()
  if (already) throw conflict('ALREADY_MEMBER', 'Cette personne a déjà accès à l’école.')

  const inv = await prepareInvitation(env, {
    kind: 'invite',
    schoolId,
    email: mail,
    displayName,
    role,
    accessUntil,
    invitedBy: u.id,
  })
  await env.DB.batch([
    // Un seul lien actif par personne et par école.
    env.DB.prepare(
      `UPDATE invitations SET revoked_at = ? WHERE school_id = ? AND email = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, schoolId, mail),
    inv.stmt,
    await audit(env, {
      actor: u.id,
      schoolId,
      action: 'member.invited',
      objectType: 'invitation',
      objectId: inv.id,
      details: { role },
    }),
  ])
  return json({ inviteUrl: origin + inv.path }, { status: 201 })
}

export async function revokeInvitation(env: Env, req: Request, schoolId: string, invitationId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  const r = await env.DB.prepare(
    'UPDATE invitations SET revoked_at = ? WHERE id = ? AND school_id = ? AND used_at IS NULL AND revoked_at IS NULL',
  )
    .bind(nowIso(), invitationId, schoolId)
    .run()
  if (r.meta.changes !== 1) throw notFound()
  await (await audit(env, { actor: u.id, schoolId, action: 'invitation.revoked', objectType: 'invitation', objectId: invitationId })).run()
  return json({ ok: true })
}

async function findMember(env: Env, schoolId: string, membershipId: string) {
  const m = await env.DB.prepare(
    'SELECT id, user_id, role FROM memberships WHERE id = ? AND school_id = ? AND revoked_at IS NULL',
  )
    .bind(membershipId, schoolId)
    .first<{ id: string; user_id: string; role: Role }>()
  if (!m) throw notFound()
  return m
}

export async function revokeMember(env: Env, req: Request, schoolId: string, membershipId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  const m = await findMember(env, schoolId, membershipId)
  if (m.user_id === u.id) throw conflict('SELF_REVOKE', 'Vous ne pouvez pas retirer votre propre accès.')
  await env.DB.batch([
    env.DB.prepare('UPDATE memberships SET revoked_at = ? WHERE id = ?').bind(nowIso(), m.id),
    await audit(env, { actor: u.id, schoolId, action: 'member.revoked', objectType: 'membership', objectId: m.id }),
  ])
  return json({ ok: true })
}

/**
 * Réinitialisation forcée : le mot de passe actuel est invalidé, toutes les sessions sont fermées,
 * et un lien à usage unique est remis à la direction. Refusée si la personne a accès à
 * d'autres écoles : une direction ne doit pas agir sur un compte qu'elle ne gère pas seule.
 */
export async function resetMember(env: Env, req: Request, schoolId: string, membershipId: string, origin: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  const m = await findMember(env, schoolId, membershipId)
  if (m.user_id === u.id) throw conflict('SELF_RESET', 'Utilisez « Mot de passe oublié » pour votre propre compte.')
  const target = await env.DB.prepare(
    `SELECT us.email, us.display_name, us.is_superadmin,
            (SELECT COUNT(*) FROM memberships o WHERE o.user_id = us.id AND o.school_id <> ? AND o.revoked_at IS NULL) AS others
       FROM users us WHERE us.id = ?`,
  )
    .bind(schoolId, m.user_id)
    .first<{ email: string; display_name: string; is_superadmin: number; others: number }>()
  if (!target) throw notFound()
  if (target.is_superadmin || target.others > 0)
    throw conflict('SHARED_ACCOUNT', 'Ce compte est utilisé dans une autre école : contactez le support.')
  const now = nowIso()
  const inv = await prepareInvitation(env, {
    kind: 'reset',
    schoolId,
    email: target.email,
    displayName: target.display_name,
    role: m.role,
    accessUntil: null,
    invitedBy: u.id,
  })
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').bind(m.user_id),
    env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, m.user_id),
    env.DB.prepare(
      `UPDATE invitations SET revoked_at = ? WHERE email = ? AND kind = 'reset' AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, target.email),
    inv.stmt,
    await audit(env, { actor: u.id, schoolId, action: 'member.reset', objectType: 'membership', objectId: m.id }),
  ])
  return json({ resetUrl: origin + inv.path })
}
