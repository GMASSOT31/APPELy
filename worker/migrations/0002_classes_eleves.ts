// Lot 2 : calendrier de l'école, classes, enseignants affectés, élèves, présence attendue,
// créneaux d'appel, états d'appel personnalisés, imports.
export default /* sql */ `

-- Jours sans classe : masque de bits, bit (jour-1) pour lundi=1 … dimanche=7.
-- Par défaut : mercredi, samedi, dimanche (4 + 32 + 64).
ALTER TABLE schools ADD COLUMN closed_weekdays INTEGER NOT NULL DEFAULT 100;

CREATE TABLE school_closures (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX school_closures_school ON school_closures(school_id, start_date);

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  levels TEXT NOT NULL,
  school_year TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX classes_unique_name ON classes(school_id, school_year, name COLLATE NOCASE) WHERE archived_at IS NULL;

CREATE TABLE teacher_class_assignments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  start_at TEXT NOT NULL,
  end_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX tca_class ON teacher_class_assignments(class_id);
CREATE INDEX tca_membership ON teacher_class_assignments(membership_id);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  first_name TEXT NOT NULL,
  last_name TEXT,
  active_from TEXT NOT NULL,
  active_to TEXT,
  import_id TEXT REFERENCES import_jobs(id),
  created_at TEXT NOT NULL
);
CREATE INDEX students_class ON students(class_id);
CREATE INDEX students_school ON students(school_id);

-- Présence attendue : une ligne par changement daté, l'historique n'est jamais réécrit.
-- pattern NULL = « même liste tous les jours » (toutes les demi-journées d'école).
-- Sinon masque de bits : bit (jour-1)*2 pour le matin, +1 pour l'après-midi (lundi=1 … samedi=6).
CREATE TABLE student_schedules (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  valid_from TEXT NOT NULL,
  pattern INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (student_id, valid_from)
);

-- Créneaux d'appel par classe. weekdays : masque bit (jour-1), lundi=1 … samedi=6.
CREATE TABLE call_slots (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  half_day TEXT NOT NULL CHECK (half_day IN ('am', 'pm')),
  weekdays INTEGER NOT NULL,
  due_time TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX call_slots_class ON call_slots(class_id);

CREATE TABLE attendance_statuses (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('PRESENT', 'ABSENT', 'AUTRE')),
  position INTEGER NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX attendance_statuses_school ON attendance_statuses(school_id)
`
