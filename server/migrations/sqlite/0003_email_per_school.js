'use strict';
// 0003: the same person (one email address) may belong to several schools, with a separate account,
// role and permissions in each. An email is now unique INSIDE one school (and among super administrators),
// no longer across the whole platform. Every existing row is copied unchanged.
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

module.exports = {
  version: 3, name: 'email_per_school',
  up(db) {
    const old = cols(db, 'users');
    db.exec('ALTER TABLE users RENAME TO users__old');
    db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), email TEXT NOT NULL, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, initials TEXT,
      role TEXT NOT NULL CHECK (role IN ('platform_owner','school_admin','teacher','parent','student')),
      student_id INTEGER, language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','fr')),
      active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login TEXT, previous_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((role = 'platform_owner' AND school_id IS NULL) OR (role <> 'platform_owner' AND school_id IS NOT NULL)),
      FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
    )`);
    const shared = cols(db, 'users').filter((c) => old.includes(c));
    db.exec(`INSERT INTO users (${shared.join(', ')}) SELECT ${shared.join(', ')} FROM users__old`);
    db.exec('DROP TABLE users__old');
    db.exec('CREATE UNIQUE INDEX users_school_id_id ON users(school_id, id)');
    db.exec("CREATE UNIQUE INDEX one_admin_per_school ON users(school_id) WHERE role = 'school_admin'");
    db.exec('CREATE UNIQUE INDEX users_email_per_school ON users(school_id, email) WHERE school_id IS NOT NULL');
    db.exec('CREATE UNIQUE INDEX users_email_platform ON users(email) WHERE school_id IS NULL');
    db.exec('CREATE INDEX users_email ON users(email)');
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error(`email upgrade refused: ${bad.length} foreign key problem(s) (first: ${bad[0].table}). Nothing was changed.`);
  },
};
