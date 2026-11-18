import { audit, nowIso, requireSchoolRole, requireUser, type Env } from '../lib/auth'
import { newId } from '../lib/crypto'
import { badRequest, conflict, HttpError, json, notFound, readJson } from '../lib/http'
import { schoolToday } from '../lib/day'
import { addDays, daysBetween } from '../../src/domain/direction'
import { isExpected, isValidDate, levelRank, type HalfDay } from '../../src/domain/schedule'
import {
  assignmentKey,
  changedStudents,
  checkDistribution,
  coverageOf,
  diffAssignments,
  expandAssignments,
  PLAN_MAX_DAYS,
  planSlots,
  type AssignmentRow,
  type PlanHalfDays,
  type PlanSlot,
  periodLabel,
} from '../../src/domain/repartition'

/**
 * Répartitions temporaires (cahier des charges §7) : une classe d'origine est répartie dans des
 * classes d'accueil, pour une ou plusieurs demi-journées. Chaque élève a au plus une affectation
 * active par demi-journée (index unique en base) ; sa classe d'inscription ne change pas.
 * Réservé à la direction de l'école.
 */

const HALF_DAYS: PlanHalfDays[] = ['day', 'am', 'pm']
const MAX_HOSTS = 12
const MAX_CAPACITY = 60

async function direction(env: Env, req: Request, schoolId: string) {
  const u = await requireUser(env, req)
  await requireSchoolRole(env, u, schoolId, ['direction'])
  return u
}

interface StudentRow {
  id: string
  class_id: string
  first_name: string
  last_name: string | null
  active_from: string
  active_to: string | null
}
interface ActiveAssignment extends AssignmentRow {
  id: string
  planId: string
  sourceClassId: string
}
interface PlanRow {
  id: string
  school_id: string
  source_class_id: string
  start_date: string
  end_date: string
  half_days: PlanHalfDays
  hosts: string
  state: 'active' | 'cancelled'
  version: number
  last_request_id: string
  created_at: string
  updated_at: string
}
type HostSpec = { classId: string; capacity: number | null }

const fullName = (s: { first_name: string; last_name: string | null }) => `${s.first_name} ${s.last_name ?? ''}`.trim()
const byName = (a: { first_name: string; last_name: string | null }, b: { first_name: string; last_name: string | null }) =>
  a.first_name.localeCompare(b.first_name, 'fr', { sensitivity: 'base' }) || (a.last_name ?? '').localeCompare(b.last_name ?? '', 'fr')

/** Données de l'école sur une période : classes, élèves attendus, affectations actives. */
async function loadContext(env: Env, schoolId: string, from: string, to: string) {
  const [schoolR, closuresR, classesR, studentsR, schedulesR, assignR] = await env.DB.batch([
    env.DB.prepare('SELECT closed_weekdays, timezone FROM schools WHERE id = ?').bind(schoolId),
    env.DB.prepare('SELECT start_date, end_date, label FROM school_closures WHERE school_id = ? AND start_date <= ? AND end_date >= ?').bind(
      schoolId,
      to,
      from,
    ),
    env.DB.prepare('SELECT id, name, levels FROM classes WHERE school_id = ? AND archived_at IS NULL').bind(schoolId),
    env.DB.prepare(
      `SELECT id, class_id, first_name, last_name, active_from, active_to FROM students
        WHERE school_id = ? AND active_from <= ? AND (active_to IS NULL OR active_to >= ?)`,
    ).bind(schoolId, to, from),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss JOIN students s ON s.id = ss.student_id
        WHERE s.school_id = ? AND s.active_from <= ? AND (s.active_to IS NULL OR s.active_to >= ?)`,
    ).bind(schoolId, to, from),
    env.DB.prepare(
      `SELECT id, plan_id, student_id, source_class_id, host_class_id, slot_date, half_day FROM distribution_assignments
        WHERE school_id = ? AND ended_at IS NULL AND slot_date BETWEEN ? AND ?`,
    ).bind(schoolId, from, to),
  ])
  const school = schoolR.results[0] as { closed_weekdays: number; timezone: string } | undefined
  if (!school) throw notFound()
  const classes = (classesR.results as { id: string; name: string; levels: string }[])
    .map((c) => ({ id: c.id, name: c.name, levels: JSON.parse(c.levels) as string[] }))
    .sort((a, b) => levelRank(a.levels) - levelRank(b.levels) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
  const students = studentsR.results as StudentRow[]
  const schedules = new Map<string, { valid_from: string; pattern: number | null }[]>()
  for (const s of schedulesR.results as { student_id: string; valid_from: string; pattern: number | null }[])
    schedules.set(s.student_id, [...(schedules.get(s.student_id) ?? []), s])
  const studentById = new Map(students.map((s) => [s.id, s]))
  const expected = (id: string, slot: PlanSlot) => {
    const s = studentById.get(id)
    return !!s && isExpected({ ...s, schedules: schedules.get(id) ?? [] }, slot.date, slot.half)
  }
  const assignments: ActiveAssignment[] = (
    assignR.results as { id: string; plan_id: string; student_id: string; source_class_id: string; host_class_id: string | null; slot_date: string; half_day: HalfDay }[]
  ).map((a) => ({
    id: a.id,
    planId: a.plan_id,
    studentId: a.student_id,
    sourceClassId: a.source_class_id,
    hostClassId: a.host_class_id,
    date: a.slot_date,
    half: a.half_day,
  }))
  return { school, closures: closuresR.results as { start_date: string; end_date: string; label: string }[], classes, students, expected, assignments }
}
type Context = Awaited<ReturnType<typeof loadContext>>

/**
 * Effectif physique attendu d'une classe sur une demi-journée : ses élèves attendus, moins ceux répartis
 * ailleurs, plus les élèves qu'elle accueille déjà (autres répartitions). On garde le maximum sur la période.
 */
function loads(ctx: Context, slots: PlanSlot[], excludePlanId: string | null) {
  const out = new Map<string, number>()
  const others = ctx.assignments.filter((a) => a.planId !== excludePlanId)
  for (const slot of slots) {
    const here = others.filter((a) => a.date === slot.date && a.half === slot.half)
    const away = new Set(here.map((a) => a.studentId))
    const counts = new Map<string, number>()
    for (const s of ctx.students) if (!away.has(s.id) && ctx.expected(s.id, slot)) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1)
    for (const a of here) if (a.hostClassId && ctx.expected(a.studentId, slot)) counts.set(a.hostClassId, (counts.get(a.hostClassId) ?? 0) + 1)
    for (const c of ctx.classes) out.set(c.id, Math.max(out.get(c.id) ?? 0, counts.get(c.id) ?? 0))
  }
  return out
}

/** Élèves de la classe d'origine attendus sur au moins une demi-journée de la période. */
function sourceStudents(ctx: Context, classId: string, slots: PlanSlot[]) {
  return ctx.students
    .filter((s) => s.class_id === classId)
    .map((s) => ({ s, n: slots.filter((sl) => ctx.expected(s.id, sl)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => byName(a.s, b.s))
}

/** Élèves déjà comptés dans un appel validé (n'importe quelle classe) : leur affectation est figée. */
async function countedKeys(env: Env, schoolId: string, studentIds: string[], from: string, to: string) {
  if (!studentIds.length) return new Set<string>()
  const { results } = await env.DB.prepare(
    `SELECT e.student_id, c.slot_date, sl.half_day FROM attendance_entries e
       JOIN attendance_calls c ON c.id = e.call_id JOIN call_slots sl ON sl.id = c.slot_id
      WHERE c.school_id = ? AND c.slot_date BETWEEN ? AND ? AND e.student_id IN (SELECT value FROM json_each(?))`,
  )
    .bind(schoolId, from, to, JSON.stringify(studentIds))
    .all<{ student_id: string; slot_date: string; half_day: HalfDay }>()
  return new Set(results.map((r) => assignmentKey({ studentId: r.student_id, date: r.slot_date, half: r.half_day })))
}

/** Choix courant d'un plan (élève → classe d'accueil ou null), tel qu'enregistré à la dernière version. */
async function currentChoice(env: Env, planId: string) {
  const r = await env.DB.prepare('SELECT details FROM distribution_changes WHERE plan_id = ? ORDER BY version DESC LIMIT 1')
    .bind(planId)
    .first<{ details: string | null }>()
  return (r?.details ? (JSON.parse(r.details).after as Record<string, string | null>) : {}) ?? {}
}

// ---------- Libellés des notifications ----------

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k > 1 ? many : one}`

function splitLabel(choice: Record<string, string | null>, hosts: HostSpec[], names: Map<string, string>) {
  const parts = hosts.map((h) => {
    const k = Object.values(choice).filter((x) => x === h.classId).length
    return `${n(k, 'élève')} en ${names.get(h.classId) ?? '?'}`
  })
  const absent = Object.values(choice).filter((x) => x === null).length
  if (absent) parts.push(n(absent, 'absent connu', 'absents connus'))
  return parts.join(', ')
}

function noticesFor(
  action: 'created' | 'updated' | 'cancelled',
  plan: { sourceId: string; start: string; end: string; half: PlanHalfDays },
  before: { hosts: HostSpec[]; choice: Record<string, string | null> } | null,
  after: { hosts: HostSpec[]; choice: Record<string, string | null> },
  names: Map<string, string>,
): [string, string][] {
  const src = names.get(plan.sourceId) ?? '?'
  const period = periodLabel(plan.start, plan.end, plan.half)
  const count = (choice: Record<string, string | null>, h: string) => Object.values(choice).filter((x) => x === h).length
  const out: [string, string][] = []
  if (action === 'cancelled') {
    out.push([plan.sourceId, `Répartition de ${src} annulée : vos élèves reviennent dans votre appel habituel.`])
    for (const h of after.hosts) out.push([h.classId, `Répartition de ${src} annulée : vous n’accueillez plus ces élèves.`])
    return out
  }
  if (action === 'created') {
    out.push([plan.sourceId, `${src} est répartie ${period} : ${splitLabel(after.choice, after.hosts, names)}. Vos élèves sont dans l’appel de ces classes.`])
    for (const h of after.hosts)
      out.push([h.classId, `Vous accueillez ${n(count(after.choice, h.classId), 'élève')} de ${src} ${period}, dans la section « Élèves accueillis » de votre appel.`])
    return out
  }
  out.push([plan.sourceId, `Répartition de ${src} modifiée ${period} : ${splitLabel(after.choice, after.hosts, names)}.`])
  const ids = new Set([...after.hosts.map((h) => h.classId), ...(before?.hosts.map((h) => h.classId) ?? [])])
  for (const id of ids) {
    const k = count(after.choice, id)
    out.push([
      id,
      k
        ? `Répartition de ${src} modifiée : vous accueillez maintenant ${n(k, 'élève')} ${period}.`
        : `Répartition de ${src} modifiée : vous n’accueillez plus d’élèves de cette classe.`,
    ])
  }
  return out
}

// ---------- Lecture du formulaire ----------

function parsePeriod(p: { startDate?: unknown; endDate?: unknown; halfDays?: unknown }) {
  const start = p.startDate
  const end = p.endDate ?? start
  if (!isValidDate(start) || !isValidDate(end)) throw badRequest('INVALID_DATE', 'Date invalide.')
  if (end < start) throw badRequest('INVALID_DATE', 'La date de fin doit suivre la date de début.')
  if (daysBetween(start, end) >= PLAN_MAX_DAYS) throw badRequest('RANGE_TOO_LONG', `Une répartition dure ${PLAN_MAX_DAYS} jours au plus.`)
  const half = p.halfDays as PlanHalfDays
  if (!HALF_DAYS.includes(half)) throw badRequest('INVALID_HALF_DAY', 'Choisissez la journée, le matin ou l’après-midi.')
  return { start, end, half }
}

function parseHosts(v: unknown, ctx: Context, sourceId: string): HostSpec[] {
  if (!Array.isArray(v) || v.length === 0) throw badRequest('NO_HOSTS', 'Cochez au moins une classe d’accueil.')
  if (v.length > MAX_HOSTS) throw badRequest('INVALID_HOSTS', `${MAX_HOSTS} classes d’accueil au plus.`)
  const ids = new Set(ctx.classes.map((c) => c.id))
  const seen = new Set<string>()
  return v.map((h) => {
    const classId = (h as { classId?: unknown })?.classId
    const capacity = (h as { capacity?: unknown })?.capacity
    // Cloisonnement : uniquement des classes actives de cette école.
    if (typeof classId !== 'string' || !ids.has(classId)) throw badRequest('INVALID_HOSTS', 'Classe d’accueil introuvable.')
    if (classId === sourceId) throw badRequest('INVALID_HOSTS', 'La classe répartie ne peut pas être une classe d’accueil.')
    if (seen.has(classId)) throw badRequest('INVALID_HOSTS', 'Classe d’accueil en double.')
    seen.add(classId)
    if (capacity !== null && capacity !== undefined && !(Number.isInteger(capacity) && (capacity as number) >= 1 && (capacity as number) <= MAX_CAPACITY))
      throw badRequest('INVALID_CAPACITY', `Capacité invalide (1 à ${MAX_CAPACITY}).`)
    return { classId, capacity: (capacity as number | null | undefined) ?? null }
  })
}

/**
 * Vérifications communes à la création et à la modification. Renvoie les demi-journées couvertes,
 * le choix élève par élève et les lignes d'affectation voulues.
 */
function checkPlan(ctx: Context, body: Record<string, unknown>, sourceId: string, period: { start: string; end: string; half: PlanHalfDays }, planId: string | null) {
  const slots = planSlots(period.start, period.end, period.half, ctx.school.closed_weekdays, ctx.closures)
  if (!slots.length) throw badRequest('NO_SLOTS', 'Aucune demi-journée d’école sur cette période.')
  const hosts = parseHosts(body.hosts, ctx, sourceId)
  const names = new Map(ctx.classes.map((c) => [c.id, c.name]))
  const students = sourceStudents(ctx, sourceId, slots)
  if (!students.length) throw conflict('NO_STUDENTS', 'Aucun élève de cette classe n’est attendu sur cette période.')
  if (typeof body.choice !== 'object' || !body.choice) throw badRequest('INVALID_CHOICE', 'Répartition incomplète.')
  const raw = body.choice as Record<string, unknown>
  const allowed = new Set(students.map((x) => x.s.id))
  if (Object.keys(raw).some((id) => !allowed.has(id)))
    throw conflict('STUDENTS_CHANGED', 'La liste des élèves a changé. La page va se mettre à jour.')
  const hostIds = new Set(hosts.map((h) => h.classId))
  const choice: Record<string, string | null> = {}
  for (const { s } of students) {
    const v = raw[s.id]
    if (v === undefined) throw badRequest('UNASSIGNED', `${fullName(s)} n’a pas de classe d’accueil.`)
    if (v !== null && (typeof v !== 'string' || !hostIds.has(v))) throw badRequest('INVALID_CHOICE', `Classe d’accueil invalide pour ${fullName(s)}.`)
    choice[s.id] = v as string | null
  }
  // Pas de chaîne de répartitions : une classe d'accueil n'est pas elle-même répartie, la classe répartie n'accueille pas.
  const keys = new Set(slots.map((s) => `${s.date}:${s.half}`))
  const others = ctx.assignments.filter((a) => a.planId !== planId && keys.has(`${a.date}:${a.half}`))
  for (const h of hosts)
    if (others.some((a) => a.sourceClassId === h.classId))
      throw conflict('HOST_DISTRIBUTED', `${names.get(h.classId)} est elle-même répartie sur cette période : choisissez une autre classe.`)
  if (others.some((a) => a.hostClassId === sourceId))
    throw conflict('SOURCE_HOSTING', `${names.get(sourceId)} accueille déjà des élèves sur cette période.`)
  const busy = others.filter((a) => allowed.has(a.studentId))
  if (busy.length)
    throw conflict('ALREADY_DISTRIBUTED', `${n(new Set(busy.map((a) => a.studentId)).size, 'élève est', 'élèves sont')} déjà dans une autre répartition sur cette période.`)
  // Capacités : effectif total projeté après accueil (maximum sur la période).
  const load = loads(ctx, slots, planId)
  const hostClasses = hosts.map((h) => ({ id: h.classId, name: names.get(h.classId)!, expected: load.get(h.classId) ?? 0, capacity: h.capacity ?? undefined }))
  const issues = checkDistribution(
    students.filter(({ s }) => choice[s.id] !== null).map(({ s }) => ({ id: s.id })),
    hostClasses,
    Object.fromEntries(Object.entries(choice).filter(([, v]) => v !== null)) as Record<string, string>,
  )
  const over = issues.find((i) => i.type === 'OVER_CAPACITY')
  if (over) throw conflict('OVER_CAPACITY', `Capacité dépassée pour ${names.get(over.id)} : choisissez une autre classe pour certains élèves.`)
  return { slots, hosts, choice, names, desired: expandAssignments(choice, slots), students }
}

const ASSIGN_GUARD_COUNTED = `NOT EXISTS (SELECT 1 FROM attendance_entries e JOIN attendance_calls c ON c.id = e.call_id JOIN call_slots sl ON sl.id = c.slot_id
  WHERE e.student_id = json_extract(value, '$[0]') AND c.slot_date = json_extract(value, '$[2]') AND sl.half_day = json_extract(value, '$[3]'))`

/** Instructions d'écriture (insertion et fin d'affectations, notifications), gardées par la version du plan. */
function writeStatements(
  env: Env,
  o: {
    schoolId: string
    planId: string
    sourceId: string
    version: number
    requestId: string
    userId: string
    now: string
    end: string
    insert: AssignmentRow[]
    endIds: string[]
    notices: [string, string][]
    change: { action: string; details: unknown }
  },
) {
  const guard = 'EXISTS (SELECT 1 FROM distribution_plans WHERE id = ? AND version = ? AND last_request_id = ?)'
  const g = [o.planId, o.version, o.requestId]
  const stmts: D1PreparedStatement[] = []
  if (o.endIds.length)
    stmts.push(
      env.DB.prepare(
        `UPDATE distribution_assignments SET ended_at = ?, ended_by = ?
          WHERE plan_id = ? AND ended_at IS NULL AND id IN (SELECT value FROM json_each(?)) AND ${guard}
            AND NOT EXISTS (SELECT 1 FROM attendance_entries e JOIN attendance_calls c ON c.id = e.call_id JOIN call_slots sl ON sl.id = c.slot_id
              WHERE e.student_id = distribution_assignments.student_id AND c.slot_date = distribution_assignments.slot_date
                AND sl.half_day = distribution_assignments.half_day)`,
      ).bind(o.now, o.userId, o.planId, JSON.stringify(o.endIds), ...g),
    )
  if (o.insert.length)
    stmts.push(
      env.DB.prepare(
        `INSERT INTO distribution_assignments (id, plan_id, school_id, student_id, source_class_id, host_class_id, slot_date, half_day, created_by, created_at)
         SELECT lower(hex(randomblob(16))), ?, ?, json_extract(value, '$[0]'), ?, json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                json_extract(value, '$[3]'), ?, ?
           FROM json_each(?) WHERE ${guard} AND ${ASSIGN_GUARD_COUNTED}`,
      ).bind(
        o.planId,
        o.schoolId,
        o.sourceId,
        o.userId,
        o.now,
        JSON.stringify(o.insert.map((r) => [r.studentId, r.hostClassId, r.date, r.half])),
        ...g,
      ),
    )
  stmts.push(
    // UNIQUE (plan_id, version) : deux modifications simultanées ne peuvent pas créer la même version.
    env.DB.prepare(
      `INSERT INTO distribution_changes (id, plan_id, version, action, actor_user_id, at, details) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    ).bind(newId(), o.planId, o.version, o.change.action, o.userId, o.now, JSON.stringify(o.change.details), ...g),
    env.DB.prepare(
      `INSERT INTO distribution_notices (id, school_id, plan_id, class_id, body, created_at, end_date)
       SELECT lower(hex(randomblob(16))), ?, ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?, ? FROM json_each(?) WHERE ${guard}`,
    ).bind(o.schoolId, o.planId, o.now, o.end, JSON.stringify(o.notices), ...g),
  )
  return stmts
}

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message)

function readRequestId(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(v)) throw badRequest('INVALID_REQUEST', 'Requête invalide.')
  return v
}

// ---------- Routes ----------

/**
 * Données pour l'écran « Répartir une classe » : classes et effectifs habituels sur la période,
 * élèves de la classe d'origine, dernière répartition de cette classe (à réutiliser) et plan en cours de modification.
 */
export async function prepareDistribution(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const p = new URL(req.url).searchParams
  const tz = await env.DB.prepare('SELECT timezone FROM schools WHERE id = ?').bind(schoolId).first<{ timezone: string }>()
  const today = schoolToday(tz?.timezone)
  const planId = p.get('planId')
  let plan: PlanRow | null = null
  if (planId) {
    plan = await env.DB.prepare('SELECT * FROM distribution_plans WHERE id = ? AND school_id = ?').bind(planId, schoolId).first<PlanRow>()
    if (!plan) throw notFound()
  }
  const period = parsePeriod({
    startDate: p.get('from') || plan?.start_date || today,
    endDate: p.get('to') || plan?.end_date || p.get('from') || today,
    halfDays: p.get('halfDays') || plan?.half_days || 'day',
  })
  const ctx = await loadContext(env, schoolId, period.start, period.end)
  const slots = planSlots(period.start, period.end, period.half, ctx.school.closed_weekdays, ctx.closures)
  const load = loads(ctx, slots, plan?.id ?? null)
  const sourceId = p.get('classId') || plan?.source_class_id || null
  if (sourceId && !ctx.classes.some((c) => c.id === sourceId)) throw notFound()
  const keys = new Set(slots.map((s) => `${s.date}:${s.half}`))
  const others = ctx.assignments.filter((a) => a.planId !== plan?.id && keys.has(`${a.date}:${a.half}`))

  let last: unknown = null
  if (sourceId) {
    const l = await env.DB.prepare(
      `SELECT id, start_date, end_date, half_days, hosts FROM distribution_plans WHERE school_id = ? AND source_class_id = ? AND id != ?
        ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(schoolId, sourceId, plan?.id ?? '')
      .first<{ id: string; start_date: string; end_date: string; half_days: PlanHalfDays; hosts: string }>()
    if (l) last = { id: l.id, startDate: l.start_date, endDate: l.end_date, halfDays: l.half_days, hosts: JSON.parse(l.hosts), choice: await currentChoice(env, l.id) }
  }
  return json({
    today,
    closedWeekdays: ctx.school.closed_weekdays,
    period: { startDate: period.start, endDate: period.end, halfDays: period.half },
    slotCount: slots.length,
    classes: ctx.classes.map((c) => ({
      id: c.id,
      name: c.name,
      levels: c.levels,
      expected: load.get(c.id) ?? 0,
      // Indisponible comme classe d'accueil : déjà répartie sur la période.
      distributed: others.some((a) => a.sourceClassId === c.id),
      hosting: others.some((a) => a.hostClassId === c.id),
    })),
    students: sourceId
      ? sourceStudents(ctx, sourceId, slots).map(({ s, n: k }) => ({
          id: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          partial: k < slots.length,
          busy: others.some((a) => a.studentId === s.id),
        }))
      : [],
    last,
    plan: plan
      ? {
          id: plan.id,
          version: plan.version,
          state: plan.state,
          sourceClassId: plan.source_class_id,
          startDate: plan.start_date,
          endDate: plan.end_date,
          halfDays: plan.half_days,
          hosts: JSON.parse(plan.hosts),
          choice: await currentChoice(env, plan.id),
        }
      : null,
  })
}

/** Créer une répartition (idempotent : un renvoi avec la même clé ne crée rien de plus). */
export async function createDistribution(env: Env, req: Request, schoolId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson<Record<string, unknown>>(req)
  const requestId = readRequestId(body.requestId)
  const replay = async () => {
    const r = await env.DB.prepare('SELECT id, version FROM distribution_plans WHERE create_request_id = ? AND school_id = ?')
      .bind(requestId, schoolId)
      .first<{ id: string; version: number }>()
    return r ? json({ id: r.id, version: r.version, replay: true }) : null
  }
  const already = await replay()
  if (already) return already
  const sourceId = typeof body.sourceClassId === 'string' ? body.sourceClassId : ''
  const period = parsePeriod(body)
  const ctx = await loadContext(env, schoolId, period.start, period.end)
  const today = schoolToday(ctx.school.timezone)
  if (period.start < today) throw badRequest('PAST_DATE', 'Une répartition commence aujourd’hui ou plus tard.')
  if (!ctx.classes.some((c) => c.id === sourceId)) throw badRequest('INVALID_SOURCE', 'Choisissez la classe à répartir.')
  const plan = checkPlan(ctx, body, sourceId, period, null)
  const counted = await countedKeys(env, schoolId, Object.keys(plan.choice), period.start, period.end)
  const { insert, frozenChanges } = diffAssignments([], plan.desired, (r) => counted.has(assignmentKey(r)))
  if (!insert.length) throw conflict('ALREADY_COUNTED', 'Les appels de ces demi-journées sont déjà validés : il n’y a plus rien à répartir.')

  const id = newId()
  const now = nowIso()
  const stmts = [
    env.DB.prepare(
      `INSERT INTO distribution_plans (id, school_id, source_class_id, start_date, end_date, half_days, hosts, state, version,
          create_request_id, last_request_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, schoolId, sourceId, period.start, period.end, period.half, JSON.stringify(plan.hosts), requestId, requestId, u.id, now, u.id, now),
    ...writeStatements(env, {
      schoolId,
      planId: id,
      sourceId,
      version: 1,
      requestId,
      userId: u.id,
      now,
      end: period.end,
      insert,
      endIds: [],
      notices: noticesFor('created', { sourceId, start: period.start, end: period.end, half: period.half }, null, plan, plan.names),
      change: { action: 'created', details: { after: plan.choice, hosts: plan.hosts, frozen: frozenChanges } },
    }),
    await audit(env, { actor: u.id, schoolId, action: 'distribution.created', objectType: 'distribution', objectId: id, details: { sourceId, ...period } }),
  ]
  try {
    await env.DB.batch(stmts)
  } catch (e) {
    if (!isUnique(e)) throw e
    const again = await replay()
    if (again) return again
    throw conflict('ALREADY_DISTRIBUTED', 'Un élève vient d’être placé dans une autre répartition. La page va se mettre à jour.')
  }
  return json({ id, version: 1, frozen: frozenChanges }, { status: 201 })
}

async function loadPlan(env: Env, schoolId: string, planId: string) {
  const plan = await env.DB.prepare('SELECT * FROM distribution_plans WHERE id = ? AND school_id = ?').bind(planId, schoolId).first<PlanRow>()
  if (!plan) throw notFound()
  return plan
}

async function activeRows(env: Env, planId: string): Promise<(AssignmentRow & { id: string })[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, student_id, host_class_id, slot_date, half_day FROM distribution_assignments WHERE plan_id = ? AND ended_at IS NULL',
  )
    .bind(planId)
    .all<{ id: string; student_id: string; host_class_id: string | null; slot_date: string; half_day: HalfDay }>()
  return results.map((r) => ({ id: r.id, studentId: r.student_id, hostClassId: r.host_class_id, date: r.slot_date, half: r.half_day }))
}

async function commitVersion(env: Env, planId: string, requestId: string, stmts: D1PreparedStatement[]) {
  try {
    await env.DB.batch(stmts)
  } catch (e) {
    if (!isUnique(e)) throw e
  }
  const after = await env.DB.prepare('SELECT version, last_request_id FROM distribution_plans WHERE id = ?')
    .bind(planId)
    .first<{ version: number; last_request_id: string }>()
  if (after?.last_request_id !== requestId)
    throw new HttpError(409, 'STALE_PLAN', 'Cette répartition vient d’être modifiée (autre appareil, ou élève déjà placé ailleurs). La page va se mettre à jour.')
  return after.version
}

/**
 * Modifier une répartition : période, classes d'accueil, élève par élève. Les affectations déjà
 * comptées dans un appel validé (ou passées) sont conservées ; le reste est propagé, historisé et notifié.
 */
export async function updateDistribution(env: Env, req: Request, schoolId: string, planId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson<Record<string, unknown>>(req)
  const requestId = readRequestId(body.requestId)
  const old = await loadPlan(env, schoolId, planId)
  if (old.last_request_id === requestId) return json({ ok: true, version: old.version, replay: true })
  if (old.state !== 'active') throw conflict('CANCELLED', 'Cette répartition est annulée.')
  if (body.baseVersion !== old.version) throw conflict('STALE_PLAN', 'Cette répartition vient d’être modifiée par quelqu’un d’autre. La page va se mettre à jour.')
  const period = parsePeriod(body)
  const from = period.start < old.start_date ? period.start : old.start_date
  const to = period.end > old.end_date ? period.end : old.end_date
  const ctx = await loadContext(env, schoolId, from, to)
  const today = schoolToday(ctx.school.timezone)
  if (period.end < today) throw badRequest('PAST_DATE', 'La fin de la répartition doit être aujourd’hui ou plus tard.')
  if (old.start_date < today ? period.start !== old.start_date : period.start < today)
    throw badRequest('PAST_DATE', 'La répartition a déjà commencé : sa date de début ne peut plus changer.')
  const plan = checkPlan(ctx, body, old.source_class_id, period, planId)
  const current = await activeRows(env, planId)
  const counted = await countedKeys(env, schoolId, [...new Set([...Object.keys(plan.choice), ...current.map((r) => r.studentId)])], from, to)
  const frozen = (r: AssignmentRow) => r.date < today || counted.has(assignmentKey(r))
  const { end, insert, frozenChanges } = diffAssignments(current, plan.desired, frozen)
  const before = { hosts: JSON.parse(old.hosts) as HostSpec[], choice: await currentChoice(env, planId) }
  const moved = changedStudents(before.choice, plan.choice)
  const same =
    !end.length && !insert.length && !moved.length && old.start_date === period.start && old.end_date === period.end && old.half_days === period.half && old.hosts === JSON.stringify(plan.hosts)
  if (same) return json({ ok: true, version: old.version, unchanged: true })

  const version = old.version + 1
  const now = nowIso()
  const stmts = [
    env.DB.prepare(
      `UPDATE distribution_plans SET start_date = ?, end_date = ?, half_days = ?, hosts = ?, version = ?, last_request_id = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND version = ? AND state = 'active'`,
    ).bind(period.start, period.end, period.half, JSON.stringify(plan.hosts), version, requestId, u.id, now, planId, old.version),
    ...writeStatements(env, {
      schoolId,
      planId,
      sourceId: old.source_class_id,
      version,
      requestId,
      userId: u.id,
      now,
      end: period.end > old.end_date ? period.end : old.end_date,
      insert,
      endIds: end.map((r) => r.id),
      notices: noticesFor('updated', { sourceId: old.source_class_id, start: period.start, end: period.end, half: period.half }, before, plan, plan.names),
      change: {
        action: 'updated',
        details: {
          after: plan.choice,
          hosts: plan.hosts,
          moved,
          period: { start: period.start, end: period.end, half: period.half },
          previous: { start: old.start_date, end: old.end_date, half: old.half_days },
          frozen: frozenChanges,
        },
      },
    }),
    await audit(env, { actor: u.id, schoolId, action: 'distribution.updated', objectType: 'distribution', objectId: planId, details: { version, moved: moved.length } }),
  ]
  const v = await commitVersion(env, planId, requestId, stmts)
  return json({ ok: true, version: v, moved: moved.length, frozen: frozenChanges })
}

/** Annuler une répartition : les élèves reviennent dans leur classe pour les demi-journées non encore comptées. */
export async function cancelDistribution(env: Env, req: Request, schoolId: string, planId: string) {
  const u = await direction(env, req, schoolId)
  const body = await readJson<Record<string, unknown>>(req)
  const requestId = readRequestId(body.requestId)
  const old = await loadPlan(env, schoolId, planId)
  if (old.last_request_id === requestId) return json({ ok: true, version: old.version, replay: true })
  if (old.state !== 'active') throw conflict('CANCELLED', 'Cette répartition est déjà annulée.')
  if (body.baseVersion !== old.version) throw conflict('STALE_PLAN', 'Cette répartition vient d’être modifiée par quelqu’un d’autre. La page va se mettre à jour.')
  const tz = await env.DB.prepare('SELECT timezone FROM schools WHERE id = ?').bind(schoolId).first<{ timezone: string }>()
  const today = schoolToday(tz?.timezone)
  const current = await activeRows(env, planId)
  const counted = await countedKeys(env, schoolId, [...new Set(current.map((r) => r.studentId))], old.start_date, old.end_date)
  const { end, frozenChanges } = diffAssignments(current, [], (r) => r.date < today || counted.has(assignmentKey(r)))
  const choice = await currentChoice(env, planId)
  const names = new Map(
    (await env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ?').bind(schoolId).all<{ id: string; name: string }>()).results.map((c) => [c.id, c.name]),
  )
  const hosts = JSON.parse(old.hosts) as HostSpec[]
  const version = old.version + 1
  const now = nowIso()
  const stmts = [
    env.DB.prepare(
      `UPDATE distribution_plans SET state = 'cancelled', version = ?, last_request_id = ?, updated_by = ?, updated_at = ?, cancelled_by = ?, cancelled_at = ?
        WHERE id = ? AND version = ? AND state = 'active'`,
    ).bind(version, requestId, u.id, now, u.id, now, planId, old.version),
    ...writeStatements(env, {
      schoolId,
      planId,
      sourceId: old.source_class_id,
      version,
      requestId,
      userId: u.id,
      now,
      end: old.end_date,
      insert: [],
      endIds: end.map((r) => r.id),
      notices: noticesFor('cancelled', { sourceId: old.source_class_id, start: old.start_date, end: old.end_date, half: old.half_days }, null, { hosts, choice }, names),
      change: { action: 'cancelled', details: { after: choice, hosts, frozen: frozenChanges } },
    }),
    await audit(env, { actor: u.id, schoolId, action: 'distribution.cancelled', objectType: 'distribution', objectId: planId }),
  ]
  const v = await commitVersion(env, planId, requestId, stmts)
  return json({ ok: true, version: v, frozen: frozenChanges })
}

/** Liste des répartitions récentes, en cours et à venir. */
export async function listDistributions(env: Env, req: Request, schoolId: string) {
  await direction(env, req, schoolId)
  const tz = await env.DB.prepare('SELECT timezone FROM schools WHERE id = ?').bind(schoolId).first<{ timezone: string }>()
  const today = schoolToday(tz?.timezone)
  const [plansR, classesR, countsR] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.source_class_id, p.start_date, p.end_date, p.half_days, p.hosts, p.state, p.version, p.updated_at, u.display_name AS author
         FROM distribution_plans p JOIN users u ON u.id = p.created_by
        WHERE p.school_id = ? AND p.end_date >= ? ORDER BY p.start_date DESC, p.created_at DESC LIMIT 100`,
    ).bind(schoolId, addDays(today, -60)),
    env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ?').bind(schoolId),
    env.DB.prepare(
      `SELECT plan_id, COUNT(DISTINCT student_id) AS n FROM distribution_assignments
        WHERE school_id = ? AND ended_at IS NULL AND slot_date >= ? GROUP BY plan_id`,
    ).bind(schoolId, addDays(today, -60)),
  ])
  const names = new Map((classesR.results as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const counts = new Map((countsR.results as { plan_id: string; n: number }[]).map((c) => [c.plan_id, c.n]))
  return json({
    today,
    plans: (plansR.results as (PlanRow & { author: string })[]).map((p) => ({
      id: p.id,
      sourceClassId: p.source_class_id,
      sourceName: names.get(p.source_class_id) ?? '?',
      startDate: p.start_date,
      endDate: p.end_date,
      halfDays: p.half_days,
      hosts: (JSON.parse(p.hosts) as HostSpec[]).map((h) => names.get(h.classId) ?? '?'),
      state: p.state,
      when: p.state === 'cancelled' ? 'cancelled' : p.end_date < today ? 'past' : p.start_date > today ? 'upcoming' : 'current',
      students: counts.get(p.id) ?? 0,
      author: p.author,
      updatedAt: p.updated_at,
    })),
  })
}

/**
 * Détail d'une répartition : élèves par classe d'accueil, couverture de chaque demi-journée
 * (présences remontées des appels des classes d'accueil) et historique des versions.
 */
export async function getDistribution(env: Env, req: Request, schoolId: string, planId: string) {
  await direction(env, req, schoolId)
  const plan = await loadPlan(env, schoolId, planId)
  const tz = await env.DB.prepare('SELECT timezone FROM schools WHERE id = ?').bind(schoolId).first<{ timezone: string }>()
  const today = schoolToday(tz?.timezone)
  const [classesR, rowsR, changesR, studentsR, schedulesR] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM classes WHERE school_id = ?').bind(schoolId),
    // Affectations actives + état saisi dans l'appel de la classe d'accueil (s'il est validé).
    env.DB.prepare(
      `SELECT a.student_id, a.host_class_id, a.slot_date, a.half_day,
              (SELECT st.category || '|' || st.label FROM attendance_entries e JOIN attendance_calls c ON c.id = e.call_id
                 JOIN call_slots sl ON sl.id = c.slot_id JOIN attendance_statuses st ON st.id = e.status_id
                WHERE e.student_id = a.student_id AND c.class_id = a.host_class_id AND c.slot_date = a.slot_date AND sl.half_day = a.half_day
                ORDER BY c.updated_at DESC LIMIT 1) AS status
         FROM distribution_assignments a WHERE a.plan_id = ? AND a.ended_at IS NULL ORDER BY a.slot_date, a.half_day`,
    ).bind(planId),
    env.DB.prepare(
      `SELECT ch.version, ch.action, ch.at, ch.details, u.display_name AS actor FROM distribution_changes ch JOIN users u ON u.id = ch.actor_user_id
        WHERE ch.plan_id = ? ORDER BY ch.version DESC`,
    ).bind(planId),
    env.DB.prepare(
      `SELECT DISTINCT s.id, s.class_id, s.first_name, s.last_name, s.active_from, s.active_to FROM students s
        WHERE s.id IN (SELECT student_id FROM distribution_assignments WHERE plan_id = ?)`,
    ).bind(planId),
    env.DB.prepare(
      `SELECT ss.student_id, ss.valid_from, ss.pattern FROM student_schedules ss
        WHERE ss.student_id IN (SELECT student_id FROM distribution_assignments WHERE plan_id = ?)`,
    ).bind(planId),
  ])
  const names = new Map((classesR.results as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const students = new Map((studentsR.results as StudentRow[]).map((s) => [s.id, s]))
  const schedules = schedulesR.results as { student_id: string; valid_from: string; pattern: number | null }[]
  const rows = rowsR.results as { student_id: string; host_class_id: string | null; slot_date: string; half_day: HalfDay; status: string | null }[]
  const hosts = JSON.parse(plan.hosts) as HostSpec[]
  const choice = await currentChoice(env, planId)

  // Couverture par demi-journée : seuls les élèves attendus ce jour-là comptent.
  const bySlot = new Map<string, typeof rows>()
  for (const r of rows) {
    const s = students.get(r.student_id)
    if (!s || !isExpected({ ...s, schedules: schedules.filter((x) => x.student_id === s.id) }, r.slot_date, r.half_day)) continue
    const k = `${r.slot_date}:${r.half_day}`
    bySlot.set(k, [...(bySlot.get(k) ?? []), r])
  }
  const coverage = [...bySlot.entries()].map(([k, list]) => {
    const [date, half] = k.split(':')
    const cov = coverageOf(list.map((r) => ({ hostClassId: r.host_class_id, category: r.status?.split('|')[0] ?? null })))
    const hostIds = [...new Set(list.map((r) => r.host_class_id).filter((x): x is string => !!x))]
    return {
      date,
      half,
      ...cov,
      hosts: hostIds.map((h) => {
        const c = coverageOf(list.filter((r) => r.host_class_id === h).map((r) => ({ hostClassId: h, category: r.status?.split('|')[0] ?? null })))
        return { classId: h, className: names.get(h) ?? '?', total: c.total, confirmed: c.confirmed }
      }),
    }
  })
  // Registre du jour (ou de la première demi-journée à venir) : où est chaque élève et son état.
  const focus = coverage.find((c) => c.date >= today) ?? coverage[coverage.length - 1]
  const focusRows = focus ? (bySlot.get(`${focus.date}:${focus.half}`) ?? []) : []
  const studentName = (id: string) => {
    const s = students.get(id)
    return s ? fullName(s) : 'Élève'
  }
  return json({
    today,
    plan: {
      id: plan.id,
      version: plan.version,
      state: plan.state,
      sourceClassId: plan.source_class_id,
      sourceName: names.get(plan.source_class_id) ?? '?',
      startDate: plan.start_date,
      endDate: plan.end_date,
      halfDays: plan.half_days,
      when: plan.state === 'cancelled' ? 'cancelled' : plan.end_date < today ? 'past' : plan.start_date > today ? 'upcoming' : 'current',
      hosts: hosts.map((h) => ({ ...h, className: names.get(h.classId) ?? '?' })),
    },
    // Composition actuelle par classe d'accueil (feuille de répartition imprimable).
    groups: [
      ...hosts.map((h) => ({ classId: h.classId as string | null, className: names.get(h.classId) ?? '?' })),
      { classId: null, className: 'Absents connus (non répartis)' },
    ]
      .map((g) => ({
        ...g,
        students: Object.entries(choice)
          .filter(([, v]) => v === g.classId)
          .map(([id]) => ({ id, name: studentName(id) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
      }))
      .filter((g) => g.classId !== null || g.students.length > 0),
    coverage,
    focus: focus
      ? {
          date: focus.date,
          half: focus.half,
          students: focusRows
            .map((r) => ({
              id: r.student_id,
              name: studentName(r.student_id),
              hostName: r.host_class_id ? (names.get(r.host_class_id) ?? '?') : null,
              status: r.status ? r.status.split('|').slice(1).join('|') : null,
              category: r.status?.split('|')[0] ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
        }
      : null,
    changes: (changesR.results as { version: number; action: string; at: string; details: string | null; actor: string }[]).map((c) => {
      const d = c.details ? JSON.parse(c.details) : {}
      return {
        version: c.version,
        action: c.action,
        at: c.at,
        by: c.actor,
        frozen: d.frozen ?? 0,
        period: d.period ?? null,
        previous: d.previous ?? null,
        moved: ((d.moved ?? []) as { studentId: string; from: string | null; to: string | null }[]).map((m) => ({
          name: studentName(m.studentId),
          from: m.from === undefined ? null : m.from === null ? 'Absent connu' : (names.get(m.from) ?? '?'),
          to: m.to === undefined ? null : m.to === null ? 'Absent connu' : (names.get(m.to) ?? '?'),
        })),
      }
    }),
  })
}

// ---------- Utilitaires partagés avec l'appel, le tableau de bord et l'accueil enseignant ----------

/** Dernière notification de répartition par plan et par classe, encore d'actualité. */
export function noticesQuery(env: Env, classIds: string[], today: string) {
  return env.DB.prepare(
    `SELECT plan_id, class_id, body, created_at FROM distribution_notices
      WHERE class_id IN (SELECT value FROM json_each(?)) AND end_date >= ? ORDER BY created_at DESC`,
  ).bind(JSON.stringify(classIds), today)
}

export function latestNotices(rows: { plan_id: string; class_id: string; body: string; created_at: string }[]) {
  const seen = new Set<string>()
  const out: { id: string; classId: string; body: string; at: string }[] = []
  for (const r of rows) {
    const k = `${r.plan_id}:${r.class_id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ id: k, classId: r.class_id, body: r.body, at: r.created_at })
  }
  return out
}
