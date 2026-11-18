import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Card, ErrorBox, Spinner } from '../components/ui'
import { api, formatDate } from '../lib/api'
import { callPath, useDirection } from '../lib/school'
import { timeOf } from '../lib/schoolFormat'

interface Row {
  date: string
  classId: string
  className: string
  slot: { id: string; name: string; halfDay: 'am' | 'pm' }
  state: 'validated' | 'corrected' | 'missing' | 'distributed'
  version: number | null
  hosted: { count: number; from: string[] } | null
  distribution: { total: number; confirmed: number } | null
  validatedAt: string | null
  updatedAt: string | null
  by: string | null
  counts: { present: number; absent: number; other: number } | null
  expected: number
}
interface Data {
  from: string
  to: string
  today: string
  truncated: boolean
  rows: Row[]
  classes: { id: string; name: string }[]
  people: { id: string; display_name: string }[]
}

const STATES = [
  ['', 'Tous'],
  ['validated', 'Validé'],
  ['corrected', 'Corrigé'],
  ['missing', 'Non fait'],
  ['distributed', 'Répartie'],
] as const

const inputCls = 'min-h-11 w-full min-w-0 rounded-xl bg-white px-3 text-base ring-1 ring-line focus:ring-2 focus:ring-primary focus:outline-none'

/** Historique des appels (§9) : filtres par date, classe, personne et état ; détail et corrections. */
export default function HistoryPage() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const query = params.toString()

  useEffect(() => {
    let alive = true
    setLoading(true)
    api<Data>(`/api/schools/${schoolId}/history${query ? `?${query}` : ''}`).then(
      (d) => {
        if (!alive) return
        setData(d)
        setError('')
        setLoading(false)
      },
      (e) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [schoolId, query])

  if (!membership) return <Navigate to="/" replace />

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  // Regroupement par jour pour une lecture rapide.
  const days = new Map<string, Row[]>()
  for (const r of data?.rows ?? []) days.set(r.date, [...(days.get(r.date) ?? []), r])

  return (
    <Shell title="Historique des appels">
      <SchoolNav schoolId={schoolId} />
      <Card className="mb-4">
        <form className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filtres">
          <label className="grid gap-1.5 text-sm font-medium">
            Du
            <input type="date" value={params.get('from') ?? data?.from ?? ''} max={data?.today} onChange={(e) => set('from', e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Au
            <input type="date" value={params.get('to') ?? data?.to ?? ''} max={data?.today} onChange={(e) => set('to', e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Classe
            <select value={params.get('classId') ?? ''} onChange={(e) => set('classId', e.target.value)} className={inputCls}>
              <option value="">Toutes</option>
              {data?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Fait par
            <select value={params.get('userId') ?? ''} onChange={(e) => set('userId', e.target.value)} className={inputCls}>
              <option value="">Tout le monde</option>
              {data?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Répartitions
            <select value={params.get('distribution') ?? ''} onChange={(e) => set('distribution', e.target.value)} className={inputCls}>
              <option value="">Tous les appels</option>
              <option value="1">Seulement les répartitions</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            État
            <select value={params.get('state') ?? ''} onChange={(e) => set('state', e.target.value)} className={inputCls}>
              {STATES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </form>
      </Card>
      <ExportCard schoolId={schoolId} query={query} disabled={!data || data.rows.length === 0} />
      <ErrorBox>{error}</ErrorBox>
      {!data ? (
        loading && <Spinner />
      ) : data.rows.length === 0 ? (
        <Card className="text-center text-sm text-muted">Aucun appel ne correspond à ces filtres.</Card>
      ) : (
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <p className="text-sm text-muted" aria-live="polite">
            {data.rows.length} appel{data.rows.length > 1 ? 's' : ''}
            {data.truncated && ' (liste limitée : affinez les filtres)'}
          </p>
          {[...days.entries()].map(([day, rows]) => (
            <section key={day} aria-labelledby={`d-${day}`}>
              <h2 id={`d-${day}`} className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                {new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h2>
              <Card flush>
                <ul className="divide-y divide-line">
                  {rows.map((r) => (
                    <li key={`${r.date}:${r.slot.id}`}>
                      <Link
                        to={callPath(schoolId, r.classId, r.date, r.slot.id)}
                        className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{r.className}</span>
                            <span className="text-sm text-muted">· {r.slot.name}</span>
                            {r.state === 'validated' && <Badge tone="success">Validé</Badge>}
                            {r.state === 'corrected' && <Badge tone="info">Corrigé (version {r.version})</Badge>}
                            {r.state === 'missing' && <Badge tone="danger">Non fait</Badge>}
                            {r.state === 'distributed' && (
                              <Badge tone={r.distribution && r.distribution.confirmed === r.distribution.total ? 'success' : 'warning'}>
                                Répartie · {r.distribution?.confirmed}/{r.distribution?.total} confirmés
                              </Badge>
                            )}
                            {r.hosted && <Badge tone="info">+{r.hosted.count} accueillis ({r.hosted.from.join(', ')})</Badge>}
                            {r.state !== 'distributed' && r.distribution && <Badge tone="info">{r.distribution.total} répartis ailleurs</Badge>}
                          </span>
                          <span className="block text-sm text-muted">
                            {r.state === 'distributed'
                              ? 'Élèves dans les classes d’accueil'
                              : r.counts
                              ? `${r.counts.present} présent${r.counts.present > 1 ? 's' : ''} · ${r.counts.absent} absent${r.counts.absent > 1 ? 's' : ''}${
                                  r.counts.other ? ` · ${r.counts.other} autre${r.counts.other > 1 ? 's' : ''}` : ''
                                } / ${r.expected} · validé à ${timeOf(r.validatedAt!)}${
                                  r.state === 'corrected' ? `, corrigé le ${formatDate(r.updatedAt)} à ${timeOf(r.updatedAt!)}` : ''
                                } · ${r.by}`
                              : `${r.expected} élève${r.expected > 1 ? 's' : ''} attendu${r.expected > 1 ? 's' : ''}`}
                          </span>
                        </span>
                        <span className="sr-only">, {formatDate(r.date)} : voir le détail</span>
                        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </Shell>
  )
}

const exportBtn =
  'inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-line hover:bg-surface focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none'

/**
 * Exports (§9, lot 6) : page imprimable (PDF via « Imprimer »), tableur Excel et CSV, avec les filtres affichés.
 * Les fichiers sont servis uniquement à la direction connectée (jamais de lien public) et journalisés.
 */
function ExportCard({ schoolId, query, disabled }: { schoolId: string; query: string; disabled: boolean }) {
  const [detail, setDetail] = useState(false)
  const q = new URLSearchParams(query)
  if (detail) q.set('detail', '1')
  const file = (format: 'csv' | 'xlsx') => {
    q.set('format', format)
    return `/api/schools/${schoolId}/history/export?${q}`
  }
  const printQuery = new URLSearchParams(q)
  printQuery.delete('format')
  return (
    <Card className="mb-4 print:hidden">
      <h2 className="text-base font-semibold">Exporter cette liste</h2>
      <p className="mt-1 text-sm text-muted">Mêmes filtres que ci-dessus, avec la légende des états. Fichiers réservés à la direction : ne les transmettez pas à des listes de diffusion.</p>
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} className="size-5 accent-primary" />
        Inclure le détail par élève (noms et états)
      </label>
      {disabled ? (
        <p className="mt-2 text-sm text-muted">Rien à exporter pour ces filtres.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={`/ecole/${schoolId}/historique/imprimer?${printQuery}`} className={exportBtn}>
            <Printer className="size-4" aria-hidden /> Imprimer ou PDF
          </Link>
          <a href={file('xlsx')} download className={exportBtn}>
            <FileSpreadsheet className="size-4" aria-hidden /> Tableur Excel (.xlsx)
          </a>
          <a href={file('csv')} download className={exportBtn}>
            <FileText className="size-4" aria-hidden /> Fichier CSV
          </a>
        </div>
      )}
    </Card>
  )
}
