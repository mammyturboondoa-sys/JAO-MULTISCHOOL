'use strict';
const S = require('./security');
const A = require('./access');
const { mapSeq } = require('./util');
const calc = require('./calc');
const { isEligibleClass } = require('./prefect-defaults');

const ADMIN = ['school_admin'];
const STAFF = ['school_admin', 'teacher'];
const ALL = ['school_admin', 'teacher', 'parent', 'student'];
const STATUSES = ['active', 'transferred', 'graduated'];
const ASSESSMENT_TYPES = ['quiz', 'test', 'assignment', 'oral', 'project', 'exam'];
const classLabel = (name, section) => `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}`;
const photoUrl = (id) => (id ? `/api/files/${id}` : null);

module.exports = function (app) {
  const { h, route } = app;

  // ---------- helpers ----------
  const owned = async (table, id, schoolId) => {
    const n = S.toInt(id);
    if (n === null) return null;
    return await h.get(`SELECT * FROM ${table} WHERE id = ? AND school_id = ?`, n, schoolId);
  };
  const teacherOk = async (schoolId, id) => id == null || !!await h.get("SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1", id, schoolId);
  const history = async (schoolId, studentId, event, details, actor) =>
    await h.run('INSERT INTO student_history (school_id, student_id, event, details, actor_id) VALUES (?,?,?,?,?)', schoolId, studentId, event, details ? JSON.stringify(details) : null, actor);

  // ================= STUDENTS =================
  route('GET', '/students', ALL, async (c) => {
    const sc = A.studentScope(c.user);
    const where = [sc.where], p = [...sc.params];
    const q = S.str(c.query.q, 80);
    if (q) { where.push('(LOWER(s.full_name) LIKE LOWER(?) ESCAPE \'\\\' OR LOWER(s.student_code) LIKE LOWER(?) ESCAPE \'\\\')'); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(like, like); }
    if (c.query.class_id) { where.push('s.class_id = ?'); p.push(Number(c.query.class_id)); }
    if (c.query.year_id) { where.push('s.year_id = ?'); p.push(Number(c.query.year_id)); }
    if (STATUSES.includes(c.query.status)) { where.push('s.status = ?'); p.push(c.query.status); }
    const order = { name: 's.full_name', id: 's.student_code', enrolled: 's.enrolled_on DESC' }[c.query.sort] || 's.full_name';
    const size = Math.min(60, Math.max(1, Number(c.query.page_size) || 12));
    const page = Math.max(1, Number(c.query.page) || 1);
    const total = (await h.get(`SELECT COUNT(*) n FROM students s WHERE ${where.join(' AND ')}`, ...p)).n;
    const rows = await h.all(`SELECT s.id, s.student_code, s.full_name, s.status, s.photo_file_id, c.name cname, c.section csection, y.name year_name
      FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN academic_years y ON y.id = s.year_id
      WHERE ${where.join(' AND ')} ORDER BY ${order}, s.id LIMIT ? OFFSET ?`, ...p, size, (page - 1) * size);
    return { total, page, pages: Math.max(1, Math.ceil(total / size)), rows: rows.map((r) => ({
      id: r.id, student_code: r.student_code, full_name: r.full_name, status: r.status,
      class_label: r.cname ? classLabel(r.cname, r.csection) : null, year_name: r.year_name, photo: photoUrl(r.photo_file_id) })) };
  });

  async function validateStudent(c, b, existing) {
    const v = {};
    v.full_name = S.req(b.full_name, 'full_name_required', 120);
    v.dob = S.str(b.dob, 10);
    if (!S.isDate(v.dob) || v.dob > new Date().toISOString().slice(0, 10)) throw S.bad('invalid_dob');
    const gender = b.gender ?? '';
    if (!['female', 'male', 'other', ''].includes(gender)) throw S.bad('invalid_gender');
    v.gender = gender || null;
    v.birthplace = S.str(b.birthplace, 120) || null;
    v.address = S.str(b.address, 300) || null;
    v.enrolled_on = S.str(b.enrolled_on, 10);
    if (!S.isDate(v.enrolled_on)) throw S.bad('invalid_enrollment_date');
    const cls = await owned('classes', b.class_id, c.schoolId);
    if (!cls) throw S.bad('class_required');
    const year = await owned('academic_years', b.year_id ?? cls.year_id, c.schoolId);
    if (!year || year.id !== cls.year_id) throw S.bad('class_year_mismatch');
    v.class_id = cls.id; v.year_id = year.id;
    if (!existing || existing.class_id !== cls.id) {
      const cnt = (await h.get("SELECT COUNT(*) n FROM students WHERE class_id = ? AND archived_at IS NULL AND status = 'active'", cls.id)).n;
      if (cls.capacity && cnt >= cls.capacity) throw S.bad('class_full');
    }
    v.stream = S.str(b.stream, 60) || null;
    v.previous_school = S.str(b.previous_school, 120) || null;
    v.status = STATUSES.includes(b.status) ? b.status : 'active';
    return v;
  }

  async function normalizeGuardians(c, list, studentId) {
    if (!Array.isArray(list) || list.length < 1) throw S.bad('guardian_required');
    if (list.length > 6) throw S.bad('too_many_guardians');
    const out = await mapSeq(list, async (g) => {
      if (g.existing_guardian_id) {
        const eg = await owned('guardians', g.existing_guardian_id, c.schoolId);
        if (!eg) throw S.bad('invalid_guardian');
        return { guardian_id: eg.id, relationship: S.req(g.relationship, 'relationship_required', 40), primary: !!g.is_primary, emergency: !!g.is_emergency };
      }
      const phone = S.str(g.phone, 30), email = S.str(g.email, 200);
      if (!S.isPhone(phone)) throw S.bad('invalid_phone');
      if (email && !S.isEmail(email)) throw S.bad('invalid_email');
      let gid = null;
      if (g.id) { // an existing guardian of THIS student
        const link = await h.get('SELECT guardian_id FROM student_guardians WHERE student_id = ? AND guardian_id = ? AND school_id = ?', studentId, Number(g.id), c.schoolId);
        if (!link) throw S.bad('invalid_guardian');
        gid = link.guardian_id;
      }
      return { guardian_id: gid, full_name: S.req(g.full_name, 'guardian_name_required', 120), phone, email: email || null, address: S.str(g.address, 300) || null,
        relationship: S.req(g.relationship, 'relationship_required', 40), primary: !!g.is_primary, emergency: !!g.is_emergency };
    });
    if (!out.some((g) => g.primary)) out[0].primary = true;
    if (out.filter((g) => g.primary).length > 1) throw S.bad('one_primary_only');
    return out;
  }
  async function saveGuardians(c, studentId, list) {
    const keep = [];
    for (const g of list) {
      let gid = g.guardian_id;
      if (gid && g.full_name !== undefined) {
        await h.run('UPDATE guardians SET full_name=?, phone=?, email=?, address=? WHERE id=? AND school_id=?', g.full_name, g.phone, g.email, g.address, gid, c.schoolId);
      } else if (!gid) {
        gid = await h.insert('INSERT INTO guardians (school_id, full_name, phone, email, address) VALUES (?,?,?,?,?)', c.schoolId, g.full_name, g.phone, g.email, g.address);
      }
      keep.push(gid);
      await h.run(`INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_primary, is_emergency) VALUES (?,?,?,?,?,?)
        ON CONFLICT(student_id, guardian_id) DO UPDATE SET relationship=excluded.relationship, is_primary=excluded.is_primary, is_emergency=excluded.is_emergency`,
        c.schoolId, studentId, gid, g.relationship, g.primary ? 1 : 0, g.emergency ? 1 : 0);
    }
    await h.run(`DELETE FROM student_guardians WHERE student_id = ? AND school_id = ? AND guardian_id NOT IN (${keep.map(() => '?').join(',')})`, studentId, c.schoolId, ...keep);
  }

  route('POST', '/students', ADMIN, async (c) => {
    const v = await validateStudent(c, c.body, null);
    const guardians = await normalizeGuardians(c, c.body.guardians, null);
    const id = await h.tx(async () => {
      const yr = v.enrolled_on.slice(0, 4);
      const last = await h.get("SELECT student_code FROM students WHERE school_id = ? AND student_code LIKE ? ORDER BY student_code DESC LIMIT 1", c.schoolId, `${yr}-%`);
      const seq = last ? Number(last.student_code.split('-')[1]) + 1 : 1;
      const code = `${yr}-${String(seq).padStart(4, '0')}`;
      const photo = c.body.photo ? await app.saveImage(c.schoolId, 'student_photo', c.body.photo, c.user.id) : null;
      const r = await h.insert(`INSERT INTO students (school_id, student_code, full_name, dob, gender, birthplace, address, enrolled_on, status, previous_school, stream, class_id, year_id, photo_file_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, c.schoolId, code, v.full_name, v.dob, v.gender, v.birthplace, v.address, v.enrolled_on, v.status, v.previous_school, v.stream, v.class_id, v.year_id, photo, c.user.id);
      const sid = r;
      await saveGuardians(c, sid, guardians);
      await history(c.schoolId, sid, 'registered', { class_id: v.class_id, year_id: v.year_id, code }, c.user.id);
      await h.audit(c.schoolId, c.user.id, 'student_created', `student:${sid}`);
      return { id: sid, student_code: code };
    });
    return id;
  }).bodyLimit = 4 * 1024 * 1024;

  route('GET', '/students/:id', ALL, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    const cls = s.class_id ? await h.get('SELECT name, section FROM classes WHERE id = ?', s.class_id) : null;
    const year = s.year_id ? await h.get('SELECT name FROM academic_years WHERE id = ?', s.year_id) : null;
    const out = { id: s.id, student_code: s.student_code, full_name: s.full_name, dob: s.dob, gender: s.gender, birthplace: s.birthplace, address: s.address,
      enrolled_on: s.enrolled_on, status: s.status, previous_school: s.previous_school, stream: s.stream, class_id: s.class_id, year_id: s.year_id,
      class_label: cls ? classLabel(cls.name, cls.section) : null, year_name: year ? year.name : null, photo: photoUrl(s.photo_file_id), can_edit: c.user.role === 'school_admin' };
    if (A.canSeeGuardians(c.user)) {
      out.guardians = (await h.all(`SELECT g.id, g.full_name, g.phone, g.email, g.address, g.user_id, sg.relationship, sg.is_primary, sg.is_emergency
        FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = ? AND sg.school_id = ? ORDER BY sg.is_primary DESC, g.id`, s.id, c.schoolId))
        .map((g) => ({ ...g, is_primary: !!g.is_primary, is_emergency: !!g.is_emergency, user_id: c.user.role === 'school_admin' ? g.user_id : undefined }));
    }
    // Prefect posts of this student (visible to whoever may see the student record, so a parent sees their own child's posts).
    // A post counts as current only while the student is still enrolled in Form 5 / Lower Sixth / Upper Sixth.
    const stillEligible = s.status === 'active' && !s.archived_at && !!cls && isEligibleClass(cls.name);
    out.prefect_posts = (await h.all(`SELECT a.status, p.name_en, p.name_fr, y.name year_name FROM prefect_appointments a
      JOIN prefect_posts p ON p.id = a.post_id AND p.school_id = a.school_id JOIN academic_years y ON y.id = a.year_id AND y.school_id = a.school_id
      WHERE a.school_id = ? AND a.student_id = ? ORDER BY y.name DESC, p.sort_order`, c.schoolId, s.id))
      .map((a) => ({ post_en: a.name_en, post_fr: a.name_fr, year_name: a.year_name, current: a.status === 'active' && stillEligible }));
    return out;
  });

  route('PUT', '/students/:id', ADMIN, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    const v = await validateStudent(c, { ...s, ...c.body }, s);
    const guardians = c.body.guardians ? await normalizeGuardians(c, c.body.guardians, s.id) : null;
    await h.tx(async () => {
      await h.run(`UPDATE students SET full_name=?, dob=?, gender=?, birthplace=?, address=?, enrolled_on=?, status=?, previous_school=?, stream=?, class_id=?, year_id=?, updated_at=NOW_TS WHERE id=? AND school_id=?`,
        v.full_name, v.dob, v.gender, v.birthplace, v.address, v.enrolled_on, v.status, v.previous_school, v.stream, v.class_id, v.year_id, s.id, c.schoolId);
      if (v.class_id !== s.class_id) await history(c.schoolId, s.id, 'class_changed', { from: s.class_id, to: v.class_id }, c.user.id);
      if (v.year_id !== s.year_id) await history(c.schoolId, s.id, 'year_changed', { from: s.year_id, to: v.year_id }, c.user.id);
      if (v.status !== s.status) await history(c.schoolId, s.id, v.status === 'active' ? 'reactivated' : v.status, { from: s.status, to: v.status }, c.user.id);
      if (guardians) await saveGuardians(c, s.id, guardians);
      await h.audit(c.schoolId, c.user.id, 'student_updated', `student:${s.id}`);
    });
  });
  route('POST', '/students/:id/photo', ADMIN, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    const fid = c.body.image ? await app.saveImage(c.schoolId, 'student_photo', c.body.image, c.user.id) : null;
    await h.run('UPDATE students SET photo_file_id = ? WHERE id = ? AND school_id = ?', fid, s.id, c.schoolId);
    await history(c.schoolId, s.id, fid ? 'photo_updated' : 'photo_removed', null, c.user.id);
    return { photo: photoUrl(fid) };
  }).bodyLimit = 4 * 1024 * 1024;
  route('DELETE', '/students/:id', ADMIN, async (c) => { // archive: record and audit trail are kept
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    await h.run("UPDATE students SET archived_at = NOW_TS WHERE id = ? AND school_id = ?", s.id, c.schoolId);
    await history(c.schoolId, s.id, 'archived', null, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'student_archived', `student:${s.id}`);
  });
  route('PUT', '/guardians/:id/account', ADMIN, async (c) => { // link a guardian record to a parent login
    const g = await owned('guardians', c.params.id, c.schoolId);
    if (!g) throw S.notFound();
    const uid = c.body.user_id == null ? null : S.toInt(c.body.user_id);
    if (uid !== null && !await h.get("SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'parent'", uid, c.schoolId)) throw S.bad('invalid_user');
    await h.run('UPDATE guardians SET user_id = ? WHERE id = ? AND school_id = ?', uid, g.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'guardian_account_linked', `guardian:${g.id}`, { user_id: uid });
  });
  route('GET', '/students/:id/history', ALL, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    return (await h.all(`SELECT e.id, e.event, e.details, e.at, u.name AS actor FROM student_history e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.student_id = ? AND e.school_id = ? ORDER BY e.id DESC`, s.id, c.schoolId))
      .map((e) => ({ id: e.id, event: e.event, details: e.details ? JSON.parse(e.details) : null, at: e.at, actor: c.user.role === 'school_admin' ? e.actor : null }));
  });

  // ================= CLASSES =================
  const classRow = (r) => ({ id: r.id, name: r.name, section: r.section, label: classLabel(r.name, r.section), year_id: r.year_id, year_name: r.year_name,
    teacher_id: r.teacher_id, teacher_name: r.teacher_name, capacity: r.capacity, active: !!r.active, students: r.students });
  const CLASS_SQL = `SELECT c.*, y.name year_name, u.name teacher_name,
    (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.archived_at IS NULL) students
    FROM classes c JOIN academic_years y ON y.id = c.year_id LEFT JOIN users u ON u.id = c.teacher_id`;
  const teacherClassFilter = (user) => user.role === 'teacher'
    ? ' AND (c.teacher_id = ? OR c.id IN (SELECT class_id FROM class_subjects WHERE teacher_id = ?))' : '';

  route('GET', '/classes', STAFF, async (c) => {
    const where = ['c.school_id = ?'], p = [c.schoolId];
    if (c.query.year_id) { where.push('c.year_id = ?'); p.push(Number(c.query.year_id)); }
    const q = S.str(c.query.q, 60);
    if (q) { where.push("LOWER(c.name || c.section) LIKE LOWER(?) ESCAPE '\\'"); p.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
    const tp = c.user.role === 'teacher' ? [c.user.id, c.user.id] : [];
    return (await h.all(`${CLASS_SQL} WHERE ${where.join(' AND ')}${teacherClassFilter(c.user)} ORDER BY y.name DESC, c.name, c.section`, ...p, ...tp)).map(classRow);
  });
  async function classBody(c, b, cur) {
    const name = S.req(b.name ?? cur?.name, 'name_required', 60);
    const section = S.str(b.section ?? cur?.section ?? '', 20);
    const year = await owned('academic_years', b.year_id ?? cur?.year_id, c.schoolId);
    if (!year) throw S.bad('invalid_year');
    const teacher = b.teacher_id === undefined ? cur?.teacher_id ?? null : (b.teacher_id === null || b.teacher_id === '' ? null : S.toInt(b.teacher_id));
    if (!await teacherOk(c.schoolId, teacher)) throw S.bad('invalid_teacher');
    const cap = b.capacity === undefined ? cur?.capacity ?? null : (b.capacity === null || b.capacity === '' ? null : S.toInt(b.capacity));
    if (cap !== null && (cap === null || cap < 1 || cap > 500)) throw S.bad('invalid_capacity');
    const active = b.active === undefined ? (cur ? cur.active : 1) : (b.active ? 1 : 0);
    return { name, section, year_id: year.id, teacher, cap, active };
  }
  route('POST', '/classes', ADMIN, async (c) => {
    const v = await classBody(c, c.body, null);
    const r = await h.insert('INSERT INTO classes (school_id, name, section, year_id, teacher_id, capacity, active) VALUES (?,?,?,?,?,?,?)', c.schoolId, v.name, v.section, v.year_id, v.teacher, v.cap, v.active);
    await h.audit(c.schoolId, c.user.id, 'class_created', `class:${r}`);
    return { id: r };
  });
  route('GET', '/classes/:id', STAFF, async (c) => {
    const tp = c.user.role === 'teacher' ? [c.user.id, c.user.id] : [];
    const r = await h.get(`${CLASS_SQL} WHERE c.school_id = ? AND c.id = ?${teacherClassFilter(c.user)}`, c.schoolId, Number(c.params.id), ...tp);
    if (!r) throw S.notFound();
    const sc = A.studentScope(c.user);
    const students = (await h.all(`SELECT s.id, s.student_code, s.full_name, s.status, s.photo_file_id FROM students s WHERE ${sc.where} AND s.class_id = ? ORDER BY s.full_name`, ...sc.params, r.id))
      .map((s) => ({ id: s.id, student_code: s.student_code, full_name: s.full_name, status: s.status, photo: photoUrl(s.photo_file_id) }));
    const subjects = await h.all(`SELECT cs.subject_id, cs.coefficient, cs.teacher_id, sb.name, sb.code, u.name teacher_name FROM class_subjects cs
      JOIN subjects sb ON sb.id = cs.subject_id LEFT JOIN users u ON u.id = cs.teacher_id WHERE cs.class_id = ? AND cs.school_id = ? ORDER BY sb.name`, r.id, c.schoolId);
    return { ...classRow(r), students_list: students, subjects };
  });
  route('PUT', '/classes/:id', ADMIN, async (c) => {
    const cur = await owned('classes', c.params.id, c.schoolId);
    if (!cur) throw S.notFound();
    const v = await classBody(c, c.body, cur);
    await h.run('UPDATE classes SET name=?, section=?, year_id=?, teacher_id=?, capacity=?, active=? WHERE id=? AND school_id=?', v.name, v.section, v.year_id, v.teacher, v.cap, v.active, cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'class_updated', `class:${cur.id}`);
  });
  route('DELETE', '/classes/:id', ADMIN, async (c) => { // deactivate, never destroy linked records
    const cur = await owned('classes', c.params.id, c.schoolId);
    if (!cur) throw S.notFound();
    await h.run('UPDATE classes SET active = 0 WHERE id = ? AND school_id = ?', cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'class_deactivated', `class:${cur.id}`);
  });
  route('PUT', '/classes/:id/subjects', ADMIN, async (c) => {
    const cls = await owned('classes', c.params.id, c.schoolId);
    if (!cls) throw S.notFound();
    const list = Array.isArray(c.body.subjects) ? c.body.subjects : [];
    const seen = new Set();
    const rows = await mapSeq(list, async (x) => {
      const sb = await owned('subjects', x.subject_id, c.schoolId);
      if (!sb || seen.has(sb.id)) throw S.bad('invalid_subject');
      seen.add(sb.id);
      const blank = x.coefficient === undefined || x.coefficient === null || x.coefficient === '';
      const coef = blank ? (sb.default_coefficient ?? null) : Number(x.coefficient);
      if (coef !== null && !(coef > 0 && coef <= 100)) throw S.bad('invalid_coefficient');
      const t = x.teacher_id === undefined || x.teacher_id === null || x.teacher_id === '' ? null : S.toInt(x.teacher_id);
      if (!(await teacherOk(c.schoolId, t))) throw S.bad('invalid_teacher');
      return { subject_id: sb.id, coef, teacher_id: t };
    });
    await h.tx(async () => {
      const existing = (await h.all('SELECT subject_id FROM class_subjects WHERE class_id = ?', cls.id)).map((r) => r.subject_id);
      for (const sid of existing.filter((x) => !seen.has(x))) {
        if (await h.get('SELECT 1 FROM assessments WHERE class_id = ? AND subject_id = ?', cls.id, sid)) throw S.bad('subject_has_assessments');
        await h.run('DELETE FROM class_subjects WHERE class_id = ? AND subject_id = ? AND school_id = ?', cls.id, sid, c.schoolId);
      }
      for (const r of rows) {
        await h.run(`INSERT INTO class_subjects (school_id, class_id, subject_id, coefficient, teacher_id) VALUES (?,?,?,?,?)
          ON CONFLICT(class_id, subject_id) DO UPDATE SET coefficient = excluded.coefficient, teacher_id = excluded.teacher_id`, c.schoolId, cls.id, r.subject_id, r.coef, r.teacher_id);
      }
      await h.audit(c.schoolId, c.user.id, 'class_subjects_updated', `class:${cls.id}`, { count: rows.length });
    });
  });

  // ================= SUBJECTS =================
  route('GET', '/subjects', STAFF, async (c) => {
    const rows = await h.all(`SELECT * FROM subjects WHERE school_id = ?${c.user.role === 'teacher' ? ' AND id IN (SELECT subject_id FROM class_subjects WHERE school_id = ? AND teacher_id = ?)' : ''} ORDER BY name`,
      c.schoolId, ...(c.user.role === 'teacher' ? [c.schoolId, c.user.id] : []));
    const assigned = await h.all(`SELECT cs.subject_id, cs.coefficient, c.name, c.section FROM class_subjects cs JOIN classes c ON c.id = cs.class_id WHERE cs.school_id = ? ORDER BY c.name, c.section`, c.schoolId);
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, description: r.description, default_coefficient: r.default_coefficient, active: !!r.active,
      classes: assigned.filter((a) => a.subject_id === r.id).map((a) => ({ label: classLabel(a.name, a.section), coefficient: a.coefficient })) }));
  });
  function subjectBody(b, cur) {
    const code = S.req(b.code ?? cur?.code, 'code_required', 20).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw S.bad('invalid_code');
    const rawCoef = b.default_coefficient === undefined ? cur?.default_coefficient ?? null : b.default_coefficient;
    const coef = rawCoef === null || rawCoef === '' ? null : Number(rawCoef);
    if (coef !== null && !(coef > 0 && coef <= 100)) throw S.bad('invalid_coefficient');
    return { name: S.req(b.name ?? cur?.name, 'name_required', 80), code, description: S.str(b.description ?? cur?.description ?? '', 300) || null, coef,
      active: b.active === undefined ? (cur ? cur.active : 1) : (b.active ? 1 : 0) };
  }
  route('POST', '/subjects', ADMIN, async (c) => {
    const v = subjectBody(c.body, null);
    const r = await h.insert('INSERT INTO subjects (school_id, name, code, description, default_coefficient, active) VALUES (?,?,?,?,?,?)', c.schoolId, v.name, v.code, v.description, v.coef, v.active);
    await h.audit(c.schoolId, c.user.id, 'subject_created', `subject:${r}`);
    return { id: r };
  });
  route('PUT', '/subjects/:id', ADMIN, async (c) => {
    const cur = await owned('subjects', c.params.id, c.schoolId);
    if (!cur) throw S.notFound();
    const v = subjectBody(c.body, cur);
    await h.run('UPDATE subjects SET name=?, code=?, description=?, default_coefficient=?, active=? WHERE id=? AND school_id=?', v.name, v.code, v.description, v.coef, v.active, cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'subject_updated', `subject:${cur.id}`);
  });
  route('DELETE', '/subjects/:id', ADMIN, async (c) => { // deactivate; history is preserved
    const cur = await owned('subjects', c.params.id, c.schoolId);
    if (!cur) throw S.notFound();
    await h.run('UPDATE subjects SET active = 0 WHERE id = ? AND school_id = ?', cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'subject_deactivated', `subject:${cur.id}`);
  });
  route('GET', '/teachers', ADMIN, async (c) => await h.all("SELECT id, name FROM users WHERE school_id = ? AND role = 'teacher' AND active = 1 ORDER BY name", c.schoolId));

  // ================= GRADES =================
  const termRow = async (schoolId, id) => await h.get('SELECT t.*, y.name year_name FROM terms t JOIN academic_years y ON y.id = t.year_id WHERE t.id = ? AND t.school_id = ?', S.toInt(id), schoolId);
  const assessmentFor = async (c, id) => {
    const a = await owned('assessments', id, c.schoolId);
    if (!a || !await A.canViewAssessment(h, c.user, a)) throw S.notFound();
    return a;
  };

  route('GET', '/assessments', STAFF, async (c) => {
    const where = ['a.school_id = ?'], p = [c.schoolId];
    for (const k of ['class_id', 'subject_id', 'term_id']) if (c.query[k]) { where.push(`a.${k} = ?`); p.push(Number(c.query[k])); }
    if (c.user.role === 'teacher') { where.push('EXISTS (SELECT 1 FROM class_subjects x WHERE x.class_id = a.class_id AND x.subject_id = a.subject_id AND x.teacher_id = ?)'); p.push(c.user.id); }
    return await h.all(`SELECT a.*, (SELECT COUNT(*) FROM grades g WHERE g.assessment_id = a.id) graded FROM assessments a WHERE ${where.join(' AND ')} ORDER BY a.date DESC, a.id DESC`, ...p);
  });
  route('POST', '/assessments', ADMIN, async (c) => {
    const b = c.body;
    const cls = await owned('classes', b.class_id, c.schoolId), sb = await owned('subjects', b.subject_id, c.schoolId), term = await termRow(c.schoolId, b.term_id);
    if (!cls || !sb || !term) throw S.bad('invalid_reference');
    if (!await h.get('SELECT 1 FROM class_subjects WHERE class_id = ? AND subject_id = ?', cls.id, sb.id)) throw S.bad('subject_not_in_class');
    if (term.year_id !== cls.year_id) throw S.bad('term_year_mismatch');
    const max = Number(b.max_score), date = S.str(b.date, 10);
    if (!(max > 0 && max <= 1000)) throw S.bad('invalid_max_score');
    if (!S.isDate(date)) throw S.bad('invalid_date');
    if (!ASSESSMENT_TYPES.includes(b.type)) throw S.bad('invalid_type');
    const r = await h.insert('INSERT INTO assessments (school_id, class_id, subject_id, term_id, name, type, max_score, date, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      c.schoolId, cls.id, sb.id, term.id, S.req(b.name, 'name_required', 80), b.type, max, date, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'assessment_created', `assessment:${r}`);
    return { id: r };
  });
  route('DELETE', '/assessments/:id', ADMIN, async (c) => {
    const a = await assessmentFor(c, c.params.id);
    if (await h.get('SELECT 1 FROM grades WHERE assessment_id = ?', a.id)) throw S.bad('assessment_has_grades');
    await h.run('DELETE FROM assessments WHERE id = ? AND school_id = ?', a.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'assessment_deleted', `assessment:${a.id}`);
  });
  route('GET', '/assessments/:id/sheet', STAFF, async (c) => {
    const a = await assessmentFor(c, c.params.id);
    const students = await h.all(`SELECT s.id, s.student_code, s.full_name, g.score, g.status, g.comment FROM students s
      LEFT JOIN grades g ON g.student_id = s.id AND g.assessment_id = ?
      WHERE s.school_id = ? AND s.class_id = ? AND s.archived_at IS NULL AND s.status = 'active' ORDER BY s.full_name`, a.id, c.schoolId, a.class_id);
    return { assessment: a, students, editable: c.user.role === 'school_admin' };
  });
  route('PUT', '/assessments/:id/grades', ADMIN, async (c) => {
    const a = await assessmentFor(c, c.params.id);
    const entries = Array.isArray(c.body.entries) ? c.body.entries : [];
    if (entries.length > 500) throw S.bad('too_many_entries');
    const prepared = await mapSeq(entries, async (e) => {
      const st = await h.get('SELECT id FROM students WHERE id = ? AND school_id = ? AND class_id = ? AND archived_at IS NULL', S.toInt(e.student_id), c.schoolId, a.class_id);
      if (!st) throw S.bad('invalid_student');
      if (e.clear) return { id: st.id, clear: true };
      const status = ['graded', 'absent', 'excused'].includes(e.status) ? e.status : 'graded';
      let score = null;
      if (status === 'graded') {
        score = Number(e.score);
        if (e.score === '' || e.score === null || !Number.isFinite(score) || score < 0 || score > a.max_score) throw S.bad('score_out_of_range', { max: a.max_score });
      }
      return { id: st.id, score, status, comment: S.str(e.comment, 300) || null };
    });
    await h.tx(async () => {
      for (const e of prepared) {
        const old = await h.get('SELECT score, status FROM grades WHERE assessment_id = ? AND student_id = ?', a.id, e.id);
        if (e.clear) {
          if (old) { await h.run('DELETE FROM grades WHERE assessment_id = ? AND student_id = ? AND school_id = ?', a.id, e.id, c.schoolId); await h.audit(c.schoolId, c.user.id, 'grade_deleted', `assessment:${a.id}/student:${e.id}`, { old }); }
        } else {
          await h.run(`INSERT INTO grades (school_id, assessment_id, student_id, score, status, comment, updated_by) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(assessment_id, student_id) DO UPDATE SET score=excluded.score, status=excluded.status, comment=excluded.comment, updated_by=excluded.updated_by, updated_at=NOW_TS`,
            c.schoolId, a.id, e.id, e.score, e.status, e.comment, c.user.id);
          await h.audit(c.schoolId, c.user.id, old ? 'grade_updated' : 'grade_entered', `assessment:${a.id}/student:${e.id}`, { old: old || null, new: { score: e.score, status: e.status } });
        }
        // Changing a grade after approval returns that report card to draft so it must be re-approved.
        await h.run("UPDATE report_cards SET status = 'draft', approved_at = NULL, approved_by = NULL WHERE student_id = ? AND term_id = ? AND status = 'approved' AND school_id = ?", e.id, a.term_id, c.schoolId);
      }
    });
    return { saved: prepared.length };
  });

  // ================= RESULTS & REPORTS =================
  async function termResult(schoolId, studentId, termId, subjectLimit) {
    const school = await h.get('SELECT grade_scale, rounding, pass_mark FROM schools WHERE id = ?', schoolId);
    const student = await h.get('SELECT class_id FROM students WHERE id = ? AND school_id = ?', studentId, schoolId);
    const graded = await h.all(`SELECT a.id aid, a.name, a.type, a.date, a.max_score, a.class_id, a.subject_id, g.score, g.status, g.comment,
      sb.name sname, sb.code, sb.default_coefficient, cs.coefficient FROM grades g JOIN assessments a ON a.id = g.assessment_id
      JOIN subjects sb ON sb.id = a.subject_id LEFT JOIN class_subjects cs ON cs.class_id = a.class_id AND cs.subject_id = a.subject_id
      WHERE g.student_id = ? AND a.term_id = ? AND g.school_id = ? ORDER BY sb.name, a.date`, studentId, termId, schoolId);
    const missing = student.class_id ? await h.all(`SELECT a.id aid, a.name, a.type, a.date, a.max_score, a.class_id, a.subject_id, NULL score, 'missing' status, NULL comment,
      sb.name sname, sb.code, sb.default_coefficient, cs.coefficient FROM assessments a JOIN subjects sb ON sb.id = a.subject_id
      LEFT JOIN class_subjects cs ON cs.class_id = a.class_id AND cs.subject_id = a.subject_id
      WHERE a.school_id = ? AND a.class_id = ? AND a.term_id = ? AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.assessment_id = a.id AND g.student_id = ?)`, schoolId, student.class_id, termId, studentId) : [];
    const bySubject = new Map();
    for (const r of [...graded, ...missing]) {
      if (subjectLimit && !subjectLimit.some((x) => x.class_id === r.class_id && x.subject_id === r.subject_id)) continue;
      if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, { subject_id: r.subject_id, name: r.sname, code: r.code, coefficient: r.coefficient ?? null, entries: [] });
      bySubject.get(r.subject_id).entries.push({ id: r.aid, name: r.name, type: r.type, date: r.date, max_score: r.max_score, score: r.score, status: r.status, comment: r.comment });
    }
    const subjects = [...bySubject.values()].map((s) => ({ ...s, average: calc.subjectAverage(s.entries, school.grade_scale, school.rounding) }));
    const overall = subjectLimit ? null : calc.weightedAverage(subjects, school.rounding);
    const missing_coefficients = subjectLimit ? [] : calc.missingCoefficients(subjects).map((x) => ({ subject_id: x.subject_id, name: x.name }));
    return { subjects, overall, missing_coefficients, scale: school.grade_scale, pass_mark: school.pass_mark, passed: overall == null ? null : overall >= school.pass_mark };
  }
  async function classAverages(schoolId, classId, termId) {
    const students = await h.all("SELECT id, full_name FROM students WHERE school_id = ? AND class_id = ? AND archived_at IS NULL AND status = 'active' ORDER BY full_name", schoolId, classId);
    return mapSeq(students, async (s) => {
      const r = await termResult(schoolId, s.id, termId, null);
      return { id: s.id, name: s.full_name, average: r.overall, subjects: r.subjects, missing_coefficients: r.missing_coefficients };
    });
  }
  const reportStatus = async (schoolId, sid, tid) => await h.get('SELECT status, comment, approved_at FROM report_cards WHERE school_id = ? AND student_id = ? AND term_id = ?', schoolId, sid, tid);

  // Which (child, term) pairs may this person open? Admin: everything. Parent/student: approved only.
  route('GET', '/reports/terms', ['school_admin', 'parent', 'student'], async (c) => {
    if (c.user.role === 'school_admin') return await h.all("SELECT t.id, t.name, y.name year_name FROM terms t JOIN academic_years y ON y.id = t.year_id WHERE t.school_id = ? ORDER BY y.name DESC, t.position", c.schoolId);
    const sc = A.studentScope(c.user);
    return await h.all(`SELECT rc.student_id, s.full_name, t.id term_id, t.name term_name, y.name year_name FROM report_cards rc
      JOIN students s ON s.id = rc.student_id JOIN terms t ON t.id = rc.term_id JOIN academic_years y ON y.id = t.year_id
      WHERE rc.school_id = ? AND rc.status = 'approved' AND ${sc.where} ORDER BY y.name DESC, t.position`, c.schoolId, ...sc.params);
  });

  // Latest APPROVED overall average of a student (null when nothing is approved or coefficients are missing). Used by scholarship checks.
  app.approvedAverage = async (schoolId, studentId) => {
    const t = await h.get(`SELECT rc.term_id, t.name term_name, y.name year_name FROM report_cards rc JOIN terms t ON t.id = rc.term_id AND t.school_id = rc.school_id
      JOIN academic_years y ON y.id = t.year_id AND y.school_id = t.school_id WHERE rc.school_id = ? AND rc.student_id = ? AND rc.status = 'approved' ORDER BY y.id DESC, t.position DESC LIMIT 1`, schoolId, studentId);
    if (!t) return null;
    const r = await termResult(schoolId, studentId, t.term_id, null);
    if (r.overall == null) return null;
    return { average: r.overall, scale: r.scale, source: `${t.term_name} — ${t.year_name}` };
  };

  route('GET', '/reports/card', ['school_admin', 'parent', 'student'], async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.query.student_id);
    const term = await termRow(c.schoolId, c.query.term_id);
    if (!term) throw S.notFound();
    if (c.user.role !== 'school_admin' && !await A.approvedTerm(h, c.schoolId, s.id, term.id)) throw S.notFound();
    const result = await termResult(c.schoolId, s.id, term.id, null);
    const school = c.school;
    const cls = s.class_id ? await h.get('SELECT name, section FROM classes WHERE id = ?', s.class_id) : null;
    const rc = await reportStatus(c.schoolId, s.id, term.id) || { status: 'draft', comment: null, approved_at: null };
    let rank = null, class_size = null;
    if (school.ranking_enabled && s.class_id) {
      const list = await classAverages(c.schoolId, s.class_id, term.id);
      rank = calc.rank(list).get(s.id) ?? null; class_size = list.filter((x) => x.average != null).length;
    }
    return { school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, logo: school.logo_file_id ? `/api/public/image/${school.logo_file_id}` : null },
      student: { id: s.id, full_name: s.full_name, student_code: s.student_code, class_label: cls ? classLabel(cls.name, cls.section) : null, photo: photoUrl(s.photo_file_id) },
      term: { id: term.id, name: term.name, year_name: term.year_name }, ...result, rank, class_size, report: rc, discipline: await app.reportDiscipline(school, s.id, term.year_id), generated_on: new Date().toISOString().slice(0, 10) };
  });

  route('POST', '/reports/approve', ADMIN, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.body.student_id);
    const term = await termRow(c.schoolId, c.body.term_id);
    if (!term) throw S.bad('invalid_term');
    const approve = c.body.approve !== false;
    if (approve) {
      const r = await termResult(c.schoolId, s.id, term.id, null);
      if (r.missing_coefficients.length) throw S.bad('coefficients_missing', { subjects: r.missing_coefficients.map((x) => x.name) });
      if (r.overall == null) throw S.bad('no_results_to_approve');
    }
    await h.run(`INSERT INTO report_cards (school_id, student_id, term_id, comment, status, approved_by, approved_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(student_id, term_id) DO UPDATE SET comment=excluded.comment, status=excluded.status, approved_by=excluded.approved_by, approved_at=excluded.approved_at`,
      c.schoolId, s.id, term.id, S.str(c.body.comment, 500) || null, approve ? 'approved' : 'draft', approve ? c.user.id : null, approve ? new Date().toISOString() : null);
    await h.audit(c.schoolId, c.user.id, approve ? 'report_approved' : 'report_unapproved', `student:${s.id}/term:${term.id}`);
    if (approve && app.tellParents) await app.tellParents(c.schoolId, s.id, 'report_published', { student: s.full_name, term: term.name }, '#/parent?tab=results');
  });

  route('GET', '/reports/class', ADMIN, async (c) => {
    const cls = await owned('classes', c.query.class_id, c.schoolId), term = await termRow(c.schoolId, c.query.term_id);
    if (!cls || !term) throw S.notFound();
    const list = await classAverages(c.schoolId, cls.id, term.id);
    const ranks = c.school.ranking_enabled ? calc.rank(list) : null;
    const school = await h.get('SELECT pass_mark FROM schools WHERE id = ?', c.schoolId);
    return { class_label: classLabel(cls.name, cls.section), term: { id: term.id, name: term.name, year_name: term.year_name },
      class_average: calc.classAverage(list.map((x) => x.average), c.school.rounding), pass_mark: school.pass_mark,
      students: await mapSeq(list, async (x) => ({ id: x.id, name: x.name, average: x.average, missing_coefficients: x.missing_coefficients.map((m) => m.name), rank: ranks ? ranks.get(x.id) ?? null : null,
        status: ((await reportStatus(c.schoolId, x.id, term.id)) || { status: 'draft' }).status,
        subjects: x.subjects.map((s) => ({ code: s.code, average: s.average })) })) };
  });
  route('POST', '/reports/approve-class', ADMIN, async (c) => {
    const cls = await owned('classes', c.body.class_id, c.schoolId), term = await termRow(c.schoolId, c.body.term_id);
    if (!cls || !term) throw S.notFound();
    let n = 0, skipped = 0;
    await h.tx(async () => {
      for (const s of await classAverages(c.schoolId, cls.id, term.id)) {
        if (s.average == null) { if (s.missing_coefficients.length) skipped++; continue; }
        await h.run(`INSERT INTO report_cards (school_id, student_id, term_id, status, approved_by, approved_at) VALUES (?,?,?, 'approved', ?, ?)
          ON CONFLICT(student_id, term_id) DO UPDATE SET status='approved', approved_by=excluded.approved_by, approved_at=excluded.approved_at`, c.schoolId, s.id, term.id, c.user.id, new Date().toISOString());
        n++;
      }
      await h.audit(c.schoolId, c.user.id, 'class_reports_approved', `class:${cls.id}/term:${term.id}`, { count: n });
    });
    return { approved: n, skipped };
  });

  // Student "Academic Records" tab.
  route('GET', '/students/:id/academics', ALL, async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id);
    const isAdmin = c.user.role === 'school_admin';
    let terms = await h.all(`SELECT DISTINCT t.id, t.name, y.name year_name, t.position FROM terms t JOIN academic_years y ON y.id = t.year_id
      WHERE t.school_id = ? AND (EXISTS (SELECT 1 FROM assessments a JOIN grades g ON g.assessment_id = a.id WHERE a.term_id = t.id AND g.student_id = ?) OR t.year_id = ?)
      ORDER BY y.name DESC, t.position`, c.schoolId, s.id, s.year_id ?? -1);
    if (!isAdmin && c.user.role !== 'teacher') { const keep = []; for (const t of terms) if (await A.approvedTerm(h, c.schoolId, s.id, t.id)) keep.push(t); terms = keep; }
    const sel = terms.find((t) => t.id === Number(c.query.term_id)) || terms[0];
    if (!sel) return { terms: [], selected: null };
    const limit = c.user.role === 'teacher' ? await A.teacherSubjectRows(h, c.user) : null;
    const r = await termResult(c.schoolId, s.id, sel.id, limit);
    const out = { terms, selected: sel.id, ...r, partial: !!limit, report: isAdmin ? await reportStatus(c.schoolId, s.id, sel.id) : undefined,
      can_open_report_card: isAdmin || await A.approvedTerm(h, c.schoolId, s.id, sel.id) };
    if (c.user.role !== 'teacher' && c.school.ranking_enabled && s.class_id) {
      const list = await classAverages(c.schoolId, s.class_id, sel.id);
      out.rank = calc.rank(list).get(s.id) ?? null;
    }
    return out;
  });
};
module.exports.classLabel = classLabel;
