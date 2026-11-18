import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight, Shuffle } from 'lucide-react'
import { Shell } from '../components/Shell'
import { SchoolNav } from '../components/SchoolNav'
import { Badge, Card, ErrorBox, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useDirection } from '../lib/school'
import { periodLabel } from '../domain/repartition'
import { cap, primaryLink, WHEN_BADGE, type PlanSummary } from '../lib/distribution'

/** Répartitions temporaires de l'école (§7) : en cours, à venir, récentes. */
export default function Distributions() {
  const { schoolId = '' } = useParams()
  const membership = useDirection(schoolId)
  const [plans, setPlans] = useState<PlanSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!membership) return
    api<{ plans: PlanSummary[] }>(`/api/schools/${schoolId}/distributions`).then(
      (d) => setPlans(d.plans),
      (e) => setError(e.message),
    )
  }, [schoolId, membership])

  if (!membership) return <Navigate to="/" replace />
  const groups: [string, PlanSummary[]][] = [
    ['En cours et à venir', plans?.filter((p) => p.when === 'current' || p.when === 'upcoming') ?? []],
    ['Terminées ou annulées', plans?.filter((p) => p.when === 'past' || p.when === 'cancelled') ?? []],
  ]

  return (
    <Shell title="Répartitions">
      <SchoolNav schoolId={schoolId} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Une classe sans enseignant ? Répartissez ses élèves dans d’autres classes : ils apparaissent automatiquement dans l’appel des classes
          d’accueil, et leur présence remonte à leur classe.
        </p>
        <Link to={`/ecole/${schoolId}/repartitions/nouvelle`} className={primaryLink}>
          <Shuffle className="size-4" aria-hidden /> Répartir une classe
        </Link>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {!plans ? (
        !error && <Spinner />
      ) : plans.length === 0 ? (
        <Card className="text-center text-sm text-muted">Aucune répartition pour l’instant.</Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {groups
            .filter(([, list]) => list.length)
            .map(([title, list]) => (
              <section key={title} aria-labelledby={`g-${title}`}>
                <h2 id={`g-${title}`} className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                  {title}
                </h2>
                <Card flush>
                  <ul className="divide-y divide-line">
                    {list.map((p) => (
                      <li key={p.id}>
                        <Link to={`/ecole/${schoolId}/repartitions/${p.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface">
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold">{p.sourceName}</span>
                              <Badge tone={WHEN_BADGE[p.when].tone}>{WHEN_BADGE[p.when].label}</Badge>
                            </span>
                            <span className="block text-sm text-muted">{cap(periodLabel(p.startDate, p.endDate, p.halfDays))}</span>
                            <span className="block text-sm break-words text-muted">
                              {p.students > 0 ? `${p.students} élève${p.students > 1 ? 's' : ''} · ` : ''}
                              vers {p.hosts.join(', ')}
                            </span>
                          </span>
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
