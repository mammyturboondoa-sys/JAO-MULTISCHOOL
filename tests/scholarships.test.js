'use strict';
// Scholarships, phase 1: school opportunities, visibility, reviewers, school separation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, h2 } = require('./helpers');

let app, A, B, teacher, parent, studentC, sch;
test.before(async () => {
  app = await startTestApp();
  await makeOwner(app);
  await makeSchool(app, 'Sch A', 'admin.sa@test.local'); await makeSchool(app, 'Sch B', 'admin.sb@test.local');
  A = await seedSchool(app, 'admin.sa@test.local', 'A'); B = await seedSchool(app, 'admin.sb@test.local', 'B');
  const mk = async (email, role, name) => { const u = (await A.admin.post('/users', { role, name, email })).data; await h2(app, u.id); const c = client(app); assert.equal((await c.login(email, u.temporary_password)).status, 200); return { id: u.id, c }; };
  teacher = await mk('t.sa@test.local', 'teacher', 'Teach'); parent = await mk('p.sa@test.local', 'parent', 'Par');
});
test.after(() => app.stop());

const BODY = (x = {}) => ({ title: 'Excellence Award', description: 'For top pupils.', category: 'academic_merit', benefits: 'Full tuition for one year.', places: 3, min_average: 15, opens_on: '2020-01-01', closes_on: '2099-12-31', ...x });

test('only the administrator creates; validation', async () => {
  for (const who of [teacher, parent]) assert.equal((await who.c.post('/scholarships', BODY())).status, 403);
  assert.equal((await A.admin.post('/scholarships', BODY({ category: 'lottery' }))).status, 400);
  assert.equal((await A.admin.post('/scholarships', BODY({ places: 0 }))).status, 400);
  assert.equal((await A.admin.post('/scholarships', BODY({ min_average: 25 }))).status, 400, 'above the grading scale');
  assert.equal((await A.admin.post('/scholarships', BODY({ closes_on: '2019-01-01' }))).status, 400, 'closes before it opens');
  assert.equal((await A.admin.post('/scholarships', BODY({ title: '' }))).status, 400);
  assert.equal((await A.admin.post('/scholarships', BODY({ class_ids: [999999] }))).status, 400);
  assert.equal((await A.admin.post('/scholarships', BODY({ class_ids: [B.cls] }))).status, 400, 'class of another school');
  const r = await A.admin.post('/scholarships', BODY({ class_ids: [A.cls] }));
  assert.equal(r.status, 200); sch = r.data.id;
  assert.equal((await A.admin.get(`/scholarships/${sch}`)).data.classes.length, 1);
});

test('drafts are invisible to everyone but the administrator; publishing makes them visible', async () => {
  assert.equal((await teacher.c.get(`/scholarships/${sch}`)).status, 404);
  assert.equal((await parent.c.get('/scholarships')).data.length, 0);
  assert.equal((await B.admin.get(`/scholarships/${sch}`)).status, 404);
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'closed' })).status, 400, 'draft cannot jump to closed');
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'open' })).status, 200);
  for (const who of [teacher, parent]) { const l = (await who.c.get('/scholarships')).data; assert.equal(l.length, 1); assert.equal(l[0].phase, 'open'); }
  assert.equal((await teacher.c.put(`/scholarships/${sch}`, { title: 'x' })).status, 403);
  assert.equal((await B.admin.get('/scholarships')).data.length, 0);
  assert.equal((await B.admin.post(`/scholarships/${sch}/status`, { status: 'suspended' })).status, 404);
  assert.equal((await B.admin.put(`/scholarships/${sch}`, { title: 'hijack' })).status, 404);
});

test('suspend hides from families; deadline shows as passed; closed is final; only drafts are deleted', async () => {
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'suspended' })).status, 200);
  assert.equal((await parent.c.get(`/scholarships/${sch}`)).status, 404);
  assert.equal((await teacher.c.get(`/scholarships/${sch}`)).data.phase, 'suspended');
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'open' })).status, 200);
  assert.equal((await A.admin.put(`/scholarships/${sch}`, { closes_on: '2021-01-01' })).status, 200);
  assert.equal((await parent.c.get(`/scholarships/${sch}`)).data.phase, 'deadline_passed');
  await A.admin.put(`/scholarships/${sch}`, { opens_on: '2090-01-01', closes_on: '2095-01-01' });
  assert.equal((await parent.c.get(`/scholarships/${sch}`)).data.phase, 'upcoming');
  assert.equal((await A.admin.del(`/scholarships/${sch}`)).status, 400, 'published ones are kept');
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'closed' })).status, 200);
  assert.equal((await A.admin.put(`/scholarships/${sch}`, { title: 'again' })).status, 400, 'closed is final');
  assert.equal((await A.admin.post(`/scholarships/${sch}/status`, { status: 'open' })).status, 400);
  const d = (await A.admin.post('/scholarships', BODY({ title: 'Draft only' }))).data.id;
  assert.equal((await A.admin.del(`/scholarships/${d}`)).status, 200);
  assert.equal((await A.admin.get('/scholarships?category=social_support')).data.length, 0);
});

test('reviewers: teachers of this school only; set by administrator only', async () => {
  assert.equal((await teacher.c.get('/scholarships-reviewers')).status, 403);
  assert.equal((await A.admin.put('/scholarships-reviewers', { user_ids: [parent.id] })).status, 400, 'parents cannot review');
  assert.equal((await A.admin.put('/scholarships-reviewers', { user_ids: [B.teacherId] })).status, 400, 'teacher of another school');
  assert.equal((await A.admin.put('/scholarships-reviewers', { user_ids: [teacher.id] })).status, 200);
  const l = (await A.admin.get('/scholarships-reviewers')).data; assert.equal(l.find((x) => x.id === teacher.id).is_reviewer, true);
  assert.equal((await B.admin.get('/scholarships-reviewers')).data.some((x) => x.id === teacher.id), false);
});

test('a scholarship with no minimum average is accepted', async () => {
  const r = await A.admin.post('/scholarships', { title: 'No minimum', description: 'd', category: 'social_support', benefits: 'b' });
  assert.equal(r.status, 200);
  assert.equal((await A.admin.get(`/scholarships/${r.data.id}`)).data.min_average, null);
});
