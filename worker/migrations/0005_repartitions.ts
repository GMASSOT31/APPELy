// Lot 5 : répartitions temporaires (plans, affectations par demi-journée, historique, notifications).
export default /* sql */ `

-- Plan de répartition d'une classe d'origine sur une période (journée, matin ou après-midi).
-- hosts : JSON [{"classId": "...", "capacity": 28 | null}] (classes d'accueil choisies).
-- version : augmente à chaque modification (une modification concurrente est refusée).
CREATE TABLE distribution_plans (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  source_class_id TEXT NOT NULL REFERENCES classes(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  half_days TEXT NOT NULL CHECK (half_days IN ('day', 'am', 'pm')),
  hosts TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'cancelled')),
  version INTEGER NOT NULL,
  create_request_id TEXT NOT NULL UNIQUE,
  last_request_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  cancelled_by TEXT REFERENCES users(id),
  cancelled_at TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX distribution_plans_school ON distribution_plans(school_id, end_date);

-- Affectation physique d'un élève pour une demi-journée. host_class_id NULL = absent connu (non réparti).
-- La classe d'inscription de l'élève ne change pas. Une affectation remplacée est terminée (ended_at), jamais effacée.
CREATE TABLE distribution_assignments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES distribution_plans(id),
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  source_class_id TEXT NOT NULL REFERENCES classes(id),
  host_class_id TEXT REFERENCES classes(id),
  slot_date TEXT NOT NULL,
  half_day TEXT NOT NULL CHECK (half_day IN ('am', 'pm')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  ended_by TEXT REFERENCES users(id),
  ended_at TEXT
);
-- Une seule affectation active par élève et créneau (toutes répartitions confondues).
CREATE UNIQUE INDEX distribution_assignments_one_active ON distribution_assignments(student_id, slot_date, half_day) WHERE ended_at IS NULL;
CREATE INDEX distribution_assignments_host ON distribution_assignments(host_class_id, slot_date);
CREATE INDEX distribution_assignments_source ON distribution_assignments(source_class_id, slot_date);
CREATE INDEX distribution_assignments_plan ON distribution_assignments(plan_id);
CREATE INDEX distribution_assignments_school ON distribution_assignments(school_id, slot_date);

-- Historique des versions d'un plan : création, modification (élèves déplacés), annulation.
CREATE TABLE distribution_changes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES distribution_plans(id),
  version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'cancelled')),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL,
  details TEXT,
  UNIQUE (plan_id, version)
);

-- Notifications internes aux classes concernées (accueil enseignant, écran d'appel), visibles jusqu'à end_date.
CREATE TABLE distribution_notices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  plan_id TEXT NOT NULL REFERENCES distribution_plans(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  end_date TEXT NOT NULL
);
CREATE INDEX distribution_notices_class ON distribution_notices(class_id, end_date);

-- Appel d'une classe d'accueil : classe d'origine de l'élève accueilli (NULL = élève de la classe).
ALTER TABLE attendance_entries ADD COLUMN hosted_from_class_id TEXT REFERENCES classes(id)
`
