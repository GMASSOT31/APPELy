import { closureFor, type Closure, type HalfDay } from './schedule'

/**
 * Répartitions temporaires (cahier des charges §7.4).
 * Chaque élève est attribué à la classe d'accueil admissible dont l'effectif total
 * projeté est le plus faible, en respectant les capacités. Ordre stable :
 * relancer l'équilibrage donne toujours la même proposition.
 */

export interface HostClass {
  id: string
  name: string
  /** Effectif attendu habituel sur le créneau. */
  expected: number
  /** Capacité maximale optionnelle (effectif total après accueil). */
  capacity?: number
}

export interface StudentToDistribute {
  id: string
  /** Classes interdites pour cet élève (exclusions manuelles). */
  excludedHostIds?: string[]
}

export interface DistributionResult {
  /** studentId → hostClassId */
  assignments: Record<string, string>
  /** hostClassId → effectif total projeté après accueil */
  projected: Record<string, number>
}

export class DistributionError extends Error {
  readonly code: 'NO_HOSTS' | 'INSUFFICIENT_CAPACITY'
  readonly studentId?: string
  constructor(code: 'NO_HOSTS' | 'INSUFFICIENT_CAPACITY', studentId?: string) {
    super(code === 'NO_HOSTS' ? 'Aucune classe d’accueil sélectionnée' : `Capacité insuffisante pour l’élève ${studentId}`)
    this.code = code
    this.studentId = studentId
  }
}

export function proposeDistribution(students: StudentToDistribute[], hosts: HostClass[]): DistributionResult {
  if (hosts.length === 0) throw new DistributionError('NO_HOSTS')
  const projected: Record<string, number> = {}
  for (const h of hosts) projected[h.id] = h.expected
  const assignments: Record<string, string> = {}

  for (const s of students) {
    let best: HostClass | undefined
    for (const h of hosts) {
      if (s.excludedHostIds?.includes(h.id)) continue
      if (h.capacity !== undefined && projected[h.id] >= h.capacity) continue
      // Inégalité stricte : en cas d'égalité, la première classe de la liste l'emporte (ordre stable).
      if (!best || projected[h.id] < projected[best.id]) best = h
    }
    if (!best) throw new DistributionError('INSUFFICIENT_CAPACITY', s.id)
    assignments[s.id] = best.id
    projected[best.id] += 1
  }
  return { assignments, projected }
}

export interface DistributionIssue {
  type: 'UNASSIGNED' | 'UNKNOWN_HOST' | 'OVER_CAPACITY'
  id: string
}

/**
 * Vérifie une répartition (y compris après correction manuelle) avant validation :
 * aucun élève sans affectation, aucune classe inconnue, capacités respectées.
 * L'unicité « un élève = une affectation » est garantie par la structure (une clé par élève).
 */
export function checkDistribution(
  students: StudentToDistribute[],
  hosts: HostClass[],
  assignments: Record<string, string>,
): DistributionIssue[] {
  const issues: DistributionIssue[] = []
  const hostIds = new Set(hosts.map((h) => h.id))
  const totals: Record<string, number> = Object.fromEntries(hosts.map((h) => [h.id, h.expected]))
  for (const s of students) {
    const h = assignments[s.id]
    if (!h) issues.push({ type: 'UNASSIGNED', id: s.id })
    else if (!hostIds.has(h)) issues.push({ type: 'UNKNOWN_HOST', id: s.id })
    else totals[h] += 1
  }
  for (const h of hosts) {
    if (h.capacity !== undefined && totals[h.id] > h.capacity) issues.push({ type: 'OVER_CAPACITY', id: h.id })
  }
  return issues
}

// ---------- Lot 5 : période, affectations par demi-journée, modifications ----------


export type PlanHalfDays = 'day' | 'am' | 'pm'
export const PLAN_HALF_LABELS: Record<PlanHalfDays, string> = { day: 'Journée entière', am: 'Matin', pm: 'Après-midi' }
/** Durée maximale d'une répartition (jours calendaires, bornes incluses). */
export const PLAN_MAX_DAYS = 14

export interface PlanSlot {
  date: string
  half: HalfDay
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10)

/** Demi-journées d'école couvertes par une répartition (jours sans classe et fermetures exclus). */
export function planSlots(start: string, end: string, halfDays: PlanHalfDays, closedWeekdays: number, closures: Closure[]): PlanSlot[] {
  const out: PlanSlot[] = []
  const halves: HalfDay[] = halfDays === 'day' ? ['am', 'pm'] : [halfDays]
  for (let d = start, i = 0; d <= end && i < 400; d = nextDay(d), i++) {
    if (closureFor(d, closedWeekdays, closures)) continue
    for (const h of halves) out.push({ date: d, half: h })
  }
  return out
}

export interface AssignmentRow {
  studentId: string
  /** null = absent connu, non réparti. */
  hostClassId: string | null
  date: string
  half: HalfDay
}

export const assignmentKey = (r: { studentId: string; date: string; half: HalfDay }) => `${r.studentId}:${r.date}:${r.half}`

/** Lignes voulues : chaque élève garde la même affectation sur toutes les demi-journées de la période. */
export function expandAssignments(choice: Record<string, string | null>, slots: PlanSlot[]): AssignmentRow[] {
  const rows: AssignmentRow[] = []
  for (const [studentId, hostClassId] of Object.entries(choice))
    for (const s of slots) rows.push({ studentId, hostClassId, date: s.date, half: s.half })
  return rows
}

/**
 * Différence entre les affectations actives et les affectations voulues.
 * Une affectation « figée » (demi-journée passée, ou élève déjà compté dans un appel validé)
 * n'est jamais modifiée : on n'écrase pas silencieusement un appel déjà confirmé (§7.3).
 */
export function diffAssignments<T extends AssignmentRow & { id: string }>(
  current: T[],
  desired: AssignmentRow[],
  isFrozen: (r: AssignmentRow) => boolean,
): { end: T[]; insert: AssignmentRow[]; frozenChanges: number } {
  const want = new Map(desired.map((r) => [assignmentKey(r), r]))
  const kept = new Set<string>()
  const end: T[] = []
  let frozenChanges = 0
  for (const r of current) {
    const k = assignmentKey(r)
    const d = want.get(k)
    if (isFrozen(r)) {
      kept.add(k)
      if (!d || d.hostClassId !== r.hostClassId) frozenChanges++
    } else if (d && d.hostClassId === r.hostClassId) kept.add(k)
    else end.push(r)
  }
  const insert: AssignmentRow[] = []
  for (const [k, d] of want) {
    if (kept.has(k)) continue
    if (isFrozen(d)) {
      frozenChanges++
      continue
    }
    insert.push(d)
  }
  return { end, insert, frozenChanges }
}

/** Élèves dont l'affectation change entre deux versions (pour l'historique et les notifications). */
export function changedStudents(before: Record<string, string | null>, after: Record<string, string | null>) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  const moved: { studentId: string; from: string | null | undefined; to: string | null | undefined }[] = []
  for (const id of ids) if (before[id] !== after[id]) moved.push({ studentId: id, from: before[id], to: after[id] })
  return moved
}

/**
 * Équilibrage en conservant les choix manuels (« épinglés ») : les élèves épinglés comptent déjà dans
 * l'effectif projeté de leur classe, les autres sont répartis par l'algorithme. Les absents connus ne
 * sont pas répartis.
 */
export function rebalance(
  students: StudentToDistribute[],
  hosts: HostClass[],
  pinned: Record<string, string | null>,
): DistributionResult {
  const extra: Record<string, number> = {}
  for (const h of Object.values(pinned)) if (h) extra[h] = (extra[h] ?? 0) + 1
  const adjusted = hosts.map((h) => ({ ...h, expected: h.expected + (extra[h.id] ?? 0) }))
  const free = students.filter((s) => !(s.id in pinned))
  const r = proposeDistribution(free, adjusted)
  const assignments: Record<string, string> = { ...r.assignments }
  for (const [id, h] of Object.entries(pinned)) if (h) assignments[id] = h
  return { assignments, projected: r.projected }
}

export interface CoverageInput {
  /** Élèves de la répartition attendus sur la demi-journée. */
  hostClassId: string | null
  /** Catégorie de l'état saisi dans l'appel de la classe d'accueil, si cet appel est validé. */
  category: string | null
}

/**
 * Couverture d'une classe répartie (§7.3) : un élève est confirmé quand sa présence (ou son absence)
 * est enregistrée dans l'appel validé de sa classe d'accueil, ou s'il était connu absent.
 */
export function coverageOf(rows: CoverageInput[]) {
  let confirmed = 0
  let present = 0
  let absent = 0
  for (const r of rows) {
    if (r.hostClassId === null) {
      confirmed++
      absent++
    } else if (r.category) {
      confirmed++
      if (r.category === 'PRESENT') present++
      else absent++
    }
  }
  return { total: rows.length, confirmed, present, absent, complete: rows.length > 0 && confirmed === rows.length }
}

const fmtDay = (d: string, withMonth = true) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', ...(withMonth ? { month: 'long' } : {}) }).format(
    new Date(`${d}T12:00:00Z`),
  )
const HALF_TEXT: Record<PlanHalfDays, string> = { day: 'journée', am: 'matin', pm: 'après-midi' }

/** « le lundi 23 novembre (journée) » ou « du lundi 23 au mardi 24 novembre (matin) ». */
export function periodLabel(start: string, end: string, half: PlanHalfDays) {
  if (start === end) return `le ${fmtDay(start)} (${HALF_TEXT[half]})`
  return `du ${fmtDay(start, start.slice(0, 7) !== end.slice(0, 7))} au ${fmtDay(end)} (${HALF_TEXT[half]})`
}
