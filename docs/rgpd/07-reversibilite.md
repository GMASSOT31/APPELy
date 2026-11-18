# 7. Réversibilité : export complet puis purge

Objectif (§14 du cahier des charges) : à la fin de l’usage, pour une école ou pour tout le service, le responsable de
traitement **récupère ses données**, puis elles sont **effacées** chez l’exploitant et chez l’hébergeur.

## 7.1 Ce qui existe

| Besoin | Moyen actuel |
|---|---|
| Historique des appels d’une école (lisible) | Direction : Historique → Exporter (PDF, Excel, CSV), par périodes de 62 jours, avec détail par élève si besoin |
| Copie complète de la base (toutes écoles) | Exploitant : `npx wrangler d1 export appely-db --remote --output=sauvegarde.sql` |
| Suppression d’une école de démonstration | Bouton superadmin « Supprimer » (efface toutes ses données et comptes) |
| Suppression d’une vraie école | **Pas de bouton** (volontaire, pour éviter une erreur irréversible) : procédure manuelle ci-dessous |
| Suppression de tout le service | Suppression de la base D1 et du Worker dans Cloudflare |

## 7.2 Procédure pour une école (manuelle, par l’exploitant, sur demande écrite du responsable de traitement)

1. **Exporter** : la direction exporte l’historique complet (une période de 62 jours à la fois) au format Excel avec
   le détail par élève. L’exploitant peut fournir en plus un extrait SQL limité à l’école (tables filtrées par
   `school_id`), chiffré (archive protégée par mot de passe transmis par un autre canal).
2. **Vérifier** : le responsable de traitement confirme par écrit avoir reçu et relu l’export.
3. **Purger** : l’exploitant supprime toutes les lignes de l’école (même ordre que la suppression d’une école de
   démonstration, `worker/routes/demo.ts`, en retirant la condition `is_demo = 1`), après une sauvegarde
   `wrangler d1 export` conservée **au plus 30 jours**, chiffrée, puis détruite.
4. **Attester** : l’exploitant envoie une attestation de suppression (date, tables, nombre de lignes).
5. **Délai résiduel** : les sauvegardes automatiques Cloudflare (Time Travel) disparaissent d’elles-mêmes sous
   7 à 30 jours ; l’attestation le mentionne.

## 7.3 À développer si le responsable de traitement le demande

- Bouton « Exporter toutes les données de l’école » (fichier unique) côté direction.
- Bouton superadmin « Purger l’école » avec double confirmation, export préalable obligatoire et journal.
- Purge automatique selon les durées de conservation ([document 10](10-decisions-responsable.md)).
