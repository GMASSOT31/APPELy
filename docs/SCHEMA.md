# Plan du modèle de données (Cloudflare D1 / SQLite)

Implémenté : lot 1 (`worker/migrations/0001_acces_ecoles.ts` : schools, users, memberships, invitations, sessions, login_attempts, audit_events) et lot 2 (`0002_classes_eleves.ts` : school_closures, classes, teacher_class_assignments, students, student_schedules, call_slots, attendance_statuses, import_jobs). Lot 3 (`0003_appels.ts` : attendance_calls, attendance_entries, attendance_revisions). Lot 4 (`0004_direction.ts` : direction_messages, call_reminders, planned_absences). Les tables de répartition arrivent au lot 5.

Repris du cahier des charges §13, avec les contraintes à garantir côté base.

| Table | Champs essentiels | Contraintes |
|---|---|---|
| schools | id uuid, slug unique, name, uai (option), academic_year, timezone, status | status ∈ invited / active / suspended |
| memberships | auth_user_id, school_id, role, active_from/to, invitation_status | role ∈ superadmin / direction / enseignant / remplacant ; remplaçant = active_to obligatoire |
| classes | id, school_id, name, levels[], school_year, active | |
| teacher_class_assignments | teacher_user_id, class_id, start_at, end_at | |
| students | id, school_id, first_name, last_name (option), class_id, active_from/to | données minimisées |
| student_schedules | student_id, weekday, half_day, from/to, expected | historique non réécrit (nouvelles lignes datées) |
| call_slots | class_id, weekday ou date d’exception, slot_name, start_at, due_at, enabled | |
| attendance_statuses | school_id / class_id, label, color, order, category, active | category ∈ PRESENT / ABSENT / AUTRE ; archivage au lieu de suppression |
| attendance_calls | id, school_id, class_id, slot_date, slot_id, status, actor, validated_at, version | **unique (class_id, slot_date, slot_id)** ; status ∈ draft / validated / corrected |
| attendance_entries | call_id, student_id, status_id, physical_host_class_id, revision | unique (call_id, student_id) |
| distribution_plans | id, school_id, source_class_id, from/to, slots, state, author | |
| distribution_assignments | plan_id, student_id, host_class_id, slot_key | **une seule affectation active par élève + créneau** |
| direction_messages | id, school_id, target_kind, targets (JSON), body, priority, start_date, end_date, created_by, archived_at | target_kind ∈ school / levels / classes ; priority ∈ normal / important ; end_date ≥ start_date |
| call_reminders | school_id, class_id, slot_id, slot_date, sent_by, sent_at | relance d'un appel du jour non validé (5 min mini entre deux) |
| planned_absences | school_id, student_id, start_date, end_date, half_days, reason, created_by, cancelled_at | half_days ∈ day / am / pm ; motif pris dans une liste fermée ; annulation au lieu de suppression |
| audit_events | actor, school_id, action, object, before/after minimal, timestamp serveur | append-only |
| import_jobs / export_jobs | school_id, user_id, kind, result, timestamp, deletion_state | |

## Sécurité (équivalent RLS, appliqué dans le Worker)

- Toute route portant un `school_id` passe par `requireSchoolRole` :
  l’utilisateur doit avoir une `membership` active dans l’école.
- Enseignant : lecture/écriture limitée à ses classes affectées et aux élèves accueillis chez lui.
- Superadmin : métadonnées des écoles uniquement, pas les noms d’élèves par défaut.
- Validation d’appel et répartition via fonctions serveur transactionnelles avec clé d’idempotence.
- Tests négatifs obligatoires : école A ne lit/écrit jamais école B ; enseignant hors classe refusé.
