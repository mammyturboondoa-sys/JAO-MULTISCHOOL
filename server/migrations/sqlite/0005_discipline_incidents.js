'use strict';
// 0005: disciplinary incidents, witnesses, private supporting documents and conduct follow-ups.
// Additive only. Every link is a composite (school_id, id) key, so an incident can never point at another school's record.
module.exports = {
  version: 5, name: 'discipline_incidents',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discipline_incidents (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        student_id INTEGER NOT NULL, class_id INTEGER, year_id INTEGER,
        occurred_at TEXT NOT NULL,                      -- 'YYYY-MM-DD HH:MM'
        category_id INTEGER NOT NULL, description TEXT NOT NULL,
        reported_by INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','under_review','action_taken','closed','dismissed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id),
        FOREIGN KEY (school_id, year_id) REFERENCES academic_years(school_id, id),
        FOREIGN KEY (school_id, category_id) REFERENCES discipline_categories(school_id, id),
        FOREIGN KEY (school_id, reported_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS discipline_incidents_school_id_id ON discipline_incidents(school_id, id);
      CREATE INDEX IF NOT EXISTS discipline_incidents_student ON discipline_incidents(school_id, student_id, occurred_at);
      CREATE TABLE IF NOT EXISTS incident_witnesses (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), incident_id INTEGER NOT NULL,
        name TEXT NOT NULL, note TEXT,
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS incident_documents (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), incident_id INTEGER NOT NULL,
        original_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
        uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id),
        FOREIGN KEY (school_id, uploaded_by) REFERENCES users(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS conduct_followups (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, incident_id INTEGER,
        note TEXT NOT NULL, trend TEXT CHECK (trend IS NULL OR trend IN ('improving','stable','concerning')),
        recorded_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id),
        FOREIGN KEY (school_id, recorded_by) REFERENCES users(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS conduct_followups_student ON conduct_followups(school_id, student_id, created_at);
    `);
  },
};
