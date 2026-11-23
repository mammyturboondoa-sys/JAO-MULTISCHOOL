'use strict';
// Upgrade of databases created BEFORE the numbered-migration system (versions 0-3 by PRAGMA user_version).
// Kept exactly as it was proven on real old databases. After it runs, the normal numbered migrations continue from 0002.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 3;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function legacyCode(db) {
  for (let i = 0; i < 50; i++) {
    let s = '';
    for (const b of crypto.randomBytes(6)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM schools WHERE code = ?').get(`JAO-${s}`)) return `JAO-${s}`;
  }
  throw new Error('could_not_generate_school_code');
}

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

function backupBeforeUpgrade(db, file) {
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `jao-before-upgrade-${stamp}.db`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); // consistent full copy of the database
  return target;
}

function migrate(db, file) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= SCHEMA_VERSION) return null;
  const notNull = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === col)?.notnull === 1;
  const hasData = db.prepare('SELECT COUNT(*) n FROM schools').get().n > 0 || db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  let backup = null;
  if (hasData && file !== ':memory:') backup = backupBeforeUpgrade(db, file);
  db.exec('PRAGMA legacy_alter_table = ON;'); // lets a rebuilt table be renamed while other triggers still mention it
  db.exec('PRAGMA foreign_keys = OFF;'); // required to rebuild tables safely; checked again before commit
  db.exec('BEGIN');
  try {
    if (!hasColumn(db, 'schools', 'code')) db.exec('ALTER TABLE schools ADD COLUMN code TEXT');
    if (!hasColumn(db, 'schools', 'school_type')) db.exec('ALTER TABLE schools ADD COLUMN school_type TEXT');
    // approval: existing schools are 'approved'; new self-registered schools start 'pending'.
    if (!hasColumn(db, 'schools', 'approval')) db.exec("ALTER TABLE schools ADD COLUMN approval TEXT NOT NULL DEFAULT 'approved'");
    if (!hasColumn(db, 'registration_requests', 'school_id')) db.exec('ALTER TABLE registration_requests ADD COLUMN school_id INTEGER');
    // Every school gets a unique code. The first existing school, Seraphim International, gets JAO-0001.
    const first = db.prepare("SELECT id FROM schools WHERE slug = 'seraphim-international' AND code IS NULL").get();
    if (first && !db.prepare("SELECT 1 FROM schools WHERE code = 'JAO-0001'").get()) db.prepare("UPDATE schools SET code = 'JAO-0001' WHERE id = ?").run(first.id);
    for (const s of db.prepare('SELECT id FROM schools WHERE code IS NULL ORDER BY id').all()) db.prepare('UPDATE schools SET code = ? WHERE id = ?').run(legacyCode(db), s.id);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS schools_code_unique ON schools(code)');
    // v3: a coefficient may be EMPTY (never silently 1). SQLite cannot relax a NOT NULL rule in place,
    // so the two tables are rebuilt with every row copied unchanged.
    if (notNull('subjects', 'default_coefficient') || notNull('class_subjects', 'coefficient')) {
      db.exec(`CREATE TABLE subjects_new (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), name TEXT NOT NULL, code TEXT NOT NULL, description TEXT,
        default_coefficient REAL CHECK (default_coefficient IS NULL OR default_coefficient > 0), active INTEGER NOT NULL DEFAULT 1, UNIQUE (school_id, code));
        INSERT INTO subjects_new (id, school_id, name, code, description, default_coefficient, active) SELECT id, school_id, name, code, description, default_coefficient, active FROM subjects;
        DROP TABLE subjects; ALTER TABLE subjects_new RENAME TO subjects;
        CREATE TABLE class_subjects_new (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), class_id INTEGER NOT NULL REFERENCES classes(id),
        subject_id INTEGER NOT NULL REFERENCES subjects(id), coefficient REAL CHECK (coefficient IS NULL OR coefficient > 0), teacher_id INTEGER REFERENCES users(id), UNIQUE (class_id, subject_id));
        INSERT INTO class_subjects_new (id, school_id, class_id, subject_id, coefficient, teacher_id) SELECT id, school_id, class_id, subject_id, coefficient, teacher_id FROM class_subjects;
        DROP TABLE class_subjects; ALTER TABLE class_subjects_new RENAME TO class_subjects;`);
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error('foreign key check failed after upgrade; nothing was changed');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    db.exec(BASELINE); // re-create the triggers that were dropped with the rebuilt tables (IF NOT EXISTS)
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA legacy_alter_table = OFF;'); }
  return backup;
}

// baselineSql: text of migrations/sqlite/0001_baseline.sql (idempotent). Returns the path of the safety backup, or null.
function upgradeLegacy(db, file, baselineSql) {
  BASELINE = baselineSql;
  return migrate(db, file);
}
let BASELINE = '';
module.exports = { upgradeLegacy, backupBeforeUpgrade };
