'use strict';
// 0007: parent convocations (official letters) and their history. Additive only.
// The letter text shown to parents is written separately (reason_for_parent) and never copies confidential council notes.
module.exports = {
  version: 7, name: 'discipline_convocations',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS convocations (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        student_id INTEGER NOT NULL, incident_id INTEGER, case_id INTEGER, guardian_id INTEGER,
        recipient_name TEXT NOT NULL, reference TEXT NOT NULL,
        meet_date TEXT NOT NULL, meet_time TEXT NOT NULL, location TEXT NOT NULL,
        reason_for_parent TEXT NOT NULL, instructions TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','postponed','cancelled','completed')),
        approved_by INTEGER, approved_at TEXT, decision_comment TEXT,
        handed_over_on TEXT, handed_over_method TEXT CHECK (handed_over_method IS NULL OR handed_over_method IN ('printed','hand_delivered','downloaded')),
        parent_response TEXT NOT NULL DEFAULT 'none' CHECK (parent_response IN ('none','attending','unable')),
        response_note TEXT, attended INTEGER, outcome TEXT,
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, reference),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id),
        FOREIGN KEY (school_id, case_id) REFERENCES council_cases(school_id, id),
        FOREIGN KEY (school_id, approved_by) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS convocations_school_id_id ON convocations(school_id, id);
      CREATE INDEX IF NOT EXISTS convocations_student ON convocations(school_id, student_id, meet_date);
      CREATE TABLE IF NOT EXISTS convocation_events (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), convocation_id INTEGER NOT NULL,
        event TEXT NOT NULL, note TEXT, actor_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, convocation_id) REFERENCES convocations(school_id, id),
        FOREIGN KEY (school_id, actor_id) REFERENCES users(school_id, id)
      );
    `);
  },
};
