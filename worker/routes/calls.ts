import { audit, nowIso, requireSchoolRole, requireUser, type CurrentUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, forbidden, HttpError, json, notFound, readJson } from '../lib/http'
import { ensureDefaultStatuses } from './settings'
import { messagesForClass, publicMessage, schoolToday, visibleMessagesQuery, type MessageRow } from '../lib/day'
import { plannedCovers, sortMessages, type PlannedHalfDays } from '../../src/domain/direction'
import { closureFor, isExpected, isoWeekday, isValidDate, type HalfDay } from '../../src/domain/schedule'
import { latestNotices, noticesQuery } from './distributions'

export const REMARK_MAX = 200

export { schoolToday }

interface Slot {
  id: string
  class_id: string
  name: string
  half_day: HalfDay
  weekdays: number
  due_time: string | null
  archived_at: string | null
}

/**
 * Accès à l'appel d'une classe : la direction de l'école, ou une personne affectée à la classe
 * (enseignant, remplaçant) avec un rattachement actif. Renvoie aussi le rôle.
 */
async function requireCallAccess(env: Env, u: CurrentUser, schoolId: string, classId: string) {
  const m = await requireSchoolRole(env, u, schoolId, ['direction', 'enseignant', 'remplacant'])
  const cls = await env.DB.prepare('SELECT id, name, levels, archived_at FROM classes WHERE id = ? AND school_id = ?')
    .bind(classId, schoolId)
    .first<{ id: string; name: string; levels: string; archived_at: string | null }>()
  if (!cls) throw notFound()
  if (m.role !== 'direction') {
    const now = nowIso()
    const a = await env.DB.prepare(
      'SELECT 1 FROM teacher_class_assignments WHERE class_id = ? AND membership_id = ? AND start_at <= ? AND (end_at IS NULL OR end_at > ?)',
    )
      .bind(classId, m.id, now, now)
      .first()
    if (!a) throw forbidden()
  }
  return { membership: m, cls }
}

interface CallStudent {
  id: string
  first_name: string
  last_name: string | null
  /** Classe d'origine d'un élève accueilli (répartition), sinon null. */
  hosted_from: string | null
  /** Élève accueilli ajouté après la validation : à intégrer par une correction. */
  pending?: boolean
}

interface StudentRow {
  id: string
  first_name: string
  last_name: string | null
  class_id: string
  active_from: string
  active_to: string | null
}

/** Tout ce qu'il faut pour afficher ou valider un appel : élèves attendus, états, appel existant. */
async function loadCall(env: Env, schoolId: string, classId: string, date: string, slotId: string) {
  await ensureDefaultStatuses(env, schoolId)
  // Lot 5 : élèves accueillis ici (répartition) sur cette date.
  const hostedSub = 'SELECT student_id FROM distribution_assignments WHERE host_class_id = ? AND slot_date = ? AND ended_at IS NULL'
  const [schoolR, slotR, closuresR, studentsR, schedulesR, statusesR, callR, messagesR, plannedR, reminderR, assignR, hostedR, registryR, classNamesR] =
    await env.DB.batch([
    env.DB.prepare('SELECT closed_weekdays, timezone FROM schools WHERE id = ?').bind(schoolId),
    env.DB.prepare('SELECT id, class_id, name, half_day, weekdays, due_time, archived_at FROM call_slots WHERE id = ? AND class_id = ? AND school_id = ?').bind(
      slotId,
      classId,
      schoolId,
    ),
    env.DB.prepare('SELECT start_date, end_date, label FROM school_closures WHERE school_id = ? AND start_date <= ? AND end_date >= ?').bind(
      schoolId,
      date,
      date,
    ),
    env.DB.prepare('SELECT id, first_name, last_name, class_id, active_from, active_to FROM students WHERE class_id = ?').bind(classId),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss JOIN students s ON s.id = ss.student_id
        WHERE s.class_id = ? OR s.id IN (${hostedSub})`,
    ).bind(classId, classId, date),
    env.DB.prepare(
      'SELECT id, label, color, category, position, archived_at FROM attendance_statuses WHERE school_id = ? ORDER BY position',
    ).bind(schoolId),
    env.DB.prepare('SELECT * FROM attendance_calls WHERE class_id = ? AND slot_id = ? AND slot_date = ?').bind(classId, slotId, date),
    // Lot 4 : mot de la direction, absences prévues, relance.
    visibleMessagesQuery(env, schoolId, date),
    env.DB.prepare(
      `SELECT pa.student_id, pa.start_date, pa.end_date, pa.half_days, pa.reason FROM planned_absences pa JOIN students s ON s.id = pa.student_id
        WHERE (s.class_id = ? OR s.id IN (${hostedSub})) AND pa.cancelled_at IS NULL AND pa.start_date <= ? AND pa.end_date >= ?`,
    ).bind(classId, classId, date, date, date),
    env.DB.prepare('SELECT MAX(sent_at) AS at FROM call_reminders WHERE class_id = ? AND slot_id = ? AND slot_date = ?').bind(classId, slotId, date),
    // Lot 5 : affectations du jour (élèves partis ailleurs ou accueillis ici), élèves accueillis,
    // et états saisis pour nos élèves dans les appels des classes d'accueil (registre de la classe d'origine).
    env.DB.prepare(
      `SELECT student_id, host_class_id, source_class_id, half_day FROM distribution_assignments
        WHERE slot_date = ? AND ended_at IS NULL AND (source_class_id = ? OR host_class_id = ?)`,
    ).bind(date, classId, classId),
    env.DB.prepare(`SELECT id, first_name, last_name, class_id, active_from, active_to FROM students WHERE id IN (${hostedSub})`).bind(classId, date),
    env.DB.prepare(
      `SELECT e.student_id, c.class_id, sl.half_day, st.label, st.category FROM attendance_entries e
         JOIN attendance_calls c ON c.id = e.call_id JOIN call_slots sl ON sl.id = c.slot_id JOIN attendance_statuses st ON st.id = e.status_id
        WHERE c.slot_date = ? AND c.school_id = ? AND e.hosted_from_class_id = ?`,
    ).bind(date, schoolId, classId),
    env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ?').bind(schoolId),
  ])
  const school = schoolR.results[0] as { closed_weekdays: number; timezone: string }
  const slot = slotR.results[0] as Slot | undefined
  if (!slot) throw notFound()
  const call = callR.results[0] as
    | {
        id: string
        version: number
        status: string
        remark: string | null
        first_validated_by: string
        first_validated_at: string
        updated_by: string
        updated_at: string
        last_request_id: string
      }
    | undefined

  const schedules = schedulesR.results as { student_id: string; valid_from: string; pattern: number | null }[]
  const half = slot.half_day
  const expectedNow = (s: StudentRow) => isExpected({ ...s, schedules: schedules.filter((x) => x.student_id === s.id) }, date, half)
  const classNames = new Map((classNamesR.results as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const assignments = (assignR.results as { student_id: string; host_class_id: string | null; source_class_id: string; half_day: HalfDay }[]).filter(
    (a) => a.half_day === half,
  )
  // Nos élèves répartis ailleurs (ou absents connus) ne sont pas dans notre appel : pas de double présence.
  const away = new Map(assignments.filter((a) => a.source_class_id === classId).map((a) => [a.student_id, a.host_class_id]))
  const hostedFrom = new Map(assignments.filter((a) => a.host_class_id === classId).map((a) => [a.student_id, a.source_class_id]))
  const own = (studentsR.results as StudentRow[]).filter(expectedNow)
  const hosted = (hostedR.results as StudentRow[]).filter((s) => hostedFrom.has(s.id) && expectedNow(s))

  let entries: Record<string, string> = {}
  let students: CallStudent[] = [
    ...own.filter((s) => !away.has(s.id)).map((s) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, hosted_from: null })),
    ...hosted.map((s) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, hosted_from: hostedFrom.get(s.id)! })),
  ]
  if (call) {
    // Appel déjà validé : on garde exactement la liste enregistrée (contexte conservé même si
    // un élève a changé de classe ou d'emploi du temps depuis).
    const { results } = await env.DB.prepare(
      `SELECT e.student_id, e.status_id, e.hosted_from_class_id, s.first_name, s.last_name FROM attendance_entries e JOIN students s ON s.id = e.student_id
        WHERE e.call_id = ?`,
    )
      .bind(call.id)
      .all<{ student_id: string; status_id: string; hosted_from_class_id: string | null; first_name: string; last_name: string | null }>()
    entries = Object.fromEntries(results.map((r) => [r.student_id, r.status_id]))
    // Élèves accueillis ajoutés par une modification de répartition après la validation : à intégrer par une correction.
    const newcomers = students.filter((s) => s.hosted_from && !(s.id in entries)).map((s) => ({ ...s, pending: true }))
    students = [
      ...results.map((r) => ({ id: r.student_id, first_name: r.first_name, last_name: r.last_name, hosted_from: r.hosted_from_class_id })),
      ...newcomers,
    ]
  }
  // Ordre stable et reconnaissable : élèves de la classe, puis élèves accueillis par classe d'origine ; prénom puis nom.
  students = [...students].sort(
    (a, b) =>
      Number(!!a.hosted_from) - Number(!!b.hosted_from) ||
      (classNames.get(a.hosted_from ?? '') ?? '').localeCompare(classNames.get(b.hosted_from ?? '') ?? '', 'fr', { numeric: true }) ||
      a.first_name.localeCompare(b.first_name, 'fr', { sensitivity: 'base' }) ||
      (a.last_name ?? '').localeCompare(b.last_name ?? '', 'fr'),
  )
  // Registre de la classe d'origine : où sont nos élèves répartis et leur état remonté des classes d'accueil.
  const registry = registryR.results as { student_id: string; class_id: string; half_day: HalfDay; label: string; category: string }[]
  const distributed = own
    .filter((s) => away.has(s.id))
    .map((s) => {
      const host = away.get(s.id) ?? null
      const st = host ? registry.find((r) => r.student_id === s.id && r.class_id === host && r.half_day === half) : undefined
      return {
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        hostClassId: host,
        hostName: host ? (classNames.get(host) ?? '?') : null,
        status: st?.label ?? null,
        category: st?.category ?? null,
      }
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' }))

  const weekdayOk = (slot.weekdays & (1 << (isoWeekday(date) - 1))) !== 0
  const closure = closureFor(date, school.closed_weekdays, closuresR.results as { start_date: string; end_date: string; label: string }[])
  const noCallReason = call ? null : slot.archived_at ? 'Cet appel a été supprimé.' : closure ?? (weekdayOk ? null : 'Pas d’appel prévu ce jour-là.')

  const planned: Record<string, string> = {}
  for (const p of plannedR.results as { student_id: string; start_date: string; end_date: string; half_days: PlannedHalfDays; reason: string }[])
    if (plannedCovers(p, date, half)) planned[p.student_id] = p.reason
  return {
    school,
    slot,
    call,
    messages: messagesR.results as MessageRow[],
    planned,
    remindedAt: (reminderR.results[0] as { at: string | null } | undefined)?.at ?? null,
    entries,
    students,
    classNames,
    distributed,
    statuses: statusesR.results as { id: string; label: string; color: string; category: string; position: number; archived_at: string | null }[],
    noCallReason,
  }
}

async function names(env: Env, ids: string[]) {
  if (!ids.length) return {}
  const { results } = await env.DB.prepare('SELECT id, display_name FROM users WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(ids)]))
    .all<{ id: string; display_name: string }>()
  return Object.fromEntries(results.map((r) => [r.id, r.display_name]))
}

function checkDate(date: string, today: string) {
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (date > today) throw badRequest('FUTURE_DATE', 'Impossible de faire l’appel d’un jour à venir.')
}

export async function getCall(env: Env, req: Request, schoolId: string, classId: string, date: string, slotId: string) {
  const u = await requireUser(env, req)
  const { cls } = await requireCallAccess(env, u, schoolId, classId)
  const d = await loadCall(env, schoolId, classId, date, slotId)
  checkDate(date, schoolToday(d.school.timezone))
  let revisions: unknown[] = []
  let people: Record<string, string> = {}
  if (d.call) {
    const { results } = await env.DB.prepare(
      'SELECT version, actor_user_id, at, reason, changes FROM attendance_revisions WHERE call_id = ? ORDER BY version DESC',
    )
      .bind(d.call.id)
      .all<{ version: number; actor_user_id: string; at: string; reason: string | null; changes: string | null }>()
    people = await names(env, results.map((r) => r.actor_user_id))
    revisions = results.map((r) => ({
      version: r.version,
      by: people[r.actor_user_id] ?? '—',
      at: r.at,
      reason: r.reason,
      changes: r.changes ? JSON.parse(r.changes) : null,
    }))
  }
  const usedStatus = new Set(Object.values(d.entries))
  return json({
    class: { id: cls.id, name: cls.name },
    slot: { id: d.slot.id, name: d.slot.name, halfDay: d.slot.half_day, dueTime: d.slot.due_time },
    date,
    noCallReason: d.noCallReason,
    // États actifs, plus ceux archivés encore utilisés dans cet appel (historique lisible).
    statuses: d.statuses
      .filter((s) => !s.archived_at || usedStatus.has(s.id))
      .map((s) => ({ id: s.id, label: s.label, color: s.color, category: s.category, active: !s.archived_at })),
    students: d.students.map((s) => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      hostedFrom: s.hosted_from ? { id: s.hosted_from, name: d.classNames.get(s.hosted_from) ?? '?' } : null,
      pending: !!s.pending,
    })),
    // Lot 5 : élèves de la classe répartis ailleurs aujourd'hui, avec l'état remonté de leur classe d'accueil.
    distributed: d.distributed,
    notices: latestNotices((await noticesQuery(env, [classId], date).all<{ plan_id: string; class_id: string; body: string; created_at: string }>()).results),
    messages: messagesForClass(d.messages, { id: cls.id, levels: JSON.parse(cls.levels) }, date).map(publicMessage),
    // Absences prévues des élèves de la liste : l'élève est prépositionné Absent mais reste « à vérifier ».
    plannedAbsences: Object.fromEntries(Object.entries(d.planned).filter(([id]) => d.students.some((s) => s.id === id))),
    remindedAt: d.call ? null : d.remindedAt,
    call: d.call
      ? {
          version: d.call.version,
          status: d.call.status,
          remark: d.call.remark,
          entries: d.entries,
          validatedAt: d.call.first_validated_at,
          updatedAt: d.call.updated_at,
          updatedBy: people[d.call.updated_by] ?? (await names(env, [d.call.updated_by]))[d.call.updated_by],
          revisions,
        }
      : null,
  })
}

/**
 * Validation ou correction d'un appel, de façon atomique et idempotente :
 * - baseVersion : version sur laquelle l'utilisateur a travaillé (0 = nouvel appel) ;
 * - requestId : identifiant unique de la tentative ; un renvoi (double tap, réseau) ne crée rien de plus ;
 * - une correction concurrente est refusée (409) au lieu d'écraser silencieusement.
 */
export async function validateCall(env: Env, req: Request, schoolId: string, classId: string, date: string, slotId: string) {
  const u = await requireUser(env, req)
  await requireCallAccess(env, u, schoolId, classId)
  const body = await readJson<{ baseVersion?: unknown; requestId?: unknown; entries?: unknown; remark?: unknown; reason?: unknown }>(req)
  const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId) ? body.requestId : null
  if (!requestId) throw badRequest('INVALID_REQUEST', 'Requête invalide.')
  const baseVersion = typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) ? body.baseVersion : -1
  if (baseVersion < 0) throw badRequest('INVALID_REQUEST', 'Requête invalide.')
  if (typeof body.entries !== 'object' || !body.entries) throw badRequest('INVALID_ENTRIES', 'Appel incomplet.')
  const submitted = body.entries as Record<string, unknown>
  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, REMARK_MAX) || null : null
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REMARK_MAX) || null : null

  const d = await loadCall(env, schoolId, classId, date, slotId)
  checkDate(date, schoolToday(d.school.timezone))

  // Renvoi d'une tentative déjà enregistrée : on répond simplement « c'est fait ».
  if (d.call && d.call.last_request_id === requestId) return json({ ok: true, version: d.call.version, replay: true })
  if (d.noCallReason) throw conflict('NO_CALL', d.noCallReason)
  if (d.students.length === 0) throw conflict('NO_STUDENTS', 'Aucun élève attendu : il n’y a rien à valider.')
  const currentVersion = d.call?.version ?? 0
  if (baseVersion !== currentVersion)
    throw conflict('STALE_CALL', 'Cet appel vient d’être modifié par quelqu’un d’autre. La page va se mettre à jour.')

  // Chaque élève attendu a exactement un état actif ; aucun élève en trop.
  const active = new Set(d.statuses.filter((s) => !s.archived_at).map((s) => s.id))
  const allowedStudents = new Set(d.students.map((s) => s.id))
  if (Object.keys(submitted).some((id) => !allowedStudents.has(id)))
    throw conflict('STUDENTS_CHANGED', 'La liste des élèves a changé. La page va se mettre à jour.')
  const entries: Record<string, string> = {}
  for (const s of d.students) {
    const st = submitted[s.id]
    if (typeof st !== 'string') throw conflict('STUDENTS_CHANGED', 'La liste des élèves a changé. La page va se mettre à jour.')
    // Un état archivé reste acceptable s'il était déjà celui de l'élève (pas de modification).
    if (!active.has(st) && d.entries[s.id] !== st) throw badRequest('INVALID_STATUS', 'État d’appel invalide.')
    entries[s.id] = st
  }

  const changes = d.call
    ? Object.entries(entries)
        .filter(([sid, st]) => d.entries[sid] !== st)
        .map(([sid, st]) => ({ studentId: sid, from: d.entries[sid], to: st }))
    : null
  if (d.call && changes!.length === 0 && remark === d.call.remark)
    return json({ ok: true, version: d.call.version, unchanged: true })

  const now = nowIso()
  const callId = d.call?.id ?? newId()
  const version = currentVersion + 1
  const guard = 'SELECT 1 FROM attendance_calls WHERE id = ? AND last_request_id = ? AND version = ?'
  const stmts: D1PreparedStatement[] = []
  if (!d.call) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO attendance_calls (id, school_id, class_id, slot_id, slot_date, status, version, remark,
            first_validated_by, first_validated_at, updated_by, updated_at, last_request_id)
         VALUES (?, ?, ?, ?, ?, 'validated', 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (class_id, slot_id, slot_date) DO NOTHING`,
      ).bind(callId, schoolId, classId, slotId, date, remark, u.id, now, u.id, now, requestId),
    )
  } else {
    stmts.push(
      env.DB.prepare(
        `UPDATE attendance_calls SET version = ?, status = 'corrected', remark = ?, updated_by = ?, updated_at = ?, last_request_id = ?
          WHERE id = ? AND version = ?`,
      ).bind(version, remark, u.id, now, requestId, callId, currentVersion),
    )
  }
  stmts.push(
    env.DB.prepare(`DELETE FROM attendance_entries WHERE call_id = ? AND EXISTS (${guard})`).bind(callId, callId, requestId, version),
    env.DB.prepare(
      `INSERT INTO attendance_entries (call_id, student_id, status_id, hosted_from_class_id)
       SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?) WHERE EXISTS (${guard})`,
    ).bind(callId, JSON.stringify(d.students.map((s) => [s.id, entries[s.id], s.hosted_from])), callId, requestId, version),
    // UNIQUE (call_id, version) : deux validations simultanées ne peuvent pas créer la même version.
    env.DB.prepare(
      `INSERT INTO attendance_revisions (id, call_id, version, actor_user_id, at, remark, reason, changes)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard})`,
    ).bind(newId(), callId, version, u.id, now, remark, reason, changes ? JSON.stringify(changes) : null, callId, requestId, version),
    await audit(env, {
      actor: u.id,
      schoolId,
      action: d.call ? 'call.corrected' : 'call.validated',
      objectType: 'call',
      objectId: callId,
      details: { classId, slotId, date, version },
    }),
  )
  try {
    await env.DB.batch(stmts)
  } catch (e) {
    if (!(e instanceof Error && /UNIQUE constraint failed/i.test(e.message))) throw e
  }
  const after = await env.DB.prepare('SELECT version, last_request_id FROM attendance_calls WHERE class_id = ? AND slot_id = ? AND slot_date = ?')
    .bind(classId, slotId, date)
    .first<{ version: number; last_request_id: string }>()
  if (after?.last_request_id !== requestId)
    throw new HttpError(409, 'STALE_CALL', 'Cet appel vient d’être validé par quelqu’un d’autre. La page va se mettre à jour.')
  return json({ ok: true, version: after.version })
}

/** Appels du jour de l'utilisateur : ses classes affectées et leurs créneaux d'aujourd'hui. */
export async function myDay(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  const m = await requireSchoolRole(env, u, schoolId, ['direction', 'enseignant', 'remplacant'])
  const school = await env.DB.prepare('SELECT closed_weekdays, timezone FROM schools WHERE id = ?')
    .bind(schoolId)
    .first<{ closed_weekdays: number; timezone: string }>()
  const today = schoolToday(school!.timezone)
  const now = nowIso()
  const [classesR, closuresR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.name, c.levels FROM teacher_class_assignments a JOIN classes c ON c.id = a.class_id
        WHERE a.membership_id = ? AND a.start_at <= ? AND (a.end_at IS NULL OR a.end_at > ?) AND c.archived_at IS NULL ORDER BY c.name`,
    ).bind(m.id, now, now),
    env.DB.prepare('SELECT start_date, end_date, label FROM school_closures WHERE school_id = ? AND start_date <= ? AND end_date >= ?').bind(
      schoolId,
      today,
      today,
    ),
  ])
  const classes = classesR.results as { id: string; name: string; levels: string }[]
  const closure = closureFor(today, school!.closed_weekdays, closuresR.results as { start_date: string; end_date: string; label: string }[])
  const bit = 1 << (isoWeekday(today) - 1)
  const ids = JSON.stringify(classes.map((c) => c.id))
  // Lot 5 : répartitions du jour (classes réparties, élèves accueillis) et notifications de changement.
  const asgWhere = `slot_date = ? AND ended_at IS NULL AND (source_class_id IN (SELECT value FROM json_each(?)) OR host_class_id IN (SELECT value FROM json_each(?)))`
  const [slotsR, callsR, remindersR, messagesR, asgR, stuR, schR, noticesR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, class_id, name, half_day, due_time FROM call_slots
        WHERE class_id IN (SELECT value FROM json_each(?)) AND archived_at IS NULL AND (weekdays & ?) != 0 ORDER BY half_day, position`,
    ).bind(ids, bit),
    env.DB.prepare(
      `SELECT class_id, slot_id, updated_at FROM attendance_calls WHERE class_id IN (SELECT value FROM json_each(?)) AND slot_date = ?`,
    ).bind(ids, today),
    env.DB.prepare(
      `SELECT class_id, slot_id, MAX(sent_at) AS at FROM call_reminders WHERE class_id IN (SELECT value FROM json_each(?)) AND slot_date = ?
        GROUP BY class_id, slot_id`,
    ).bind(ids, today),
    visibleMessagesQuery(env, schoolId, today),
    env.DB.prepare(`SELECT student_id, source_class_id, host_class_id, half_day FROM distribution_assignments WHERE ${asgWhere}`).bind(today, ids, ids),
    env.DB.prepare(
      `SELECT id, class_id, active_from, active_to FROM students
        WHERE class_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT student_id FROM distribution_assignments WHERE ${asgWhere})`,
    ).bind(ids, today, ids, ids),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss JOIN students s ON s.id = ss.student_id
        WHERE s.class_id IN (SELECT value FROM json_each(?)) OR s.id IN (SELECT student_id FROM distribution_assignments WHERE ${asgWhere})`,
    ).bind(ids, today, ids, ids),
    noticesQuery(env, classes.map((c) => c.id), today),
  ])
  const asg = asgR.results as { student_id: string; source_class_id: string; host_class_id: string | null; half_day: HalfDay }[]
  const stu = new Map((stuR.results as { id: string; class_id: string; active_from: string; active_to: string | null }[]).map((x) => [x.id, x]))
  const sch = schR.results as { student_id: string; valid_from: string; pattern: number | null }[]
  const expectedToday = (id: string, half: HalfDay) => {
    const x = stu.get(id)
    return !!x && isExpected({ ...x, schedules: sch.filter((y) => y.student_id === id) }, today, half)
  }
  /** Pour un créneau : élèves de la classe encore attendus, élèves répartis ailleurs, élèves accueillis. */
  const distributionOf = (classId: string, half: HalfDay) => {
    const awayIds = new Set(asg.filter((a) => a.source_class_id === classId && a.half_day === half).map((a) => a.student_id))
    const own = [...stu.values()].filter((x) => x.class_id === classId && expectedToday(x.id, half))
    const hosted = asg.filter((a) => a.host_class_id === classId && a.half_day === half && expectedToday(a.student_id, half))
    return {
      remaining: own.filter((x) => !awayIds.has(x.id)).length,
      away: own.filter((x) => awayIds.has(x.id)).length,
      hostedFrom: [...new Set(hosted.map((a) => a.source_class_id))],
      hosted: hosted.length,
    }
  }
  const calls = callsR.results as { class_id: string; slot_id: string; updated_at: string }[]
  const reminders = remindersR.results as { class_id: string; slot_id: string; at: string }[]
  // Mot de la direction : messages du jour qui concernent au moins une de ses classes (sans doublon).
  const msgRows = messagesR.results as MessageRow[]
  const messages = new Map<string, { message: MessageRow; classes: string[] }>()
  for (const c of classes)
    for (const msg of messagesForClass(msgRows, { id: c.id, levels: JSON.parse(c.levels) }, today)) {
      const e = messages.get(msg.id) ?? { message: msg, classes: [] }
      e.classes.push(c.name)
      messages.set(msg.id, e)
    }
  const names = new Map(classes.map((c) => [c.id, c.name]))
  if (asg.some((a) => !names.has(a.source_class_id))) {
    const { results } = await env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ?').bind(schoolId).all<{ id: string; name: string }>()
    for (const r of results) names.set(r.id, r.name)
  }
  return json({
    today,
    closure,
    distributionNotices: latestNotices(noticesR.results as { plan_id: string; class_id: string; body: string; created_at: string }[]).map((x) => ({
      ...x,
      className: names.get(x.classId) ?? '?',
    })),
    messages: sortMessages([...messages.values()].map((e) => ({ ...e.message, classes: e.classes }))).map((m) => ({ ...publicMessage(m), classes: m.classes })),
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      slots: closure
        ? []
        : (slotsR.results as { id: string; class_id: string; name: string; half_day: string; due_time: string | null }[])
            .filter((s) => s.class_id === c.id)
            .map((s) => {
              const done = calls.find((x) => x.class_id === c.id && x.slot_id === s.id)
              const reminder = done ? undefined : reminders.find((x) => x.class_id === c.id && x.slot_id === s.id)
              const dist = distributionOf(c.id, s.half_day as HalfDay)
              return {
                // Classe entièrement répartie : pas d'appel à faire ici, les classes d'accueil s'en chargent.
                distributed: !done && dist.away > 0 && dist.remaining === 0 && dist.hosted === 0,
                awayCount: dist.away,
                hostedCount: dist.hosted,
                hostedFrom: dist.hostedFrom.map((id) => names.get(id) ?? '?'),
                id: s.id,
                name: s.name,
                halfDay: s.half_day,
                dueTime: s.due_time,
                validatedAt: done?.updated_at ?? null,
                remindedAt: reminder?.at ?? null,
              }
            }),
    })),
  })
}
