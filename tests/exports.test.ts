// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON des tests */
/** Lot 6 : exports de l'historique (CSV, XLSX, page imprimable), en-têtes de sécurité. Données fictives. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import readXlsxFile, { readSheetNames } from 'read-excel-file/node'
import { setupWorld, type Client } from './helpers'
import { schoolToday } from '../worker/routes/calls'
import { dayMask, isoWeekday } from '../src/domain/schedule'
import { crc32, safeText, toCsv } from '../worker/lib/spreadsheet'
import worker from '../worker/index'

let world: Awaited<ReturnType<typeof setupWorld>>
let A: { id: string; dir: Client }
let B: { id: string; dir: Client }
let teacher: { client: Client; membershipId: string }
let ce1: string
let slot: string
let students: { id: string; firstName: string }[]

const today = schoolToday()
const date = isoWeekday(today) === 7 ? new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10) : today
const from = new Date(Date.parse(date) - 6 * 86400_000).toISOString().slice(0, 10)
const url = (s: string, p = '') => `/api/schools/${s}${p}`
const exportUrl = (q: string, s = A.id) => url(s, `/history/export?from=${from}&to=${date}&${q}`)

beforeAll(async () => {
  world = await setupWorld()
  A = await world.school('École A')
  B = await world.school('École B')
  await A.dir.post(url(A.id, '/settings/weekdays'), { closedWeekdays: 0 })
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({ firstName: `Élève${i + 1}`, lastName: 'Fictif', className: 'CE1 A' })),
    // Prénom piégé : ne doit jamais devenir une formule dans un tableur.
    { firstName: '=HYPERLINK("http://exemple.test")', lastName: 'Piège', className: 'CE1 A' },
  ]
  const imp = await A.dir.post(url(A.id, '/imports'), { rows, classLevels: { 'CE1 A': ['CE1'] } })
  ce1 = imp.data.classesCreated[0].id
  await world.env.DB.batch([
    world.env.DB.prepare(`UPDATE students SET active_from = '2026-01-01'`),
    world.env.DB.prepare(`UPDATE classes SET created_at = '2026-01-01T00:00:00.000Z'`),
  ])
  const d = (await A.dir.get(url(A.id, `/classes/${ce1}`))).data
  students = d.students
  slot = d.slots[0].id
  await A.dir.post(url(A.id, `/classes/${ce1}/slots/${slot}`), { name: 'Appel du matin', halfDay: 'am', weekdays: dayMask([1, 2, 3, 4, 5, 6]), dueTime: '08:45' })
  await world.env.DB.prepare(`UPDATE call_slots SET created_at = '2026-01-01T00:00:00.000Z'`).run()
  const st = (await A.dir.get(url(A.id, '/settings'))).data.statuses
  const present = st.find((s: any) => s.category === 'PRESENT').id
  const absent = st.find((s: any) => s.category === 'ABSENT').id
  const entries = Object.fromEntries(students.map((s) => [s.id, present]))
  entries[students.find((s) => s.firstName === 'Élève2')!.id] = absent
  const v = await A.dir.post(url(A.id, `/classes/${ce1}/calls/${date}/${slot}/validate`), { baseVersion: 0, requestId: 'req-export-0001', entries })
  expect(v.status).toBe(200)
  teacher = await world.member(A.id, A.dir, 'enseignant')
  await A.dir.post(url(A.id, `/classes/${ce1}/teachers`), { membershipId: teacher.membershipId })
})
afterAll(() => world.proxy.dispose())

describe('exports de l’historique (§9)', () => {
  it('CSV récapitulatif : en-têtes, appel validé et appels non faits, sans nom d’élève', async () => {
    const res = await A.dir.raw(exportUrl('format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="appely-historique-.*\.csv"$/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // BOM : accents corrects dans Excel
    const text = new TextDecoder().decode(bytes) // (le décodeur retire le BOM)
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toBe(
      'Date;Jour;Classe;Créneau;Statut;Version;Élèves attendus;Présents;Absents;Autres;Validé le;Corrigé le;Dernière saisie par;Élèves accueillis;Répartition',
    )
    expect(lines[1]).toMatch(new RegExp(`^${date};\\w+;CE1 A;Appel du matin;Validé;1;6;5;1;0;`))
    expect(lines.some((l) => l.includes(';Non fait;'))).toBe(true)
    expect(text).not.toContain('Élève1') // récapitulatif : pas de données nominatives
  })

  it('CSV détaillé : une ligne par élève, état et catégorie, formules neutralisées', async () => {
    const text = await (await A.dir.raw(exportUrl('format=csv&detail=1'))).text()
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toBe('Date;Jour;Classe;Créneau;Statut de l’appel;Version;Prénom;Nom;État;Catégorie;Accueilli de')
    expect(lines).toHaveLength(1 + 6)
    expect(lines.find((l) => l.includes('Élève2'))).toMatch(/;Élève2;Fictif;Absent;Absent;$/)
    expect(text).toContain(`"'=HYPERLINK(""http://exemple.test"")"`)
  })

  it('XLSX lisible par un tableur : feuilles Appels, Détail par élève, Légende', async () => {
    const res = await A.dir.raw(exportUrl('format=xlsx&detail=1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const buf = Buffer.from(await res.arrayBuffer())
    expect((await readSheetNames(buf)).map((s: any) => (typeof s === 'string' ? s : s.name))).toEqual(['Appels', 'Détail par élève', 'Légende'])
    const calls = (await readXlsxFile(buf, { sheet: 'Appels' })) as any[][]
    expect(calls[0].slice(0, 5)).toEqual(['Date', 'Jour', 'Classe', 'Créneau', 'Statut'])
    expect(calls[1].slice(2, 10)).toEqual(['CE1 A', 'Appel du matin', 'Validé', 1, 6, 5, 1, 0])
    const detail = (await readXlsxFile(buf, { sheet: 'Détail par élève' })) as any[][]
    expect(detail).toHaveLength(7)
    // Texte pur : le prénom piégé reste du texte (jamais une formule).
    expect(detail.some((r) => r[6] === '=HYPERLINK("http://exemple.test")')).toBe(true)
    const legend = (await readXlsxFile(buf, { sheet: 'Légende' })) as any[][]
    const flat = legend.map((r) => r.join(' | ')).join('\n')
    expect(flat).toContain('École | École A')
    expect(flat).toMatch(/Présent \| Présent/)
    expect(flat).toMatch(/Non fait \| Aucun appel validé/)
  })

  it('XLSX récapitulatif sans feuille nominative', async () => {
    const buf = Buffer.from(await (await A.dir.raw(exportUrl('format=xlsx'))).arrayBuffer())
    expect((await readSheetNames(buf)).map((s: any) => (typeof s === 'string' ? s : s.name))).toEqual(['Appels', 'Légende'])
  })

  it('page imprimable (PDF) : légende, statuts, détail regroupé par appel, filtres', async () => {
    const r = await A.dir.get(exportUrl(`format=print&detail=1&classId=${ce1}`))
    expect(r.status).toBe(200)
    const d = r.data
    expect(d).toMatchObject({ schoolName: 'École A', from, to: date, detail: true, filters: ['Classe : CE1 A'] })
    expect(d.legend.map((s: any) => s.category)).toEqual(expect.arrayContaining(['Présent', 'Absent']))
    expect(d.states.map((s: any) => s.label)).toEqual(['Validé', 'Corrigé', 'Non fait', 'Répartie'])
    const call = d.rows.find((x: any) => x.state === 'validated')
    expect(call).toMatchObject({ className: 'CE1 A', slotName: 'Appel du matin', expected: 6, counts: { present: 5, absent: 1, other: 0 } })
    expect(call.entries).toHaveLength(6)
    expect(call.entries.find((e: any) => e.name === 'Élève2 Fictif')).toMatchObject({ status: 'Absent', category: 'ABSENT' })
    expect(d.rows.every((x: any) => x.className === 'CE1 A')).toBe(true)
    // Sans détail : aucune donnée nominative.
    const light = (await A.dir.get(exportUrl('format=print'))).data
    expect(light.rows.every((x: any) => x.entries.length === 0)).toBe(true)
  })

  it('chaque export est inscrit au journal d’audit', async () => {
    const r = await world.env.DB.prepare(`SELECT details FROM audit_events WHERE school_id = ? AND action = 'history.exported' ORDER BY rowid DESC LIMIT 1`)
      .bind(A.id)
      .first<{ details: string }>()
    expect(JSON.parse(r!.details)).toMatchObject({ format: 'print', detail: false, from, to: date })
  })

  it('format inconnu ou période trop longue refusés', async () => {
    expect((await A.dir.get(exportUrl('format=pdf'))).data.error.code).toBe('INVALID_FORMAT')
    expect((await A.dir.get(url(A.id, '/history/export?format=csv&from=2026-01-01&to=2026-06-01'))).data.error.code).toBe('RANGE_TOO_LONG')
  })

  it('réservé à la direction de l’école : enseignant, autre école et visiteur refusés (pas de lien public)', async () => {
    expect((await teacher.client.get(exportUrl('format=csv'))).status).toBe(403)
    expect((await B.dir.get(exportUrl('format=csv'))).status).toBe(403)
    expect((await B.dir.get(exportUrl('format=xlsx&detail=1'))).status).toBe(403)
    // Requête sans cookie de session : refusée.
    const visitor = await (await import('../worker/index')).handleApi(new Request(`https://appely.test${exportUrl('format=csv&detail=1')}`), world.env)
    expect(visitor.status).toBe(401)
    // L'école B n'exporte que ses propres données (vides).
    const own = await B.dir.get(exportUrl('format=print&detail=1', B.id))
    expect(own.status).toBe(200)
    expect(own.data.rows).toEqual([])
  })
})

describe('en-têtes de sécurité et outils d’export', () => {
  it('les réponses d’API portent CSP, nosniff, interdiction d’intégration et no-store', async () => {
    const res = await worker.fetch(new Request('https://appely.test/api/me'), { ...world.env, ASSETS: {} as Fetcher } as any, {} as any)
    expect(res.status).toBe(401)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('journal d’audit : les connexions réussies sont tracées, sans adresse IP', async () => {
    const { Client } = await import('./helpers')
    const c = new Client(world.env, '10.9.9.9')
    expect((await c.post('/api/auth/login', { email: 'admin@exemple.test', password: 'motdepasse-admin' })).status).toBe(200)
    const r = await world.env.DB.prepare(`SELECT COUNT(*) AS n, MAX(details) AS d FROM audit_events WHERE action = 'auth.login'`).first<{ n: number; d: string | null }>()
    expect(r!.n).toBeGreaterThan(0)
    expect(r!.d).toBeNull()
  })

  it('CSV : neutralisation des formules et guillemets', () => {
    expect(safeText('=1+1')).toBe("'=1+1")
    expect(safeText('-2')).toBe("'-2")
    expect(safeText('@x')).toBe("'@x")
    expect(safeText('Léa')).toBe('Léa')
    expect(toCsv([['a;b', 'c"d', 3, null]])).toBe('﻿"a;b";"c""d";3;\r\n')
  })

  it('CRC32 conforme (valeur de référence)', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
