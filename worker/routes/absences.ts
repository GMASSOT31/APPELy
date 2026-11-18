import { audit, nowIso, requireSchoolRole, requireUser, type CurrentUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, forbidden, json, notFound, readJson } from '../lib/http'
import { schoolToday } from '../lib/day'
import { isValidDate, levelRank } from '../../src/domain/schedule'
import { daysBetween, PLANNED_MAX_DAYS, PLANNED_REASONS } from '../../src/domain/direction'

/**
 * Absences prévues (§8.3) : la direction, ou un enseignant / remplaçant affecté à la classe de l'élève
 * (« enseignant habilité »), enregistre une absence datée pour préparer l'appel.
 * Renvoie l'identifiant des classes accessibles (null = toutes, pour la direction).
 */
async function absenceAccess(env: Env, u: CurrentUser, schoolId: string) {
  const m = await requireSchoolRole(env, u, schoolId, ['direction', 'enseignant', 'remplacant'])
  if (m.role === 'direction') return null
  const now = nowIso()
  const { results } = await env.DB.prepare(
    `SELECT a.class_id FROM teacher_class_assignments a JOIN classes c ON c.id = a.class_id
      WHERE a.membership_id = ? AND a.start_at <= ? AND (a.end_at IS NULL OR a.end_at > ?) AND c.archived_at IS NULL`,
  )
    .bind(m.id, now, now)
    .all<{ class_id: string }>()
  return new Set(results.map((r) => r.class_id))
}

async function timezone(env: Env, schoolId: string) {
  const s = await env.DB.prepare('SELECT timezone FROM schools WHERE id = ?').bind(schoolId).first<{ timezone: string }>()
  return s?.timezone ?? 'Europe/Paris'
}

/** Absences en cours et à venir des classes accessibles, avec la liste des élèves pour en ajouter. */
export async function listAbsences(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  const allowed = await absenceAccess(env, u, schoolId)
  const today = schoolToday(await timezone(env, schoolId))
  const [classesR, studentsR, absR] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, levels FROM classes WHERE school_id = ? AND archived_at IS NULL').bind(schoolId),
    env.DB.prepare(
      `SELECT id, class_id, first_name, last_name FROM students WHERE school_id = ? AND (active_to IS NULL OR active_to >= ?)
        ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE`,
    ).bind(schoolId, today),
    env.DB.prepare(
      `SELECT pa.id, pa.student_id, pa.start_date, pa.end_date, pa.half_days, pa.reason, pa.created_at,
              s.first_name, s.last_name, s.class_id, u.display_name AS author
         FROM planned_absences pa JOIN students s ON s.id = pa.student_id JOIN users u ON u.id = pa.created_by
        WHERE pa.school_id = ? AND pa.cancelled_at IS NULL AND pa.end_date >= ?
        ORDER BY pa.start_date, s.first_name COLLATE NOCASE`,
    ).bind(schoolId, today),
  ])
  const ok = (classId: string) => !allowed || allowed.has(classId)
  const students = studentsR.results as { id: string; class_id: string; first_name: string; last_name: string | null }[]
  const classes = (classesR.results as { id: string; name: string; levels: string }[])
    .filter((c) => ok(c.id))
    .map((c) => ({ id: c.id, name: c.name, levels: JSON.parse(c.levels) as string[] }))
    .sort((a, b) => levelRank(a.levels) - levelRank(b.levels) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
  const className = new Map(classes.map((c) => [c.id, c.name]))
  return json({
    today,
    reasons: PLANNED_REASONS,
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      students: students.filter((s) => s.class_id === c.id).map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name })),
    })),
    absences: (
      absR.results as {
        id: string
        student_id: string
        start_date: string
        end_date: string
        half_days: string
        reason: string
        created_at: string
        first_name: string
        last_name: string | null
        class_id: string
        author: string
      }[]
    )
      .filter((a) => ok(a.class_id))
      .map((a) => ({
        id: a.id,
        studentId: a.student_id,
        studentName: `${a.first_name} ${a.last_name ?? ''}`.trim(),
        classId: a.class_id,
        className: className.get(a.class_id) ?? '',
        startDate: a.start_date,
        endDate: a.end_date,
        halfDays: a.half_days,
        reason: a.reason,
        author: a.author,
        createdAt: a.created_at,
      })),
  })
}

async function findStudent(env: Env, schoolId: string, studentId: string) {
  const s = await env.DB.prepare('SELECT id, class_id FROM students WHERE id = ? AND school_id = ?')
    .bind(studentId, schoolId)
    .first<{ id: string; class_id: string }>()
  if (!s) throw notFound()
  return s
}

export async function createAbsence(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  const allowed = await absenceAccess(env, u, schoolId)
  const b = await readJson<Record<string, unknown>>(req)
  if (typeof b.studentId !== 'string') throw badRequest('INVALID_FIELD', 'Choisissez un élève.')
  const student = await findStudent(env, schoolId, b.studentId)
  if (allowed && !allowed.has(student.class_id)) throw forbidden()
  const today = schoolToday(await timezone(env, schoolId))
  const start = b.startDate
  const end = b.endDate ?? start
  if (!isValidDate(start) || !isValidDate(end)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (end < start) throw badRequest('INVALID_DATE', 'La date de fin doit suivre la date de début.')
  if (end < today) throw badRequest('INVALID_DATE', 'Une absence prévue concerne aujourd’hui ou un jour à venir.')
  if (daysBetween(start, end) >= PLANNED_MAX_DAYS) throw badRequest('INVALID_DATE', `Absence prévue limitée à ${PLANNED_MAX_DAYS} jours.`)
  const half = b.halfDays ?? 'day'
  if (half !== 'day' && half !== 'am' && half !== 'pm') throw badRequest('INVALID_FIELD', 'Demi-journée invalide.')
  // Motif choisi dans la liste : aucun texte libre (pas d'information de santé).
  if (!PLANNED_REASONS.includes(b.reason as never)) throw badRequest('INVALID_REASON', 'Choisissez un motif dans la liste.')
  const id = newId()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO planned_absences (id, school_id, student_id, start_date, end_date, half_days, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, schoolId, student.id, start, end, half, b.reason as string, u.id, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'absence.planned', objectType: 'student', objectId: student.id, details: { start, end, half } }),
  ])
  return json({ id }, { status: 201 })
}

export async function cancelAbsence(env: Env, req: Request, schoolId: string, absenceId: string) {
  const u = await requireUser(env, req)
  const allowed = await absenceAccess(env, u, schoolId)
  const a = await env.DB.prepare(
    `SELECT pa.id, s.class_id FROM planned_absences pa JOIN students s ON s.id = pa.student_id
      WHERE pa.id = ? AND pa.school_id = ? AND pa.cancelled_at IS NULL`,
  )
    .bind(absenceId, schoolId)
    .first<{ id: string; class_id: string }>()
  if (!a) throw notFound()
  if (allowed && !allowed.has(a.class_id)) throw forbidden()
  await env.DB.batch([
    env.DB.prepare('UPDATE planned_absences SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND cancelled_at IS NULL').bind(
      nowIso(),
      u.id,
      absenceId,
    ),
    await audit(env, { actor: u.id, schoolId, action: 'absence.cancelled', objectType: 'planned_absence', objectId: absenceId }),
  ])
  return json({ ok: true })
}
