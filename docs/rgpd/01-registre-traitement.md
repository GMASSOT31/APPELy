# 1. Fiche de registre des traitements (art. 30 RGPD)

> Modèle prérempli. Les champs entre `[crochets]` sont à compléter par le responsable de traitement.
> ⚖️ = proposition à valider par le DPD.

## Identification

| Rubrique | Contenu |
|---|---|
| Nom du traitement | **Appely — appel quotidien des élèves et répartitions temporaires** |
| Date de création de la fiche | `[date]` — version 1 (projet) |
| Responsable de traitement | `[à désigner]` ⚖️ En école publique du premier degré, le directeur d’école n’est en principe **pas** le responsable de traitement : il s’agit de l’autorité académique (IA-DASEN agissant pour le recteur). À confirmer par le DPD académique. |
| Délégué à la protection des données | DPD académique de `[académie]` — `[adresse de contact]` |
| Sous-traitant (éditeur / exploitant d’Appely) | `[nom de la personne ou structure qui exploite Appely]` — un contrat ou une convention de sous-traitance (art. 28) est nécessaire. |
| Sous-traitant ultérieur | Cloudflare, Inc. (hébergement Workers + base D1) — voir [document 3](03-sous-traitants-hebergement.md). |
| Écoles concernées | `[liste des écoles, code UAI]` |

## Finalités

1. **Réaliser et enregistrer l’appel** des élèves à chaque demi-journée (ou créneau défini par l’école) et en
   conserver l’historique, y compris les corrections tracées.
2. **Permettre à la direction de suivre en temps réel** les appels faits ou manquants et l’effectif présent
   (sécurité des élèves, organisation, cantine le cas échéant).
3. **Organiser les répartitions temporaires** d’élèves dans d’autres classes lorsqu’un enseignant est absent, et
   savoir à tout moment où se trouve chaque élève.
4. **Diffuser des messages internes** de la direction aux enseignants (sans messagerie générale).
5. **Gérer les accès** des personnels (invitations, comptes, remplaçants à durée limitée) et **tracer** les actions
   sensibles (journal d’audit).

Hors finalités (interdit) : profilage, statistiques prédictives, IA traitant des données d’élèves, publicité,
communication aux familles par l’application, intégration ONDE (non prévue en V1), toute réutilisation commerciale.

## Base légale ⚖️

- **Mission d’intérêt public** (art. 6.1.e RGPD) : le contrôle de l’assiduité scolaire relève des missions de
  l’école (Code de l’éducation, obligation d’assiduité et tenue d’un registre d’appel — articles précis à citer
  par le DPD, par ex. L.131-8 et R.131-5 et suivants).
- Le traitement **ne repose pas sur le consentement** : les familles et les personnels en sont informés
  ([document 9](09-note-information.md)), mais n’ont pas à l’accepter.
- Aucune donnée sensible (art. 9) n’est prévue. Les motifs d’absence prévue sont une liste fermée sans motif
  médical ; les champs libres (remarque d’appel, message de la direction) doivent rester factuels (consigne
  écrite dans la note aux personnels).

## Personnes concernées

| Catégorie | Nombre estimé |
|---|---|
| Élèves des écoles utilisatrices (mineurs) | `[nombre]` |
| Personnels : directions, enseignants, remplaçants | `[nombre]` |
| Administrateur technique (superadmin) | 1 à 2 personnes |

## Catégories de données (détail : [document 2](02-inventaire-donnees.md))

- **Élèves** : prénom, nom (facultatif), classe, période d’inscription, jours/demi-journées de présence attendus,
  état à chaque appel (Présent, Absent ou états définis par l’école), classe d’accueil lors d’une répartition,
  absences prévues (dates, demi-journées, motif choisi dans une liste fermée), remarques éventuelles sur l’appel.
- **Personnels** : adresse e-mail professionnelle, nom affiché, rôle, dates d’accès, mot de passe **haché**,
  sessions de connexion, actions réalisées (journal d’audit), adresse IP conservée **temporairement** en cas d’échec
  de connexion (limitation des tentatives).
- **Écoles** : nom, code UAI (facultatif), année scolaire, jours d’ouverture, fermetures, classes, créneaux d’appel.

## Destinataires (qui voit quoi)

| Qui | Accès |
|---|---|
| Direction de l’école | Toutes les données de **son** école : classes, élèves, appels, historique, exports, journal des répartitions. |
| Enseignant | Ses classes affectées, et les élèves accueillis chez lui pendant une répartition. Messages qui le concernent. |
| Remplaçant | Comme un enseignant, jusqu’à la date de fin d’accès fixée (coupure automatique). |
| Administrateur technique (superadmin) | Liste des écoles (nom, UAI, état, nombre de comptes). **Pas** les noms d’élèves ni les appels. |
| Hébergeur (Cloudflare) | Accès technique à l’infrastructure, dans le cadre de ses conditions de sous-traitance. |
| Aucun autre | Pas de transmission à des tiers, ni aux familles, ni à d’autres écoles. |

## Durées de conservation ⚖️ (propositions — **non encore appliquées automatiquement**)

Voir [document 10](10-decisions-responsable.md). Résumé des valeurs prudentes proposées :

| Données | Durée proposée |
|---|---|
| Appels nominatifs et corrections | Année scolaire en cours + 1 an, puis suppression (sauf règle d’archivage contraire fixée avec les archives départementales) |
| Élèves sortis de l’école | Supprimés avec leurs appels à l’échéance ci-dessus |
| Absences prévues, répartitions, messages | Fin de l’année scolaire + 1 an |
| Comptes de personnels | Désactivés à la fin de l’accès ; supprimés 1 an après |
| Journal d’audit | 1 an glissant |
| Tentatives de connexion échouées (avec IP) | 24 heures |
| Sessions expirées, invitations utilisées ou expirées | 3 mois |
| Brouillon d’appel sur l’appareil | 12 heures au plus (déjà appliqué), effacé après envoi et à la déconnexion |

## Transferts hors Union européenne ⚖️

Hébergeur américain : voir [document 3](03-sous-traitants-hebergement.md). À la date de ce dossier, la
localisation dans l’UE de la base actuelle **n’est pas garantie** ; une base créée avec la juridiction « UE » est
proposée avant toute donnée réelle. Le risque d’accès par des autorités américaines (Cloud Act) reste à apprécier
par le DPD.

## Mesures de sécurité

Voir [document 4](04-mesures-securite.md).

## Analyse d’impact (AIPD)

Le traitement concerne des **personnes vulnérables (mineurs)** et un **suivi systématique** de leur présence :
au moins deux critères du CEPD sont réunis, une AIPD est donc **probablement obligatoire**. Base de travail :
[document 8](08-analyse-risques.md). ⚖️
