'use strict';
// Staff office directory. Existing authentication roles are deliberately retained;
// department/position metadata is additive and does not silently grant permissions.
const S = require('./security');
const D = require('./departments');
const ADMIN = ['school_admin'];
const STAFF_ROLES = ['school_admin', 'teacher'];
const DEFAULT_DEPARTMENTS = [
  'School Administration', 'Discipline Office', 'Academic Office', 'Student Affairs',
  'Guidance and Counselling', 'Examinations Office', 'Admissions Office', 'Accounts Office',
  'Scholarships Office', 'School Activities', 'Store and School Shop'
];
module.exports = function (app) {
  const { h, route } = app;

  route('GET', '/staff/departments', STAFF_ROLES, async (c) => ({
    departments: await h.all('SELECT d.id, d.name, d.description, d.head_user_id, d.active, u.name head_name FROM departments d LEFT JOIN users u ON u.id = d.head_user_id AND u.school_id = d.school_id WHERE d.school_id = ? ORDER BY d.name', c.schoolId)
  }));

  route('POST', '/staff/departments/seed-defaults', ADMIN, async (c) => {
    let created = 0;
    for (const name of DEFAULT_DEPARTMENTS) {
      const exists = await h.get('SELECT id FROM departments WHERE school_id = ? AND name = ?', c.schoolId, name);
      if (!exists) { await h.run('INSERT INTO departments (school_id, name) VALUES (?,?)', c.schoolId, name); created++; }
    }
    await h.audit(c.schoolId, c.user.id, 'staff_departments_seeded', 'departments', { created });
    return { created };
  });

  route('POST', '/staff/departments', ADMIN, async (c) => {
    const name = S.req(c.body.name, 'name_required', 100);
    const description = S.str(c.body.description, 500) || null;
    const id = await h.insert('INSERT INTO departments (school_id, name, description) VALUES (?,?,?)', c.schoolId, name, description);
    await h.audit(c.schoolId, c.user.id, 'department_created', `department:${id}`);
    return { id };
  });

  route('PUT', '/staff/departments/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const d = id === null ? null : await h.get('SELECT * FROM departments WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!d) throw S.notFound();
    const name = c.body.name === undefined ? d.name : S.req(c.body.name, 'name_required', 100);
    const description = c.body.description === undefined ? d.description : (S.str(c.body.description, 500) || null);
    const active = c.body.active === undefined ? d.active : (c.body.active ? 1 : 0);
    const headId = c.body.head_user_id === undefined ? d.head_user_id : (c.body.head_user_id === null || c.body.head_user_id === '' ? null : S.toInt(c.body.head_user_id));
    if (headId !== null && !await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1", headId, c.schoolId)) throw S.bad('invalid_department_head');
    await h.run('UPDATE departments SET name = ?, description = ?, active = ?, head_user_id = ? WHERE id = ? AND school_id = ?', name, description, active, headId, id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'department_updated', `department:${id}`);
    return { ok: true };
  });

  route('GET', '/staff/directory', ADMIN, async (c) => ({
    staff: await h.all(`SELECT u.id, u.name, u.email, u.active, a.id assignment_id, a.position_title,
      a.department_id, d.name department_name, a.is_department_head, a.active assignment_active
      FROM users u LEFT JOIN staff_assignments a ON a.user_id = u.id AND a.school_id = u.school_id
      LEFT JOIN departments d ON d.id = a.department_id AND d.school_id = a.school_id
      WHERE u.school_id = ? AND u.role = 'teacher' ORDER BY u.name`, c.schoolId)
  }));

  route('PUT', '/staff/:id/assignment', ADMIN, async (c) => {
    const userId = S.toInt(c.params.id);
    const user = userId === null ? null : await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'", userId, c.schoolId);
    if (!user) throw S.notFound();
    const title = S.req(c.body.position_title, 'position_required', 100);
    const deptId = c.body.department_id === null || c.body.department_id === '' ? null : S.toInt(c.body.department_id);
    if (deptId !== null && !await h.get('SELECT id FROM departments WHERE id = ? AND school_id = ? AND active = 1', deptId, c.schoolId)) throw S.bad('invalid_department');
    const head = c.body.is_department_head ? 1 : 0;
    const active = c.body.active === undefined ? 1 : (c.body.active ? 1 : 0);
    const old = await h.get('SELECT id FROM staff_assignments WHERE school_id = ? AND user_id = ?', c.schoolId, userId);
    if (old) await h.run(`UPDATE staff_assignments SET department_id = ?, position_title = ?, is_department_head = ?, active = ?, assigned_by = ?, updated_at = datetime('now') WHERE id = ? AND school_id = ?`, deptId, title, head, active, c.user.id, old.id, c.schoolId);
    else await h.run('INSERT INTO staff_assignments (school_id, user_id, department_id, position_title, is_department_head, active, assigned_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, userId, deptId, title, head, active, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'staff_assignment_updated', `user:${userId}`, { department_id: deptId, position_title: title, is_department_head: !!head });
    return { ok: true };
  });

  route('GET', '/staff/:id/permissions', ADMIN, async (c) => {
    const userId = S.toInt(c.params.id);
    if (userId === null || !await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'", userId, c.schoolId)) throw S.notFound();
    const rows = await h.all('SELECT permission FROM user_permissions WHERE school_id = ? AND user_id = ? ORDER BY permission', c.schoolId, userId);
    return { permissions: rows.map(x => x.permission), available: ['manage_discipline', 'council_member', 'approve_decisions'] };
  });

  route('PUT', '/staff/:id/permissions', ADMIN, async (c) => {
    const userId = S.toInt(c.params.id);
    if (userId === null || !await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'", userId, c.schoolId)) throw S.notFound();
    const allowed = new Set(['manage_discipline', 'council_member', 'approve_decisions']);
    const requested = Array.isArray(c.body.permissions) ? [...new Set(c.body.permissions)] : [];
    if (requested.some(x => !allowed.has(x))) throw S.bad('invalid_permission');
    await h.run('DELETE FROM user_permissions WHERE school_id = ? AND user_id = ?', c.schoolId, userId);
    for (const permission of requested) await h.run('INSERT INTO user_permissions (school_id, user_id, permission, granted_by) VALUES (?,?,?,?)', c.schoolId, userId, permission, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'staff_permissions_updated', `user:${userId}`, { permissions: requested });
    return { ok: true, permissions: requested };
  });

  route('GET', '/staff/my-office', STAFF_ROLES, async (c) => {
    if (c.user.role === 'school_admin') return { role: c.user.role, office: 'School Administration', permissions: ['system_administration', 'staff_management', 'department_management'] };
    const a = await h.get(`SELECT a.position_title, a.is_department_head, d.id department_id, d.name department_name
      FROM staff_assignments a LEFT JOIN departments d ON d.id = a.department_id AND d.school_id = a.school_id
      WHERE a.school_id = ? AND a.user_id = ? AND a.active = 1`, c.schoolId, c.user.id);
    const { permissionsOf } = require('./access');
    const acc = await D.accessOf(h, c.user);
    return { role: c.user.role, assignment: a || null, permissions: [...await permissionsOf(h, c.user)], modules: acc.modules, department_access_enforced: acc.enforced };
  });

  // ---- Department access (the school administrator decides which modules each department may use) ----
  route('GET', '/staff/access-settings', ADMIN, async (c) => {
    const depts = await h.all('SELECT id, name, active FROM departments WHERE school_id = ? ORDER BY name', c.schoolId);
    const out = [];
    for (const d of depts) { const m = await D.modulesForDepartment(h, c.schoolId, d); out.push({ id: d.id, name: d.name, active: d.active, modules: m.modules, custom: m.custom }); }
    return { enforce: await D.isEnforced(h, c.schoolId), all_modules: D.MODULES, ordinary: D.ORDINARY, teaching_positions: D.TEACHING_POSITIONS, departments: out };
  });

  route('PUT', '/staff/access-settings', ADMIN, async (c) => {
    const on = c.body.enforce ? 1 : 0;
    const exists = await h.get('SELECT school_id FROM department_settings WHERE school_id = ?', c.schoolId);
    if (exists) await h.run("UPDATE department_settings SET enforce = ?, updated_by = ?, updated_at = datetime('now') WHERE school_id = ?", on, c.user.id, c.schoolId);
    else await h.run("INSERT INTO department_settings (school_id, enforce, updated_by, updated_at) VALUES (?,?,?,datetime('now'))", c.schoolId, on, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'department_access_' + (on ? 'enabled' : 'disabled'), 'department_settings');
    return { ok: true, enforce: !!on };
  });

  // modules: an array of module keys, or null to go back to the built-in list
  route('PUT', '/staff/departments/:id/modules', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const d = id === null ? null : await h.get('SELECT id, name FROM departments WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!d) throw S.notFound();
    const reset = c.body.modules === null;
    const wanted = reset ? [] : (Array.isArray(c.body.modules) ? [...new Set(c.body.modules)] : null);
    if (wanted === null || wanted.some((m) => !D.MODULES.includes(m))) throw S.bad('invalid_module');
    await h.tx(async () => {
      await h.run('DELETE FROM department_modules WHERE school_id = ? AND department_id = ?', c.schoolId, id);
      if (!reset) {
        await h.run("INSERT INTO department_modules (school_id, department_id, module) VALUES (?,?,'_custom')", c.schoolId, id);
        for (const m of wanted) await h.run('INSERT INTO department_modules (school_id, department_id, module) VALUES (?,?,?)', c.schoolId, id, m);
      }
    });
    await h.audit(c.schoolId, c.user.id, 'department_modules_updated', `department:${id}`, { modules: reset ? 'default' : wanted });
    return { ok: true, modules: reset ? (D.DEFAULTS[d.name] || D.CUSTOM_DEFAULT) : wanted, custom: !reset };
  });
};
