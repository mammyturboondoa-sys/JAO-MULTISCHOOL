'use strict';
// Attacks against the DATABASE itself (not through the API): even if application code had a bug,
// the database must refuse to link one school's records to another school's records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestApp, makeSchool, seedSchool } = require('./helpers');

let app, A, B, idA, idB;
test.before(async () => {
  app = await startTestApp();
  idA = await makeSchool(app, 'Iso A', 'iso.a@test.local');
  idB = await makeSchool(app, 'Iso B', 'iso.b@test.local');
  A = await seedSchool(app, 'iso.a@test.local', 'A');
  B = await seedSchool(app, 'iso.b@test.local', 'B');
  for (const [S, k] of [[A, 'a'], [B, 'b']]) {
    const st = await S.mk(`Student ${k}`, `Guardian ${k}`);
    const as = (await S.admin.post('/assessments', { class_id: S.cls, subject_id: S.maths, term_id: S.term, name: 'T', type: 'test', max_score: 20, date: '2026-10-01' })).data.id;
    await S.admin.put(`/assessments/${as}/grades`, { entries: [{ student_id: st.id, score: 12 }] });
    const p = (await S.admin.post('/products', { code: `P-${k}`, name: 'Pen', category: 'pens', price: 100, quantity: 5 })).data.id;
    await S.admin.post(`/products/${p}/stock`, { change: 3, reason: 'restock' }).catch(() => {});
  }
});
test.after(() => app.stop());

// every foreign key that points to a school-owned table must include school_id
test('every link between school-owned tables is a composite (school_id, id) key', async () => {
  const raw = app.db.raw;
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
  const owned = new Set(tables.filter((t) => raw.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'school_id')));
  const loose = [];
  for (const t of owned) {
    const fks = raw.prepare(`PRAGMA foreign_key_list(${t})`).all();
    const byId = {};
    for (const f of fks) (byId[f.id] ||= []).push(f);
    const groups = Object.values(byId);
    for (const group of groups) {
      const parent = group[0].table;
      if (!owned.has(parent) || parent === 'schools') continue;
      if (group[0].from === 'created_by') continue; // set by the platform owner, who belongs to no school
      if (group.some((f) => f.from === 'school_id')) continue;
      // a plain link is fine only when a composite (school_id, column) link ALSO covers the same column
      const covered = groups.some((g2) => g2.some((f) => f.from === 'school_id') && g2.some((f) => f.from === group[0].from));
      if (!covered) loose.push(`${t}.${group.map((f) => f.from)} -> ${parent}`);
    }
  }
  assert.deepEqual(loose, [], 'links that do not carry school_id: ' + loose.join(', '));
});

test('the database refuses to re-point any row at another school\'s record', async () => {
  const raw = app.db.raw;
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
  let attacks = 0;
  for (const t of tables) {
    const groups = {};
    for (const f of raw.prepare(`PRAGMA foreign_key_list(${t})`).all()) (groups[f.id] ||= []).push(f);
    for (const g of Object.values(groups)) {
      const sf = g.find((f) => f.from === 'school_id'); const other = g.find((f) => f.from !== 'school_id');
      if (!sf || !other) continue;
      const child = raw.prepare(`SELECT rowid r FROM ${t} WHERE school_id = ? AND "${other.from}" IS NOT NULL LIMIT 1`).get(idA);
      const foreign = raw.prepare(`SELECT "${other.to}" v FROM ${other.table} WHERE school_id = ? LIMIT 1`).get(idB);
      if (!child || !foreign) continue;
      attacks++;
      assert.throws(() => raw.prepare(`UPDATE ${t} SET "${other.from}" = ? WHERE rowid = ?`).run(foreign.v, child.r), /FOREIGN KEY/, `${t}.${other.from} accepted another school's ${other.table}`);
    }
  }
  assert.ok(attacks >= 12, `only ${attacks} cross-school attacks were possible; seed more data`);
});

test('a session, login record or reset link always belongs to a real school (or the platform)', async () => {
  const raw = app.db.raw;
  assert.throws(() => raw.prepare("INSERT INTO sessions (token_hash, user_id, school_id, csrf, expires_at, created_at) VALUES ('h', (SELECT id FROM users WHERE school_id = ? LIMIT 1), ?, 'c', 1, 1)").run(idA, idB), /FOREIGN KEY/);
});

// ---- code scan: every query that changes or reads school-owned rows by id must also filter by school ----
test('server code: UPDATE / DELETE on school-owned tables always filter by school_id', async () => {
  const raw = app.db.raw;
  const owned = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name)
    .filter((t) => raw.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'school_id') && t !== 'schools');
  const dir = path.join(__dirname, '..', 'server');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // each SQL string starts right after its opening quote; read up to the matching closing quote
    const re = /(["'`])\s*(UPDATE\s+(\w+)\s+SET|DELETE\s+FROM\s+(\w+))/g;
    let m;
    while ((m = re.exec(src))) {
      const table = m[3] || m[4];
      if (!owned.includes(table)) continue;
      const end = src.indexOf(m[1], m.index + 1);
      const text = src.slice(m.index + 1, end);
      if (!/school_id|\$\{[^}]*(sql|filter)/.test(text)) offenders.push(`${f}: ${text.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  const allowed = offenders.filter((o) => !/sessions|login_log|password_resets|registration_requests/.test(o));
  assert.deepEqual(allowed, [], 'queries without a school filter:\n' + allowed.join('\n'));
});
