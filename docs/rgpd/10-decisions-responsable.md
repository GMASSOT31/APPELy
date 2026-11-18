# 10. Décisions qui reviennent au responsable de traitement

> Ces choix ne sont **pas** techniques : ils engagent l’institution. Pour chacun, une **valeur par défaut prudente**
> est proposée ; l’application et la documentation seront alignées sur la décision prise. ⚖️ = à valider par le DPD.

## 10.1 Gouvernance

| # | Décision | Valeur par défaut proposée | État actuel dans Appely |
|---|---|---|---|
| D1 | Qui est le responsable de traitement ? | L’autorité académique (IA-DASEN pour le recteur) pour les écoles publiques, **pas** le directeur d’école ⚖️ | — |
| D2 | Contrat de sous-traitance avec l’exploitant d’Appely | Convention art. 28 signée **avant** toute donnée réelle (sécurité, confidentialité, assistance, incident sous 24 h, sous-traitant ultérieur Cloudflare, réversibilité, audit) | Aucune |
| D3 | AIPD | Oui, avant usage réel, avec le DPD (base : [document 8](08-analyse-risques.md)) | Pré-analyse faite |
| D4 | Périmètre du pilote | 1 à 3 écoles volontaires, une période (ex. une période scolaire), bilan avant extension | Démonstration seulement |

## 10.2 Hébergement

| # | Décision | Valeur par défaut proposée | État actuel |
|---|---|---|---|
| D5 | Hébergeur américain (Cloudflare) acceptable ? | Accepté **seulement** si le DPD l’admet au vu des clauses types et du risque Cloud Act ; sinon portage vers un hébergeur européen | En attente |
| D6 | Juridiction de la base D1 | **Union européenne obligatoire** : nouvelle base créée avec `--jurisdiction=eu` avant toute donnée réelle | Base actuelle : juridiction non garantie (démonstration uniquement) |
| D7 | Journaux techniques Cloudflare | **Désactivés** (ou réduits au minimum) en production réelle | Activés |

## 10.3 Durées de conservation (§9 du cahier des charges)

| # | Données | Valeur par défaut proposée | État actuel |
|---|---|---|---|
| D8 | Appels nominatifs, corrections, répartitions, absences prévues | **Année scolaire en cours + 1 an**, puis suppression — sauf règle d’archivage différente fixée avec les archives départementales ⚖️ | Aucune purge |
| D9 | Élèves sortis | Supprimés en même temps que leurs appels (D8) | Gardés |
| D10 | Messages de la direction, relances | Fin de l’année scolaire + 1 an (ou plus court : 3 mois après la fin d’affichage) | Gardés |
| D11 | Comptes des personnels | Accès retiré en fin d’affectation (déjà possible) ; compte et rattachements supprimés **1 an** après | Gardés |
| D12 | Journal d’audit | **1 an** glissant | Gardé sans limite |
| D13 | Tentatives de connexion (avec IP) | **24 heures** | Lignes IP jamais effacées |
| D14 | Sessions expirées, invitations utilisées ou expirées | **3 mois** | Gardées |
| D15 | Qui peut demander une purge anticipée ? | Le responsable de traitement, par écrit, exécutée par l’exploitant avec attestation | Procédure manuelle ([document 7](07-reversibilite.md)) |

## 10.4 Fonctionnalités sensibles

| # | Décision | Valeur par défaut proposée | État actuel |
|---|---|---|---|
| D16 | **Mode hors ligne nominatif** (liste d’élèves gardée sur l’appareil) | **Désactivé** (cahier des charges §10 : une V1 en ligne plutôt qu’une fausse promesse hors ligne) | Désactivé |
| D17 | Noms de famille des élèves | **Facultatifs** ; prénom + initiale suffit le plus souvent | Facultatifs |
| D18 | Exports nominatifs | Réservés à la direction, **sans nom par défaut** | Ainsi |
| D19 | Durée de session sur un appareil | **7 jours** (au lieu de 30) pour limiter le risque des tablettes partagées ⚖️ | 30 jours |
| D20 | Double authentification pour les directions | Souhaitable ; à arbitrer (sans e-mail ni SMS : application d’authentification) | Absente |
| D21 | Superadmin : accès aux données nominatives | **Jamais** par défaut ; accès technique exceptionnel uniquement sur demande écrite et tracé | Aucun accès dans l’application |

## 10.5 Ce que l’équipe technique fera une fois les décisions prises

1. Purge automatique quotidienne selon D8 à D14 (tâche planifiée Cloudflare, gratuite), avec tests et journal.
2. Bascule vers une base D1 en juridiction UE (D6) et réglage des journaux (D7).
3. Durée de session (D19), et le cas échéant double authentification (D20).
4. Mise à jour de la page « Confidentialité » et des notes d’information avec les valeurs retenues.
