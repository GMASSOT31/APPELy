import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Logo } from '../components/Logo'

/**
 * Page « Confidentialité » : accessible sans connexion. Décrit ce qu'Appely enregistre réellement, en langage
 * simple, sans affirmer une conformité non validée (dossier complet : docs/rgpd/).
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 grid gap-2 text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">{children}</div>
    </section>
  )
}

export default function Privacy() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="Accueil Appely" className="inline-flex min-h-11 items-center">
            <Logo size={30} />
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-muted hover:bg-surface hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Retour
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Confidentialité</h1>
            <p className="mt-1 text-muted">Ce qu’Appely enregistre, qui peut le voir, et comment exercer vos droits.</p>
          </div>
        </div>

        <p role="note" className="rounded-xl bg-surface p-4 text-sm text-ink ring-1 ring-line">
          <strong>Version de démonstration.</strong> Appely n’est pas encore validé pour un usage réel : cette validation
          (responsable de traitement, délégué à la protection des données de l’académie, DASEN) est en cours. N’y
          saisissez aucune donnée réelle d’élève.
        </p>

        <Section title="À quoi sert Appely">
          <p>
            Faire l’appel des élèves à chaque demi-journée, permettre à la direction de savoir quels appels sont faits
            et où se trouvent les élèves (par exemple quand une classe est répartie dans d’autres classes), et diffuser
            les messages de la direction aux enseignants.
          </p>
        </Section>

        <Section title="Ce qui est enregistré">
          <p className="font-medium">Pour les élèves :</p>
          <ul>
            <li>prénom, nom (facultatif) et classe ;</li>
            <li>jours et demi-journées où l’élève est attendu ;</li>
            <li>à chaque appel : présent, absent ou autre état choisi par l’école ;</li>
            <li>la classe qui l’accueille lors d’une répartition ;</li>
            <li>les absences prévues : dates et motif général (raison familiale, rendez-vous…), jamais de motif médical.</li>
          </ul>
          <p className="font-medium">Pour les personnels :</p>
          <ul>
            <li>adresse e-mail professionnelle, nom, rôle et dates d’accès ;</li>
            <li>mot de passe sous une forme illisible (personne ne peut le lire) ;</li>
            <li>un journal des actions importantes (connexion, appel validé ou corrigé, export…).</li>
          </ul>
          <p>
            <strong>Jamais :</strong> adresse, téléphone, date de naissance, photo, donnée de santé, note, publicité ou
            mesure d’audience.
          </p>
        </Section>

        <Section title="Qui peut voir quoi">
          <ul>
            <li>La direction : les données de son école uniquement.</li>
            <li>Un enseignant ou un remplaçant : ses classes, et les élèves qu’il accueille ce jour-là.</li>
            <li>L’administrateur technique : la liste des écoles, jamais les noms d’élèves ni les appels.</li>
            <li>Aucune autre école, aucune entreprise, aucun partenaire.</li>
          </ul>
        </Section>

        <Section title="Sur cet appareil">
          <ul>
            <li>Un seul cookie : celui qui vous garde connecté (supprimé quand vous vous déconnectez).</li>
            <li>L’adresse e-mail du dernier compte, pour la saisir plus vite.</li>
            <li>
              Si le réseau coupe pendant un appel : un brouillon sans aucun nom, effacé dès l’envoi, à la déconnexion
              ou au bout de 12 heures.
            </li>
            <li>Aucune liste d’élèves n’est gardée sur l’appareil.</li>
          </ul>
          <p>Sur une tablette partagée, pensez à vous déconnecter après l’appel.</p>
        </Section>

        <Section title="Où et combien de temps">
          <p>
            Les données sont hébergées par Cloudflare (base D1). Le choix d’un stockage garanti dans l’Union européenne
            et les durées de conservation doivent être fixés par le responsable de traitement avant tout usage réel ;
            ils seront indiqués ici.
          </p>
        </Section>

        <Section title="Vos droits">
          <p>
            Vous pouvez demander à consulter les informations vous concernant (ou concernant votre enfant), les faire
            corriger, et dans certains cas demander leur effacement ou vous y opposer. Adressez-vous à la direction de
            l’école, qui transmet au délégué à la protection des données de l’académie. Vous pouvez aussi saisir la
            CNIL (cnil.fr).
          </p>
        </Section>
      </main>
    </div>
  )
}
