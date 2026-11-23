'use strict';
// 0011: Data Import Centre and GCE Board results.
// Additive only: nothing existing is altered. Every link to school data is a COMPOSITE (school_id, id) key,
// so the database itself refuses a row that points at another school's records.
module.exports = {
  version: 11, name: 'import_centre',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
        category TEXT NOT NULL, source_name TEXT,
        status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','rolled_back','partly_rolled_back')),
        total_rows INTEGER NOT NULL DEFAULT 0, imported_rows INTEGER NOT NULL DEFAULT 0,
        error_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        rolled_back_by INTEGER, rolled_back_at TEXT, rollback_note TEXT,
        FOREIGN KEY (school_id, created_by) REFERENCES users(school_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS import_batches_school_id_id ON import_batches(school_id, id);
      CREATE INDEX IF NOT EXISTS import_batches_school ON import_batches(school_id, created_at);

      -- One line per record an import created or changed. This is what makes a safe rollback possible:
      -- before_json is how a changed record looked before; after_json is how it looked right after the import.
      CREATE TABLE IF NOT EXISTS import_items (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, batch_id INTEGER NOT NULL,
        table_name TEXT NOT NULL, record_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('insert','update')),
        before_json TEXT, after_json TEXT NOT NULL,
        state INTEGER NOT NULL DEFAULT 0,   -- 0 = still in place, 1 = reverted, 2 = kept (changed or used since the import)
        FOREIGN KEY (school_id, batch_id) REFERENCES import_batches(school_id, id)
      );
      CREATE INDEX IF NOT EXISTS import_items_batch ON import_items(batch_id);

      -- Candidate numbers registered for a student before (or while) results are imported.
      CREATE TABLE IF NOT EXISTS gce_candidates (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL,
        exam_year INTEGER NOT NULL, level TEXT NOT NULL CHECK (level IN ('ordinary','advanced')),
        candidate_number TEXT NOT NULL, centre_number TEXT,
        created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        UNIQUE (school_id, exam_year, level, candidate_number),
        UNIQUE (school_id, student_id, exam_year, level)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS gce_candidates_school_id_id ON gce_candidates(school_id, id);

      -- Official GCE Board results. Kept completely apart from school assessments, grades and report cards.
      CREATE TABLE IF NOT EXISTS gce_results (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), student_id INTEGER NOT NULL,
        exam_year INTEGER NOT NULL, level TEXT NOT NULL CHECK (level IN ('ordinary','advanced')),
        candidate_number TEXT NOT NULL, centre_number TEXT,
        candidate_name TEXT,            -- the name exactly as supplied by the Board
        raw_text TEXT,                  -- the original text/row this record was read from, kept for reference
        source TEXT,                    -- 'paste' or the uploaded file name
        batch_id INTEGER, imported_by INTEGER NOT NULL, imported_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
        FOREIGN KEY (school_id, batch_id) REFERENCES import_batches(school_id, id),
        FOREIGN KEY (school_id, imported_by) REFERENCES users(school_id, id),
        UNIQUE (school_id, exam_year, level, candidate_number),
        UNIQUE (school_id, student_id, exam_year, level)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS gce_results_school_id_id ON gce_results(school_id, id);
      CREATE TABLE IF NOT EXISTS gce_result_subjects (
        id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, result_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0, subject_code TEXT, subject_name TEXT NOT NULL,
        grade TEXT NOT NULL,            -- exactly as supplied; never converted, guessed or corrected
        FOREIGN KEY (school_id, result_id) REFERENCES gce_results(school_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS gce_subjects_result ON gce_result_subjects(result_id);
    `);
  },
};
