# 2. Inventaire des données réellement stockées

Établi d’après le code (`worker/migrations/0001` à `0006`, routes du Worker, pages de l’application) en
novembre 2026. Légende : 👤 donnée personnelle d’élève · 🧑‍🏫 donnée personnelle de personnel · ⚙️ donnée
d’organisation (pas de personne identifiée).

**Aucune purge automatique n’existe encore** : sauf mention contraire, une ligne reste en base jusqu’à une
suppression manuelle par l’équipe technique. C’est l’écart principal à corriger avant usage réel
(voir [document 10](10-decisions-responsable.md)).

## 2.1 Base de données (Cloudflare D1)

### Écoles et accès (migration 0001, 0002, 0006)

| Table | Contenu | Nature | Remarques |
|---|---|---|---|
| `schools` | nom, identifiant court, code UAI (facultatif), année scolaire, fuseau, état, jours sans classe, marque « démonstration » | ⚙️ | |
| `school_closures` | dates et libellé des fermetures (vacances, pont) | ⚙️ | |
| `users` | adresse e-mail, nom affiché, **empreinte du mot de passe** (PBKDF2, jamais le mot de passe), marque superadmin, date de création | 🧑‍🏫 | Aucune suppression prévue dans l’application (seulement pour l’école de démonstration). |
| `memberships` | rattachement compte ↔ école, rôle, dates de début et de fin d’accès, date de retrait | 🧑‍🏫 | Un remplaçant a toujours une date de fin. Le retrait coupe l’accès immédiatement ; la ligne est gardée (traçabilité). |
| `invitations` | **empreinte** du lien (pas le lien), type (invitation / réinitialisation), e-mail, nom, rôle, auteur, expiration (72 h), utilisation | 🧑‍🏫 | Conservées après usage ou expiration. |
| `sessions` | **empreinte** du jeton de session, compte, création, expiration (30 jours), révocation | 🧑‍🏫 | Les sessions expirées ne sont pas effacées. |
| `login_attempts` | clé `email:<adresse>` ou `ip:<adresse IP>`, date | 🧑‍🏫 | Sert à bloquer après 5 échecs en 15 min. Les lignes « adresse » sont effacées à la connexion réussie ; **les lignes « IP » ne sont jamais effacées** → purge à 24 h proposée. |
| `audit_events` | date (serveur), auteur, école, action (ex. `call.validated`, `history.exported`, `auth.login`), objet (identifiant), détails techniques | 🧑‍🏫 (+ 👤 par identifiant) | Ne contient pas de nom d’élève ni d’adresse IP : seulement des identifiants internes et des paramètres (dates, filtres, nombre de lignes). Conservé sans limite à ce jour. |

### Classes et élèves (migration 0002)

| Table | Contenu | Nature | Remarques |
|---|---|---|---|
| `classes` | nom, niveaux, année scolaire, archivage | ⚙️ | |
| `teacher_class_assignments` | quel compte enseigne dans quelle classe, depuis / jusqu’à quand | 🧑‍🏫 | |
| `students` | **prénom**, **nom (facultatif)**, classe, date d’entrée, date de sortie, import d’origine | 👤 | Pas de date de naissance, d’adresse, de responsable légal, de photo, d’identifiant national (INE). Un élève sorti reste en base (date de sortie). |
| `student_schedules` | présence attendue par demi-journée (ex. « pas le vendredi après-midi »), datée | 👤 | Historique jamais réécrit (une ligne par changement). |
| `call_slots` | créneaux d’appel d’une classe (nom, matin/après-midi, jours, heure limite) | ⚙️ | |
| `attendance_statuses` | états d’appel de l’école (libellé, couleur, catégorie Présent/Absent/Autre) | ⚙️ | ⚠️ Libellé libre : l’école ne doit pas créer d’état révélant la santé (ex. « Infirmerie ») — consigne dans la note aux personnels. |
| `import_jobs` | auteur, date, **nombres** d’élèves et classes créés, annulation | ⚙️ | Le fichier importé (CSV/XLSX) n’est **jamais conservé** : il est lu dans le navigateur, seules les lignes validées sont envoyées. |

### Appels (migration 0003, 0005)

| Table | Contenu | Nature | Remarques |
|---|---|---|---|
| `attendance_calls` | classe, créneau, date, état (validé / corrigé), version, **remarque libre**, qui a validé et quand, clé d’idempotence | 👤 (indirect) 🧑‍🏫 | Une ligne par classe, créneau et date. |
| `attendance_entries` | pour chaque élève : état à cet appel, classe d’origine si l’élève est accueilli | 👤 | Cœur du registre d’appel. |
| `attendance_revisions` | chaque version : auteur, heure serveur, remarque, **motif de correction (libre)**, changements (élève, ancien et nouvel état) | 👤 🧑‍🏫 | Corrections tracées, jamais effacées. |

### Direction (migration 0004)

| Table | Contenu | Nature | Remarques |
|---|---|---|---|
| `direction_messages` | texte du message (**libre**), cible (école / niveaux / classes), priorité, période, auteur, archivage | 🧑‍🏫 (+ 👤 si un nom est écrit) | Consigne : ne pas citer d’élève par son nom ni de motif personnel. |
| `call_reminders` | relance d’un appel non fait : classe, créneau, date, auteur, heure | 🧑‍🏫 | |
| `planned_absences` | élève, dates, demi-journées, **motif choisi dans une liste fermée** (Raison familiale, Rendez-vous, Voyage, Activité extérieure, Autre motif), auteur, annulation | 👤 | Aucun champ libre, aucun motif médical. Annulation au lieu de suppression. |

### Répartitions (migration 0005)

| Table | Contenu | Nature | Remarques |
|---|---|---|---|
| `distribution_plans` | classe d’origine, période, classes d’accueil et capacités, état, versions, auteurs | ⚙️ 🧑‍🏫 | |
| `distribution_assignments` | pour chaque élève et demi-journée : classe d’accueil (ou « absent connu ») | 👤 | Jamais effacée : terminée (date de fin) en cas de modification. |
| `distribution_changes` | historique des versions du plan (élèves déplacés, par identifiant) | 👤 (indirect) 🧑‍🏫 | |
| `distribution_notices` | notification interne générée (« CE1 A répartie : 8 élèves accueillis… ») | ⚙️ | Texte généré par l’application, sans nom d’élève. |

## 2.2 Sur l’appareil de l’utilisateur

| Où | Quoi | Durée |
|---|---|---|
| Cookie `appely_session` | jeton de session (HttpOnly, Secure, SameSite=Lax) — **seul cookie** | 30 jours, ou jusqu’à la déconnexion / révocation |
| `localStorage` « dernier compte » | adresse e-mail du dernier compte connecté (pré-remplissage) | jusqu’à effacement par l’utilisateur |
| `localStorage` brouillon d’appel | **identifiants** d’élèves et d’états (aucun nom) pendant un appel non transmis | 12 h max ; effacé après envoi et à la déconnexion |
| `sessionStorage` | marqueur « appel du jour déjà ouvert automatiquement » | fermeture de l’onglet |
| Cache du service worker | coquille de l’application (pages, scripts, styles, icônes) | jusqu’à la version suivante — **jamais de réponse d’API, donc aucune donnée d’élève** |
| Fichiers exportés (PDF, XLSX, CSV) | historique des appels, **sans nom par défaut** ; avec noms si la direction coche la case | sous la responsabilité de la direction qui télécharge (voir note aux personnels) |

**Mode hors ligne nominatif** (garder la liste des élèves sur l’appareil) : **non activé**.

## 2.3 Chez l’hébergeur, hors base

| Quoi | Contenu | Remarques |
|---|---|---|
| Journaux d’exécution Cloudflare (`observability` activé dans `wrangler.jsonc`) | requêtes reçues (adresse, méthode, code de réponse, métadonnées techniques dont pays / IP possibles), erreurs inattendues | Durée courte fixée par Cloudflare (quelques jours). Les adresses d’API contiennent des identifiants, pas de noms. ⚖️ Proposition : désactiver les journaux détaillés avant usage réel ou limiter leur contenu. |
| Sauvegardes « Time Travel » de D1 | état de la base à un instant passé | 7 jours (offre gratuite) ou 30 jours (offre payante) selon la documentation Cloudflare — à vérifier ; non désactivable. Une donnée purgée reste donc restaurable pendant cette période. |
| Exports manuels `wrangler d1 export` | copie complète de la base | Uniquement si l’équipe technique en fait ; à chiffrer et à stocker hors du dépôt (voir [document 7](07-reversibilite.md)). |

## 2.4 Ce qui n’est jamais collecté

Date de naissance, adresse, téléphone, responsables légaux, photo, INE, données de santé, notes ou appréciations,
géolocalisation, identifiant publicitaire, mesure d’audience. Aucune police, script ou image chargé depuis un autre
site (vérifié par la politique de sécurité du contenu).
