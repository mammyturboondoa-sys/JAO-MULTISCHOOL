'use strict';
// 0015: scholarship recipients (awards), their history and renewal reviews. Additive only.
module.exports = {
  version: 15, name: 'scholarship_awards',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scholarship_awards (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        application_id INTEGER NOT NULL, scholarship_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        awarded_on TEXT NOT NULL, valid_from TEXT NOT NULL, valid_until TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')), status_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (application_id),
        FOREIGN KEY (school_id, application_id) REFERENCES scholarship_applications(school_id, id),
        FOREIGN KEY (school_id, scholarship_id) REFERENCES scholarships(school_id, id),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS scholarship_awards_school_id_id ON scholarship_awards(school_id, id);
      CREATE INDEX IF NOT EXISTS scholarship_awards_student ON scholarship_awards(school_id, student_id);
      CREATE TABLE IF NOT EXISTS scholarship_award_events (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), award_id INTEGER NOT NULL,
        event TEXT NOT NULL, note TEXT, actor_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, award_id) REFERENCES scholarship_awards(school_id, id),
        FOREIGN KEY (school_id, actor_id) REFERENCES users(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS scholarship_renewals (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), award_id INTEGER NOT NULL,
        period_label TEXT NOT NULL, review_date TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('renewed','not_renewed')), note TEXT, decided_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, award_id) REFERENCES scholarship_awards(school_id, id),
        FOREIGN KEY (school_id, decided_by) REFERENCES users(school_id, id)
      );
    `);
  },
};
