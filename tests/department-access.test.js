'use strict';
// Department-based access: off by default, enforced by the server when switched on, per school, never for the administrator.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, seedSchool, h2 } = require('./helpers');
const D = require('../server/departments');

async function staffMember(app, admin, email, name, position, deptName, deptByName) {
  const u = await admin.post('/users', { role: 'teacher', name, email });
  assert.equal(u.status, 200);
  await h2(app, u.data.id);
  await admin.put(`/staff/${u.data.id}/assignment`, { position_title: position, department_id: deptName ? deptByName[deptName] : null });
  const c = client(app); assert.equal((await c.login(email, u.data.temporary_password)).status, 200);
  return { id: u.data.id, c };
}

test('module mapping: every teacher-reachable path belongs to the right module', () => {
  assert.equal(D.moduleOf('GET', '/discipline/incidents'), 'discipline');
  assert.equal(D.moduleOf('POST', '/students/5/warnings'), 'discipline');
  assert.equal(D.moduleOf('GET', '/scholarship-applications'), 'scholarships');
  assert.equal(D.moduleOf('GET', '/finder'), 'scholarships');
  assert.equal(D.moduleOf('GET', '/classes/3/attendance'), 'school_life');
  assert.equal(D.moduleOf('POST', '/homework'), 'school_life');
  assert.equal(D.moduleOf('GET', '/classes/3'), 'teaching');
  assert.equal(D.moduleOf('GET', '/assessments'), 'teaching');
  assert.equal(D.moduleOf('GET', '/students/9/academics'), 'students');
  assert.equal(D.moduleOf('GET', '/students/9/attendance'), 'school_life');
  for (const p of ['/auth/me', '/notifications', '/dudus/chat', '/overview', '/staff/my-office', '/files/3', '/announcements']) assert.equal(D.moduleOf('GET', p), null, p);
});

test('department access is OFF by default and enforced when switched on', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Dept School', 'dept@test.local');
  const A = await seedSchool(app, 'dept@test.local', 'D');
  const admin = A.admin;
  await admin.post('/staff/departments/seed-defaults');
  const depts = Object.fromEntries((await admin.get('/staff/departments')).data.departments.map((d) => [d.name, d.id]));

  const disc = await staffMember(app, admin, 'disc@test.local', 'Disc Master', 'Discipline Master', 'Discipline Office', depts);
  const adm = await staffMember(app, admin, 'adm@test.local', 'Admissions Clerk', 'Admissions Officer', 'Admissions Office', depts);
  const teach = await staffMember(app, admin, 'teach@test.local', 'Class Teacher', 'Class Teacher', 'Admissions Office', depts);
  const none = await staffMember(app, admin, 'none@test.local', 'Unassigned', 'Other', null, depts);

  // OFF: nobody is restricted
  assert.equal((await adm.c.get('/discipline/incidents')).status, 200);
  assert.equal((await adm.c.get('/scholarship-applications')).status, 200);
  assert.equal((await admin.get('/staff/access-settings')).data.enforce, false);

  // only the administrator may switch it
  assert.equal((await disc.c.put('/staff/access-settings', { enforce: true })).status, 403);
  assert.equal((await admin.put('/staff/access-settings', { enforce: true })).status, 200);

  // ON: Discipline Office → discipline yes, scholarships no
  assert.equal((await disc.c.get('/discipline/incidents')).status, 200);
  const denied = await disc.c.get('/scholarship-applications');
  assert.equal(denied.status, 403); assert.equal(denied.data.error, 'department_access_denied');
  // Admissions Office → students only
  assert.equal((await adm.c.get('/students')).status, 200);
  assert.equal((await adm.c.get('/discipline/incidents')).status, 403);
  assert.equal((await adm.c.get('/classes')).status, 403);
  // a teaching position keeps the ordinary teacher tools even inside another department
  assert.equal((await teach.c.get('/classes')).status, 200);
  assert.equal((await teach.c.get('/discipline/incidents')).status, 200);
  assert.equal((await teach.c.get('/scholarship-applications')).status, 403);
  // unassigned teacher: ordinary tools, no scholarships
  assert.equal((await none.c.get('/classes')).status, 200);
  assert.equal((await none.c.get('/finder')).status, 403);
  // always-allowed routes
  for (const u of [adm, disc, none]) { assert.equal((await u.c.get('/auth/me')).status, 200); assert.equal((await u.c.get('/staff/my-office')).status, 200); assert.equal((await u.c.get('/notifications')).status, 200); }
  // the menu data mirrors the server
  assert.deepEqual((await adm.c.get('/staff/my-office')).data.modules, ['students']);
  // the administrator is never limited
  assert.equal((await admin.get('/discipline/incidents')).status, 200);
  assert.equal((await admin.get('/scholarship-applications')).status, 200);

  // OFF again → everything returns
  await admin.put('/staff/access-settings', { enforce: false });
  assert.equal((await adm.c.get('/discipline/incidents')).status, 200);
});

test('the administrator can customise a department and reset it; changes are school-private', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Cust A', 'custa@test.local'); await makeSchool(app, 'Cust B', 'custb@test.local');
  const A = await seedSchool(app, 'custa@test.local', 'CA'); const B = await seedSchool(app, 'custb@test.local', 'CB');
  for (const S of [A, B]) await S.admin.post('/staff/departments/seed-defaults');
  const dA = Object.fromEntries((await A.admin.get('/staff/departments')).data.departments.map((d) => [d.name, d.id]));
  const dB = Object.fromEntries((await B.admin.get('/staff/departments')).data.departments.map((d) => [d.name, d.id]));
  const u = await staffMember(app, A.admin, 'adm2@test.local', 'Adm', 'Admissions Officer', 'Admissions Office', dA);
  await A.admin.put('/staff/access-settings', { enforce: true });
  assert.equal((await u.c.get('/finder')).status, 403);
  // customise: Admissions Office also gets scholarships
  const put = await A.admin.put(`/staff/departments/${dA['Admissions Office']}/modules`, { modules: ['students', 'scholarships'] });
  assert.equal(put.status, 200); assert.equal(put.data.custom, true);
  assert.equal((await u.c.get('/finder')).status, 200);
  const view = (await A.admin.get('/staff/access-settings')).data.departments.find((d) => d.name === 'Admissions Office');
  assert.deepEqual([...view.modules].sort(), ['scholarships', 'students']); assert.equal(view.custom, true);
  // an empty custom list means no module at all (not "back to default")
  await A.admin.put(`/staff/departments/${dA['Admissions Office']}/modules`, { modules: [] });
  assert.equal((await u.c.get('/students')).status, 403);
  // validation and isolation
  assert.equal((await A.admin.put(`/staff/departments/${dA['Admissions Office']}/modules`, { modules: ['everything'] })).status, 400);
  assert.equal((await A.admin.put(`/staff/departments/${dB['Admissions Office']}/modules`, { modules: ['students'] })).status, 404);
  // school B has not switched it on, and A's switch does not touch B
  assert.equal((await B.admin.get('/staff/access-settings')).data.enforce, false);
  // reset to the standard list
  const reset = await A.admin.put(`/staff/departments/${dA['Admissions Office']}/modules`, { modules: null });
  assert.equal(reset.status, 200); assert.equal(reset.data.custom, false);
  assert.equal((await u.c.get('/students')).status, 200);
  assert.equal((await u.c.get('/finder')).status, 403);
});

test('parents and students are not affected by department access', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Fam School', 'fam@test.local');
  const A = await seedSchool(app, 'fam@test.local', 'F');
  await A.admin.put('/staff/access-settings', { enforce: true });
  const st = await A.mk('Kid F', 'Mum F');
  assert.ok(st.id);
  assert.equal((await A.admin.get('/students')).status, 200);
});
