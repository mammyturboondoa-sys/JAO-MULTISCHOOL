'use strict';
// 0004: foundations of the Discipline module (additive only: no existing table or record is changed, except two new
// on/off columns on `schools`, both OFF by default). Later phases add the incident / council / convocation tables.
const hasCol = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);

module.exports = {
  version: 4, name: 'discipline_foundations',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discipline_categories (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        name_en TEXT NOT NULL, name_fr TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','serious')),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, name_en)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS discipline_categories_school_id_id ON discipline_categories(school_id, id);
      CREATE TABLE IF NOT EXISTS sanction_types (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        name_en TEXT NOT NULL, name_fr TEXT NOT NULL,
        has_duration INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, name_en)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sanction_types_school_id_id ON sanction_types(school_id, id);
      CREATE TABLE IF NOT EXISTS user_permissions (
        school_id INTEGER NOT NULL REFERENCES schools(id), user_id INTEGER NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('report_incidents','manage_discipline','council_member','approve_decisions')),
        granted_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, permission),
        FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE
      );
    `);
    // Disciplinary information on official report cards is OFF until a school switches it on.
    if (!hasCol(db, 'schools', 'report_show_conduct')) db.exec('ALTER TABLE schools ADD COLUMN report_show_conduct INTEGER NOT NULL DEFAULT 0');
    if (!hasCol(db, 'schools', 'report_show_decisions')) db.exec('ALTER TABLE schools ADD COLUMN report_show_decisions INTEGER NOT NULL DEFAULT 0');
    // Give every existing school the starting lists (they can edit them).
    const { CATEGORIES, SANCTIONS } = require('../../discipline-defaults');
    for (const s of db.prepare('SELECT id FROM schools').all()) {
      for (const [en, fr, sev] of CATEGORIES) db.prepare('INSERT OR IGNORE INTO discipline_categories (school_id, name_en, name_fr, severity) VALUES (?,?,?,?)').run(s.id, en, fr, sev);
      for (const [en, fr, dur] of SANCTIONS) db.prepare('INSERT OR IGNORE INTO sanction_types (school_id, name_en, name_fr, has_duration) VALUES (?,?,?,?)').run(s.id, en, fr, dur);
    }
  },
};
