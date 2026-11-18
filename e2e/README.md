# Parcours E2E (P1 à P12)

`npm run e2e` construit l’application, lance `wrangler dev` sur une **base D1 locale jetable** (dossier temporaire,
code d’installation local `code-local-e2e`), puis rejoue dans Chromium (Playwright) les parcours du cahier des charges
§15 avec trois profils fictifs :

| Profil | Appareil | Rôle dans les parcours |
|---|---|---|
| Nadia, directrice | ordinateur 1280 px (+ 320 / 360 / 768 px en P12) | P1–P3, P5, P6, P8, P9, P11, P12 |
| Marc, enseignant pressé | téléphone Pixel 7 (+ iPhone 13 / SE en P12) | P4, P7 (classe répartie), P9 |
| Julie, remplaçante (accès 10 jours) | tablette 820 px tactile | P7 (classe d’accueil), P10 (hors ligne), P11 (accès révoqué) |

Plus l’admin de la plateforme (P1, P11) et la direction d’une seconde école (P11), puis deux contrôles : persistance
après redémarrage du serveur et création de l’école de démonstration.

- Sorties : `e2e/captures/*.png` et `e2e/captures/rapport.md` (non versionnés). Code de sortie 1 si un contrôle échoue.
- Le test s’adapte à l’heure : l’appel de Marc porte sur la demi-journée en cours, la répartition sur l’autre.
  Il ne peut pas tourner le **dimanche** (aucun créneau d’école).
- Prérequis : Playwright et Chromium disponibles (`npm i -D playwright && npx playwright install chromium` si besoin).
- Toutes les données sont fictives (prénoms courants + noms de plantes).
