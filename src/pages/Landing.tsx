import { BarChart3, MessageSquare, Shuffle, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { CallDemo } from '../demo/CallDemo'

const features = [
  { icon: Users, title: 'Appels rapides', text: 'Les exceptions en deux taps, puis « Valider l’appel ».' },
  { icon: Shuffle, title: 'Répartitions intelligentes', text: 'Une classe absente ? Ses élèves sont répartis de façon équilibrée.' },
  { icon: MessageSquare, title: 'Messages de direction', text: 'Le mot du jour s’affiche directement sur l’écran d’appel.' },
  { icon: BarChart3, title: 'Suivi et historique', text: 'La direction voit en temps réel ce qui est fait et ce qui manque.' },
]

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <div className="bg-night px-4 py-2 text-center text-xs text-white/85" role="note">
        Prototype en construction — la démo ci-dessous utilise des données fictives et n’enregistre rien.
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo size={36} />
        <Link
          to="/connexion"
          className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line hover:bg-surface"
        >
          Se connecter
        </Link>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 lg:grid-cols-[1fr_28rem] lg:items-start lg:gap-14 lg:pt-6">
        <div className="lg:pt-10">
          <h1 className="text-4xl font-bold tracking-tight text-night sm:text-5xl">
            L’appel scolaire,
            <br />
            <span className="text-primary">simple et efficace.</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Une enseignante fait l’appel de sa classe en quelques secondes. La direction voit immédiatement ce qui
            est fait, ce qui manque et où se trouvent les élèves répartis.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-card)]">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm text-muted">
            Essayez la démo : touchez deux élèves pour les marquer absents, puis validez.
          </p>
        </div>

        <CallDemo />
      </main>
    </div>
  )
}
