'use strict';
// Real processes: the Super Administrator's permanent password must survive restarts, a hostile/forgotten
// environment variable, and the command-line recovery tool must work without creating anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { client } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const NODE = ['--disable-warning=ExperimentalWarning'];
const MINE = 'My-Permanent-Pass-2026', ENVPW = 'Env-Override-Pass-1', CLIPW = 'Cli-Chosen-Pass-77';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-owner-'));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(env = {}) {
  const port = await freePort(); let out = '';
  const child = spawn(process.execPath, [...NODE, path.join(ROOT, 'server/index.js')], { env: { ...process.env, JAO_DATA_DIR: dataDir, PORT: String(port), JAO_BACKUP_EVERY_HOURS: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const deadline = Date.now() + 20000; while (!/JAO is running/.test(out)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 100)); }
  const stop = () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000); });
  return { base: `http://127.0.0.1:${port}`, out: () => out, stop };
}
const login = async (srv, pw, email = 'owner@jao.local') => { const c = client({ base: srv.base }); const r = await c.post('/auth/login', { email, password: pw, scope: 'platform' }); if (r.status === 200) c.csrf = r.data.csrf; c.res = r; return c; };
const db = () => new DatabaseSync(path.join(dataDir, 'jao.db'), { readOnly: true });
const cli = (args, input) => spawnSync(process.execPath, [...NODE, path.join(ROOT, 'scripts/reset-owner-password.js'), ...args], { input, env: { ...process.env, JAO_DATA_DIR: dataDir }, encoding: 'utf8' });
let temp;

test('first run creates the owner once with a temporary password; the owner then chooses a permanent one', async () => {
  const s = await startServer();
  try {
    const m = /Platform owner\s+email: (\S+)\s+temporary password: (\S+)/.exec(s.out()); assert.ok(m, s.out()); temp = m[2]; assert.equal(m[1], 'owner@jao.local');
    const c = await login(s, temp); assert.equal(c.res.status, 200); assert.equal(c.res.data.user.must_change_password, true);
    assert.equal((await c.post('/platform/account/password', { current_password: temp, new_password: MINE, confirm_password: MINE })).status, 200);
  } finally { await s.stop(); }
});
test('after a restart the permanent password still works; the temporary one and an environment password do not', async () => {
  for (const round of [1, 2]) {
    const s = await startServer(round === 1 ? { JAO_OWNER_PASSWORD: ENVPW, JAO_OWNER_EMAIL: 'intruder@example.com' } : {});
    try {
      assert.equal((await login(s, MINE)).res.status, 200, `round ${round}: permanent password`);
      assert.equal((await login(s, temp)).res.status, 401); assert.equal((await login(s, ENVPW)).res.status, 401); assert.equal((await login(s, ENVPW, 'intruder@example.com')).res.status, 401);
      assert.doesNotMatch(s.out(), /FIRST RUN|temporary password/, 'no second owner or new temporary password is created');
    } finally { await s.stop(); }
  }
  const d = db(); try { const owners = d.prepare("SELECT email FROM users WHERE role = 'platform_owner'").all(); assert.deepEqual(owners.map((o) => o.email), ['owner@jao.local']); assert.equal(d.prepare('SELECT COUNT(*) n FROM schools').get().n, 1, 'the school is untouched'); } finally { d.close(); }
});
test('command-line recovery: needs matching strong passwords, takes a backup, changes only the existing owner', async () => {
  const before = db(); const schools = before.prepare('SELECT COUNT(*) n FROM schools').get().n; const email = before.prepare("SELECT email FROM users WHERE role='platform_owner'").get().email; before.close();
  assert.equal(cli([], `${CLIPW}\nsomething-else-1\n`).status, 1, 'mismatch is refused'); assert.equal(cli([], 'weak\nweak\n').status, 1, 'weak is refused');
  const s0 = await startServer(); assert.equal((await login(s0, MINE)).res.status, 200, 'nothing changed by the refusals'); await s0.stop();
  const r = cli([], `${CLIPW}\n${CLIPW}\n`); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /Safety backup saved/); assert.ok(!r.stdout.includes(CLIPW), 'the password is never printed');
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).length >= 1);
  const s = await startServer();
  try {
    assert.equal((await login(s, CLIPW)).res.status, 200); assert.equal((await login(s, MINE)).res.status, 401);
    const d = db(); try { assert.equal(d.prepare("SELECT email FROM users WHERE role='platform_owner'").get().email, email, 'same e-mail'); assert.equal(d.prepare('SELECT COUNT(*) n FROM schools').get().n, schools); assert.equal(d.prepare("SELECT COUNT(*) n FROM users WHERE role='platform_owner'").get().n, 1);
      assert.ok(d.prepare("SELECT 1 x FROM audit_log WHERE action = 'owner_password_reset_cli'").get()); } finally { d.close(); }
  } finally { await s.stop(); }
});
test('command-line --generate gives a one-time temporary password that must be replaced at sign-in', async () => {
  const r = cli(['--generate', '--no-backup']); assert.equal(r.status, 0, r.stderr); const m = /Temporary password \(shown once\): (\S+)/.exec(r.stdout); assert.ok(m); const tmp = m[1];
  const s = await startServer();
  try { const c = await login(s, tmp); assert.equal(c.res.status, 200); assert.equal(c.res.data.user.must_change_password, true); assert.equal((await login(s, CLIPW)).res.status, 401);
    assert.equal((await c.post('/platform/account/password', { current_password: tmp, new_password: MINE, confirm_password: MINE })).status, 200); } finally { await s.stop(); }
  const s2 = await startServer(); try { assert.equal((await login(s2, MINE)).res.status, 200); } finally { await s2.stop(); }
});
test('the tool never creates an account: with no owner, or with two, it changes nothing', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-empty-')); const dbf = path.join(empty, 'jao.db');
  const { createApp } = require('../server/app'); const app = await createApp({ dbFile: dbf, dataDir: empty, env: {} }); app.server.close(); app.db.raw.close();
  let r = spawnSync(process.execPath, [...NODE, path.join(ROOT, 'scripts/reset-owner-password.js'), '--generate'], { env: { ...process.env, JAO_DATA_DIR: empty }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /no Super Administrator/i); const d = new DatabaseSync(dbf); assert.equal(d.prepare("SELECT COUNT(*) n FROM users WHERE role = 'platform_owner'").get().n, 0, 'nothing was created');
  for (const e of ['a@x.local', 'b@x.local']) d.prepare("INSERT INTO users (school_id, email, password_hash, name, initials, role) VALUES (NULL, ?, 'x', 'O', 'O', 'platform_owner')").run(e); d.close();
  r = spawnSync(process.execPath, [...NODE, path.join(ROOT, 'scripts/reset-owner-password.js'), '--generate'], { env: { ...process.env, JAO_DATA_DIR: empty }, encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /More than one/); const d2 = new DatabaseSync(dbf); assert.deepEqual(d2.prepare("SELECT password_hash h FROM users WHERE role='platform_owner'").all().map((x) => x.h), ['x', 'x']); d2.close();
});
