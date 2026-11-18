# 5. Droits des personnes et procédure

## 5.1 Quels droits s’appliquent ⚖️

Le traitement repose sur une **mission d’intérêt public** (art. 6.1.e). Dans ce cas :

| Droit | S’applique ? | Ce qu’Appely permet aujourd’hui |
|---|---|---|
| Information (art. 13) | Oui | Notes d’information ([document 9](09-note-information.md)) et page « Confidentialité » de l’application |
| Accès (art. 15) | Oui | La direction filtre l’historique sur la classe et la période, puis exporte **avec le détail par élève** (PDF, Excel ou CSV) ; elle ne transmet que les lignes de l’élève concerné. Pas encore d’export « un seul élève » en un clic. |
| Rectification (art. 16) | Oui | Prénom / nom / classe / présence attendue modifiables par la direction (fiche de la classe) ; appel corrigeable par l’enseignant ou la direction, avec motif, ancienne et nouvelle valeur conservées. |
| Effacement (art. 17) | Limité (art. 17.3.b : mission d’intérêt public) | L’élève peut être marqué « sorti » (il disparaît des appels). L’effacement complet d’un élève et de ses appels se fait aujourd’hui **par l’équipe technique** (procédure ci-dessous) ; la purge automatique est à développer. |
| Limitation (art. 18) | Oui, au cas par cas | Pendant l’examen d’une contestation, la direction peut noter la contestation et ne pas exporter les données concernées. Pas de fonction dédiée. |
| Opposition (art. 21) | Possible en principe, mais le contrôle de l’assiduité est une obligation de l’école : l’opposition sera en général écartée pour « motifs impérieux ». | Décision du responsable de traitement, au cas par cas. |
| Portabilité (art. 20) | Non (ne s’applique pas à une mission d’intérêt public) | — |
| Réclamation auprès de la CNIL | Oui | Mentionnée dans les notes d’information. |

## 5.2 Procédure (à adapter par le responsable de traitement)

1. **Réception** : la demande arrive à la direction de l’école (oral, papier, courriel). La direction la date et
   vérifie l’identité du demandeur (responsable légal de l’élève, ou personnel lui-même) sans demander plus de
   pièces que nécessaire.
2. **Transmission** : la direction informe le DPD académique `[adresse]` pour les demandes autres que les
   rectifications simples.
3. **Traitement** :
   - Accès : export filtré (classe, période) avec détail par élève → ne garder que l’élève concerné → remise en main
     propre ou par messagerie académique. Ne jamais envoyer un fichier contenant d’autres élèves.
   - Rectification : correction directement dans Appely (tracée).
   - Effacement accepté : demande écrite de la direction à l’exploitant d’Appely, qui supprime l’élève et ses lignes
     d’appel (requêtes SQL sur `attendance_entries`, `attendance_revisions` (changements), `planned_absences`,
     `distribution_assignments`, `student_schedules`, `students`), consigne la suppression et confirme par écrit.
     Rappel : la donnée reste dans les sauvegardes automatiques de Cloudflare jusqu’à 7 à 30 jours.
4. **Délai** : réponse sous **un mois** (prolongeable de deux mois si la demande est complexe, en informant la personne).
5. **Trace** : la direction note la demande, la date de réponse et la suite donnée (registre des demandes tenu
   par l’école ou par le DPD).

## 5.3 Personnels

- Un personnel peut demander l’accès à ses données (compte, rattachements, actions au journal) : extraction par
  l’exploitant d’Appely sur demande de la direction ou du DPD.
- À la fin d’une affectation, la direction **retire l’accès** (onglet Équipe) : effet immédiat, sessions coupées.
  La suppression du compte suivra la durée de conservation décidée.
