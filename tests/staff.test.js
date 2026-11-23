'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, PW } = require('./helpers');

test('staff departments and office assignments are school-admin-only and additive', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Staff School', 'staff-admin@test.local');
  const admin = client(app); assert.equal((await admin.login('staff-admin@test.local', PW)).status, 200);
  const seeded = await admin.post('/staff/departments/seed-defaults');
  assert.equal(seeded.status, 200); assert.ok(seeded.data.created >= 1);
  const departments = (await admin.get('/staff/departments')).data.departments;
  const discipline = departments.find((d) => d.name === 'Discipline Office'); assert.ok(discipline);
  const teacher = await admin.post('/users', { role: 'teacher', name: 'Discipline Officer', email: 'discipline@test.local' });
  assert.equal(teacher.status, 200);
  const assigned = await admin.put(`/staff/${teacher.data.id}/assignment`, { position_title: 'Senior Discipline Master', department_id: discipline.id, is_department_head: true });
  assert.equal(assigned.status, 200);
  const directory = (await admin.get('/staff/directory')).data.staff;
  assert.equal(directory.find((u) => u.id === teacher.data.id).position_title, 'Senior Discipline Master');
  await app.h.run('UPDATE users SET must_change_password = 0 WHERE id = ?', teacher.data.id);
  const staff = client(app); assert.equal((await staff.login('discipline@test.local', teacher.data.temporary_password)).status, 200);
  const office = await staff.get('/staff/my-office');
  assert.equal(office.status, 200); assert.equal(office.data.assignment.department_name, 'Discipline Office');
  assert.equal((await staff.post('/staff/departments', { name: 'Not allowed' })).status, 403);
});

test('school administrator can grant and revoke discipline permissions per staff member', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Permission School', 'permission-admin@test.local');
  const admin = client(app); assert.equal((await admin.login('permission-admin@test.local', PW)).status, 200);
  const teacher = await admin.post('/users', { role: 'teacher', name: 'Council Officer', email: 'council@test.local' });
  assert.equal(teacher.status, 200);
  const saved = await admin.put(`/staff/${teacher.data.id}/permissions`, { permissions: ['council_member', 'approve_decisions'] });
  assert.equal(saved.status, 200);
  const listed = await admin.get(`/staff/${teacher.data.id}/permissions`);
  assert.deepEqual(listed.data.permissions.sort(), ['approve_decisions', 'council_member']);
  const invalid = await admin.put(`/staff/${teacher.data.id}/permissions`, { permissions: ['system_admin'] });
  assert.equal(invalid.status, 400);
  await admin.put(`/staff/${teacher.data.id}/permissions`, { permissions: [] });
  assert.deepEqual((await admin.get(`/staff/${teacher.data.id}/permissions`)).data.permissions, []);
});
