# Avancement par lots

| Lot | Contenu | État |
|---|---|---|
| 0 / Initialisation | Dépôt, conventions, design tokens, CI, déploiement, règles métier pures + tests, plan de schéma | **Fait** (voir ci-dessous) |
| 1 / Accès + écoles | Admin et Direction : invitations, authentification, rôles, RLS et tests | À faire — nécessite Supabase |
| 2 / Classes + élèves | Niveaux, jours, créneaux, états, import CSV/XLSX | À faire |
| 3 / Appel enseignant | Grille, compteurs, validation, persistance, corrections | Règles métier faites, persistance à faire |
| 4 / Direction | Dashboard temps réel, historique, messages, rappels | À faire |
| 5 / Répartitions | Algorithme, édition, affectations, synchronisation | Algorithme fait et testé, reste à faire |
| 6 / Finalisation | Exports, PWA, audit sécurité, a11y | À faire |
| 7 / Pilote | Scénarios E2E, docs, déploiement de test | À faire |

## Lot 0 — vérifié

- Design tokens de la planche (couleurs, Inter, Lucide) dans `src/index.css`, logo recréé en SVG.
- Règles d’appel (`src/domain/attendance.ts`) : prépositionnement « à vérifier », cycle de taps,
  sélection directe obligatoire au-delà de 2 états, compteurs cohérents, refus de valider une classe vide.
- Algorithme de répartition (`src/domain/repartition.ts`) : équilibrage sur l’effectif projeté,
  capacités, exclusions, ordre stable ; scénario de recette CE1 A → CP A / CE1 B / CE2 A testé (30/30/30).
- Démo locale de la grille d’appel (données fictives, rien n’est enregistré) : scénario
  « 2 taps + Valider » testé.
- CI GitHub Actions : lint, tests, build.

## Écarts ouverts

- Aucun backend : pas de comptes, pas de persistance. La page publique est une démo, pas l’application.
- Le schéma SQL n’est encore qu’un plan (`docs/SCHEMA.md`), non appliqué ni testé.
