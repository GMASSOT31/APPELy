# Avancement par lots

| Lot | Contenu | État |
|---|---|---|
| 0 / Initialisation | Dépôt, conventions, design tokens, CI, déploiement, règles métier pures + tests, plan de schéma | **Fait** (voir ci-dessous) |
| 1 / Accès + écoles | Admin et Direction : invitations, authentification, rôles, cloisonnement et tests | **Fait** (voir ci-dessous) |
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

## Lot 1 — vérifié

Tests d'intégration (`tests/api.test.ts`, 19 tests sur une vraie base D1 locale) et parcours navigateur de bout en bout :

- Installation du superadmin protégée par le code secret `ADMIN_SETUP_CODE`, utilisable une seule fois.
- Superadmin : création d'école (état « invitation en attente »), lien Direction unique valable 72 h,
  nouveau lien, suspension / réactivation. Aucun accès aux données internes des écoles.
- Direction : activation de son compte (l'école passe « active »), invitation de directions adjointes,
  enseignants et remplaçants (date de fin obligatoire, accès coupé automatiquement), annulation
  d'invitation, retrait d'accès, réinitialisation forcée (ancien mot de passe et sessions invalidés).
- Connexion : mots de passe PBKDF2, sessions révocables en cookie HttpOnly, 5 essais / 15 min,
  protection CSRF, l'appareil retient l'adresse du dernier compte.
- Cloisonnement : la direction d'une école ne lit ni ne modifie jamais une autre école (tests négatifs).
- Journal d'audit des actions sensibles.

## Écarts au cahier des charges (assumés)

- **Cloudflare D1 au lieu de Supabase** (quota de projets Supabase atteint). D1 n'a pas de RLS : le
  cloisonnement est appliqué dans le Worker (`requireSchoolRole`) et vérifié par des tests négatifs.
  Toute nouvelle route d'école doit passer par ce contrôle.
- **Invitations par lien à transmettre** plutôt que par e-mail : pas de service d'envoi d'e-mails pour
  l'instant. Le lien est affiché à la direction / au superadmin, qui le transmet.
- **Connexion par adresse e-mail** (plutôt que sélection de l'école puis du compte) : plus simple et ne
  publie pas la liste des écoles. L'adresse est mémorisée sur l'appareil.
- « Mot de passe oublié » : passe par la direction (réinitialisation forcée), pas d'auto-service sans e-mail.

## Écarts ouverts

- Pas encore de classes, d'élèves ni d'appel enregistré (lots 2 et 3). La démo de la page d'accueil n'enregistre rien.
- Localisation des données D1 : à vérifier dans le tableau de bord Cloudflare (juridiction UE souhaitée).
