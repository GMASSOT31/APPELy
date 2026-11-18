// Lot 4 : messages ciblés de la direction, relances d'appel, absences prévues.
export default /* sql */ `

-- Messages du jour. target_kind : école entière, niveaux (targets = ["CP","CE1"]) ou classes (targets = ids).
-- Visibles de start_date à end_date inclus. Pas d'accusé de lecture.
CREATE TABLE direction_messages (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('school', 'levels', 'classes')),
  targets TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'important')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  archived_at TEXT,
  archived_by TEXT REFERENCES users(id),
  CHECK (end_date >= start_date)
);
CREATE INDEX direction_messages_school ON direction_messages(school_id, end_date);

-- Relances : la direction relance l'enseignant d'un appel non fait (notification interne).
CREATE TABLE call_reminders (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  slot_id TEXT NOT NULL REFERENCES call_slots(id),
  slot_date TEXT NOT NULL,
  sent_by TEXT NOT NULL REFERENCES users(id),
  sent_at TEXT NOT NULL
);
CREATE INDEX call_reminders_school_date ON call_reminders(school_id, slot_date);

-- Absences prévues : préparent l'appel (élève prépositionné Absent, toujours « à vérifier »).
-- Motif choisi dans une liste courte, jamais médical. Annulation au lieu de suppression.
CREATE TABLE planned_absences (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  half_days TEXT NOT NULL CHECK (half_days IN ('day', 'am', 'pm')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id),
  CHECK (end_date >= start_date)
);
CREATE INDEX planned_absences_student ON planned_absences(student_id, end_date);
CREATE INDEX planned_absences_school ON planned_absences(school_id, end_date)
`
