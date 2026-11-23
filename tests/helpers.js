'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const S = require('../server/security');

async function startTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-test-'));
  const app = await createApp({ dbFile: path.join(dir, 'test.db'), dataDir: dir, env: { JAO_REGISTER_LIMIT: '1000' } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  app.stop = () => new Promise((r) => { app.server.close(r); app.server.closeAllConnections?.(); });
  return app;
}

// A tiny browser-like client: keeps the session cookie and CSRF token.
function client(app) {
  const c = { cookie: '', csrf: '' };
  c.call = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (c.cookie) headers.Cookie = c.cookie;
    if (c.csrf) headers['X-CSRF-Token'] = c.csrf;
    const r = await fetch(app.base + '/api' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) c.cookie = sc.split(';')[0];
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  c.get = (u) => c.call('GET', u);
  c.post = (u, b = {}) => c.call('POST', u, b);
  c.put = (u, b = {}) => c.call('PUT', u, b);
  c.del = (u) => c.call('DELETE', u);
  c.login = async (email, password) => {
    const r = await c.post('/auth/login', { email, password });
    if (r.status === 200) c.csrf = r.data.csrf;
    return r;
  };
  return c;
}

const PW = 'Test-Passw0rd-1';
async function makeSchool(app, name, adminEmail) {
  return (await app.h.tx(() => app.createSchool({ name, adminName: `Admin ${name}`, adminEmail, adminPassword: PW, mustChange: false }, true))).schoolId;
}
async function makeOwner(app) {
  await app.h.run("INSERT INTO users (school_id, email, password_hash, name, initials, role) VALUES (NULL, 'owner@test.local', ?, 'Owner', 'O', 'platform_owner')", S.hashPassword(PW));
}

// Builds a full small school through the real API: year, term, subject, class, students, users.
async function seedSchool(app, adminEmail, label) {
  const admin = client(app);
  const r = await admin.login(adminEmail, PW);
  if (r.status !== 200) throw new Error('admin login failed ' + JSON.stringify(r.data));
  const year = (await admin.post('/academic-years', { name: `${label} Year` })).data.id;
  const term = (await admin.post('/terms', { year_id: year, name: 'Term 1' })).data.id;
  const maths = (await admin.post('/subjects', { name: 'Maths', code: `MATH${label}`, default_coefficient: 2 })).data.id;
  const eng = (await admin.post('/subjects', { name: 'English', code: `ENG${label}`, default_coefficient: 1 })).data.id;
  const tUser = await admin.post('/users', { role: 'teacher', name: `Teacher ${label}`, email: `teacher.${label}@test.local` });
  await h2(app, tUser.data.id);
  const cls = (await admin.post('/classes', { name: 'Form 1', section: 'A', year_id: year, teacher_id: null })).data.id;
  await admin.put(`/classes/${cls}/subjects`, { subjects: [{ subject_id: maths, coefficient: 2, teacher_id: tUser.data.id }, { subject_id: eng, coefficient: 1 }] });
  const mk = async (name, guardianName) => (await admin.post('/students', { full_name: name, dob: '2014-05-05', gender: 'female', enrolled_on: '2026-09-01', class_id: cls, year_id: year,
    guardians: [{ full_name: guardianName, relationship: 'Mother', phone: '+237600000000', is_primary: true }] })).data;
  return { admin, year, term, maths, eng, cls, teacherId: tUser.data.id, teacherPw: tUser.data.temporary_password, mk, label };
}
async function h2(app, id) { await app.h.run('UPDATE users SET must_change_password = 0 WHERE id = ?', id); }

module.exports = { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 };
