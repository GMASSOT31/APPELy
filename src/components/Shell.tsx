import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Logo } from './Logo'
import { useSession } from '../lib/session'
import { SPACE_LABELS, spaceFor, type Space } from '../lib/space'

const SPACE_TONES: Record<Space, string> = {
  admin: 'bg-night text-white',
  direction: 'bg-primary text-white',
  enseignant: 'bg-success-ink text-white',
}

export function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { me, logout } = useSession()
  const navigate = useNavigate()
  const space = spaceFor(useLocation().pathname, me)
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/" aria-label="Accueil Appely" className="inline-flex min-h-11 shrink-0 items-center">
              <Logo size={30} />
            </Link>
            {space && (
              <span
                data-testid="space"
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold tracking-wide whitespace-nowrap uppercase ${SPACE_TONES[space]}`}
              >
                <span className="sr-only">Interface </span>
                {SPACE_LABELS[space]}
              </span>
            )}
          </div>
          {me && (
            <div className="flex items-center gap-1">
              <span className="hidden text-sm text-muted sm:inline">{me.user.displayName}</span>
              <button
                type="button"
                onClick={async () => {
                  await logout()
                  navigate('/connexion')
                }}
                title="Se déconnecter"
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm whitespace-nowrap text-muted hover:bg-surface hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
                {/* Téléphone : icône seule (le nom reste lu par les lecteurs d'écran). */}
                <span className="sr-only sm:not-sr-only">Se déconnecter</span>
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
      <PrivacyFooter />
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
        <PrivacyFooter />
      </div>
    </div>
  )
}

/** Lien discret vers la page « Confidentialité », présent sur tous les écrans. */
export function PrivacyFooter() {
  return (
    <footer className="mx-auto flex max-w-5xl justify-center px-4 pb-6 print:hidden">
      <Link
        to="/confidentialite"
        className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-muted underline-offset-4 hover:bg-surface hover:text-ink hover:underline"
      >
        Confidentialité
      </Link>
    </footer>
  )
}
