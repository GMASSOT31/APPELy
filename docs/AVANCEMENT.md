# Avancement par lots

| Lot | Contenu | État |
|---|---|---|
| 0 / Initialisation | Dépôt, conventions, design tokens, CI, déploiement, règles métier pures + tests, plan de schéma | **Fait** (voir ci-dessous) |
| 1 / Accès + écoles | Admin et Direction : invitations, authentification, rôles, cloisonnement et tests | **Fait** (voir ci-dessous) |
| 2 / Classes + élèves | Niveaux, jours, créneaux, états, import CSV/XLSX | **Fait** (voir ci-dessous) |
| 3 / Appel enseignant | Grille, compteurs, validation, persistance, corrections | **Fait** (voir ci-dessous) |
| 4 / Direction | Dashboard temps réel, historique, messages, rappels | **Fait** (voir ci-dessous) |
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

## Lot 3 — vérifié

Tests : `tests/calls.test.ts` (18 tests API sur D1 locale) et parcours navigateur sur téléphone (390 px) :
ouverture directe de l'appel, 2 taps, rechargement de page (brouillon retrouvé), double tap sur « Valider »
(une seule version), correction avec motif, historique, vue Direction.

- Accueil enseignant : appels du jour par classe et créneau, état « à faire » / « validé » ; s'il n'y a qu'un
  appel à faire, il s'ouvre directement.
- Grille d'appel : élèves attendus ce jour-là (emploi du temps, arrivées, départs, fermetures), ordre stable,
  prépositionnés « Présent » mais marqués « à vérifier » jusqu'à la validation, tap = état suivant,
  menu de choix direct au-delà de 2 états, compteurs par état, remarque courte facultative.
- Validation : horodatage serveur, auteur, version ; idempotente (double tap, renvoi réseau) ; une validation
  concurrente depuis un autre appareil est refusée au lieu d'écraser.
- Corrections : nouvelle version auditée (auteur, date, ancien et nouvel état, motif facultatif), historique.
- Brouillon conservé sur l'appareil (rechargement, écran verrouillé) avec mention « pas encore transmis ».
- Cas particuliers : journée sans classe, classe sans élève attendu (pas de validation trompeuse), élève changé
  de classe après l'appel (il reste dans l'appel validé), jour à venir refusé.
- Accès : enseignant ou remplaçant affecté à la classe (accès coupé à la fin du remplacement ou au retrait de
  la classe), direction de l'école ; tests négatifs inter-écoles.
- « Annuler l'import » refusé dès qu'un appel concerne ces élèves.

## Lot 4 — vérifié

Tests : `tests/direction.test.ts` (22 tests API sur D1 locale, dont les tests négatifs inter-écoles),
`src/domain/direction.test.ts` (9 tests de règles), soit 105 tests au total ; parcours navigateur (24 contrôles,
ordinateur 1280 px et téléphone 360 px, sans défilement horizontal) : tableau de bord, relance, message depuis
une classe, absence prévue, appel enseignant avec message + relance + absence prévue, actualisation automatique
(appel validé depuis un autre appareil visible en ~30 s sans recharger), historique filtré, refus pour une autre école.

- Navigation Direction : Aujourd’hui · Classes · Messages · Absences prévues · Historique · Équipe · Paramètres.
  Le tableau de bord est la page d’accueil (les classes sont passées sous `/ecole/:id/classes`).
- Tableau de bord « Aujourd’hui » : onglets Matin / Après-midi / Autres créneaux (le 1er créneau du matin et
  de l’après-midi de chaque classe va dans son onglet, les créneaux supplémentaires dans « Autres ») ; indicateurs
  (classes attendues, validés, en attente, en retard, présents, absents, répartitions actives = 0 jusqu’au lot 5) ;
  liste par niveau : état, heure de validation, enseignant, effectifs, aperçu des absents, absences prévues ;
  boutons « Ouvrir l’appel », « Message », « Relancer ». Alerte rouge dès qu’un appel n’est pas fait après
  l’heure limite (jour passé non fait = en retard).
- Actualisation : sondage toutes les 30 s quand l’onglet est visible, immédiat au retour sur l’onglet ou au
  retour du réseau ; en cas de coupure, les dernières données restent affichées avec la mention « Connexion perdue ».
  Coût : environ 13 requêtes D1 par actualisation (limite gratuite : 50).
- Relance : réservée à la direction, appels du jour non validés ; une relance au plus toutes les 5 minutes par
  appel. L’enseignant la voit sur son accueil et en haut de l’écran d’appel (notification interne, ni e-mail ni push).
- Messages ciblés : toute l’école, un ou plusieurs niveaux (y compris classes à double niveau), ou une sélection
  de classes ; visibles du … au … (inclus) ; « Important » = affiché en premier et en couleur ; retrait possible
  (conservé pour l’audit). Affichés au-dessus de la grille d’appel et sur l’accueil enseignant, jamais en fenêtre
  bloquante, sans accusé de lecture.
- Absences prévues : direction (toutes les classes) ou enseignant / remplaçant affecté à la classe de l’élève ;
  dates, journée / matin / après-midi, motif choisi dans une liste courte (Raison familiale, Rendez-vous, Voyage,
  Activité extérieure, Autre motif) : aucun texte libre, donc aucune information de santé. Sur l’appel, l’élève est
  prépositionné « Absent » avec la mention « absence prévue », mais reste « à vérifier » ; la présence constatée prime.
  Annulation au lieu de suppression.
- Historique : période (62 jours max, 7 derniers jours par défaut), classe, personne ayant validé ou corrigé, état
  (validé, corrigé, non fait) ; les appels « non faits » sont reconstitués à partir des créneaux (jours ouverts,
  au moins un élève attendu). Un clic ouvre le détail de l’appel avec ses corrections.

### Choix faits en autonomie (lot 4)

- « Enseignant habilité » pour les absences prévues = enseignant ou remplaçant actuellement affecté à la classe.
- Filtre « Fait par » de l’historique : n’affiche que des appels faits (un appel non fait n’a pas d’auteur).
- Le bouton « Retour » de l’écran d’appel revient à la page d’origine (accueil, tableau de bord ou historique).
- L’accueil enseignant s’actualise toutes les 60 s (relances, messages) sans rouvrir l’appel automatiquement.

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

- Actualisation par sondage (30 s) plutôt que temps réel par connexion permanente : plus simple et compatible
  avec l’offre gratuite Cloudflare ; suffisant pour le suivi du matin.
- Exports PDF/CSV de l’historique, filtre « répartition » : lots 5 et 6.
- Mode hors ligne complet : lot 6 (aujourd'hui, brouillon local seulement ; la validation exige le réseau).
- Localisation des données D1 : à vérifier dans le tableau de bord Cloudflare (juridiction UE souhaitée).
