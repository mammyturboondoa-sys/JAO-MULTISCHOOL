'use strict';
// Department-based access for staff. Additive: two new tables, nothing existing is altered.
//  - department_settings: one row per school; enforce = 0 (default: behaviour unchanged) or 1 (department access applies).
//  - department_modules: the school's own module list for a department. A row with module '_custom' marks the
//    department as customised; the other rows are the modules it may use. No rows = the built-in default list.
module.exports = {
  version: 19, name: 'department_access',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS department_settings (
        school_id INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        enforce INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at TEXT,
        FOREIGN KEY (school_id, updated_by) REFERENCES users(school_id, id)
      );
      CREATE TABLE IF NOT EXISTS department_modules (
        id INTEGER PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        department_id INTEGER NOT NULL,
        module TEXT NOT NULL,
        UNIQUE (school_id, department_id, module),
        FOREIGN KEY (school_id, department_id) REFERENCES departments(school_id, id) ON DELETE CASCADE
      );
    `);
  }
};
