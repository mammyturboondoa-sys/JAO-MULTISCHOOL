'use strict';
// 0010: scholarship applications, their documents, reviewer assignments and reviewer opinions. Additive only.
module.exports = {
  version: 10, name: 'scholarship_applications',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scholarship_applications (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        scholarship_id INTEGER NOT NULL, student_id INTEGER NOT NULL, applied_by INTEGER NOT NULL,
        motivation TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','rejected','waitlisted')),
        submitted_at TEXT, average_at_submission REAL, average_source TEXT,   -- what the check saw at the moment of submitting
        decision_reason TEXT, decided_by INTEGER, decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (scholarship_id, student_id),
        FOREIGN KEY (school_id, scholarship_id) REFERENCES scholarships(school_id, id),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, applied_by) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, decided_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS scholarship_applications_school_id_id ON scholarship_applications(school_id, id);
      CREATE INDEX IF NOT EXISTS scholarship_applications_student ON scholarship_applications(school_id, student_id);
      CREATE TABLE IF NOT EXISTS scholarship_documents (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), application_id INTEGER NOT NULL,
        original_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, uploaded_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, application_id) REFERENCES scholarship_applications(school_id, id),
        FOREIGN KEY (school_id, uploaded_by) REFERENCES users(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS scholarship_reviews (
        school_id INTEGER NOT NULL REFERENCES schools(id), application_id INTEGER NOT NULL, reviewer_id INTEGER NOT NULL,
        assigned_by INTEGER NOT NULL, assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('recommend','not_recommend','undecided')),
        note TEXT, reviewed_at TEXT,
        PRIMARY KEY (application_id, reviewer_id),
        FOREIGN KEY (school_id, application_id) REFERENCES scholarship_applications(school_id, id),
        FOREIGN KEY (school_id, reviewer_id) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, assigned_by) REFERENCES users(school_id, id)
      );
    `);
  },
};
