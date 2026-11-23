-- JAO migration 0001 (SQLite): baseline schema as of multi-school v3.
-- Safe to run on an existing database: every statement is CREATE ... IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  code TEXT, school_type TEXT,
  approval TEXT NOT NULL DEFAULT 'approved',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  motto TEXT, address TEXT, location TEXT, phone TEXT, email TEXT, logo_file_id INTEGER,
  shop_hours TEXT, shop_instructions TEXT,
  pass_mark REAL NOT NULL DEFAULT 10,
  grade_scale REAL NOT NULL DEFAULT 20,
  rounding INTEGER NOT NULL DEFAULT 2,
  ranking_enabled INTEGER NOT NULL DEFAULT 0,
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registration_requests (
  id INTEGER PRIMARY KEY,
  school_name TEXT NOT NULL, admin_name TEXT NOT NULL, admin_email TEXT NOT NULL,
  phone TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  school_id INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS schools_code_unique ON schools(code);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  initials TEXT,
  role TEXT NOT NULL CHECK (role IN ('platform_owner','school_admin','teacher','parent','student')),
  student_id INTEGER,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','fr')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login TEXT, previous_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((role = 'platform_owner' AND school_id IS NULL) OR (role <> 'platform_owner' AND school_id IS NOT NULL))
);
-- Only one administrator per school (the sole person allowed to change school records).
CREATE UNIQUE INDEX IF NOT EXISTS one_admin_per_school ON users(school_id) WHERE role = 'school_admin';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, ok INTEGER, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  kind TEXT NOT NULL CHECK (kind IN ('student_photo','product_image','school_logo','knowledge_doc')),
  mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  year_id INTEGER NOT NULL REFERENCES academic_years(id),
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 1,
  UNIQUE (school_id, year_id, name)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL, section TEXT NOT NULL DEFAULT '',
  year_id INTEGER NOT NULL REFERENCES academic_years(id),
  teacher_id INTEGER REFERENCES users(id),
  capacity INTEGER, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (school_id, year_id, name, section)
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL, code TEXT NOT NULL, description TEXT,
  default_coefficient REAL CHECK (default_coefficient IS NULL OR default_coefficient > 0),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (school_id, code)
);
CREATE TABLE IF NOT EXISTS class_subjects (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  coefficient REAL CHECK (coefficient IS NULL OR coefficient > 0),
  teacher_id INTEGER REFERENCES users(id),
  UNIQUE (class_id, subject_id)
);

-- One-time password-reset links created by the super administrator. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE, created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, used_at TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  student_code TEXT NOT NULL,
  full_name TEXT NOT NULL, dob TEXT NOT NULL, gender TEXT, birthplace TEXT, address TEXT,
  enrolled_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','transferred','graduated')),
  previous_school TEXT, stream TEXT,
  class_id INTEGER REFERENCES classes(id), year_id INTEGER REFERENCES academic_years(id),
  photo_file_id INTEGER REFERENCES files(id),
  archived_at TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
  UNIQUE (school_id, student_code)
);
CREATE INDEX IF NOT EXISTS students_school ON students(school_id, status);

CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT,
  user_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS student_guardians (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),
  relationship TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, is_emergency INTEGER NOT NULL DEFAULT 0,
  UNIQUE (student_id, guardian_id)
);
CREATE TABLE IF NOT EXISTS student_history (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  event TEXT NOT NULL, details TEXT, actor_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  name TEXT NOT NULL, type TEXT NOT NULL, max_score REAL NOT NULL CHECK (max_score > 0),
  date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  assessment_id INTEGER NOT NULL REFERENCES assessments(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  score REAL, status TEXT NOT NULL DEFAULT 'graded' CHECK (status IN ('graded','absent','excused')),
  comment TEXT, updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assessment_id, student_id),
  CHECK ((status = 'graded' AND score IS NOT NULL AND score >= 0) OR (status <> 'graded' AND score IS NULL))
);
CREATE TABLE IF NOT EXISTS report_cards (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  comment TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_by INTEGER, approved_at TEXT,
  UNIQUE (student_id, term_id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  code TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  category TEXT NOT NULL CHECK (category IN ('textbooks','notebooks','reading_books','school_supplies','school_uniforms')),
  class_level TEXT, price INTEGER NOT NULL CHECK (price >= 0), -- FCFA (XAF), whole francs
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_threshold INTEGER NOT NULL DEFAULT 5, variant TEXT,
  image_file_id INTEGER REFERENCES files(id),
  active INTEGER NOT NULL DEFAULT 1, is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (school_id, code)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL, change INTEGER NOT NULL, previous_qty INTEGER NOT NULL, new_qty INTEGER NOT NULL,
  reason TEXT, actor_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL, category TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en',
  period TEXT, body TEXT NOT NULL, source_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  author_id INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY, school_id INTEGER, user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL, content TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, school_id INTEGER, actor_id INTEGER, action TEXT NOT NULL,
  record TEXT, meta TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defence in depth: refuse records that point at another school's data.
CREATE TRIGGER IF NOT EXISTS students_same_school_i BEFORE INSERT ON students
WHEN (NEW.class_id IS NOT NULL AND (SELECT school_id FROM classes WHERE id = NEW.class_id) <> NEW.school_id)
  OR (NEW.year_id IS NOT NULL AND (SELECT school_id FROM academic_years WHERE id = NEW.year_id) <> NEW.school_id)
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS students_same_school_u BEFORE UPDATE ON students
WHEN (NEW.class_id IS NOT NULL AND (SELECT school_id FROM classes WHERE id = NEW.class_id) <> NEW.school_id)
  OR (NEW.year_id IS NOT NULL AND (SELECT school_id FROM academic_years WHERE id = NEW.year_id) <> NEW.school_id)
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS grades_same_school BEFORE INSERT ON grades
WHEN (SELECT school_id FROM assessments WHERE id = NEW.assessment_id) <> NEW.school_id
  OR (SELECT school_id FROM students WHERE id = NEW.student_id) <> NEW.school_id
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS assessments_same_school BEFORE INSERT ON assessments
WHEN (SELECT school_id FROM classes WHERE id = NEW.class_id) <> NEW.school_id
  OR (SELECT school_id FROM subjects WHERE id = NEW.subject_id) <> NEW.school_id
  OR (SELECT school_id FROM terms WHERE id = NEW.term_id) <> NEW.school_id
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS class_subjects_same_school BEFORE INSERT ON class_subjects
WHEN (SELECT school_id FROM classes WHERE id = NEW.class_id) <> NEW.school_id
  OR (SELECT school_id FROM subjects WHERE id = NEW.subject_id) <> NEW.school_id
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS student_guardians_same_school BEFORE INSERT ON student_guardians
WHEN (SELECT school_id FROM students WHERE id = NEW.student_id) <> NEW.school_id
  OR (SELECT school_id FROM guardians WHERE id = NEW.guardian_id) <> NEW.school_id
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
CREATE TRIGGER IF NOT EXISTS stock_same_school BEFORE INSERT ON stock_movements
WHEN (SELECT school_id FROM products WHERE id = NEW.product_id) <> NEW.school_id
BEGIN SELECT RAISE(ABORT, 'cross_school_reference'); END;
