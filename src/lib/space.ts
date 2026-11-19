import type { Me } from './api'

export type Space = 'admin' | 'direction' | 'enseignant'

export const SPACE_LABELS: Record<Space, string> = {
  admin: 'Admin',
  direction: 'Direction',
  enseignant: 'Enseignant',
}

/**
 * Interface affichée en haut de l'écran (Admin, Direction ou Enseignant), déduite de la page ouverte.
 * L'écran d'appel est partagé : il est « Direction » si la personne dirige cette école, « Enseignant » sinon.
 * Le remplaçant utilise l'interface Enseignant (ce n'est pas une quatrième interface, cahier des charges §3).
 */
export function spaceFor(pathname: string, me: Me | null): Space | null {
  if (!me) return null
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname.startsWith('/ecole/')) return 'direction'
  if (pathname === '/enseignant') return 'enseignant'
  const call = /^\/appel\/([^/]+)\//.exec(pathname)
  if (call) {
    const directs = me.memberships.some((m) => m.schoolId === call[1] && m.role === 'direction')
    return directs ? 'direction' : 'enseignant'
  }
  return null
}
