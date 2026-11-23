'use strict';
// The school's logo must reach the places that display it: the signed-in header and the report card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, seedSchool, h2 } = require('./helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('school logo is in /auth/me and on the report card; another school sees none', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Logo A', 'la@test.local'); await makeSchool(app, 'Logo B', 'lb@test.local');
  const A = await seedSchool(app, 'la@test.local', 'LA'); const B = await seedSchool(app, 'lb@test.local', 'LB');
  assert.equal((await A.admin.get('/auth/me')).data.school.logo, null);                       // no logo yet: header keeps the JAO mark
  assert.equal((await A.admin.post('/settings/logo', { image: PNG })).status, 200);
  const me = (await A.admin.get('/auth/me')).data.school;
  assert.match(me.logo, /^\/api\/public\/image\/\d+$/);
  const st = await A.mk('Kid L', 'Mum L');
  const card = (await A.admin.get(`/reports/card?student_id=${st.id}&term_id=${A.term}`)).data;
  assert.equal(card.school.logo, me.logo);
  // teachers see the same logo in their header
  await h2(app, A.teacherId); const tc = client(app); await tc.login('teacher.LA@test.local', A.teacherPw);
  assert.equal((await tc.get('/auth/me')).data.school.logo, me.logo);
  // the other school has its own (empty) logo
  assert.equal((await B.admin.get('/auth/me')).data.school.logo, null);
});
