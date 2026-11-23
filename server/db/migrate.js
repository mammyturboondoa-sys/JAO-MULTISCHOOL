'use strict';
// Numbered migrations. Files live in server/migrations/<dialect>/NNNN_name.(sql|js).
// The table schema_migrations records what has been applied. Each migration runs inside one transaction.
// Before the first change to an existing database that holds data, a full safety copy is saved in data/backups/.
const fs = require('node:fs');
const path = require('node:path');
const { upgradeLegacy, backupBeforeUpgrade } = require('./legacy');

const DIR = path.join(__dirname, '..', 'migrations', 'sqlite');

function listMigrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.(sql|js)$/.test(f)).sort().map((f) => {
    const version = Number(f.slice(0, 4));
    const name = f.slice(5).replace(/\.(sql|js)$/, '');
    return { version, name, file: path.join(DIR, f), isSql: f.endsWith('.sql') };
  });
}

// raw: DatabaseSync. Returns { applied: [versions], backup: path|null }.
function runMigrations(raw, file) {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const done = new Set(raw.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)));
  const all = listMigrations();
  const out = { applied: [], backup: null };
  const hasTable = (t) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const hasData = () => hasTable('schools') && (raw.prepare('SELECT COUNT(*) n FROM schools').get().n > 0 || raw.prepare('SELECT COUNT(*) n FROM users').get().n > 0);
  const baseline = all.find((m) => m.version === 1);
  const baselineSql = fs.readFileSync(baseline.file, 'utf8');

  if (!done.has(1)) {
    if (hasTable('schools')) { // a database made before numbered migrations existed
      out.backup = upgradeLegacy(raw, file, baselineSql) || null; // (makes its own safety copy when it has data)
      raw.exec('PRAGMA foreign_keys = ON');
      raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(1, 'baseline (adopted existing database)');
    } else {
      raw.exec(baselineSql);
      raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(1, baseline.name);
    }
    done.add(1); out.applied.push(1);
  }
  for (const m of all.filter((x) => x.version > 1 && !done.has(x.version))) {
    if (!out.backup && hasData() && file !== ':memory:') out.backup = backupBeforeUpgrade(raw, file);
    raw.exec('PRAGMA legacy_alter_table = ON'); raw.exec('PRAGMA foreign_keys = OFF'); // needed to rebuild tables; checked before commit
    raw.exec('BEGIN');
    try {
      if (m.isSql) raw.exec(fs.readFileSync(m.file, 'utf8')); else require(m.file).up(raw);
      raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      raw.exec('COMMIT');
    } catch (e) { raw.exec('ROLLBACK'); throw new Error(`migration ${String(m.version).padStart(4, '0')} (${m.name}) failed and was rolled back: ${e.message}`); }
    finally { raw.exec('PRAGMA legacy_alter_table = OFF'); raw.exec('PRAGMA foreign_keys = ON'); }
    out.applied.push(m.version);
  }
  raw.exec('PRAGMA foreign_keys = ON');
  return out;
}
module.exports = { runMigrations, listMigrations };
