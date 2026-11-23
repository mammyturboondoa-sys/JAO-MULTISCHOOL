'use strict';
// Term start/end dates: administrator-only, validated, no overlap within a year, private to each school.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, seedSchool, h2 } = require('./helpers');

test('term dates: set, read back, validate, no overlap, clear, school-private, admin-only', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Dates A', 'da@test.local'); await makeSchool(app, 'Dates B', 'db@test.local');
  const A = await seedSchool(app, 'da@test.local', 'DA'); const B = await seedSchool(app, 'db@test.local', 'DB');
  await h2(app, A.teacherId); A.teacher = client(app); assert.equal((await A.teacher.login('teacher.DA@test.local', A.teacherPw)).status, 200);
  const yr = (await A.admin.get('/academic-years')).data.find((y) => y.is_current);
  const t1 = A.term, t2 = (await A.admin.post('/terms', { year_id: yr.id, name: 'Term Two' })).data.id;
  const termsOf = async () => (await A.admin.get('/academic-years')).data.find((y) => y.id === yr.id).terms;

  // no dates yet: the fields are present and empty (existing screens keep working)
  assert.ok((await termsOf()).every((x) => x.starts_on === null && x.ends_on === null));

  assert.equal((await A.admin.put(`/terms/${t1}/dates`, { starts_on: '2026-09-01', ends_on: '2026-12-15' })).status, 200);
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2027-01-05', ends_on: '2027-04-02' })).status, 200);
  const got = await termsOf();
  assert.deepEqual([got.find((x) => x.id === t1).starts_on, got.find((x) => x.id === t1).ends_on], ['2026-09-01', '2026-12-15']);
  // teachers and parents can read them through /academic-years (same route as before)
  assert.equal((await A.teacher.get('/academic-years')).data.find((y) => y.id === yr.id).terms.find((x) => x.id === t2).starts_on, '2027-01-05');

  // validation
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2027-04-02', ends_on: '2027-01-05' })).data.error, 'term_dates_order');
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2027-13-40', ends_on: '2027-04-02' })).status, 400);
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2027-01-05' })).status, 400);                      // only one date
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2026-12-01', ends_on: '2027-02-01' })).data.error, 'term_dates_overlap');
  assert.equal((await A.admin.put(`/terms/${t2}/dates`, { starts_on: '2026-12-16', ends_on: '2027-04-02' })).status, 200); // touching is fine
  // changing a term's own dates is not an overlap with itself
  assert.equal((await A.admin.put(`/terms/${t1}/dates`, { starts_on: '2026-09-02', ends_on: '2026-12-15' })).status, 200);

  // roles and isolation
  assert.equal((await A.teacher.put(`/terms/${t1}/dates`, { starts_on: '2026-09-01', ends_on: '2026-12-15' })).status, 403);
  assert.equal((await B.admin.put(`/terms/${t1}/dates`, { starts_on: '2026-09-01', ends_on: '2026-12-15' })).status, 404);
  assert.ok((await B.admin.get('/academic-years')).data.every((y) => y.terms.every((x) => x.starts_on === null)));

  // clear
  assert.equal((await A.admin.put(`/terms/${t1}/dates`, { starts_on: '', ends_on: '' })).status, 200);
  assert.equal((await termsOf()).find((x) => x.id === t1).starts_on, null);
  // the term can be removed from the database along with its dates only through its school (rows exist for t2)
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM term_dates WHERE school_id <> ?', (await app.h.get("SELECT school_id FROM terms WHERE id = ?", t1)).school_id)).n, 0);
});
