import { audit, nowIso, requireSuperadmin, requireUser, type Env } from '../lib/auth'
import { hashPassword, newId } from '../lib/crypto'
import { conflict, json, notFound } from '../lib/http'
import { schoolToday } from '../lib/day'
import { academicYear, slugify } from './admin'
import {
  addDays,
  buildDemoData,
  DEMO_CLOSED_WEEKDAYS,
  DEMO_SCHOOL_NAME,
  DEMO_SLOT_WEEKDAYS,
  demoPassword,
  schoolYearStart,
} from '../lib/demo'

/**
 * Lot 7 : école de démonstration (superadmin). Crée en un seul lot transactionnel une école fictive complète :
 * direction, deux enseignants, un remplaçant, 7 classes, ~160 élèves inventés, créneaux, historique d'appels,
 * un message et une absence prévue. Les identifiants sont renvoyés une seule fois (le mot de passe n'est stocké
 * que haché). Une seule école de démonstration à la fois : la supprimer pour la recréer.
 * Coût D1 : ~20 requêtes (insertions en masse par json_each).
 */
export async function createDemoSchool(env: Env, req: Request, origin: string) {
  const admin = await requireUser(env, req)
  requireSuperadmin(admin)
  const existing = await env.DB.prepare('SELECT id FROM schools WHERE is_demo = 1').first()
  if (existing) throw conflict('DEMO_EXISTS', 'Une école de démonstration existe déjà : supprimez-la pour la recréer.')

  const today = schoolToday()
  const random = crypto.getRandomValues(new Uint8Array(16))
  const code = [...random.slice(12)].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
  const password = demoPassword(random)
  // Un seul calcul PBKDF2 (temps CPU limité) : les comptes de démonstration partagent le même mot de passe.
  const hash = await hashPassword(password)
  const d = buildDemoData(today, code, newId)
  const schoolId = newId()
  const now = nowIso()
  const year = academicYear()
  const yearStart = schoolYearStart(today)
  const presentId = newId()
  const absentId = newId()
  const db = env.DB
  const J = JSON.stringify

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO schools (id, slug, name, academic_year, status, closed_weekdays, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, 1, ?)`,
    ).bind(schoolId, `${slugify(DEMO_SCHOOL_NAME)}-${code}`, DEMO_SCHOOL_NAME, year, DEMO_CLOSED_WEEKDAYS, now),
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at)
       SELECT json_extract(value, '$.userId'), json_extract(value, '$.email'), json_extract(value, '$.displayName'), ?, ?
         FROM json_each(?)`,
    ).bind(hash, now, J(d.accounts)),
    db.prepare(
      `INSERT INTO memberships (id, user_id, school_id, role, active_from, active_to, created_at)
       SELECT json_extract(value, '$.membershipId'), json_extract(value, '$.userId'), ?, json_extract(value, '$.role'), ?,
              CASE json_extract(value, '$.role') WHEN 'remplacant' THEN ? END, ?
         FROM json_each(?)`,
    ).bind(schoolId, now, `${addDays(today, 30)}T22:00:00.000Z`, now, J(d.accounts)),
    db.prepare(
      `INSERT INTO classes (id, school_id, name, levels, school_year, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.name'), json_extract(value, '$.levels'), ?, ?
         FROM json_each(?)`,
    ).bind(schoolId, year, now, J(d.classes.map((c) => ({ ...c, levels: J(c.levels) })))),
    db.prepare(
      `INSERT INTO call_slots (id, school_id, class_id, name, half_day, weekdays, due_time, position, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.classId'), json_extract(value, '$.name'),
              json_extract(value, '$.halfDay'), ?, json_extract(value, '$.dueTime'), json_extract(value, '$.position'), ?
         FROM json_each(?)`,
    ).bind(schoolId, DEMO_SLOT_WEEKDAYS, now, J(d.slots)),
    db.prepare(
      `INSERT INTO teacher_class_assignments (id, school_id, class_id, membership_id, start_at, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.classId'), json_extract(value, '$.membershipId'), ?, ?
         FROM json_each(?)`,
    ).bind(schoolId, now, now, J(d.assignments)),
    db.prepare(
      `INSERT INTO students (id, school_id, class_id, first_name, last_name, active_from, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.classId'), json_extract(value, '$.firstName'),
              json_extract(value, '$.lastName'), ?, ?
         FROM json_each(?)`,
    ).bind(schoolId, yearStart, now, J(d.students)),
    db.prepare(
      `INSERT INTO attendance_statuses (id, school_id, label, color, category, position, created_at)
       VALUES (?, ?, 'Présent', 'success', 'PRESENT', 0, ?), (?, ?, 'Absent', 'danger', 'ABSENT', 1, ?)`,
    ).bind(presentId, schoolId, now, absentId, schoolId, now),
    // Historique : appels validés des jours passés (version 1), tous présents sauf les absents tirés au sort.
    db.prepare(
      `INSERT INTO attendance_calls (id, school_id, class_id, slot_id, slot_date, status, version, first_validated_by,
                                     first_validated_at, updated_by, updated_at, last_request_id)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.classId'), json_extract(value, '$.slotId'),
              json_extract(value, '$.date'), 'validated', 1, json_extract(value, '$.actorId'), json_extract(value, '$.at'),
              json_extract(value, '$.actorId'), json_extract(value, '$.at'), 'demo-' || json_extract(value, '$.id')
         FROM json_each(?)`,
    ).bind(schoolId, J(d.calls)),
    db.prepare(
      `INSERT INTO attendance_entries (call_id, student_id, status_id)
       SELECT c.id, s.id, CASE WHEN EXISTS (SELECT 1 FROM json_each(?) a
                                             WHERE json_extract(a.value, '$.callId') = c.id
                                               AND json_extract(a.value, '$.studentId') = s.id) THEN ? ELSE ? END
         FROM attendance_calls c JOIN students s ON s.class_id = c.class_id
        WHERE c.school_id = ?`,
    ).bind(J(d.absences), absentId, presentId, schoolId),
    db.prepare(
      `INSERT INTO attendance_revisions (id, call_id, version, actor_user_id, at)
       SELECT lower(hex(randomblob(16))), id, 1, first_validated_by, first_validated_at FROM attendance_calls WHERE school_id = ?`,
    ).bind(schoolId),
    db.prepare(
      `INSERT INTO direction_messages (id, school_id, target_kind, targets, body, priority, start_date, end_date, created_by, created_at)
       VALUES (?, ?, 'school', '[]', ?, 'normal', ?, ?, ?, ?)`,
    ).bind(
      newId(),
      schoolId,
      'Bienvenue sur l’école de démonstration : toutes les données sont fictives. Sortie à la médiathèque vendredi.',
      today,
      addDays(today, 14),
      d.accounts[0].userId,
      now,
    ),
    db.prepare(
      `INSERT INTO planned_absences (id, school_id, student_id, start_date, end_date, half_days, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'day', 'Rendez-vous', ?, ?)`,
    ).bind(d.plannedAbsence.id, schoolId, d.plannedAbsence.studentId, today, today, d.accounts[0].userId, now),
    await audit(env, {
      actor: admin.id,
      schoolId,
      action: 'demo.created',
      objectType: 'school',
      objectId: schoolId,
      details: { classes: d.classes.length, students: d.students.length, calls: d.calls.length },
    }),
  ]
  await db.batch(stmts)
  return json(
    {
      school: { id: schoolId, name: DEMO_SCHOOL_NAME },
      loginUrl: `${origin}/connexion`,
      password,
      accounts: d.accounts.map((a) => ({ profile: a.profile, role: a.role, email: a.email, className: a.className })),
      counts: { classes: d.classes.length, students: d.students.length, calls: d.calls.length },
    },
    { status: 201 },
  )
}

/**
 * Suppression complète de l'école de démonstration (et seulement elle : `is_demo = 1`), pour la recréer.
 * Les comptes rattachés uniquement à cette école sont supprimés ; le journal d'audit est conservé.
 */
export async function deleteDemoSchool(env: Env, req: Request, schoolId: string) {
  const admin = await requireUser(env, req)
  requireSuperadmin(admin)
  const school = await env.DB.prepare('SELECT id FROM schools WHERE id = ? AND is_demo = 1').bind(schoolId).first()
  if (!school) throw notFound()
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE m.school_id = ? AND u.is_superadmin = 0
        AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = u.id AND o.school_id <> ?)`,
  )
    .bind(schoolId, schoolId)
    .all<{ id: string }>()
  const users = JSON.stringify(results.map((r) => r.id))
  const db = env.DB
  const bySchool = (table: string) => db.prepare(`DELETE FROM ${table} WHERE school_id = ?`).bind(schoolId)
  await db.batch([
    db.prepare('DELETE FROM attendance_entries WHERE call_id IN (SELECT id FROM attendance_calls WHERE school_id = ?)').bind(schoolId),
    db.prepare('DELETE FROM attendance_revisions WHERE call_id IN (SELECT id FROM attendance_calls WHERE school_id = ?)').bind(schoolId),
    bySchool('attendance_calls'),
    bySchool('call_reminders'),
    bySchool('distribution_assignments'),
    db.prepare('DELETE FROM distribution_changes WHERE plan_id IN (SELECT id FROM distribution_plans WHERE school_id = ?)').bind(schoolId),
    bySchool('distribution_notices'),
    bySchool('distribution_plans'),
    bySchool('planned_absences'),
    bySchool('direction_messages'),
    db.prepare('DELETE FROM student_schedules WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)').bind(schoolId),
    bySchool('students'),
    bySchool('import_jobs'),
    bySchool('teacher_class_assignments'),
    bySchool('call_slots'),
    bySchool('classes'),
    bySchool('attendance_statuses'),
    bySchool('school_closures'),
    bySchool('invitations'),
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
    bySchool('memberships'),
    db.prepare('DELETE FROM users WHERE is_superadmin = 0 AND id IN (SELECT value FROM json_each(?))').bind(users),
    db.prepare('DELETE FROM schools WHERE id = ? AND is_demo = 1').bind(schoolId),
    await audit(env, { actor: admin.id, schoolId, action: 'demo.deleted', objectType: 'school', objectId: schoolId }),
  ])
  return json({ ok: true })
}
