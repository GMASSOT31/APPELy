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
