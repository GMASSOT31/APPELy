# Appely — instructions pour Claude

Application web (PWA) d'appel scolaire multi-écoles : interfaces Admin, Direction, Enseignant.
Référence : `docs/cahier-des-charges-v1.pdf` (à lire en entier avant un nouveau lot).
Suivi : `docs/AVANCEMENT.md` (lots faits, écarts assumés, écarts ouverts). Schéma : `docs/SCHEMA.md`.

## Règles de collaboration (demandées par l'utilisateur — prioritaires)

- L'utilisateur est francophone, non développeur, et a peu de temps : réponses en français, simples, sans jargon.
- **Ne jamais s'arrêter en silence.** À la fin de chaque travail (lot, correctif, blocage) :
  1. envoyer une notification (outil `PushNotification`) qui résume en une ou deux phrases ;
  2. puis poser un **choix précis** avec `AskUserQuestion` (2 à 4 options concrètes, la recommandée en
     premier avec « (Recommandé) »), par exemple « Passer au lot suivant / Corriger X d'abord / Autre ».
- Travailler en autonomie : décider seul des détails mineurs (les documenter dans `docs/AVANCEMENT.md`),
  tester soi-même (l'utilisateur ne teste pas), ne demander que les vraies décisions.
- **Session trop chargée** (contexte long, beaucoup de lots déjà faits) : ouvrir automatiquement une nouvelle
  session cloud avec l'outil `create_session` (même environnement, `source_url` = ce dépôt) et un message de
  départ complet (lot à faire, état actuel, rappel de lire ce fichier). Puis notifier l'utilisateur et lui
  proposer un choix. Ne pas attendre que la session déborde.
- Ne pas toucher aux autres projets de l'utilisateur (TUBy, fluence-cp, etc.).

## Garde-fous du projet

- **Données strictement fictives** partout (code, tests, captures, journaux). Jamais de vrai nom d'élève.
- Aucun service payant ni compte tiers sans accord explicite de l'utilisateur.
- Toute route portant un `school_id` passe par `requireSchoolRole` (`worker/lib/auth.ts`) : c'est notre
  équivalent du RLS. Chaque nouvel objet d'école doit avoir un **test négatif inter-écoles**.
- Libellés du quotidien côté utilisateur (« Valider l'appel », « Répartir une classe »…), zones tactiles ≥ 44 px,
  rendu correct à 320/360 px de large, accessible au clavier.

## Stack et architecture

- Front : React 19 + TypeScript + Vite, Tailwind CSS v4 (tokens dans `src/index.css`), Lucide, React Router.
- API : Cloudflare Worker `worker/index.ts` (routeur par expressions régulières), base **Cloudflare D1**
  (`appely-db`, binding `DB`). Pas de Supabase (quota atteint chez l'utilisateur).
- Migrations : `worker/migrations/000N_*.ts` (chaîne SQL exportée), enregistrées dans `worker/lib/migrate.ts`,
  appliquées automatiquement au premier appel d'API. Ne jamais modifier une migration déjà publiée : en ajouter une.
- Règles métier pures et partagées front/serveur : `src/domain/` (schedule, attendance, repartition, importRows).
- Offre gratuite D1 : ~50 requêtes par appel de Worker et 100 paramètres liés par requête. Pour les insertions
  en masse, passer un tableau JSON et utiliser `json_each(?)` (voir `importStudents`, `validateCall`).
- Écritures multiples : `env.DB.batch([...])` (transaction). Idempotence/concurrence : voir `validateCall`.
- Auth maison : PBKDF2, sessions en cookie HttpOnly, invitations par lien unique 72 h, `ADMIN_SETUP_CODE`
  (secret Cloudflare, déjà défini en production).

## Commandes

```bash
npm install
npm run lint && npx tsc -b && npm test && npm run build   # à faire passer avant chaque commit
```

- Tests d'API : `tests/*.test.ts` sur une vraie D1 locale via `getPlatformProxy` (`tests/helpers.ts` :
  `setupWorld()` crée superadmin, écoles, membres).
- Parcours navigateur : créer `.dev.vars` avec `ADMIN_SETUP_CODE="code-local-e2e"`, lancer
  `npx wrangler dev --port 8787 --persist-to <dossier temporaire>`, piloter avec Playwright (préinstallé,
  `require('playwright')`), vérifier aussi la largeur mobile (`document.documentElement.scrollWidth`).
  Arrêter le serveur ensuite (`pkill -f "wrangler dev"`).

## Déploiement

Push sur `main` → Cloudflare Workers Builds lance `npm run build` puis `wrangler deploy` (voir `wrangler.jsonc`).
Site : https://appely.gabriel-massot31.workers.dev (non joignable depuis la session cloud : l'utilisateur vérifie
que le déploiement est vert). Commits directement sur `main`, messages en français, avec les lignes
d'attribution habituelles.

## Fin de chaque lot

1. Tests (unitaires + API + négatifs inter-écoles) et parcours navigateur réussis, captures vérifiées.
2. `docs/AVANCEMENT.md` et `docs/SCHEMA.md` à jour (fait, écarts assumés, écarts ouverts).
3. Commit + push sur `main`.
4. Notification + choix précis (voir plus haut).
