'use strict';
// Who may see which student / grade? ALL privacy decisions live here, on the server.
const { notFound } = require('./security');

// SQL condition (alias `s` = students) limiting a query to the students the user may see.
function studentScope(user) {
  const sid = user.school_id;
  switch (user.role) {
    case 'school_admin':
      return { where: 's.school_id = ? AND s.archived_at IS NULL', params: [sid] };
    case 'teacher':
      return {
        where: `s.school_id = ? AND s.archived_at IS NULL AND s.class_id IN (
          SELECT id FROM classes WHERE school_id = ? AND teacher_id = ?
          UNION SELECT class_id FROM class_subjects WHERE school_id = ? AND teacher_id = ?)`,
        params: [sid, sid, user.id, sid, user.id],
      };
    case 'parent':
      return {
        where: `s.school_id = ? AND s.archived_at IS NULL AND s.id IN (
          SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.school_id = ? AND g.user_id = ?)`,
        params: [sid, sid, user.id],
      };
    case 'student':
      return { where: 's.school_id = ? AND s.archived_at IS NULL AND s.id = ?', params: [sid, user.student_id ?? -1] };
    default:
      return { where: '1 = 0', params: [] };
  }
}

// Returns the student row or throws 404 (same answer for "forbidden" and "does not exist").
async function getVisibleStudent(h, user, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound();
  const sc = studentScope(user);
  const row = await h.get(`SELECT s.* FROM students s WHERE ${sc.where} AND s.id = ?`, ...sc.params, n);
  if (!row) throw notFound();
  return row;
}

// Guardian contact details: only the administrator and the linked parent see them.
// Teachers and students do not.
const canSeeGuardians = (user) => user.role === 'school_admin' || user.role === 'parent';

// Which subjects of a class may this user see grades for? null = no restriction.
async function teacherSubjectRows(h, user) {
  return await h.all('SELECT class_id, subject_id FROM class_subjects WHERE school_id = ? AND teacher_id = ?', user.school_id, user.id);
}

async function canViewAssessment(h, user, assessment) {
  if (user.role === 'school_admin') return true;
  if (user.role === 'teacher') {
    return !!await h.get('SELECT 1 FROM class_subjects WHERE school_id = ? AND class_id = ? AND subject_id = ? AND teacher_id = ?',
      user.school_id, assessment.class_id, assessment.subject_id, user.id);
  }
  return false;
}

// Students and parents only see grades/results of terms the administrator has approved.
async function approvedTerm(h, schoolId, studentId, termId) {
  return !!await h.get("SELECT 1 FROM report_cards WHERE school_id = ? AND student_id = ? AND term_id = ? AND status = 'approved'", schoolId, studentId, termId);
}


// ---- Discipline permissions ----
// The administrator holds every permission. Teachers may REPORT incidents by default. Everything else is granted
// by the administrator, per person, inside that person's own school (table user_permissions).
const GRANTABLE = ['manage_discipline', 'council_member', 'approve_decisions'];
const ALL_PERMS = ['report_incidents', ...GRANTABLE];
async function permissionsOf(h, user) {
  if (!user || !user.school_id) return new Set();
  if (user.role === 'school_admin') return new Set(ALL_PERMS);
  if (user.role !== 'teacher') return new Set();
  const rows = await h.all('SELECT permission FROM user_permissions WHERE school_id = ? AND user_id = ?', user.school_id, user.id);
  return new Set(['report_incidents', ...rows.map((r) => r.permission)]);
}
// Throws 403 unless the user holds at least one of the listed permissions.
async function requirePerm(h, user, ...perms) {
  const have = await permissionsOf(h, user);
  if (!perms.some((p) => have.has(p))) throw require('./security').forbidden();
  return have;
}

module.exports = { studentScope, getVisibleStudent, canSeeGuardians, teacherSubjectRows, canViewAssessment, approvedTerm, GRANTABLE, ALL_PERMS, permissionsOf, requirePerm };
