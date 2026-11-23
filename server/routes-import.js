'use strict';
// Data Import Centre. Every route is for the school administrator only (except reading one student's GCE results),
// and the school ALWAYS comes from the signed-in session: nothing in a request can point at another school.
const S = require('./security');
const A = require('./access');
const X = require('./xlsx');
const IM = require('./importer');
const GCE = require('./gce');
const { extractText } = require('./pdftext');

const ADMIN = ['school_admin'];
const MAX_FILE = 12 * 1024 * 1024;
const LIMIT = 18 * 1024 * 1024; // JSON body (base64 files + product images)

module.exports = function (app) {
  const { h, route } = app;
  const big = (r) => { r.bodyLimit = LIMIT; return r; };
  const langOf = (v) => (v === 'fr' ? 'fr' : 'en');

  // ---------- helpers ----------
  function fileBuffer(file) {
    if (!file || typeof file.data !== 'string') throw S.bad('file_required');
    const buf = Buffer.from(file.data.replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) throw S.bad('empty_file'); if (buf.length > MAX_FILE) throw S.bad('file_too_large');
    return buf;
  }
  function readTable(buf) {
    try { return X.readTable(buf); } catch (e) {
      const map = { old_xls: 'old_xls', is_pdf: 'pdf_not_here', empty_file: 'empty_file', too_many_rows: 'too_many_rows', file_too_large: 'file_too_large' };
      throw S.bad(map[e.message] || 'invalid_file');
    }
  }
  const options = (d, o) => ({ existing: d.updatable ? (['skip', 'update'].includes(o && o.existing) ? o.existing : d.existing) : 'skip', skip_invalid: !!(o && o.skip_invalid) });
  const cleanImages = (imgs) => { const out = {}; if (imgs && typeof imgs === 'object') { let n = 0; for (const [k, v] of Object.entries(imgs)) { if (++n > 400) break; if (typeof v === 'string' && v.length < 3 * 1024 * 1024) out[String(k).slice(0, 200)] = v; } } return out; };
  const cleanRows = (rows) => {
    if (!Array.isArray(rows) || !rows.length) throw S.bad('no_rows'); if (rows.length > IM.MAX_ROWS) throw S.bad('too_many_rows', { max: IM.MAX_ROWS });
    return rows.map((r, i) => ({ n: Number.isInteger(r.n) ? r.n : i + 1, values: Object.fromEntries(Object.entries(r.values || {}).slice(0, 40).map(([k, v]) => [k, IM.cell(v)])) }));
  };
  async function rowsFrom(c, d) {
    if (c.body.file) { const sheets = readTable(fileBuffer(c.body.file)); const m = IM.mapRows(sheets, d.key); return { rows: m.rows, examples: m.examples, sheet: m.sheet, source: String(c.body.file.name || '').slice(0, 200) }; }
    return { rows: cleanRows(c.body.rows), examples: 0, sheet: null, source: String(c.body.source || 'grid').slice(0, 200) };
  }

  // ---------- categories and templates ----------
  route('GET', '/import/categories', ADMIN, async (c) => {
    const lang = langOf(c.query.lang);
    return Object.values(IM.DEFS).map((d) => ({ key: d.key, title: lang === 'fr' ? d.title[1] : d.title[0], updatable: !!d.updatable, existing: d.existing, existing_note: lang === 'fr' ? d.existingNote[1] : d.existingNote[0], secret: !!d.secret, images: !!d.images, overwritable: !!d.overwritable, single: !!d.single,
      columns: d.cols.map((x) => ({ key: x.key, required: x.required, label: lang === 'fr' ? x.fr : x.en, hint: lang === 'fr' ? x.hint.fr : x.hint.en, list: x.list || null })) }));
  });
  route('GET', '/import/template/:category', ADMIN, async (c) => {
    const d = IM.DEFS[c.params.category]; if (!d) throw S.notFound(); const lang = langOf(c.query.lang);
    return { __raw: true, body: IM.templateWorkbook(d.key, lang), headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="JAO-template-${d.key}-${lang}.xlsx"`, 'Cache-Control': 'no-store' } };
  });

  // Reads any uploaded .xlsx/.csv into plain rows (used by the marks grid and the coefficients grid).
  big(route('POST', '/import/parse', ADMIN, async (c) => {
    const sheets = readTable(fileBuffer(c.body.file)); const sh = sheets.find((s) => s.rows.length > 1) || sheets[0];
    return { sheet: sh.name, rows: sh.rows.slice(0, 5000) };
  }));

  // ---------- preview and save ----------
  big(route('POST', '/import/preview', ADMIN, async (c) => {
    const d = IM.DEFS[c.body.category]; if (!d) throw S.bad('unknown_category'); const lang = langOf(c.body.lang); const opts = options(d, c.body.options);
    const src = await rowsFrom(c, d);
    const v = await IM.validate(app, c.user, c.school, d.key, src.rows, { lang, options: opts, images: cleanImages(c.body.images) });
    return { rows: IM.publicRows(v.rows), summary: IM.summarize(v.rows, d, opts), examples_ignored: src.examples, sheet: src.sheet, source: src.source, options: opts };
  }));
  big(route('POST', '/import/commit', ADMIN, async (c) => {
    const d = IM.DEFS[c.body.category]; if (!d) throw S.bad('unknown_category'); const lang = langOf(c.body.lang); const opts = options(d, c.body.options);
    if (c.body.confirm !== true) throw S.bad('confirmation_required');
    const src = await rowsFrom(c, d);
    return await IM.commit(app, c.user, c.school, d.key, src.rows, { lang, options: opts, images: cleanImages(c.body.images), sourceName: src.source });
  }));

  // ---------- history and rollback ----------
  route('GET', '/import/history', ADMIN, async (c) => {
    const rows = await h.all(`SELECT b.*, u.name admin_name, r.name rolled_back_name FROM import_batches b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN users r ON r.id = b.rolled_back_by
      WHERE b.school_id = ? ORDER BY b.id DESC LIMIT 200`, c.schoolId);
    return rows.map((b) => ({ id: b.id, category: b.category, source_name: b.source_name, status: b.status, total_rows: b.total_rows, imported_rows: b.imported_rows, error_rows: b.error_rows, skipped_rows: b.skipped_rows,
      created_at: b.created_at, admin_name: b.admin_name, rolled_back_at: b.rolled_back_at, rolled_back_name: b.rolled_back_name, rollback_note: b.rollback_note }));
  });
  route('POST', '/import/history/:id/rollback', ADMIN, async (c) => {
    const id = S.toInt(c.params.id); if (id === null) throw S.notFound();
    if (c.body.confirm !== true) throw S.bad('confirmation_required');
    return await IM.rollback(app, c.user, id);
  });

  // ---------- spreadsheet-style grids ----------
  route('GET', '/import/grid', ADMIN, async (c) => { // everything the marks grid needs for one class + subject + term
    const cls = await h.get('SELECT c.*, y.name year_name FROM classes c JOIN academic_years y ON y.id = c.year_id WHERE c.id = ? AND c.school_id = ?', S.toInt(c.query.class_id), c.schoolId);
    const term = await h.get('SELECT * FROM terms WHERE id = ? AND school_id = ?', S.toInt(c.query.term_id), c.schoolId);
    const sb = await h.get('SELECT id, name, code FROM subjects WHERE id = ? AND school_id = ?', S.toInt(c.query.subject_id), c.schoolId);
    if (!cls || !term || !sb) throw S.bad('invalid_reference'); if (term.year_id !== cls.year_id) throw S.bad('term_year_mismatch');
    if (!await h.get('SELECT 1 FROM class_subjects WHERE class_id = ? AND subject_id = ? AND school_id = ?', cls.id, sb.id, c.schoolId)) throw S.bad('subject_not_in_class');
    const assessments = await h.all('SELECT id, name, type, max_score, date FROM assessments WHERE school_id = ? AND class_id = ? AND subject_id = ? AND term_id = ? ORDER BY date, id', c.schoolId, cls.id, sb.id, term.id);
    const students = await h.all("SELECT id, student_code, full_name FROM students WHERE school_id = ? AND class_id = ? AND archived_at IS NULL AND status = 'active' ORDER BY full_name", c.schoolId, cls.id);
    let marks = {}; const aid = S.toInt(c.query.assessment_id);
    if (aid !== null) { const a = assessments.find((x) => x.id === aid); if (!a) throw S.bad('invalid_reference'); for (const g of await h.all('SELECT student_id, score, status FROM grades WHERE assessment_id = ? AND school_id = ?', aid, c.schoolId)) marks[g.student_id] = { score: g.score, status: g.status }; }
    return { class: { id: cls.id, name: cls.name, section: cls.section, year_id: cls.year_id, year_name: cls.year_name }, term: { id: term.id, name: term.name }, subject: sb, assessments, students: students.map((s) => ({ id: s.id, code: s.student_code, name: s.full_name })), marks };
  });
  route('GET', '/import/coef-grid', ADMIN, async (c) => { // classes x subjects of one academic year
    const year = await h.get('SELECT id, name FROM academic_years WHERE id = ? AND school_id = ?', S.toInt(c.query.year_id), c.schoolId); if (!year) throw S.bad('invalid_year');
    const classes = await h.all('SELECT id, name, section FROM classes WHERE school_id = ? AND year_id = ? AND active = 1 ORDER BY name, section', c.schoolId, year.id);
    const subjects = await h.all('SELECT id, code, name, default_coefficient FROM subjects WHERE school_id = ? AND active = 1 ORDER BY name', c.schoolId);
    const cs = await h.all('SELECT class_id, subject_id, coefficient FROM class_subjects WHERE school_id = ? AND class_id IN (SELECT id FROM classes WHERE school_id = ? AND year_id = ?)', c.schoolId, c.schoolId, year.id);
    return { year, classes: classes.map((x) => ({ id: x.id, label: IM.classLabel(x.name, x.section), name: x.name, section: x.section })), subjects, cells: Object.fromEntries(cs.map((r) => [`${r.class_id}|${r.subject_id}`, r.coefficient])) };
  });

  // ---------- copy from a previous academic year ----------
  route('POST', '/import/copy-year', ADMIN, async (c) => {
    const from = await h.get('SELECT * FROM academic_years WHERE id = ? AND school_id = ?', S.toInt(c.body.from_year_id), c.schoolId);
    const to = await h.get('SELECT * FROM academic_years WHERE id = ? AND school_id = ?', S.toInt(c.body.to_year_id), c.schoolId);
    if (!from || !to || from.id === to.id) throw S.bad('invalid_year');
    const items = new Set((Array.isArray(c.body.items) ? c.body.items : []).filter((x) => ['terms', 'classes', 'coefficients'].includes(x))); if (!items.size) throw S.bad('nothing_selected');
    const withTeachers = !!c.body.copy_teachers; const dry = !!c.body.dry_run; const lang = langOf(c.body.lang);
    const counts = { terms: 0, classes: 0, coefficients: 0, skipped: 0 };
    class Dry extends Error {}
    try {
      await h.tx(async () => {
        const batchId = await h.insert('INSERT INTO import_batches (school_id, category, source_name, created_by) VALUES (?,?,?,?)', c.schoolId, 'copy_year', `${from.name} → ${to.name}`.slice(0, 200), c.user.id);
        const ctx = await IM.baseCtx(h, c.schoolId, c.user.id, lang, {}); ctx.batchId = batchId;
        if (items.has('terms')) {
          const have = new Set((await h.all('SELECT name FROM terms WHERE year_id = ?', to.id)).map((t) => IM.norm(t.name))); let pos = (await h.get('SELECT COALESCE(MAX(position),0) p FROM terms WHERE year_id = ?', to.id)).p;
          for (const t of await h.all('SELECT name FROM terms WHERE year_id = ? AND school_id = ? ORDER BY position', from.id, c.schoolId)) { if (have.has(IM.norm(t.name))) { counts.skipped++; continue; } await IM.ins(ctx, 'terms', 'INSERT INTO terms (school_id, year_id, name, position) VALUES (?,?,?,?)', c.schoolId, to.id, t.name, ++pos); counts.terms++; }
        }
        if (items.has('classes') || items.has('coefficients')) {
          const src = await h.all('SELECT * FROM classes WHERE school_id = ? AND year_id = ? AND active = 1 ORDER BY name, section', c.schoolId, from.id);
          const dst = new Map((await h.all('SELECT * FROM classes WHERE school_id = ? AND year_id = ?', c.schoolId, to.id)).map((k) => [`${IM.norm(k.name)}|${IM.norm(k.section)}`, k]));
          for (const k of src) {
            let target = dst.get(`${IM.norm(k.name)}|${IM.norm(k.section)}`);
            if (!target && items.has('classes')) {
              const tid = await IM.ins(ctx, 'classes', 'INSERT INTO classes (school_id, name, section, year_id, teacher_id, capacity, active) VALUES (?,?,?,?,?,?,1)', c.schoolId, k.name, k.section, to.id, withTeachers ? k.teacher_id : null, k.capacity);
              target = { id: tid }; dst.set(`${IM.norm(k.name)}|${IM.norm(k.section)}`, target); counts.classes++;
            } else if (target && items.has('classes')) counts.skipped++;
            if (target && items.has('coefficients')) {
              const have = new Set((await h.all('SELECT subject_id FROM class_subjects WHERE class_id = ?', target.id)).map((r) => r.subject_id));
              for (const r of await h.all('SELECT cs.* FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id WHERE cs.class_id = ? AND cs.school_id = ? AND s.active = 1', k.id, c.schoolId)) {
                if (have.has(r.subject_id)) { counts.skipped++; continue; } // never overwrite what the new year already has
                await IM.ins(ctx, 'class_subjects', 'INSERT INTO class_subjects (school_id, class_id, subject_id, coefficient, teacher_id) VALUES (?,?,?,?,?)', c.schoolId, target.id, r.subject_id, r.coefficient, withTeachers ? r.teacher_id : null); counts.coefficients++;
              }
            }
          }
        }
        if (dry) throw new Dry();
        await h.run('UPDATE import_batches SET total_rows = ?, imported_rows = ?, skipped_rows = ? WHERE id = ? AND school_id = ?', counts.terms + counts.classes + counts.coefficients + counts.skipped, counts.terms + counts.classes + counts.coefficients, counts.skipped, batchId, c.schoolId);
        await h.audit(c.schoolId, c.user.id, 'import_copy_year', `import:${batchId}`, { from: from.id, to: to.id, ...counts });
        counts.batch_id = batchId;
      });
    } catch (e) { if (!(e instanceof Dry)) throw e; }
    return { ...counts, dry_run: dry };
  });

  // =====================================================================
  // GCE BOARD RESULTS
  // Kept in their own tables, apart from school marks. Only the school administrator imports them; only the
  // administrator and the student's own linked parent / the student can read them. Teachers cannot.
  // =====================================================================
  const LEVELS = ['ordinary', 'advanced'];
  const cleanLevel = (v) => { const l = IM.parseLevel(v); if (!l) throw S.bad('bad_level'); return l; };
  const cleanYear = (v) => { const y = Number(v); if (!Number.isInteger(y) || y < 1990 || y > 2100) throw S.bad('bad_year_num'); return y; };
  const GM = {
    en: { cand_missing: 'Candidate number is missing.', no_subjects: 'No subject and grade was found for this candidate.', bad_subject: 'Every subject needs a name and a grade.', dup_in_batch: 'This candidate number appears more than once in this import (row {v}).',
      already_imported: 'These results were already imported (student: {v}).', no_student: 'Not matched to a student yet. Choose the student below.', bad_student: 'The chosen student does not exist in this school.', student_dup: 'This student is matched to another candidate in this import.',
      student_has_result: 'This student already has results for this exam year and level.', cand_other: 'This candidate number is registered for a different student.', student_other_number: 'This student is registered with a different candidate number for this exam.',
      confirm_needed: 'The name differs from the student’s name. Tick “I confirm” if this is the right student.' },
    fr: { cand_missing: 'Le numéro de candidat est manquant.', no_subjects: 'Aucune matière ni note trouvée pour ce candidat.', bad_subject: 'Chaque matière doit avoir un nom et une note.', dup_in_batch: 'Ce numéro de candidat apparaît plusieurs fois dans cet import (ligne {v}).',
      already_imported: 'Ces résultats ont déjà été importés (élève : {v}).', no_student: 'Pas encore rapproché d’un élève. Choisissez l’élève ci-dessous.', bad_student: 'L’élève choisi n’existe pas dans cet établissement.', student_dup: 'Cet élève est rapproché d’un autre candidat dans cet import.',
      student_has_result: 'Cet élève a déjà des résultats pour cette année et ce niveau d’examen.', cand_other: 'Ce numéro de candidat est enregistré pour un autre élève.', student_other_number: 'Cet élève est enregistré avec un autre numéro de candidat pour cet examen.',
      confirm_needed: 'Le nom diffère de celui de l’élève. Cochez « Je confirme » si c’est le bon élève.' },
  };
  async function gceCheck(c, cands, year, level, lang) {
    const gm = GM[lang]; const msg = (code, v) => gm[code].replace('{v}', v ?? '');
    const students = await h.all('SELECT id, student_code, full_name, class_id FROM students WHERE school_id = ? AND archived_at IS NULL', c.schoolId);
    const byId = new Map(students.map((s) => [s.id, s])); const byCode = new Map(students.map((s) => [s.student_code.toUpperCase(), s]));
    const reg = await h.all('SELECT student_id, candidate_number FROM gce_candidates WHERE school_id = ? AND exam_year = ? AND level = ?', c.schoolId, year, level);
    const regByNum = new Map(reg.map((r) => [r.candidate_number, r.student_id])); const regByStu = new Map(reg.map((r) => [r.student_id, r.candidate_number]));
    const done = await h.all('SELECT r.candidate_number, r.student_id, s.full_name FROM gce_results r JOIN students s ON s.id = r.student_id WHERE r.school_id = ? AND r.exam_year = ? AND r.level = ?', c.schoolId, year, level);
    const doneByNum = new Map(done.map((r) => [r.candidate_number, r])); const doneByStu = new Map(done.map((r) => [r.student_id, r]));
    const seenNum = new Map(), seenStu = new Map(); const out = [];
    cands.forEach((cd, i) => {
      const errors = []; const flags = []; const number = GCE.cleanCand(cd.candidate_number);
      const subjects = (Array.isArray(cd.subjects) ? cd.subjects : []).slice(0, 40).map((s) => ({ code: IM.cell(s.code).slice(0, 12), name: IM.cell(s.name).slice(0, 120), grade: IM.cell(s.grade).slice(0, 12) }));
      if (!number) errors.push(['cand_missing']);
      if (!subjects.length) errors.push(['no_subjects']); else if (subjects.some((s) => !s.name || !s.grade)) errors.push(['bad_subject']);
      if (number) { if (seenNum.has(number)) errors.push(['dup_in_batch', seenNum.get(number)]); else seenNum.set(number, i + 1); const d = doneByNum.get(number); if (d) errors.push(['already_imported', d.full_name]); }
      let student = null, how = null;
      if (cd.student_id != null && cd.student_id !== '') { student = byId.get(Number(cd.student_id)) || null; if (!student) errors.push(['bad_student']); else how = 'manual'; }
      else if (number && regByNum.has(number)) { student = byId.get(regByNum.get(number)) || null; if (student) how = 'registry'; }
      else if (cd.student_code && byCode.has(String(cd.student_code).toUpperCase())) { student = byCode.get(String(cd.student_code).toUpperCase()); how = 'student_code'; }
      const suggestions = [];
      if (!student) {
        for (const s of students) { const sim = GCE.similarity(cd.name || '', s.full_name); if (sim >= 0.5 && cd.name) suggestions.push({ id: s.id, code: s.student_code, name: s.full_name, sim: Math.round(sim * 100) }); }
        suggestions.sort((a, b) => b.sim - a.sim); suggestions.length = Math.min(suggestions.length, 5);
        errors.push(['no_student']);
      } else {
        if (seenStu.has(student.id)) errors.push(['student_dup']); else seenStu.set(student.id, i + 1);
        if (doneByStu.has(student.id)) errors.push(['student_has_result']);
        if (number && regByNum.has(number) && regByNum.get(number) !== student.id) errors.push(['cand_other']);
        if (regByStu.has(student.id) && number && regByStu.get(student.id) !== number) errors.push(['student_other_number']);
        const sim = GCE.similarity(cd.name || '', student.full_name);
        const nameOk = how === 'registry' ? sim >= 0.5 || !cd.name : sim >= 0.5;
        if (!nameOk) { if (cd.confirm_match === true) flags.push('confirmed'); else errors.push(['confirm_needed']); }
      }
      out.push({ idx: i, candidate_number: number, centre_number: IM.cell(cd.centre_number).slice(0, 30), name: IM.cell(cd.name).slice(0, 160), raw: String(cd.raw || '').slice(0, 6000), subjects,
        student_id: student ? student.id : null, student: student ? { id: student.id, code: student.student_code, name: student.full_name } : null, how, suggestions, flags,
        errors: errors.map(([code, v]) => ({ code, text: msg(code, v) })), confirm_match: cd.confirm_match === true });
    });
    return out;
  }
  const summaryOf = (list) => ({ total: list.length, ready: list.filter((x) => !x.errors.length).length, problems: list.filter((x) => x.errors.length).length, unmatched: list.filter((x) => !x.student_id).length });

  big(route('POST', '/import/gce/parse', ADMIN, async (c) => {
    const lang = langOf(c.body.lang); const year = cleanYear(c.body.exam_year); const level = cleanLevel(c.body.level);
    let cands; let source = 'paste';
    if (c.body.file) {
      const buf = fileBuffer(c.body.file); source = String(c.body.file.name || 'file').slice(0, 200); const kind = X.sniff(buf);
      if (kind === 'pdf') { let text; try { text = extractText(buf); } catch { throw S.bad('pdf_unreadable'); } cands = GCE.parseResults({ text }); }
      else if (kind === 'xls') throw S.bad('old_xls');
      else { const sheets = readTable(buf); let best = []; for (const sh of sheets) { const r = GCE.parseResults({ rows: sh.rows }); if (r.length > best.length) best = r; } cands = best; }
    } else { const text = String(c.body.text || ''); if (text.trim().length < 5) throw S.bad('empty_text'); if (text.length > 3 * 1024 * 1024) throw S.bad('file_too_large'); cands = GCE.parseResults({ text }); }
    if (!cands.length) throw S.bad('gce_nothing_found');
    if (cands.length > 5000) throw S.bad('too_many_rows', { max: 5000 });
    const list = await gceCheck(c, cands, year, level, lang);
    return { source, candidates: list, summary: summaryOf(list) };
  }));
  big(route('POST', '/import/gce/check', ADMIN, async (c) => {
    const year = cleanYear(c.body.exam_year); const level = cleanLevel(c.body.level); const lang = langOf(c.body.lang);
    if (!Array.isArray(c.body.candidates) || !c.body.candidates.length) throw S.bad('no_rows');
    const list = await gceCheck(c, c.body.candidates.slice(0, 5000), year, level, lang); return { candidates: list, summary: summaryOf(list) };
  }));
  big(route('POST', '/import/gce/commit', ADMIN, async (c) => {
    const year = cleanYear(c.body.exam_year); const level = cleanLevel(c.body.level); const lang = langOf(c.body.lang);
    if (c.body.confirm !== true) throw S.bad('confirmation_required');
    if (!Array.isArray(c.body.candidates) || !c.body.candidates.length) throw S.bad('no_rows');
    const list = await gceCheck(c, c.body.candidates.slice(0, 5000), year, level, lang);
    const sum = summaryOf(list); if (sum.problems > 0) throw new S.HttpError(409, 'validation_failed', { summary: sum, candidates: list });
    const source = String(c.body.source || 'paste').slice(0, 200);
    return await h.tx(async () => {
      const batchId = await h.insert('INSERT INTO import_batches (school_id, category, source_name, total_rows, imported_rows, created_by) VALUES (?,?,?,?,?,?)', c.schoolId, 'gce_results', `${year} ${level} · ${source}`.slice(0, 200), list.length, list.length, c.user.id);
      const ctx = await IM.baseCtx(h, c.schoolId, c.user.id, lang, {}); ctx.batchId = batchId; let n = 0;
      for (const cd of list) {
        const rid = await IM.ins(ctx, 'gce_results', `INSERT INTO gce_results (school_id, student_id, exam_year, level, candidate_number, centre_number, candidate_name, raw_text, source, batch_id, imported_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          c.schoolId, cd.student_id, year, level, cd.candidate_number, cd.centre_number || null, cd.name || null, cd.raw || null, source, batchId, c.user.id);
        let pos = 0; for (const s of cd.subjects) await h.run('INSERT INTO gce_result_subjects (school_id, result_id, position, subject_code, subject_name, grade) VALUES (?,?,?,?,?,?)', c.schoolId, rid, ++pos, s.code || null, s.name, s.grade);
        if (!await h.get('SELECT 1 x FROM gce_candidates WHERE school_id = ? AND student_id = ? AND exam_year = ? AND level = ?', c.schoolId, cd.student_id, year, level))
          await IM.ins(ctx, 'gce_candidates', 'INSERT INTO gce_candidates (school_id, student_id, exam_year, level, candidate_number, centre_number, created_by) VALUES (?,?,?,?,?,?,?)', c.schoolId, cd.student_id, year, level, cd.candidate_number, cd.centre_number || null, c.user.id);
        n++;
      }
      await h.audit(c.schoolId, c.user.id, 'gce_imported', `import:${batchId}`, { year, level, results: n });
      return { batch_id: batchId, inserted: n };
    });
  }));
  route('GET', '/import/gce/students', ADMIN, async (c) => { // search box for manual matching
    const q = S.str(c.query.q, 60); if (q.length < 2) return [];
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return (await h.all(`SELECT s.id, s.student_code code, s.full_name name, c.name cname, c.section csection FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = ? AND s.archived_at IS NULL AND (LOWER(s.full_name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.student_code) LIKE LOWER(?) ESCAPE '\\') ORDER BY s.full_name LIMIT 20`, c.schoolId, like, like))
      .map((s) => ({ id: s.id, code: s.code, name: s.name, class_label: s.cname ? IM.classLabel(s.cname, s.csection) : null }));
  });
  route('GET', '/students/:id/gce', ['school_admin', 'parent', 'student'], async (c) => {
    const s = await A.getVisibleStudent(h, c.user, c.params.id); // same visibility rules as the rest of the student profile
    const rows = await h.all(`SELECT r.*, u.name imported_by_name FROM gce_results r LEFT JOIN users u ON u.id = r.imported_by WHERE r.school_id = ? AND r.student_id = ? ORDER BY r.exam_year DESC, r.level`, c.schoolId, s.id);
    const out = [];
    for (const r of rows) {
      const subjects = await h.all('SELECT subject_code, subject_name, grade FROM gce_result_subjects WHERE result_id = ? AND school_id = ? ORDER BY position', r.id, c.schoolId);
      out.push({ id: r.id, exam_year: r.exam_year, level: r.level, candidate_number: r.candidate_number, centre_number: r.centre_number, candidate_name: r.candidate_name, subjects,
        source: r.source, imported_at: r.imported_at, ...(c.user.role === 'school_admin' ? { imported_by_name: r.imported_by_name, raw_text: r.raw_text } : {}) });
    }
    await h.audit(c.schoolId, c.user.id, 'gce_viewed', `student:${s.id}`, { results: out.length });
    return { student: { id: s.id, full_name: s.full_name, student_code: s.student_code }, school: { name: c.school.name }, results: out };
  });
};
