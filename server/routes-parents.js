'use strict';
// Parent Access portal (backend). Reuses students, guardians, report cards, convocations. New here: parent accounts managed by the administrator,
// announcements, attendance, fees with receipts, homework, messages to the administration, official warning notices.
// Every parent endpoint is scoped by A.getVisibleStudent / A.studentScope, so a parent can only ever reach their own linked children.
// Notifications are stored in-app. JAO does not send SMS, WhatsApp or email and never says it did.
const S = require('./security');
const A = require('./access');
const pdf = require('./pdf');

const ADMIN = ['school_admin'], STAFF = ['school_admin', 'teacher'], PARENT = ['parent'], ALL = ['school_admin', 'teacher', 'parent', 'student'];
const METHODS = ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'];
const today = () => new Date().toISOString().slice(0, 10);
const classLabel = (n, s) => (n ? `${n}${s ? (s.length === 1 ? '' : ' ') + s : ''}` : null);
// Phone numbers are compared without spaces, dots, dashes or brackets. Returns null when it is not a phone number.
const normPhone = (v) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s || !S.isPhone(s)) return null; const n = s.replace(/[ ().-]/g, ''); return /^\+?\d{6,16}$/.test(n) ? n : null; };
const isRelationship = (s) => typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 40;

module.exports = function (app) {
  const { h, route } = app;

  // ---------- helpers ----------
  const parentUserIds = async (schoolId, studentId) => (await h.all(`SELECT DISTINCT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id
    JOIN users u ON u.id = g.user_id AND u.school_id = g.school_id WHERE sg.school_id = ? AND sg.student_id = ? AND g.user_id IS NOT NULL AND u.role = 'parent' AND u.active = 1`, schoolId, studentId)).map((r) => r.user_id);
  const tellParents = async (schoolId, studentId, kind, data, link) => { const ids = await parentUserIds(schoolId, studentId); for (const id of ids) await app.notify(schoolId, id, kind, data, link); return ids.length; };
  app.tellParents = tellParents;
  // Short one-line preview of a message, stored with the notification so the bell can show what was written.
  const previewOf = (text) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > 160 ? t.slice(0, 157) + '…' : t; };
  const adminIds = async (schoolId) => (await h.all("SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND active = 1", schoolId)).map((r) => r.id);
  const student = async (c, id) => A.getVisibleStudent(h, c.user, id);
  const staffStudent = async (c, id) => { // administrator: any student of the school; teacher: only students in their own classes
    if (c.user.role === 'school_admin') { const s = await h.get('SELECT * FROM students WHERE id = ? AND school_id = ? AND archived_at IS NULL', S.toInt(id), c.schoolId); if (!s) throw S.notFound(); return s; }
    return A.getVisibleStudent(h, c.user, id);
  };
  const phoneOf = async (userId) => { const r = await h.get('SELECT phone FROM user_phones WHERE user_id = ?', userId); return r ? r.phone : null; };
  const setPhone = async (schoolId, userId, phone) => { await h.run('DELETE FROM user_phones WHERE user_id = ? AND school_id = ?', userId, schoolId); if (phone) await h.run('INSERT INTO user_phones (user_id, school_id, phone) VALUES (?,?,?)', userId, schoolId, phone); };
  const byPhone = (schoolId, phone) => h.get("SELECT u.* FROM users u JOIN user_phones p ON p.user_id = u.id AND p.school_id = u.school_id WHERE u.school_id = ? AND p.phone = ? AND u.role = 'parent'", schoolId, phone);
  const childSql = (alias = 's') => `${alias}.id, ${alias}.full_name, ${alias}.student_code, ${alias}.class_id`;

  // =============================== PARENT ACCOUNTS (administrator) ===============================
  const childrenOf = async (schoolId, userId) => (await h.all(`SELECT s.id student_id, s.full_name, s.student_code, c.name cname, c.section csection, sg.relationship, g.id guardian_id FROM guardians g
    JOIN student_guardians sg ON sg.guardian_id = g.id AND sg.school_id = g.school_id JOIN students s ON s.id = sg.student_id AND s.school_id = sg.school_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE g.school_id = ? AND g.user_id = ? AND s.archived_at IS NULL ORDER BY s.full_name`, schoolId, userId)).map((r) => ({ student_id: r.student_id, full_name: r.full_name, student_code: r.student_code, class_label: classLabel(r.cname, r.csection), relationship: r.relationship, guardian_id: r.guardian_id }));

  route('GET', '/parents', ADMIN, async (c) => {
    const rows = await h.all("SELECT u.id, u.name, u.email, p.phone, u.active, u.last_login FROM users u LEFT JOIN user_phones p ON p.user_id = u.id WHERE u.school_id = ? AND u.role = 'parent' ORDER BY u.name", c.schoolId);
    const out = [];
    for (const u of rows) out.push({ id: u.id, name: u.name, phone: u.phone, email: /@parents\.jao\.invalid$/.test(u.email) ? null : u.email, active: !!u.active, last_login: u.last_login, children: await childrenOf(c.schoolId, u.id) });
    return out;
  });

  // Links one student to a parent account: reuse the student's guardian record with the same phone/email, or create one.
  async function linkChild(c, user, studentId, relationship) {
    const st = await h.get('SELECT id FROM students WHERE id = ? AND school_id = ? AND archived_at IS NULL', S.toInt(studentId), c.schoolId);
    if (!st) throw S.bad('invalid_student');
    if (!isRelationship(relationship)) throw S.bad('invalid_relationship');
    const rel = relationship.trim();
    const existing = await h.get(`SELECT g.id, g.user_id FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id AND sg.school_id = g.school_id
      WHERE sg.school_id = ? AND sg.student_id = ? AND (g.user_id = ? OR (g.phone = ? AND ? IS NOT NULL) OR (LOWER(g.email) = ? AND ? IS NOT NULL))`, c.schoolId, st.id, user.id, user.phone, user.phone, (user.realEmail || '').toLowerCase() || null, user.realEmail || null);
    if (existing) { if (existing.user_id && existing.user_id !== user.id) throw S.bad('guardian_has_account'); await h.run('UPDATE guardians SET user_id = ? WHERE id = ? AND school_id = ?', user.id, existing.id, c.schoolId); return existing.id; }
    const gid = await h.insert('INSERT INTO guardians (school_id, full_name, phone, email, user_id) VALUES (?,?,?,?,?)', c.schoolId, user.name, user.phone || '—', user.realEmail || null, user.id);
    const prim = (await h.get('SELECT COUNT(*) n FROM student_guardians WHERE school_id = ? AND student_id = ?', c.schoolId, st.id)).n === 0 ? 1 : 0;
    await h.run('INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_primary, is_emergency) VALUES (?,?,?,?,?,0)', c.schoolId, st.id, gid, rel, prim);
    return gid;
  }

  route('POST', '/parents', ADMIN, async (c) => {
    const name = S.req(c.body.name, 'name_required', 120);
    const phone = c.body.phone ? normPhone(c.body.phone) : null;
    if (c.body.phone && !phone) throw S.bad('invalid_phone');
    const email = c.body.email ? S.str(c.body.email, 200).toLowerCase() : null;
    if (email && !S.isEmail(email)) throw S.bad('invalid_email');
    if (!phone && !email) throw S.bad('phone_or_email_required');
    const kids = Array.isArray(c.body.children) ? c.body.children : [];
    if (!kids.length || kids.length > 12) throw S.bad('children_required');
    // An existing parent account (same phone or email in THIS school) gets more children instead of a second account.
    for (const k of kids) { // validate everything before anything is created
      if (!k || !await h.get('SELECT 1 FROM students WHERE id = ? AND school_id = ? AND archived_at IS NULL', S.toInt(k.student_id), c.schoolId)) throw S.bad('invalid_student');
      if (!isRelationship(k.relationship)) throw S.bad('invalid_relationship');
    }
    let user = (phone && await byPhone(c.schoolId, phone)) || (email && await h.get("SELECT * FROM users WHERE school_id = ? AND email = ? AND role = 'parent'", c.schoolId, email)) || null;
    let temp = null, created = false;
    if (!user) {
      if (phone && await h.get('SELECT 1 FROM user_phones WHERE school_id = ? AND phone = ?', c.schoolId, phone)) throw S.bad('phone_in_use');
      if (email && await h.get('SELECT 1 FROM users WHERE school_id = ? AND email = ?', c.schoolId, email)) throw S.bad('email_in_use');
      temp = S.randomPassword();
      const login = email || `p${phone.replace(/\D/g, '')}-${c.schoolId}@parents.jao.invalid`;
      const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const id = await h.insert("INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (?,?,?,?,?,'parent',1)", c.schoolId, login, S.hashPassword(temp), name, initials);
      await setPhone(c.schoolId, id, phone);
      user = await h.get('SELECT * FROM users WHERE id = ?', id); created = true;
    }
    const ctx = { ...user, phone: await phoneOf(user.id), realEmail: /@parents\.jao\.invalid$/.test(user.email) ? null : user.email };
    let n = 0;
    await h.tx(async () => { for (const k of kids) { await linkChild(c, ctx, k && k.student_id, k && k.relationship); n++; } });
    await h.audit(c.schoolId, c.user.id, created ? 'parent_registered' : 'parent_children_linked', `user:${user.id}`, { children: n });
    return { id: user.id, created, temporary_password: temp, login_phone: ctx.phone, login_email: ctx.realEmail, school_code: c.school.code, linked: n };
  });

  const parentOf = async (c) => { const id = S.toInt(c.params.id); const u = id === null ? null : await h.get("SELECT * FROM users WHERE id = ? AND school_id = ? AND role = 'parent'", id, c.schoolId); if (!u) throw S.notFound(); u.phone = await phoneOf(u.id); return u; };
  route('PUT', '/parents/:id', ADMIN, async (c) => {
    const u = await parentOf(c);
    const name = c.body.name !== undefined ? S.req(c.body.name, 'name_required', 120) : u.name;
    let phone = u.phone; if (c.body.phone !== undefined) { phone = c.body.phone ? normPhone(c.body.phone) : null; if (c.body.phone && !phone) throw S.bad('invalid_phone'); }
    let email = u.email;
    if (c.body.email !== undefined && c.body.email) { email = S.str(c.body.email, 200).toLowerCase(); if (!S.isEmail(email)) throw S.bad('invalid_email'); }
    if (!phone && /@parents\.jao\.invalid$/.test(email)) throw S.bad('phone_or_email_required');
    if (phone && phone !== u.phone && await h.get('SELECT 1 FROM user_phones WHERE school_id = ? AND phone = ? AND user_id <> ?', c.schoolId, phone, u.id)) throw S.bad('phone_in_use');
    if (email !== u.email && await h.get('SELECT 1 FROM users WHERE school_id = ? AND email = ? AND id <> ?', c.schoolId, email, u.id)) throw S.bad('email_in_use');
    const active = c.body.active !== undefined ? (c.body.active ? 1 : 0) : u.active;
    await h.run('UPDATE users SET name = ?, email = ?, active = ? WHERE id = ? AND school_id = ?', name, email, active, u.id, c.schoolId);
    await setPhone(c.schoolId, u.id, phone);
    if (!active) await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await h.audit(c.schoolId, c.user.id, 'parent_updated', `user:${u.id}`, { active });
  });
  route('POST', '/parents/:id/children', ADMIN, async (c) => {
    const u = await parentOf(c);
    await linkChild(c, { ...u, realEmail: /@parents\.jao\.invalid$/.test(u.email) ? null : u.email }, c.body.student_id, c.body.relationship);
    await h.audit(c.schoolId, c.user.id, 'parent_child_linked', `user:${u.id}`, { student_id: S.toInt(c.body.student_id) });
  });
  route('DELETE', '/parents/:id/children/:sid', ADMIN, async (c) => {
    const u = await parentOf(c); const sid = S.toInt(c.params.sid);
    const links = await h.all('SELECT sg.id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id WHERE sg.school_id = ? AND sg.student_id = ? AND g.user_id = ?', c.schoolId, sid, u.id);
    if (!links.length) throw S.notFound();
    for (const l of links) await h.run('UPDATE guardians SET user_id = NULL WHERE id = (SELECT guardian_id FROM student_guardians WHERE id = ?) AND school_id = ?', l.id, c.schoolId); // the guardian record stays on the student; only the login link is removed
    await h.audit(c.schoolId, c.user.id, 'parent_child_unlinked', `user:${u.id}`, { student_id: sid });
  });
  route('POST', '/parents/:id/reset-password', ADMIN, async (c) => {
    const u = await parentOf(c); const temp = S.randomPassword();
    await h.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND school_id = ?', S.hashPassword(temp), u.id, c.schoolId);
    await h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await h.audit(c.schoolId, c.user.id, 'password_reset', `user:${u.id}`);
    return { temporary_password: temp, school_code: c.school.code, login_phone: u.phone, login_email: /@parents\.jao\.invalid$/.test(u.email) ? null : u.email };
  });

  // Password recovery from the sign-in page. JAO has no SMS/email provider, so this tells the school administrators, who reset the password. The answer never reveals whether the account exists.
  route('POST', '/auth/forgot', 'public', async (c) => {
    const ip = app.clientIp(c.req);
    if (!S.rateLimit(`forgot:${ip}`)) throw new S.HttpError(429, 'too_many_attempts');
    const code = S.str(c.body.school_code, 40), id = S.str(c.body.identifier, 200).toLowerCase();
    const school = code ? await h.get("SELECT id FROM schools WHERE LOWER(code) = LOWER(?) AND status = 'active' AND approval = 'approved'", code) : null;
    const u = school && id ? (id.includes('@') ? await h.get("SELECT id, name FROM users WHERE school_id = ? AND email = ? AND role = 'parent' AND active = 1", school.id, id) : (normPhone(id) ? await byPhone(school.id, normPhone(id)) : null)) : null;
    if (u && u.active) { for (const a of await adminIds(school.id)) await app.notify(school.id, a, 'parent_reset_request', { name: u.name }, '#/parents'); await h.audit(school.id, null, 'parent_reset_requested', `user:${u.id}`); }
    return { ok: true };
  });

  // =============================== PARENT HOME DATA ===============================
  route('GET', '/parent/children', PARENT, async (c) => {
    const sc = A.studentScope(c.user);
    const rows = await h.all(`SELECT s.id, s.full_name, s.student_code, s.photo_file_id, s.class_id, c.name cname, c.section csection FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE ${sc.where} ORDER BY s.full_name`, ...sc.params);
    return rows.map((r) => ({ id: r.id, full_name: r.full_name, student_code: r.student_code, class_label: classLabel(r.cname, r.csection), photo: r.photo_file_id ? `/api/files/${r.photo_file_id}` : null }));
  });
  route('GET', '/parent/children/:id/summary', PARENT, async (c) => {
    const s = await student(c, c.params.id); const yr = await h.get('SELECT year_id FROM students WHERE id = ?', s.id); const n = async (sql, ...p) => (await h.get(sql, ...p)).n;
    const fees = await feeLines(c.schoolId, s.id);
    return { absences: await n("SELECT COUNT(*) n FROM attendance WHERE school_id = ? AND student_id = ? AND status = 'absent'", c.schoolId, s.id), lates: await n("SELECT COUNT(*) n FROM attendance WHERE school_id = ? AND student_id = ? AND status = 'late'", c.schoolId, s.id),
      balance: fees.balance, homework_due: s.class_id ? await n('SELECT COUNT(*) n FROM homework WHERE school_id = ? AND class_id = ? AND due_date >= ?', c.schoolId, s.class_id, today()) : 0,
      warnings: await n('SELECT COUNT(*) n FROM student_warnings WHERE school_id = ? AND student_id = ?', c.schoolId, s.id), meetings: await n("SELECT COUNT(*) n FROM convocations WHERE school_id = ? AND student_id = ? AND status IN ('approved','postponed')", c.schoolId, s.id), year_id: yr ? yr.year_id : null };
  });

  // =============================== ANNOUNCEMENTS ===============================
  route('GET', '/announcements', ALL, async (c) => {
    const aud = c.user.role === 'school_admin' ? "('all','parents')" : c.user.role === 'parent' ? "('all','parents')" : "('all')";
    return (await h.all(`SELECT a.id, a.title, a.body, a.audience, a.important, a.created_at FROM announcements a WHERE a.school_id = ? AND a.audience IN ${aud} ORDER BY a.id DESC LIMIT 100`, c.schoolId)).map((a) => ({ ...a, important: !!a.important }));
  });
  route('POST', '/announcements', ADMIN, async (c) => {
    const title = S.req(c.body.title, 'title_required', 120), body = S.req(c.body.body, 'body_required', 3000);
    const audience = c.body.audience === 'parents' ? 'parents' : 'all', important = c.body.important ? 1 : 0;
    const id = await h.insert('INSERT INTO announcements (school_id, title, body, audience, important, created_by) VALUES (?,?,?,?,?,?)', c.schoolId, title, body, audience, important, c.user.id);
    let n = 0;
    if (important) { const users = await h.all("SELECT id FROM users WHERE school_id = ? AND role = 'parent' AND active = 1", c.schoolId); for (const u of users) { await app.notify(c.schoolId, u.id, 'announcement_important', { title, preview: previewOf(body) }, '#/parent?tab=announcements'); n++; } await h.run('UPDATE announcements SET notified = ? WHERE id = ? AND school_id = ?', n, id, c.schoolId); }
    await h.audit(c.schoolId, c.user.id, 'announcement_published', `announcement:${id}`, { important: !!important });
    return { id, notified: n };
  });
  route('DELETE', '/announcements/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id); const a = id === null ? null : await h.get('SELECT id FROM announcements WHERE id = ? AND school_id = ?', id, c.schoolId); if (!a) throw S.notFound();
    await h.run('DELETE FROM announcements WHERE id = ? AND school_id = ?', id, c.schoolId); await h.audit(c.schoolId, c.user.id, 'announcement_deleted', `announcement:${id}`);
  });

  // =============================== ATTENDANCE ===============================
  route('GET', '/students/:id/attendance', ALL, async (c) => {
    const s = await student(c, c.params.id);
    const rows = await h.all('SELECT id, day, status, minutes_late, note FROM attendance WHERE school_id = ? AND student_id = ? ORDER BY day DESC LIMIT 400', c.schoolId, s.id);
    return { absences: rows.filter((r) => r.status === 'absent').length, lates: rows.filter((r) => r.status === 'late').length, excused: rows.filter((r) => r.status === 'excused').length, rows };
  });
  route('GET', '/classes/:id/attendance', STAFF, async (c) => {
    const day = S.isDate(c.query.day) ? c.query.day : today(); const sc = A.studentScope(c.user);
    const rows = await h.all(`SELECT s.id, s.full_name, s.student_code, a.id attendance_id, a.status, a.minutes_late, a.note FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.school_id = s.school_id AND a.day = ?
      WHERE ${sc.where} AND s.class_id = ? ORDER BY s.full_name`, day, ...sc.params, S.toInt(c.params.id));
    return { day, rows };
  });
  route('POST', '/attendance', STAFF, async (c) => {
    const s = await staffStudent(c, c.body.student_id);
    const day = c.body.day || today(); if (!S.isDate(day) || day > today()) throw S.bad('invalid_date');
    if (!['absent', 'late', 'excused'].includes(c.body.status)) throw S.bad('invalid_status');
    let mins = null; if (c.body.status === 'late') { mins = c.body.minutes_late === undefined || c.body.minutes_late === '' ? null : S.toInt(c.body.minutes_late); if (mins !== null && (mins < 1 || mins > 600)) throw S.bad('invalid_data'); }
    const prev = await h.get('SELECT id, status FROM attendance WHERE school_id = ? AND student_id = ? AND day = ?', c.schoolId, s.id, day);
    if (prev) await h.run('UPDATE attendance SET status = ?, minutes_late = ?, note = ?, recorded_by = ? WHERE id = ? AND school_id = ?', c.body.status, mins, S.str(c.body.note, 200) || null, c.user.id, prev.id, c.schoolId);
    else await h.run('INSERT INTO attendance (school_id, student_id, class_id, day, status, minutes_late, note, recorded_by) VALUES (?,?,?,?,?,?,?,?)', c.schoolId, s.id, s.class_id ?? null, day, c.body.status, mins, S.str(c.body.note, 200) || null, c.user.id);
    let told = 0;
    if ((!prev || prev.status !== c.body.status) && c.body.status !== 'excused') told = await tellParents(c.schoolId, s.id, c.body.status === 'absent' ? 'child_absent' : 'child_late', { student: s.full_name, date: day, minutes: mins }, '#/parent?tab=attendance');
    await h.audit(c.schoolId, c.user.id, 'attendance_recorded', `student:${s.id}`, { day, status: c.body.status });
    return { notified: told };
  });
  route('DELETE', '/attendance/:id', STAFF, async (c) => {
    const id = S.toInt(c.params.id); const a = id === null ? null : await h.get('SELECT id, student_id FROM attendance WHERE id = ? AND school_id = ?', id, c.schoolId); if (!a) throw S.notFound();
    await staffStudent(c, a.student_id).catch(() => { throw S.notFound(); });
    await h.run('DELETE FROM attendance WHERE id = ? AND school_id = ?', id, c.schoolId); await h.audit(c.schoolId, c.user.id, 'attendance_removed', `student:${a.student_id}`);
  });

  // =============================== FEES, PAYMENTS, RECEIPTS ===============================
  async function feeLines(schoolId, studentId) {
    const charges = await h.all(`SELECT f.id, f.title, f.amount, f.due_date, COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.charge_id = f.id AND p.school_id = f.school_id), 0) paid FROM fee_charges f WHERE f.school_id = ? AND f.student_id = ? ORDER BY f.due_date, f.id`, schoolId, studentId);
    const payments = await h.all('SELECT id, charge_id, amount, paid_on, method, reference, receipt_no FROM fee_payments WHERE school_id = ? AND student_id = ? ORDER BY paid_on DESC, id DESC', schoolId, studentId);
    const t = today();
    const lines = charges.map((f) => ({ ...f, balance: Math.max(0, f.amount - f.paid), overdue: f.amount > f.paid && f.due_date < t }));
    return { charges: lines, payments, total: lines.reduce((n, f) => n + f.amount, 0), paid: lines.reduce((n, f) => n + f.paid, 0), balance: lines.reduce((n, f) => n + f.balance, 0) };
  }
  route('GET', '/students/:id/fees', ['school_admin', 'parent', 'student'], async (c) => { const s = await student(c, c.params.id); return feeLines(c.schoolId, s.id); });
  route('GET', '/fees/overview', ADMIN, async (c) => {
    const where = ['s.school_id = ?', 's.archived_at IS NULL'], p = [c.schoolId];
    if (S.toInt(c.query.class_id) !== null) { where.push('s.class_id = ?'); p.push(Number(c.query.class_id)); }
    const rows = await h.all(`SELECT s.id, s.full_name, s.student_code, c.name cname, c.section csection,
      COALESCE((SELECT SUM(f.amount) FROM fee_charges f WHERE f.school_id = s.school_id AND f.student_id = s.id), 0) total,
      COALESCE((SELECT SUM(x.amount) FROM fee_payments x WHERE x.school_id = s.school_id AND x.student_id = s.id), 0) paid,
      (SELECT COUNT(*) FROM fee_charges f2 WHERE f2.school_id = s.school_id AND f2.student_id = s.id AND f2.due_date < ? AND f2.amount > COALESCE((SELECT SUM(y.amount) FROM fee_payments y WHERE y.charge_id = f2.id AND y.school_id = f2.school_id), 0)) overdue
      FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE ${where.join(' AND ')} ORDER BY s.full_name`, today(), ...p);
    const list = rows.map((r) => ({ id: r.id, full_name: r.full_name, student_code: r.student_code, class_label: classLabel(r.cname, r.csection), total: r.total, paid: r.paid, balance: Math.max(0, r.total - r.paid), overdue: r.overdue }));
    const out = c.query.owing === '1' ? list.filter((r) => r.balance > 0) : list;
    return { rows: out, total: list.reduce((n, r) => n + r.total, 0), paid: list.reduce((n, r) => n + r.paid, 0), balance: list.reduce((n, r) => n + r.balance, 0) };
  });
  route('POST', '/fees/charges', ADMIN, async (c) => {
    const title = S.req(c.body.title, 'title_required', 120), amount = S.toInt(c.body.amount);
    if (amount === null || amount < 1 || amount > 1e10) throw S.bad('invalid_amount');
    if (!S.isDate(c.body.due_date)) throw S.bad('invalid_date');
    let ids;
    if (S.toInt(c.body.class_id) !== null) ids = (await h.all('SELECT id FROM students WHERE school_id = ? AND class_id = ? AND archived_at IS NULL', c.schoolId, Number(c.body.class_id))).map((r) => r.id);
    else if (Array.isArray(c.body.student_ids)) { ids = []; for (const raw of new Set(c.body.student_ids.slice(0, 500).map(Number))) { if (await h.get('SELECT 1 FROM students WHERE id = ? AND school_id = ? AND archived_at IS NULL', raw, c.schoolId)) ids.push(raw); } }
    else throw S.bad('students_required');
    if (!ids.length) throw S.bad('students_required');
    let told = 0;
    await h.tx(async () => { for (const sid of ids) await h.run('INSERT INTO fee_charges (school_id, student_id, title, amount, due_date, created_by) VALUES (?,?,?,?,?,?)', c.schoolId, sid, title, amount, c.body.due_date, c.user.id); });
    for (const sid of ids) { const st = await h.get('SELECT full_name FROM students WHERE id = ? AND school_id = ?', sid, c.schoolId); told += await tellParents(c.schoolId, sid, 'fee_charged', { student: st.full_name, title, amount, date: c.body.due_date }, '#/parent?tab=fees'); }
    await h.audit(c.schoolId, c.user.id, 'fee_charge_created', `fee:${title}`, { students: ids.length, amount });
    return { students: ids.length, notified: told };
  });
  route('POST', '/fees/charges/:id/payments', ADMIN, async (c) => {
    const id = S.toInt(c.params.id); const f = id === null ? null : await h.get('SELECT * FROM fee_charges WHERE id = ? AND school_id = ?', id, c.schoolId); if (!f) throw S.notFound();
    const amount = S.toInt(c.body.amount); if (amount === null || amount < 1 || amount > 1e10) throw S.bad('invalid_amount');
    const paid = (await h.get('SELECT COALESCE(SUM(amount),0) n FROM fee_payments WHERE charge_id = ? AND school_id = ?', f.id, c.schoolId)).n;
    if (paid + amount > f.amount) throw S.bad('overpayment');
    const on = c.body.paid_on || today(); if (!S.isDate(on)) throw S.bad('invalid_date');
    if (!METHODS.includes(c.body.method)) throw S.bad('invalid_method');
    const pid = await h.insert('INSERT INTO fee_payments (school_id, charge_id, student_id, amount, paid_on, method, reference, recorded_by) VALUES (?,?,?,?,?,?,?,?)', c.schoolId, f.id, f.student_id, amount, on, c.body.method, S.str(c.body.reference, 80) || null, c.user.id);
    const receipt = `R${on.slice(0, 4)}-${String(pid).padStart(5, '0')}`;
    await h.run('UPDATE fee_payments SET receipt_no = ? WHERE id = ? AND school_id = ?', receipt, pid, c.schoolId);
    const st = await h.get('SELECT full_name FROM students WHERE id = ? AND school_id = ?', f.student_id, c.schoolId);
    await tellParents(c.schoolId, f.student_id, 'fee_paid', { student: st.full_name, amount, receipt }, '#/parent?tab=fees');
    await h.audit(c.schoolId, c.user.id, 'fee_payment_recorded', `payment:${pid}`, { amount });
    return { id: pid, receipt_no: receipt };
  });
  // Reminder: tell the parents of every student with an unpaid charge that is due within a week or already late.
  route('POST', '/fees/remind', ADMIN, async (c) => {
    const limit = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const rows = await h.all(`SELECT f.student_id, s.full_name, SUM(f.amount - COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.charge_id = f.id AND p.school_id = f.school_id), 0)) due FROM fee_charges f JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
      WHERE f.school_id = ? AND f.due_date <= ? AND f.amount > COALESCE((SELECT SUM(p.amount) FROM fee_payments p WHERE p.charge_id = f.id AND p.school_id = f.school_id), 0) GROUP BY f.student_id`, c.schoolId, limit);
    let parents = 0;
    for (const r of rows) parents += await tellParents(c.schoolId, r.student_id, 'fee_due', { student: r.full_name, amount: r.due }, '#/parent?tab=fees');
    await h.audit(c.schoolId, c.user.id, 'fee_reminders_sent', 'fees', { students: rows.length, parents });
    return { students: rows.length, parents };
  });
  route('GET', '/fees/payments/:id/receipt', ['school_admin', 'parent', 'student'], async (c) => {
    const id = S.toInt(c.params.id); const p = id === null ? null : await h.get('SELECT * FROM fee_payments WHERE id = ? AND school_id = ?', id, c.schoolId); if (!p) throw S.notFound();
    const s = await student(c, p.student_id);
    const f = await h.get('SELECT title, amount FROM fee_charges WHERE id = ? AND school_id = ?', p.charge_id, c.schoolId);
    const paidTotal = (await h.get('SELECT COALESCE(SUM(amount),0) n FROM fee_payments WHERE charge_id = ? AND school_id = ?', p.charge_id, c.schoolId)).n;
    const fr = (c.query.lang || c.user.language) === 'fr', pg = new pdf.Page(), L = pg.left;
    const T = fr ? { title: 'REÇU DE PAIEMENT', no: 'Reçu n°', stu: 'Élève', code: 'Matricule', fee: 'Frais', amt: 'Montant payé', date: 'Date', method: 'Mode', ref: 'Référence', bal: 'Solde restant', note: 'Document généré par JAO.' }
      : { title: 'PAYMENT RECEIPT', no: 'Receipt no.', stu: 'Student', code: 'Student ID', fee: 'Fee', amt: 'Amount paid', date: 'Date', method: 'Method', ref: 'Reference', bal: 'Balance remaining', note: 'Document generated by JAO.' };
    let logo = null; // the school's JPEG or PNG logo, if it has one
    if (c.school.logo_file_id) {
      const lf = await h.get("SELECT path, mime FROM files WHERE id = ? AND school_id = ? AND kind = 'school_logo'", c.school.logo_file_id, c.schoolId);
      if (lf && (lf.mime === 'image/jpeg' || lf.mime === 'image/png')) { try { logo = require('node:fs').readFileSync(lf.path); } catch { logo = null; } }
    }
    const linf = logo && pdf.imageInfo(logo);
    if (linf) { const hh = 48, ww = Math.min(72, linf.w * hh / linf.h); pg.logo = { x: L, y: pg.y - hh + 12, w: ww, h: hh }; } else logo = null;
    pg.center(c.school.name, pg.y, 16, true); pg.y -= 26; pg.center(T.title, pg.y, 13, true); pg.y -= 34;
    pg.labelled(T.no, p.receipt_no || String(p.id)); pg.labelled(T.stu, s.full_name); pg.labelled(T.code, s.student_code); pg.labelled(T.fee, f.title); pg.labelled(T.amt, String(p.amount)); pg.labelled(T.date, p.paid_on);
    pg.labelled(T.method, p.method); if (p.reference) pg.labelled(T.ref, p.reference); pg.labelled(T.bal, String(Math.max(0, f.amount - paidTotal)));
    pg.text(T.note, L, 40, 8, false);
    return { __raw: true, body: pdf.build([pg], { title: `${T.title} ${p.receipt_no || p.id}`, logo }), headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="receipt-${p.receipt_no || p.id}.pdf"` } };
  });

  // =============================== HOMEWORK ===============================
  const classAllowed = async (c, classId) => { // administrator: any class; teacher: classes they lead or teach
    const id = S.toInt(classId); if (id === null || !await h.get('SELECT 1 FROM classes WHERE id = ? AND school_id = ?', id, c.schoolId)) return null;
    if (c.user.role === 'school_admin') return id;
    return (await h.get('SELECT 1 FROM classes WHERE id = ? AND school_id = ? AND teacher_id = ? UNION SELECT 1 FROM class_subjects WHERE class_id = ? AND school_id = ? AND teacher_id = ?', id, c.schoolId, c.user.id, id, c.schoolId, c.user.id)) ? id : null;
  };
  route('GET', '/students/:id/homework', ALL, async (c) => {
    const s = await student(c, c.params.id); if (!s.class_id) return [];
    return h.all(`SELECT w.id, w.title, w.description, w.due_date, w.created_at, sj.name subject FROM homework w LEFT JOIN subjects sj ON sj.id = w.subject_id AND sj.school_id = w.school_id
      WHERE w.school_id = ? AND w.class_id = ? AND w.due_date >= date('now','-30 day') ORDER BY w.due_date, w.id`, c.schoolId, s.class_id);
  });
  route('GET', '/classes/:id/homework', STAFF, async (c) => {
    const cid = await classAllowed(c, c.params.id); if (cid === null) throw S.notFound();
    return h.all(`SELECT w.id, w.title, w.description, w.due_date, sj.name subject FROM homework w LEFT JOIN subjects sj ON sj.id = w.subject_id AND sj.school_id = w.school_id WHERE w.school_id = ? AND w.class_id = ? ORDER BY w.due_date DESC, w.id DESC LIMIT 100`, c.schoolId, cid);
  });
  route('POST', '/homework', STAFF, async (c) => {
    const cid = await classAllowed(c, c.body.class_id); if (cid === null) throw S.bad('invalid_class');
    const title = S.req(c.body.title, 'title_required', 160); if (!S.isDate(c.body.due_date)) throw S.bad('invalid_date');
    let subj = null; if (c.body.subject_id) { subj = S.toInt(c.body.subject_id); if (subj === null || !await h.get('SELECT 1 FROM subjects WHERE id = ? AND school_id = ?', subj, c.schoolId)) throw S.bad('invalid_subject'); }
    const id = await h.insert('INSERT INTO homework (school_id, class_id, subject_id, title, description, due_date, created_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, cid, subj, title, S.str(c.body.description, 2000) || null, c.body.due_date, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'homework_created', `homework:${id}`); return { id };
  });
  route('DELETE', '/homework/:id', STAFF, async (c) => {
    const id = S.toInt(c.params.id); const w = id === null ? null : await h.get('SELECT id, class_id FROM homework WHERE id = ? AND school_id = ?', id, c.schoolId); if (!w) throw S.notFound();
    if (await classAllowed(c, w.class_id) === null) throw S.notFound();
    await h.run('DELETE FROM homework WHERE id = ? AND school_id = ?', id, c.schoolId);
  });

  // =============================== WARNING NOTICES (official, sent deliberately by the school) ===============================
  route('POST', '/students/:id/warnings', STAFF, async (c) => {
    await A.requirePerm(h, c.user, 'manage_discipline');
    const s = await staffStudent(c, c.params.id);
    const title = S.req(c.body.title, 'title_required', 120), message = S.req(c.body.message, 'body_required', 2000);
    const id = await h.insert('INSERT INTO student_warnings (school_id, student_id, title, message, issued_on, issued_by) VALUES (?,?,?,?,?,?)', c.schoolId, s.id, title, message, today(), c.user.id);
    const told = await tellParents(c.schoolId, s.id, 'child_warning', { student: s.full_name, title, preview: previewOf(message) }, '#/parent?tab=discipline');
    await h.audit(c.schoolId, c.user.id, 'warning_issued', `student:${s.id}`, { id }); return { id, notified: told };
  });
  route('GET', '/students/:id/warnings', ['school_admin', 'teacher', 'parent'], async (c) => {
    if (c.user.role === 'teacher') await A.requirePerm(h, c.user, 'manage_discipline');
    const s = await (c.user.role === 'parent' ? student(c, c.params.id) : staffStudent(c, c.params.id));
    return h.all('SELECT id, title, message, issued_on FROM student_warnings WHERE school_id = ? AND student_id = ? ORDER BY id DESC', c.schoolId, s.id);
  });

  // =============================== MESSAGES parent <-> administration ===============================
  route('GET', '/messages', PARENT, async (c) => {
    const rows = await h.all('SELECT m.id, m.body, m.from_parent, m.created_at, m.student_id, s.full_name student FROM parent_messages m LEFT JOIN students s ON s.id = m.student_id AND s.school_id = m.school_id WHERE m.school_id = ? AND m.parent_user_id = ? ORDER BY m.id', c.schoolId, c.user.id);
    await h.run('UPDATE parent_messages SET read_at = NOW_TS WHERE school_id = ? AND parent_user_id = ? AND from_parent = 0 AND read_at IS NULL', c.schoolId, c.user.id);
    return rows.map((r) => ({ ...r, from_parent: !!r.from_parent }));
  });
  route('POST', '/messages', PARENT, async (c) => {
    const body = S.req(c.body.body, 'body_required', 2000); let sid = null;
    if (c.body.student_id) sid = (await student(c, c.body.student_id)).id;
    if (!S.rateLimit(`pmsg:${c.user.id}`, 30, 3600e3)) throw new S.HttpError(429, 'too_many_attempts');
    const id = await h.insert('INSERT INTO parent_messages (school_id, parent_user_id, student_id, from_parent, sender_id, body) VALUES (?,?,?,1,?,?)', c.schoolId, c.user.id, sid, c.user.id, body);
    for (const a of await adminIds(c.schoolId)) await app.notify(c.schoolId, a, 'message_from_parent', { name: c.user.name, preview: previewOf(body) }, `#/parents/${c.user.id}/messages`);
    return { id };
  });
  route('GET', '/messages/threads', ADMIN, async (c) => (await h.all(`SELECT u.id parent_id, u.name, (SELECT body FROM parent_messages m2 WHERE m2.parent_user_id = u.id AND m2.school_id = u.school_id ORDER BY m2.id DESC LIMIT 1) last_body,
      (SELECT MAX(created_at) FROM parent_messages m3 WHERE m3.parent_user_id = u.id AND m3.school_id = u.school_id) last_at,
      (SELECT COUNT(*) FROM parent_messages m4 WHERE m4.parent_user_id = u.id AND m4.school_id = u.school_id AND m4.from_parent = 1 AND m4.read_at IS NULL) unread
    FROM users u WHERE u.school_id = ? AND u.role = 'parent' AND EXISTS (SELECT 1 FROM parent_messages m WHERE m.parent_user_id = u.id AND m.school_id = u.school_id) ORDER BY last_at DESC`, c.schoolId)));
  route('GET', '/messages/threads/:pid', ADMIN, async (c) => {
    const pid = S.toInt(c.params.pid); const u = pid === null ? null : await h.get("SELECT id, name FROM users WHERE id = ? AND school_id = ? AND role = 'parent'", pid, c.schoolId); if (!u) throw S.notFound();
    const rows = await h.all('SELECT m.id, m.body, m.from_parent, m.created_at, s.full_name student FROM parent_messages m LEFT JOIN students s ON s.id = m.student_id AND s.school_id = m.school_id WHERE m.school_id = ? AND m.parent_user_id = ? ORDER BY m.id', c.schoolId, u.id);
    await h.run('UPDATE parent_messages SET read_at = NOW_TS WHERE school_id = ? AND parent_user_id = ? AND from_parent = 1 AND read_at IS NULL', c.schoolId, u.id);
    return { parent: u, messages: rows.map((r) => ({ ...r, from_parent: !!r.from_parent })) };
  });
  route('POST', '/messages/threads/:pid', ADMIN, async (c) => {
    const pid = S.toInt(c.params.pid); const u = pid === null ? null : await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'parent'", pid, c.schoolId); if (!u) throw S.notFound();
    const body = S.req(c.body.body, 'body_required', 2000);
    const id = await h.insert('INSERT INTO parent_messages (school_id, parent_user_id, from_parent, sender_id, body) VALUES (?,?,0,?,?)', c.schoolId, u.id, c.user.id, body);
    await app.notify(c.schoolId, u.id, 'message_from_school', { preview: previewOf(body) }, '#/parent?tab=messages'); return { id };
  });
};
