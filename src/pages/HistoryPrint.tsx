import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { ErrorBox, Spinner } from '../components/ui'
import { LogoMark } from '../components/Logo'
import { api } from '../lib/api'
import { useDirection } from '../lib/school'

interface PrintRow {
  date: string
  className: string
  slotName: string
  state: 'validated' | 'corrected' | 'missing' | 'distributed'
  version: number | null
  expected: number
  counts: { present: number; absent: number; other: number } | null
  validatedAt: string
  updatedAt: string
  by: string | null
  hosted: { count: number; from: string[] } | null
  distribution: { total: number; confirmed: number } | null
  entries: { name: string; status: string; category: 'PRESENT' | 'ABSENT' | 'AUTRE'; hostedFrom: string | null }[]
}
interface PrintData {
  schoolName: string
  from: string
  to: string
  exportedAt: string
  exportedBy: string
  filters: string[]
  detail: boolean
  legend: { label: string; category: string; archived: boolean }[]
  states: { key: string; label: string; help: string }[]
  rows: PrintRow[]
}

const STATE_LABEL: Record<PrintRow['state'], string> = { validated: 'Validé', corrected: 'Corrigé', missing: 'Non fait', distributed: 'Répartie' }
const longDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR')

/**
 * Registre imprimable (§9, lot 6) : « PDF prêt à imprimer » via la fenêtre d'impression du navigateur
 * (« Enregistrer au format PDF »). Aucun fichier n'est stocké ni partagé par lien : la page exige la session.
 */
export default function HistoryPrint() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [params] = useSearchParams()
  const [data, setData] = useState<PrintData | null>(null)
  const [error, setError] = useState('')
  const q = new URLSearchParams(params)
  q.set('format', 'print')
  const query = q.toString()
  const back = new URLSearchParams(params)
  back.delete('detail')

  useEffect(() => {
    let alive = true
    api<PrintData>(`/api/schools/${schoolId}/history/export?${query}`).then(
      (d) => alive && setData(d),
      (e) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [schoolId, query])

  if (!membership) return <Navigate to="/" replace />

  const days = new Map<string, PrintRow[]>()
  for (const r of data?.rows ?? []) days.set(r.date, [...(days.get(r.date) ?? []), r])

  return (
    <div className="min-h-dvh bg-surface print:bg-white">
      <div className="sticky top-0 z-10 border-b border-line bg-white print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-3">
          <Link
            to={`/ecole/${schoolId}/historique${back.toString() ? `?${back}` : ''}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden /> Retour à l’historique
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!data}
            className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-55"
          >
            <Printer className="size-4" aria-hidden /> Imprimer ou enregistrer en PDF
          </button>
          <p className="w-full text-xs text-muted">Pour un PDF, choisissez « Enregistrer au format PDF » comme imprimante.</p>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
        <ErrorBox>{error}</ErrorBox>
        {!data && !error && <Spinner />}
        {data && (
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-line print:rounded-none print:p-0 print:shadow-none print:ring-0">
            <header className="flex flex-wrap items-start gap-3 border-b border-line pb-4">
              <LogoMark size={36} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold tracking-tight">Registre des appels · {data.schoolName}</h1>
                <p className="text-sm">
                  Du {shortDate(data.from)} au {shortDate(data.to)}
                  {data.filters.length > 0 && <> · {data.filters.join(' · ')}</>}
                </p>
                <p className="text-xs text-muted">
                  Édité le {data.exportedAt} par {data.exportedBy} · Document confidentiel, réservé à l’école
                </p>
              </div>
            </header>

            <section aria-labelledby="legende" className="mt-4 grid gap-3 text-sm sm:grid-cols-2 print:grid-cols-2">
              <h2 id="legende" className="sr-only">
                Légende
              </h2>
              <div>
                <h3 className="font-semibold">Statut de l’appel</h3>
                <dl className="mt-1 grid gap-0.5">
                  {data.states.map((s) => (
                    <div key={s.key}>
                      <dt className="inline font-semibold">{s.label} : </dt>
                      <dd className="inline text-muted print:text-ink">{s.help}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="font-semibold">États d’appel de l’école</h3>
                <ul className="mt-1 grid gap-0.5">
                  {data.legend.map((s) => (
                    <li key={s.label}>
                      <span className="font-semibold">{s.label}</span> — catégorie {s.category}
                      {s.archived && ' (archivé)'}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {data.rows.length === 0 && <p className="mt-6 text-sm text-muted">Aucun appel ne correspond à ces filtres.</p>}
            {[...days.entries()].map(([day, rows]) => (
              <section key={day} aria-labelledby={`p-${day}`} className="mt-6 break-inside-avoid-page">
                <h2 id={`p-${day}`} className="mb-2 text-base font-semibold capitalize">
                  {longDate(day)}
                </h2>
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Appels du ${longDate(day)}`}>
                  <table className="w-full min-w-[34rem] border-collapse text-left text-sm print:min-w-0">
                    <thead>
                      <tr className="border-b-2 border-ink/70">
                        <th scope="col" className="py-1.5 pr-2">Classe</th>
                        <th scope="col" className="py-1.5 pr-2">Créneau</th>
                        <th scope="col" className="py-1.5 pr-2">Statut</th>
                        <th scope="col" className="py-1.5 pr-2 text-right">Prés.</th>
                        <th scope="col" className="py-1.5 pr-2 text-right">Abs.</th>
                        <th scope="col" className="py-1.5 pr-2 text-right">Autres</th>
                        <th scope="col" className="py-1.5 pr-2 text-right">Attendus</th>
                        <th scope="col" className="py-1.5">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-line align-top">
                          <th scope="row" className="py-1.5 pr-2 font-semibold">
                            {r.className}
                          </th>
                          <td className="py-1.5 pr-2">{r.slotName}</td>
                          <td className={`py-1.5 pr-2 ${r.state === 'missing' ? 'font-bold' : ''}`}>
                            {STATE_LABEL[r.state]}
                            {r.state === 'corrected' && ` (v${r.version})`}
                            {r.distribution && r.state === 'distributed' && ` · ${r.distribution.confirmed}/${r.distribution.total} confirmés`}
                            {r.hosted && ` · dont ${r.hosted.count} accueillis (${r.hosted.from.join(', ')})`}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.counts?.present ?? '–'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.counts?.absent ?? '–'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.counts?.other ?? '–'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.expected}</td>
                          <td className="py-1.5 text-xs">
                            {r.validatedAt && `${r.validatedAt}${r.updatedAt ? `, corrigé ${r.updatedAt}` : ''}`}
                            {r.by && <span className="block">{r.by}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.detail &&
                  rows
                    .filter((r) => r.entries.length > 0)
                    .map((r, i) => (
                      <div key={i} className="mt-3 break-inside-avoid">
                        <h3 className="text-sm font-semibold">
                          {r.className} · {r.slotName}
                        </h3>
                        <ul className="mt-1 columns-1 gap-6 text-sm sm:columns-2 print:columns-2">
                          {r.entries.map((e, j) => (
                            <li key={j} className="flex justify-between gap-2 border-b border-dotted border-line py-0.5 break-inside-avoid">
                              <span className="min-w-0">
                                {e.name}
                                {e.hostedFrom && <span className="text-muted print:text-ink"> (accueilli · {e.hostedFrom})</span>}
                              </span>
                              <span className={e.category === 'PRESENT' ? '' : 'font-bold'}>{e.status}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
              </section>
            ))}
          </article>
        )}
      </main>
    </div>
  )
}
