'use strict';
// Discipline module. Phase 1: setup (categories, sanction types, who may do what, report-card switches).
// Every query is filtered by c.schoolId, which comes from the verified session, never from the browser.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('./security');
const A = require('./access');
const mapSeq = async (list, fn) => { const o = []; for (const x of list) o.push(await fn(x)); return o; };

const ADMIN = ['school_admin'];
const STAFF = ['school_admin', 'teacher'];
const SEVERITIES = ['minor', 'serious'];
const STATUSES = ['reported', 'under_review', 'action_taken', 'closed', 'dismissed'];
const TRENDS = ['improving', 'stable', 'concerning'];
const MAX_DOC = 3 * 1024 * 1024;
const classLabel = (name, section) => (name ? `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}` : null);
const likeOf = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

module.exports = function (app) {
  const { h, route } = app;

  const nameOf = (b, label) => {
    const en = S.str(b.name_en, 120), fr = S.str(b.name_fr, 120);
    if (!en && !fr) throw S.bad(label);
    return { en: en || fr, fr: fr || en }; // a missing translation falls back to the other language
  };

  // ----- who am I allowed to be in this module? -----
  route('GET', '/discipline/me', STAFF, async (c) => ({ permissions: [...await A.permissionsOf(h, c.user)] }));

  // ----- misconduct categories (read: anyone who can report; write: administrator) -----
  route('GET', '/discipline/categories', STAFF, async (c) => {
    await A.requirePerm(h, c.user, ...A.ALL_PERMS);
    const all = c.user.role === 'school_admin' && c.query.all === '1';
    return await h.all(`SELECT id, name_en, name_fr, severity, active FROM discipline_categories WHERE school_id = ? ${all ? '' : 'AND active = 1'} ORDER BY severity DESC, name_en`, c.schoolId);
  });
  route('POST', '/discipline/categories', ADMIN, async (c) => {
    const n = nameOf(c.body, 'name_required');
    const severity = SEVERITIES.includes(c.body.severity) ? c.body.severity : 'minor';
    if (await h.get('SELECT 1 FROM discipline_categories WHERE school_id = ? AND LOWER(name_en) = LOWER(?)', c.schoolId, n.en)) throw S.bad('name_in_use');
    const id = await h.insert('INSERT INTO discipline_categories (school_id, name_en, name_fr, severity) VALUES (?,?,?,?)', c.schoolId, n.en, n.fr, severity);
    await h.audit(c.schoolId, c.user.id, 'discipline_category_created', `discipline_category:${id}`);
    return { id };
  });
  route('PUT', '/discipline/categories/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const cur = id === null ? null : await h.get('SELECT * FROM discipline_categories WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!cur) throw S.notFound();
    const n = c.body.name_en !== undefined || c.body.name_fr !== undefined ? nameOf({ name_en: c.body.name_en ?? cur.name_en, name_fr: c.body.name_fr ?? cur.name_fr }, 'name_required') : { en: cur.name_en, fr: cur.name_fr };
    const severity = c.body.severity === undefined ? cur.severity : (SEVERITIES.includes(c.body.severity) ? c.body.severity : (() => { throw S.bad('invalid_data'); })());
    const active = c.body.active === undefined ? cur.active : (c.body.active ? 1 : 0);
    if (await h.get('SELECT 1 FROM discipline_categories WHERE school_id = ? AND LOWER(name_en) = LOWER(?) AND id <> ?', c.schoolId, n.en, id)) throw S.bad('name_in_use');
    await h.run('UPDATE discipline_categories SET name_en = ?, name_fr = ?, severity = ?, active = ? WHERE id = ? AND school_id = ?', n.en, n.fr, severity, active, id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'discipline_category_updated', `discipline_category:${id}`);
  });

  // ----- sanction types (a list of CHOICES; nothing is ever imposed automatically) -----
  route('GET', '/discipline/sanction-types', STAFF, async (c) => {
    await A.requirePerm(h, c.user, 'manage_discipline', 'council_member', 'approve_decisions');
    const all = c.user.role === 'school_admin' && c.query.all === '1';
    return await h.all(`SELECT id, name_en, name_fr, has_duration, active FROM sanction_types WHERE school_id = ? ${all ? '' : 'AND active = 1'} ORDER BY id`, c.schoolId);
  });
  route('POST', '/discipline/sanction-types', ADMIN, async (c) => {
    const n = nameOf(c.body, 'name_required');
    if (await h.get('SELECT 1 FROM sanction_types WHERE school_id = ? AND LOWER(name_en) = LOWER(?)', c.schoolId, n.en)) throw S.bad('name_in_use');
    const id = await h.insert('INSERT INTO sanction_types (school_id, name_en, name_fr, has_duration) VALUES (?,?,?,?)', c.schoolId, n.en, n.fr, c.body.has_duration ? 1 : 0);
    await h.audit(c.schoolId, c.user.id, 'sanction_type_created', `sanction_type:${id}`);
    return { id };
  });
  route('PUT', '/discipline/sanction-types/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const cur = id === null ? null : await h.get('SELECT * FROM sanction_types WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!cur) throw S.notFound();
    const n = c.body.name_en !== undefined || c.body.name_fr !== undefined ? nameOf({ name_en: c.body.name_en ?? cur.name_en, name_fr: c.body.name_fr ?? cur.name_fr }, 'name_required') : { en: cur.name_en, fr: cur.name_fr };
    const dur = c.body.has_duration === undefined ? cur.has_duration : (c.body.has_duration ? 1 : 0);
    const active = c.body.active === undefined ? cur.active : (c.body.active ? 1 : 0);
    if (await h.get('SELECT 1 FROM sanction_types WHERE school_id = ? AND LOWER(name_en) = LOWER(?) AND id <> ?', c.schoolId, n.en, id)) throw S.bad('name_in_use');
    await h.run('UPDATE sanction_types SET name_en = ?, name_fr = ?, has_duration = ?, active = ? WHERE id = ? AND school_id = ?', n.en, n.fr, dur, active, id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'sanction_type_updated', `sanction_type:${id}`);
  });

  // ----- who may do what (administrator only; only teachers of THIS school can be given permissions) -----
  route('GET', '/discipline/staff', ADMIN, async (c) => {
    const staff = await h.all("SELECT id, name, email FROM users WHERE school_id = ? AND role = 'teacher' AND active = 1 ORDER BY name", c.schoolId);
    const grants = await h.all('SELECT user_id, permission FROM user_permissions WHERE school_id = ?', c.schoolId);
    return staff.map((u) => ({ ...u, permissions: grants.filter((g) => g.user_id === u.id).map((g) => g.permission) }));
  });
  route('PUT', '/discipline/staff/:id/permissions', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const target = id === null ? null : await h.get("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1", id, c.schoolId);
    if (!target) throw S.notFound();
    const wanted = Array.isArray(c.body.permissions) ? [...new Set(c.body.permissions)] : null;
    if (!wanted || wanted.some((p) => !A.GRANTABLE.includes(p))) throw S.bad('invalid_data');
    await h.tx(async () => {
      await h.run('DELETE FROM user_permissions WHERE school_id = ? AND user_id = ?', c.schoolId, id);
      for (const p of wanted) await h.run('INSERT INTO user_permissions (school_id, user_id, permission, granted_by) VALUES (?,?,?,?)', c.schoolId, id, p, c.user.id);
      await h.audit(c.schoolId, c.user.id, 'discipline_permissions_set', `user:${id}`, { permissions: wanted });
    });
  });

  // ----- report-card switches (both OFF until the school turns them on) -----
  route('GET', '/discipline/settings', ADMIN, async (c) => ({ report_show_conduct: !!c.school.report_show_conduct, report_show_decisions: !!c.school.report_show_decisions }));
  route('PUT', '/discipline/settings', ADMIN, async (c) => {
    const conduct = c.body.report_show_conduct === undefined ? c.school.report_show_conduct : (c.body.report_show_conduct ? 1 : 0);
    const decisions = c.body.report_show_decisions === undefined ? c.school.report_show_decisions : (c.body.report_show_decisions ? 1 : 0);
    await h.run('UPDATE schools SET report_show_conduct = ?, report_show_decisions = ? WHERE id = ?', conduct, decisions, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'discipline_settings_updated', `school:${c.schoolId}`, { conduct, decisions });
  });

  // Used by the report card. Returns null unless the school switched something on. Shows ONLY approved / confirmed information:
  // confirmed incident counts (conduct) and approved council decisions with their approved sanctions. Never descriptions,
  // reporters, discussion, findings, follow-up notes, dismissed or still-open incidents.
  app.reportDiscipline = async (school, studentId, yearId) => {
    const conduct = !!school.report_show_conduct, decisions = !!school.report_show_decisions;
    if (!conduct && !decisions) return null;
    const out = {};
    if (conduct) {
      const r = await h.get(`SELECT COUNT(*) n, COALESCE(SUM(k.severity = 'serious'), 0) serious FROM discipline_incidents i
        JOIN discipline_categories k ON k.id = i.category_id AND k.school_id = i.school_id
        WHERE i.school_id = ? AND i.student_id = ? AND i.year_id = ? AND i.status IN ('action_taken','closed')`, school.id, studentId, yearId);
      out.conduct = { incidents: r.n, serious: r.serious };
    }
    if (decisions) {
      const ds = await h.all(`SELECT d.id, d.decision_text, d.decided_on FROM council_decisions d JOIN council_cases k ON k.id = d.case_id AND k.school_id = d.school_id
        WHERE d.school_id = ? AND d.status = 'approved' AND k.student_id = ? AND EXISTS (SELECT 1 FROM council_case_incidents ci JOIN discipline_incidents i ON i.id = ci.incident_id AND i.school_id = ci.school_id
          WHERE ci.case_id = k.id AND ci.school_id = k.school_id AND i.year_id = ?) ORDER BY d.decided_on, d.id`, school.id, studentId, yearId);
      out.decisions = await mapSeq(ds, async (d) => ({ decided_on: d.decided_on, decision_text: d.decision_text,
        sanctions: (await h.all(`SELECT t.name_en, t.name_fr, x.duration_days FROM sanctions x JOIN sanction_types t ON t.id = x.sanction_type_id AND t.school_id = x.school_id
          WHERE x.school_id = ? AND x.decision_id = ? AND x.status = 'approved' ORDER BY x.id`, school.id, d.id)) }));
    }
    return out;
  };

  // =====================================================================================================
  // INCIDENTS (phase 2)
  // Who sees what: administrator, discipline officers and principals see every incident of THEIR school.
  // A teacher sees only the incidents that teacher reported. Parents and students never see any.
  // =====================================================================================================
  const seesAll = (perms) => perms.has('manage_discipline') || perms.has('approve_decisions');
  const canManage = (perms) => perms.has('manage_discipline');

  const INCIDENT_SELECT = `SELECT i.id, i.occurred_at, i.status, i.description, i.reported_by, i.student_id, i.created_at, i.updated_at,
      s.full_name, s.student_code, c.name cname, c.section csection, y.name year_name,
      k.id category_id, k.name_en cat_en, k.name_fr cat_fr, k.severity, u.name reporter
    FROM discipline_incidents i
    JOIN students s ON s.id = i.student_id AND s.school_id = i.school_id
    LEFT JOIN classes c ON c.id = i.class_id AND c.school_id = i.school_id
    LEFT JOIN academic_years y ON y.id = i.year_id AND y.school_id = i.school_id
    JOIN discipline_categories k ON k.id = i.category_id AND k.school_id = i.school_id
    JOIN users u ON u.id = i.reported_by AND u.school_id = i.school_id`;
  const shapeIncident = (r) => ({ id: r.id, occurred_at: r.occurred_at, status: r.status, student: { id: r.student_id, full_name: r.full_name, student_code: r.student_code },
    class_label: classLabel(r.cname, r.csection), year_name: r.year_name, category: { id: r.category_id, name_en: r.cat_en, name_fr: r.cat_fr, severity: r.severity }, reporter: r.reporter });

  // The incident, if THIS user may see it; otherwise the same 404 as "does not exist".
  async function visibleIncident(c, perms) {
    const id = S.toInt(c.params.id);
    const row = id === null ? null : await h.get(`${INCIDENT_SELECT} WHERE i.id = ? AND i.school_id = ?`, id, c.schoolId);
    if (!row) throw S.notFound();
    if (!(seesAll(perms) || c.user.role === 'school_admin' || row.reported_by === c.user.id)) throw S.notFound();
    return row;
  }

  // Students this person may pick in the incident form: teachers their own classes; officers/administrator the whole school.
  route('GET', '/discipline/students', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline');
    const q = S.str(c.query.q, 80);
    const wide = c.user.role === 'school_admin' || seesAll(perms);
    const sc = wide ? { where: 's.school_id = ? AND s.archived_at IS NULL', params: [c.schoolId] } : A.studentScope(c.user);
    const where = [sc.where], p = [...sc.params];
    if (q) { where.push("(LOWER(s.full_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.student_code) LIKE LOWER(?) ESCAPE '\\')"); p.push(likeOf(q), likeOf(q)); }
    const rows = await h.all(`SELECT s.id, s.full_name, s.student_code, c.name cname, c.section csection FROM students s
      LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id WHERE ${where.join(' AND ')} ORDER BY s.full_name LIMIT 20`, ...p);
    return rows.map((r) => ({ id: r.id, full_name: r.full_name, student_code: r.student_code, class_label: classLabel(r.cname, r.csection) }));
  });

  route('GET', '/discipline/classes', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'approve_decisions');
    void perms;
    const rows = await h.all('SELECT c.id, c.name, c.section, y.name year_name FROM classes c LEFT JOIN academic_years y ON y.id = c.year_id AND y.school_id = c.school_id WHERE c.school_id = ? ORDER BY y.name DESC, c.name, c.section', c.schoolId);
    return rows.map((r) => ({ id: r.id, label: classLabel(r.name, r.section), year_name: r.year_name }));
  });

  route('GET', '/discipline/incidents', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const where = ['i.school_id = ?'], p = [c.schoolId];
    if (!(c.user.role === 'school_admin' || seesAll(perms))) { where.push('i.reported_by = ?'); p.push(c.user.id); }
    const q = c.query;
    if (S.toInt(q.student_id) !== null) { where.push('i.student_id = ?'); p.push(Number(q.student_id)); }
    if (S.toInt(q.class_id) !== null) { where.push('i.class_id = ?'); p.push(Number(q.class_id)); }
    if (S.toInt(q.year_id) !== null) { where.push('i.year_id = ?'); p.push(Number(q.year_id)); }
    if (S.toInt(q.category_id) !== null) { where.push('i.category_id = ?'); p.push(Number(q.category_id)); }
    if (STATUSES.includes(q.status)) { where.push('i.status = ?'); p.push(q.status); }
    if (S.isDate(q.from)) { where.push('i.occurred_at >= ?'); p.push(`${q.from} 00:00`); }
    if (S.isDate(q.to)) { where.push('i.occurred_at <= ?'); p.push(`${q.to} 23:59`); }
    const text = S.str(q.q, 80);
    if (text) { where.push("(LOWER(s.full_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.student_code) LIKE LOWER(?) ESCAPE '\\')"); p.push(likeOf(text), likeOf(text)); }
    const size = Math.min(50, Math.max(1, Number(q.page_size) || 20)), page = Math.max(1, Number(q.page) || 1);
    const from = INCIDENT_SELECT.slice(INCIDENT_SELECT.indexOf('FROM discipline_incidents'));
    const total = (await h.get(`SELECT COUNT(*) n ${from} WHERE ${where.join(' AND ')}`, ...p)).n;
    const rows = await h.all(`${INCIDENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.occurred_at DESC, i.id DESC LIMIT ? OFFSET ?`, ...p, size, (page - 1) * size);
    return { total, page, page_size: size, items: rows.map(shapeIncident) };
  });

  const cleanWitnesses = (list) => {
    if (list === undefined) return null;
    if (!Array.isArray(list) || list.length > 10) throw S.bad('invalid_data');
    return list.map((w) => ({ name: S.req(w && w.name, 'name_required', 120), note: S.str(w && w.note, 300) || null }));
  };
  const incidentFields = (b, cur) => {
    const date = b.occurred_date !== undefined ? b.occurred_date : cur.date, time = b.occurred_time !== undefined ? b.occurred_time : cur.time;
    if (!S.isDate(date) || date > new Date().toISOString().slice(0, 10)) throw S.bad('invalid_date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) throw S.bad('invalid_time');
    const description = b.description !== undefined ? S.str(b.description, 4000) : cur.description;
    if (!description || description.length < 5) throw S.bad('description_required');
    return { occurred_at: `${date} ${time}`, description };
  };
  const activeCategory = async (schoolId, id) => {
    const n = S.toInt(id);
    const row = n === null ? null : await h.get('SELECT id FROM discipline_categories WHERE id = ? AND school_id = ? AND active = 1', n, schoolId);
    if (!row) throw S.bad('invalid_category');
    return row.id;
  };

  route('POST', '/discipline/incidents', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents');
    const b = c.body;
    const sid = S.toInt(b.student_id);
    const wide = c.user.role === 'school_admin' || seesAll(perms);
    const student = sid === null ? null : (wide
      ? await h.get('SELECT id, class_id, year_id FROM students WHERE id = ? AND school_id = ? AND archived_at IS NULL', sid, c.schoolId)
      : await A.getVisibleStudent(h, c.user, sid).catch(() => null));
    if (!student) throw S.bad('invalid_student');
    const f = incidentFields(b, {});
    const category = await activeCategory(c.schoolId, b.category_id);
    const witnesses = cleanWitnesses(b.witnesses) || [];
    const id = await h.tx(async () => {
      const iid = await h.insert('INSERT INTO discipline_incidents (school_id, student_id, class_id, year_id, occurred_at, category_id, description, reported_by) VALUES (?,?,?,?,?,?,?,?)',
        c.schoolId, student.id, student.class_id ?? null, student.year_id ?? null, f.occurred_at, category, f.description, c.user.id);
      for (const w of witnesses) await h.run('INSERT INTO incident_witnesses (school_id, incident_id, name, note) VALUES (?,?,?,?)', c.schoolId, iid, w.name, w.note);
      await h.audit(c.schoolId, c.user.id, 'discipline_incident_created', `discipline_incident:${iid}`, { student_id: student.id });
      return iid;
    });
    return { id };
  });

  const docsOf = (incidentId, schoolId) => h.all('SELECT id, original_name, mime, size, created_at FROM incident_documents WHERE incident_id = ? AND school_id = ? ORDER BY id', incidentId, schoolId);

  route('GET', '/discipline/incidents/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const r = await visibleIncident(c, perms);
    const witnesses = await h.all('SELECT id, name, note FROM incident_witnesses WHERE incident_id = ? AND school_id = ? ORDER BY id', r.id, c.schoolId);
    const [date, time] = r.occurred_at.split(' ');
    const own = r.reported_by === c.user.id;
    const manager = c.user.role === 'school_admin' || canManage(perms);
    return { ...shapeIncident(r), description: r.description, occurred_date: date, occurred_time: time, witnesses, documents: await docsOf(r.id, c.schoolId),
      can_edit: manager || (own && r.status === 'reported'), can_change_status: manager, can_add_documents: manager || own, can_view_history: c.user.role === 'school_admin' || seesAll(perms) };
  });

  route('PUT', '/discipline/incidents/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const r = await visibleIncident(c, perms);
    const manager = c.user.role === 'school_admin' || canManage(perms);
    if (!(manager || (r.reported_by === c.user.id && r.status === 'reported'))) throw S.forbidden();
    const b = c.body; const [date, time] = r.occurred_at.split(' ');
    const f = incidentFields(b, { date, time, description: r.description });
    const category = b.category_id !== undefined && Number(b.category_id) !== r.category_id ? await activeCategory(c.schoolId, b.category_id) : r.category_id;
    const witnesses = cleanWitnesses(b.witnesses);
    let status = r.status;
    if (b.status !== undefined && b.status !== r.status) {
      if (!manager) throw S.forbidden();
      if (!STATUSES.includes(b.status)) throw S.bad('invalid_status');
      status = b.status;
    }
    await h.tx(async () => {
      await h.run('UPDATE discipline_incidents SET occurred_at = ?, category_id = ?, description = ?, status = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', f.occurred_at, category, f.description, status, r.id, c.schoolId);
      if (witnesses) {
        await h.run('DELETE FROM incident_witnesses WHERE incident_id = ? AND school_id = ?', r.id, c.schoolId);
        for (const w of witnesses) await h.run('INSERT INTO incident_witnesses (school_id, incident_id, name, note) VALUES (?,?,?,?)', c.schoolId, r.id, w.name, w.note);
      }
      await h.audit(c.schoolId, c.user.id, status !== r.status ? 'discipline_incident_status_changed' : 'discipline_incident_updated', `discipline_incident:${r.id}`, status !== r.status ? { from: r.status, to: status } : undefined);
    });
  });

  // ----- supporting documents: private files, checked by content, only ever served to people allowed to see the incident -----
  const sniffDoc = (buf) => (buf.length > 5 && buf.slice(0, 5).toString() === '%PDF-' ? 'application/pdf' : S.sniffImage(buf));
  route('POST', '/discipline/incidents/:id/documents', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const r = await visibleIncident(c, perms);
    if (!(c.user.role === 'school_admin' || canManage(perms) || r.reported_by === c.user.id)) throw S.forbidden();
    if (typeof c.body.data !== 'string') throw S.bad('invalid_file');
    const buf = Buffer.from(c.body.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length === 0 || buf.length > MAX_DOC) throw S.bad('file_too_large');
    const mime = sniffDoc(buf);
    if (!mime) throw S.bad('invalid_file_type');
    if ((await h.get('SELECT COUNT(*) n FROM incident_documents WHERE incident_id = ? AND school_id = ?', r.id, c.schoolId)).n >= 10) throw S.bad('too_many_files');
    const name = S.str(String(c.body.name || 'document').split(/[\\/]/).pop(), 120) || 'document';
    const dir = path.join(app.dataDir, 'uploads', String(c.schoolId), 'discipline');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, crypto.randomBytes(16).toString('hex')); // never guessable, never user-supplied
    fs.writeFileSync(file, buf);
    const id = await h.insert('INSERT INTO incident_documents (school_id, incident_id, original_name, mime, size, path, uploaded_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, r.id, name, mime, buf.length, file, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'discipline_document_added', `discipline_incident:${r.id}`, { document: id });
    return { id };
  }).bodyLimit = 5 * 1024 * 1024;

  const documentOf = async (c, perms, r) => {
    const did = S.toInt(c.params.doc);
    const d = did === null ? null : await h.get('SELECT * FROM incident_documents WHERE id = ? AND incident_id = ? AND school_id = ?', did, r.id, c.schoolId);
    if (!d) throw S.notFound();
    return d;
  };
  route('GET', '/discipline/incidents/:id/documents/:doc', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const r = await visibleIncident(c, perms);
    const d = await documentOf(c, perms, r);
    await h.audit(c.schoolId, c.user.id, 'discipline_document_viewed', `discipline_incident:${r.id}`, { document: d.id });
    const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return { __raw: true, body: fs.readFileSync(d.path), headers: { 'Content-Type': d.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${ascii}"` } };
  });
  route('DELETE', '/discipline/incidents/:id/documents/:doc', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'report_incidents', 'manage_discipline', 'approve_decisions');
    const r = await visibleIncident(c, perms);
    const manager = c.user.role === 'school_admin' || canManage(perms);
    if (!(manager || (r.reported_by === c.user.id && r.status === 'reported'))) throw S.forbidden();
    const d = await documentOf(c, perms, r);
    await h.run('DELETE FROM incident_documents WHERE id = ? AND school_id = ?', d.id, c.schoolId);
    try { fs.unlinkSync(d.path); } catch { /* already gone */ }
    await h.audit(c.schoolId, c.user.id, 'discipline_document_removed', `discipline_incident:${r.id}`, { document: d.id });
  });

  // =====================================================================================================
  // STUDENT DISCIPLINARY HISTORY (confidential: administrator, discipline officers and principals only)
  // =====================================================================================================
  async function historyAccess(c) {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'approve_decisions');
    const id = S.toInt(c.params.id);
    const st = id === null ? null : await h.get(`SELECT s.id, s.full_name, s.student_code, c.name cname, c.section csection, y.name year_name FROM students s
      LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id LEFT JOIN academic_years y ON y.id = s.year_id AND y.school_id = s.school_id
      WHERE s.id = ? AND s.school_id = ?`, id, c.schoolId);
    if (!st) throw S.notFound();
    return { perms, st };
  }
  route('GET', '/discipline/students/:id/history', STAFF, async (c) => {
    const { perms, st } = await historyAccess(c);
    const where = ['i.school_id = ?', 'i.student_id = ?'], p = [c.schoolId, st.id];
    if (S.toInt(c.query.year_id) !== null) { where.push('i.year_id = ?'); p.push(Number(c.query.year_id)); }
    if (S.isDate(c.query.from)) { where.push('i.occurred_at >= ?'); p.push(`${c.query.from} 00:00`); }
    if (S.isDate(c.query.to)) { where.push('i.occurred_at <= ?'); p.push(`${c.query.to} 23:59`); }
    const incidents = (await h.all(`${INCIDENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.occurred_at DESC, i.id DESC`, ...p)).map(shapeIncident);
    const followups = await h.all(`SELECT f.id, f.incident_id, f.note, f.trend, f.created_at, u.name recorded_by FROM conduct_followups f
      JOIN users u ON u.id = f.recorded_by AND u.school_id = f.school_id WHERE f.school_id = ? AND f.student_id = ? ORDER BY f.created_at DESC, f.id DESC`, c.schoolId, st.id);
    const decisions = (await h.all(`SELECT d.*, m.meeting_at, m.title, a.name approver_name FROM council_decisions d JOIN council_cases k ON k.id = d.case_id AND k.school_id = d.school_id
      JOIN council_meetings m ON m.id = k.meeting_id AND m.school_id = k.school_id JOIN users a ON a.id = d.approver_id AND a.school_id = d.school_id
      WHERE d.school_id = ? AND k.student_id = ? ORDER BY d.decided_on DESC, d.id DESC`, c.schoolId, st.id)).map((d) => ({ ...decisionShape(d), meeting: { title: d.title, meeting_at: d.meeting_at } })); // never the discussion or findings
    const sanctions = (await h.all(`${SANCTION_SELECT} WHERE x.school_id = ? AND x.student_id = ? ORDER BY x.imposed_on DESC, x.id DESC`, c.schoolId, st.id)).map(sanctionShape);
    const convocations = (await h.all('SELECT id, reference, meet_date, meet_time, status, parent_response, attended FROM convocations WHERE school_id = ? AND student_id = ? ORDER BY meet_date DESC, id DESC', c.schoolId, st.id));
    await h.audit(c.schoolId, c.user.id, 'discipline_history_viewed', `student:${st.id}`);
    return { student: { id: st.id, full_name: st.full_name, student_code: st.student_code, class_label: classLabel(st.cname, st.csection), year_name: st.year_name },
      summary: { incidents: incidents.length, serious: incidents.filter((i) => i.category.severity === 'serious').length, latest_trend: (followups.find((f) => f.trend) || {}).trend || null },
      incidents, followups, decisions, sanctions, convocations, can_record_followup: c.user.role === 'school_admin' || canManage(perms) };
  });
  route('POST', '/discipline/students/:id/followups', STAFF, async (c) => {
    const { perms, st } = await historyAccess(c);
    if (!(c.user.role === 'school_admin' || canManage(perms))) throw S.forbidden();
    const note = S.str(c.body.note, 2000);
    if (!note) throw S.bad('note_required');
    const trend = c.body.trend ? (TRENDS.includes(c.body.trend) ? c.body.trend : (() => { throw S.bad('invalid_data'); })()) : null;
    let incidentId = null;
    if (c.body.incident_id) {
      const iid = S.toInt(c.body.incident_id);
      if (iid === null || !(await h.get('SELECT 1 FROM discipline_incidents WHERE id = ? AND school_id = ? AND student_id = ?', iid, c.schoolId, st.id))) throw S.bad('invalid_data');
      incidentId = iid;
    }
    const id = await h.insert('INSERT INTO conduct_followups (school_id, student_id, incident_id, note, trend, recorded_by) VALUES (?,?,?,?,?,?)', c.schoolId, st.id, incidentId, note, trend, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'discipline_followup_recorded', `student:${st.id}`, { followup: id });
    return { id };
  });

  // =====================================================================================================
  // DISCIPLINARY COUNCIL (phase 3)
  //   run the council (schedule, members, cases): administrator + discipline officers
  //   council record (discussion, findings, decision): the administrator + council members ASSIGNED to that meeting
  //   approve a decision: the person named on it (a principal) or the administrator
  // Council discussion and findings are never returned to anyone else, and never leave this module.
  // =====================================================================================================
  const isAdmin = (c) => c.user.role === 'school_admin';
  const mayRun = (c, perms) => isAdmin(c) || perms.has('manage_discipline');
  const dateOk = (d) => S.isDate(d);
  const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));

  async function loadMeeting(c, perms, id) {
    const mid = S.toInt(id);
    const m = mid === null ? null : await h.get('SELECT * FROM council_meetings WHERE id = ? AND school_id = ?', mid, c.schoolId);
    if (!m) throw S.notFound();
    const member = await h.get('SELECT council_role FROM council_members WHERE meeting_id = ? AND school_id = ? AND user_id = ?', m.id, c.schoolId, c.user.id);
    const run = mayRun(c, perms);
    const record = isAdmin(c) || (!!member && perms.has('council_member')); // may read/write the confidential record
    if (!run && !record) throw S.notFound();
    return { m, run, record, member };
  }
  const meetingShape = (m) => ({ id: m.id, title: m.title, meeting_at: m.meeting_at, location: m.location, status: m.status });

  route('GET', '/discipline/council/people', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    void perms;
    const people = await h.all(`SELECT u.id, u.name, u.role, GROUP_CONCAT(p.permission) perms FROM users u LEFT JOIN user_permissions p ON p.user_id = u.id AND p.school_id = u.school_id
      WHERE u.school_id = ? AND u.active = 1 AND u.role IN ('teacher','school_admin') GROUP BY u.id, u.name, u.role ORDER BY u.name`, c.schoolId);
    const has = (u, p) => u.role === 'school_admin' || (u.perms || '').split(',').includes(p);
    return { members: people.filter((u) => has(u, 'council_member')).map((u) => ({ id: u.id, name: u.name })), approvers: people.filter((u) => has(u, 'approve_decisions')).map((u) => ({ id: u.id, name: u.name })) };
  });

  // Approvers a council member may name on a decision.
  route('GET', '/discipline/council/approvers', STAFF, async (c) => {
    await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const people = await h.all(`SELECT u.id, u.name, u.role, GROUP_CONCAT(p.permission) perms FROM users u LEFT JOIN user_permissions p ON p.user_id = u.id AND p.school_id = u.school_id
      WHERE u.school_id = ? AND u.active = 1 AND u.role IN ('teacher','school_admin') GROUP BY u.id, u.name, u.role ORDER BY u.name`, c.schoolId);
    return people.filter((u) => u.role === 'school_admin' || (u.perms || '').split(',').includes('approve_decisions')).map((u) => ({ id: u.id, name: u.name }));
  });

  route('GET', '/discipline/council/meetings', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const run = mayRun(c, perms);
    const rows = await h.all(`SELECT m.*, (SELECT COUNT(*) FROM council_members x WHERE x.meeting_id = m.id AND x.school_id = m.school_id) members,
        (SELECT COUNT(*) FROM council_cases k WHERE k.meeting_id = m.id AND k.school_id = m.school_id) cases
      FROM council_meetings m WHERE m.school_id = ? ${run ? '' : 'AND EXISTS (SELECT 1 FROM council_members x WHERE x.meeting_id = m.id AND x.school_id = m.school_id AND x.user_id = ?)'}
      ORDER BY m.meeting_at DESC, m.id DESC`, ...(run ? [c.schoolId] : [c.schoolId, c.user.id]));
    return rows.map((m) => ({ ...meetingShape(m), members: m.members, cases: m.cases }));
  });

  async function checkMembers(c, list) {
    if (!Array.isArray(list) || list.length > 15) throw S.bad('invalid_data');
    const seen = new Set(), out = [];
    for (const m of list) {
      const uid = S.toInt(m && m.user_id);
      if (uid === null || seen.has(uid)) throw S.bad('invalid_data');
      seen.add(uid);
      const u = await h.get("SELECT id, role, school_id FROM users WHERE id = ? AND school_id = ? AND active = 1 AND role IN ('teacher','school_admin')", uid, c.schoolId);
      if (!u) throw S.bad('invalid_member');
      if (u.role === 'teacher' && !(await A.permissionsOf(h, u)).has('council_member')) throw S.bad('invalid_member');
      out.push({ user_id: uid, council_role: ['chair', 'secretary', 'member'].includes(m.council_role) ? m.council_role : 'member' });
    }
    return out;
  }
  const meetingFields = (b, cur = {}) => {
    const title = b.title !== undefined ? S.str(b.title, 160) : cur.title, location = b.location !== undefined ? S.str(b.location, 160) : cur.location;
    const date = b.meeting_date !== undefined ? b.meeting_date : cur.date, time = b.meeting_time !== undefined ? b.meeting_time : cur.time;
    if (!title) throw S.bad('title_required'); if (!location) throw S.bad('location_required');
    if (!dateOk(date)) throw S.bad('invalid_date'); if (!timeOk(time)) throw S.bad('invalid_time');
    return { title, location, meeting_at: `${date} ${time}` };
  };
  route('POST', '/discipline/council/meetings', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    void perms;
    const f = meetingFields(c.body);
    const members = c.body.members === undefined ? [] : await checkMembers(c, c.body.members);
    const id = await h.tx(async () => {
      const mid = await h.insert('INSERT INTO council_meetings (school_id, title, meeting_at, location, created_by) VALUES (?,?,?,?,?)', c.schoolId, f.title, f.meeting_at, f.location, c.user.id);
      for (const m of members) await h.run('INSERT INTO council_members (school_id, meeting_id, user_id, council_role) VALUES (?,?,?,?)', c.schoolId, mid, m.user_id, m.council_role);
      await h.audit(c.schoolId, c.user.id, 'council_meeting_created', `council_meeting:${mid}`);
      return mid;
    });
    return { id };
  });

  const caseRows = (meetingId, schoolId) => h.all(`SELECT k.id, k.student_id, s.full_name, s.student_code, d.status decision_status, d.id decision_id
    FROM council_cases k JOIN students s ON s.id = k.student_id AND s.school_id = k.school_id
    LEFT JOIN council_decisions d ON d.case_id = k.id AND d.school_id = k.school_id WHERE k.meeting_id = ? AND k.school_id = ? ORDER BY s.full_name`, meetingId, schoolId);
  route('GET', '/discipline/council/meetings/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const { m, run, record } = await loadMeeting(c, perms, c.params.id);
    const members = await h.all('SELECT u.id user_id, u.name, cm.council_role FROM council_members cm JOIN users u ON u.id = cm.user_id AND u.school_id = cm.school_id WHERE cm.meeting_id = ? AND cm.school_id = ? ORDER BY u.name', m.id, c.schoolId);
    return { ...meetingShape(m), members, cases: await caseRows(m.id, c.schoolId), can_run: run, can_record: record };
  });
  route('PUT', '/discipline/council/meetings/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    const { m } = await loadMeeting(c, perms, c.params.id);
    const [date, time] = m.meeting_at.split(' ');
    const f = meetingFields(c.body, { title: m.title, location: m.location, date, time });
    let status = m.status;
    if (c.body.status !== undefined) { if (!['scheduled', 'held', 'cancelled'].includes(c.body.status)) throw S.bad('invalid_status'); status = c.body.status; }
    const members = c.body.members === undefined ? null : await checkMembers(c, c.body.members);
    await h.tx(async () => {
      await h.run('UPDATE council_meetings SET title = ?, location = ?, meeting_at = ?, status = ? WHERE id = ? AND school_id = ?', f.title, f.location, f.meeting_at, status, m.id, c.schoolId);
      if (members) {
        await h.run('DELETE FROM council_members WHERE meeting_id = ? AND school_id = ?', m.id, c.schoolId);
        for (const x of members) await h.run('INSERT INTO council_members (school_id, meeting_id, user_id, council_role) VALUES (?,?,?,?)', c.schoolId, m.id, x.user_id, x.council_role);
      }
      await h.audit(c.schoolId, c.user.id, members ? 'council_members_set' : 'council_meeting_updated', `council_meeting:${m.id}`, status !== m.status ? { status } : undefined);
    });
  });

  // ----- cases: one student per case, with the incidents the council will look at -----
  route('POST', '/discipline/council/meetings/:id/cases', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    const { m } = await loadMeeting(c, perms, c.params.id);
    if (m.status === 'cancelled') throw S.bad('meeting_cancelled');
    const sid = S.toInt(c.body.student_id);
    const st = sid === null ? null : await h.get('SELECT id FROM students WHERE id = ? AND school_id = ?', sid, c.schoolId);
    if (!st) throw S.bad('invalid_student');
    const ids = Array.isArray(c.body.incident_ids) ? [...new Set(c.body.incident_ids.map(S.toInt))] : [];
    for (const iid of ids) if (iid === null || !(await h.get('SELECT 1 FROM discipline_incidents WHERE id = ? AND school_id = ? AND student_id = ?', iid, c.schoolId, st.id))) throw S.bad('invalid_incident');
    if (await h.get('SELECT 1 FROM council_cases WHERE meeting_id = ? AND school_id = ? AND student_id = ?', m.id, c.schoolId, st.id)) throw S.bad('case_exists');
    const id = await h.tx(async () => {
      const kid = await h.insert('INSERT INTO council_cases (school_id, meeting_id, student_id, created_by) VALUES (?,?,?,?)', c.schoolId, m.id, st.id, c.user.id);
      for (const iid of ids) await h.run('INSERT INTO council_case_incidents (school_id, case_id, incident_id) VALUES (?,?,?)', c.schoolId, kid, iid);
      await h.audit(c.schoolId, c.user.id, 'council_case_created', `council_case:${kid}`, { student_id: st.id });
      return kid;
    });
    return { id };
  });

  async function loadCase(c, perms) {
    const kid = S.toInt(c.params.id);
    const k = kid === null ? null : await h.get('SELECT * FROM council_cases WHERE id = ? AND school_id = ?', kid, c.schoolId);
    if (!k) throw S.notFound();
    return { k, ...(await loadMeeting(c, perms, k.meeting_id)) };
  }
  const decisionOf = (caseId, schoolId) => h.get(`SELECT d.*, a.name approver_name, b.name approved_by_name FROM council_decisions d JOIN users a ON a.id = d.approver_id AND a.school_id = d.school_id
    LEFT JOIN users b ON b.id = d.approved_by AND b.school_id = d.school_id WHERE d.case_id = ? AND d.school_id = ?`, caseId, schoolId);
  const decisionShape = (d) => (d ? { id: d.id, decision_text: d.decision_text, decided_on: d.decided_on, follow_up: d.follow_up, status: d.status, approver_id: d.approver_id, approver_name: d.approver_name,
    approved_by_name: d.approved_by_name, approved_at: d.approved_at, approval_comment: d.approval_comment } : null);

  route('GET', '/discipline/council/cases/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const { k, m, run, record } = await loadCase(c, perms);
    const st = await h.get('SELECT s.id, s.full_name, s.student_code, c.name cname, c.section csection FROM students s LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id WHERE s.id = ? AND s.school_id = ?', k.student_id, c.schoolId);
    const incidents = await h.all(`SELECT i.id, i.occurred_at, i.description, i.status, kc.name_en cat_en, kc.name_fr cat_fr FROM council_case_incidents ci
      JOIN discipline_incidents i ON i.id = ci.incident_id AND i.school_id = ci.school_id JOIN discipline_categories kc ON kc.id = i.category_id AND kc.school_id = i.school_id
      WHERE ci.case_id = ? AND ci.school_id = ? ORDER BY i.occurred_at`, k.id, c.schoolId);
    const d = await decisionOf(k.id, c.schoolId);
    const out = { id: k.id, meeting: meetingShape(m), student: { id: st.id, full_name: st.full_name, student_code: st.student_code, class_label: classLabel(st.cname, st.csection) },
      incidents: incidents.map((i) => ({ id: i.id, occurred_at: i.occurred_at, description: i.description, status: i.status, category_en: i.cat_en, category_fr: i.cat_fr })),
      decision: decisionShape(d), can_run: run, can_record: record && m.status !== 'cancelled', locked: !!d && d.status === 'approved' };
    if (record) { // ONLY the administrator and assigned council members ever receive the confidential record
      out.discussion = k.discussion || ''; out.findings = k.findings || '';
      await h.audit(c.schoolId, c.user.id, 'council_case_viewed', `council_case:${k.id}`);
    }
    return out;
  });
  route('PUT', '/discipline/council/cases/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const { k, m, record } = await loadCase(c, perms);
    if (!record) throw S.forbidden();
    if (m.status === 'cancelled') throw S.bad('meeting_cancelled');
    const d = await decisionOf(k.id, c.schoolId);
    if (d && d.status === 'approved') throw S.bad('decision_locked');
    const discussion = c.body.discussion === undefined ? k.discussion : S.str(c.body.discussion, 20000) || null;
    const findings = c.body.findings === undefined ? k.findings : S.str(c.body.findings, 20000) || null;
    await h.run('UPDATE council_cases SET discussion = ?, findings = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', discussion, findings, k.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'council_case_notes_updated', `council_case:${k.id}`); // contents are never written to the log
  });
  route('DELETE', '/discipline/council/cases/:id', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    const { k, run } = await loadCase(c, perms);
    if (!run) throw S.forbidden();
    if (await decisionOf(k.id, c.schoolId)) throw S.bad('decision_exists');
    await h.tx(async () => {
      await h.run('DELETE FROM council_case_incidents WHERE case_id = ? AND school_id = ?', k.id, c.schoolId);
      await h.run('DELETE FROM council_cases WHERE id = ? AND school_id = ?', k.id, c.schoolId);
      await h.audit(c.schoolId, c.user.id, 'council_case_deleted', `council_case:${k.id}`);
    });
  });

  // ----- decisions -----
  route('PUT', '/discipline/council/cases/:id/decision', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'council_member');
    const { k, m, record } = await loadCase(c, perms);
    if (!record) throw S.forbidden();
    if (m.status === 'cancelled') throw S.bad('meeting_cancelled');
    const cur = await decisionOf(k.id, c.schoolId);
    if (cur && cur.status === 'approved') throw S.bad('decision_locked');
    const text = S.str(c.body.decision_text, 5000);
    if (!text) throw S.bad('decision_required');
    if (!dateOk(c.body.decided_on)) throw S.bad('invalid_date');
    const aid = S.toInt(c.body.approver_id);
    const approver = aid === null ? null : await h.get("SELECT id, role, school_id FROM users WHERE id = ? AND school_id = ? AND active = 1 AND role IN ('teacher','school_admin')", aid, c.schoolId);
    if (!approver || !(await A.permissionsOf(h, approver)).has('approve_decisions')) throw S.bad('invalid_approver');
    const follow = S.str(c.body.follow_up, 3000) || null;
    if (cur) await h.run("UPDATE council_decisions SET decision_text = ?, decided_on = ?, follow_up = ?, approver_id = ?, status = 'draft', approved_by = NULL, approved_at = NULL, approval_comment = NULL, updated_at = NOW_TS WHERE id = ? AND school_id = ?", text, c.body.decided_on, follow, approver.id, cur.id, c.schoolId);
    else await h.run('INSERT INTO council_decisions (school_id, case_id, decision_text, decided_on, follow_up, approver_id, created_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, k.id, text, c.body.decided_on, follow, approver.id, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'council_decision_saved', `council_case:${k.id}`);
  });

  async function decisionForApproval(c) {
    const perms = await A.requirePerm(h, c.user, 'approve_decisions');
    const did = S.toInt(c.params.id);
    const d = did === null ? null : await h.get('SELECT * FROM council_decisions WHERE id = ? AND school_id = ?', did, c.schoolId);
    if (!d) throw S.notFound();
    if (!(isAdmin(c) || d.approver_id === c.user.id)) throw S.forbidden(); // only the person named on the decision (or the administrator)
    void perms; return d;
  }
  route('POST', '/discipline/council/decisions/:id/approve', STAFF, async (c) => {
    const d = await decisionForApproval(c);
    if (d.status === 'approved') throw S.bad('decision_locked');
    const approve = c.body.approve === true;
    const comment = S.str(c.body.comment, 1000) || null;
    if (!approve && !comment) throw S.bad('comment_required');
    await h.run('UPDATE council_decisions SET status = ?, approved_by = ?, approved_at = NOW_TS, approval_comment = ? WHERE id = ? AND school_id = ?', approve ? 'approved' : 'rejected', c.user.id, comment, d.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, approve ? 'council_decision_approved' : 'council_decision_rejected', `council_decision:${d.id}`);
  });

  // Decisions list (no discussion or findings): administrator, discipline officers and principals.
  route('GET', '/discipline/decisions', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'approve_decisions');
    void perms;
    const where = ['d.school_id = ?'], p = [c.schoolId];
    if (['draft', 'approved', 'rejected'].includes(c.query.status)) { where.push('d.status = ?'); p.push(c.query.status); }
    const rows = await h.all(`SELECT d.*, s.id sid, s.full_name, s.student_code, m.title, m.meeting_at, a.name approver_name FROM council_decisions d
      JOIN council_cases k ON k.id = d.case_id AND k.school_id = d.school_id JOIN council_meetings m ON m.id = k.meeting_id AND m.school_id = k.school_id
      JOIN students s ON s.id = k.student_id AND s.school_id = k.school_id JOIN users a ON a.id = d.approver_id AND a.school_id = d.school_id
      WHERE ${where.join(' AND ')} ORDER BY d.decided_on DESC, d.id DESC LIMIT 200`, ...p);
    return rows.map((d) => ({ ...decisionShape(d), student: { id: d.sid, full_name: d.full_name, student_code: d.student_code }, meeting: { title: d.title, meeting_at: d.meeting_at }, can_approve: isAdmin(c) || d.approver_id === c.user.id }));
  });

  // =====================================================================================================
  // SANCTIONS: proposed by an officer, imposed ONLY after an authorised person approves. Never automatic.
  // =====================================================================================================
  const SANCTION_SELECT = `SELECT x.*, s.full_name, s.student_code, t.name_en type_en, t.name_fr type_fr, t.has_duration, p.name proposed_name, a.name authorized_name
    FROM sanctions x JOIN students s ON s.id = x.student_id AND s.school_id = x.school_id JOIN sanction_types t ON t.id = x.sanction_type_id AND t.school_id = x.school_id
    JOIN users p ON p.id = x.proposed_by AND p.school_id = x.school_id LEFT JOIN users a ON a.id = x.authorized_by AND a.school_id = x.school_id`;
  const sanctionShape = (x) => ({ id: x.id, student: { id: x.student_id, full_name: x.full_name, student_code: x.student_code }, type: { id: x.sanction_type_id, name_en: x.type_en, name_fr: x.type_fr, has_duration: !!x.has_duration },
    reason: x.reason, imposed_on: x.imposed_on, duration_days: x.duration_days, status: x.status, incident_id: x.incident_id, decision_id: x.decision_id, proposed_by: x.proposed_name,
    authorized_by: x.authorized_name || null, authorized_at: x.authorized_at, decision_comment: x.decision_comment, notification_status: x.notification_status });

  route('GET', '/discipline/sanctions', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline', 'approve_decisions');
    const where = ['x.school_id = ?'], p = [c.schoolId];
    if (S.toInt(c.query.student_id) !== null) { where.push('x.student_id = ?'); p.push(Number(c.query.student_id)); }
    if (['proposed', 'approved', 'rejected', 'withdrawn'].includes(c.query.status)) { where.push('x.status = ?'); p.push(c.query.status); }
    const rows = await h.all(`${SANCTION_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.created_at DESC, x.id DESC LIMIT 200`, ...p);
    const approver = isAdmin(c) || perms.has('approve_decisions'), run = mayRun(c, perms);
    return rows.map((x) => ({ ...sanctionShape(x), can_approve: approver && x.status === 'proposed', can_withdraw: approver && x.status === 'approved' })).map((x) => ({ ...x, can_propose: run }));
  });
  route('POST', '/discipline/sanctions', STAFF, async (c) => {
    const perms = await A.requirePerm(h, c.user, 'manage_discipline');
    void perms;
    const b = c.body;
    const sid = S.toInt(b.student_id);
    const st = sid === null ? null : await h.get('SELECT id FROM students WHERE id = ? AND school_id = ?', sid, c.schoolId);
    if (!st) throw S.bad('invalid_student');
    const tid = S.toInt(b.sanction_type_id);
    const type = tid === null ? null : await h.get('SELECT id, has_duration FROM sanction_types WHERE id = ? AND school_id = ? AND active = 1', tid, c.schoolId);
    if (!type) throw S.bad('invalid_sanction_type');
    const reason = S.str(b.reason, 2000);
    if (!reason) throw S.bad('reason_required');
    if (!dateOk(b.imposed_on)) throw S.bad('invalid_date');
    let days = null;
    if (type.has_duration) { days = S.toInt(b.duration_days); if (days === null || days < 1 || days > 365) throw S.bad('invalid_duration'); }
    let incidentId = null, decisionId = null;
    if (b.incident_id) {
      incidentId = S.toInt(b.incident_id);
      if (incidentId === null || !(await h.get('SELECT 1 FROM discipline_incidents WHERE id = ? AND school_id = ? AND student_id = ?', incidentId, c.schoolId, st.id))) throw S.bad('invalid_incident');
    }
    if (b.decision_id) {
      decisionId = S.toInt(b.decision_id);
      const d = decisionId === null ? null : await h.get(`SELECT d.id FROM council_decisions d JOIN council_cases k ON k.id = d.case_id AND k.school_id = d.school_id
        WHERE d.id = ? AND d.school_id = ? AND d.status = 'approved' AND k.student_id = ?`, decisionId, c.schoolId, st.id);
      if (!d) throw S.bad('invalid_decision');
    }
    const id = await h.insert('INSERT INTO sanctions (school_id, student_id, incident_id, decision_id, sanction_type_id, reason, imposed_on, duration_days, proposed_by) VALUES (?,?,?,?,?,?,?,?,?)',
      c.schoolId, st.id, incidentId, decisionId, type.id, reason, b.imposed_on, days, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'sanction_proposed', `sanction:${id}`, { student_id: st.id });
    return { id };
  });
  async function sanctionForApproval(c) {
    await A.requirePerm(h, c.user, 'approve_decisions');
    const id = S.toInt(c.params.id);
    const x = id === null ? null : await h.get('SELECT * FROM sanctions WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!x) throw S.notFound();
    return x;
  }
  route('POST', '/discipline/sanctions/:id/approve', STAFF, async (c) => {
    const x = await sanctionForApproval(c);
    if (x.status !== 'proposed') throw S.bad('invalid_status');
    const approve = c.body.approve === true, comment = S.str(c.body.comment, 1000) || null;
    if (!approve && !comment) throw S.bad('comment_required');
    await h.run('UPDATE sanctions SET status = ?, authorized_by = ?, authorized_at = NOW_TS, decision_comment = ? WHERE id = ? AND school_id = ?', approve ? 'approved' : 'rejected', c.user.id, comment, x.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, approve ? 'sanction_approved' : 'sanction_rejected', `sanction:${x.id}`);
  });
  route('POST', '/discipline/sanctions/:id/withdraw', STAFF, async (c) => {
    const x = await sanctionForApproval(c);
    if (x.status !== 'approved') throw S.bad('invalid_status');
    const comment = S.str(c.body.comment, 1000);
    if (!comment) throw S.bad('comment_required');
    await h.run("UPDATE sanctions SET status = 'withdrawn', decision_comment = ? WHERE id = ? AND school_id = ?", comment, x.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'sanction_withdrawn', `sanction:${x.id}`);
  });
};
