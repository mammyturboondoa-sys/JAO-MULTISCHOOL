'use strict';
// Additive staff-office directory. Login roles remain unchanged for backwards compatibility.
module.exports = {
  version: 18, name: 'staff_departments',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        head_user_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (school_id, name),
        FOREIGN KEY (school_id, head_user_id) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS departments_school_id_id ON departments(school_id, id);
      CREATE INDEX IF NOT EXISTS departments_school_active ON departments(school_id, active, name);
      CREATE TABLE IF NOT EXISTS staff_assignments (
        id INTEGER PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        department_id INTEGER,
        position_title TEXT NOT NULL,
        is_department_head INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        assigned_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        UNIQUE (school_id, user_id),
        FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id),
        FOREIGN KEY (school_id, department_id) REFERENCES departments(school_id, id),
        FOREIGN KEY (school_id, assigned_by) REFERENCES users(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS staff_assignments_school_department ON staff_assignments(school_id, department_id, active);
    `);
  }
};
