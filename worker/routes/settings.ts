import { audit, nowIso, requireSchoolRole, requireUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, json, notFound, readJson, str } from '../lib/http'
import { isValidDate } from '../../src/domain/schedule'

export const STATUS_COLORS = ['success', 'danger', 'primary', 'amber', 'violet', 'neutral'] as const
const CATEGORIES = ['PRESENT', 'ABSENT', 'AUTRE'] as const

async function direction(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  return u
}

/** États par défaut : Présent / Absent, créés à la première consultation. */
export async function ensureDefaultStatuses(env: Env, schoolId: string) {
  const any = await env.DB.prepare('SELECT 1 FROM attendance_statuses WHERE school_id = ? LIMIT 1').bind(schoolId).first()
  if (any) return
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO attendance_statuses (id, school_id, label, color, category, position, created_at) VALUES (?, ?, 'Présent', 'success', 'PRESENT', 0, ?)`,
    ).bind(newId(), schoolId, now),
    env.DB.prepare(
      `INSERT INTO attendance_statuses (id, school_id, label, color, category, position, created_at) VALUES (?, ?, 'Absent', 'danger', 'ABSENT', 1, ?)`,
    ).bind(newId(), schoolId, now),
  ])
}

export async function getSettings(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  await ensureDefaultStatuses(env, schoolId)
  const [school, statuses, closures] = await env.DB.batch([
    env.DB.prepare('SELECT name, closed_weekdays FROM schools WHERE id = ?').bind(schoolId),
    env.DB.prepare(
      'SELECT id, label, color, category, position FROM attendance_statuses WHERE school_id = ? AND archived_at IS NULL ORDER BY position',
    ).bind(schoolId),
    env.DB.prepare(
      'SELECT id, start_date, end_date, label FROM school_closures WHERE school_id = ? AND end_date >= ? ORDER BY start_date',
    ).bind(schoolId, nowIso().slice(0, 10)),
  ])
  const s = school.results[0] as { name: string; closed_weekdays: number }
  return json({ closedWeekdays: s.closed_weekdays, statuses: statuses.results, closures: closures.results })
}

export async function setClosedWeekdays(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const { closedWeekdays } = await readJson(req)
  if (typeof closedWeekdays !== 'number' || !Number.isInteger(closedWeekdays) || closedWeekdays < 0 || closedWeekdays >= 1 << 7)
    throw badRequest('INVALID_WEEKDAYS', 'Jours invalides.')
  await env.DB.batch([
    env.DB.prepare('UPDATE schools SET closed_weekdays = ? WHERE id = ?').bind(closedWeekdays, schoolId),
    await audit(env, { actor: u.id, schoolId, action: 'school.weekdays', details: { closedWeekdays } }),
  ])
  return json({ ok: true })
}

export async function addClosure(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson(req)
  const label = str(body.label, 'motif', { max: 60 })
  const start = body.startDate
  const end = body.endDate ?? body.startDate
  if (!isValidDate(start) || !isValidDate(end) || end < start) throw badRequest('INVALID_DATE', 'Dates invalides.')
  const id = newId()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO school_closures (id, school_id, start_date, end_date, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      schoolId,
      start,
      end,
      label,
      nowIso(),
    ),
    await audit(env, { actor: u.id, schoolId, action: 'closure.created', objectType: 'closure', objectId: id }),
  ])
  return json({ id }, { status: 201 })
}

export async function deleteClosure(env: Env, req: Request, schoolId: string, closureId: string) {
  const u = await direction(env, req, schoolId)
  const r = await env.DB.prepare('DELETE FROM school_closures WHERE id = ? AND school_id = ?').bind(closureId, schoolId).run()
  if (r.meta.changes !== 1) throw notFound()
  await (await audit(env, { actor: u.id, schoolId, action: 'closure.deleted', objectType: 'closure', objectId: closureId })).run()
  return json({ ok: true })
}

function statusFields(body: Record<string, unknown>) {
  const label = str(body.label, 'libellé', { max: 30 })
  if (!(STATUS_COLORS as readonly unknown[]).includes(body.color)) throw badRequest('INVALID_COLOR', 'Couleur invalide.')
  if (!(CATEGORIES as readonly unknown[]).includes(body.category))
    throw badRequest('INVALID_CATEGORY', 'Chaque état doit être relié à Présent, Absent ou Autre.')
  return { label, color: body.color as string, category: body.category as string }
}

async function activeStatuses(env: Env, schoolId: string) {
  const { results } = await env.DB.prepare(
    'SELECT id, category, position FROM attendance_statuses WHERE school_id = ? AND archived_at IS NULL ORDER BY position',
  )
    .bind(schoolId)
    .all<{ id: string; category: string; position: number }>()
  return results
}

/** Il doit toujours rester au moins un état « Présent » et un état « Absent » actifs. */
function assertCoverage(statuses: { category: string }[]) {
  if (!statuses.some((s) => s.category === 'PRESENT') || !statuses.some((s) => s.category === 'ABSENT'))
    throw conflict('STATUS_COVERAGE', 'Il faut garder au moins un état Présent et un état Absent.')
}

export async function createStatus(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  await ensureDefaultStatuses(env, schoolId)
  const f = statusFields(await readJson(req))
  const list = await activeStatuses(env, schoolId)
  if (list.length >= 6) throw conflict('TOO_MANY_STATUSES', 'Six états au maximum, pour garder l’appel rapide.')
  const id = newId()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO attendance_statuses (id, school_id, label, color, category, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, schoolId, f.label, f.color, f.category, (list.at(-1)?.position ?? -1) + 1, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'status.created', objectType: 'status', objectId: id }),
  ])
  return json({ id }, { status: 201 })
}

export async function updateStatus(env: Env, req: Request, schoolId: string, statusId: string) {
  const u = await direction(env, req, schoolId)
  const f = statusFields(await readJson(req))
  const list = await activeStatuses(env, schoolId)
  if (!list.some((s) => s.id === statusId)) throw notFound()
  assertCoverage(list.map((s) => (s.id === statusId ? { category: f.category } : s)))
  await env.DB.batch([
    env.DB.prepare('UPDATE attendance_statuses SET label = ?, color = ?, category = ? WHERE id = ?').bind(f.label, f.color, f.category, statusId),
    await audit(env, { actor: u.id, schoolId, action: 'status.updated', objectType: 'status', objectId: statusId }),
  ])
  return json({ ok: true })
}

export async function moveStatus(env: Env, req: Request, schoolId: string, statusId: string) {
  const u = await direction(env, req, schoolId)
  const { direction: dir } = await readJson(req)
  if (dir !== 'up' && dir !== 'down') throw badRequest('INVALID_DIRECTION', 'Direction invalide.')
  const list = await activeStatuses(env, schoolId)
  const i = list.findIndex((s) => s.id === statusId)
  if (i < 0) throw notFound()
  const j = dir === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return json({ ok: true })
  ;[list[i], list[j]] = [list[j], list[i]]
  await env.DB.batch([
    ...list.map((s, pos) => env.DB.prepare('UPDATE attendance_statuses SET position = ? WHERE id = ?').bind(pos, s.id)),
    await audit(env, { actor: u.id, schoolId, action: 'status.moved', objectType: 'status', objectId: statusId }),
  ])
  return json({ ok: true })
}

/** Un état n'est jamais supprimé : il est archivé, l'historique des appels reste lisible. */
export async function archiveStatus(env: Env, req: Request, schoolId: string, statusId: string) {
  const u = await direction(env, req, schoolId)
  const list = await activeStatuses(env, schoolId)
  if (!list.some((s) => s.id === statusId)) throw notFound()
  assertCoverage(list.filter((s) => s.id !== statusId))
  await env.DB.batch([
    env.DB.prepare('UPDATE attendance_statuses SET archived_at = ? WHERE id = ?').bind(nowIso(), statusId),
    await audit(env, { actor: u.id, schoolId, action: 'status.archived', objectType: 'status', objectId: statusId }),
  ])
  return json({ ok: true })
}
