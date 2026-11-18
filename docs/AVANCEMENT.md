# Avancement par lots

| Lot | Contenu | État |
|---|---|---|
| 0 / Initialisation | Dépôt, conventions, design tokens, CI, déploiement, règles métier pures + tests, plan de schéma | **Fait** (voir ci-dessous) |
| 1 / Accès + écoles | Admin et Direction : invitations, authentification, rôles, cloisonnement et tests | **Fait** (voir ci-dessous) |
| 2 / Classes + élèves | Niveaux, jours, créneaux, états, import CSV/XLSX | **Fait** (voir ci-dessous) |
| 3 / Appel enseignant | Grille, compteurs, validation, persistance, corrections | **Fait** (voir ci-dessous) |
| 4 / Direction | Dashboard temps réel, historique, messages, rappels | **Fait** (voir ci-dessous) |
| 5 / Répartitions | Algorithme, édition, affectations, synchronisation | **Fait** (voir ci-dessous) |
| 6 / Finalisation | Exports, PWA, audit sécurité, a11y | **Fait** (voir ci-dessous) |
| 7 / Pilote | Scénarios E2E, docs, déploiement de test | **Fait** (voir ci-dessous) |
| Dossier RGPD | Dossier de validation pour responsable de traitement, DPD, DASEN ; page « Confidentialité » | **Fait** (projet à valider, voir ci-dessous) |

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
  (classes attendues, validés, en attente, en retard, présents, absents, répartitions actives — branché au lot 5) ;
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

## Lot 5 — vérifié

Tests : `tests/distributions.test.ts` (20 tests API sur D1 locale, scénario de recette CE1 A → CP A / CE1 B / CE2 A,
tests négatifs inter-écoles), `src/domain/repartition.test.ts` (9 tests de règles), soit 134 tests au total ; parcours
navigateur (31 contrôles, ordinateur 1280 px et téléphone 360 px sans défilement horizontal) : P6 (24 élèves répartis
entre 3 classes, 30/30/30, aucun oubli ni doublon), P7 (section « Élèves accueillis », présences remontées à CE1 A),
P8 (modification propagée, historisée, classes informées, pas de double présence), historique filtré, annulation, impression.

- « Répartir une classe » (Direction, bouton sur le tableau de bord et onglet « Répartitions ») : classe d’origine,
  dates (14 jours au plus), journée / matin / après-midi ; classes d’accueil cochées avec leur effectif habituel sur la
  période et une capacité facultative ; « Proposer une répartition équilibrée » (algorithme du lot 0, sur l’effectif
  projeté) ; correction élève par élève par un menu accessible au clavier (y compris « Absent connu, ne pas répartir ») ;
  les choix manuels sont conservés lors d’un nouvel équilibrage ; aperçu final par classe ; validation bloquée tant
  qu’un élève n’est pas placé ou qu’une capacité est dépassée (revérifié par le serveur).
- Affectations par élève et demi-journée (`distribution_assignments`) : **index unique « une seule affectation active
  par élève et créneau »** en base, toutes répartitions confondues ; la classe d’inscription ne change pas ; une
  affectation remplacée est terminée (datée), jamais effacée. Pas de chaîne : une classe répartie n’accueille pas,
  une classe d’accueil n’est pas elle-même répartie. Création idempotente (double tap), modification concurrente refusée.
- Appel des classes d’accueil : les élèves accueillis apparaissent automatiquement, dans une section délimitée
  « Élèves accueillis · CE1 A » (une par classe d’origine), compteur « / 30 dont 10 accueillis ». L’état saisi est
  enregistré avec la classe d’origine (`attendance_entries.hosted_from_class_id`).
- Classe d’origine : ses élèves répartis sont retirés de son appel (pas de double présence) ; si tous le sont, l’écran
  affiche « Classe répartie : pas d’appel à faire ici » et le registre « Vos élèves répartis » (classe d’accueil + état
  remonté, ou « appel pas encore fait »).
- Tableau de bord : indicateur « Répartitions actives », classe d’origine marquée « Répartie · 18/24 confirmés » (au lieu
  de « en retard »), détail « Appels des élèves répartis : CP A 10/10 · CE1 B 0/6 · CE2 A 0/8 », classes d’accueil
  « dont 10 élèves accueillis (CE1 A) », bouton « Voir la répartition ». Couverture complète quand chaque élève a un
  état dans un appel validé de sa classe d’accueil ou était connu absent.
- Modification / annulation : propagées immédiatement aux appels ; un élève déjà compté dans un appel validé (ou une
  demi-journée passée) garde son affectation pour cette demi-journée — le changement s’applique au créneau suivant,
  et la direction en est avertie. Si un élève est ajouté à une classe d’accueil après sa validation, l’appel s’ouvre en
  correction avec « Nouvel élève accueilli ». Historique des versions (qui, quand, élèves déplacés).
- Notifications internes (`distribution_notices`) aux classes concernées (origine et accueil) à chaque création,
  modification ou annulation : accueil enseignant et écran d’appel, jamais en fenêtre bloquante.
- Détail d’une répartition : présences remontées par demi-journée, « Où sont les élèves », feuilles de répartition
  imprimables par classe (prénom, nom, classe d’origine uniquement), « Modifier », « Annuler la répartition »,
  « Refaire le … » (prochain jour d’école, reprend la dernière répartition), « Reprendre la dernière répartition » dans
  l’éditeur.
- Historique : filtre « Seulement les répartitions », état « Répartie » avec sa couverture, badge « +10 accueillis ».
- Coût D1 : au plus ~25 requêtes par appel d’API (création d’une répartition ~16, écran d’appel ~22), insertions
  en masse par `json_each`, écritures en un seul lot transactionnel.

### Choix faits en autonomie (lot 5)

- Unité de « créneau » d’une répartition = demi-journée (matin / après-midi) ; un élève garde la même classe d’accueil
  sur toute la période ; durée maximale 14 jours.
- « Exclusions manuelles » de l’algorithme : remplacées par les choix manuels épinglés (conservés au rééquilibrage)
  et l’option « Absent connu ». Le glisser-déposer (facultatif au cahier des charges) n’est pas proposé : le menu
  par élève est plus sûr au clavier et sur téléphone.
- L’effectif habituel d’une classe d’accueil est le maximum sur la période (élèves déjà accueillis ailleurs compris).
- Un élève « absent connu » compte comme confirmé (absence résolue) dans la couverture, sans ligne d’appel.
- La création et la gestion des répartitions sont réservées à la direction.

## Lot 6 — vérifié

Tests : `tests/exports.test.ts` (12 tests : CSV, XLSX relu par un tableur, page imprimable, journal d’audit, refus enseignant /
autre école / visiteur, en-têtes de sécurité, neutralisation des formules), soit 146 tests au total ; parcours navigateur sur
`wrangler dev` (83 contrôles) : en-têtes, PWA, exports téléchargés et rouverts par openpyxl et LibreOffice, PDF généré par
l’impression, appel hors ligne puis reprise sans doublon, appel au clavier seul, audit axe-core WCAG 2.1 AA sur 16 écrans,
largeurs 320 et 360 px sans défilement horizontal, aucune violation CSP.

- **Exports de l’historique** (direction uniquement, onglet Historique → « Exporter cette liste », mêmes filtres que la liste) :
  - « Imprimer ou PDF » : registre prêt à imprimer (A4) avec école, période, filtres, légende des statuts et des états,
    tableau par jour (classe, créneau, statut, effectifs, validation) et, au choix, le détail par élève ;
    le PDF s’obtient par « Enregistrer au format PDF » dans la fenêtre d’impression.
  - « Tableur Excel (.xlsx) » : feuilles « Appels », « Détail par élève » (si demandé) et « Légende ».
  - « Fichier CSV » : séparateur `;` et BOM UTF-8 (s’ouvre directement dans Excel en français).
  - Par défaut **sans nom d’élève** ; le détail nominatif est une case à cocher. Cellules toujours écrites en texte
    (formules neutralisées, ex. `=HYPERLINK(...)` dans un prénom). Fichiers générés à la volée, jamais stockés,
    `Cache-Control: no-store`, **jamais de lien public** (session obligatoire), chaque export inscrit au journal d’audit
    (`history.exported` : format, période, filtres, nombre de lignes). 62 jours max, 25 000 lignes de détail max.
- **PWA installable** : `manifest.webmanifest` (nom, couleurs, mode autonome), icônes 192/512 + icône « maskable » + icône
  Apple, écran de lancement (logo affiché avant le chargement), balises iOS.
- **Service worker prudent** (`public/sw.js`) : ne met en cache que la coquille de l’application (HTML, scripts, styles,
  icônes) ; **aucune réponse `/api/`** n’est jamais mise en cache. Sans réseau à l’ouverture : écran « Pas de connexion »,
  la session est revérifiée automatiquement au retour du réseau.
- **Brouillon hors ligne (§10, P10)** : pendant un appel, si le réseau tombe au moment de valider, le bandeau affiche
  « Enregistré sur cet appareil, non transmis » ; l’envoi repart seul au retour du réseau (et toutes les 20 s), avec la
  **même clé d’idempotence** : impossible de créer un doublon, même si la première réponse s’était perdue. « Synchronisé »
  n’apparaît qu’après la réponse du serveur. Conflit (un autre appareil a validé entre-temps) : la saisie locale n’est pas
  appliquée, la version enregistrée est affichée avec un message explicite. Le brouillon ne contient que des identifiants
  (aucun nom), expire au bout de 12 h et est effacé après envoi et à la déconnexion.
- **Audit de sécurité** :
  - En-têtes des pages (`public/_headers`) : CSP stricte (`script-src 'self'`, `style-src 'self'`, aucun script en ligne,
    `frame-ancestors 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
    `Permissions-Policy` (caméra, micro, géolocalisation… désactivés), `Cross-Origin-Opener-Policy`.
  - Réponses d’API : CSP `default-src 'none'`, `no-store`, `DENY`, `nosniff`, HSTS (`withApiHeaders`).
  - Contrôles d’accès relus route par route : chaque route d’école passe par `requireSchoolRole` (directement ou via
    `direction` / `requireCallAccess` / `absenceAccess`) ; tests négatifs inter-écoles pour l’export.
  - Journal d’audit complété : connexions réussies (`auth.login`, sans IP) et exports ; validations, corrections et actions
    sensibles étaient déjà tracées. Les échecs de connexion restent limités (5 / 15 min).
  - Données minimisées : exports sans nom par défaut, brouillon sans nom, cache hors ligne sans données, aucun outil
    d’analyse ni ressource externe (polices servies par l’application).
- **Audit d’accessibilité** (axe-core, WCAG 2.1 A/AA, 16 écrans) : corrigé — contraste du bleu principal (texte blanc 4,2:1 →
  5,3:1, voir écarts), vert foncé des bandeaux, compteur d’onglet du tableau de bord, noms accessibles des vignettes élèves
  et des lignes d’historique (le texte visible fait partie du nom lu), zone de tableau défilante accessible au clavier,
  débordement de la liste des classes à 320 px. Appel complet au clavier vérifié (Tab jusqu’à l’élève, Entrée pour changer
  l’état, focus visible, Tab jusqu’à « Valider l’appel », Entrée).
- `README.md` : section « Limitations connues ».

### Choix faits en autonomie (lot 6)

- **PDF** = impression du navigateur d’une page dédiée plutôt qu’un générateur PDF côté serveur : aucune dépendance,
  accents et mise en page fiables, aucun fichier stocké.
- « Utilisateurs habilités » pour les exports = direction de l’école (les enseignants n’ont pas l’historique global).
- **Mode hors ligne nominatif non activé** (dépendance de conformité du §10) : aucune liste d’élèves n’est gardée sur
  l’appareil ; on ne peut donc pas *ouvrir* un appel sans réseau. Seul un appel déjà affiché peut être terminé hors ligne
  (brouillon d’identifiants). L’activer demandera une option par école, un stockage chiffré à durée limitée et la validation
  du responsable de traitement (appareils partagés).
- Couleur principale assombrie de #536dff à #425cec (contraste AA) : la planche reste reconnaissable, l’accessibilité prime (§11.3).
- Pas d’image de démarrage iOS dédiée (une dizaine de tailles) : l’écran de lancement HTML s’affiche à la place.

## Lot 7 — vérifié

Tests : `tests/demo.test.ts` (10 tests : données de démonstration, réservé au superadmin, une seule école de démo,
comptes fonctionnels, cloisonnement inter-écoles, suppression réservée aux écoles de démo, recréation), tests du choix
d’appel à ouvrir (`src/domain/domain.test.ts`), soit **160 tests** ; parcours E2E `npm run e2e` (`e2e/parcours.mjs`) :
**75/75 contrôles** sur `wrangler dev` + D1 locale jetable, rapport et captures dans `e2e/captures/` (non versionnés).

- **Scénarios E2E P1 à P12 versionnés et rejouables** (`e2e/`, `npm run e2e`), trois profils fictifs : Marc, enseignant
  pressé (Pixel 7), Nadia, directrice (ordinateur 1280 px puis 320/360/768 px), Julie, remplaçante (tablette 820 px,
  accès 10 jours), plus l’admin et la direction d’une seconde école. P1 invitation à usage unique ; P2 import de 25
  élèves avec erreurs détectées puis fichier corrigé, classes créées par import ; P3 jours ouverts, deux appels par jour
  avec heure limite, présence par demi-journée ; P4 2 taps + Valider, retour serveur ; P5 tableau de bord mis à jour
  sans recharger ; P6 CE1 A (24) → CP A / CE1 B / CE2 A = 30/30/30 ; P7 section « Élèves accueillis », registre
  remonté à CE1 A ; P8 modification propagée et historisée, pas de double présence ; P9 correction avec ancienne /
  nouvelle valeur ; P10 hors ligne « non transmis » puis une seule version ; P11 12 routes refusées entre écoles,
  enseignant limité, révocation immédiate ; P12 13 écrans à 320/360/768/1280 px sans défilement horizontal, axe-core
  sans violation, zones tactiles ≥ 44 px, iPhone 13 / iPhone SE / Pixel 7, appel au clavier seul. Plus : persistance
  après redémarrage du serveur, création de l’école de démonstration.
- **Corrections d’ergonomie trouvées par ces parcours** :
  - L’enseignant qui a un appel le matin et un l’après-midi arrivait sur une liste : l’appel de la demi-journée en
    cours s’ouvre maintenant directement (`callToOpen`).
  - « Relancer » proposé pour une classe sans enseignant (personne à relancer) → remplacé par « Répartir » (ouvre
    « Répartir une classe » prérempli : classe, date, créneau).
  - Dates tronquées à 320 px (Répartir, Historique, Messages) → champs en une colonne sous 400 px ; « Après-midi »
    coupé sur deux lignes dans le choix des créneaux.
  - Zones tactiles de 40 px (niveaux, jours, demi-journée, catégories d’état, retirer un enseignant, logo) → 44 px.
  - Bandeau rouge « appels non faits » : contraste insuffisant → rouge texte assombri (#ad2f2f).
- **École de démonstration rejouable** (migration `0006_demo` : `schools.is_demo`) : bouton superadmin « Créer /
  Recréer l’école de démonstration » ou `npm run demo` (`scripts/demo.mjs`). Une école fictive « des Tilleuls » :
  7 classes (dont la recette CE1 A 24 → CP A 20 / CE1 B 24 / CE2 A 22), 160 élèves inventés (prénoms + noms de
  plantes), 8 jours d’historique validé, un message, une absence prévue, une direction, deux enseignants et une
  remplaçante (30 jours). Identifiants affichés **une seule fois** (jamais dans le dépôt). Une seule école de démo à
  la fois ; « Supprimer » efface toutes ses données et ses comptes (réservé aux écoles `is_demo = 1`, journal d’audit
  conservé). Coût : ~20 requêtes D1 (json_each), un seul calcul PBKDF2.
- **Documentation** : `docs/GUIDE-UTILISATEUR.md` (Enseignant, Direction, Admin), `docs/DEPLOIEMENT.md` (Workers + D1,
  secret `ADMIN_SETUP_CODE`, quotas, sauvegarde), `.dev.vars.example` (sans secret), `e2e/README.md`.

### Choix faits en autonomie (lot 7)

- Démonstration créée **dans l’application** (bouton superadmin) plutôt que par un script à lancer : l’utilisateur peut
  la générer lui-même sur le site déployé sans outil de développement. Le script `npm run demo` appelle la même API.
- Comptes de démonstration : **un mot de passe commun** (un seul hachage, temps de calcul limité des Workers) ; acceptable
  pour des comptes fictifs, jamais pour de vrais comptes.
- École de démonstration ouverte du lundi au samedi (dimanche fermé) pour pouvoir l’essayer n’importe quel jour.
- E2E : script Playwright autonome (pas de lanceur de tests supplémentaire) ; l’appel de Marc porte sur la demi-journée
  en cours et la répartition sur l’autre, pour rejouer le scénario à toute heure (pas le dimanche).

## Dossier de validation RGPD / institutionnelle — rédigé (à valider)

Dossier `docs/rgpd/` (11 fichiers, Markdown) établi **d’après le code réel** (migrations 0001 à 0006, routes, stockage
sur l’appareil) : registre des traitements (finalités, mission d’intérêt public, personnes, données, destinataires,
durées proposées), inventaire table par table, sous-traitants et hébergement (Cloudflare : DPA, juridiction UE de D1
choisie seulement à la création, Cloud Act, pas de SecNumCloud — signalés honnêtement), mesures de sécurité en place
et leurs limites, droits des personnes et procédure, procédure d’incident (72 h), réversibilité (export puis purge),
pré-AIPD (12 risques), notes d’information familles / personnels, et **liste de 21 décisions** du responsable de
traitement avec valeurs par défaut prudentes (`10-decisions-responsable.md`). Aucune conformité n’est affirmée ;
les points juridiques incertains sont marqués « ⚖️ À valider par le DPD ».

- **Page « Confidentialité »** (`/confidentialite`, sans connexion) : ce qui est enregistré, qui voit quoi, ce qui
  reste sur l’appareil, hébergement, droits ; bandeau « pas encore validé ». Lien « Confidentialité » en bas de
  l’accueil, de la connexion / invitation et de tous les écrans à en-tête. Tests : `src/pages/Privacy.test.tsx`
  (2 tests, soit **162 tests**) ; ajoutée au parcours P12 (320/360/768/1280 px, axe-core sans violation, zones ≥ 44 px) :
  `npm run e2e` **75/75**.
- Constats faits en rédigeant (non corrigés, décisions attendues) : les tentatives de connexion échouées gardent
  l’adresse IP sans limite de durée ; sessions expirées et invitations jamais effacées ; journaux d’exécution
  Cloudflare activés ; aucune purge automatique ; pas d’export complet ni de purge d’une vraie école dans l’application.
- Correction : `docs/DEPLOIEMENT.md` indiquait 30 jours de « Time Travel » D1 ; c’est 7 jours en offre gratuite
  (30 en payante, à revérifier). Commande `--jurisdiction=eu` documentée.
- E2E : le contrôle « Démonstration » attendait « CE1 A » sur le tableau de bord, absent l’après-midi (seule PS-MS a un
  appel l’après-midi) → attend désormais CM1-CM2 ou PS-MS (test indépendant de l’heure).

### Choix faits en autonomie (dossier RGPD)

- Dossier en Markdown dans le dépôt (versionné avec le code qu’il décrit) plutôt qu’un document externe.
- Responsable de traitement présenté comme l’autorité académique (IA-DASEN) et non le directeur d’école, conformément
  au garde-fou du §14 — à confirmer par le DPD.
- Durées proposées, prudentes : appels = année scolaire + 1 an ; audit = 1 an ; tentatives de connexion = 24 h ;
  sessions / invitations = 3 mois ; comptes = 1 an après la fin d’accès ; session sur appareil = 7 jours (au lieu de 30).
- La page « Confidentialité » ne donne ni durée ni localisation tant qu’elles ne sont pas décidées (« seront indiquées ici »).

## Definition of Done (§18) — vérification point par point

| Point | État | Preuve |
|---|---|---|
| La Direction peut inviter une école puis créer ses classes et importer sa liste sans aide technique | ✅ | E2E P1–P2 (invitation, classes, import CSV avec erreurs corrigées), guide utilisateur |
| Un enseignant connecté arrive directement au bon appel et le valide en quelques secondes | ✅ | E2E P4 : arrivée directe sur l’appel de la demi-journée, 2 taps + Valider, retour serveur |
| La Direction constate la validation et les effectifs presque immédiatement | ✅ | E2E P5 : carte « Validé », 23 présents / 2 absents, sans recharger (≤ 30 s) |
| Une classe entière peut être répartie et les élèves apparaissent sur les appels d’accueil | ✅ | E2E P6–P8, tests `distributions.test.ts` |
| Aucune donnée ne traverse une frontière d’établissement ; comptes révocables | ✅ | E2E P11 (12 routes, UI), tests négatifs dans chaque fichier `tests/*`, révocation immédiate |
| Erreurs réseau, modifications et appels hors ligne sans perte ni doublon | ✅ | E2E P10, tests d’idempotence (`calls.test.ts`), persistance après redémarrage |
| Planche graphique respectée, lisibilité et accessibilité prioritaires | ✅ | Captures 320 → 1280 px, axe-core WCAG 2.1 AA sans violation ; couleurs assombries pour le contraste (écart assumé) |
| Repo : README, schéma, migrations, tests, données fictives, guide utilisateur, guide de déploiement | ✅ | `README.md`, `docs/SCHEMA.md`, `worker/migrations/`, `tests/`, `e2e/`, `worker/lib/demo.ts`, `docs/GUIDE-UTILISATEUR.md`, `docs/DEPLOIEMENT.md` |
| Usage réel conditionné à la validation institutionnelle et RGPD, sans exception | ⏳ hors code | Avertissement README + guides ; dossier `docs/rgpd/` prêt ; validation DASEN / DPD à obtenir (voir écarts ouverts) |

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
- Mode hors ligne nominatif (consulter la liste d’élèves sans réseau) : volontairement désactivé, voir lot 6 et README.
- Notifications push : non faites (facultatives au §10) ; notifications internes seulement.
- Politique de conservation et purge des archives (§9) : durées proposées (`docs/rgpd/10-decisions-responsable.md`),
  purge automatique à coder une fois les durées validées (inclut la purge des tentatives de connexion avec IP).
- Localisation des données D1 : la juridiction UE ne se choisit qu’à la création → recréer la base avec
  `--jurisdiction=eu` avant toute donnée réelle ; journaux d’exécution Cloudflare à désactiver ou réduire.
- Réversibilité : export complet par école et purge d’une vraie école seulement par procédure manuelle
  (`docs/rgpd/07-reversibilite.md`).
- Lecteurs d’écran réels (VoiceOver, TalkBack, NVDA) et tests avec de vrais utilisateurs : à faire pendant le pilote.
- Validation RGPD / institutionnelle (responsable de traitement, DPD académique, DASEN) : dossier prêt (`docs/rgpd/`),
  à présenter ; AIPD à conduire avec le DPD ; convention de sous-traitance à signer. Préalable obligatoire à toute
  école réelle.
