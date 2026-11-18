# 6. Procédure en cas d’incident (violation de données)

Une violation de données, c’est toute perte, divulgation, modification ou accès non autorisé : mot de passe d’une
direction volé, export nominatif envoyé à la mauvaise personne, tablette non verrouillée perdue avec une session
ouverte, faille dans l’application, incident chez Cloudflare…

## 6.1 Qui fait quoi

| Étape | Qui | Délai |
|---|---|---|
| 1. Signaler | Toute personne qui constate l’incident → direction de l’école → exploitant d’Appely `[contact]` et DPD académique `[contact]` | **Immédiatement** |
| 2. Contenir | Exploitant / direction | Dans l’heure si possible |
| 3. Évaluer | Exploitant + DPD | Sous 24 h |
| 4. Notifier la CNIL si un risque existe | Responsable de traitement (conseillé par le DPD) | **72 h maximum** après la découverte (art. 33) |
| 5. Informer les personnes si le risque est élevé | Responsable de traitement | Sans retard (art. 34) |
| 6. Documenter | DPD | Toujours, même sans notification |

L’exploitant d’Appely, comme sous-traitant, prévient le responsable de traitement **dans les meilleurs délais**
(objectif : 24 h) après avoir connaissance d’un incident.

## 6.2 Gestes de confinement disponibles

- **Compte compromis** : la direction retire l’accès ou force la réinitialisation (onglet Équipe) → toutes les
  sessions de ce compte sont coupées, l’ancien mot de passe ne fonctionne plus.
- **Compte de direction compromis** : une autre direction de l’école, ou l’administrateur technique (nouveau lien
  Direction), reprend la main ; l’école peut être **suspendue** par l’administrateur (plus aucun accès).
- **Toutes les sessions** : l’exploitant peut révoquer toutes les sessions en base (`UPDATE sessions SET revoked_at = …`).
- **Faille applicative** : retour à la version précédente du Worker (tableau de bord Cloudflare → Déploiements) ;
  restauration de la base à un instant passé (Time Travel) si des données ont été altérées.
- **Secret exposé** (`ADMIN_SETUP_CODE`) : le remplacer dans Cloudflare (il ne sert plus après l’installation).

## 6.3 Évaluer

S’appuyer sur le **journal d’audit** (`audit_events` : qui a fait quoi et quand, exports compris) et sur les
journaux Cloudflare (courte durée : agir vite). Questions : quelles données (nominatives ? combien d’élèves ?),
quelles écoles, depuis quand, les données ont-elles quitté le système (export, capture) ?

## 6.4 Fiche de suivi (modèle)

```
Date et heure de découverte :
Découvert par :
Nature (perte / divulgation / modification / accès non autorisé) :
Écoles et personnes concernées (nombre d’élèves, de personnels) :
Données concernées :
Mesures de confinement prises (heure) :
Évaluation du risque (faible / risque / risque élevé) et justification :
Notification CNIL (oui/non, date, numéro) :
Information des personnes (oui/non, date, moyen) :
Mesures pour éviter que cela se reproduise :
```
