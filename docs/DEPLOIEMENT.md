# Guide de déploiement (Cloudflare Workers + D1)

Appely tient dans **un seul Worker Cloudflare** (offre gratuite) : il sert l’application (fichiers de `dist/`) et l’API
(`/api/*`), avec une base **Cloudflare D1** (`appely-db`). Aucun autre service, aucun service payant.

> ⚠️ Déploiement **de test** : aucune donnée réelle d’élève tant que la validation RGPD et institutionnelle
> (responsable de traitement, DPD académique, DASEN) n’est pas obtenue. Utilisez l’école de démonstration.

## 1. Ce qu’il faut

- Un compte Cloudflare (gratuit) et le dépôt GitHub de l’application.
- Node.js 22 sur l’ordinateur qui fait les essais locaux (pas nécessaire pour le déploiement automatique).

## 2. Base de données D1

1. Tableau de bord Cloudflare → **Stockage et bases de données → D1** → **Créer une base** nommée `appely-db`.
   Choisir si possible la **juridiction Union européenne** (localisation des données).
2. Copier son identifiant dans `wrangler.jsonc` (`d1_databases[0].database_id`). Ce n’est pas un secret.
3. Les tables n’ont **pas** besoin d’être créées à la main : au premier appel d’API, le Worker applique les migrations
   versionnées (`worker/migrations/000N_*.ts`, liste dans `worker/lib/migrate.ts`), chacune en une transaction.
   Ne jamais modifier une migration publiée : en ajouter une nouvelle.

## 3. Worker relié au dépôt (déploiement automatique)

1. Cloudflare → **Workers et Pages** → **Créer** → **Importer un dépôt** GitHub.
2. Commande de build : `npm run build` ; commande de déploiement : `npx wrangler deploy` (lit `wrangler.jsonc`).
3. Chaque push sur `main` relance le build et le déploiement. La CI GitHub (`.github/workflows/ci.yml`) vérifie en
   parallèle lint, tests et build.

## 4. Le seul secret : `ADMIN_SETUP_CODE`

Code à usage unique qui permet de créer le premier compte administrateur sur `/installation`.

- Cloudflare → Worker `appely` → **Paramètres → Variables et secrets** → **Ajouter** → type **Secret**,
  nom `ADMIN_SETUP_CODE`, valeur : une longue phrase aléatoire connue de vous seul.
- Ou en ligne de commande : `npx wrangler secret put ADMIN_SETUP_CODE`.
- Il n’est **jamais** écrit dans le dépôt. Après l’installation du superadmin, il ne sert plus (la page refuse
  une seconde installation).

Aucune autre clé n’existe : pas de clé d’API dans le navigateur, mots de passe hachés (PBKDF2), sessions en cookie
`HttpOnly`.

## 5. Première mise en service

1. Ouvrir `https://<votre-worker>.workers.dev/installation`, saisir le code, son nom, son e-mail et un mot de passe.
2. Sur la page **Écoles** : **Créer l’école de démonstration** → les identifiants fictifs (direction, deux enseignants,
   une remplaçante, mot de passe commun) s’affichent **une seule fois** : notez-les et transmettez-les aux testeurs.
   « Recréer l’école de démonstration » efface et régénère toutes ses données (jeu rejouable).
3. Pour une vraie école (après validation RGPD seulement) : **Créer une école** → lien d’invitation à transmettre à
   la direction (valable 72 h, utilisable une fois).

Le même jeu de démonstration peut être créé en ligne de commande :

```bash
APPELY_URL=https://<votre-worker>.workers.dev APPELY_ADMIN_EMAIL=vous@exemple.fr npm run demo
# le mot de passe superadmin est demandé (ou APPELY_ADMIN_PASSWORD) ; les identifiants s’affichent à l’écran
```

## 6. Essais en local

```bash
npm install
cp .dev.vars.example .dev.vars        # puis choisir un code local
npm run build
npx wrangler dev --port 8787 --persist-to .wrangler/e2e   # base D1 locale
# ouvrir http://localhost:8787/installation
```

Parcours complets P1 à P12 (navigateur automatisé, base jetable) : `npm run e2e` (voir `e2e/README.md`).

## 7. Quotas de l’offre gratuite (à surveiller)

- Workers : 100 000 requêtes / jour. D1 : 5 Go, 5 millions de lignes lues / jour, **50 requêtes SQL par appel
  d’API** — Appely en utilise au plus ~25 (insertions en masse par `json_each`, écritures groupées en transaction).
- Le tableau de bord Direction s’actualise toutes les 30 s (≈ 13 requêtes D1) : une vingtaine d’écrans ouverts toute
  une matinée restent loin des limites.

## 8. Sauvegarde et restauration

- D1 garde un historique (« Time Travel ») de 30 jours : restauration à un instant donné depuis le tableau de bord
  ou `npx wrangler d1 time-travel restore appely-db --timestamp=<date>`.
- Export complet : `npx wrangler d1 export appely-db --remote --output=sauvegarde.sql` (à chiffrer et stocker
  hors du dépôt). Restauration testée en local : `npx wrangler d1 execute appely-db --local --file=sauvegarde.sql`.
- Exports de l’historique pour la direction : onglet **Historique → Exporter** (PDF, Excel, CSV).

## 9. Avant tout usage réel

Voir `README.md` (« Limitations connues ») et `docs/AVANCEMENT.md` (Definition of Done) : validation du responsable
de traitement et du DPD, durée de conservation, localisation UE des données, politique de confidentialité.
