'use strict';
// 0016: Scholarship Finder. A central catalogue of EXTERNAL scholarships kept by the platform owner (no school_id: it is shared), a per-school approval
// (a school only shows the entries its administrator approved) and per-user bookmarks. Additive only.
module.exports = {
  version: 16, name: 'scholarship_finder',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS external_scholarships (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, provider TEXT NOT NULL, country TEXT, levels TEXT, eligibility TEXT, coverage TEXT, how_to_apply TEXT,
        official_url TEXT NOT NULL, deadline TEXT, deadline_note TEXT, last_verified_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS external_scholarships_url ON external_scholarships(official_url);
      CREATE TABLE IF NOT EXISTS school_external_scholarships (
        school_id INTEGER NOT NULL REFERENCES schools(id), external_id INTEGER NOT NULL REFERENCES external_scholarships(id),
        approved_by INTEGER, approved_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (school_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS external_scholarship_bookmarks (
        school_id INTEGER NOT NULL REFERENCES schools(id), user_id INTEGER NOT NULL, external_id INTEGER NOT NULL REFERENCES external_scholarships(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, external_id), FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
      );
    `);
  },
};
