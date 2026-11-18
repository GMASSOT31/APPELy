# Appely

L’appel scolaire, simple et efficace. Application web (PWA) multi-écoles avec trois interfaces :
Admin, Direction et Enseignant. Le cahier des charges v1.0 (18 novembre 2026) fait référence.

> ⚠️ **Version de démonstration.** Aucune donnée réelle d’élève ne doit être saisie, ni dans
> l’application, ni dans ce dépôt, ni dans les tests. Le passage en usage réel est conditionné
> à la validation RGPD et institutionnelle (DASEN, DPD académique).

## Démarrer

```bash
npm install
npm run dev      # serveur local
npm test         # tests unitaires et d’interface
npm run build    # build de production dans dist/
```

Serveur local complet (API + base D1 locale) : créer `.dev.vars` avec
`ADMIN_SETUP_CODE="un-code-local"`, puis `npx wrangler dev`, et ouvrir `/installation`.

## Déploiement

Cloudflare Workers, relié au dépôt GitHub : chaque push sur `main` lance `npm run build`
puis `wrangler deploy` (voir `wrangler.jsonc`). Les tables de la base D1 `appely-db` sont
créées ou mises à jour automatiquement au premier appel d'API (`worker/lib/migrate.ts`).

Variable secrète à définir dans Cloudflare (Worker `appely` → Paramètres → Variables et secrets) :
`ADMIN_SETUP_CODE`, code utilisé une seule fois sur `/installation` pour créer le superadmin.

## Stack

- Front : React + TypeScript + Vite · Tailwind CSS · Lucide · React Router
- API : Cloudflare Worker (`worker/`) · base Cloudflare D1 (SQLite)
- Tests : Vitest + Testing Library · tests d'API sur D1 locale (`tests/`)

## Installer l’application (PWA)

Sur téléphone ou tablette : ouvrir le site puis « Ajouter à l’écran d’accueil » (iPhone : bouton Partager ; Android :
menu du navigateur). Sur ordinateur : icône d’installation dans la barre d’adresse (Chrome, Edge).

## Limitations connues

- **Version de démonstration** : aucune donnée réelle d’élève tant que les validations RGPD et institutionnelles
  (responsable de traitement, DPD académique) ne sont pas obtenues.
- **Hors ligne** : l’application a besoin du réseau pour ouvrir un appel. Le mode hors ligne nominatif (liste d’élèves
  gardée sur l’appareil) est **désactivé** : sur des tablettes partagées, ce stockage n’est pas validé (cahier des charges §10).
  Seul un appel déjà ouvert peut être terminé sans réseau : il reste « Enregistré sur cet appareil, non transmis » et part
  automatiquement au retour du réseau, sans doublon. Le service worker ne garde que l’application, jamais les données.
- **Exports** : réservés à la direction, sur 62 jours maximum ; le PDF passe par « Imprimer → Enregistrer au format PDF ».
- **Temps réel** : le tableau de bord s’actualise toutes les 30 s (pas de connexion permanente).
- **E-mails** : aucun envoi d’e-mail ; les invitations et réinitialisations passent par un lien à transmettre soi-même,
  pas de « mot de passe oublié » en libre-service.
- **Notifications** : internes à l’application uniquement (pas de notifications push).
- **Conservation des données** : pas encore de purge automatique des anciens appels ni du journal d’audit ; la durée de
  conservation doit être fixée par le responsable de traitement.
- **Hébergement** : Cloudflare (Workers + D1) ; la localisation UE des données est à vérifier/configurer dans Cloudflare.
- **Accessibilité** : audit automatique WCAG 2.1 AA (axe-core) et parcours clavier vérifiés ; un audit RGAA complet avec
  lecteurs d’écran réels (VoiceOver, NVDA, TalkBack) reste à faire avec des utilisateurs.
- **Couleur principale** légèrement assombrie par rapport à la planche pour respecter les contrastes.

## Avancement

Voir [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md) et le plan de données [`docs/SCHEMA.md`](docs/SCHEMA.md).
