'use strict';
// Start and end dates for a term. A new table, so the existing `terms` table is untouched.
module.exports = {
  version: 20, name: 'term_dates',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS term_dates (
        id INTEGER PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        term_id INTEGER NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TEXT,
        UNIQUE (school_id, term_id),
        CHECK (starts_on <= ends_on),
        FOREIGN KEY (school_id, term_id) REFERENCES terms(school_id, id) ON DELETE CASCADE,
        FOREIGN KEY (school_id, updated_by) REFERENCES users(school_id, id)
      );
    `);
  }
};
