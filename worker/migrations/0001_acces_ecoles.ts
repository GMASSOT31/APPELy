// Lot 1 : écoles, comptes, rattachements, invitations, sessions, audit.
export default /* sql */ `

CREATE TABLE schools (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  uai TEXT,
  academic_year TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  is_superadmin INTEGER NOT NULL DEFAULT 0 CHECK (is_superadmin IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  school_id TEXT NOT NULL REFERENCES schools(id),
  role TEXT NOT NULL CHECK (role IN ('direction', 'enseignant', 'remplacant')),
  active_from TEXT NOT NULL,
  active_to TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, school_id),
  -- Un remplaçant a toujours une date de fin d'accès.
  CHECK (role <> 'remplacant' OR active_to IS NOT NULL)
);
CREATE INDEX memberships_school ON memberships(school_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  school_id TEXT NOT NULL REFERENCES schools(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('direction', 'enseignant', 'remplacant')),
  access_until TEXT,
  invited_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX invitations_school ON invitations(school_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts(key, at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id TEXT,
  school_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  details TEXT
);
CREATE INDEX audit_school ON audit_events(school_id, at);
`
