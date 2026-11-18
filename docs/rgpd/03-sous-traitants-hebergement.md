# 3. Sous-traitants et hébergement

> Ce document signale honnêtement ce qui est vérifié et ce qui ne l’est pas. Les éléments sur Cloudflare viennent de
> sa documentation publique (novembre 2026) et **doivent être revérifiés** à la date de validation
> (les conditions évoluent).

## 3.1 Chaîne de responsabilité

```
Responsable de traitement (autorité académique — à confirmer)
   └── Sous-traitant : exploitant d’Appely [à nommer]  ← contrat / convention art. 28 à signer
          └── Sous-traitant ultérieur : Cloudflare, Inc. (Workers + D1)  ← conditions en ligne de Cloudflare (DPA)
```

Aucun autre service : pas d’envoi d’e-mails, de SMS, de notifications push, d’outil d’analyse, de CDN de polices,
ni de service d’IA. Le code est hébergé sur GitHub (dépôt), **sans aucune donnée d’élève** (règle du projet :
données strictement fictives dans le code, les tests et les captures).

## 3.2 Cloudflare

| Point | Situation | Statut |
|---|---|---|
| Société | Cloudflare, Inc., siège aux États-Unis ; filiales dans l’UE | Fait |
| Services utilisés | **Workers** (exécute l’application et l’API) et **D1** (base SQLite gérée), offre gratuite | Fait |
| Contrat de sous-traitance | Le « Data Processing Addendum » (DPA) de Cloudflare s’applique aux comptes clients et inclut des clauses contractuelles types de la Commission européenne ; Cloudflare se déclare adhérent au cadre UE–États-Unis de protection des données (Data Privacy Framework). | ⚖️ À vérifier par le DPD (version en vigueur, acceptation par le compte qui héberge Appely) |
| Localisation de la base D1 | D1 permet de créer une base avec la **juridiction « eu »** (données stockées et traitées dans l’UE). Cette option se choisit **uniquement à la création** de la base et ne peut pas être ajoutée ensuite. La base actuelle `appely-db` a été créée sans que cette option soit vérifiée. | ⚠️ **Non garanti aujourd’hui** |
| Lieu d’exécution du Worker | Le code s’exécute dans le centre de données Cloudflare le plus proche de l’utilisateur (en France/UE pour des écoles françaises, sans garantie contractuelle sur l’offre gratuite). Les données transitent donc par ce point. | ⚖️ À apprécier |
| Accès des autorités américaines | Société soumise au droit américain (Cloud Act, FISA 702) : un risque d’accès existe même si les données sont stockées dans l’UE. Cloudflare publie des rapports de transparence. | ⚠️ Risque résiduel à arbitrer par le DPD |
| Qualification SecNumCloud / hébergement « souverain » | **Non.** Cloudflare n’est pas qualifié SecNumCloud. | ⚖️ Le DPD ou la doctrine ministérielle peut l’exiger pour des données d’élèves |
| Journaux d’exécution | Activés (`observability`) : quelques jours de conservation chez Cloudflare. | ⚖️ Désactivation proposée avant usage réel |
| Sauvegardes | « Time Travel » D1 automatique (7 jours en offre gratuite, 30 jours en offre payante — à vérifier). Chiffrement au repos par Cloudflare. | Fait (non paramétrable) |
| Suppression / portabilité | Export SQL complet possible (`wrangler d1 export`), suppression de la base possible ; procédure décrite [document 7](07-reversibilite.md). | Fait (procédure manuelle) |

## 3.3 Proposition prudente avant toute donnée réelle

1. **Créer une nouvelle base D1 avec la juridiction UE** :
   `npx wrangler d1 create appely-db-eu --jurisdiction=eu`, remplacer l’identifiant dans `wrangler.jsonc`, laisser
   le Worker appliquer les migrations, puis supprimer l’ancienne base de démonstration (ou la garder pour la seule
   démonstration). Aucune donnée réelle n’existe aujourd’hui : la bascule est sans risque.
2. **Désactiver les journaux d’exécution détaillés** (`observability`) ou vérifier qu’ils ne contiennent aucune
   donnée nominative (aujourd’hui : adresses d’API avec identifiants, pas de nom).
3. **Signer une convention de sous-traitance** entre le responsable de traitement et l’exploitant d’Appely, qui
   mentionne Cloudflare comme sous-traitant ultérieur.
4. **Faire trancher par le DPD** l’acceptabilité d’un hébergeur américain. Si refus : Appely peut être porté vers un
   hébergeur européen (base SQLite standard, migrations versionnées), mais cela demande un travail de développement
   (le Worker utilise des API propres à Cloudflare) et probablement un coût d’hébergement.

## 3.4 Sources

- Cloudflare D1 — localisation des données et juridictions : <https://developers.cloudflare.com/d1/configuration/data-location/>
- Annonce de la juridiction D1 (novembre 2025) : <https://developers.cloudflare.com/changelog/post/2025-11-05-d1-jurisdiction/>
- Cloudflare — DPA et confidentialité : <https://www.cloudflare.com/cloudflare-customer-dpa/> et <https://www.cloudflare.com/trust-hub/>
