/**
 * Règles métier de l'appel (cahier des charges §5.3 et §6).
 * Fonctions pures : aucune dépendance au réseau ni au stockage.
 */

export type StatusCategory = 'PRESENT' | 'ABSENT' | 'AUTRE'

export interface AttendanceStatus {
  id: string
  label: string
  category: StatusCategory
  /** Couleur d'affichage (token du design system). */
  tone: 'success' | 'danger' | 'neutral'
  order: number
  active: boolean
}

export const DEFAULT_STATUSES: AttendanceStatus[] = [
  { id: 'present', label: 'Présent', category: 'PRESENT', tone: 'success', order: 0, active: true },
  { id: 'absent', label: 'Absent', category: 'ABSENT', tone: 'danger', order: 1, active: true },
]

/** États actifs, triés : leur ordre commande le cycle de tapotements. */
export function cycleOf(statuses: AttendanceStatus[]): AttendanceStatus[] {
  return statuses.filter((s) => s.active).sort((a, b) => a.order - b.order)
}

/** État suivant après un tap (Présent → Absent → Présent… ou 3e état si configuré). */
export function nextStatusId(statuses: AttendanceStatus[], currentId: string): string {
  const cycle = cycleOf(statuses)
  if (cycle.length === 0) throw new Error('Aucun état d’appel actif')
  const i = cycle.findIndex((s) => s.id === currentId)
  return cycle[(i + 1) % cycle.length].id
}

/** Au-delà de 2 états, une sélection directe est obligatoire (§6 étape 04). */
export function requiresDirectPicker(statuses: AttendanceStatus[]): boolean {
  return cycleOf(statuses).length > 2
}

export interface CallEntry {
  studentId: string
  statusId: string
  /** true tant que l'enseignant n'a pas touché la ligne : l'état est prérempli, pas attesté. */
  prefilled: boolean
}

/** Prépositionne tous les élèves attendus sur le premier état de catégorie PRÉSENT. */
export function initialEntries(studentIds: string[], statuses: AttendanceStatus[]): CallEntry[] {
  const present = cycleOf(statuses).find((s) => s.category === 'PRESENT')
  if (!present) throw new Error('Il faut au moins un état de catégorie PRÉSENT')
  return studentIds.map((studentId) => ({ studentId, statusId: present.id, prefilled: true }))
}

export function applyTap(entries: CallEntry[], studentId: string, statuses: AttendanceStatus[]): CallEntry[] {
  return entries.map((e) =>
    e.studentId === studentId ? { ...e, statusId: nextStatusId(statuses, e.statusId), prefilled: false } : e,
  )
}

export function setStatus(entries: CallEntry[], studentId: string, statusId: string): CallEntry[] {
  return entries.map((e) => (e.studentId === studentId ? { ...e, statusId, prefilled: false } : e))
}

export interface CallTotals {
  expected: number
  recorded: number
  byStatus: Record<string, number>
  byCategory: Record<StatusCategory, number>
}

/** Compteurs : total attendu et total enregistré doivent rester cohérents (§6 étape 05, §16). */
export function computeTotals(entries: CallEntry[], statuses: AttendanceStatus[]): CallTotals {
  const byId = new Map(statuses.map((s) => [s.id, s]))
  const byStatus: Record<string, number> = {}
  const byCategory: Record<StatusCategory, number> = { PRESENT: 0, ABSENT: 0, AUTRE: 0 }
  for (const e of entries) {
    const s = byId.get(e.statusId)
    if (!s) throw new Error(`État inconnu : ${e.statusId}`)
    byStatus[s.id] = (byStatus[s.id] ?? 0) + 1
    byCategory[s.category] += 1
  }
  const recorded = byCategory.PRESENT + byCategory.ABSENT + byCategory.AUTRE
  return { expected: entries.length, recorded, byStatus, byCategory }
}

export type ValidationCheck = { ok: true } | { ok: false; reason: 'NO_STUDENTS' | 'INCONSISTENT_TOTALS' }

/** Une classe avec 0 élève attendu ne doit pas produire de validation trompeuse (§6). */
export function canValidate(entries: CallEntry[], statuses: AttendanceStatus[]): ValidationCheck {
  if (entries.length === 0) return { ok: false, reason: 'NO_STUDENTS' }
  const t = computeTotals(entries, statuses)
  if (t.recorded !== t.expected) return { ok: false, reason: 'INCONSISTENT_TOTALS' }
  return { ok: true }
}

/**
 * Lot 7 : appel à ouvrir directement à l'arrivée de l'enseignant. S'il n'y a qu'un appel à faire, c'est lui ;
 * s'il y en a plusieurs (matin et après-midi), celui de la demi-journée en cours s'il est seul. Sinon, la liste.
 */
export function callToOpen<T extends { halfDay: 'am' | 'pm' }>(pending: T[], currentHalf: 'am' | 'pm'): T | null {
  if (pending.length === 1) return pending[0]
  const now = pending.filter((p) => p.halfDay === currentHalf)
  return now.length === 1 ? now[0] : null
}

/** Demi-journée en cours à Paris : matin avant midi. */
export function parisHalfDay(now = new Date()): 'am' | 'pm' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(now))
  return h < 12 ? 'am' : 'pm'
}
