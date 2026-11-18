import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type Me } from './api'

interface SessionValue {
  me: Me | null
  loading: boolean
  /** Le serveur est injoignable (pas de réseau) : on ne sait pas encore qui est connecté. */
  offline: boolean
  refresh: () => Promise<Me | null>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('/api/me')
      setMe(m)
      setOffline(false)
      return m
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') {
        setOffline(true)
        return null
      }
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e)
      setOffline(false)
      setMe(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', {}).catch(() => undefined)
    clearLocalDrafts()
    setMe(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])
  // Retour du réseau : on revérifie la session automatiquement.
  useEffect(() => {
    if (!offline) return
    const h = () => void refresh()
    window.addEventListener('online', h)
    return () => window.removeEventListener('online', h)
  }, [offline, refresh])

  return <SessionContext.Provider value={{ me, loading, offline, refresh, logout }}>{children}</SessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const v = useContext(SessionContext)
  if (!v) throw new Error('SessionProvider manquant')
  return v
}

/** Page d'arrivée selon le rôle : l'utilisateur retrouve directement son espace. */
// eslint-disable-next-line react-refresh/only-export-components
export function homePathFor(me: Me): string {
  if (me.user.isSuperadmin) return '/admin'
  const m = me.memberships.find((x) => x.role === 'direction') ?? me.memberships[0]
  if (!m) return '/sans-acces'
  return m.role === 'direction' ? `/ecole/${m.schoolId}` : '/enseignant'
}

const LAST_EMAIL = 'appely:last-email'

/** L'appareil retient l'adresse du dernier compte pour réduire la saisie les jours suivants (§4.2). */
// eslint-disable-next-line react-refresh/only-export-components
export function rememberEmail(email: string) {
  try {
    localStorage.setItem(LAST_EMAIL, email)
  } catch {
    /* stockage indisponible (navigation privée) : sans conséquence */
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? ''
  } catch {
    return ''
  }
}

/** Déconnexion : effacement des brouillons d'appel restés sur l'appareil (appareils partagés, §10). */
// eslint-disable-next-line react-refresh/only-export-components
export function clearLocalDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith('appely:draft:')) localStorage.removeItem(k)
    }
  } catch {
    /* stockage indisponible */
  }
}
