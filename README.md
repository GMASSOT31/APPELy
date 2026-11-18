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

## Déploiement

Cloudflare Workers (assets statiques), relié au dépôt GitHub : chaque push sur `main`
lance `npm run build` puis `wrangler deploy` (voir `wrangler.jsonc`).

## Stack

React + TypeScript + Vite · Tailwind CSS · Lucide · Vitest + Testing Library.
Prévu : Supabase (Postgres + Auth + RLS, région UE) pour le backend, Vite PWA.

## Avancement

Voir [`docs/AVANCEMENT.md`](docs/AVANCEMENT.md) et le plan de données [`docs/SCHEMA.md`](docs/SCHEMA.md).
