import { Shell } from '../components/Shell'
import { Card } from '../components/ui'

export default function NoAccess() {
  return (
    <Shell title="Aucun accès actif">
      <Card>
        <p className="text-muted">
          Votre compte n’est rattaché à aucune école pour le moment (accès retiré, expiré ou école suspendue).
          Contactez la direction de votre école.
        </p>
      </Card>
    </Shell>
  )
}
