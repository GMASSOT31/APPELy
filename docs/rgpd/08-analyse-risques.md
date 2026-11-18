# 8. Analyse de risques simplifiée (pré-AIPD)

> Base de travail pour l’analyse d’impact (AIPD) à mener avec le DPD, par exemple avec l’outil PIA de la CNIL.
> Gravité et vraisemblance notées de 1 (négligeable) à 4 (maximale), **après** les mesures existantes.

## 8.1 Faut-il une AIPD ? ⚖️

Critères du CEPD réunis : **personnes vulnérables** (élèves mineurs) ; **suivi systématique** (présence à chaque
demi-journée) ; possiblement **grande échelle** si de nombreuses écoles. Deux critères suffisent en général :
**AIPD recommandée avant tout usage réel.**

## 8.2 Ce qui pourrait arriver

| # | Risque | Exemple concret | Mesures existantes | Gravité | Vraisemblance | Mesures complémentaires proposées |
|---|---|---|---|---|---|---|
| R1 | Accès illégitime aux données d’une autre école | Bug de contrôle d’accès | `requireSchoolRole` sur toutes les routes d’école, tests négatifs systématiques, E2E P11 | 3 | 1 | Test d’intrusion externe avant généralisation |
| R2 | Vol du compte d’une direction | Mot de passe réutilisé ou hameçonnage | PBKDF2, 10 caractères mini, 5 essais / 15 min, sessions révocables, journal | 3 | 2 | Double authentification pour les directions ; sessions plus courtes |
| R3 | Appareil partagé ou perdu avec session ouverte | Tablette de classe | Pas de liste d’élèves hors ligne, brouillon sans nom (12 h), retrait d’accès immédiat | 2 | 2 | Consigne « se déconnecter » ; verrouillage des appareils ; durée de session réduite (ex. 7 jours) ⚖️ |
| R4 | Fichier exporté nominatif diffusé | Export Excel envoyé à une liste de diffusion | Sans nom par défaut, direction seulement, pas de lien public, export journalisé | 3 | 2 | Consigne écrite ; durée de conservation des fichiers téléchargés |
| R5 | Conservation excessive | Appels gardés des années | — (aucune purge) | 2 | 4 | **Purge automatique** selon les durées validées |
| R6 | Accès par une autorité étrangère / transfert hors UE | Hébergeur américain | DPA Cloudflare (clauses types) | 3 | 2 | **Base D1 en juridiction UE** ; arbitrage DPD sur l’hébergeur ; alternative européenne |
| R7 | Donnée sensible saisie dans un champ libre | « Absent : hospitalisé », état « Infirmerie » | Motifs d’absence en liste fermée | 3 | 2 | Consigne aux personnels ; limiter les champs libres ; relecture par la direction |
| R8 | Perte de données (panne, erreur) | Suppression accidentelle | Time Travel, export SQL, aucune suppression d’appel dans l’interface, idempotence | 2 | 1 | Sauvegarde exportée régulière chiffrée ; test de restauration périodique |
| R9 | Erreur d’appel aux conséquences sur la sécurité de l’élève | Élève marqué présent alors qu’absent | « À vérifier » visible, compteurs, corrections tracées, tableau de bord direction | 3 | 2 | Procédure de l’école inchangée (le registre ne remplace pas la vigilance) |
| R10 | Remplaçant gardant l’accès | Fin de mission oubliée | Date de fin obligatoire, coupure automatique | 2 | 1 | — |
| R11 | Indisponibilité du service | Panne Cloudflare, quota gratuit dépassé | Quotas surveillés, appel « non transmis » rejoué | 2 | 2 | Procédure papier de secours ; suivi des quotas |
| R12 | Fuite par les journaux techniques | IP et adresses d’API dans les journaux Cloudflare ; IP en base (tentatives) | Pas de nom dans les adresses d’API ; journal de connexion sans IP | 1 | 2 | Désactiver les journaux détaillés ; purge 24 h des tentatives |

## 8.3 Synthèse

- **Risques les plus élevés aujourd’hui** : R5 (conservation sans limite), R6 (hébergeur et localisation), puis R2 et
  R4 (comptes de direction et exports).
- Les trois actions qui réduisent le plus le risque, sans changer l’usage quotidien :
  1. purge automatique selon les durées validées ;
  2. base D1 recréée en juridiction UE + journaux techniques réduits ;
  3. double authentification (ou au moins sessions plus courtes) pour les directions.
- Le **mode hors ligne nominatif** reste désactivé : l’activer ajouterait un risque (R3) que rien ne justifie en V1.
