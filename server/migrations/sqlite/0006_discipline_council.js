'use strict';
// 0006: disciplinary council (meetings, members, cases, confidential discussion, decisions) and sanctions.
// Additive only. All links are composite (school_id, id) keys.
module.exports = {
  version: 6, name: 'discipline_council',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS council_meetings (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        title TEXT NOT NULL, meeting_at TEXT NOT NULL, location TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','held','cancelled')),
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS council_meetings_school_id_id ON council_meetings(school_id, id);
      CREATE TABLE IF NOT EXISTS council_members (
        school_id INTEGER NOT NULL REFERENCES schools(id), meeting_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        council_role TEXT NOT NULL DEFAULT 'member' CHECK (council_role IN ('chair','secretary','member')),
        PRIMARY KEY (meeting_id, user_id),
        FOREIGN KEY (school_id, meeting_id) REFERENCES council_meetings(school_id, id),
        FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS council_cases (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), meeting_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        discussion TEXT, findings TEXT,            -- CONFIDENTIAL: only assigned council members and the administrator
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (meeting_id, student_id),
        FOREIGN KEY (school_id, meeting_id) REFERENCES council_meetings(school_id, id),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS council_cases_school_id_id ON council_cases(school_id, id);
      CREATE TABLE IF NOT EXISTS council_case_incidents (
        school_id INTEGER NOT NULL REFERENCES schools(id), case_id INTEGER NOT NULL, incident_id INTEGER NOT NULL,
        PRIMARY KEY (case_id, incident_id),
        FOREIGN KEY (school_id, case_id) REFERENCES council_cases(school_id, id),
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS council_decisions (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), case_id INTEGER NOT NULL UNIQUE,
        decision_text TEXT NOT NULL, decided_on TEXT NOT NULL, follow_up TEXT,
        approver_id INTEGER NOT NULL,                -- the person authorised to approve this decision
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
        approved_by INTEGER, approved_at TEXT, approval_comment TEXT,
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, case_id) REFERENCES council_cases(school_id, id),
        FOREIGN KEY (school_id, approver_id) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, approved_by) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS council_decisions_school_id_id ON council_decisions(school_id, id);
      CREATE TABLE IF NOT EXISTS sanctions (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL,
        incident_id INTEGER, decision_id INTEGER, sanction_type_id INTEGER NOT NULL,
        reason TEXT NOT NULL, imposed_on TEXT NOT NULL, duration_days INTEGER,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','withdrawn')),
        proposed_by INTEGER NOT NULL, authorized_by INTEGER, authorized_at TEXT, decision_comment TEXT,
        notification_status TEXT NOT NULL DEFAULT 'not_notified' CHECK (notification_status IN ('not_notified','notified')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, incident_id) REFERENCES discipline_incidents(school_id, id),
        FOREIGN KEY (school_id, decision_id) REFERENCES council_decisions(school_id, id),
        FOREIGN KEY (school_id, sanction_type_id) REFERENCES sanction_types(school_id, id),
        FOREIGN KEY (school_id, proposed_by) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, authorized_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sanctions_school_id_id ON sanctions(school_id, id);
      CREATE INDEX IF NOT EXISTS sanctions_student ON sanctions(school_id, student_id, imposed_on);
    `);
  },
};
