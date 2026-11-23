'use strict';
// Discipline module, phase 4: parent convocations and the official A4 letter (PDF, English or French).
// Who: administrator and discipline officers create; the administrator or a principal (approve_decisions) approves.
// The letter shows ONLY the reason written for the parent. Confidential council notes are never copied into it.
// "Handed over" is recorded by staff by hand; this phase never claims a message was delivered by any channel.
const fs = require('node:fs');
const S = require('./security');
const A = require('./access');
const pdf = require('./pdf');

const STAFF = ['school_admin', 'teacher'];
const classLabel = (name, section) => (name ? `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}` : null);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const TEXT = {
  en: { title: 'CONVOCATION', to: 'To', dear: 'Dear', parentOf: 'Parent / Guardian of', ref: 'Ref.', place: 'Date', subject: 'Subject: Invitation to meet the school administration',
    body: (d) => `We kindly invite you to meet the administration of ${d.school} on ${d.date} at ${d.time}, at ${d.location}, concerning your child ${d.student}${d.cls ? ` (${d.cls})` : ''}, student number ${d.code}.`,
    reason: 'Reason for the meeting', instr: 'Please note', close: 'Your presence is important so that we can work together for your child\'s wellbeing and progress. If you cannot attend on this date, please inform the school office as soon as possible so another date can be arranged.',
    regards: 'Yours faithfully,', signer: 'The School Administration', stamp: 'School stamp', ack: 'Acknowledgement of receipt', ackText: 'I have received this convocation.', parentSig: 'Parent / Guardian name and signature', ackDate: 'Date', conf: 'Confidential - for the parent / guardian only.', page: 'Student', draft: 'DRAFT - NOT YET APPROVED' },
  fr: { title: 'CONVOCATION', to: 'À l\'attention de', dear: 'Madame, Monsieur', parentOf: 'Parent / Tuteur de', ref: 'Réf.', place: 'Date', subject: 'Objet : Invitation à rencontrer l\'administration de l\'école',
    body: (d) => `Nous avons l'honneur de vous inviter à rencontrer l'administration de ${d.school} le ${d.date} à ${d.time}, à l'adresse suivante : ${d.location}, au sujet de votre enfant ${d.student}${d.cls ? ` (${d.cls})` : ''}, matricule ${d.code}.`,
    reason: 'Motif de la rencontre', instr: 'À noter', close: 'Votre présence est importante afin que nous puissions travailler ensemble pour le bien-être et la réussite de votre enfant. Si vous ne pouvez pas venir à cette date, merci d\'en informer le secrétariat de l\'école dans les meilleurs délais afin de convenir d\'une autre date.',
    regards: 'Veuillez agréer, Madame, Monsieur, l\'expression de nos salutations distinguées.', signer: 'L\'Administration de l\'école', stamp: 'Cachet de l\'école', ack: 'Accusé de réception', ackText: 'J\'ai bien reçu cette convocation.', parentSig: 'Nom et signature du parent / tuteur', ackDate: 'Date', conf: 'Confidentiel - réservé au parent / tuteur.', page: 'Élève', draft: 'BROUILLON - NON APPROUVÉ' },
};
const fmtDate = (iso, lang) => { const [y, m, d] = iso.split('-'); return lang === 'fr' ? `${d}/${m}/${y}` : `${d}/${m}/${y}`; };

module.exports = function (app) {
  const { h, route } = app;
  const isAdmin = (c) => c.user.role === 'school_admin';
  const need = (c) => A.requirePerm(h, c.user, 'manage_discipline', 'approve_decisions');
  const canRun = (c, perms) => isAdmin(c) || perms.has('manage_discipline');
  const canApprove = (c, perms) => isAdmin(c) || perms.has('approve_decisions');

  const SELECT = `SELECT v.*, s.full_name student_name, s.student_code, c.name cname, c.section csection, u.name created_by_name, a.name approved_by_name
    FROM convocations v JOIN students s ON s.id = v.student_id AND s.school_id = v.school_id
    LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
    JOIN users u ON u.id = v.created_by AND u.school_id = v.school_id LEFT JOIN users a ON a.id = v.approved_by AND a.school_id = v.school_id`;
  const shape = (v) => ({ id: v.id, reference: v.reference, student_id: v.student_id, student_name: v.student_name, student_code: v.student_code, class_label: classLabel(v.cname, v.csection),
    incident_id: v.incident_id, case_id: v.case_id, guardian_id: v.guardian_id, recipient_name: v.recipient_name, meet_date: v.meet_date, meet_time: v.meet_time, location: v.location,
    reason_for_parent: v.reason_for_parent, instructions: v.instructions, status: v.status, approved_by_name: v.approved_by_name, approved_at: v.approved_at, decision_comment: v.decision_comment,
    handed_over_on: v.handed_over_on, handed_over_method: v.handed_over_method, parent_response: v.parent_response, response_note: v.response_note, attended: v.attended === null ? null : !!v.attended,
    outcome: v.outcome, created_by_name: v.created_by_name, created_at: v.created_at });
  const load = async (c) => {
    const id = S.toInt(c.params.id);
    const v = id === null ? null : await h.get(`${SELECT} WHERE v.id = ? AND v.school_id = ?`, id, c.schoolId);
    if (!v) throw S.notFound();
    return v;
  };
  const event = (c, id, ev, note) => h.run('INSERT INTO convocation_events (school_id, convocation_id, event, note, actor_id) VALUES (?,?,?,?,?)', c.schoolId, id, ev, note || null, c.user.id);

  async function fields(c, existing) {
    const b = c.body, out = {};
    if (!existing) {
      const sid = S.toInt(b.student_id);
      const st = sid === null ? null : await h.get('SELECT id FROM students WHERE id = ? AND school_id = ?', sid, c.schoolId);
      if (!st) throw S.bad('invalid_student');
      out.student_id = st.id;
      out.incident_id = null; out.case_id = null;
      if (b.incident_id) {
        const i = S.toInt(b.incident_id);
        if (i === null || !(await h.get('SELECT 1 FROM discipline_incidents WHERE id = ? AND school_id = ? AND student_id = ?', i, c.schoolId, st.id))) throw S.bad('invalid_incident');
        out.incident_id = i;
      }
      if (b.case_id) {
        const k = S.toInt(b.case_id);
        if (k === null || !(await h.get('SELECT 1 FROM council_cases WHERE id = ? AND school_id = ? AND student_id = ?', k, c.schoolId, st.id))) throw S.bad('invalid_case');
        out.case_id = k;
      }
    }
    const studentId = existing ? existing.student_id : out.student_id;
    out.guardian_id = existing ? existing.guardian_id : null;
    if (b.guardian_id !== undefined || !existing) {
      out.guardian_id = null; out.recipient_name = null;
      if (b.guardian_id) {
        const g = S.toInt(b.guardian_id);
        const row = g === null ? null : await h.get('SELECT g.id, g.full_name FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id AND sg.school_id = g.school_id WHERE g.id = ? AND g.school_id = ? AND sg.student_id = ?', g, c.schoolId, studentId);
        if (!row) throw S.bad('invalid_guardian');
        out.guardian_id = row.id; out.recipient_name = row.full_name;
      } else out.recipient_name = S.str(b.recipient_name, 120);
      if (!out.recipient_name) { if (existing) out.recipient_name = existing.recipient_name; else throw S.bad('recipient_required'); }
    }
    out.meet_date = b.meet_date === undefined && existing ? existing.meet_date : b.meet_date;
    if (!S.isDate(out.meet_date)) throw S.bad('invalid_date');
    out.meet_time = b.meet_time === undefined && existing ? existing.meet_time : b.meet_time;
    if (typeof out.meet_time !== 'string' || !TIME.test(out.meet_time)) throw S.bad('invalid_time');
    out.location = b.location === undefined && existing ? existing.location : S.str(b.location, 200);
    if (!out.location) throw S.bad('location_required');
    out.reason_for_parent = b.reason_for_parent === undefined && existing ? existing.reason_for_parent : S.str(b.reason_for_parent, 1500);
    if (!out.reason_for_parent) throw S.bad('reason_required');
    out.instructions = b.instructions === undefined && existing ? existing.instructions : (S.str(b.instructions, 800) || null);
    return out;
  }

  route('GET', '/discipline/convocations', STAFF, async (c) => {
    const perms = await need(c);
    const where = ['v.school_id = ?'], p = [c.schoolId];
    if (S.toInt(c.query.student_id) !== null) { where.push('v.student_id = ?'); p.push(Number(c.query.student_id)); }
    if (['draft', 'approved', 'rejected', 'postponed', 'cancelled', 'completed'].includes(c.query.status)) { where.push('v.status = ?'); p.push(c.query.status); }
    const rows = await h.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY v.meet_date DESC, v.id DESC LIMIT 200`, ...p);
    return rows.map((v) => ({ ...shape(v), can_approve: canApprove(c, perms) && v.status === 'draft' }));
  });

  route('POST', '/discipline/convocations', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const f = await fields(c, null);
    const year = new Date().getFullYear();
    const n = (await h.get('SELECT COUNT(*) n FROM convocations WHERE school_id = ?', c.schoolId)).n + 1;
    const reference = `CONV-${year}-${String(n).padStart(4, '0')}`;
    const id = await h.insert('INSERT INTO convocations (school_id, student_id, incident_id, case_id, guardian_id, recipient_name, reference, meet_date, meet_time, location, reason_for_parent, instructions, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.schoolId, f.student_id, f.incident_id, f.case_id, f.guardian_id, f.recipient_name, reference, f.meet_date, f.meet_time, f.location, f.reason_for_parent, f.instructions, c.user.id);
    await event(c, id, 'created');
    await h.audit(c.schoolId, c.user.id, 'convocation_created', `convocation:${id}`, { student_id: f.student_id });
    return { id, reference };
  });

  route('GET', '/discipline/convocations/:id', STAFF, async (c) => {
    const perms = await need(c);
    const v = await load(c);
    const events = await h.all('SELECT e.event, e.note, e.created_at, u.name actor FROM convocation_events e JOIN users u ON u.id = e.actor_id AND u.school_id = e.school_id WHERE e.convocation_id = ? AND e.school_id = ? ORDER BY e.id', v.id, c.schoolId);
    const dispatches = await h.all('SELECT d.channel, d.status, d.created_at, u.name actor FROM convocation_dispatches d JOIN users u ON u.id = d.actor_id AND u.school_id = d.school_id WHERE d.convocation_id = ? AND d.school_id = ? ORDER BY d.id', v.id, c.schoolId);
    return { ...shape(v), events, dispatches, can_edit: canRun(c, perms) && v.status === 'draft', can_approve: canApprove(c, perms) && v.status === 'draft', can_manage: canRun(c, perms) };
  });

  route('PUT', '/discipline/convocations/:id', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const v = await load(c);
    if (v.status !== 'draft') throw S.bad('invalid_status');
    const f = await fields(c, v);
    await h.run('UPDATE convocations SET guardian_id = ?, recipient_name = ?, meet_date = ?, meet_time = ?, location = ?, reason_for_parent = ?, instructions = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?',
      f.guardian_id, f.recipient_name, f.meet_date, f.meet_time, f.location, f.reason_for_parent, f.instructions, v.id, c.schoolId);
    await event(c, v.id, 'edited');
    await h.audit(c.schoolId, c.user.id, 'convocation_edited', `convocation:${v.id}`);
  });

  route('POST', '/discipline/convocations/:id/approve', STAFF, async (c) => {
    const perms = await need(c);
    if (!canApprove(c, perms)) throw S.forbidden();
    const v = await load(c);
    if (v.status !== 'draft') throw S.bad('invalid_status');
    const approve = c.body.approve === true, comment = S.str(c.body.comment, 1000) || null;
    if (!approve && !comment) throw S.bad('comment_required');
    await h.run('UPDATE convocations SET status = ?, approved_by = ?, approved_at = NOW_TS, decision_comment = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', approve ? 'approved' : 'rejected', c.user.id, comment, v.id, c.schoolId);
    await event(c, v.id, approve ? 'approved' : 'rejected', comment);
    if (approve) await tellParents(c, v, 'convocation_issued');
    await h.audit(c.schoolId, c.user.id, approve ? 'convocation_approved' : 'convocation_rejected', `convocation:${v.id}`);
  });

  // postpone (new date), cancel, complete - only after approval
  route('POST', '/discipline/convocations/:id/status', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const v = await load(c);
    const to = c.body.status, comment = S.str(c.body.comment, 1000) || null;
    if (!['postponed', 'cancelled', 'completed'].includes(to)) throw S.bad('invalid_status');
    if (!['approved', 'postponed'].includes(v.status)) throw S.bad('invalid_status');
    if (to !== 'completed' && !comment) throw S.bad('comment_required');
    if (to === 'postponed') {
      if (!S.isDate(c.body.meet_date) || typeof c.body.meet_time !== 'string' || !TIME.test(c.body.meet_time)) throw S.bad('invalid_date');
      await h.run('UPDATE convocations SET status = ?, meet_date = ?, meet_time = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', to, c.body.meet_date, c.body.meet_time, v.id, c.schoolId);
    } else await h.run('UPDATE convocations SET status = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', to, v.id, c.schoolId);
    await event(c, v.id, to, comment);
    if (to !== 'completed') await tellParents(c, to === 'postponed' ? { ...v, meet_date: c.body.meet_date, meet_time: c.body.meet_time } : v, `convocation_${to}`);
    await h.audit(c.schoolId, c.user.id, `convocation_${to}`, `convocation:${v.id}`);
  });

  // Staff records how the printed letter reached the parent. This is a manual record, not a delivery report.
  route('POST', '/discipline/convocations/:id/handover', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const v = await load(c);
    if (!['approved', 'postponed'].includes(v.status)) throw S.bad('invalid_status');
    if (!['printed', 'hand_delivered', 'downloaded'].includes(c.body.method)) throw S.bad('invalid_method');
    const on = c.body.date || new Date().toISOString().slice(0, 10);
    if (!S.isDate(on)) throw S.bad('invalid_date');
    await h.run('UPDATE convocations SET handed_over_on = ?, handed_over_method = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', on, c.body.method, v.id, c.schoolId);
    await event(c, v.id, `handover_${c.body.method}`);
    await h.audit(c.schoolId, c.user.id, 'convocation_handover_recorded', `convocation:${v.id}`, { method: c.body.method });
  });

  route('POST', '/discipline/convocations/:id/response', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const v = await load(c);
    if (!['approved', 'postponed', 'completed'].includes(v.status)) throw S.bad('invalid_status');
    const b = c.body;
    const pr = b.parent_response === undefined ? v.parent_response : b.parent_response;
    if (!['none', 'attending', 'unable'].includes(pr)) throw S.bad('invalid_response');
    const attended = b.attended === undefined ? v.attended : (b.attended === null ? null : (b.attended ? 1 : 0));
    const note = b.response_note === undefined ? v.response_note : (S.str(b.response_note, 1000) || null);
    const outcome = b.outcome === undefined ? v.outcome : (S.str(b.outcome, 1500) || null);
    await h.run('UPDATE convocations SET parent_response = ?, response_note = ?, attended = ?, outcome = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?', pr, note, attended, outcome, v.id, c.schoolId);
    await event(c, v.id, 'response_recorded');
    await h.audit(c.schoolId, c.user.id, 'convocation_response_recorded', `convocation:${v.id}`);
  });

  // ----- the official letter -----
  route('GET', '/discipline/convocations/:id/pdf', STAFF, async (c) => {
    await need(c);
    const v = await load(c);
    if (!['approved', 'postponed', 'completed', 'draft'].includes(v.status)) throw S.bad('invalid_status'); // rejected and cancelled letters are not issued
    return renderPdf(c, v);
  });
  async function renderPdf(c, v) {
    const lang = c.query.lang === 'fr' ? 'fr' : 'en', T = TEXT[lang];
    const sch = c.school;
    const p = new pdf.Page(), L = p.left, R = p.right;
    let jpeg = null;
    if (sch.logo_file_id) {
      const f = await h.get("SELECT path, mime FROM files WHERE id = ? AND school_id = ? AND kind = 'school_logo'", sch.logo_file_id, c.schoolId);
      if (f && (f.mime === 'image/jpeg' || f.mime === 'image/png')) { try { jpeg = fs.readFileSync(f.path); } catch { jpeg = null; } } // JPEG or PNG logo
    }
    const inf = jpeg && pdf.imageInfo(jpeg);
    if (inf) { const hh = 56, ww = Math.min(80, inf.w * hh / inf.h); p.logo = { x: L, y: p.y - hh + 12, w: ww, h: hh }; }
    const hx = inf ? L + 96 : L;
    p.text(sch.name, hx, p.y, 15, true);
    let hy = p.y - 16;
    for (const ln of [sch.motto, sch.address || sch.location, [sch.phone, sch.email].filter(Boolean).join('  |  ')].filter(Boolean)) { p.text(ln, hx, hy, 9.5, false); hy -= 12; }
    p.y = Math.min(hy, p.y - 56) - 8;
    p.line(L, p.y, R, p.y, 1.5); p.y -= 34;
    p.center(T.title, p.y, 20, true); p.y -= 14;
    if (v.status === 'draft') { p.color('B00020'); p.center(T.draft, p.y - 8, 10, true); p.color('000000'); p.y -= 10; }
    p.y -= 20;
    p.text(`${T.ref} ${v.reference}`, L, p.y, 10, false);
    const today = fmtDate(new Date().toISOString().slice(0, 10), lang);
    const dl = `${T.place}: ${today}`; p.text(dl, R - pdf.textWidth(dl, 10, false), p.y, 10, false); p.y -= 26;
    p.labelled(T.to, `${v.recipient_name} - ${T.parentOf} ${v.student_name}`); p.y -= 6;
    p.para(T.subject, 11, true, 12);
    p.para(`${T.dear},`, 11, false, 8);
    const cls = classLabel(v.cname, v.csection);
    p.para(T.body({ school: sch.name, date: fmtDate(v.meet_date, lang), time: v.meet_time, location: v.location, student: v.student_name, cls, code: v.student_code }), 11, false, 10);
    p.para(`${T.reason}:`, 11, true, 2); p.para(v.reason_for_parent, 11, false, 10);
    if (v.instructions) { p.para(`${T.instr}:`, 11, true, 2); p.para(v.instructions, 11, false, 10); }
    p.para(T.close, 11, false, 14);
    p.para(T.regards, 11, false, 24);
    // signature and stamp areas
    const top = p.y;
    p.text(T.signer, L, top, 11, true);
    p.line(L, top - 50, L + 190, top - 50);
    p.rect(R - 120, top - 70, 110, 80, 0.8, true); p.text(T.stamp, R - 120 + 55 - pdf.textWidth(T.stamp, 8, false) / 2, top - 82, 8, false);
    p.y = top - 112;
    // parent acknowledgement slip
    p.line(L, p.y, R, p.y, 0.6); p.y -= 16;
    p.text(T.ack, L, p.y, 11, true); p.y -= 16;
    p.text(T.ackText, L, p.y, 10, false); p.y -= 34;
    p.line(L, p.y, L + 230, p.y); p.line(R - 130, p.y, R, p.y); p.y -= 12;
    p.text(T.parentSig, L, p.y, 8.5, false); p.text(T.ackDate, R - 130, p.y, 8.5, false);
    p.text(`${T.conf}  ${T.ref} ${v.reference}`, L, 40, 8, false);
    await h.audit(c.schoolId, c.user.id, 'convocation_pdf_generated', `convocation:${v.id}`, { lang });
    const buf = pdf.build([p], { title: `${T.title} ${v.reference}`, logo: jpeg });
    return { __raw: true, body: buf, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${v.reference}-${lang}.pdf"` } };
  }

  // ----- in-app notice to the parents linked to the student (a real, stored notification; nothing is sent outside JAO) -----
  async function tellParents(c, v, kind) {
    const users = await h.all(`SELECT DISTINCT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id
      JOIN users u ON u.id = g.user_id AND u.school_id = g.school_id WHERE sg.school_id = ? AND sg.student_id = ? AND g.user_id IS NOT NULL AND u.role = 'parent'`, c.schoolId, v.student_id);
    for (const u of users) await app.notify(c.schoolId, u.user_id, kind, { reference: v.reference, student: v.student_name, date: v.meet_date, time: v.meet_time }, '#/my-convocations');
    return users.length;
  }

  // ----- prepare a message in the parent's own app. JAO never sends it and never reports it as delivered. -----
  route('GET', '/discipline/channels', STAFF, async (c) => {
    await need(c);
    return { whatsapp: { mode: 'manual', provider: false }, email: { mode: 'manual', provider: false }, sms: { mode: 'manual', provider: false } };
  });
  route('POST', '/discipline/convocations/:id/prepare', STAFF, async (c) => {
    const perms = await need(c);
    if (!canRun(c, perms)) throw S.forbidden();
    const v = await load(c);
    if (!['approved', 'postponed'].includes(v.status)) throw S.bad('invalid_status');
    const channel = c.body.channel;
    if (!['whatsapp', 'email', 'sms'].includes(channel)) throw S.bad('invalid_channel');
    const g = v.guardian_id ? await h.get('SELECT phone, email FROM guardians WHERE id = ? AND school_id = ?', v.guardian_id, c.schoolId) : null;
    const lang = c.body.lang === 'fr' ? 'fr' : 'en';
    const date = fmtDate(v.meet_date, lang);
    const text = lang === 'fr'
      ? `${c.school.name} : convocation ${v.reference} pour ${v.student_name}, le ${date} à ${v.meet_time}, ${v.location}. Merci de contacter l'école en cas d'empêchement.`
      : `${c.school.name}: convocation ${v.reference} for ${v.student_name} on ${date} at ${v.meet_time}, ${v.location}. Please contact the school if you cannot attend.`;
    let url;
    if (channel === 'email') { if (!g || !g.email) throw S.bad('no_contact'); url = `mailto:${encodeURIComponent(g.email)}?subject=${encodeURIComponent(`${TEXT[lang].title} ${v.reference}`)}&body=${encodeURIComponent(text)}`; }
    else {
      const digits = g && g.phone ? String(g.phone).replace(/[^\d]/g, '') : '';
      if (digits.length < 7) throw S.bad('no_contact');
      url = channel === 'whatsapp' ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `sms:+${digits}?body=${encodeURIComponent(text)}`;
    }
    await h.run('INSERT INTO convocation_dispatches (school_id, convocation_id, channel, actor_id) VALUES (?,?,?,?)', c.schoolId, v.id, channel, c.user.id);
    await event(c, v.id, `prepared_${channel}`);
    await h.audit(c.schoolId, c.user.id, 'convocation_message_prepared', `convocation:${v.id}`, { channel });
    return { url, status: 'prepared', text };
  });

  // ----- parent view: only their own linked children, only issued letters, no internal notes -----
  const PARENT = ['parent'];
  const parentRows = async (c, id) => {
    const sc = A.studentScope(c.user);
    const where = [`v.school_id = ?`, `v.status IN ('approved','postponed','completed')`, `v.student_id IN (SELECT s.id FROM students s WHERE ${sc.where})`], p = [c.schoolId, ...sc.params];
    if (id !== undefined) { where.push('v.id = ?'); p.push(id); }
    return h.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY v.meet_date DESC, v.id DESC LIMIT 100`, ...p);
  };
  route('GET', '/parent/convocations', PARENT, async (c) => (await parentRows(c)).map((v) => ({ id: v.id, reference: v.reference, student_name: v.student_name, class_label: classLabel(v.cname, v.csection), meet_date: v.meet_date, meet_time: v.meet_time, location: v.location, reason_for_parent: v.reason_for_parent, instructions: v.instructions, status: v.status })));
  route('GET', '/parent/convocations/:id/pdf', PARENT, async (c) => {
    const id = S.toInt(c.params.id);
    const v = id === null ? null : (await parentRows(c, id))[0];
    if (!v) throw S.notFound();
    return renderPdf(c, v);
  });
  app.convocationNotify = tellParents;
};
