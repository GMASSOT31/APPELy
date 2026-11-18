/**
 * Jeu de données de démonstration (lot 7) : une école fictive complète, rejouable.
 * Fonctions pures (aucun accès à la base) pour pouvoir les tester : la route `worker/routes/demo.ts`
 * insère ce plan en un seul lot transactionnel, par `json_each` (quota D1 gratuit).
 *
 * Tous les noms sont inventés (prénoms courants associés à des noms de plantes) : aucune donnée réelle.
 */
import { isoWeekday } from '../../src/domain/schedule'

export const DEMO_SCHOOL_NAME = 'École de démonstration des Tilleuls'
/** École de démonstration ouverte du lundi au samedi (dimanche seul fermé) pour pouvoir tester n'importe quel jour. */
export const DEMO_CLOSED_WEEKDAYS = 64
/** Appels du lundi au samedi (masque des créneaux, lundi = bit 0). */
export const DEMO_SLOT_WEEKDAYS = 63
/** Nombre de journées passées déjà appelées (historique de démonstration). */
export const DEMO_PAST_DAYS = 8

const FIRST_NAMES = [
  'Adam', 'Alice', 'Amir', 'Anna', 'Arthur', 'Basile', 'Camille', 'Chloé', 'Clément', 'Élise',
  'Émile', 'Eva', 'Gabin', 'Hugo', 'Inès', 'Jade', 'Jules', 'Léa', 'Léon', 'Lina',
  'Lou', 'Louis', 'Lucas', 'Maël', 'Manon', 'Mia', 'Nina', 'Noah', 'Nour', 'Oscar',
  'Paul', 'Rose', 'Sacha', 'Sami', 'Théo', 'Yanis', 'Zoé', 'Victor', 'Margaux', 'Ilyes',
] as const
const LAST_NAMES = [
  'Abeille', 'Bouleau', 'Cerisier', 'Dune', 'Écorce', 'Fougère', 'Givre', 'Houx', 'Iris', 'Jonquille',
  'Lavande', 'Mimosa', 'Noisette', 'Olivier', 'Pervenche', 'Roseau', 'Saule', 'Tilleul', 'Verveine', 'Glycine',
  'Bruyère', 'Châtaigne', 'Myrtille', 'Sorbier', 'Tournesol', 'Muguet', 'Platane', 'Coquelicot', 'Érable', 'Lilas',
] as const

/** Classes de la démonstration : celles du scénario de recette (CE1 A 24 → CP A 20, CE1 B 24, CE2 A 22) et quelques autres. */
export const DEMO_CLASSES = [
  { name: 'PS-MS', levels: ['PS', 'MS'], size: 22, afternoon: true },
  { name: 'GS', levels: ['GS'], size: 23, afternoon: false },
  { name: 'CP A', levels: ['CP'], size: 20, afternoon: false },
  { name: 'CE1 A', levels: ['CE1'], size: 24, afternoon: false },
  { name: 'CE1 B', levels: ['CE1'], size: 24, afternoon: false },
  { name: 'CE2 A', levels: ['CE2'], size: 22, afternoon: false },
  { name: 'CM1-CM2', levels: ['CM1', 'CM2'], size: 25, afternoon: false },
] as const

export type DemoRole = 'direction' | 'enseignant' | 'remplacant'

export interface DemoAccount {
  key: 'direction' | 'enseignant' | 'enseignante' | 'remplacant'
  role: DemoRole
  displayName: string
  /** Classe confiée (nom), ou null pour la direction. */
  className: string | null
  profile: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { key: 'direction', role: 'direction', displayName: 'Claire Démo (direction)', className: null, profile: 'Directrice' },
  { key: 'enseignant', role: 'enseignant', displayName: 'Marc Démo', className: 'CE1 A', profile: 'Enseignant pressé (CE1 A)' },
  { key: 'enseignante', role: 'enseignant', displayName: 'Inès Démo', className: 'CP A', profile: 'Enseignante (CP A)' },
  { key: 'remplacant', role: 'remplacant', displayName: 'Julie Démo', className: 'CE2 A', profile: 'Remplaçante (CE2 A, 30 jours)' },
]

/** Petit générateur pseudo-aléatoire déterministe (même code → mêmes données). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Les `count` derniers jours d'école (lundi–samedi) strictement avant `today`, du plus ancien au plus récent. */
export function pastSchoolDays(today: string, count: number): string[] {
  const days: string[] = []
  for (let d = addDays(today, -1); days.length < count; d = addDays(d, -1)) if (isoWeekday(d) !== 7) days.unshift(d)
  return days
}

/** Début de l'année scolaire (1er septembre) contenant `today`. */
export function schoolYearStart(today: string): string {
  const [y, m] = today.split('-').map(Number)
  return `${m >= 8 ? y : y - 1}-09-01`
}

export interface DemoData {
  code: string
  accounts: (DemoAccount & { userId: string; membershipId: string; email: string })[]
  classes: { id: string; name: string; levels: string[] }[]
  slots: { id: string; classId: string; name: string; halfDay: 'am' | 'pm'; dueTime: string; position: number }[]
  students: { id: string; classId: string; firstName: string; lastName: string }[]
  assignments: { id: string; classId: string; membershipId: string }[]
  calls: { id: string; classId: string; slotId: string; date: string; actorId: string; at: string }[]
  /** Paires appel/élève notées « Absent » dans l'historique (les autres élèves sont « Présent »). */
  absences: { callId: string; studentId: string }[]
  plannedAbsence: { id: string; studentId: string }
}

/**
 * Construit toutes les données de l'école de démonstration.
 * `code` : suffixe aléatoire qui rend les adresses uniques (ex. « k7p2 »).
 */
export function buildDemoData(today: string, code: string, newId: () => string): DemoData {
  const rnd = seededRandom(code)
  const accounts = DEMO_ACCOUNTS.map((a) => ({
    ...a,
    userId: newId(),
    membershipId: newId(),
    email: `${a.key}.${code}@demo.appely.test`,
  }))
  const classes = DEMO_CLASSES.map((c) => ({ id: newId(), name: c.name, levels: [...c.levels] }))
  const slots: DemoData['slots'] = []
  const students: DemoData['students'] = []
  const used = new Set<string>()
  DEMO_CLASSES.forEach((c, i) => {
    const classId = classes[i].id
    slots.push({ id: newId(), classId, name: 'Appel du matin', halfDay: 'am', dueTime: '09:00', position: 0 })
    if (c.afternoon) slots.push({ id: newId(), classId, name: 'Appel de l’après-midi', halfDay: 'pm', dueTime: '13:45', position: 1 })
    for (let n = 0; n < c.size; n++) {
      let first: string, last: string
      do {
        first = FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)]
        last = LAST_NAMES[Math.floor(rnd() * LAST_NAMES.length)]
      } while (used.has(`${first} ${last}`))
      used.add(`${first} ${last}`)
      students.push({ id: newId(), classId, firstName: first, lastName: last })
    }
  })
  const byName = new Map<string, string>(classes.map((c) => [c.name, c.id]))
  const assignments = accounts
    .filter((a) => a.className)
    .map((a) => ({ id: newId(), classId: byName.get(a.className!)!, membershipId: a.membershipId }))

  // Historique : appels du matin validés sur les derniers jours d'école, 0 à 2 absents par appel.
  const teacherOf = new Map(accounts.filter((a) => a.className).map((a) => [byName.get(a.className!)!, a.userId]))
  const directionId = accounts[0].userId
  const calls: DemoData['calls'] = []
  const absences: DemoData['absences'] = []
  for (const date of pastSchoolDays(today, DEMO_PAST_DAYS)) {
    for (const cls of classes) {
      const slot = slots.find((s) => s.classId === cls.id && s.halfDay === 'am')!
      const minutes = 20 + Math.floor(rnd() * 35) // validé entre 8 h 20 et 8 h 55 (heure d'hiver)
      const call = {
        id: newId(),
        classId: cls.id,
        slotId: slot.id,
        date,
        actorId: teacherOf.get(cls.id) ?? directionId,
        at: `${date}T07:${String(minutes).padStart(2, '0')}:00.000Z`,
      }
      calls.push(call)
      const pupils = students.filter((s) => s.classId === cls.id)
      const absentCount = Math.floor(rnd() * 3)
      const picked = new Set<string>()
      while (picked.size < absentCount) picked.add(pupils[Math.floor(rnd() * pupils.length)].id)
      for (const studentId of picked) absences.push({ callId: call.id, studentId })
    }
  }
  // Absence prévue aujourd'hui : un élève de CE1 A (prépositionné « Absent », toujours « à vérifier »).
  const ce1a = students.filter((s) => s.classId === byName.get('CE1 A'))
  return { code, accounts, classes, slots, students, assignments, calls, absences, plannedAbsence: { id: newId(), studentId: ce1a[3].id } }
}

/** Mot de passe de démonstration lisible : « Demo-xxxx-xxxx-xxxx » (alphabet sans caractères ambigus). */
export function demoPassword(random: Uint8Array): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const chars = [...random].map((b) => alphabet[b % alphabet.length]).join('')
  return `Demo-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
}
