'use strict';
// 0014: Parent Access portal. Additive only. Phone numbers for parent sign-in (kept in their own table so no existing table changes), plus the school-side records
// parents see: announcements, attendance, fees and payments (with receipts), homework, messages to the administration, official warning notices.
module.exports = {
  version: 14, name: 'parent_portal',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_phones (
        user_id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), phone TEXT NOT NULL,
        UNIQUE (school_id, phone), FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), title TEXT NOT NULL, body TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','parents')), important INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS announcements_school_id_id ON announcements(school_id, id);
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, class_id INTEGER,
        day TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('absent','late','excused')), minutes_late INTEGER CHECK (minutes_late IS NULL OR minutes_late BETWEEN 1 AND 600),
        note TEXT, recorded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (student_id, day), FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS attendance_school_id_id ON attendance(school_id, id);
      CREATE INDEX IF NOT EXISTS attendance_day ON attendance(school_id, day);
      CREATE TABLE IF NOT EXISTS fee_charges (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, title TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0), due_date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS fee_charges_school_id_id ON fee_charges(school_id, id);
      CREATE INDEX IF NOT EXISTS fee_charges_student ON fee_charges(school_id, student_id);
      CREATE TABLE IF NOT EXISTS fee_payments (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), charge_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0), paid_on TEXT NOT NULL, method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_money','cheque','other')),
        reference TEXT, receipt_no TEXT, recorded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, charge_id) REFERENCES fee_charges(school_id, id), FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_school_id_id ON fee_payments(school_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS fee_payments_receipt ON fee_payments(school_id, receipt_no) WHERE receipt_no IS NOT NULL;
      CREATE TABLE IF NOT EXISTS homework (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), class_id INTEGER NOT NULL, subject_id INTEGER, title TEXT NOT NULL, description TEXT,
        due_date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id), FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS homework_school_id_id ON homework(school_id, id);
      CREATE INDEX IF NOT EXISTS homework_class ON homework(school_id, class_id, due_date);
      CREATE TABLE IF NOT EXISTS parent_messages (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), parent_user_id INTEGER NOT NULL, student_id INTEGER,
        from_parent INTEGER NOT NULL CHECK (from_parent IN (0,1)), sender_id INTEGER, body TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, parent_user_id) REFERENCES users(school_id, id), FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS parent_messages_thread ON parent_messages(school_id, parent_user_id, id);
      CREATE TABLE IF NOT EXISTS student_warnings (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
        issued_on TEXT NOT NULL, issued_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS student_warnings_school_id_id ON student_warnings(school_id, id);
    `);
  },
};
