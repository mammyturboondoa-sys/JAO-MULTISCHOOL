'use strict';
// JAO migration 0002 (SQLite): strict school isolation, enforced BY THE DATABASE.
//  * Every link between two school-owned tables becomes a COMPOSITE foreign key (school_id, x_id) -> parent(school_id, id).
//    The database itself then refuses any row that points at another school's data. (This replaces the 7 old triggers and works
//    the same way in PostgreSQL.)
//  * sessions, login_log and password_resets get a school_id column (needed for auditing and for PostgreSQL Row Level Security).
// Existing rows are copied unchanged. If any existing row would violate the new rules, the whole migration is rolled back.

const TABLES = {
  users: `CREATE TABLE users (
    id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    name TEXT NOT NULL, initials TEXT,
    role TEXT NOT NULL CHECK (role IN ('platform_owner','school_admin','teacher','parent','student')),
    student_id INTEGER, language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','fr')),
    active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0,
    last_login TEXT, previous_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((role = 'platform_owner' AND school_id IS NULL) OR (role <> 'platform_owner' AND school_id IS NOT NULL)),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
  )`,
  terms: `CREATE TABLE terms (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), year_id INTEGER NOT NULL,
    name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 1, UNIQUE (school_id, year_id, name),
    FOREIGN KEY (school_id, year_id) REFERENCES academic_years(school_id, id)
  )`,
  classes: `CREATE TABLE classes (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), name TEXT NOT NULL, section TEXT NOT NULL DEFAULT '',
    year_id INTEGER NOT NULL, teacher_id INTEGER, capacity INTEGER, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (school_id, year_id, name, section),
    FOREIGN KEY (school_id, year_id) REFERENCES academic_years(school_id, id),
    FOREIGN KEY (school_id, teacher_id) REFERENCES users(school_id, id)
  )`,
  class_subjects: `CREATE TABLE class_subjects (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), class_id INTEGER NOT NULL, subject_id INTEGER NOT NULL,
    coefficient REAL CHECK (coefficient IS NULL OR coefficient > 0), teacher_id INTEGER, UNIQUE (class_id, subject_id),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id),
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id),
    FOREIGN KEY (school_id, teacher_id) REFERENCES users(school_id, id)
  )`,
  students: `CREATE TABLE students (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_code TEXT NOT NULL,
    full_name TEXT NOT NULL, dob TEXT NOT NULL, gender TEXT, birthplace TEXT, address TEXT, enrolled_on TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','transferred','graduated')),
    previous_school TEXT, stream TEXT, class_id INTEGER, year_id INTEGER, photo_file_id INTEGER, archived_at TEXT,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, UNIQUE (school_id, student_code),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id),
    FOREIGN KEY (school_id, year_id) REFERENCES academic_years(school_id, id),
    FOREIGN KEY (school_id, photo_file_id) REFERENCES files(school_id, id)
  )`,
  guardians: `CREATE TABLE guardians (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), full_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT, address TEXT, user_id INTEGER,
    FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
  )`,
  student_guardians: `CREATE TABLE student_guardians (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, guardian_id INTEGER NOT NULL,
    relationship TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, is_emergency INTEGER NOT NULL DEFAULT 0, UNIQUE (student_id, guardian_id),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
    FOREIGN KEY (school_id, guardian_id) REFERENCES guardians(school_id, id)
  )`,
  student_history: `CREATE TABLE student_history (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL,
    event TEXT NOT NULL, details TEXT, actor_id INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
  )`,
  assessments: `CREATE TABLE assessments (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), class_id INTEGER NOT NULL, subject_id INTEGER NOT NULL,
    term_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, max_score REAL NOT NULL CHECK (max_score > 0), date TEXT NOT NULL,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id),
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id),
    FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id)
  )`,
  grades: `CREATE TABLE grades (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), assessment_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
    score REAL, status TEXT NOT NULL DEFAULT 'graded' CHECK (status IN ('graded','absent','excused')), comment TEXT,
    updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (assessment_id, student_id),
    CHECK ((status = 'graded' AND score IS NOT NULL AND score >= 0) OR (status <> 'graded' AND score IS NULL)),
    FOREIGN KEY (school_id, assessment_id) REFERENCES assessments(school_id, id),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
  )`,
  report_cards: `CREATE TABLE report_cards (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, term_id INTEGER NOT NULL,
    comment TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')), approved_by INTEGER, approved_at TEXT,
    UNIQUE (student_id, term_id),
    FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
    FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id)
  )`,
  products: `CREATE TABLE products (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), code TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
    category TEXT NOT NULL CHECK (category IN ('textbooks','notebooks','reading_books','school_supplies','school_uniforms')),
    class_level TEXT, price INTEGER NOT NULL CHECK (price >= 0), quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    low_threshold INTEGER NOT NULL DEFAULT 5, variant TEXT, image_file_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
    is_public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (school_id, code),
    FOREIGN KEY (school_id, image_file_id) REFERENCES files(school_id, id)
  )`,
  stock_movements: `CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), product_id INTEGER NOT NULL, type TEXT NOT NULL,
    change INTEGER NOT NULL, previous_qty INTEGER NOT NULL, new_qty INTEGER NOT NULL, reason TEXT, actor_id INTEGER,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id, product_id) REFERENCES products(school_id, id)
  )`,
  chat_history: `CREATE TABLE chat_history (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), user_id INTEGER NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
  )`,
};
// Copy order does not matter (foreign keys are off during the rebuild and checked at the end).
const AFTER = ['CREATE INDEX IF NOT EXISTS students_school ON students(school_id, status)'];
// Parent keys that composite foreign keys point at.
const PARENT_KEYS = ['users', 'files', 'academic_years', 'terms', 'classes', 'subjects', 'students', 'guardians', 'assessments', 'products'];
const OLD_TRIGGERS = ['students_same_school_i', 'students_same_school_u', 'grades_same_school', 'assessments_same_school', 'class_subjects_same_school', 'student_guardians_same_school', 'stock_same_school'];

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const hasCol = (db, t, c) => cols(db, t).includes(c);

module.exports = {
  version: 2, name: 'isolation_hardening',
  up(db) {
    for (const t of OLD_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${t}`);
    for (const t of PARENT_KEYS) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_school_id_id ON ${t}(school_id, id)`);
    for (const [t, ddl] of Object.entries(TABLES)) {
      const old = cols(db, t);
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}__old`);
      db.exec(ddl);
      const shared = cols(db, t).filter((c) => old.includes(c));
      // chat_history.school_id was nullable before: fill any gap from the user's own school.
      const sel = shared.map((c) => (t === 'chat_history' && c === 'school_id' ? `COALESCE(school_id, (SELECT school_id FROM users WHERE users.id = ${t}__old.user_id))` : c));
      db.exec(`INSERT INTO ${t} (${shared.join(', ')}) SELECT ${sel.join(', ')} FROM ${t}__old`);
      db.exec(`DROP TABLE ${t}__old`);
    }
    // Rebuilding drops the unique indexes that live on the rebuilt tables; recreate them (and the ones the baseline defined).
    for (const t of PARENT_KEYS) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_school_id_id ON ${t}(school_id, id)`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS one_admin_per_school ON users(school_id) WHERE role = \'school_admin\'');
    for (const sql of AFTER) db.exec(sql);
    // school_id on session-related tables (nullable: the super administrator has no school).
    for (const t of ['sessions', 'login_log', 'password_resets']) if (!hasCol(db, t, 'school_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN school_id INTEGER REFERENCES schools(id)`);
    db.exec('UPDATE sessions SET school_id = (SELECT school_id FROM users WHERE users.id = sessions.user_id) WHERE school_id IS NULL');
    db.exec('UPDATE login_log SET school_id = (SELECT school_id FROM users WHERE users.id = login_log.user_id) WHERE school_id IS NULL AND user_id IS NOT NULL');
    db.exec('UPDATE password_resets SET school_id = (SELECT school_id FROM users WHERE users.id = password_resets.user_id) WHERE school_id IS NULL');
    // Sessions and reset links must belong to the SAME school as their user (composite key). Both tables are small and
    // short-lived, so they are rebuilt with every row copied. (The platform owner has no school; NULL is not compared.)
    db.exec(`CREATE TABLE sessions__new (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, school_id INTEGER REFERENCES schools(id),
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE);
      INSERT INTO sessions__new (token_hash, user_id, school_id, csrf, expires_at, created_at) SELECT token_hash, user_id, school_id, csrf, expires_at, created_at FROM sessions;
      DROP TABLE sessions; ALTER TABLE sessions__new RENAME TO sessions;
      CREATE TABLE password_resets__new (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), school_id INTEGER REFERENCES schools(id),
      token_hash TEXT NOT NULL UNIQUE, created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, used_at TEXT,
      FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id));
      INSERT INTO password_resets__new (id, user_id, school_id, token_hash, created_by, created_at, expires_at, used_at) SELECT id, user_id, school_id, token_hash, created_by, created_at, expires_at, used_at FROM password_resets;
      DROP TABLE password_resets; ALTER TABLE password_resets__new RENAME TO password_resets;`);
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error(`isolation upgrade refused: ${bad.length} existing row(s) point at another school's data (first: table ${bad[0].table}, row ${bad[0].rowid}). Nothing was changed.`);
  },
};
