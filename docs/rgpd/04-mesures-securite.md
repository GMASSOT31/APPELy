# 4. Mesures de sécurité réellement en place

Chaque mesure ci-dessous existe dans le code et, sauf mention, est vérifiée par des tests automatiques
(160 tests d’API et unitaires sur une vraie base D1 locale) et par les parcours navigateur `npm run e2e` (75 contrôles).
Les **limites connues** sont listées en fin de document.

## 4.1 Cloisonnement des écoles et des rôles

- Toute adresse d’API qui porte un identifiant d’école passe par un contrôle unique, `requireSchoolRole`
  (`worker/lib/auth.ts`) : le compte doit avoir un rattachement **actif** à cette école (non retiré, dans ses dates
  d’accès), avec le bon rôle. C’est l’équivalent, dans le code du serveur, d’une sécurité au niveau des lignes.
- Enseignant : seulement ses classes affectées et les élèves accueillis chez lui ; remplaçant : idem, coupé
  automatiquement à la date de fin.
- Superadmin : métadonnées des écoles (nom, UAI, état, nombre de comptes), **jamais** les noms d’élèves ni les appels.
- **Tests négatifs** dans chaque fichier de tests : une école ne lit ni ne modifie jamais une autre école ; un
  enseignant hors classe est refusé. Parcours E2E P11 : 12 adresses refusées entre écoles, révocation immédiate.

## 4.2 Authentification

- Mots de passe : **PBKDF2-SHA-256, 100 000 itérations, sel aléatoire** ; 10 caractères minimum ; jamais stockés en clair.
- Pas de compte créé par mot de passe partagé : **lien d’invitation unique**, valable 72 h, utilisable une fois,
  stocké sous forme d’empreinte.
- Sessions : jeton aléatoire stocké sous forme d’empreinte, cookie `HttpOnly`, `Secure`, `SameSite=Lax`,
  30 jours, **révocables** (déconnexion, retrait d’accès, réinitialisation forcée qui invalide aussi l’ancien mot de passe).
- Limitation des tentatives : 5 échecs par 15 minutes, par adresse e-mail **et** par adresse IP.
- Création du premier administrateur protégée par un code secret (`ADMIN_SETUP_CODE`, secret Cloudflare jamais
  écrit dans le dépôt), utilisable une seule fois.
- Protection contre les requêtes intersites : toute écriture vérifie que la requête vient du site lui-même.

## 4.3 Protection des échanges et du navigateur

- HTTPS obligatoire (HSTS), en-têtes stricts sur les pages : politique de sécurité du contenu (scripts et styles
  servis par l’application uniquement, **aucune ressource externe**, pas d’intégration dans un autre site),
  `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, caméra / micro / géolocalisation désactivés.
- Réponses d’API : `Cache-Control: no-store`, politique `default-src 'none'`.
- Aucun outil d’audience, aucun pixel, aucune police ou bibliothèque chargée depuis un autre site.

## 4.4 Minimisation

- Élèves : prénom et nom facultatif seulement ; motifs d’absence prévue dans une liste fermée sans motif médical.
- Fichier d’import jamais conservé (seuls des compteurs).
- **Exports sans nom d’élève par défaut** ; détail nominatif sur case à cocher ; fichiers générés à la volée, jamais
  stockés, jamais accessibles par un lien public, réservés à la direction, inscrits au journal d’audit ; cellules
  écrites en texte (formules neutralisées). 62 jours maximum par export.
- **Pas de cache hors ligne nominatif** : le service worker ne garde jamais de réponse d’API ; le brouillon d’un appel
  non transmis ne contient que des identifiants, expire en 12 h, est effacé après envoi et à la déconnexion.
- Journal de connexion sans adresse IP ni description de l’appareil.

## 4.5 Intégrité et traçabilité

- **Journal d’audit** (`audit_events`, ajout seulement) : connexions, invitations, retraits, réinitialisations,
  imports, modifications d’élèves et de classes, validations et corrections d’appel, répartitions, messages,
  absences prévues, exports.
- Corrections d’appel versionnées (auteur, heure serveur, ancien / nouvel état, motif) ; rien n’est réécrit.
- Validation d’appel et répartitions **transactionnelles** avec clé d’idempotence : ni doublon ni perte en cas de
  réseau instable (E2E P10) ; conflit entre deux appareils signalé explicitement.

## 4.6 Disponibilité et sauvegarde

- Restauration à un instant passé par « Time Travel » D1 ; export SQL complet possible et restauration testée en local
  (voir `docs/DEPLOIEMENT.md` §8).
- Migrations de schéma versionnées et appliquées en transaction.

## 4.7 Développement

- Données **strictement fictives** dans le code, les tests et les captures ; école de démonstration fictive.
- Vérifications automatiques à chaque envoi (CI GitHub : lint, types, tests, build).
- Dépendances limitées et mises à jour de sécurité suivies.

## 4.8 Limites connues (à corriger ou à accepter)

| Limite | Risque | Proposition |
|---|---|---|
| Aucune purge automatique (appels, comptes, audit, sessions, invitations, tentatives de connexion avec IP) | Conservation au-delà du nécessaire | Coder une purge selon les durées validées ([document 10](10-decisions-responsable.md)) |
| Pas d’export complet par école ni de suppression d’une vraie école dans l’application | Réversibilité dépendante de l’équipe technique | Procédure manuelle ([document 7](07-reversibilite.md)) ; outil à développer si besoin |
| Localisation UE de la base non garantie ; hébergeur américain | Transfert hors UE / Cloud Act | [Document 3](03-sous-traitants-hebergement.md) |
| Pas de double authentification | Vol de mot de passe d’une direction | Mots de passe longs ; 2FA à étudier pour les directions |
| Session de 30 jours sur l’appareil | Appareil partagé ou perdu | Se déconnecter sur appareil partagé ; retrait d’accès immédiat par la direction ; durée plus courte possible |
| Champs libres (remarque, motif de correction, messages, libellés d’états) | Saisie de données excessives ou sensibles | Consigne écrite aux personnels ; relecture par la direction |
| Pas d’audit de sécurité externe (test d’intrusion) | Failles non détectées | À prévoir avant généralisation |
| Lecteurs d’écran réels non testés | Accessibilité | Pendant le pilote |
