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

## Avancement

Voir [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md) et le plan de données [`docs/SCHEMA.md`](docs/SCHEMA.md).
