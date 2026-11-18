import { Shell } from '../components/Shell'
import { Card } from '../components/ui'
import { formatDate, ROLE_LABELS } from '../lib/api'
import { useSession } from '../lib/session'

/** Espace enseignant : l'écran d'appel arrive avec les lots 2 et 3 (classes, élèves, appel). */
export default function Teacher() {
  const { me } = useSession()
  return (
    <Shell title={`Bonjour ${me?.user.displayName ?? ''}`}>
      <div className="grid gap-3">
        {me?.memberships.map((m) => (
          <Card key={m.schoolId}>
            <p className="font-semibold">{m.schoolName}</p>
            <p className="text-sm text-muted">
              {ROLE_LABELS[m.role]}
              {m.activeTo && ` · accès jusqu’au ${formatDate(m.activeTo)}`}
            </p>
            <p className="mt-3 text-sm text-muted">
              Votre accès est actif. L’appel de votre classe sera disponible ici dès que la direction aura créé les
              classes (fonction en cours de développement).
            </p>
          </Card>
        ))}
      </div>
    </Shell>
  )
}
