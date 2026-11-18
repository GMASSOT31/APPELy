/**
 * Import d'élèves (cahier des charges §5.1 et §09) : lecture CSV, détection des colonnes,
 * prévisualisation avec doublons et erreurs. Le fichier n'est jamais envoyé au serveur :
 * seules les lignes retenues le sont, après vérification par la direction.
 */

export const MAX_IMPORT_ROWS = 500
export const NAME_MAX = 60
export const CLASS_NAME_MAX = 40

export function clean(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Clé de comparaison : sans accents, sans casse, espaces normalisés. */
export function nameKey(first: string, last: string | null | undefined): string {
  const norm = (x: string) =>
    clean(x)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  return `${norm(first)}|${norm(last ?? '')}`
}

export function classKey(name: string): string {
  return clean(name).toLowerCase()
}

/** Lecture CSV tolérante : séparateur « ; », « , » ou tabulation, guillemets, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ';')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => clean(c) !== ''))
}

export interface Mapping {
  firstName: number
  lastName: number | null
  className: number | null
}

const MATCHERS: Record<keyof Mapping, RegExp> = {
  firstName: /pr[ée]nom|first/i,
  lastName: /^nom|nom de famille|last|surname/i,
  className: /classe|class|division|groupe/i,
}

/** Devine les colonnes à partir de la ligne d'en-tête ; null si aucune en-tête reconnue. */
export function guessMapping(header: string[]): Mapping | null {
  const find = (k: keyof Mapping) => header.findIndex((h) => MATCHERS[k].test(clean(h)))
  const firstName = find('firstName')
  if (firstName < 0) return null
  let lastName: number | null = header.findIndex((h, i) => i !== firstName && MATCHERS.lastName.test(clean(h)))
  if (lastName < 0) lastName = null
  const c = find('className')
  return { firstName, lastName, className: c < 0 ? null : c }
}

export type PreviewStatus = 'ok' | 'duplicate' | 'error'

export interface PreviewRow {
  line: number
  firstName: string
  lastName: string | null
  className: string
  status: PreviewStatus
  message?: string
  newClass?: boolean
}

export interface ExistingClass {
  name: string
  studentKeys: Set<string>
}

/**
 * Prévisualisation : chaque ligne est « à importer », « doublon » (déjà présent dans la classe
 * ou deux fois dans le fichier) ou « erreur » (prénom manquant, trop long, classe absente).
 */
export function buildPreview(
  rows: string[][],
  mapping: Mapping,
  opts: { firstLine: number; defaultClass: string | null; existing: ExistingClass[] },
): PreviewRow[] {
  const byClass = new Map(opts.existing.map((c) => [classKey(c.name), c]))
  const seen = new Set<string>()
  return rows.map((r, i) => {
    const line = opts.firstLine + i
    const firstName = clean(r[mapping.firstName])
    const lastName = mapping.lastName === null ? null : clean(r[mapping.lastName]) || null
    const className = mapping.className === null ? clean(opts.defaultClass) : clean(r[mapping.className]) || clean(opts.defaultClass)
    const base = { line, firstName, lastName, className }
    if (!firstName) return { ...base, status: 'error', message: 'Prénom manquant' }
    if (firstName.length > NAME_MAX || (lastName?.length ?? 0) > NAME_MAX)
      return { ...base, status: 'error', message: 'Nom trop long' }
    if (!className) return { ...base, status: 'error', message: 'Classe manquante' }
    if (className.length > CLASS_NAME_MAX) return { ...base, status: 'error', message: 'Nom de classe trop long' }
    const key = `${classKey(className)}#${nameKey(firstName, lastName)}`
    const existing = byClass.get(classKey(className))
    if (existing?.studentKeys.has(nameKey(firstName, lastName)))
      return { ...base, status: 'duplicate', message: 'Déjà dans la classe' }
    if (seen.has(key)) return { ...base, status: 'duplicate', message: 'Deux fois dans le fichier' }
    seen.add(key)
    return { ...base, status: 'ok', newClass: !existing }
  })
}
