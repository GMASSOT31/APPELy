import { WifiOff } from 'lucide-react'
import { AuthLayout } from '../components/Shell'
import { Button, Card } from '../components/ui'
import { useSession } from '../lib/session'

/**
 * Appareil hors connexion à l'ouverture (§10). La V1 ne garde aucune liste d'élèves hors ligne
 * (mode hors ligne nominatif désactivé tant qu'il n'est pas validé) : on l'explique simplement.
 */
export default function Offline() {
  const { refresh } = useSession()
  return (
    <AuthLayout>
      <Card>
        <div className="flex items-center gap-2 font-semibold">
          <WifiOff className="size-5 text-danger-ink" aria-hidden />
          <h1 className="text-lg">Pas de connexion</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          Appely a besoin du réseau pour afficher vos classes. Un appel déjà commencé reste enregistré sur cet appareil : il sera
          envoyé quand vous rouvrirez l’appel, une fois le réseau revenu.
        </p>
        <Button className="mt-4 w-full" onClick={() => void refresh()}>
          Réessayer
        </Button>
      </Card>
    </AuthLayout>
  )
}
