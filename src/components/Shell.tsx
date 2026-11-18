import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Logo } from './Logo'
import { useSession } from '../lib/session'

export function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { me, logout } = useSession()
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="Accueil Appely" className="inline-flex min-h-11 items-center">
            <Logo size={30} />
          </Link>
          {me && (
            <div className="flex items-center gap-1">
              <span className="hidden text-sm text-muted sm:inline">{me.user.displayName}</span>
              <button
                type="button"
                onClick={async () => {
                  await logout()
                  navigate('/connexion')
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-muted hover:bg-surface hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  )
}

/** Mise en page centrée pour la connexion, l'installation et les invitations. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link to="/" aria-label="Accueil Appely" className="inline-flex min-h-11 items-center">
            <Logo size={40} />
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
