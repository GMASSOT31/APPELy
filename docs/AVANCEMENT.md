# Avancement par lots

| Lot | Contenu | État |
|---|---|---|
| 0 / Initialisation | Dépôt, conventions, design tokens, CI, déploiement, règles métier pures + tests, plan de schéma | **Fait** (voir ci-dessous) |
| 1 / Accès + écoles | Admin et Direction : invitations, authentification, rôles, cloisonnement et tests | **Fait** (voir ci-dessous) |
| 2 / Classes + élèves | Niveaux, jours, créneaux, états, import CSV/XLSX | **Fait** (voir ci-dessous) |
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

## Lot 2 — vérifié

Tests : `tests/classes.test.ts` (14 tests API sur D1 locale), `src/domain/lot2.test.ts` (12 tests de règles),
plus un parcours navigateur complet (création de classe, élèves, emploi du temps, import CSV de 25 élèves,
états, fermetures, affectation d'un enseignant, affichage mobile 360 px).

- Classes : création, renommage, niveaux simples ou doubles (TPS à CM2), archivage (refusé si la classe a
  encore des élèves), regroupement par niveau côté Direction.
- Enseignants affectés aux classes (enseignant, remplaçant ou direction chargée de classe) ; l'enseignant
  voit ses classes, en lecture seule.
- Élèves : ajout rapide à la chaîne, doublons refusés (accents et casse ignorés), modification, changement de
  classe (journalisé), départ daté (l'élève reste dans l'historique).
- Présence attendue : « Même liste tous les jours » ou grille jours × matin/après-midi, par élève ou pour toute
  la classe, avec date d'effet — l'historique n'est jamais réécrit.
- Appels : par classe, un appel du matin par défaut (lun, mar, jeu, ven, avant 9 h), ajout d'appels
  l'après-midi, jours et heure limite au choix.
- Jours sans classe (mercredi, samedi, dimanche par défaut) et périodes de fermeture (vacances, fériés).
- États d'appel personnalisés : Présent / Absent par défaut, jusqu'à 6 états, chacun relié à Présent / Absent /
  Autre, ordre modifiable (= cycle des taps), archivage au lieu de suppression, au moins un Présent et un Absent.
- Import CSV / Excel (.xlsx) : le fichier est lu sur l'appareil, colonnes détectées automatiquement et
  modifiables, prévisualisation (à importer / doublons / erreurs), classes manquantes créées avec leur niveau,
  revérification serveur, import atomique, bouton « Annuler l'import ».
- Cloisonnement : tests négatifs sur chaque nouvel objet (classe, élève, état, enseignant d'une autre école).

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

- Pas encore d'appel enregistré (lot 3). La démo de la page d'accueil n'enregistre rien.
- « Annuler l'import » ne sera plus possible une fois des appels enregistrés pour ces élèves (règle à appliquer au lot 3).
- Localisation des données D1 : à vérifier dans le tableau de bord Cloudflare (juridiction UE souhaitée).
