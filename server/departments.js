'use strict';
// Department-based access for teacher-role staff. The server decides; the menu only mirrors it.
// - Switched OFF by default (department_settings.enforce = 0): nothing changes for any school.
// - Switched ON: a staff member may only use the modules their department allows, plus their ordinary
//   teaching duties when their position is a teaching one. Existing per-person discipline permissions still apply
//   on top (a department opens the module; it never grants extra powers by itself).
// - The school administrator is never limited. Parents, students and the platform owner are not affected.
const S = require('./security');

const MODULES = ['teaching', 'students', 'school_life', 'discipline', 'scholarships'];

// Built-in module lists. A school can replace any of them for its own departments.
const DEFAULTS = {
  'School Administration': MODULES,
  'Discipline Office': ['students', 'discipline', 'school_life'],
  'Academic Office': ['teaching', 'students', 'school_life'],
  'Student Affairs': ['students', 'school_life', 'discipline', 'scholarships'],
  'Guidance and Counselling': ['students', 'discipline', 'scholarships'],
  'Examinations Office': ['teaching', 'students'],
  'Admissions Office': ['students'],
  'Accounts Office': ['students'],
  'Scholarships Office': ['students', 'scholarships'],
  'School Activities': ['school_life'],
  'Store and School Shop': [],
};
const CUSTOM_DEFAULT = ['students'];
// A teacher with no active department, or holding a teaching position, keeps the ordinary teacher toolset.
const ORDINARY = ['teaching', 'students', 'school_life', 'discipline'];
const TEACHING_POSITIONS = ['Class Teacher', 'Subject Teacher'];

// Which module does an API call belong to? null = always allowed (login, notifications, assistant, own office...).
function moduleOf(method, p) {
  if (/^\/discipline(\/|$)/.test(p) || /^\/students\/[^/]+\/warnings$/.test(p)) return 'discipline';
  if (/^\/scholarship/.test(p) || /^\/finder(\/|$)/.test(p)) return 'scholarships';
  if (/^\/attendance(\/|$)/.test(p) || /^\/homework(\/|$)/.test(p) || /^\/classes\/[^/]+\/(attendance|homework)$/.test(p)
    || /^\/students\/[^/]+\/(attendance|homework)$/.test(p)) return 'school_life';
  if (/^\/(classes|subjects|assessments|reports)(\/|$)/.test(p)) return 'teaching';
  if (/^\/students(\/|$)/.test(p)) return 'students';
  return null;
}

async function isEnforced(h, schoolId) {
  const r = await h.get('SELECT enforce FROM department_settings WHERE school_id = ?', schoolId);
  return !!(r && r.enforce);
}

async function modulesForDepartment(h, schoolId, dept) {
  const rows = await h.all('SELECT module FROM department_modules WHERE school_id = ? AND department_id = ?', schoolId, dept.id);
  if (rows.some((r) => r.module === '_custom')) return { modules: rows.map((r) => r.module).filter((m) => MODULES.includes(m)), custom: true };
  return { modules: DEFAULTS[dept.name] || CUSTOM_DEFAULT, custom: false };
}

// Everything the gate and the menu need to know about one teacher-role user.
async function accessOf(h, user) {
  if (user.role === 'school_admin') return { enforced: false, modules: MODULES.slice() };
  if (user.role !== 'teacher' || !user.school_id) return { enforced: false, modules: [] };
  if (!await isEnforced(h, user.school_id)) return { enforced: false, modules: MODULES.slice() };
  const a = await h.get(`SELECT a.position_title, a.active, d.id, d.name, d.active dept_active
    FROM staff_assignments a LEFT JOIN departments d ON d.id = a.department_id AND d.school_id = a.school_id
    WHERE a.school_id = ? AND a.user_id = ?`, user.school_id, user.id);
  const set = new Set();
  if (a && a.active && a.id && a.dept_active) (await modulesForDepartment(h, user.school_id, { id: a.id, name: a.name })).modules.forEach((m) => set.add(m));
  if (!a || !a.active || TEACHING_POSITIONS.includes(a.position_title) || !a.id) ORDINARY.forEach((m) => set.add(m));
  return { enforced: true, modules: MODULES.filter((m) => set.has(m)), department: a && a.name || null, position: a && a.position_title || null };
}

// Called by the router for every authenticated teacher request. Throws 403 `department_access_denied`.
async function gate(h, user, method, apiPath) {
  if (!user || user.role !== 'teacher') return;
  const mod = moduleOf(method, apiPath);
  if (!mod) return;
  const acc = await accessOf(h, user);
  if (!acc.enforced) return;
  if (!acc.modules.includes(mod)) throw new S.HttpError(403, 'department_access_denied');
}

module.exports = { MODULES, DEFAULTS, CUSTOM_DEFAULT, ORDINARY, TEACHING_POSITIONS, moduleOf, isEnforced, modulesForDepartment, accessOf, gate };
