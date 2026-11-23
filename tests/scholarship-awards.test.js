'use strict';
// Scholarships, phase 3: recipients, renewals, history, reports and CSV export.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, teacher, stuC, parC, otherPar, kid, kid2, sch, award;
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Aw A', 'admin.wa@test.local'); await makeSchool(app, 'Aw B', 'admin.wb@test.local');
  A = await seedSchool(app, 'admin.wa@test.local', 'A'); B = await seedSchool(app, 'admin.wb@test.local', 'B');
  const mk = async (email, role, name, extra = {}) => { const u = (await A.admin.post('/users', { role, name, email, ...extra })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200); return { id: u.id, c }; };
  teacher = await mk('t.wa@test.local', 'teacher', 'Teach');
  kid = await A.mk('=Kid Formula', 'G One'); kid2 = await A.mk('Kid Two', 'G Two');
  stuC = await mk('stu.wa@test.local', 'student', 'Kid', { student_id: kid.id }); parC = await mk('par.wa@test.local', 'parent', 'Par'); otherPar = await mk('par2.wa@test.local', 'parent', 'Par2');
  const link = async (kidX, u) => { const g = (await app.h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ?', kidX.id)).guardian_id; await app.h.run('UPDATE guardians SET user_id = ? WHERE id = ?', u.id, g); };
  await link(kid, parC); await link(kid2, otherPar);
  sch = (await A.admin.post('/scholarships', { title: '=Merit Award', description: 'd', category: 'academic_merit', benefits: 'b', places: 2, renewal_conditions: 'Keep an average of 12.' })).data.id;
  await A.admin.post(`/scholarships/${sch}/status`, { status: 'open' });
  for (const k of [kid, kid2]) {
    const owner = k === kid ? stuC : otherPar;
    const id = (await owner.c.post('/scholarship-applications', { scholarship_id: sch, ...(k === kid ? {} : { student_id: k.id }), motivation: 'Please.' })).data.id;
    assert.equal((await owner.c.post(`/scholarship-applications/${id}/submit`)).status, 200);
    k.appId = id;
  }
});
test.after(() => app.stop());

test('approving creates the award automatically; rejecting does not', async () => {
  assert.equal((await A.admin.post(`/scholarship-applications/${kid.appId}/decision`, { decision: 'approved', reason: 'Great.' })).status, 200);
  assert.equal((await A.admin.post(`/scholarship-applications/${kid2.appId}/decision`, { decision: 'rejected', reason: 'Not this time.' })).status, 200);
  const l = (await A.admin.get('/scholarship-awards')).data; assert.equal(l.length, 1); award = l[0].id;
  assert.equal(l[0].status, 'active'); assert.equal(l[0].renewal_conditions, 'Keep an average of 12.');
});

test('who sees awards: admin all, family only their own, teachers none, other school none', async () => {
  assert.equal((await stuC.c.get('/scholarship-awards')).data.length, 1);
  assert.equal((await parC.c.get('/scholarship-awards')).data.length, 1);
  assert.equal((await otherPar.c.get('/scholarship-awards')).data.length, 0);
  assert.equal((await otherPar.c.get(`/scholarship-awards/${award}`)).status, 404);
  assert.equal((await teacher.c.get('/scholarship-awards')).status, 403);
  assert.equal((await B.admin.get('/scholarship-awards')).data.length, 0);
  assert.equal((await B.admin.get(`/scholarship-awards/${award}`)).status, 404);
  assert.equal((await B.admin.post(`/scholarship-awards/${award}/status`, { status: 'suspended', note: 'x' })).status, 404);
  for (const who of [stuC, parC, teacher]) assert.equal((await who.c.post(`/scholarship-awards/${award}/status`, { status: 'suspended', note: 'x' })).status, 403);
});

test('suspend, resume, dates, renewal outcomes, history and notices', async () => {
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/status`, { status: 'suspended' })).data.error, 'note_required');
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/status`, { status: 'suspended', note: 'Conduct review' })).status, 200);
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/status`, { status: 'suspended', note: 'again' })).status, 400, 'already suspended');
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/status`, { status: 'active' })).status, 200);
  assert.equal((await A.admin.put(`/scholarship-awards/${award}`, { valid_from: '2026-09-01', valid_until: '2026-08-01' })).status, 400);
  assert.equal((await A.admin.put(`/scholarship-awards/${award}`, { valid_from: '2026-09-01', valid_until: '2027-06-30' })).status, 200);
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/renewals`, { outcome: 'renewed' })).data.error, 'period_required');
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/renewals`, { period_label: '2027/28', outcome: 'renewed', valid_until: '2028-06-30', note: 'Average 14.' })).status, 200);
  let d = (await A.admin.get(`/scholarship-awards/${award}`)).data; assert.equal(d.valid_until, '2028-06-30'); assert.equal(d.renewals.length, 1);
  // the family sees the history but not the internal suspension note
  const fam = (await parC.c.get(`/scholarship-awards/${award}`)).data;
  assert.doesNotMatch(JSON.stringify(fam), /Conduct review/); assert.ok(fam.events.some((e) => e.event === 'suspended'));
  assert.equal((await stuC.c.get('/notifications')).data.items.some((n) => n.kind === 'scholarship_award_suspended'), true);
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/renewals`, { period_label: '2028/29', outcome: 'not_renewed' })).data.error, 'note_required');
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/renewals`, { period_label: '2028/29', outcome: 'not_renewed', note: 'Average fell below 12.' })).status, 200);
  d = (await A.admin.get(`/scholarship-awards/${award}`)).data; assert.equal(d.status, 'ended');
  assert.equal((await A.admin.post(`/scholarship-awards/${award}/status`, { status: 'active' })).status, 400, 'an ended award stays ended');
  assert.deepEqual(d.events.map((e) => e.event), ['awarded', 'suspended', 'resumed', 'dates_changed', 'renewed', 'not_renewed']);
});

test('reports and CSV: administrator only, correct totals, spreadsheet-formula safe, school separated', async () => {
  for (const who of [stuC, parC, teacher]) { assert.equal((await who.c.get('/scholarship-reports')).status, 403); assert.equal((await who.c.get('/scholarship-reports/export?type=awards')).status, 403); }
  const r = (await A.admin.get('/scholarship-reports')).data;
  assert.equal(r.totals.applications, 2); assert.equal(r.totals.approved, 1); assert.equal(r.totals.rejected, 1); assert.equal(r.totals.active_awards, 0);
  const csv = await A.admin.get('/scholarship-reports/export?type=applications'); assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /attachment/);
  const txt = Buffer.from(csv.data).toString('utf8');
  assert.match(txt, /'=Kid Formula/, 'a name starting with = is neutralised'); assert.match(txt, /'=Merit Award/);
  assert.doesNotMatch(txt, /Please\./, 'motivation text is not exported'); assert.equal(txt.trim().split(/\r?\n/).length, 3);
  assert.equal(Buffer.from((await A.admin.get('/scholarship-reports/export?type=awards')).data).toString('utf8').trim().split(/\r?\n/).length, 2);
  assert.equal((await B.admin.get('/scholarship-reports')).data.totals.applications, 0);
  assert.equal(Buffer.from((await B.admin.get('/scholarship-reports/export?type=applications')).data).toString('utf8').trim().split(/\r?\n/).length, 1, 'header only');
  assert.ok((await app.h.get("SELECT COUNT(*) n FROM audit_log WHERE action = 'scholarship_export'")).n >= 3);
});
