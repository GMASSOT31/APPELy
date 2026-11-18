// Lot 3 : appels, états par élève, versions et corrections tracées.
export default /* sql */ `

-- Un appel par classe, créneau et date. version augmente à chaque correction.
-- last_request_id : clé d'idempotence de la dernière validation (double tap, réseau lent).
CREATE TABLE attendance_calls (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  slot_id TEXT NOT NULL REFERENCES call_slots(id),
  slot_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('validated', 'corrected')),
  version INTEGER NOT NULL,
  remark TEXT,
  first_validated_by TEXT NOT NULL REFERENCES users(id),
  first_validated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  UNIQUE (class_id, slot_id, slot_date)
);
CREATE INDEX attendance_calls_school_date ON attendance_calls(school_id, slot_date);

CREATE TABLE attendance_entries (
  call_id TEXT NOT NULL REFERENCES attendance_calls(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  status_id TEXT NOT NULL REFERENCES attendance_statuses(id),
  PRIMARY KEY (call_id, student_id)
);
CREATE INDEX attendance_entries_student ON attendance_entries(student_id);

-- Historique : une ligne par version (horodatage serveur, auteur, changements, justification).
CREATE TABLE attendance_revisions (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES attendance_calls(id),
  version INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL,
  remark TEXT,
  reason TEXT,
  changes TEXT,
  UNIQUE (call_id, version)
)
`
