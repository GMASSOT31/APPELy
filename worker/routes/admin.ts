import { audit, nowIso, requireSuperadmin, requireUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, email, json, notFound, optStr, readJson, str } from '../lib/http'
import { prepareInvitation } from './invitations'

export function academicYear(d = new Date()): string {
  const y = d.getUTCFullYear()
  return d.getUTCMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'ecole'
  )
}

/** Liste des écoles pour le superadmin : métadonnées et compteurs, jamais de nom d'élève. */
export async function listSchools(env: Env, req: Request) {
  requireSuperadmin(await requireUser(env, req))
  const now = nowIso()
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.slug, s.uai, s.status, s.is_demo, s.created_at,
            (SELECT COUNT(*) FROM memberships m WHERE m.school_id = s.id AND m.revoked_at IS NULL
               AND (m.active_to IS NULL OR m.active_to > ?)) AS members
       FROM schools s ORDER BY s.created_at DESC`,
  )
    .bind(now)
    .all()
  return json({ schools: results })
}

export async function createSchool(env: Env, req: Request, origin: string) {
  const admin = await requireUser(env, req)
  requireSuperadmin(admin)
  const body = await readJson(req)
  const name = str(body.name, 'nom de l’école', { max: 120 })
  const uai = optStr(body.uai, 'code UAI', { max: 20 })
  if (uai && !/^[0-9]{7}[A-Za-z]$/.test(uai)) throw badRequest('INVALID_UAI', 'Code UAI invalide (7 chiffres + 1 lettre).')
  const directionEmail = email(body.directionEmail)
  const directionName = str(body.directionName ?? 'Direction', 'nom de la direction', { max: 100 })

  let slug = slugify(name)
  if (await env.DB.prepare('SELECT 1 FROM schools WHERE slug = ?').bind(slug).first())
    slug = `${slug}-${newId().slice(0, 6)}`

  const id = newId()
  const inv = await prepareInvitation(env, {
    kind: 'invite',
    schoolId: id,
    email: directionEmail,
    displayName: directionName,
    role: 'direction',
    accessUntil: null,
    invitedBy: admin.id,
  })
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO schools (id, slug, name, uai, academic_year, status, created_at) VALUES (?, ?, ?, ?, ?, 'invited', ?)`,
    ).bind(id, slug, name, uai?.toUpperCase() ?? null, academicYear(), nowIso()),
    inv.stmt,
    await audit(env, { actor: admin.id, schoolId: id, action: 'school.created', objectType: 'school', objectId: id }),
  ])
  return json({ school: { id, name, slug, status: 'invited' }, inviteUrl: origin + inv.path }, { status: 201 })
}

/** Nouveau lien d'invitation Direction (les précédents liens Direction non utilisés sont révoqués). */
export async function reinviteDirection(env: Env, req: Request, schoolId: string, origin: string) {
  const admin = await requireUser(env, req)
  requireSuperadmin(admin)
  const school = await env.DB.prepare('SELECT id FROM schools WHERE id = ?').bind(schoolId).first()
  if (!school) throw notFound()
  const body = await readJson(req)
  const inv = await prepareInvitation(env, {
    kind: 'invite',
    schoolId,
    email: email(body.directionEmail),
    displayName: str(body.directionName ?? 'Direction', 'nom', { max: 100 }),
    role: 'direction',
    accessUntil: null,
    invitedBy: admin.id,
  })
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE invitations SET revoked_at = ? WHERE school_id = ? AND role = 'direction' AND kind = 'invite'
         AND used_at IS NULL AND revoked_at IS NULL AND invited_by = ?`,
    ).bind(nowIso(), schoolId, admin.id),
    inv.stmt,
    await audit(env, { actor: admin.id, schoolId, action: 'school.reinvited', objectType: 'school', objectId: schoolId }),
  ])
  return json({ inviteUrl: origin + inv.path })
}

export async function setSchoolStatus(env: Env, req: Request, schoolId: string) {
  const admin = await requireUser(env, req)
  requireSuperadmin(admin)
  const body = await readJson(req)
  if (body.status !== 'active' && body.status !== 'suspended') throw badRequest('INVALID_STATUS', 'Statut invalide.')
  const school = await env.DB.prepare('SELECT status FROM schools WHERE id = ?').bind(schoolId).first<{ status: string }>()
  if (!school) throw notFound()
  let status: string = body.status
  if (status === 'active') {
    // Réactivation : l'école redevient « en attente » tant qu'aucune direction n'a activé son compte.
    const hasDirection = await env.DB.prepare(
      `SELECT 1 FROM memberships WHERE school_id = ? AND role = 'direction' AND revoked_at IS NULL`,
    )
      .bind(schoolId)
      .first()
    status = hasDirection ? 'active' : 'invited'
  }
  if (school.status === status) throw conflict('UNCHANGED', 'Aucun changement.')
  await env.DB.batch([
    env.DB.prepare('UPDATE schools SET status = ? WHERE id = ?').bind(status, schoolId),
    await audit(env, { actor: admin.id, schoolId, action: `school.${status}`, objectType: 'school', objectId: schoolId }),
  ])
  return json({ status })
}
