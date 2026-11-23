'use strict';
// 0009: school scholarships (opportunities), eligible classes, and the people who may review applications. Additive only.
module.exports = {
  version: 9, name: 'scholarships_foundations',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scholarships (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        title TEXT NOT NULL, description TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('academic_merit','talent_excellence','social_support','external')),
        sponsor TEXT, eligibility_text TEXT, benefits TEXT NOT NULL, required_documents TEXT, renewal_conditions TEXT,
        places INTEGER NOT NULL DEFAULT 1 CHECK (places >= 1),
        min_average REAL,                                  -- minimum overall average (on the school's grading scale) from APPROVED results; NULL = no minimum
        opens_on TEXT, closes_on TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','suspended','closed')),
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS scholarships_school_id_id ON scholarships(school_id, id);
      CREATE TABLE IF NOT EXISTS scholarship_classes (
        school_id INTEGER NOT NULL REFERENCES schools(id), scholarship_id INTEGER NOT NULL, class_id INTEGER NOT NULL,
        PRIMARY KEY (scholarship_id, class_id),
        FOREIGN KEY (school_id, scholarship_id) REFERENCES scholarships(school_id, id),
        FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS scholarship_reviewers (
        school_id INTEGER NOT NULL REFERENCES schools(id), user_id INTEGER NOT NULL,
        granted_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id),
        FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE
      );
    `);
  },
};
