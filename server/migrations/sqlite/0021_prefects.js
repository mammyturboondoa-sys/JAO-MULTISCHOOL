'use strict';
// 0021: Prefects. Two NEW tables only (prefect_posts, prefect_appointments): no existing table or record is changed.
// Every row carries school_id and the links to students / academic years are composite, so one school can never point at another's records.
const { POSTS } = require('../../prefect-defaults');
module.exports = {
  version: 21, name: 'prefects',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prefect_posts (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        name_en TEXT NOT NULL, name_fr TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, name_en)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS prefect_posts_school_id_id ON prefect_posts(school_id, id);
      CREATE TABLE IF NOT EXISTS prefect_appointments (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        student_id INTEGER NOT NULL, post_id INTEGER NOT NULL, year_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
        ended_on TEXT, ended_reason TEXT, appointed_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, student_id, post_id, year_id),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, post_id) REFERENCES prefect_posts(school_id, id),
        FOREIGN KEY (school_id, year_id) REFERENCES academic_years(school_id, id),
        FOREIGN KEY (school_id, appointed_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS prefect_appointments_school_id_id ON prefect_appointments(school_id, id);
    `);
    // Give every existing school the starting list of posts (each school can edit it).
    for (const s of db.prepare('SELECT id FROM schools').all()) {
      if (db.prepare('SELECT 1 FROM prefect_posts WHERE school_id = ?').get(s.id)) continue;
      POSTS.forEach(([en, fr], i) => db.prepare('INSERT INTO prefect_posts (school_id, name_en, name_fr, sort_order) VALUES (?,?,?,?)').run(s.id, en, fr, i));
    }
  },
};
