import { audit, nowIso, requireSchoolRole, requireUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, json, notFound, readJson } from '../lib/http'
import { publicMessage, schoolNowTime, schoolToday, scopeLabel, type MessageRow } from '../lib/day'
import { closureFor, isExpected, isoWeekday, isValidDate, LEVELS, levelRank, type HalfDay } from '../../src/domain/schedule'
import { coverageOf } from '../../src/domain/repartition'
import {
  addDays,
  assignTabs,
  callState,
  daysBetween,
  MESSAGE_MAX,
  MESSAGE_PRIORITIES,
  plannedCovers,
  type MessageTargetKind,
  type PlannedHalfDays,
} from '../../src/domain/direction'

/** Tableau de bord, messages, relances et historique : réservés à la direction de l'école. */
export async function direction(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  return u
}

async function schoolInfo(env: Env, schoolId: string) {
  const s = await env.DB.prepare('SELECT name, closed_weekdays, timezone FROM schools WHERE id = ?')
    .bind(schoolId)
    .first<{ name: string; closed_weekdays: number; timezone: string }>()
  if (!s) throw notFound()
  return s
}

interface ClassRow {
  id: string
  name: string
  levels: string
  created_at: string
}
interface SlotRow {
  id: string
  class_id: string
  name: string
  half_day: HalfDay
  due_time: string | null
  weekdays: number
  created_at: string
}
interface CallCountRow {
  id: string
  class_id: string
  slot_id: string
  slot_date: string
  status: 'validated' | 'corrected'
  version: number
  first_validated_at: string
  updated_at: string
  first_by: string
  updated_by_name: string
  actors: string | null
  present: number
  absent: number
  other: number
  hosted: number
}
type StudentLite = { id: string; class_id: string; active_from: string; active_to: string | null }
type ScheduleLite = { student_id: string; valid_from: string; pattern: number | null }

/** Appels d'une période avec les effectifs par catégorie (une seule requête). */
function callsWithCounts(env: Env, schoolId: string, from: string, to: string) {
  return env.DB.prepare(
    `SELECT c.id, c.class_id, c.slot_id, c.slot_date, c.status, c.version, c.first_validated_at, c.updated_at,
            c.first_validated_by AS first_by, u.display_name AS updated_by_name,
            (SELECT GROUP_CONCAT(DISTINCT r.actor_user_id) FROM attendance_revisions r WHERE r.call_id = c.id) AS actors,
            COALESCE(SUM(st.category = 'PRESENT'), 0) AS present,
            COALESCE(SUM(st.category = 'ABSENT'), 0) AS absent,
            COALESCE(SUM(st.category = 'AUTRE'), 0) AS other,
            COALESCE(SUM(e.hosted_from_class_id IS NOT NULL), 0) AS hosted
       FROM attendance_calls c
       JOIN users u ON u.id = c.updated_by
       LEFT JOIN attendance_entries e ON e.call_id = c.id
       LEFT JOIN attendance_statuses st ON st.id = e.status_id
      WHERE c.school_id = ? AND c.slot_date BETWEEN ? AND ?
      GROUP BY c.id`,
  ).bind(schoolId, from, to)
}

/** Élèves inscrits sur une période et leurs emplois du temps, pour compter les élèves attendus. */
function studentsQueries(env: Env, schoolId: string, from: string, to: string) {
  return [
    env.DB.prepare(
      'SELECT id, class_id, active_from, active_to FROM students WHERE school_id = ? AND active_from <= ? AND (active_to IS NULL OR active_to >= ?)',
    ).bind(schoolId, to, from),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss JOIN students s ON s.id = ss.student_id
        WHERE s.school_id = ? AND s.active_from <= ? AND (s.active_to IS NULL OR s.active_to >= ?)`,
    ).bind(schoolId, to, from),
  ]
}

function expectedCounter(students: StudentLite[], schedules: ScheduleLite[]) {
  const byStudent = new Map<string, ScheduleLite[]>()
  for (const s of schedules) byStudent.set(s.student_id, [...(byStudent.get(s.student_id) ?? []), s])
  const byClass = new Map<string, StudentLite[]>()
  for (const s of students) byClass.set(s.class_id, [...(byClass.get(s.class_id) ?? []), s])
  const byId = new Map(students.map((s) => [s.id, s]))
  const count = (classId: string, date: string, half: HalfDay) =>
    (byClass.get(classId) ?? []).filter((s) => isExpected({ ...s, schedules: byStudent.get(s.id) ?? [] }, date, half)).length
  /** Un élève précis est-il attendu ce jour-là (répartitions : on ne compte que les élèves attendus) ? */
  count.student = (id: string, date: string, half: HalfDay) => {
    const s = byId.get(id)
    return !!s && isExpected({ ...s, schedules: byStudent.get(id) ?? [] }, date, half)
  }
  return count
}

interface AssignmentLite {
  plan_id: string
  student_id: string
  source_class_id: string
  host_class_id: string | null
  slot_date: string
  half_day: HalfDay
  category: string | null
}

/** Affectations actives d'une période, avec l'état saisi dans l'appel validé de la classe d'accueil. */
function assignmentsQuery(env: Env, schoolId: string, from: string, to: string) {
  return env.DB.prepare(
    `SELECT a.plan_id, a.student_id, a.source_class_id, a.host_class_id, a.slot_date, a.half_day,
            (SELECT st.category FROM attendance_entries e JOIN attendance_calls c ON c.id = e.call_id
               JOIN call_slots sl ON sl.id = c.slot_id JOIN attendance_statuses st ON st.id = e.status_id
              WHERE e.student_id = a.student_id AND c.class_id = a.host_class_id AND c.slot_date = a.slot_date AND sl.half_day = a.half_day
              ORDER BY c.updated_at DESC LIMIT 1) AS category
       FROM distribution_assignments a WHERE a.school_id = ? AND a.ended_at IS NULL AND a.slot_date BETWEEN ? AND ?`,
  ).bind(schoolId, from, to)
}

/**
 * Situation d'un créneau de classe vis-à-vis des répartitions : élèves répartis ailleurs (avec la
 * couverture remontée des classes d'accueil), élèves accueillis, élèves encore attendus dans la classe.
 */
function distributionFor(
  list: AssignmentLite[],
  expected: ReturnType<typeof expectedCounter>,
  names: Map<string, string>,
  classId: string,
  date: string,
  half: HalfDay,
) {
  const here = list.filter((a) => a.slot_date === date && a.half_day === half && expected.student(a.student_id, date, half))
  const away = here.filter((a) => a.source_class_id === classId)
  const hosted = here.filter((a) => a.host_class_id === classId)
  const own = expected(classId, date, half)
  const cov = coverageOf(away.map((a) => ({ hostClassId: a.host_class_id, category: a.category })))
  // Classes d'accueil dans l'ordre de l'école (names est construit dans l'ordre d'affichage).
  const order = [...names.keys()]
  const hostIds = [...new Set(away.map((a) => a.host_class_id).filter((x): x is string => !!x))].sort((x, y) => order.indexOf(x) - order.indexOf(y))
  return {
    remaining: Math.max(0, own - away.length),
    hostedCount: hosted.length,
    distribution: away.length
      ? {
          ...cov,
          planId: away[0].plan_id,
          hosts: hostIds.map((h) => {
            const c = coverageOf(away.filter((a) => a.host_class_id === h).map((a) => ({ hostClassId: h, category: a.category })))
            return { className: names.get(h) ?? '?', total: c.total, confirmed: c.confirmed }
          }),
        }
      : null,
    hosted: hosted.length ? { count: hosted.length, from: [...new Set(hosted.map((a) => names.get(a.source_class_id) ?? '?'))] } : null,
  }
}

const fullName = (f: string, l: string | null) => `${f} ${l ?? ''}`.trim()

// ---------- Tableau de bord « Aujourd'hui » ----------

/**
 * Vue du jour pour la direction (§8.1) : une ligne par classe et créneau prévu ce jour-là,
 * avec l'état, l'heure de validation, l'enseignant, les effectifs et un aperçu des absents.
 * Lu périodiquement par l'écran (sondage léger) : une seule série de requêtes groupées.
 */
export async function getDashboard(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const school = await schoolInfo(env, schoolId)
  const today = schoolToday(school.timezone)
  const q = new URL(req.url).searchParams.get('date')
  const date = q ?? today
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date invalide.')
  const nowTime = schoolNowTime(school.timezone)
  const now = nowIso()
  const bit = 1 << (isoWeekday(date) - 1)
  const [closuresR, classesR, teachersR, slotsR, callsR, absenteesR, studentsR, schedulesR, remindersR, plannedR, assignR, plansR] = await env.DB.batch([
    env.DB.prepare('SELECT start_date, end_date, label FROM school_closures WHERE school_id = ? AND start_date <= ? AND end_date >= ?').bind(
      schoolId,
      date,
      date,
    ),
    env.DB.prepare('SELECT id, name, levels, created_at FROM classes WHERE school_id = ? AND archived_at IS NULL').bind(schoolId),
    env.DB.prepare(
      `SELECT a.class_id, u.display_name FROM teacher_class_assignments a
         JOIN memberships m ON m.id = a.membership_id JOIN users u ON u.id = m.user_id
        WHERE a.school_id = ? AND a.start_at <= ? AND (a.end_at IS NULL OR a.end_at > ?) AND m.revoked_at IS NULL
          AND (m.active_to IS NULL OR m.active_to > ?) ORDER BY u.display_name`,
    ).bind(schoolId, now, now, now),
    env.DB.prepare(
      `SELECT id, class_id, name, half_day, due_time, weekdays, created_at FROM call_slots
        WHERE school_id = ? AND archived_at IS NULL AND (weekdays & ?) != 0 ORDER BY half_day, position, created_at`,
    ).bind(schoolId, bit),
    callsWithCounts(env, schoolId, date, date),
    env.DB.prepare(
      `SELECT c.class_id, c.slot_id, s.first_name, s.last_name, st.label, st.category FROM attendance_calls c
         JOIN attendance_entries e ON e.call_id = c.id JOIN students s ON s.id = e.student_id
         JOIN attendance_statuses st ON st.id = e.status_id
        WHERE c.school_id = ? AND c.slot_date = ? AND st.category != 'PRESENT'
        ORDER BY s.first_name COLLATE NOCASE`,
    ).bind(schoolId, date),
    ...studentsQueries(env, schoolId, date, date),
    env.DB.prepare(
      'SELECT class_id, slot_id, MAX(sent_at) AS at FROM call_reminders WHERE school_id = ? AND slot_date = ? GROUP BY class_id, slot_id',
    ).bind(schoolId, date),
    env.DB.prepare(
      `SELECT s.class_id, pa.start_date, pa.end_date, pa.half_days FROM planned_absences pa JOIN students s ON s.id = pa.student_id
        WHERE pa.school_id = ? AND pa.cancelled_at IS NULL AND pa.start_date <= ? AND pa.end_date >= ?`,
    ).bind(schoolId, date, date),
    // Lot 5 : répartitions du jour.
    assignmentsQuery(env, schoolId, date, date),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM distribution_plans WHERE school_id = ? AND state = 'active' AND start_date <= ? AND end_date >= ?
          AND EXISTS (SELECT 1 FROM distribution_assignments a WHERE a.plan_id = distribution_plans.id AND a.slot_date = ? AND a.ended_at IS NULL)`,
    ).bind(schoolId, date, date, date),
  ])
  const closure = closureFor(date, school.closed_weekdays, closuresR.results as { start_date: string; end_date: string; label: string }[])
  const classes = new Map((classesR.results as ClassRow[]).map((c) => [c.id, { ...c, levelList: JSON.parse(c.levels) as string[] }]))
  const teachers = teachersR.results as { class_id: string; display_name: string }[]
  // Créneaux des classes actives, dans l'ordre d'affichage (matin puis après-midi).
  const slots = (slotsR.results as SlotRow[]).filter((s) => classes.has(s.class_id))
  const tabs = assignTabs(slots)
  const calls = callsR.results as CallCountRow[]
  const absentees = absenteesR.results as { class_id: string; slot_id: string; first_name: string; last_name: string | null; label: string }[]
  const expected = expectedCounter(studentsR.results as StudentLite[], schedulesR.results as ScheduleLite[])
  const reminders = remindersR.results as { class_id: string; slot_id: string; at: string }[]
  const planned = plannedR.results as { class_id: string; start_date: string; end_date: string; half_days: PlannedHalfDays }[]
  const assignments = assignR.results as AssignmentLite[]
  const classNames = new Map(
    [...classes.values()]
      .sort((x, y) => levelRank(x.levelList) - levelRank(y.levelList) || x.name.localeCompare(y.name, 'fr', { numeric: true }))
      .map((c) => [c.id, c.name]),
  )

  const rows = closure
    ? []
    : slots.map((s) => {
        const cls = classes.get(s.class_id)!
        const call = calls.find((c) => c.class_id === s.class_id && c.slot_id === s.id)
        const dist = distributionFor(assignments, expected, classNames, cls.id, date, s.half_day)
        // Classe entièrement répartie : « Répartie » avec sa couverture, plutôt qu'« appel absent » (§7.3).
        const fullyDistributed = !call && !!dist.distribution && dist.remaining === 0 && dist.hostedCount === 0
        return {
          classId: cls.id,
          className: cls.name,
          levels: cls.levelList,
          teachers: teachers.filter((t) => t.class_id === cls.id).map((t) => t.display_name),
          slot: { id: s.id, name: s.name, halfDay: s.half_day, dueTime: s.due_time },
          tab: tabs.get(s.id)!,
          state: fullyDistributed ? ('distributed' as const) : callState({ validated: !!call, date, today, nowTime, dueTime: s.due_time }),
          expected: call ? call.present + call.absent + call.other : dist.remaining + dist.hostedCount,
          distribution: dist.distribution,
          hosted: call ? (call.hosted ? { count: call.hosted, from: dist.hosted?.from ?? [] } : null) : dist.hosted,
          counts: call ? { present: call.present, absent: call.absent, other: call.other } : null,
          validatedAt: call?.first_validated_at ?? null,
          updatedAt: call?.updated_at ?? null,
          validatedBy: call?.updated_by_name ?? null,
          corrected: call?.status === 'corrected',
          absentees: absentees
            .filter((a) => a.class_id === s.class_id && a.slot_id === s.id)
            .map((a) => ({ name: fullName(a.first_name, a.last_name), label: a.label })),
          plannedAbsences: planned.filter((p) => p.class_id === cls.id && plannedCovers(p, date, s.half_day)).length,
          remindedAt: call ? null : (reminders.find((r) => r.class_id === s.class_id && r.slot_id === s.id)?.at ?? null),
        }
      })
  rows.sort(
    (a, b) =>
      levelRank(a.levels) - levelRank(b.levels) ||
      a.className.localeCompare(b.className, 'fr', { numeric: true }) ||
      a.slot.halfDay.localeCompare(b.slot.halfDay),
  )
  return json({
    date,
    today,
    nowTime,
    serverTime: now,
    closure,
    activeDistributions: (plansR.results[0] as { n: number } | undefined)?.n ?? 0,
    rows,
  })
}

// ---------- Relance d'un enseignant ----------

/** La direction relance l'enseignant d'un appel non fait aujourd'hui : notification interne, sans e-mail. */
export async function remindCall(env: Env, req: Request, schoolId: string, classId: string, date: string, slotId: string) {
  const u = await direction(env, req, schoolId)
  const school = await schoolInfo(env, schoolId)
  if (date !== schoolToday(school.timezone)) throw badRequest('NOT_TODAY', 'On ne peut relancer que les appels du jour.')
  const [slotR, callR, lastR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT sl.id FROM call_slots sl JOIN classes c ON c.id = sl.class_id
        WHERE sl.id = ? AND sl.class_id = ? AND sl.school_id = ? AND c.school_id = ? AND sl.archived_at IS NULL AND c.archived_at IS NULL`,
    ).bind(slotId, classId, schoolId, schoolId),
    env.DB.prepare('SELECT 1 FROM attendance_calls WHERE class_id = ? AND slot_id = ? AND slot_date = ?').bind(classId, slotId, date),
    env.DB.prepare('SELECT MAX(sent_at) AS at FROM call_reminders WHERE class_id = ? AND slot_id = ? AND slot_date = ?').bind(classId, slotId, date),
  ])
  if (!slotR.results.length) throw notFound()
  if (callR.results.length) throw conflict('ALREADY_DONE', 'Cet appel vient d’être validé : pas besoin de relancer.')
  const last = (lastR.results[0] as { at: string | null } | undefined)?.at
  // Anti-doublon : une relance par appel toutes les 5 minutes au plus.
  if (last && Date.now() - Date.parse(last) < 5 * 60_000) return json({ ok: true, remindedAt: last, repeat: true })
  const at = nowIso()
  const id = newId()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO call_reminders (id, school_id, class_id, slot_id, slot_date, sent_by, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      schoolId,
      classId,
      slotId,
      date,
      u.id,
      at,
    ),
    await audit(env, { actor: u.id, schoolId, action: 'call.reminded', objectType: 'call_slot', objectId: slotId, details: { classId, date } }),
  ])
  return json({ ok: true, remindedAt: at })
}

// ---------- Messages ciblés ----------

export async function listMessages(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const school = await schoolInfo(env, schoolId)
  const today = schoolToday(school.timezone)
  const [msgR, classesR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT m.id, m.target_kind, m.targets, m.body, m.priority, m.start_date, m.end_date, m.created_at, m.archived_at, u.display_name AS author
         FROM direction_messages m JOIN users u ON u.id = m.created_by
        WHERE m.school_id = ? AND m.archived_at IS NULL AND m.end_date >= ? ORDER BY m.start_date, m.created_at DESC`,
    ).bind(schoolId, addDays(today, -7)),
    env.DB.prepare('SELECT id, name, levels FROM classes WHERE school_id = ? AND archived_at IS NULL').bind(schoolId),
  ])
  const classes = (classesR.results as { id: string; name: string; levels: string }[])
    .map((c) => ({ id: c.id, name: c.name, levels: JSON.parse(c.levels) as string[] }))
    .sort((a, b) => levelRank(a.levels) - levelRank(b.levels) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
  const names = new Map(classes.map((c) => [c.id, c.name]))
  return json({
    today,
    classes,
    messages: (msgR.results as (MessageRow & { author: string })[]).map((m) => {
      const targets = JSON.parse(m.targets) as string[]
      return {
        ...publicMessage(m),
        targetKind: m.target_kind,
        targets,
        scope: scopeLabel(m.target_kind, targets, names),
        author: m.author,
        createdAt: m.created_at,
        state: m.end_date < today ? 'past' : m.start_date > today ? 'upcoming' : 'current',
      }
    }),
  })
}

export async function createMessage(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const school = await schoolInfo(env, schoolId)
  const today = schoolToday(school.timezone)
  const b = await readJson<Record<string, unknown>>(req)
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body || body.length > MESSAGE_MAX) throw badRequest('INVALID_MESSAGE', `Écrivez un message de ${MESSAGE_MAX} caractères au plus.`)
  const kind = b.targetKind as MessageTargetKind
  if (!['school', 'levels', 'classes'].includes(kind)) throw badRequest('INVALID_TARGET', 'Choisissez à qui s’adresse le message.')
  const priority = MESSAGE_PRIORITIES.includes(b.priority as never) ? (b.priority as string) : 'normal'
  let targets: string[] = []
  if (kind !== 'school') {
    if (!Array.isArray(b.targets) || b.targets.length === 0 || b.targets.length > 60 || !b.targets.every((t) => typeof t === 'string'))
      throw badRequest('INVALID_TARGET', 'Choisissez au moins une classe ou un niveau.')
    targets = [...new Set(b.targets as string[])]
    if (kind === 'levels' && !targets.every((l) => (LEVELS as readonly string[]).includes(l)))
      throw badRequest('INVALID_TARGET', 'Niveau inconnu.')
    if (kind === 'classes') {
      // Chaque classe doit appartenir à cette école (cloisonnement).
      const r = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM classes WHERE school_id = ? AND archived_at IS NULL AND id IN (SELECT value FROM json_each(?))',
      )
        .bind(schoolId, JSON.stringify(targets))
        .first<{ n: number }>()
      if ((r?.n ?? 0) !== targets.length) throw badRequest('INVALID_TARGET', 'Classe introuvable.')
    }
  }
  const start = b.startDate ?? today
  const end = b.endDate ?? start
  if (!isValidDate(start) || !isValidDate(end)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (end < start) throw badRequest('INVALID_DATE', 'La fin de visibilité doit suivre le début.')
  if (end < today) throw badRequest('INVALID_DATE', 'Ce message ne serait jamais visible : choisissez une date à venir.')
  if (daysBetween(start, end) > 366) throw badRequest('INVALID_DATE', 'Visibilité limitée à un an.')
  const id = newId()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO direction_messages (id, school_id, target_kind, targets, body, priority, start_date, end_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, schoolId, kind, JSON.stringify(targets), body, priority, start, end, u.id, nowIso()),
    await audit(env, { actor: u.id, schoolId, action: 'message.created', objectType: 'message', objectId: id, details: { kind, start, end } }),
  ])
  return json({ id }, { status: 201 })
}

/** Retirer un message : il n'est plus affiché (conservé pour l'audit). */
export async function archiveMessage(env: Env, req: Request, schoolId: string, messageId: string) {
  const u = await direction(env, req, schoolId)
  const r = await env.DB.prepare('UPDATE direction_messages SET archived_at = ?, archived_by = ? WHERE id = ? AND school_id = ? AND archived_at IS NULL')
    .bind(nowIso(), u.id, messageId, schoolId)
    .run()
  if (!r.meta.changes) throw notFound()
  await audit(env, { actor: u.id, schoolId, action: 'message.archived', objectType: 'message', objectId: messageId }).then((s) => s.run())
  return json({ ok: true })
}

// ---------- Historique ----------

export const HISTORY_MAX_DAYS = 62
const HISTORY_MAX_ROWS = 500

/**
 * Historique des appels (§9, partie lot 4) : filtres date, classe, personne ayant validé ou corrigé,
 * et état (validé, corrigé, non fait). Les appels non faits sont reconstitués depuis les créneaux.
 */
export async function getHistory(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const h = await buildHistory(env, schoolId, new URL(req.url).searchParams)
  return json({
    from: h.from,
    to: h.to,
    today: h.today,
    truncated: h.rows.length > HISTORY_MAX_ROWS,
    rows: h.rows.slice(0, HISTORY_MAX_ROWS).map((r) => ({ ...r, levels: undefined, callId: undefined })),
    classes: h.classes,
    people: h.people,
  })
}

export type HistoryRow = Awaited<ReturnType<typeof buildHistory>>['rows'][number]

/**
 * Calcul de l'historique filtré (sans contrôle d'accès : l'appelant a déjà vérifié le rôle Direction).
 * Partagé par l'écran Historique et les exports (lot 6).
 */
export async function buildHistory(env: Env, schoolId: string, p: URLSearchParams) {
  const school = await schoolInfo(env, schoolId)
  const today = schoolToday(school.timezone)
  let to = p.get('to') || today
  const from = p.get('from') || addDays(to > today ? today : to, -6)
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (to > today) to = today
  if (from > to) throw badRequest('INVALID_DATE', 'La date de début doit précéder la date de fin.')
  if (daysBetween(from, to) >= HISTORY_MAX_DAYS) throw badRequest('RANGE_TOO_LONG', `Choisissez une période de ${HISTORY_MAX_DAYS} jours au plus.`)
  const classFilter = p.get('classId') || null
  const userFilter = p.get('userId') || null
  const stateFilter = p.get('state') || null
  if (stateFilter && !['validated', 'corrected', 'missing', 'distributed'].includes(stateFilter)) throw badRequest('INVALID_STATE', 'État inconnu.')
  // Filtre « répartition » : appels de classes d'accueil avec élèves accueillis, classes réparties.
  const distributionFilter = p.get('distribution') === '1'

  const [closuresR, classesR, slotsR, callsR, studentsR, schedulesR, peopleR, assignR] = await env.DB.batch([
    env.DB.prepare('SELECT start_date, end_date, label FROM school_closures WHERE school_id = ? AND end_date >= ? AND start_date <= ?').bind(
      schoolId,
      from,
      to,
    ),
    env.DB.prepare('SELECT id, name, levels, created_at, archived_at FROM classes WHERE school_id = ?').bind(schoolId),
    env.DB.prepare(
      'SELECT id, class_id, name, half_day, due_time, weekdays, created_at, archived_at FROM call_slots WHERE school_id = ? ORDER BY half_day, position, created_at',
    ).bind(schoolId),
    callsWithCounts(env, schoolId, from, to),
    ...studentsQueries(env, schoolId, from, to),
    env.DB.prepare(
      `SELECT DISTINCT u.id, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.school_id = ? ORDER BY u.display_name`,
    ).bind(schoolId),
    assignmentsQuery(env, schoolId, from, to),
  ])
  const assignments = assignR.results as AssignmentLite[]
  const closures = closuresR.results as { start_date: string; end_date: string; label: string }[]
  const classes = new Map(
    (classesR.results as (ClassRow & { archived_at: string | null })[]).map((c) => [c.id, { ...c, levelList: JSON.parse(c.levels) as string[] }]),
  )
  const slots = (slotsR.results as (SlotRow & { archived_at: string | null })[]).filter((s) => classes.has(s.class_id))
  const slotById = new Map(slots.map((s) => [s.id, s]))
  const calls = callsR.results as CallCountRow[]
  const expected = expectedCounter(studentsR.results as StudentLite[], schedulesR.results as ScheduleLite[])
  const classNames = new Map(
    [...classes.values()]
      .sort((x, y) => levelRank(x.levelList) - levelRank(y.levelList) || x.name.localeCompare(y.name, 'fr', { numeric: true }))
      .map((c) => [c.id, c.name]),
  )

  type Row = {
    callId: string | null
    date: string
    classId: string
    className: string
    slot: { id: string; name: string; halfDay: HalfDay }
    state: 'validated' | 'corrected' | 'missing' | 'distributed'
    version: number | null
    hosted: { count: number; from: string[] } | null
    distribution: { total: number; confirmed: number; hosts: { className: string; total: number; confirmed: number }[] } | null
    validatedAt: string | null
    updatedAt: string | null
    by: string | null
    counts: { present: number; absent: number; other: number } | null
    expected: number
    levels: string[]
  }
  const rows: Row[] = []
  for (const c of calls) {
    const cls = classes.get(c.class_id)
    const slot = slotById.get(c.slot_id)
    if (!cls || !slot) continue
    if (userFilter && !(c.actors ?? '').split(',').includes(userFilter) && c.first_by !== userFilter) continue
    const dist = distributionFor(assignments, expected, classNames, cls.id, c.slot_date, slot.half_day)
    rows.push({
      callId: c.id,
      hosted: c.hosted ? { count: c.hosted, from: dist.hosted?.from ?? [] } : null,
      distribution: dist.distribution,
      date: c.slot_date,
      classId: cls.id,
      className: cls.name,
      levels: cls.levelList,
      slot: { id: slot.id, name: slot.name, halfDay: slot.half_day },
      state: c.status,
      version: c.version,
      validatedAt: c.first_validated_at,
      updatedAt: c.updated_at,
      by: c.updated_by_name,
      counts: { present: c.present, absent: c.absent, other: c.other },
      expected: c.present + c.absent + c.other,
    })
  }
  // Appels non faits : créneau actif ce jour-là, classe ouverte, au moins un élève attendu, aucun appel.
  // Un filtre « personne » ne garde que des appels faits : un appel non fait n'a pas d'auteur.
  if (!userFilter) {
    const done = new Set(calls.map((c) => `${c.slot_date}:${c.slot_id}`))
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (closureFor(d, school.closed_weekdays, closures)) continue
      const bit = 1 << (isoWeekday(d) - 1)
      for (const s of slots) {
        const cls = classes.get(s.class_id)!
        if (!(s.weekdays & bit) || done.has(`${d}:${s.id}`)) continue
        if (s.created_at.slice(0, 10) > d || (s.archived_at && s.archived_at.slice(0, 10) <= d)) continue
        if (cls.created_at.slice(0, 10) > d || (cls.archived_at && cls.archived_at.slice(0, 10) <= d)) continue
        const dist = distributionFor(assignments, expected, classNames, cls.id, d, s.half_day)
        const n = dist.remaining + dist.hostedCount
        // Classe entièrement répartie : pas « non fait », mais « Répartie » avec sa couverture.
        const isDistributed = n === 0 && !!dist.distribution
        if (n === 0 && !isDistributed) continue
        rows.push({
          callId: null,
          hosted: dist.hosted,
          distribution: dist.distribution,
          date: d,
          classId: cls.id,
          className: cls.name,
          levels: cls.levelList,
          slot: { id: s.id, name: s.name, halfDay: s.half_day },
          state: isDistributed ? 'distributed' : 'missing',
          version: null,
          validatedAt: null,
          updatedAt: null,
          by: null,
          counts: null,
          expected: isDistributed ? dist.distribution!.total : n,
        })
      }
    }
  }
  const filtered = rows
    .filter(
      (r) =>
        (!classFilter || r.classId === classFilter) &&
        (!stateFilter || r.state === stateFilter) &&
        (!distributionFilter || r.distribution !== null || r.hosted !== null),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        levelRank(a.levels) - levelRank(b.levels) ||
        a.className.localeCompare(b.className, 'fr', { numeric: true }) ||
        a.slot.halfDay.localeCompare(b.slot.halfDay),
    )
  return {
    from,
    to,
    today,
    schoolName: school.name,
    timezone: school.timezone,
    rows: filtered,
    classes: [...classes.values()]
      .filter((c) => !c.archived_at)
      .sort((a, b) => levelRank(a.levelList) - levelRank(b.levelList) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
      .map((c) => ({ id: c.id, name: c.name })),
    people: peopleR.results as { id: string; display_name: string }[],
  }
}

