'use strict';
// Upgrading databases made by OLDER versions of JAO must keep every record, make a safety backup,
// and end with the strict school isolation rules (composite foreign keys) in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../server/db');
const { listMigrations } = require('../server/db/migrate');

const FIX = path.join(__dirname, 'fixtures');
const IGNORE = { schools: ['code', 'school_type', 'approval', 'report_show_conduct', 'report_show_decisions'], sessions: ['school_id'], login_log: ['school_id'] };

function fingerprint(db) {
  const out = {};
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all()) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name).filter((c) => !(IGNORE[t.name] || []).includes(c));
    const rows = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM ${t.name} ORDER BY 1`).all();
    out[t.name] = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') + ':' + rows.length;
  }
  return out;
}
function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-mig-'));
  fs.copyFileSync(path.join(FIX, name), path.join(dir, 'jao.db'));
  return dir;
}

for (const fixture of ['legacy-v0.db', 'legacy-v3.db']) {
  test(`upgrade from ${fixture}: data kept, backup made, isolation rules in place`, async () => {
    const dir = copyFixture(fixture);
    const file = path.join(dir, 'jao.db');
    const old = new DatabaseSync(file, { readOnly: true });
    const before = fingerprint(old); old.close();
    assert.ok(Object.keys(before).length > 10);

    const db = await openDatabase({ file });
    const after = fingerprint(db.raw);
    for (const t of Object.keys(before)) assert.equal(after[t], before[t], `table ${t} changed during upgrade`);

    assert.equal(db.raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
    const versions = db.raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
    assert.deepEqual(versions, listMigrations().map((m) => m.version));
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.ok(backups.some((f) => /before-upgrade/.test(f)), 'a safety backup must exist');

    const s = await db.get("SELECT code, approval FROM schools WHERE slug = 'seraphim-international'");
    if (fixture === 'legacy-v0.db') assert.equal(s.code, 'JAO-0001');
    else assert.match(s.code, /^JAO-/);
    assert.equal(s.approval, 'approved');
    // the new rule: a student cannot point at another school's class
    const fks = db.raw.prepare('PRAGMA foreign_key_list(students)').all();
    assert.ok(fks.some((f) => f.table === 'classes' && /school_id/.test(f.from)), 'composite foreign key on students.class_id');
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n, 0);
    // the Discipline starting lists were added for the existing school, and its report-card switches are OFF
    assert.ok((await db.get('SELECT COUNT(*) n FROM discipline_categories')).n > 0);
    assert.equal((await db.get('SELECT COUNT(*) n FROM sanction_types')).n, 4);
    const sw = await db.get('SELECT report_show_conduct a, report_show_decisions b FROM schools LIMIT 1');
    assert.equal(sw.a, 0); assert.equal(sw.b, 0);
    await db.close();

    // opening again changes nothing and makes no new backup
    const n = fs.readdirSync(path.join(dir, 'backups')).length;
    const db2 = await openDatabase({ file });
    assert.deepEqual(fingerprint(db2.raw), after);
    await db2.close();
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, n);
  });
}

test('upgrade refuses (and rolls back) when old data already mixes two schools', async () => {
  const dir = copyFixture('legacy-v3.db');
  const file = path.join(dir, 'jao.db');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = OFF');
  for (const t of raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()) raw.exec(`DROP TRIGGER ${t.name}`); // simulate damaged data the old triggers would have blocked
  raw.exec("INSERT INTO schools (name, slug, code) VALUES ('Other School', 'other-school', 'JAO-9999')");
  const other = raw.prepare("SELECT id FROM schools WHERE slug = 'other-school'").get().id;
  const cls = raw.prepare('SELECT id FROM classes LIMIT 1').get().id;
  raw.prepare("INSERT INTO students (school_id, student_code, full_name, dob, enrolled_on, class_id) VALUES (?, 'X-1', 'Mixed', '2014-01-01', '2026-01-01', ?)").run(other, cls);
  const snapshot = fingerprint(raw); raw.close();
  await assert.rejects(() => openDatabase({ file }), /rolled back|foreign key/i);
  const check = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(fingerprint(check), snapshot, 'a failed upgrade must leave the data untouched');
  check.close();
});

test('database adapter offers the same small interface the PostgreSQL version must offer', async () => {
  const db = await openDatabase({ file: ':memory:' });
  for (const fn of ['get', 'all', 'run', 'insert', 'tx', 'audit', 'nowPlusDays', 'close']) assert.equal(typeof db[fn], 'function', fn);
  const id = await db.insert("INSERT INTO schools (name, slug, code) VALUES (?, ?, ?)", 'T', 't', 'JAO-0002');
  assert.equal(typeof id, 'number');
  await assert.rejects(() => db.tx(async () => { await db.run('DELETE FROM schools WHERE id = ?', id); throw new Error('boom'); }), /boom/);
  assert.ok(await db.get('SELECT id FROM schools WHERE id = ?', id), 'transaction rolled back');
  await db.close();
});
