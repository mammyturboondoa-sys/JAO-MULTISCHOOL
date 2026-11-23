'use strict';
// Discipline module, phase 2: incidents, private documents, student disciplinary history.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, reporter, other, officer, principal, parent, sA, sB, cat, today, yesterday;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
const EXE = Buffer.from('MZ\x90\x00 this is not a document').toString('base64');
const body = (extra = {}) => ({ student_id: sA.id, category_id: cat, occurred_date: yesterday, occurred_time: '09:30', description: 'Pushed another pupil in the corridor.', witnesses: [{ name: 'Mr Tabi', note: 'saw it' }], ...extra });

test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Inc A', 'admin.ia@test.local');
  await makeSchool(app, 'Inc B', 'admin.ib@test.local');
  A = await seedSchool(app, 'admin.ia@test.local', 'A');
  B = await seedSchool(app, 'admin.ib@test.local', 'B');
  const mk = async (S, email, role, name) => { const u = (await S.admin.post('/users', { role, name, email })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200); return { id: u.id, c }; };
  reporter = { c: client(app) }; assert.equal((await reporter.c.login('teacher.A@test.local', A.teacherPw)).status, 200); reporter.id = A.teacherId;
  other = await mk(A, 'other.ia@test.local', 'teacher', 'Other Teacher');
  officer = await mk(A, 'officer.ia@test.local', 'teacher', 'Officer');
  principal = await mk(A, 'principal.ia@test.local', 'teacher', 'Principal');
  parent = await mk(A, 'parent.ia@test.local', 'parent', 'Parent');
  await A.admin.put(`/discipline/staff/${officer.id}/permissions`, { permissions: ['manage_discipline'] });
  await A.admin.put(`/discipline/staff/${principal.id}/permissions`, { permissions: ['approve_decisions'] });
  sA = await A.mk('Alice Alpha', 'Guardian Alpha'); sB = await B.mk('Bob Beta', 'Guardian Beta');
  cat = (await A.admin.get('/discipline/categories')).data[0].id;
  today = new Date().toISOString().slice(0, 10); yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
});
test.after(() => app.stop());

let inc;
test('a teacher reports an incident about a student in their own class', async () => {
  const r = await reporter.c.post('/discipline/incidents', body());
  assert.equal(r.status, 200, JSON.stringify(r.data)); inc = r.data.id;
  const d = (await reporter.c.get(`/discipline/incidents/${inc}`)).data;
  assert.equal(d.status, 'reported'); assert.equal(d.student.full_name, 'Alice Alpha'); assert.equal(d.class_label, 'Form 1A'); assert.equal(d.witnesses[0].name, 'Mr Tabi');
  assert.equal(d.occurred_date, yesterday); assert.equal(d.occurred_time, '09:30'); assert.equal(d.can_edit, true); assert.equal(d.can_change_status, false);
});

test('bad input is refused: future date, bad time, short text, unknown or other-school student/category', async () => {
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  for (const bad of [{ occurred_date: tomorrow }, { occurred_time: '25:00' }, { description: 'no' }, { student_id: 999999 }, { student_id: sB.id }, { category_id: 999999 }, { witnesses: 'x' }]) {
    assert.equal((await reporter.c.post('/discipline/incidents', body(bad))).status, 400, JSON.stringify(bad));
  }
  const otherSchoolCat = (await B.admin.get('/discipline/categories')).data[0].id;
  assert.equal((await reporter.c.post('/discipline/incidents', body({ category_id: otherSchoolCat }))).status, 400);
  // a switched-off category cannot be used
  const off = (await A.admin.post('/discipline/categories', { name_en: 'Retired' })).data.id; await A.admin.put(`/discipline/categories/${off}`, { active: false });
  assert.equal((await reporter.c.post('/discipline/incidents', body({ category_id: off }))).status, 400);
});

test('a teacher can only pick students from their own classes; officers and the administrator pick from the whole school', async () => {
  assert.equal((await other.c.post('/discipline/incidents', body())).status, 400, 'unassigned teacher cannot report on this student');
  assert.ok((await reporter.c.get('/discipline/students?q=Alice')).data.some((s) => s.id === sA.id));
  assert.equal((await other.c.get('/discipline/students?q=Alice')).data.length, 0);
  assert.ok((await officer.c.get('/discipline/students?q=Alice')).data.some((s) => s.id === sA.id));
  assert.equal((await officer.c.get('/discipline/students?q=Bob')).data.length, 0, 'never another school');
});

test('who can see the incident: reporter, administrator, officer and principal; nobody else', async () => {
  for (const who of [reporter, officer, principal, { c: A.admin }]) assert.equal((await who.c.get(`/discipline/incidents/${inc}`)).status, 200);
  assert.equal((await other.c.get(`/discipline/incidents/${inc}`)).status, 404, 'another teacher');
  assert.equal((await parent.c.get(`/discipline/incidents/${inc}`)).status, 403);
  assert.equal((await parent.c.get('/discipline/incidents')).status, 403);
  assert.equal((await B.admin.get(`/discipline/incidents/${inc}`)).status, 404, 'another school');
  assert.equal((await client(app).get(`/discipline/incidents/${inc}`)).status, 401);
  assert.equal((await other.c.get('/discipline/incidents')).data.total, 0);
  assert.equal((await reporter.c.get('/discipline/incidents')).data.total, 1);
  assert.equal((await officer.c.get('/discipline/incidents')).data.total, 1);
  assert.equal((await B.admin.get('/discipline/incidents')).data.total, 0);
});

test('search and filters: student, class, year, date, status, category, name', async () => {
  const q = async (s) => (await A.admin.get(`/discipline/incidents?${s}`)).data.total;
  assert.equal(await q(`student_id=${sA.id}`), 1); assert.equal(await q('student_id=999999'), 0);
  assert.equal(await q(`class_id=${A.cls}`), 1); assert.equal(await q(`year_id=${A.year}`), 1);
  assert.equal(await q(`from=${yesterday}&to=${yesterday}`), 1); assert.equal(await q(`from=${today}`), 0);
  assert.equal(await q('status=reported'), 1); assert.equal(await q('status=closed'), 0);
  assert.equal(await q(`category_id=${cat}`), 1); assert.equal(await q('q=alice'), 1); assert.equal(await q('q=zzz'), 0);
  assert.equal(await q('q=%25'), 0, 'wildcards are not injected');
});

test('edit rules: the reporter edits while "reported"; only officers change status; then the reporter is locked out', async () => {
  assert.equal((await reporter.c.put(`/discipline/incidents/${inc}`, { description: 'Pushed another pupil, twice.' })).status, 200);
  assert.equal((await reporter.c.put(`/discipline/incidents/${inc}`, { status: 'closed' })).status, 403);
  assert.equal((await other.c.put(`/discipline/incidents/${inc}`, { description: 'tampering' })).status, 404);
  assert.equal((await principal.c.put(`/discipline/incidents/${inc}`, { description: 'tampering' })).status, 403, 'principal approves, does not edit');
  assert.equal((await officer.c.put(`/discipline/incidents/${inc}`, { status: 'nonsense' })).status, 400);
  assert.equal((await officer.c.put(`/discipline/incidents/${inc}`, { status: 'under_review' })).status, 200);
  assert.equal((await reporter.c.put(`/discipline/incidents/${inc}`, { description: 'changed later' })).status, 403);
  assert.equal((await B.admin.put(`/discipline/incidents/${inc}`, { status: 'closed' })).status, 404);
  assert.equal((await reporter.c.get(`/discipline/incidents/${inc}`)).data.description, 'Pushed another pupil, twice.');
});

test('supporting documents are private, checked by content and audited', async () => {
  const up = await reporter.c.post(`/discipline/incidents/${inc}/documents`, { name: '../../evil/report.pdf', data: PDF });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal((await reporter.c.post(`/discipline/incidents/${inc}/documents`, { name: 'photo.png', data: PNG })).status, 200);
  assert.equal((await reporter.c.post(`/discipline/incidents/${inc}/documents`, { name: 'virus.pdf', data: EXE })).status, 400, 'content decides, not the name');
  assert.equal((await reporter.c.post(`/discipline/incidents/${inc}/documents`, { name: 'big.pdf', data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64') })).status, 400);
  const d = (await reporter.c.get(`/discipline/incidents/${inc}`)).data;
  assert.equal(d.documents.length, 2); assert.equal(d.documents[0].original_name, 'report.pdf', 'path parts are stripped');
  const dl = await fetch(`${app.base}/api/discipline/incidents/${inc}/documents/${d.documents[0].id}`, { headers: { Cookie: reporter.c.cookie } });
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /^attachment/); assert.equal(dl.headers.get('content-type'), 'application/pdf'); assert.match(dl.headers.get('cache-control'), /no-store/);
  assert.equal((await other.c.get(`/discipline/incidents/${inc}/documents/${d.documents[0].id}`)).status, 404);
  assert.equal((await B.admin.get(`/discipline/incidents/${inc}/documents/${d.documents[0].id}`)).status, 404);
  assert.equal((await parent.c.get(`/discipline/incidents/${inc}/documents/${d.documents[0].id}`)).status, 403);
  assert.equal((await client(app).get(`/discipline/incidents/${inc}/documents/${d.documents[0].id}`)).status, 401);
  // never reachable as a public URL
  const row = await app.h.get('SELECT path FROM incident_documents WHERE id = ?', d.documents[0].id);
  assert.ok(fs.existsSync(row.path)); assert.ok(!row.path.includes('/public/'));
  const guess = await fetch(`${app.base}/uploads/${A.year}/discipline/${row.path.split('/').pop()}`); assert.notEqual(guess.headers.get('content-type'), 'application/pdf');
  // after review started the reporter may add but not remove; an officer may remove
  assert.equal((await reporter.c.del(`/discipline/incidents/${inc}/documents/${d.documents[1].id}`)).status, 403);
  assert.equal((await officer.c.del(`/discipline/incidents/${inc}/documents/${d.documents[1].id}`)).status, 200);
  assert.equal((await reporter.c.get(`/discipline/incidents/${inc}`)).data.documents.length, 1);
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Inc A'")).id;
  const acts = (await app.h.all('SELECT action FROM audit_log WHERE school_id = ?', sid)).map((r) => r.action);
  for (const a of ['discipline_incident_created', 'discipline_incident_updated', 'discipline_incident_status_changed', 'discipline_document_added', 'discipline_document_viewed', 'discipline_document_removed']) assert.ok(acts.includes(a), a);
});

test('student disciplinary history: confidential, filtered, with follow-ups to track conduct', async () => {
  const hist = async (who, id = sA.id, qs = '') => who.c.get(`/discipline/students/${id}/history${qs}`);
  assert.equal((await hist(reporter)).status, 403, 'a reporting teacher has no access to the history');
  assert.equal((await hist(other)).status, 403); assert.equal((await hist(parent)).status, 403);
  assert.equal((await hist({ c: B.admin })).status, 404, 'another school');
  const h1 = (await hist(officer)).data;
  assert.equal(h1.student.full_name, 'Alice Alpha'); assert.equal(h1.summary.incidents, 1); assert.equal(h1.can_record_followup, true);
  assert.equal((await hist(principal)).data.can_record_followup, false);
  assert.equal((await hist({ c: A.admin })).status, 200);
  assert.equal((await hist(officer, sA.id, `?from=${today}`)).data.incidents.length, 0);
  // follow-ups
  const f = await officer.c.post(`/discipline/students/${sA.id}/followups`, { note: 'Met the pupil; apologised.', trend: 'improving', incident_id: inc });
  assert.equal(f.status, 200);
  assert.equal((await principal.c.post(`/discipline/students/${sA.id}/followups`, { note: 'x' })).status, 403);
  assert.equal((await officer.c.post(`/discipline/students/${sA.id}/followups`, { note: '' })).status, 400);
  assert.equal((await officer.c.post(`/discipline/students/${sA.id}/followups`, { note: 'x', trend: 'great' })).status, 400);
  const other2 = await A.mk('Carol Gamma', 'Guardian G');
  assert.equal((await officer.c.post(`/discipline/students/${other2.id}/followups`, { note: 'wrong incident', incident_id: inc })).status, 400, 'incident must belong to this student');
  assert.equal((await officer.c.post(`/discipline/students/${sB.id}/followups`, { note: 'cross school' })).status, 404);
  const h2r = (await hist(officer)).data;
  assert.equal(h2r.followups.length, 1); assert.equal(h2r.summary.latest_trend, 'improving');
  const sid = (await app.h.get("SELECT id FROM schools WHERE name = 'Inc A'")).id;
  assert.ok((await app.h.get("SELECT 1 x FROM audit_log WHERE school_id = ? AND action = 'discipline_history_viewed'", sid)));
});

test('the database itself refuses an incident that mixes two schools', async () => {
  const schoolA = (await app.h.get("SELECT id FROM schools WHERE name = 'Inc A'")).id;
  await assert.rejects(async () => app.h.run("INSERT INTO discipline_incidents (school_id, student_id, occurred_at, category_id, description, reported_by) VALUES (?,?,?,?,?,?)", schoolA, sB.id, '2026-01-01 08:00', cat, 'mixed', reporter.id), /FOREIGN KEY/);
  const catB = (await B.admin.get('/discipline/categories')).data[0].id;
  await assert.rejects(async () => app.h.run("INSERT INTO discipline_incidents (school_id, student_id, occurred_at, category_id, description, reported_by) VALUES (?,?,?,?,?,?)", schoolA, sA.id, '2026-01-01 08:00', catB, 'mixed', reporter.id), /FOREIGN KEY/);
});
