'use strict';
// Scholarships, phase 1: the school's own scholarship opportunities.
// The administrator creates and manages them. Staff, parents and students can read the ones that are published.
// Reviewers (teachers the administrator names) will be assigned individual applications in phase 2.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('./security');
const A = require('./access');

const ADMIN = ['school_admin'];
const ALL = ['school_admin', 'teacher', 'parent', 'student'];
const CATEGORIES = ['academic_merit', 'talent_excellence', 'social_support', 'external'];
const STATUSES = ['draft', 'open', 'suspended', 'closed'];
const todayStr = () => new Date().toISOString().slice(0, 10);

module.exports = function (app) {
  const { h, route } = app;

  // What a reader should understand about the scholarship right now.
  const phaseOf = (s) => {
    if (s.status !== 'open') return s.status;
    const t = todayStr();
    if (s.opens_on && t < s.opens_on) return 'upcoming';
    if (s.closes_on && t > s.closes_on) return 'deadline_passed';
    return 'open';
  };
  const shape = async (c, s, withClasses = true) => ({
    id: s.id, title: s.title, description: s.description, category: s.category, sponsor: s.sponsor, eligibility_text: s.eligibility_text, benefits: s.benefits,
    required_documents: s.required_documents, renewal_conditions: s.renewal_conditions, places: s.places, min_average: s.min_average, opens_on: s.opens_on, closes_on: s.closes_on,
    status: s.status, phase: phaseOf(s),
    classes: withClasses ? await h.all('SELECT c.id, c.name, c.section FROM scholarship_classes sc JOIN classes c ON c.id = sc.class_id AND c.school_id = sc.school_id WHERE sc.scholarship_id = ? AND sc.school_id = ? ORDER BY c.name, c.section', s.id, c.schoolId) : undefined,
  });
  const load = async (c, id = c.params.id) => {
    const n = S.toInt(id);
    const s = n === null ? null : await h.get('SELECT * FROM scholarships WHERE id = ? AND school_id = ?', n, c.schoolId);
    if (!s) throw S.notFound();
    // people other than the administrator never see drafts
    if (c.user.role !== 'school_admin' && s.status === 'draft') throw S.notFound();
    if ((c.user.role === 'parent' || c.user.role === 'student') && s.status === 'suspended') throw S.notFound();
    return s;
  };

  async function fields(c, existing) {
    const b = c.body, out = {};
    const pick = (k, max, required) => { const v = b[k] === undefined && existing ? existing[k] : S.str(b[k], max); if (required && !v) throw S.bad(`${k}_required`); return v || null; };
    out.title = pick('title', 160, true); out.description = pick('description', 3000, true); out.benefits = pick('benefits', 2000, true);
    out.sponsor = pick('sponsor', 160); out.eligibility_text = pick('eligibility_text', 2000); out.required_documents = pick('required_documents', 1500); out.renewal_conditions = pick('renewal_conditions', 1500);
    out.category = b.category === undefined && existing ? existing.category : b.category;
    if (!CATEGORIES.includes(out.category)) throw S.bad('invalid_category');
    out.places = b.places === undefined ? (existing ? existing.places : 1) : S.toInt(b.places);
    if (out.places === null || out.places < 1 || out.places > 10000) throw S.bad('invalid_places');
    const scale = c.school.grade_scale || 20;
    out.min_average = b.min_average === undefined && existing ? existing.min_average : (b.min_average === undefined || b.min_average === '' || b.min_average === null ? null : Number(b.min_average));
    if (out.min_average !== null && (!Number.isFinite(out.min_average) || out.min_average < 0 || out.min_average > scale)) throw S.bad('invalid_min_average');
    for (const k of ['opens_on', 'closes_on']) {
      out[k] = b[k] === undefined && existing ? existing[k] : (b[k] ? b[k] : null);
      if (out[k] !== null && !S.isDate(out[k])) throw S.bad('invalid_date');
    }
    if (out.opens_on && out.closes_on && out.closes_on < out.opens_on) throw S.bad('invalid_date');
    out.class_ids = null;
    if (b.class_ids !== undefined) {
      if (!Array.isArray(b.class_ids) || b.class_ids.length > 100) throw S.bad('invalid_data');
      out.class_ids = [];
      for (const raw of new Set(b.class_ids.map(Number))) {
        if (!(await h.get('SELECT 1 FROM classes WHERE id = ? AND school_id = ?', raw, c.schoolId))) throw S.bad('invalid_class');
        out.class_ids.push(raw);
      }
    }
    return out;
  }
  const saveClasses = async (c, id, ids) => {
    if (ids === null) return;
    await h.run('DELETE FROM scholarship_classes WHERE scholarship_id = ? AND school_id = ?', id, c.schoolId);
    for (const cid of ids) await h.run('INSERT INTO scholarship_classes (school_id, scholarship_id, class_id) VALUES (?,?,?)', c.schoolId, id, cid);
  };

  route('GET', '/scholarships', ALL, async (c) => {
    const where = ['school_id = ?'], p = [c.schoolId];
    if (c.user.role === 'teacher') where.push("status <> 'draft'");
    if (c.user.role === 'parent' || c.user.role === 'student') where.push("status IN ('open','closed')");
    if (CATEGORIES.includes(c.query.category)) { where.push('category = ?'); p.push(c.query.category); }
    const q = S.str(c.query.q, 80);
    if (q) { where.push("(LOWER(title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(sponsor) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    const rows = await h.all(`SELECT * FROM scholarships WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END, closes_on IS NULL, closes_on, id DESC LIMIT 200`, ...p);
    return Promise.all(rows.map((s) => shape(c, s)));
  });
  route('GET', '/scholarships/:id', ALL, async (c) => shape(c, await load(c)));

  route('POST', '/scholarships', ADMIN, async (c) => {
    const f = await fields(c, null);
    const id = await h.insert('INSERT INTO scholarships (school_id, title, description, category, sponsor, eligibility_text, benefits, required_documents, renewal_conditions, places, min_average, opens_on, closes_on, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.schoolId, f.title, f.description, f.category, f.sponsor, f.eligibility_text, f.benefits, f.required_documents, f.renewal_conditions, f.places, f.min_average, f.opens_on, f.closes_on, c.user.id);
    await saveClasses(c, id, f.class_ids);
    await h.audit(c.schoolId, c.user.id, 'scholarship_created', `scholarship:${id}`);
    return { id };
  });
  route('PUT', '/scholarships/:id', ADMIN, async (c) => {
    const s = await load(c);
    if (s.status === 'closed') throw S.bad('invalid_status');
    const f = await fields(c, s);
    await h.run('UPDATE scholarships SET title=?, description=?, category=?, sponsor=?, eligibility_text=?, benefits=?, required_documents=?, renewal_conditions=?, places=?, min_average=?, opens_on=?, closes_on=?, updated_at=NOW_TS WHERE id=? AND school_id=?',
      f.title, f.description, f.category, f.sponsor, f.eligibility_text, f.benefits, f.required_documents, f.renewal_conditions, f.places, f.min_average, f.opens_on, f.closes_on, s.id, c.schoolId);
    await saveClasses(c, s.id, f.class_ids);
    await h.audit(c.schoolId, c.user.id, 'scholarship_edited', `scholarship:${s.id}`);
  });
  // open (publish), suspend, close. A closed scholarship can be re-opened by creating a new one, not by editing the old record.
  route('POST', '/scholarships/:id/status', ADMIN, async (c) => {
    const s = await load(c);
    const to = c.body.status;
    if (!STATUSES.includes(to) || to === 'draft') throw S.bad('invalid_status');
    const ok = { draft: ['open'], open: ['suspended', 'closed'], suspended: ['open', 'closed'], closed: [] }[s.status];
    if (!ok.includes(to)) throw S.bad('invalid_status');
    await h.run('UPDATE scholarships SET status = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', to, s.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, `scholarship_${to}`, `scholarship:${s.id}`);
  });
  route('DELETE', '/scholarships/:id', ADMIN, async (c) => {
    const s = await load(c);
    if (s.status !== 'draft') throw S.bad('invalid_status'); // anything that was ever published is kept for the record
    await h.run('DELETE FROM scholarship_classes WHERE scholarship_id = ? AND school_id = ?', s.id, c.schoolId);
    await h.run('DELETE FROM scholarships WHERE id = ? AND school_id = ?', s.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'scholarship_deleted', `scholarship:${s.id}`);
  });

  // ----- reviewers: teachers of THIS school the administrator allows to review applications -----
  route('GET', '/scholarships-reviewers', ADMIN, async (c) => h.all(`SELECT u.id, u.name, u.email, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END is_reviewer
    FROM users u LEFT JOIN scholarship_reviewers r ON r.user_id = u.id AND r.school_id = u.school_id WHERE u.school_id = ? AND u.role = 'teacher' AND u.active = 1 ORDER BY u.name`, c.schoolId)
    .then((rows) => rows.map((r) => ({ ...r, is_reviewer: !!r.is_reviewer }))));
  route('PUT', '/scholarships-reviewers', ADMIN, async (c) => {
    if (!Array.isArray(c.body.user_ids) || c.body.user_ids.length > 200) throw S.bad('invalid_data');
    const ids = [...new Set(c.body.user_ids.map(Number))];
    for (const id of ids) if (!(await h.get("SELECT 1 FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1", id, c.schoolId))) throw S.bad('invalid_user');
    await h.tx(async () => {
      await h.run('DELETE FROM scholarship_reviewers WHERE school_id = ?', c.schoolId);
      for (const id of ids) await h.run('INSERT INTO scholarship_reviewers (school_id, user_id, granted_by) VALUES (?,?,?)', c.schoolId, id, c.user.id);
      await h.audit(c.schoolId, c.user.id, 'scholarship_reviewers_set', `school:${c.schoolId}`, { users: ids });
    });
  });

  // =====================================================================================================
  // APPLICATIONS (phase 2)
  // Students apply for themselves; a parent applies for a linked child. Eligibility is computed here on the server from
  // the school's own data (class, APPROVED results). Nothing is guessed: no approved result means the minimum average is not met.
  // Reviewers see only the applications assigned to them. Applicants never see reviewer notes.
  // =====================================================================================================
  const MAX_DOC = 3 * 1024 * 1024, MAX_DOCS = 8;
  const classLabel = (name, section) => (name ? `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}` : null);
  const isApplicant = (c) => c.user.role === 'student' || c.user.role === 'parent';
  const sniffDoc = (buf) => (buf.length > 5 && buf.slice(0, 5).toString() === '%PDF-' ? 'application/pdf' : S.sniffImage(buf));

  async function eligibility(c, sch, student) {
    const checks = [];
    const phase = phaseOf(sch);
    checks.push({ key: 'open', ok: phase === 'open', detail: phase });
    checks.push({ key: 'active_student', ok: student.status === 'active' && !student.archived_at });
    const cls = await h.all('SELECT class_id FROM scholarship_classes WHERE scholarship_id = ? AND school_id = ?', sch.id, c.schoolId);
    if (cls.length) checks.push({ key: 'class', ok: !!student.class_id && cls.some((x) => x.class_id === student.class_id) });
    let avg = null;
    if (sch.min_average !== null) {
      avg = await app.approvedAverage(c.schoolId, student.id);
      checks.push({ key: 'min_average', ok: !!avg && avg.average >= sch.min_average, detail: avg ? { average: avg.average, required: sch.min_average, source: avg.source } : { required: sch.min_average, average: null } });
    }
    return { eligible: checks.every((x) => x.ok), checks, avg };
  }
  const myStudent = async (c, studentId) => {
    if (c.user.role === 'student') { if (c.user.student_id == null) throw S.forbidden(); return A.getVisibleStudent(h, c.user, c.user.student_id); }
    if (c.user.role === 'parent') return A.getVisibleStudent(h, c.user, studentId);
    throw S.forbidden();
  };

  route('GET', '/scholarships/:id/eligibility', ['student', 'parent'], async (c) => {
    const sch = await load(c);
    const st = await myStudent(c, c.query.student_id);
    const e = await eligibility(c, sch, st);
    const existing = await h.get('SELECT id, status FROM scholarship_applications WHERE scholarship_id = ? AND student_id = ? AND school_id = ?', sch.id, st.id, c.schoolId);
    return { eligible: e.eligible, checks: e.checks, application: existing || null };
  });

  const APP_SELECT = `SELECT a.*, sc.title, sc.category, sc.places, st.full_name student_name, st.student_code, cl.name cname, cl.section csection, ap.name applied_by_name, dm.name decided_by_name
    FROM scholarship_applications a JOIN scholarships sc ON sc.id = a.scholarship_id AND sc.school_id = a.school_id JOIN students st ON st.id = a.student_id AND st.school_id = a.school_id
    LEFT JOIN classes cl ON cl.id = st.class_id AND cl.school_id = st.school_id JOIN users ap ON ap.id = a.applied_by AND ap.school_id = a.school_id LEFT JOIN users dm ON dm.id = a.decided_by AND dm.school_id = a.school_id`;
  const appShape = (a) => ({ id: a.id, scholarship: { id: a.scholarship_id, title: a.title, category: a.category }, student: { id: a.student_id, full_name: a.student_name, student_code: a.student_code, class_label: classLabel(a.cname, a.csection) },
    status: a.status, motivation: a.motivation, submitted_at: a.submitted_at, average_at_submission: a.average_at_submission, average_source: a.average_source,
    decision_reason: a.decision_reason, decided_at: a.decided_at, decided_by_name: a.decided_by_name, applied_by_name: a.applied_by_name, created_at: a.created_at });

  // Which applications may this person see?
  async function scopeOf(c) {
    if (c.user.role === 'school_admin') return { where: 'a.school_id = ?', params: [c.schoolId], admin: true };
    if (c.user.role === 'teacher') return { where: 'a.school_id = ? AND a.status <> \'draft\' AND EXISTS (SELECT 1 FROM scholarship_reviews r WHERE r.application_id = a.id AND r.school_id = a.school_id AND r.reviewer_id = ?)', params: [c.schoolId, c.user.id], reviewer: true };
    const sc = A.studentScope(c.user);
    return { where: `a.school_id = ? AND a.student_id IN (SELECT s.id FROM students s WHERE ${sc.where})`, params: [c.schoolId, ...sc.params], applicant: true };
  }
  async function loadApp(c, id = c.params.id) {
    const n = S.toInt(id), sc = await scopeOf(c);
    const a = n === null ? null : await h.get(`${APP_SELECT} WHERE ${sc.where} AND a.id = ?`, ...sc.params, n);
    if (!a) throw S.notFound();
    return { a, sc };
  }
  const docsOf = (c, id) => h.all('SELECT id, original_name, mime, size, created_at FROM scholarship_documents WHERE application_id = ? AND school_id = ? ORDER BY id', id, c.schoolId);

  route('GET', '/scholarship-applications', ALL, async (c) => {
    const sc = await scopeOf(c), where = [sc.where], p = [...sc.params];
    if (S.toInt(c.query.scholarship_id) !== null) { where.push('a.scholarship_id = ?'); p.push(Number(c.query.scholarship_id)); }
    if (['draft', 'submitted', 'under_review', 'approved', 'rejected', 'waitlisted'].includes(c.query.status)) { where.push('a.status = ?'); p.push(c.query.status); }
    const q = S.str(c.query.q, 80);
    if (q && !sc.applicant) { where.push("(LOWER(st.full_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(st.student_code) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    const rows = await h.all(`${APP_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC, a.id DESC LIMIT 300`, ...p);
    return rows.map((a) => { const x = appShape(a); if (sc.reviewer) { delete x.decision_reason; } return x; });
  });

  route('POST', '/scholarship-applications', ['student', 'parent'], async (c) => {
    const sch = await load(c, c.body.scholarship_id);
    const st = await myStudent(c, c.body.student_id);
    if (sch.status !== 'open') throw S.bad('not_open');
    if (await h.get('SELECT 1 FROM scholarship_applications WHERE scholarship_id = ? AND student_id = ? AND school_id = ?', sch.id, st.id, c.schoolId)) throw S.bad('already_applied');
    const e = await eligibility(c, sch, st);
    if (!e.eligible) throw S.bad('not_eligible', { checks: e.checks });
    const motivation = S.str(c.body.motivation, 3000) || null;
    const id = await h.insert('INSERT INTO scholarship_applications (school_id, scholarship_id, student_id, applied_by, motivation) VALUES (?,?,?,?,?)', c.schoolId, sch.id, st.id, c.user.id, motivation);
    await h.audit(c.schoolId, c.user.id, 'scholarship_application_started', `scholarship_application:${id}`, { scholarship_id: sch.id, student_id: st.id });
    return { id };
  });
  route('GET', '/scholarship-applications/:id', ALL, async (c) => {
    const { a, sc } = await loadApp(c);
    const out = appShape(a);
    out.documents = await docsOf(c, a.id);
    out.can_edit = !!sc.applicant && a.status === 'draft';
    if (sc.reviewer) delete out.decision_reason;
    if (sc.admin || sc.reviewer) {
      const rv = await h.all(`SELECT r.reviewer_id, u.name reviewer_name, r.recommendation, r.note, r.reviewed_at, r.assigned_at FROM scholarship_reviews r JOIN users u ON u.id = r.reviewer_id AND u.school_id = r.school_id
        WHERE r.application_id = ? AND r.school_id = ? ${sc.reviewer ? 'AND r.reviewer_id = ?' : ''} ORDER BY r.assigned_at`, ...[a.id, c.schoolId, ...(sc.reviewer ? [c.user.id] : [])]);
      out.reviews = rv;
      out.can_review = !!sc.reviewer && a.status === 'under_review';
    }
    if (sc.admin) {
      out.can_assign = ['submitted', 'under_review'].includes(a.status);
      out.can_decide = ['submitted', 'under_review', 'waitlisted'].includes(a.status);
      out.places = a.places; out.approved_count = (await h.get("SELECT COUNT(*) n FROM scholarship_applications WHERE scholarship_id = ? AND school_id = ? AND status = 'approved'", a.scholarship_id, c.schoolId)).n;
    }
    return out;
  });
  route('PUT', '/scholarship-applications/:id', ['student', 'parent'], async (c) => {
    const { a } = await loadApp(c);
    if (a.status !== 'draft') throw S.bad('invalid_status');
    await h.run('UPDATE scholarship_applications SET motivation = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', S.str(c.body.motivation, 3000) || null, a.id, c.schoolId);
  });
  route('DELETE', '/scholarship-applications/:id', ['student', 'parent'], async (c) => {
    const { a } = await loadApp(c);
    if (a.status !== 'draft') throw S.bad('invalid_status');
    for (const d of await h.all('SELECT path FROM scholarship_documents WHERE application_id = ? AND school_id = ?', a.id, c.schoolId)) { try { fs.unlinkSync(d.path); } catch { /* already gone */ } }
    await h.run('DELETE FROM scholarship_documents WHERE application_id = ? AND school_id = ?', a.id, c.schoolId);
    await h.run('DELETE FROM scholarship_applications WHERE id = ? AND school_id = ?', a.id, c.schoolId);
  });

  // family notices: the student's own account and linked parent accounts (stored in-app notifications only)
  async function tellFamily(c, a, kind, link) {
    const ids = new Set();
    for (const u of await h.all("SELECT id FROM users WHERE school_id = ? AND role = 'student' AND student_id = ? AND active = 1", c.schoolId, a.student_id)) ids.add(u.id);
    for (const u of await h.all(`SELECT DISTINCT g.user_id id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id JOIN users u ON u.id = g.user_id AND u.school_id = g.school_id
      WHERE sg.school_id = ? AND sg.student_id = ? AND u.role = 'parent' AND u.active = 1`, c.schoolId, a.student_id)) ids.add(u.id);
    for (const id of ids) await app.notify(c.schoolId, id, kind, { title: a.title, student: a.student_name }, link || '#/scholarships?tab=applications');
  }

  route('POST', '/scholarship-applications/:id/submit', ['student', 'parent'], async (c) => {
    const { a } = await loadApp(c);
    if (a.status !== 'draft') throw S.bad('invalid_status');
    const sch = await h.get('SELECT * FROM scholarships WHERE id = ? AND school_id = ?', a.scholarship_id, c.schoolId);
    const st = await h.get('SELECT * FROM students WHERE id = ? AND school_id = ?', a.student_id, c.schoolId);
    const e = await eligibility(c, sch, st);
    if (!e.eligible) throw S.bad('not_eligible', { checks: e.checks });
    if (!a.motivation) throw S.bad('motivation_required');
    await h.run("UPDATE scholarship_applications SET status = 'submitted', submitted_at = NOW_TS, average_at_submission = ?, average_source = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?", e.avg ? e.avg.average : null, e.avg ? e.avg.source : null, a.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'scholarship_application_submitted', `scholarship_application:${a.id}`);
    await tellFamily(c, a, 'scholarship_received');
  });

  // ----- documents (private files; only the applicant side, the administrator and an assigned reviewer can open them) -----
  route('POST', '/scholarship-applications/:id/documents', ['student', 'parent'], async (c) => {
    const { a } = await loadApp(c);
    if (a.status !== 'draft') throw S.bad('invalid_status');
    if (typeof c.body.data !== 'string') throw S.bad('invalid_file');
    const buf = Buffer.from(c.body.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length === 0 || buf.length > MAX_DOC) throw S.bad('file_too_large');
    const mime = sniffDoc(buf);
    if (!mime) throw S.bad('invalid_file_type');
    if ((await h.get('SELECT COUNT(*) n FROM scholarship_documents WHERE application_id = ? AND school_id = ?', a.id, c.schoolId)).n >= MAX_DOCS) throw S.bad('too_many_files');
    const name = S.str(String(c.body.name || 'document').split(/[\\/]/).pop(), 120) || 'document';
    const dir = path.join(app.dataDir, 'uploads', String(c.schoolId), 'scholarships');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, crypto.randomBytes(16).toString('hex'));
    fs.writeFileSync(file, buf);
    const id = await h.insert('INSERT INTO scholarship_documents (school_id, application_id, original_name, mime, size, path, uploaded_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, a.id, name, mime, buf.length, file, c.user.id);
    return { id };
  }).bodyLimit = 5 * 1024 * 1024;
  route('GET', '/scholarship-applications/:id/documents/:doc', ALL, async (c) => {
    const { a } = await loadApp(c);
    const did = S.toInt(c.params.doc);
    const d = did === null ? null : await h.get('SELECT * FROM scholarship_documents WHERE id = ? AND application_id = ? AND school_id = ?', did, a.id, c.schoolId);
    if (!d) throw S.notFound();
    await h.audit(c.schoolId, c.user.id, 'scholarship_document_viewed', `scholarship_application:${a.id}`, { document: d.id });
    const ascii = d.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return { __raw: true, body: fs.readFileSync(d.path), headers: { 'Content-Type': d.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${ascii}"` } };
  });
  route('DELETE', '/scholarship-applications/:id/documents/:doc', ['student', 'parent'], async (c) => {
    const { a } = await loadApp(c);
    if (a.status !== 'draft') throw S.bad('invalid_status');
    const did = S.toInt(c.params.doc);
    const d = did === null ? null : await h.get('SELECT * FROM scholarship_documents WHERE id = ? AND application_id = ? AND school_id = ?', did, a.id, c.schoolId);
    if (!d) throw S.notFound();
    await h.run('DELETE FROM scholarship_documents WHERE id = ? AND school_id = ?', d.id, c.schoolId);
    try { fs.unlinkSync(d.path); } catch { /* already gone */ }
  });

  // ----- administrator: assign reviewers, decide -----
  route('PUT', '/scholarship-applications/:id/reviewers', ADMIN, async (c) => {
    const { a } = await loadApp(c);
    if (!['submitted', 'under_review'].includes(a.status)) throw S.bad('invalid_status');
    if (!Array.isArray(c.body.user_ids) || c.body.user_ids.length > 20) throw S.bad('invalid_data');
    const ids = [...new Set(c.body.user_ids.map(Number))];
    for (const id of ids) if (!(await h.get('SELECT 1 FROM scholarship_reviewers WHERE user_id = ? AND school_id = ?', id, c.schoolId))) throw S.bad('invalid_user');
    await h.tx(async () => {
      for (const r of await h.all('SELECT reviewer_id FROM scholarship_reviews WHERE application_id = ? AND school_id = ?', a.id, c.schoolId)) {
        if (!ids.includes(r.reviewer_id)) await h.run('DELETE FROM scholarship_reviews WHERE application_id = ? AND reviewer_id = ? AND school_id = ?', a.id, r.reviewer_id, c.schoolId);
      }
      for (const id of ids) await h.run('INSERT OR IGNORE INTO scholarship_reviews (school_id, application_id, reviewer_id, assigned_by) VALUES (?,?,?,?)', c.schoolId, a.id, id, c.user.id);
      if (ids.length && a.status === 'submitted') await h.run("UPDATE scholarship_applications SET status = 'under_review', updated_at = NOW_TS WHERE id = ? AND school_id = ?", a.id, c.schoolId);
      await h.audit(c.schoolId, c.user.id, 'scholarship_reviewers_assigned', `scholarship_application:${a.id}`, { users: ids });
    });
    if (ids.length && a.status === 'submitted') await tellFamily(c, a, 'scholarship_under_review');
  });
  route('POST', '/scholarship-applications/:id/review', ['teacher'], async (c) => {
    const { a, sc } = await loadApp(c);
    if (!sc.reviewer || a.status !== 'under_review') throw S.bad('invalid_status');
    if (!['recommend', 'not_recommend', 'undecided'].includes(c.body.recommendation)) throw S.bad('invalid_data');
    await h.run('UPDATE scholarship_reviews SET recommendation = ?, note = ?, reviewed_at = NOW_TS WHERE application_id = ? AND reviewer_id = ? AND school_id = ?', c.body.recommendation, S.str(c.body.note, 2000) || null, a.id, c.user.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'scholarship_review_saved', `scholarship_application:${a.id}`);
  });
  route('POST', '/scholarship-applications/:id/decision', ADMIN, async (c) => {
    const { a } = await loadApp(c);
    if (!['submitted', 'under_review', 'waitlisted'].includes(a.status)) throw S.bad('invalid_status');
    const d = c.body.decision, reason = S.str(c.body.reason, 2000) || null;
    if (!['approved', 'rejected', 'waitlisted'].includes(d)) throw S.bad('invalid_decision');
    if (d !== 'approved' && !reason) throw S.bad('reason_required');
    if (d === 'waitlisted' && a.status === 'waitlisted') throw S.bad('invalid_status');
    if (d === 'approved' && (await h.get("SELECT COUNT(*) n FROM scholarship_applications WHERE scholarship_id = ? AND school_id = ? AND status = 'approved'", a.scholarship_id, c.schoolId)).n >= a.places) throw S.bad('no_places_left');
    await h.run('UPDATE scholarship_applications SET status = ?, decision_reason = ?, decided_by = ?, decided_at = NOW_TS, updated_at = NOW_TS WHERE id = ? AND school_id = ?', d, reason, c.user.id, a.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, `scholarship_application_${d}`, `scholarship_application:${a.id}`);
    if (d === 'approved') {
      const today = todayStr();
      const aid = await h.insert('INSERT INTO scholarship_awards (school_id, application_id, scholarship_id, student_id, awarded_on, valid_from) VALUES (?,?,?,?,?,?)', c.schoolId, a.id, a.scholarship_id, a.student_id, today, today);
      await h.run('INSERT INTO scholarship_award_events (school_id, award_id, event, actor_id) VALUES (?,?,?,?)', c.schoolId, aid, 'awarded', c.user.id);
    }
    await tellFamily(c, a, `scholarship_${d}`);
  });

  // =====================================================================================================
  // RECIPIENTS, RENEWALS, REPORTS (phase 3)
  // An award is created automatically when an application is approved. The administrator manages it; families see only their own.
  // =====================================================================================================
  const AW_SELECT = `SELECT w.*, sc.title, sc.category, sc.renewal_conditions, sc.benefits, st.full_name student_name, st.student_code, cl.name cname, cl.section csection
    FROM scholarship_awards w JOIN scholarships sc ON sc.id = w.scholarship_id AND sc.school_id = w.school_id JOIN students st ON st.id = w.student_id AND st.school_id = w.school_id
    LEFT JOIN classes cl ON cl.id = st.class_id AND cl.school_id = st.school_id`;
  const awShape = (w) => ({ id: w.id, application_id: w.application_id, scholarship: { id: w.scholarship_id, title: w.title, category: w.category }, student: { id: w.student_id, full_name: w.student_name, student_code: w.student_code, class_label: classLabel(w.cname, w.csection) },
    awarded_on: w.awarded_on, valid_from: w.valid_from, valid_until: w.valid_until, status: w.status, status_note: w.status_note, benefits: w.benefits, renewal_conditions: w.renewal_conditions,
    expired: !!(w.valid_until && w.status !== 'ended' && w.valid_until < todayStr()) });
  async function awardScope(c) {
    if (c.user.role === 'school_admin') return { where: 'w.school_id = ?', params: [c.schoolId], admin: true };
    if (c.user.role === 'teacher') throw S.forbidden();
    const sc = A.studentScope(c.user);
    return { where: `w.school_id = ? AND w.student_id IN (SELECT s.id FROM students s WHERE ${sc.where})`, params: [c.schoolId, ...sc.params] };
  }
  async function loadAward(c) {
    const n = S.toInt(c.params.id), sc = await awardScope(c);
    const w = n === null ? null : await h.get(`${AW_SELECT} WHERE ${sc.where} AND w.id = ?`, ...sc.params, n);
    if (!w) throw S.notFound();
    return { w, sc };
  }
  const awEvent = (c, id, ev, note) => h.run('INSERT INTO scholarship_award_events (school_id, award_id, event, note, actor_id) VALUES (?,?,?,?,?)', c.schoolId, id, ev, note || null, c.user.id);
  async function tellAward(c, w, kind) {
    const a = { student_id: w.student_id, title: w.title, student_name: w.student_name };
    return tellFamily(c, a, kind, '#/scholarships?tab=recipients');
  }

  route('GET', '/scholarship-awards', ['school_admin', 'student', 'parent'], async (c) => {
    const sc = await awardScope(c), where = [sc.where], p = [...sc.params];
    if (S.toInt(c.query.scholarship_id) !== null) { where.push('w.scholarship_id = ?'); p.push(Number(c.query.scholarship_id)); }
    if (['active', 'suspended', 'ended'].includes(c.query.status)) { where.push('w.status = ?'); p.push(c.query.status); }
    const q = S.str(c.query.q, 80);
    if (q && sc.admin) { where.push("(LOWER(st.full_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(st.student_code) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    return (await h.all(`${AW_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.id DESC LIMIT 300`, ...p)).map(awShape);
  });
  route('GET', '/scholarship-awards/:id', ['school_admin', 'student', 'parent'], async (c) => {
    const { w, sc } = await loadAward(c);
    const events = await h.all('SELECT e.event, e.note, e.created_at, u.name actor FROM scholarship_award_events e LEFT JOIN users u ON u.id = e.actor_id AND u.school_id = e.school_id WHERE e.award_id = ? AND e.school_id = ? ORDER BY e.id', w.id, c.schoolId);
    const renewals = await h.all('SELECT r.period_label, r.review_date, r.outcome, r.note, r.created_at, u.name decided_by FROM scholarship_renewals r JOIN users u ON u.id = r.decided_by AND u.school_id = r.school_id WHERE r.award_id = ? AND r.school_id = ? ORDER BY r.id', w.id, c.schoolId);
    // families see the history of what happened, but not internal notes on suspensions
    return { ...awShape(w), events: events.map((e) => (sc.admin ? e : { ...e, note: e.event === 'renewed' || e.event === 'not_renewed' ? e.note : null })), renewals: sc.admin ? renewals : renewals.map((r) => ({ ...r, note: r.note })), can_manage: !!sc.admin };
  });
  route('PUT', '/scholarship-awards/:id', ADMIN, async (c) => {
    const { w } = await loadAward(c);
    if (w.status === 'ended') throw S.bad('invalid_status');
    const from = c.body.valid_from === undefined ? w.valid_from : c.body.valid_from, until = c.body.valid_until === undefined ? w.valid_until : (c.body.valid_until || null);
    if (!S.isDate(from) || (until !== null && !S.isDate(until)) || (until && until < from)) throw S.bad('invalid_date');
    await h.run('UPDATE scholarship_awards SET valid_from = ?, valid_until = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', from, until, w.id, c.schoolId);
    await awEvent(c, w.id, 'dates_changed', `${from} → ${until || '—'}`);
    await h.audit(c.schoolId, c.user.id, 'scholarship_award_dates_changed', `scholarship_award:${w.id}`);
  });
  route('POST', '/scholarship-awards/:id/status', ADMIN, async (c) => {
    const { w } = await loadAward(c);
    const to = c.body.status, note = S.str(c.body.note, 1000) || null;
    if (!['active', 'suspended', 'ended'].includes(to) || w.status === 'ended' || to === w.status) throw S.bad('invalid_status');
    if (to !== 'active' && !note) throw S.bad('note_required');
    await h.run('UPDATE scholarship_awards SET status = ?, status_note = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', to, to === 'active' ? null : note, w.id, c.schoolId);
    await awEvent(c, w.id, to === 'active' ? 'resumed' : to, note);
    await h.audit(c.schoolId, c.user.id, `scholarship_award_${to}`, `scholarship_award:${w.id}`);
    await tellAward(c, w, `scholarship_award_${to}`);
  });
  // a renewal review: "renewed" may extend the end date; "not renewed" ends the award
  route('POST', '/scholarship-awards/:id/renewals', ADMIN, async (c) => {
    const { w } = await loadAward(c);
    if (w.status === 'ended') throw S.bad('invalid_status');
    const label = S.str(c.body.period_label, 80), note = S.str(c.body.note, 1000) || null, outcome = c.body.outcome;
    const reviewDate = c.body.review_date || todayStr();
    if (!label) throw S.bad('period_required');
    if (!['renewed', 'not_renewed'].includes(outcome) || !S.isDate(reviewDate)) throw S.bad('invalid_data');
    if (outcome === 'not_renewed' && !note) throw S.bad('note_required');
    let until = w.valid_until;
    if (outcome === 'renewed' && c.body.valid_until) { if (!S.isDate(c.body.valid_until) || c.body.valid_until < w.valid_from) throw S.bad('invalid_date'); until = c.body.valid_until; }
    await h.tx(async () => {
      await h.run('INSERT INTO scholarship_renewals (school_id, award_id, period_label, review_date, outcome, note, decided_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, w.id, label, reviewDate, outcome, note, c.user.id);
      await h.run('UPDATE scholarship_awards SET valid_until = ?, status = ?, status_note = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', until, outcome === 'not_renewed' ? 'ended' : 'active', outcome === 'not_renewed' ? note : null, w.id, c.schoolId);
      await awEvent(c, w.id, outcome, `${label}${note ? ` — ${note}` : ''}`);
      await h.audit(c.schoolId, c.user.id, `scholarship_award_${outcome}`, `scholarship_award:${w.id}`);
    });
    await tellAward(c, w, `scholarship_award_${outcome}`);
  });

  // ----- reports and CSV (administrator only) -----
  route('GET', '/scholarship-reports', ADMIN, async (c) => {
    const per = await h.all(`SELECT sc.id, sc.title, sc.category, sc.status, sc.places,
        (SELECT COUNT(*) FROM scholarship_applications a WHERE a.scholarship_id = sc.id AND a.school_id = sc.school_id AND a.status <> 'draft') applications,
        (SELECT COUNT(*) FROM scholarship_applications a WHERE a.scholarship_id = sc.id AND a.school_id = sc.school_id AND a.status = 'approved') approved,
        (SELECT COUNT(*) FROM scholarship_applications a WHERE a.scholarship_id = sc.id AND a.school_id = sc.school_id AND a.status = 'rejected') rejected,
        (SELECT COUNT(*) FROM scholarship_applications a WHERE a.scholarship_id = sc.id AND a.school_id = sc.school_id AND a.status = 'waitlisted') waitlisted,
        (SELECT COUNT(*) FROM scholarship_applications a WHERE a.scholarship_id = sc.id AND a.school_id = sc.school_id AND a.status IN ('submitted','under_review')) pending,
        (SELECT COUNT(*) FROM scholarship_awards w WHERE w.scholarship_id = sc.id AND w.school_id = sc.school_id AND w.status = 'active') active_awards
      FROM scholarships sc WHERE sc.school_id = ? AND sc.status <> 'draft' ORDER BY sc.id DESC`, c.schoolId);
    const tot = per.reduce((t, r) => ({ applications: t.applications + r.applications, approved: t.approved + r.approved, rejected: t.rejected + r.rejected, waitlisted: t.waitlisted + r.waitlisted, pending: t.pending + r.pending, active_awards: t.active_awards + r.active_awards }), { applications: 0, approved: 0, rejected: 0, waitlisted: 0, pending: 0, active_awards: 0 });
    return { totals: tot, scholarships: per };
  });
  // Cells that start with = + - @ could run as formulas when opened in a spreadsheet, so they are prefixed with an apostrophe.
  const csvCell = (v) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  route('GET', '/scholarship-reports/export', ADMIN, async (c) => {
    const type = c.query.type === 'awards' ? 'awards' : 'applications';
    let body;
    if (type === 'applications') {
      const rows = await h.all(`${APP_SELECT} WHERE a.school_id = ? AND a.status <> 'draft' ORDER BY a.id`, c.schoolId);
      body = csv(['id', 'scholarship', 'category', 'student', 'student_number', 'class', 'status', 'submitted_at', 'average_at_submission', 'decided_at', 'decision_reason'],
        rows.map((a) => [a.id, a.title, a.category, a.student_name, a.student_code, classLabel(a.cname, a.csection), a.status, a.submitted_at, a.average_at_submission, a.decided_at, a.decision_reason]));
    } else {
      const rows = await h.all(`${AW_SELECT} WHERE w.school_id = ? ORDER BY w.id`, c.schoolId);
      body = csv(['id', 'scholarship', 'category', 'student', 'student_number', 'class', 'status', 'awarded_on', 'valid_from', 'valid_until'], rows.map((w) => [w.id, w.title, w.category, w.student_name, w.student_code, classLabel(w.cname, w.csection), w.status, w.awarded_on, w.valid_from, w.valid_until]));
    }
    await h.audit(c.schoolId, c.user.id, 'scholarship_export', `school:${c.schoolId}`, { type });
    return { __raw: true, body: Buffer.from(body, 'utf8'), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="scholarship-${type}.csv"` } };
  });
};
