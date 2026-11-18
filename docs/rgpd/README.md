# Dossier de validation RGPD et institutionnelle — Appely

> **Statut : projet de dossier, non validé.** Ces documents décrivent Appely tel qu’il est réellement codé
> (novembre 2026, après le lot 7) pour permettre au responsable de traitement, au délégué à la protection des
> données (DPD) académique et au DASEN de décider. **Ils n’affirment aucune conformité** : chaque point marqué
> « ⚖️ À valider par le DPD » est une proposition prudente, pas une décision.
>
> Tant que ce dossier n’est pas validé : **aucune donnée réelle d’élève ni de personnel** dans Appely
> (école de démonstration uniquement, données fictives).

## Contenu

| # | Document | Pour qui | À quoi il sert |
|---|---|---|---|
| 1 | [Fiche de registre des traitements](01-registre-traitement.md) | Responsable de traitement, DPD | Inscrire le traitement au registre (art. 30 RGPD) |
| 2 | [Inventaire des données stockées](02-inventaire-donnees.md) | DPD, équipe technique | Ce qui est réellement enregistré, table par table, et sur l’appareil |
| 3 | [Sous-traitants et hébergement](03-sous-traitants-hebergement.md) | DPD | Cloudflare, localisation, transferts hors UE, points ouverts |
| 4 | [Mesures de sécurité en place](04-mesures-securite.md) | DPD, RSSI académique | Mesures vérifiées par des tests, et limites connues |
| 5 | [Droits des personnes et procédure](05-droits-des-personnes.md) | Direction, DPD | Comment répondre à une demande d’accès, de rectification… |
| 6 | [Procédure d’incident](06-procedure-incident.md) | Direction, éditeur, DPD | Que faire en cas de fuite ou de perte de données (72 h) |
| 7 | [Réversibilité : export complet puis purge](07-reversibilite.md) | Responsable de traitement | Récupérer les données et les effacer en fin de contrat |
| 8 | [Analyse de risques (pré-AIPD)](08-analyse-risques.md) | DPD | Base de travail pour l’analyse d’impact |
| 9 | [Notes d’information (familles, personnels)](09-note-information.md) | Direction | Modèles à compléter et à diffuser |
| 10 | [Décisions du responsable de traitement](10-decisions-responsable.md) | Responsable de traitement, DPD, DASEN | Liste des choix à faire, avec valeurs par défaut prudentes |

Une page « Confidentialité » est aussi disponible dans l’application (`/confidentialite`, lien en bas des écrans) :
elle résume en langage simple ce qui est enregistré et renvoie vers la direction de l’école pour exercer ses droits.

## Ordre de lecture conseillé

1. [Décisions du responsable de traitement](10-decisions-responsable.md) (deux pages, l’essentiel à trancher).
2. [Analyse de risques](08-analyse-risques.md), puis [hébergement](03-sous-traitants-hebergement.md).
3. Le reste au besoin.

## Ce qu’il faut savoir en une minute

- **Quoi** : l’appel quotidien (présent / absent par demi-journée), les répartitions temporaires d’élèves quand une
  classe n’a pas d’enseignant, les messages de la direction, l’historique des appels.
- **Données d’élèves** : prénom, nom (facultatif), classe, jours de présence attendus, état à chaque appel, absences
  prévues (motif choisi dans une liste courte, jamais médical). **Pas** de date de naissance, d’adresse, de
  responsable légal, de photo, de note, ni de donnée de santé prévue.
- **Données de personnels** : adresse e-mail professionnelle, nom affiché, rôle, mot de passe (haché), journal des
  actions.
- **Hébergement** : Cloudflare (Workers + base D1), société américaine. La localisation de la base dans l’Union
  européenne **n’est pas encore garantie** pour la base actuelle : voir le document 3.
- **Pas** d’outil de mesure d’audience, de publicité, de traceur ni de ressource externe ; un seul cookie, celui de
  la session de connexion.
- **Points ouverts importants** : durées de conservation et purge automatique **non encore codées** ; pas d’export
  complet par école ni de purge d’une vraie école dans l’application (seulement par l’équipe technique) ; hébergeur
  non européen (Cloud Act) à arbitrer par le DPD.

## Références

- RGPD (règlement (UE) 2016/679), notamment art. 5, 6, 13, 28, 30, 32 à 35.
- CNIL — bonnes pratiques des outils numériques dans l’enseignement :
  <https://www.cnil.fr/fr/enseignement-premier-second-degres-bonnes-pratiques-outils-collaboratifs>
- Éducation nationale — données personnelles des élèves :
  <https://www.education.gouv.fr/la-protection-des-eleves-et-de-leurs-donnees-sur-internet-7073>
- Éduscol — protection des données et assistance : <https://eduscol.education.gouv.fr/6231/protection-des-donnees-personnelles-et-assistance>
- Cahier des charges Appely v1.0, §9 (conservation), §10 (hors ligne), §14 (sécurité, RGPD, gouvernance).
