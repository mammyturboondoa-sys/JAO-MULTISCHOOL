'use strict';
// Prefects. Only a student of Form 5, Lower Sixth or Upper Sixth can hold a prefect post (checked HERE, on the server).
// Every query is filtered by c.schoolId, which comes from the verified session, never from the browser.
const S = require('./security');
const { isEligibleClass } = require('./prefect-defaults');

const ADMIN = ['school_admin'];
const READ = ['school_admin', 'teacher', 'parent'];
const photoUrl = (id) => (id ? `/api/files/${id}` : null);
const classLabel = (name, section) => (name ? `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}` : null);
const today = () => new Date().toISOString().slice(0, 10);

module.exports = function (app) {
  const { h, route } = app;

  const nameOf = (b) => {
    const en = S.str(b.name_en, 120), fr = S.str(b.name_fr, 120);
    if (!en && !fr) throw S.bad('name_required');
    return { en: en || fr, fr: fr || en };
  };
  const yearOf = async (schoolId, id) => {
    if (id !== undefined && id !== null && id !== '') {
      const n = S.toInt(id);
      const y = n === null ? null : await h.get('SELECT id, name FROM academic_years WHERE id = ? AND school_id = ?', n, schoolId);
      if (!y) throw S.bad('invalid_year');
      return y;
    }
    return (await h.get('SELECT id, name FROM academic_years WHERE school_id = ? AND is_current = 1', schoolId))
      || (await h.get('SELECT id, name FROM academic_years WHERE school_id = ? ORDER BY id DESC', schoolId)) || null;
  };
  // A student is eligible when still enrolled and in Form 5, Lower Sixth or Upper Sixth.
  const studentRow = async (schoolId, id) => {
    const n = S.toInt(id);
    if (n === null) return null;
    return await h.get(`SELECT s.id, s.full_name, s.status, s.archived_at, c.name cname, c.section csection FROM students s
      LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id WHERE s.id = ? AND s.school_id = ?`, n, schoolId);
  };
  const eligible = (s) => !!s && s.status === 'active' && !s.archived_at && isEligibleClass(s.cname);

  // Appointments of the CURRENT year end by themselves when the student leaves the allowed classes (graduates, transfers, moves
  // out of Form 5 - Upper Sixth). They are marked "ended", never deleted, and earlier years are never touched.
  const syncEnded = async (schoolId, year) => {
    const cur = await h.get('SELECT id FROM academic_years WHERE school_id = ? AND is_current = 1', schoolId);
    if (!year || !cur || cur.id !== year.id) return;
    const rows = await h.all(`SELECT a.id, s.status, s.archived_at, c.name cname FROM prefect_appointments a
      JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
      WHERE a.school_id = ? AND a.year_id = ? AND a.status = 'active'`, schoolId, year.id);
    for (const r of rows) {
      if (r.status === 'active' && !r.archived_at && isEligibleClass(r.cname)) continue;
      await h.run("UPDATE prefect_appointments SET status = 'ended', ended_on = ?, ended_reason = 'no_longer_eligible' WHERE id = ? AND school_id = ?", today(), r.id, schoolId);
    }
  };

  // ----- posts (the list of prefect positions) -----
  route('GET', '/prefects/posts', READ, async (c) => {
    const all = c.user.role === 'school_admin' && c.query.all === '1';
    return await h.all(`SELECT id, name_en, name_fr, active FROM prefect_posts WHERE school_id = ? ${all ? '' : 'AND active = 1'} ORDER BY sort_order, id`, c.schoolId);
  });
  route('POST', '/prefects/posts', ADMIN, async (c) => {
    const n = nameOf(c.body);
    if (await h.get('SELECT 1 FROM prefect_posts WHERE school_id = ? AND LOWER(name_en) = LOWER(?)', c.schoolId, n.en)) throw S.bad('name_in_use');
    const next = (await h.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM prefect_posts WHERE school_id = ?', c.schoolId)).n;
    const id = await h.insert('INSERT INTO prefect_posts (school_id, name_en, name_fr, sort_order) VALUES (?,?,?,?)', c.schoolId, n.en, n.fr, next);
    await h.audit(c.schoolId, c.user.id, 'prefect_post_created', `prefect_post:${id}`);
    return { id };
  });
  route('PUT', '/prefects/posts/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const cur = id === null ? null : await h.get('SELECT * FROM prefect_posts WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!cur) throw S.notFound();
    const n = c.body.name_en !== undefined || c.body.name_fr !== undefined ? nameOf({ name_en: c.body.name_en ?? cur.name_en, name_fr: c.body.name_fr ?? cur.name_fr }) : { en: cur.name_en, fr: cur.name_fr };
    if (n.en.toLowerCase() !== cur.name_en.toLowerCase() && await h.get('SELECT 1 FROM prefect_posts WHERE school_id = ? AND LOWER(name_en) = LOWER(?) AND id <> ?', c.schoolId, n.en, cur.id)) throw S.bad('name_in_use');
    const active = c.body.active === undefined ? cur.active : (c.body.active ? 1 : 0);
    await h.run('UPDATE prefect_posts SET name_en = ?, name_fr = ?, active = ? WHERE id = ? AND school_id = ?', n.en, n.fr, active, cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'prefect_post_updated', `prefect_post:${cur.id}`);
    return { ok: true };
  });

  // ----- students who may be chosen (Form 5, Lower Sixth, Upper Sixth) -----
  route('GET', '/prefects/eligible', ADMIN, async (c) => {
    const q = S.str(c.query.q, 80).toLowerCase();
    const rows = await h.all(`SELECT s.id, s.student_code, s.full_name, s.photo_file_id, c.name cname, c.section csection FROM students s
      JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id WHERE s.school_id = ? AND s.status = 'active' AND s.archived_at IS NULL ORDER BY s.full_name`, c.schoolId);
    return rows.filter((r) => isEligibleClass(r.cname) && (!q || r.full_name.toLowerCase().includes(q) || String(r.student_code).toLowerCase().includes(q)))
      .slice(0, 200).map((r) => ({ id: r.id, code: r.student_code, name: r.full_name, class_label: classLabel(r.cname, r.csection), photo: photoUrl(r.photo_file_id) }));
  });

  // ----- appointments -----
  route('GET', '/prefects', READ, async (c) => {
    const year = await yearOf(c.schoolId, c.query.year_id);
    if (!year) return { year: null, rows: [] };
    await syncEnded(c.schoolId, year);
    const isAdmin = c.user.role === 'school_admin';
    const rows = await h.all(`SELECT a.id, a.status, a.ended_on, a.ended_reason, a.created_at, p.id post_id, p.name_en post_en, p.name_fr post_fr,
        s.id student_id, s.full_name, s.photo_file_id, c.name cname, c.section csection
      FROM prefect_appointments a JOIN prefect_posts p ON p.id = a.post_id AND p.school_id = a.school_id
      JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
      WHERE a.school_id = ? AND a.year_id = ? ${isAdmin ? '' : "AND a.status = 'active'"} ORDER BY p.sort_order, p.id, s.full_name`, c.schoolId, year.id);
    // Parents and teachers see name, class and post only; photos are shown to the administrator (they follow the student-record rules).
    return { year, rows: rows.map((r) => ({ id: r.id, status: r.status, ended_on: r.ended_on, ended_reason: r.ended_reason, post_id: r.post_id, post_en: r.post_en, post_fr: r.post_fr,
      student_id: isAdmin ? r.student_id : undefined, name: r.full_name, class_label: classLabel(r.cname, r.csection), photo: isAdmin ? photoUrl(r.photo_file_id) : null })) };
  });
  route('POST', '/prefects', ADMIN, async (c) => {
    const year = await yearOf(c.schoolId, c.body.year_id);
    if (!year) throw S.bad('invalid_year');
    const stu = await studentRow(c.schoolId, c.body.student_id);
    if (!stu) throw S.bad('invalid_student');
    if (!eligible(stu)) throw S.bad('prefect_not_eligible');
    const pid = S.toInt(c.body.post_id);
    const post = pid === null ? null : await h.get('SELECT id FROM prefect_posts WHERE id = ? AND school_id = ? AND active = 1', pid, c.schoolId);
    if (!post) throw S.bad('invalid_post');
    const dup = await h.get('SELECT id, status FROM prefect_appointments WHERE school_id = ? AND student_id = ? AND post_id = ? AND year_id = ?', c.schoolId, stu.id, post.id, year.id);
    if (dup && dup.status === 'active') throw S.bad('prefect_exists');
    let id;
    if (dup) { // the same appointment was ended earlier: bring it back
      await h.run("UPDATE prefect_appointments SET status = 'active', ended_on = NULL, ended_reason = NULL, appointed_by = ? WHERE id = ? AND school_id = ?", c.user.id, dup.id, c.schoolId);
      id = dup.id;
    } else {
      id = await h.insert('INSERT INTO prefect_appointments (school_id, student_id, post_id, year_id, appointed_by) VALUES (?,?,?,?,?)', c.schoolId, stu.id, post.id, year.id, c.user.id);
    }
    await h.audit(c.schoolId, c.user.id, 'prefect_appointed', `prefect:${id}`);
    return { id };
  });
  route('PUT', '/prefects/:id', ADMIN, async (c) => {
    const id = S.toInt(c.params.id);
    const cur = id === null ? null : await h.get('SELECT * FROM prefect_appointments WHERE id = ? AND school_id = ?', id, c.schoolId);
    if (!cur) throw S.notFound();
    if (c.body.action === 'end') {
      await h.run("UPDATE prefect_appointments SET status = 'ended', ended_on = ?, ended_reason = ? WHERE id = ? AND school_id = ?", today(), S.str(c.body.reason, 200) || 'ended_by_administrator', cur.id, c.schoolId);
      await h.audit(c.schoolId, c.user.id, 'prefect_ended', `prefect:${cur.id}`);
    } else if (c.body.action === 'restore') {
      if (!eligible(await studentRow(c.schoolId, cur.student_id))) throw S.bad('prefect_not_eligible');
      await h.run("UPDATE prefect_appointments SET status = 'active', ended_on = NULL, ended_reason = NULL WHERE id = ? AND school_id = ?", cur.id, c.schoolId);
      await h.audit(c.schoolId, c.user.id, 'prefect_restored', `prefect:${cur.id}`);
    } else throw S.bad('invalid_action');
    return { ok: true };
  });
};
