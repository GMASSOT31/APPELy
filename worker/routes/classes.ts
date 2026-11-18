import { audit, nowIso, requireSchoolRole, requireUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, json, notFound, optStr, readJson, str } from '../lib/http'
import { academicYear } from './admin'
import {
  DEFAULT_SLOT_WEEKDAYS,
  LEVELS,
  isValidDate,
  isValidPattern,
  levelRank,
} from '../../src/domain/schedule'
import { CLASS_NAME_MAX, MAX_IMPORT_ROWS, NAME_MAX, classKey, clean, nameKey } from '../../src/domain/importRows'

/** Toute écriture de configuration est réservée à la direction de l'école. */
async function direction(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  return u
}

const today = () => nowIso().slice(0, 10)

function levels(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 3 || !v.every((l) => (LEVELS as readonly string[]).includes(l)))
    throw badRequest('INVALID_LEVELS', 'Choisissez un à trois niveaux.')
  return [...new Set(v as string[])].sort((a, b) => LEVELS.indexOf(a as never) - LEVELS.indexOf(b as never))
}

async function findClass(env: Env, schoolId: string, classId: string) {
  const c = await env.DB.prepare('SELECT id, name, levels FROM classes WHERE id = ? AND school_id = ? AND archived_at IS NULL')
    .bind(classId, schoolId)
    .first<{ id: string; name: string; levels: string }>()
  if (!c) throw notFound()
  return c
}

async function findStudent(env: Env, schoolId: string, studentId: string) {
  const s = await env.DB.prepare('SELECT id, class_id, first_name, last_name FROM students WHERE id = ? AND school_id = ? AND active_to IS NULL')
    .bind(studentId, schoolId)
    .first<{ id: string; class_id: string; first_name: string; last_name: string | null }>()
  if (!s) throw notFound()
  return s
}

function defaultSlot(env: Env, schoolId: string, classId: string) {
  return env.DB.prepare(
    `INSERT INTO call_slots (id, school_id, class_id, name, half_day, weekdays, due_time, position, created_at)
     VALUES (?, ?, ?, 'Appel du matin', 'am', ?, '09:00', 0, ?)`,
  ).bind(newId(), schoolId, classId, DEFAULT_SLOT_WEEKDAYS, nowIso())
}

function uniqueViolation(e: unknown) {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message)
}

// ---------- Vue d'ensemble ----------

export async function getOverview(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const now = nowIso()
  const school = await env.DB.prepare('SELECT name, academic_year, closed_weekdays FROM schools WHERE id = ?')
    .bind(schoolId)
    .first<{ name: string; academic_year: string; closed_weekdays: number }>()
  const { results: classes } = await env.DB.prepare(
    `SELECT c.id, c.name, c.levels,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.active_to IS NULL) AS student_count
       FROM classes c WHERE c.school_id = ? AND c.archived_at IS NULL`,
  )
    .bind(schoolId)
    .all<{ id: string; name: string; levels: string; student_count: number }>()
  const { results: teachers } = await env.DB.prepare(
    `SELECT a.class_id, u.display_name FROM teacher_class_assignments a
       JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
      WHERE a.school_id = ? AND (a.end_at IS NULL OR a.end_at > ?) AND m.revoked_at IS NULL
        AND (m.active_to IS NULL OR m.active_to > ?)`,
  )
    .bind(schoolId, now, now)
    .all<{ class_id: string; display_name: string }>()
  const list = classes
    .map((c) => ({
      id: c.id,
      name: c.name,
      levels: JSON.parse(c.levels) as string[],
      studentCount: c.student_count,
      teachers: teachers.filter((t) => t.class_id === c.id).map((t) => t.display_name),
    }))
    .sort((a, b) => levelRank(a.levels) - levelRank(b.levels) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
  return json({ school: { name: school?.name, academicYear: school?.academic_year, closedWeekdays: school?.closed_weekdays }, classes: list })
}

// ---------- Classes ----------

export async function createClass(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson(req)
  const name = str(body.name, 'nom de la classe', { max: CLASS_NAME_MAX })
  const lv = levels(body.levels)
  const id = newId()
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO classes (id, school_id, name, levels, school_year, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id,
        schoolId,
        name,
        JSON.stringify(lv),
        academicYear(),
        nowIso(),
      ),
      defaultSlot(env, schoolId, id),
      await audit(env, { actor: u.id, schoolId, action: 'class.created', objectType: 'class', objectId: id }),
    ])
  } catch (e) {
    if (uniqueViolation(e)) throw conflict('CLASS_EXISTS', 'Une classe porte déjà ce nom.')
    throw e
  }
  return json({ id }, { status: 201 })
}

export async function updateClass(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const body = await readJson(req)
  const name = str(body.name, 'nom de la classe', { max: CLASS_NAME_MAX })
  const lv = levels(body.levels)
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE classes SET name = ?, levels = ? WHERE id = ?').bind(name, JSON.stringify(lv), classId),
      await audit(env, { actor: u.id, schoolId, action: 'class.updated', objectType: 'class', objectId: classId }),
    ])
  } catch (e) {
    if (uniqueViolation(e)) throw conflict('CLASS_EXISTS', 'Une classe porte déjà ce nom.')
    throw e
  }
  return json({ ok: true })
}

export async function archiveClass(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM students WHERE class_id = ? AND active_to IS NULL').bind(classId).first<{ n: number }>()
  if ((n?.n ?? 0) > 0) throw conflict('CLASS_NOT_EMPTY', 'Déplacez ou retirez d’abord les élèves de cette classe.')
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare('UPDATE classes SET archived_at = ? WHERE id = ?').bind(now, classId),
    env.DB.prepare('UPDATE teacher_class_assignments SET end_at = ? WHERE class_id = ? AND end_at IS NULL').bind(now, classId),
    await audit(env, { actor: u.id, schoolId, action: 'class.archived', objectType: 'class', objectId: classId }),
  ])
  return json({ ok: true })
}

export async function getClass(env: Env, req: Request, schoolId: string, classId: string) {
  await direction(env, req, schoolId)
  const c = await findClass(env, schoolId, classId)
  const now = nowIso()
  const [students, schedules, slots, teachers, candidates] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, first_name, last_name, active_from FROM students WHERE class_id = ? AND active_to IS NULL ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE',
    ).bind(classId),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss JOIN students s ON s.id = ss.student_id
        WHERE s.class_id = ? AND s.active_to IS NULL ORDER BY ss.valid_from`,
    ).bind(classId),
    env.DB.prepare(
      'SELECT id, name, half_day, weekdays, due_time, position FROM call_slots WHERE class_id = ? AND archived_at IS NULL ORDER BY position, half_day',
    ).bind(classId),
    env.DB.prepare(
      `SELECT a.id, u.display_name, m.role FROM teacher_class_assignments a
         JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
        WHERE a.class_id = ? AND (a.end_at IS NULL OR a.end_at > ?) AND m.revoked_at IS NULL AND (m.active_to IS NULL OR m.active_to > ?)
        ORDER BY u.display_name`,
    ).bind(classId, now, now),
    env.DB.prepare(
      `SELECT m.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.school_id = ? AND m.revoked_at IS NULL AND (m.active_to IS NULL OR m.active_to > ?)
          AND m.role IN ('enseignant', 'remplacant', 'direction') ORDER BY u.display_name`,
    ).bind(schoolId, now),
  ])
  const sched = schedules.results as { student_id: string; valid_from: string; pattern: number | null }[]
  const day = today()
  return json({
    class: { id: c.id, name: c.name, levels: JSON.parse(c.levels) },
    students: (students.results as { id: string; first_name: string; last_name: string | null; active_from: string }[]).map((s) => {
      const versions = sched.filter((x) => x.student_id === s.id)
      const current = versions.filter((v) => v.valid_from <= day).at(-1)
      const upcoming = versions.filter((v) => v.valid_from > day)
      return {
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        activeFrom: s.active_from,
        pattern: current ? current.pattern : null,
        upcoming: upcoming.map((v) => ({ validFrom: v.valid_from, pattern: v.pattern })),
      }
    }),
    slots: slots.results,
    teachers: teachers.results,
    candidates: candidates.results,
  })
}

// ---------- Enseignants affectés ----------

export async function assignTeacher(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const body = await readJson(req)
  const membershipId = str(body.membershipId, 'enseignant')
  const now = nowIso()
  const m = await env.DB.prepare(
    `SELECT id FROM memberships WHERE id = ? AND school_id = ? AND revoked_at IS NULL AND (active_to IS NULL OR active_to > ?)`,
  )
    .bind(membershipId, schoolId, now)
    .first()
  if (!m) throw notFound()
  const dup = await env.DB.prepare(
    'SELECT 1 FROM teacher_class_assignments WHERE class_id = ? AND membership_id = ? AND (end_at IS NULL OR end_at > ?)',
  )
    .bind(classId, membershipId, now)
    .first()
  if (dup) throw conflict('ALREADY_ASSIGNED', 'Cette personne est déjà affectée à la classe.')
  const id = newId()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO teacher_class_assignments (id, school_id, class_id, membership_id, start_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, schoolId, classId, membershipId, now, now),
    await audit(env, { actor: u.id, schoolId, action: 'class.teacher_assigned', objectType: 'class', objectId: classId }),
  ])
  return json({ id }, { status: 201 })
}

export async function unassignTeacher(env: Env, req: Request, schoolId: string, classId: string, assignmentId: string) {
  const u = await direction(env, req, schoolId)
  const r = await env.DB.prepare(
    'UPDATE teacher_class_assignments SET end_at = ? WHERE id = ? AND class_id = ? AND school_id = ? AND end_at IS NULL',
  )
    .bind(nowIso(), assignmentId, classId, schoolId)
    .run()
  if (r.meta.changes !== 1) throw notFound()
  await (await audit(env, { actor: u.id, schoolId, action: 'class.teacher_unassigned', objectType: 'class', objectId: classId })).run()
  return json({ ok: true })
}

// ---------- Élèves ----------

function studentFields(body: Record<string, unknown>) {
  return {
    firstName: str(body.firstName, 'prénom', { max: NAME_MAX }),
    lastName: optStr(body.lastName, 'nom', { max: NAME_MAX }),
  }
}

export async function addStudent(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const body = await readJson(req)
  const { firstName, lastName } = studentFields(body)
  const { results } = await env.DB.prepare('SELECT first_name, last_name FROM students WHERE class_id = ? AND active_to IS NULL')
    .bind(classId)
    .all<{ first_name: string; last_name: string | null }>()
  if (results.some((s) => nameKey(s.first_name, s.last_name) === nameKey(firstName, lastName)))
    throw conflict('DUPLICATE_STUDENT', 'Cet élève est déjà dans la classe.')
  const id = newId()
  const day = today()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO students (id, school_id, class_id, first_name, last_name, active_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, schoolId, classId, firstName, lastName, day, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'student.created', objectType: 'student', objectId: id }),
  ])
  return json({ id }, { status: 201 })
}

export async function updateStudent(env: Env, req: Request, schoolId: string, studentId: string) {
  const u = await direction(env, req, schoolId)
  const s = await findStudent(env, schoolId, studentId)
  const body = await readJson(req)
  const { firstName, lastName } = studentFields(body)
  let classId = s.class_id
  if (body.classId !== undefined && body.classId !== s.class_id) classId = (await findClass(env, schoolId, str(body.classId, 'classe'))).id
  await env.DB.batch([
    env.DB.prepare('UPDATE students SET first_name = ?, last_name = ?, class_id = ? WHERE id = ?').bind(firstName, lastName, classId, studentId),
    await audit(env, {
      actor: u.id,
      schoolId,
      action: classId !== s.class_id ? 'student.moved' : 'student.updated',
      objectType: 'student',
      objectId: studentId,
      details: classId !== s.class_id ? { from: s.class_id, to: classId } : undefined,
    }),
  ])
  return json({ ok: true })
}

/** Départ de l'élève à une date : il reste dans l'historique, mais n'est plus attendu ensuite. */
export async function studentLeaves(env: Env, req: Request, schoolId: string, studentId: string) {
  const u = await direction(env, req, schoolId)
  await findStudent(env, schoolId, studentId)
  const body = await readJson(req)
  const date = body.date ?? today()
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date invalide.')
  await env.DB.batch([
    env.DB.prepare('UPDATE students SET active_to = ? WHERE id = ?').bind(date, studentId),
    await audit(env, { actor: u.id, schoolId, action: 'student.left', objectType: 'student', objectId: studentId, details: { date } }),
  ])
  return json({ ok: true })
}

/**
 * Présence attendue datée : une nouvelle version à partir d'une date, sans réécrire le passé.
 * pattern null = « même liste tous les jours ».
 */
export async function setSchedule(env: Env, req: Request, schoolId: string, studentId: string) {
  const u = await direction(env, req, schoolId)
  await findStudent(env, schoolId, studentId)
  const body = await readJson(req)
  const validFrom = body.validFrom ?? today()
  if (!isValidDate(validFrom)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (validFrom < today()) throw badRequest('PAST_DATE', 'Un changement d’emploi du temps ne peut pas réécrire le passé.')
  const pattern = body.pattern === null ? null : body.pattern
  if (pattern !== null && !isValidPattern(pattern)) throw badRequest('INVALID_PATTERN', 'Emploi du temps invalide.')
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO student_schedules (id, student_id, valid_from, pattern, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (student_id, valid_from) DO UPDATE SET pattern = excluded.pattern`,
    ).bind(newId(), studentId, validFrom, pattern, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'student.schedule', objectType: 'student', objectId: studentId, details: { validFrom, pattern } }),
  ])
  return json({ ok: true })
}

/** Applique le même emploi du temps à toute la classe (modèle semaine reproductible). */
export async function setClassSchedule(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const body = await readJson(req)
  const validFrom = body.validFrom ?? today()
  if (!isValidDate(validFrom) || validFrom < today()) throw badRequest('INVALID_DATE', 'Date invalide.')
  const pattern = body.pattern === null ? null : body.pattern
  if (pattern !== null && !isValidPattern(pattern)) throw badRequest('INVALID_PATTERN', 'Emploi du temps invalide.')
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO student_schedules (id, student_id, valid_from, pattern, created_at)
       SELECT lower(hex(randomblob(16))), id, ?, ?, ? FROM students WHERE class_id = ? AND active_to IS NULL
       ON CONFLICT (student_id, valid_from) DO UPDATE SET pattern = excluded.pattern`,
    ).bind(validFrom, pattern, nowIso(), classId),
    await audit(env, { actor: u.id, schoolId, action: 'class.schedule', objectType: 'class', objectId: classId, details: { validFrom, pattern } }),
  ])
  return json({ ok: true })
}

// ---------- Créneaux d'appel ----------

function slotFields(body: Record<string, unknown>) {
  const name = str(body.name, 'nom du créneau', { max: 40 })
  if (body.halfDay !== 'am' && body.halfDay !== 'pm') throw badRequest('INVALID_HALF_DAY', 'Demi-journée invalide.')
  const weekdays = body.weekdays
  if (typeof weekdays !== 'number' || !Number.isInteger(weekdays) || weekdays < 0 || weekdays >= 1 << 6)
    throw badRequest('INVALID_WEEKDAYS', 'Jours invalides.')
  const dueTime = body.dueTime === null || body.dueTime === '' || body.dueTime === undefined ? null : body.dueTime
  if (dueTime !== null && (typeof dueTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)))
    throw badRequest('INVALID_TIME', 'Heure limite invalide.')
  return { name, halfDay: body.halfDay, weekdays, dueTime }
}

export async function createSlot(env: Env, req: Request, schoolId: string, classId: string) {
  const u = await direction(env, req, schoolId)
  await findClass(env, schoolId, classId)
  const f = slotFields(await readJson(req))
  const id = newId()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO call_slots (id, school_id, class_id, name, half_day, weekdays, due_time, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM call_slots WHERE class_id = ?), ?)`,
    ).bind(id, schoolId, classId, f.name, f.halfDay, f.weekdays, f.dueTime, classId, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'slot.created', objectType: 'call_slot', objectId: id }),
  ])
  return json({ id }, { status: 201 })
}

export async function updateSlot(env: Env, req: Request, schoolId: string, classId: string, slotId: string) {
  const u = await direction(env, req, schoolId)
  const f = slotFields(await readJson(req))
  const r = await env.DB.prepare(
    'UPDATE call_slots SET name = ?, half_day = ?, weekdays = ?, due_time = ? WHERE id = ? AND class_id = ? AND school_id = ? AND archived_at IS NULL',
  )
    .bind(f.name, f.halfDay, f.weekdays, f.dueTime, slotId, classId, schoolId)
    .run()
  if (r.meta.changes !== 1) throw notFound()
  await (await audit(env, { actor: u.id, schoolId, action: 'slot.updated', objectType: 'call_slot', objectId: slotId })).run()
  return json({ ok: true })
}

export async function archiveSlot(env: Env, req: Request, schoolId: string, classId: string, slotId: string) {
  const u = await direction(env, req, schoolId)
  const r = await env.DB.prepare(
    'UPDATE call_slots SET archived_at = ? WHERE id = ? AND class_id = ? AND school_id = ? AND archived_at IS NULL',
  )
    .bind(nowIso(), slotId, classId, schoolId)
    .run()
  if (r.meta.changes !== 1) throw notFound()
  await (await audit(env, { actor: u.id, schoolId, action: 'slot.archived', objectType: 'call_slot', objectId: slotId })).run()
  return json({ ok: true })
}

// ---------- Import ----------

interface ImportRow {
  firstName: string
  lastName: string | null
  className: string
}

/**
 * Import atomique : les classes manquantes sont créées (niveau à préciser ensuite si inconnu),
 * les élèves ajoutés, le tout dans un seul lot transactionnel. Le serveur revérifie
 * doublons et formats, quelle que soit la prévisualisation du navigateur.
 */
export async function importStudents(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson<{ rows?: unknown; classLevels?: unknown }>(req)
  if (!Array.isArray(body.rows) || body.rows.length === 0) throw badRequest('EMPTY_IMPORT', 'Aucune ligne à importer.')
  if (body.rows.length > MAX_IMPORT_ROWS) throw badRequest('TOO_MANY_ROWS', `Maximum ${MAX_IMPORT_ROWS} élèves par import.`)
  const classLevels = (typeof body.classLevels === 'object' && body.classLevels) || {}

  const rows: ImportRow[] = body.rows.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    const firstName = clean(o.firstName)
    const lastName = clean(o.lastName) || null
    const className = clean(o.className)
    if (!firstName || firstName.length > NAME_MAX || (lastName?.length ?? 0) > NAME_MAX || !className || className.length > CLASS_NAME_MAX)
      throw badRequest('INVALID_ROW', `Ligne ${i + 1} invalide.`)
    return { firstName, lastName, className }
  })

  const { results: classes } = await env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ? AND archived_at IS NULL')
    .bind(schoolId)
    .all<{ id: string; name: string }>()
  const classIds = new Map(classes.map((c) => [classKey(c.name), c.id]))
  const { results: existing } = await env.DB.prepare('SELECT class_id, first_name, last_name FROM students WHERE school_id = ? AND active_to IS NULL')
    .bind(schoolId)
    .all<{ class_id: string; first_name: string; last_name: string | null }>()
  const taken = new Set(existing.map((s) => `${s.class_id}#${nameKey(s.first_name, s.last_name)}`))

  const newClasses: { id: string; name: string; levels: string[] }[] = []
  for (const r of rows) {
    const k = classKey(r.className)
    if (classIds.has(k)) continue
    const lv = (classLevels as Record<string, unknown>)[r.className]
    const id = newId()
    classIds.set(k, id)
    newClasses.push({ id, name: r.className, levels: Array.isArray(lv) && lv.length ? levels(lv) : [] })
  }
  const duplicates: string[] = []
  const students = rows.map((r) => {
    const classId = classIds.get(classKey(r.className))!
    const key = `${classId}#${nameKey(r.firstName, r.lastName)}`
    if (taken.has(key)) duplicates.push(`${r.firstName} ${r.lastName ?? ''} (${r.className})`.trim())
    taken.add(key)
    return { id: newId(), class_id: classId, first_name: r.firstName, last_name: r.lastName }
  })
  if (duplicates.length) throw conflict('DUPLICATES', `Doublons détectés : ${duplicates.slice(0, 5).join(', ')}.`)

  const importId = newId()
  const now = nowIso()
  const day = today()
  const year = academicYear()
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('INSERT INTO import_jobs (id, school_id, user_id, kind, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      importId,
      schoolId,
      u.id,
      'students',
      JSON.stringify({ students: students.length, classes: newClasses.map((c) => c.id) }),
      now,
    ),
  ]
  if (newClasses.length) {
    // Insertion en masse par JSON : une seule requête quelle que soit la taille de l'import.
    stmts.push(
      env.DB.prepare(
        `INSERT INTO classes (id, school_id, name, levels, school_year, created_at)
         SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.name'), json_extract(value, '$.levels'), ?, ?
           FROM json_each(?)`,
      ).bind(schoolId, year, now, JSON.stringify(newClasses.map((c) => ({ ...c, levels: JSON.stringify(c.levels) })))),
      env.DB.prepare(
        `INSERT INTO call_slots (id, school_id, class_id, name, half_day, weekdays, due_time, position, created_at)
         SELECT json_extract(value, '$.slot'), ?, json_extract(value, '$.id'), 'Appel du matin', 'am', ?, '09:00', 0, ?
           FROM json_each(?)`,
      ).bind(schoolId, DEFAULT_SLOT_WEEKDAYS, now, JSON.stringify(newClasses.map((c) => ({ id: c.id, slot: newId() })))),
    )
  }
  stmts.push(
    env.DB.prepare(
      `INSERT INTO students (id, school_id, class_id, first_name, last_name, active_from, import_id, created_at)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.class_id'), json_extract(value, '$.first_name'),
              json_extract(value, '$.last_name'), ?, ?, ?
         FROM json_each(?)`,
    ).bind(schoolId, day, importId, now, JSON.stringify(students)),
    await audit(env, {
      actor: u.id,
      schoolId,
      action: 'import.students',
      objectType: 'import',
      objectId: importId,
      details: { students: students.length, classes: newClasses.length },
    }),
  )
  try {
    await env.DB.batch(stmts)
  } catch (e) {
    if (uniqueViolation(e)) throw conflict('CLASS_EXISTS', 'Une classe a été créée entre-temps. Relancez la prévisualisation.')
    throw e
  }
  return json(
    { importId, students: students.length, classesCreated: newClasses.map((c) => ({ id: c.id, name: c.name, levels: c.levels })) },
    { status: 201 },
  )
}

/** « Annuler l'import » : retire les élèves importés et les classes créées par cet import (tant qu'elles sont vides). */
export async function cancelImport(env: Env, req: Request, schoolId: string, importId: string) {
  const u = await direction(env, req, schoolId)
  const job = await env.DB.prepare(
    "SELECT result FROM import_jobs WHERE id = ? AND school_id = ? AND kind = 'students' AND cancelled_at IS NULL",
  )
    .bind(importId, schoolId)
    .first<{ result: string }>()
  if (!job) throw notFound()
  const { classes } = JSON.parse(job.result) as { classes: string[] }
  const used = await env.DB.prepare(
    'SELECT 1 FROM attendance_entries e JOIN students s ON s.id = e.student_id WHERE s.import_id = ? LIMIT 1',
  )
    .bind(importId)
    .first()
  if (used) throw conflict('IMPORT_IN_USE', 'Des appels ont déjà été faits avec ces élèves : l’import ne peut plus être annulé.')
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM student_schedules WHERE student_id IN (SELECT id FROM students WHERE import_id = ?)').bind(importId),
    env.DB.prepare('DELETE FROM students WHERE import_id = ? AND school_id = ?').bind(importId, schoolId),
    env.DB.prepare(
      `DELETE FROM call_slots WHERE class_id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM students s WHERE s.class_id = call_slots.class_id)`,
    ).bind(JSON.stringify(classes)),
    env.DB.prepare(
      `DELETE FROM classes WHERE school_id = ? AND id IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM students s WHERE s.class_id = classes.id)
         AND NOT EXISTS (SELECT 1 FROM teacher_class_assignments a WHERE a.class_id = classes.id)`,
    ).bind(schoolId, JSON.stringify(classes)),
    env.DB.prepare('UPDATE import_jobs SET cancelled_at = ? WHERE id = ?').bind(now, importId),
    await audit(env, { actor: u.id, schoolId, action: 'import.cancelled', objectType: 'import', objectId: importId }),
  ])
  return json({ ok: true })
}

// ---------- Vue enseignant ----------

/** Classes de l'utilisateur connecté (lecture seule), avec leurs créneaux. */
export async function myClasses(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  const m = await requireSchoolRole(env, u, schoolId, ['enseignant', 'remplacant', 'direction'])
  const now = nowIso()
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.name, c.levels,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.active_to IS NULL) AS student_count
       FROM teacher_class_assignments a JOIN classes c ON c.id = a.class_id
      WHERE a.membership_id = ? AND (a.end_at IS NULL OR a.end_at > ?) AND c.archived_at IS NULL
      ORDER BY c.name`,
  )
    .bind(m.id, now)
    .all<{ id: string; name: string; levels: string; student_count: number }>()
  return json({ classes: results.map((c) => ({ id: c.id, name: c.name, levels: JSON.parse(c.levels), studentCount: c.student_count })) })
}
