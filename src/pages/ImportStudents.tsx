import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileUp } from 'lucide-react'
import { Shell } from '../components/Shell'
import { LevelPicker } from '../components/schoolForms'
import { Badge, Button, Card, ErrorBox, Spinner, SuccessBox } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { LEVELS } from '../domain/schedule'
import {
  buildPreview,
  classKey,
  clean,
  guessMapping,
  MAX_IMPORT_ROWS,
  nameKey,
  parseCsv,
  type Mapping,
  type PreviewRow,
} from '../domain/importRows'
import { useDirection, type Overview } from '../lib/school'

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

interface ClassStudents {
  students: { firstName: string; lastName: string | null }[]
}

async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file')
    const rows = await readXlsxFile(file)
    return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))).filter((r) => r.some((c) => clean(c)))
  }
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text())
  throw new Error('Format non pris en charge : utilisez un fichier .csv ou .xlsx.')
}

export default function ImportStudents() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const base = `/api/schools/${schoolId}`
  const [overview, setOverview] = useState<Overview | null>(null)
  const [existingKeys, setExistingKeys] = useState<Map<string, Set<string>> | null>(null)
  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Mapping>({ firstName: 0, lastName: 1, className: null })
  const [defaultClass, setDefaultClass] = useState('')
  const [levels, setLevels] = useState<Record<string, string[]>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ importId: string; students: number; classes: number } | null>(null)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    api<Overview>(`${base}/overview`).then(async (o) => {
      setOverview(o)
      // Élèves déjà inscrits, pour signaler les doublons dès la prévisualisation.
      const details = await Promise.all(o.classes.map((c) => api<ClassStudents>(`${base}/classes/${c.id}`)))
      setExistingKeys(
        new Map(o.classes.map((c, i) => [classKey(c.name), new Set(details[i].students.map((s) => nameKey(s.firstName, s.lastName)))])),
      )
    }, (e) => setError(e.message))
  }, [base])

  const header = rows && hasHeader ? rows[0] : null
  const body = useMemo(() => (rows ? (hasHeader ? rows.slice(1) : rows) : []), [rows, hasHeader])
  const columns = rows ? Math.max(...rows.slice(0, 20).map((r) => r.length)) : 0
  const colLabel = (i: number) => (header?.[i] ? `${clean(header[i])} (colonne ${i + 1})` : `Colonne ${i + 1}`)

  const preview: PreviewRow[] = useMemo(() => {
    if (!rows || !overview || !existingKeys) return []
    return buildPreview(body, mapping, {
      firstLine: hasHeader ? 2 : 1,
      defaultClass: mapping.className === null ? defaultClass : null,
      existing: overview.classes.map((c) => ({ name: c.name, studentKeys: existingKeys.get(classKey(c.name)) ?? new Set() })),
    })
  }, [rows, body, mapping, hasHeader, defaultClass, overview, existingKeys])

  const ok = preview.filter((p) => p.status === 'ok')
  const newClasses = [...new Set(ok.filter((p) => p.newClass).map((p) => p.className))]
  const missingLevels = newClasses.filter((c) => !levels[c]?.length)

  if (!membership) return <Navigate to="/" replace />
  if (!overview || !existingKeys) return error ? <ErrorBox>{error}</ErrorBox> : <Spinner />

  async function onFile(file: File) {
    setError('')
    setResult(null)
    try {
      const r = await readFile(file)
      if (r.length === 0) throw new Error('Le fichier est vide.')
      setFileName(file.name)
      setRows(r)
      const guess = guessMapping(r[0])
      setHasHeader(!!guess)
      setMapping(guess ?? { firstName: 0, lastName: r[0].length > 1 ? 1 : null, className: r[0].length > 2 ? 2 : null })
      // Niveau deviné pour les classes nouvelles (« CE1 B » → CE1).
      const guessLevels: Record<string, string[]> = {}
      const ci = guess?.className ?? null
      if (ci !== null)
        for (const row of r.slice(1)) {
          const name = clean(row[ci])
          const l = LEVELS.find((x) => new RegExp(`^${x}\\b`, 'i').test(name))
          if (name && l) guessLevels[name] = [l]
        }
      setLevels(guessLevels)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function submit() {
    setError('')
    setLoading(true)
    try {
      const r = await api<{ importId: string; students: number; classesCreated: unknown[] }>(`${base}/imports`, {
        rows: ok.map((p) => ({ firstName: p.firstName, lastName: p.lastName, className: p.className })),
        classLevels: levels,
      })
      setResult({ importId: r.importId, students: r.students, classes: r.classesCreated.length })
      setRows(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur inattendue.')
    } finally {
      setLoading(false)
    }
  }

  const select = (key: keyof Mapping, optional: boolean) => (
    <select
      className="min-h-11 rounded-xl bg-white px-3 ring-1 ring-line"
      value={mapping[key] ?? ''}
      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === '' ? null : Number(e.target.value) })}
    >
      {optional && <option value="">— Aucune —</option>}
      {Array.from({ length: columns }, (_, i) => (
        <option key={i} value={i}>
          {colLabel(i)}
        </option>
      ))}
    </select>
  )

  return (
    <Shell title="Importer des élèves" subtitle={membership.schoolName}>
      <Link to={`/ecole/${schoolId}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Toutes les classes
      </Link>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {result && (
          <SuccessBox>
            {cancelled ? (
              'Import annulé : les élèves et les classes créés ont été retirés.'
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {result.students} élève{result.students > 1 ? 's' : ''} importé{result.students > 1 ? 's' : ''}
                  {result.classes > 0 && `, ${result.classes} classe${result.classes > 1 ? 's' : ''} créée${result.classes > 1 ? 's' : ''}`}.
                </span>
                <span className="flex gap-2">
                  <Link to={`/ecole/${schoolId}`} className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-line">
                    Voir les classes
                  </Link>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!confirm('Annuler cet import ? Les élèves importés seront retirés.')) return
                      try {
                        await api(`${base}/imports/${result.importId}/cancel`, {})
                        setCancelled(true)
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    Annuler l’import
                  </Button>
                </span>
              </div>
            )}
          </SuccessBox>
        )}

        <Card>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-6 text-center hover:border-primary/50 hover:bg-surface/50">
            <FileUp className="size-7 text-primary" aria-hidden />
            <span className="font-semibold">{fileName || 'Choisir un fichier CSV ou Excel (.xlsx)'}</span>
            <span className="text-sm text-muted">
              Une ligne par élève : prénom, nom (facultatif), classe. Le fichier reste sur votre appareil : seules les
              lignes validées sont envoyées.
            </span>
            <input
              type="file"
              accept=".csv,.txt,.xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ''
              }}
            />
          </label>
        </Card>

        <ErrorBox>{error}</ErrorBox>

        {rows && (
          <>
            <Card className="grid gap-4">
              <h2 className="font-semibold">Colonnes</h2>
              <label className="inline-flex min-h-11 items-center gap-2.5 text-sm font-medium">
                <input type="checkbox" className="size-5 accent-primary" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                La première ligne contient les titres des colonnes
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-medium">Prénom{select('firstName', false)}</label>
                <label className="grid gap-1.5 text-sm font-medium">Nom{select('lastName', true)}</label>
                <label className="grid gap-1.5 text-sm font-medium">Classe{select('className', true)}</label>
              </div>
              {mapping.className === null && (
                <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
                  Classe de destination
                  <input
                    list="classes-list"
                    placeholder="CP A"
                    className="min-h-11 rounded-xl bg-white px-3 ring-1 ring-line"
                    value={defaultClass}
                    onChange={(e) => setDefaultClass(e.target.value)}
                  />
                  <datalist id="classes-list">
                    {overview.classes.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </label>
              )}
            </Card>

            {newClasses.length > 0 && (
              <Card className="grid gap-4">
                <h2 className="font-semibold">Nouvelles classes à créer</h2>
                {newClasses.map((c) => (
                  <div key={c} className="grid gap-2">
                    <p className="font-medium">{c}</p>
                    <LevelPicker value={levels[c] ?? []} onChange={(v) => setLevels({ ...levels, [c]: v })} />
                  </div>
                ))}
              </Card>
            )}

            <Card flush>
              <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
                <h2 className="mr-auto font-semibold">Vérification</h2>
                <Badge tone="success">{ok.length} à importer</Badge>
                <Badge tone="warning">{plural(preview.filter((p) => p.status === 'duplicate').length, 'doublon ignoré', 'doublons ignorés')}</Badge>
                <Badge tone="danger">{plural(preview.filter((p) => p.status === 'error').length, 'erreur', 'erreurs')}</Badge>
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Ligne</th>
                      <th className="px-4 py-2 font-medium">Élève</th>
                      <th className="px-4 py-2 font-medium">Classe</th>
                      <th className="px-4 py-2 font-medium">État</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.map((p) => (
                      <tr key={p.line} className={p.status === 'ok' ? '' : 'bg-canvas'}>
                        <td className="px-4 py-2 text-muted">{p.line}</td>
                        <td className="px-4 py-2">
                          {p.firstName} {p.lastName}
                        </td>
                        <td className="px-4 py-2">
                          {p.className}
                          {p.newClass && <span className="ml-1 text-xs text-primary-strong">(nouvelle)</span>}
                        </td>
                        <td className="px-4 py-2">
                          {p.status === 'ok' ? (
                            <Badge tone="success">OK</Badge>
                          ) : (
                            <Badge tone={p.status === 'error' ? 'danger' : 'warning'}>{p.message}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {missingLevels.length > 0 && <ErrorBox>Précisez le niveau de : {missingLevels.join(', ')}.</ErrorBox>}
            {ok.length > MAX_IMPORT_ROWS && <ErrorBox>Maximum {MAX_IMPORT_ROWS} élèves par import : découpez le fichier.</ErrorBox>}
            <div className="flex justify-end">
              <Button
                loading={loading}
                disabled={ok.length === 0 || missingLevels.length > 0 || ok.length > MAX_IMPORT_ROWS}
                onClick={submit}
              >
                Importer {ok.length} élève{ok.length > 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
