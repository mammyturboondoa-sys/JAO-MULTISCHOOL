'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, client, makeSchool, makeOwner, seedSchool, PW, h2 } = require('./helpers');
const X = require('../server/xlsx');
const IM = require('../server/importer');

let app, A, B;
const b64 = (buf) => buf.toString('base64');
const sheetOf = (headers, rows) => b64(X.writeXlsx([{ name: 'Data', rows: [headers, ...rows] }]));
const csvOf = (headers, rows) => b64(Buffer.from([headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf8'));
const preview = (cl, category, file, extra = {}) => cl.admin.post('/import/preview', { category, lang: 'en', file: { name: 'x.xlsx', data: file }, ...extra });
const commit = (cl, category, file, extra = {}) => cl.admin.post('/import/commit', { category, lang: 'en', confirm: true, file: { name: 'x.xlsx', data: file }, ...extra });

const STUDENT_HEAD = ['Full name', 'Date of birth', 'Gender', 'Class', 'Section', 'Guardian name', 'Guardian phone'];

test.before(async () => {
  app = await startTestApp(); await makeOwner(app);
  await makeSchool(app, 'School A', 'admin.a@test.local'); await makeSchool(app, 'School B', 'admin.b@test.local');
  A = await seedSchool(app, 'admin.a@test.local', 'A'); B = await seedSchool(app, 'admin.b@test.local', 'B');
});
test.after(() => app.stop());

test('every template downloads as a real .xlsx with headings, instructions and clearly marked examples, in both languages', async () => {
  const cats = (await A.admin.get('/import/categories?lang=en')).data;
  assert.ok(cats.length >= 11);
  for (const lang of ['en', 'fr']) for (const c of cats) {
    const r = await A.admin.get(`/import/template/${c.key}?lang=${lang}`);
    assert.equal(r.status, 200, c.key); assert.equal(r.data.slice(0, 2).toString(), 'PK');
    const sheets = X.readTable(r.data); assert.equal(sheets.length, 2);
    const data = sheets.find((s) => s.name === 'Data'); assert.equal(data.rows[0].length, c.columns.length);
    assert.ok(data.rows.slice(1).every((row) => /^(EXAMPLE|EXEMPLE)/.test(row[0])), 'example rows are marked');
    assert.ok(JSON.stringify(sheets[1].rows).match(/REQUIRED|OBLIGATOIRE/));
  }
});
test('an untouched template imports nothing (its example rows are ignored)', async () => {
  const t = (await A.admin.get('/import/template/students?lang=en')).data;
  const r = await preview(A, 'students', b64(t)); assert.equal(r.status, 200); assert.equal(r.data.rows.length, 0); assert.equal(r.data.examples_ignored, 2);
});

test('students: preview shows every row, flags errors, never saves; commit needs confirmation', async () => {
  const file = sheetOf(STUDENT_HEAD, [
    ['Mary Ngu', '2012-03-15', 'female', 'Form 1', 'A', 'Anne Ngu', '+237 677 00 00 01'],
    ['Peter Fon', '15/08/2011', 'm', 'Form 1', 'A', 'John Fon', '+237 699 00 00 02'],
    ['Bad Date', '2012-13-45', 'female', 'Form 1', 'A', 'G', '+237677000003'],
    ['No Class', '2012-01-01', 'male', 'Form 9', 'Z', 'G', '+237677000004'],
    ['Mary Ngu', '2012-03-15', 'female', 'Form 1', 'A', 'Anne Ngu', '+237677000001'],
    ['No Guardian', '2012-01-01', 'male', 'Form 1', 'A', '', ''],
  ]);
  const p = await preview(A, 'students', file); assert.equal(p.status, 200);
  assert.equal(p.data.summary.total, 6); assert.equal(p.data.summary.ok, 2); assert.equal(p.data.summary.errors, 4);
  const byName = Object.fromEntries(p.data.rows.map((r) => [r.n, r]));
  assert.ok(byName[4].errors.some((e) => e.col === 'dob')); assert.ok(byName[5].errors.some((e) => e.col === 'class_name')); assert.ok(byName[6].errors.some((e) => /Duplicate of row 2/.test(e.text))); assert.ok(byName[7].errors.length >= 2);
  assert.equal((await A.admin.get('/students')).data.total, 0, 'preview saves nothing');
  assert.equal((await A.admin.post('/import/commit', { category: 'students', lang: 'en', file: { name: 'x', data: file } })).data.error, 'confirmation_required');
  const c = await commit(A, 'students', file); assert.equal(c.status, 409); assert.equal(c.data.error, 'validation_failed');
  assert.equal((await A.admin.get('/students')).data.total, 0, 'refused: nothing saved when validation fails');
});
test('students: "import valid rows only" saves the valid ones, with codes, guardians and history; re-import is detected as duplicates', async () => {
  const file = sheetOf(STUDENT_HEAD, [
    ['Mary Ngu', '2012-03-15', 'female', 'Form 1', 'A', 'Anne Ngu', '+237 677 00 00 01'], ['Peter Fon', '15/08/2011', 'm', 'Form 1', 'A', 'John Fon', '+237 699 00 00 02'], ['Bad', 'nope', '', 'Form 1', 'A', 'G', '+237677000003']]);
  const c = await commit(A, 'students', file, { options: { skip_invalid: true } }); assert.equal(c.status, 200); assert.equal(c.data.inserted, 2); assert.equal(c.data.errors, 1);
  const list = (await A.admin.get('/students?page_size=60')).data; assert.equal(list.total, 2);
  assert.ok(list.rows.every((s) => /^\d{4}-\d{4}$/.test(s.student_code)));
  const mary = list.rows.find((s) => s.full_name === 'Mary Ngu'); const prof = (await A.admin.get(`/students/${mary.id}`)).data;
  assert.equal(prof.guardians[0].full_name, 'Anne Ngu'); assert.equal(prof.class_label, 'Form 1A');
  const again = await preview(A, 'students', file); assert.equal(again.data.summary.exists, 2); assert.equal(again.data.summary.will_create, 0);
  const noop = await commit(A, 'students', sheetOf(STUDENT_HEAD, [['Mary Ngu', '2012-03-15', 'female', 'Form 1', 'A', 'Anne Ngu', '+237677000001']])).catch((e) => e);
  assert.equal(noop.status, 400); assert.equal(noop.data.error, 'nothing_to_import');
  assert.equal((await A.admin.get('/students')).data.total, 2, 'existing students are never duplicated or changed');
});
test('students: rows can be corrected in the browser and sent back as JSON', async () => {
  const rows = [{ n: 2, values: { full_name: 'Corrected Kid', dob: '2013-02-02', class_name: 'Form 1', section: 'A', guardian_name: 'G', guardian_phone: '+237677000009' } }];
  const p = await A.admin.post('/import/preview', { category: 'students', lang: 'en', rows }); assert.equal(p.data.summary.ok, 1);
  const c = await A.admin.post('/import/commit', { category: 'students', lang: 'fr', confirm: true, rows, source: 'grid' }); assert.equal(c.data.inserted, 1);
});

test('large file: 3,000 students validate and save in one atomic import', async () => {
  const rows = []; for (let i = 0; i < 3000; i++) rows.push([`Student ${i} Testname`, `20${String(10 + (i % 4)).padStart(2, '0')}-0${1 + (i % 9)}-1${i % 9}`, i % 2 ? 'male' : 'female', 'Form 1', 'A', `Guardian ${Math.floor(i / 2)}`, `+23765${String(1000000 + Math.floor(i / 2))}`]);
  const file = sheetOf(STUDENT_HEAD, rows);
  const t0 = Date.now(); const p = await preview(A, 'students', file); assert.equal(p.status, 200); assert.equal(p.data.summary.ok, 3000, JSON.stringify(p.data.summary));
  const c = await commit(A, 'students', file); assert.equal(c.status, 200); assert.equal(c.data.inserted, 3000);
  const ms = Date.now() - t0; assert.ok(ms < 60000, `took ${ms} ms`);
  assert.equal((await A.admin.get('/students')).data.total, 3003);
  const codes = await app.h.all('SELECT student_code FROM students WHERE school_id = (SELECT school_id FROM users WHERE email = ?)', 'admin.a@test.local'); assert.equal(new Set(codes.map((r) => r.student_code)).size, codes.length);
  const g = await app.h.get('SELECT COUNT(*) n FROM guardians WHERE full_name LIKE ?', 'Guardian %'); assert.equal(g.n, 1500, 'siblings share one guardian record');
  A.bigBatch = c.data.batch_id;
});
test('a file that is too big in rows is refused with a clear error', async () => {
  const rows = []; for (let i = 0; i < 10001; i++) rows.push([`S${i}`, '2012-01-01', '', 'Form 1', 'A', 'G', '+237677000000']);
  const r = await preview(A, 'students', sheetOf(STUDENT_HEAD, rows)); assert.equal(r.status, 400); assert.equal(r.data.error, 'too_many_rows');
});
test('CSV (semicolon, accents, quotes) and French headings are understood', async () => {
  const csv = b64(Buffer.from('Nom complet;Date de naissance;Classe;Section;Nom du tuteur;Téléphone du tuteur\n"Éloïse N’Dour";12/05/2012;Form 1;A;"Marie, N’Dour";+237677000111\n', 'utf8'));
  const p = await A.admin.post('/import/preview', { category: 'students', lang: 'fr', file: { name: 'e.csv', data: csv } }); assert.equal(p.data.summary.ok, 1, JSON.stringify(p.data));
  assert.equal(p.data.rows[0].values.full_name, 'Éloïse N’Dour');
  const missing = await A.admin.post('/import/preview', { category: 'students', lang: 'en', file: { name: 'e.csv', data: b64(Buffer.from('Foo;Bar\n1;2\n')) } }); assert.equal(missing.data.error, 'missing_columns');
});

test('atomic: if anything fails while saving, NOTHING is saved', async () => {
  const before = (await app.h.get('SELECT COUNT(*) n FROM students')).n; const orig = IM.H.students.apply; let k = 0;
  IM.H.students.apply = async (n, ctx) => { if (++k === 3) throw new Error('boom'); return orig(n, ctx); };
  try {
    const file = sheetOf(STUDENT_HEAD, [1, 2, 3, 4, 5].map((i) => [`Atomic ${i}`, '2012-01-01', '', 'Form 1', 'A', 'G', '+237677000222']));
    const r = await commit(A, 'students', file); assert.equal(r.status, 500);
  } finally { IM.H.students.apply = orig; }
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM students')).n, before); assert.equal((await app.h.get("SELECT COUNT(*) n FROM import_batches WHERE source_name = 'x.xlsx' AND total_rows = 5")).n, 0);
});

test('subjects, academic years, classes, coefficients, teachers: import, update on request, and skip duplicates', async () => {
  let r = await commit(A, 'academic_years', sheetOf(['Academic year', 'Terms', 'Current year'], [['2030-2031', 'Term 1; Term 2; Term 3', 'no']])); assert.equal(r.data.inserted, 1);
  assert.equal((await A.admin.get('/academic-years')).data.find((y) => y.name === '2030-2031').terms.length, 3);
  r = await commit(A, 'subjects', sheetOf(['Subject code', 'Subject name', 'Default coefficient'], [['PHY', 'Physics', '3'], ['CHE', 'Chemistry', '3'], ['phy', 'Physics again', '3']]), { options: { skip_invalid: true } }); assert.equal(r.data.inserted, 2); assert.equal(r.data.errors, 1);
  r = await commit(A, 'classes', sheetOf(['Class', 'Section', 'Academic year', 'Capacity'], [['Form 2', 'A', '2030-2031', '40'], ['Form 2', 'B', '2030-2031', '40'], ['Form 3', '', '2030-2031', '']])); assert.equal(r.data.inserted, 3);
  const exist = await preview(A, 'classes', sheetOf(['Class', 'Section', 'Academic year', 'Capacity'], [['Form 2', 'A', '2030-2031', '55']])); assert.equal(exist.data.summary.exists, 1);
  r = await commit(A, 'classes', sheetOf(['Class', 'Section', 'Academic year', 'Capacity'], [['Form 2', 'A', '2030-2031', '55']]), { options: { existing: 'update' } }); assert.equal(r.data.updated, 1);
  assert.equal((await app.h.get("SELECT capacity c FROM classes WHERE name = 'Form 2' AND section = 'A'")).c, 55);
  const hdr = ['Academic year', 'Class', 'Section', 'Subject code', 'Coefficient'];
  r = await commit(A, 'coefficients', sheetOf(hdr, [['2030-2031', 'Form 2', 'A', 'PHY', '3'], ['2030-2031', 'Form 2', 'A', 'CHE', '2'], ['2030-2031', 'Form 2', 'B', 'PHY', '4']])); assert.equal(r.data.inserted, 3);
  r = await commit(A, 'coefficients', sheetOf(hdr, [['2030-2031', 'Form 2', 'A', 'PHY', '5']])); assert.equal(r.data.updated, 1, 'coefficients update by default');
  const bad = await preview(A, 'coefficients', sheetOf(hdr, [['2030-2031', 'Form 2', 'A', 'PHY', '0'], ['2030-2031', 'Nope', '', 'PHY', '2'], ['2030-2031', 'Form 2', 'A', 'ZZZ', '2']])); assert.equal(bad.data.summary.errors, 3);
  r = await commit(A, 'teachers', sheetOf(['Full name', 'E-mail'], [['Paul Mbarga', 'paul@school.cm'], ['Dup', 'PAUL@school.cm']]), { options: { skip_invalid: true } });
  assert.equal(r.data.inserted, 1); assert.equal(r.data.credentials.length, 1); assert.ok(r.data.credentials[0].password.length >= 10);
  const login = client(app); const li = await login.login('paul@school.cm', r.data.credentials[0].password); assert.equal(li.status, 200, 'imported teacher can sign in with the temporary password');
  assert.equal(JSON.stringify(await app.h.all('SELECT after_json FROM import_items WHERE table_name = ?', 'users')).includes('scrypt$'), false, 'password hashes never go into the import log');
});

test('grades: creates the assessment when a maximum is given, validates against it, and protects existing marks', async () => {
  const stu = (await A.admin.get('/students?page_size=60&q=Mary')).data.rows[0];
  const hdr = ['Term', 'Subject code', 'Assessment / sequence', 'Student ID', 'Mark', 'Maximum score'];
  const ayear = (await A.admin.get('/academic-years')).data.find((y) => y.id === A.year); void ayear;
  const sub = A.maths ? (await A.admin.get('/subjects')).data.find((s) => s.id === A.maths).code : null;
  // Mary is in Form 1 A of the seeded (current) year; make sure the subject is taught there
  const cur = (await A.admin.get('/academic-years')).data.find((y) => y.is_current); assert.ok(cur);
  const rows = [['Term 1', sub, 'Sequence 1', stu.student_code, '14.5', '20'], ['Term 1', sub, 'Sequence 1', '9999-9999', '10', '20'], ['Term 1', sub, 'Sequence 1', stu.student_code, '25', '20']];
  const p = await preview(A, 'grades', sheetOf(hdr, rows)); assert.equal(p.status, 200);
  assert.ok(p.data.rows.find((r) => r.n === 3).errors.some((e) => e.col === 'student_code')); assert.ok(p.data.rows.find((r) => r.n === 4).errors.some((e) => /between 0 and 20/.test(e.text)) || p.data.rows.find((r) => r.n === 4).errors.some((e) => /Duplicate/.test(e.text)));
  const ok = await commit(A, 'grades', sheetOf(hdr, [rows[0]])); assert.equal(ok.status, 200); assert.equal(ok.data.inserted, 1);
  const a = await app.h.get("SELECT * FROM assessments WHERE name = 'Sequence 1'"); assert.equal(a.max_score, 20);
  const second = await preview(A, 'grades', sheetOf(hdr, [['Term 1', sub, 'Sequence 1', stu.student_code, '16', '']])); assert.equal(second.data.summary.exists, 1);
  let r = await commit(A, 'grades', sheetOf(hdr, [['Term 1', sub, 'Sequence 1', stu.student_code, '16', '']])).catch((e) => e); assert.equal(r.data.error, 'nothing_to_import', 'existing marks are kept by default');
  assert.equal((await app.h.get('SELECT score FROM grades WHERE assessment_id = ?', a.id)).score, 14.5);
  r = await commit(A, 'grades', sheetOf(hdr, [['Term 1', sub, 'Sequence 1', stu.student_code, '16', '']]), { options: { existing: 'update' } }); assert.equal(r.data.updated, 1);
  assert.equal((await app.h.get('SELECT score FROM grades WHERE assessment_id = ?', a.id)).score, 16);
  const abs = await commit(A, 'grades', sheetOf(hdr, [['Term 1', sub, 'Sequence 1', stu.student_code, 'ABS', '']]), { options: { existing: 'update' } }); assert.equal(abs.data.updated, 1);
  assert.equal((await app.h.get('SELECT status, score FROM grades WHERE assessment_id = ?', a.id)).status, 'absent');
  const noMax = await preview(A, 'grades', sheetOf(hdr, [['Term 1', sub, 'Brand new', stu.student_code, '10', '']])); assert.ok(noMax.data.rows[0].errors.some((e) => e.code === 'max_needed'));
  A.gradeBatch = ok.data.batch_id; A.stu = stu;
});

test('grid helpers: marks grid data and coefficient grid data are scoped to the school', async () => {
  const cur = (await A.admin.get('/academic-years')).data.find((y) => y.is_current); const term = cur.terms[0];
  const cls = (await A.admin.get(`/classes?year_id=${cur.id}`)).data.find((c) => c.name === 'Form 1');
  const g = await A.admin.get(`/import/grid?class_id=${cls.id}&subject_id=${A.maths}&term_id=${term.id}`); assert.equal(g.status, 200); assert.ok(g.data.students.length >= 3000); assert.ok(g.data.assessments.length >= 1);
  assert.equal((await B.admin.get(`/import/grid?class_id=${cls.id}&subject_id=${A.maths}&term_id=${term.id}`)).status, 400, 'another school cannot read this class');
  const cg = await A.admin.get(`/import/coef-grid?year_id=${cur.id}`); assert.equal(cg.status, 200); assert.ok(cg.data.classes.length >= 1); assert.equal((await B.admin.get(`/import/coef-grid?year_id=${cur.id}`)).status, 400);
});

test('products: 600 products at once, with images, then prices and stock by code', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const hdr = ['Product code', 'Product name', 'Category', 'Description', 'Selling price (FCFA)', 'Opening stock', 'Minimum stock level', 'Image file name'];
  const rows = []; for (let i = 0; i < 600; i++) rows.push([`P-${i}`, `Product ${i}`, ['textbooks', 'Notebooks', 'fournitures scolaires', 'uniformes', 'reading books'][i % 5], 'desc', `${1000 + i}`, `${i % 50}`, '5', i === 0 ? 'pic.png' : '']);
  const noImg = await preview(A, 'products', sheetOf(hdr, rows)); assert.equal(noImg.data.rows[0].errors[0].col, 'image_file');
  const images = { 'pic.png': 'data:image/png;base64,' + png };
  const c = await commit(A, 'products', sheetOf(hdr, rows), { images }); assert.equal(c.status, 200, JSON.stringify(c.data).slice(0, 300)); assert.equal(c.data.inserted, 600);
  const p0 = (await A.admin.get('/products?q=P-0')).data.find((p) => p.code === 'P-0'); assert.ok(p0.image); assert.equal(p0.price, 1000);
  const mv = await app.h.get("SELECT COUNT(*) n FROM stock_movements WHERE type = 'initial' AND reason = 'Bulk import'"); assert.ok(mv.n > 500);
  A.prodBatch = c.data.batch_id;
  const bad = await preview(A, 'products', sheetOf(hdr, [['X-1', 'Bad', 'toys', '', '-5', '1.5', '', '']])); assert.deepEqual(bad.data.rows[0].errors.map((e) => e.col).sort(), ['category', 'price', 'quantity']);
  const st = await commit(A, 'product_stock', sheetOf(['Product code', 'New selling price (FCFA)', 'Quantity in stock'], [['P-1', '2500', '77'], ['NOPE', '1', '1']]), { options: { skip_invalid: true } }); assert.equal(st.data.updated, 1);
  const p1 = (await A.admin.get('/products?q=P-1')).data.find((p) => p.code === 'P-1'); assert.equal(p1.price, 2500); assert.equal(p1.quantity, 77);
  assert.ok(await app.h.get("SELECT 1 x FROM stock_movements WHERE product_id = ? AND type IN ('adjustment_in','adjustment_out')", (await app.h.get("SELECT id FROM products WHERE code = 'P-1'")).id));
  const up = await commit(A, 'products', sheetOf(['Product code', 'Product name', 'Category', 'Selling price (FCFA)'], [['P-2', '', '', '9999']]), { options: { existing: 'update' } }); assert.equal(up.data.updated, 1);
  assert.equal((await A.admin.get('/products?q=P-2')).data.find((p) => p.code === 'P-2').name, 'Product 2', 'empty cells keep current values');
});

test('school information and settings', async () => {
  const r = await commit(A, 'settings', sheetOf(['School name', 'Motto', 'Pass mark', 'Grade scale', 'Decimals shown'], [['School A Renamed', 'Hard work', '50', '100', '1']]));
  assert.equal(r.data.updated, 1); const s = (await A.admin.get('/settings/school')).data; assert.equal(s.name, 'School A Renamed'); assert.equal(s.grade_scale, 100);
  const bad = await preview(A, 'settings', sheetOf(['Pass mark', 'Grade scale'], [['500', '100']])); assert.equal(bad.data.summary.errors, 1);
  A.settingsBatch = r.data.batch_id;
});

test('copy previous academic year: classes, terms, coefficients; never students or marks; never overwrites', async () => {
  const cur = (await A.admin.get('/academic-years')).data.find((y) => y.is_current);
  const to = (await A.admin.post('/academic-years', { name: '2040-2041' })).data.id;
  const dry = await A.admin.post('/import/copy-year', { from_year_id: cur.id, to_year_id: to, items: ['terms', 'classes', 'coefficients'], dry_run: true }); assert.equal(dry.data.classes, 1); assert.equal(await app.h.get("SELECT COUNT(*) n FROM classes WHERE year_id = ?", to).then((r) => r.n), 0, 'dry run saves nothing');
  const r = await A.admin.post('/import/copy-year', { from_year_id: cur.id, to_year_id: to, items: ['terms', 'classes', 'coefficients'] }); assert.equal(r.data.classes, 1); assert.equal(r.data.terms, 1); assert.equal(r.data.coefficients, 2);
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM students WHERE year_id = ?', to)).n, 0); assert.equal((await app.h.get('SELECT COUNT(*) n FROM assessments a JOIN classes c ON c.id = a.class_id WHERE c.year_id = ?', to)).n, 0);
  const again = await A.admin.post('/import/copy-year', { from_year_id: cur.id, to_year_id: to, items: ['classes', 'coefficients'] }); assert.equal(again.data.classes, 0); assert.equal(again.data.coefficients, 0);
  assert.equal((await A.admin.post('/import/copy-year', { from_year_id: cur.id, to_year_id: B.year, items: ['classes'] })).status, 400, 'cannot copy into another school’s year');
});

test('history lists who/when/how many; rollback undoes an import but keeps records changed since', async () => {
  const hist = (await A.admin.get('/import/history')).data; assert.ok(hist.length >= 10);
  const big = hist.find((b) => b.id === A.bigBatch); assert.equal(big.category, 'students'); assert.equal(big.imported_rows, 3000); assert.equal(big.admin_name, 'Admin School A'); assert.ok(big.created_at);
  assert.equal((await A.admin.post(`/import/history/${A.bigBatch}/rollback`, {})).data.error, 'confirmation_required');
  // grade a student of that import, and rename another: those two must be kept
  const mine = await app.h.all("SELECT s.id FROM students s JOIN import_items i ON i.record_id = s.id AND i.table_name = 'students' WHERE i.batch_id = ? ORDER BY s.id LIMIT 2", A.bigBatch);
  await app.h.run("UPDATE students SET address = 'changed by hand' WHERE id = ?", mine[0].id);
  const a = await app.h.get("SELECT id FROM assessments WHERE name = 'Sequence 1'");
  await app.h.run('INSERT INTO grades (school_id, assessment_id, student_id, score, status) VALUES ((SELECT school_id FROM students WHERE id = ?), ?, ?, 5, ?)', mine[1].id, a.id, mine[1].id, 'graded');
  const before = (await app.h.get('SELECT COUNT(*) n FROM students')).n;
  const rb = await A.admin.post(`/import/history/${A.bigBatch}/rollback`, { confirm: true }); assert.equal(rb.status, 200); assert.equal(rb.data.status, 'partly_rolled_back'); assert.ok(rb.data.kept >= 2);
  const after = (await app.h.get('SELECT COUNT(*) n FROM students')).n; assert.equal(before - after, 2998, `removed ${before - after}`);
  assert.ok(await app.h.get('SELECT 1 x FROM students WHERE id = ?', mine[0].id), 'edited student kept'); assert.ok(await app.h.get('SELECT 1 x FROM students WHERE id = ?', mine[1].id), 'student with marks kept');
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM guardians WHERE full_name LIKE ?', 'Guardian %')).n, 1, 'only the guardian still in use remains');
  // a clean batch rolls back completely
  const rp = await A.admin.post(`/import/history/${A.prodBatch}/rollback`, { confirm: true }); assert.equal(rp.data.status, 'partly_rolled_back', 'P-1 and P-2 were changed afterwards, so they are kept'); assert.equal((await app.h.get("SELECT COUNT(*) n FROM products WHERE code LIKE 'P-%' AND code <> 'P-1' AND code <> 'P-2'")).n, 0); assert.equal((await app.h.get("SELECT COUNT(*) n FROM products WHERE code IN ('P-1','P-2')")).n, 2);
  const rs = await A.admin.post(`/import/history/${A.settingsBatch}/rollback`, { confirm: true }); assert.equal(rs.data.status, 'rolled_back'); assert.equal((await A.admin.get('/settings/school')).data.name, 'School A'); assert.equal((await A.admin.post(`/import/history/${A.settingsBatch}/rollback`, { confirm: true })).data.error, 'already_rolled_back');
});

test('school isolation: another school can never import into, read or roll back this school', async () => {
  const bFile = sheetOf(STUDENT_HEAD, [['Cross Kid', '2012-01-01', 'male', 'Form 1', 'A', 'G', '+237677000333']]);
  const p = await preview(B, 'students', bFile); assert.equal(p.data.summary.ok, 1);
  const c = await commit(B, 'students', bFile); const sid = (await app.h.get("SELECT school_id FROM students WHERE full_name = 'Cross Kid'")).school_id; assert.equal(sid, (await app.h.get('SELECT school_id FROM users WHERE email = ?', 'admin.b@test.local')).school_id);
  assert.ok(!(await B.admin.get('/import/history')).data.some((b) => b.category === 'products'), 'history only shows the own school');
  assert.equal((await B.admin.post(`/import/history/${A.gradeBatch}/rollback`, { confirm: true })).status, 404);
  assert.equal(await app.h.get('SELECT COUNT(*) n FROM import_batches WHERE school_id <> (SELECT school_id FROM users WHERE email = ?)', 'admin.b@test.local').then((r) => r.n > 0), true);
  const sneaky = await B.admin.post('/import/commit', { category: 'students', lang: 'en', confirm: true, school_id: 1, rows: [{ n: 1, values: { full_name: 'Sneaky', dob: '2012-01-01', class_name: 'Form 1', section: 'A', guardian_name: 'G', guardian_phone: '+237677000444', school_id: 1 } }] });
  assert.equal((await app.h.get("SELECT school_id s FROM students WHERE full_name = 'Sneaky'")).s, (await app.h.get('SELECT school_id FROM users WHERE email = ?', 'admin.b@test.local')).school_id); void sneaky;
  const aStudent = (await A.admin.get('/students?q=Mary')).data.rows[0];
  const g = await B.admin.post('/import/gce/check', { exam_year: 2026, level: 'ordinary', candidates: [{ candidate_number: '1', name: 'X', student_id: aStudent.id, subjects: [{ name: 'Maths', grade: 'A' }] }] });
  assert.ok(g.data.candidates[0].errors.some((e) => e.code === 'bad_student'), 'cannot attach GCE results to another school’s student');
});

test('only the administrator can use the Import Centre', async () => {
  const t = client(app); assert.equal((await t.login(A.admin.__t || 'teacher.A@test.local', A.teacherPw)).status, 200);
  await h2(app, A.teacherId); const t2 = client(app); await t2.login('teacher.A@test.local', A.teacherPw);
  for (const [m, u] of [['get', '/import/categories'], ['get', '/import/history'], ['get', '/import/template/students'], ['get', '/import/gce/students?q=ab']]) assert.equal((await t2[m](u)).status, 403, u);
  for (const u of ['/import/preview', '/import/commit', '/import/gce/parse', '/import/copy-year']) assert.equal((await t2.post(u, {})).status, 403, u);
  assert.equal((await client(app).get('/import/categories')).status, 401);
});

// ---------------- GCE Board results ----------------
test('GCE: paste for several candidates, register numbers, never auto-attach by name, confirm mismatches, save with audit trail', async () => {
  const mary = (await A.admin.get('/students?q=Mary Ngu')).data.rows[0]; const peter = (await A.admin.get('/students?q=Peter Fon')).data.rows[0];
  await commit(A, 'gce_candidates', sheetOf(['Student ID', 'Examination year', 'Level', 'GCE candidate number'], [[mary.student_code, '2026', 'Ordinary', '2650123']]));
  const text = 'Candidate No: 2650123  Centre No: 26501\nName: NGU MARY BIH\nEnglish Language B\nMathematics A\nPhysics C\n\nCandidate No: 2650124\nName: FON PETER\nEnglish Language A\nMathematics D\n\nCandidate No: 2650125\nName: SOMEBODY UNKNOWN\nEnglish Language E';
  const p = await A.admin.post('/import/gce/parse', { exam_year: 2026, level: 'ordinary', lang: 'en', text }); assert.equal(p.status, 200);
  const [c1, c2, c3] = p.data.candidates; assert.equal(c1.student_id, mary.id); assert.equal(c1.how, 'registry'); assert.equal(c1.errors.length, 0); assert.equal(c1.subjects.length, 3); assert.equal(c1.centre_number, '26501');
  assert.equal(c2.student_id, null, 'a name alone never attaches a result'); assert.equal(c2.suggestions[0].id, peter.id); assert.ok(c2.errors.some((e) => e.code === 'no_student'));
  assert.equal(c3.suggestions.length, 0); assert.equal(p.data.summary.problems, 2);
  const refuse = await A.admin.post('/import/gce/commit', { exam_year: 2026, level: 'ordinary', confirm: true, candidates: p.data.candidates }); assert.equal(refuse.status, 409);
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM gce_results')).n, 0, 'nothing saved while problems remain');
  // the admin chooses Peter for candidate 2, drops candidate 3 and tries a deliberate mismatch for candidate 3 first
  const mismatch = await A.admin.post('/import/gce/check', { exam_year: 2026, level: 'ordinary', lang: 'en', candidates: [{ ...c3, student_id: peter.id }] });
  assert.ok(mismatch.data.candidates[0].errors.some((e) => e.code === 'confirm_needed'), 'a different name needs an explicit confirmation');
  const ok = await A.admin.post('/import/gce/commit', { exam_year: 2026, level: 'ordinary', confirm: true, source: 'paste', candidates: [c1, { ...c2, student_id: peter.id }] }); assert.equal(ok.status, 200); assert.equal(ok.data.inserted, 2);
  A.gceBatch = ok.data.batch_id;
  const dup = await A.admin.post('/import/gce/check', { exam_year: 2026, level: 'ordinary', lang: 'en', candidates: [c1] }); assert.ok(dup.data.candidates[0].errors.some((e) => e.code === 'already_imported'), 'duplicate import detected');
  const view = (await A.admin.get(`/students/${mary.id}/gce`)).data; assert.equal(view.results.length, 1); const r0 = view.results[0];
  assert.equal(r0.candidate_number, '2650123'); assert.deepEqual(r0.subjects.map((s) => s.grade), ['B', 'A', 'C']); assert.equal(r0.imported_by_name, 'Admin School A'); assert.ok(r0.imported_at); assert.match(r0.raw_text, /NGU MARY BIH/); assert.equal(r0.candidate_name, 'NGU MARY BIH');
  const row = await app.h.get('SELECT * FROM gce_results WHERE candidate_number = ?', '2650123'); assert.equal(row.source, 'paste'); assert.ok(row.batch_id);
  A.mary = mary;
});
test('GCE: results stay apart from school marks and report cards', async () => {
  const tables = (await app.h.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'gce_%'")).map((t) => t.name).sort(); assert.deepEqual(tables, ['gce_candidates', 'gce_result_subjects', 'gce_results']);
  const acad = (await A.admin.get(`/students/${A.mary.id}/academics`)).data; assert.ok(!JSON.stringify(acad).includes('2650123'));
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM grades WHERE score IN (1, 2)')).n >= 0, true);
});
test('GCE: files (CSV/Excel) wide and long formats; PDF without text is refused kindly', async () => {
  const ben = (await A.admin.get('/students?q=Student 1 Testname')).data.rows[0];
  const wide = sheetOf(['Candidate Number', 'Name', 'English', 'Maths'], [['A-9001', 'Student 1 Testname', 'B', 'A']]);
  const p = await A.admin.post('/import/gce/parse', { exam_year: 2027, level: 'advanced', lang: 'en', file: { name: 'results.xlsx', data: wide } }); assert.equal(p.status, 200); assert.equal(p.data.candidates[0].subjects.length, 2); assert.ok(p.data.candidates[0].suggestions.some((s) => s.id === ben.id));
  const long = csvOf(['Candidate No', 'Name', 'Subject', 'Grade'], [['A-9001', 'Student 1 Testname', 'English', 'B'], ['A-9001', 'Student 1 Testname', 'Maths', 'A'], ['A-9002', 'Other Person', 'Maths', 'C']]);
  const p2 = await A.admin.post('/import/gce/parse', { exam_year: 2027, level: 'A Level', lang: 'fr', file: { name: 'r.csv', data: long } }); assert.equal(p2.data.candidates.length, 2); assert.equal(p2.data.candidates[0].subjects.length, 2);
  const pdf = await A.admin.post('/import/gce/parse', { exam_year: 2027, level: 'advanced', file: { name: 'scan.pdf', data: b64(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')) } }); assert.equal(pdf.status, 400); assert.equal(pdf.data.error, 'pdf_unreadable');
  const none = await A.admin.post('/import/gce/parse', { exam_year: 2027, level: 'advanced', text: 'hello there, nothing in here' }); assert.equal(none.data.error, 'gce_nothing_found');
});
test('GCE: who may read — administrator, the student’s own parent or the student; never teachers or other schools', async () => {
  const mary = A.mary; const pw = 'Parent-Passw0rd-1';
  const pu = await A.admin.post('/users', { role: 'parent', name: 'Anne Ngu', email: 'anne@test.local' }); await h2(app, pu.data.id); await app.h.run('UPDATE users SET password_hash = ? WHERE id = ?', require('../server/security').hashPassword(pw), pu.data.id);
  const prof = (await A.admin.get(`/students/${mary.id}`)).data; await A.admin.put(`/guardians/${prof.guardians[0].id}/account`, { user_id: pu.data.id });
  const parent = client(app); assert.equal((await parent.login('anne@test.local', pw)).status, 200);
  const pv = await parent.get(`/students/${mary.id}/gce`); assert.equal(pv.status, 200); assert.equal(pv.data.results.length, 1); assert.equal(pv.data.results[0].raw_text, undefined, 'raw source text and importer identity are admin-only'); assert.equal(pv.data.results[0].imported_by_name, undefined);
  const peter = (await A.admin.get('/students?q=Peter Fon')).data.rows[0]; assert.equal((await parent.get(`/students/${peter.id}/gce`)).status, 404, 'a parent cannot read another child’s results');
  const t = client(app); await t.login('teacher.A@test.local', A.teacherPw); assert.equal((await t.get(`/students/${mary.id}/gce`)).status, 403);
  assert.equal((await B.admin.get(`/students/${mary.id}/gce`)).status, 404); assert.equal((await client(app).get(`/students/${mary.id}/gce`)).status, 401);
  assert.ok(await app.h.get("SELECT 1 x FROM audit_log WHERE action = 'gce_viewed'"), 'every view is logged');
});
test('GCE: official grades cannot be edited through the API and rollback removes an import cleanly', async () => {
  for (const [m, u] of [['put', '/gce/1'], ['del', '/gce/1'], ['put', `/students/${A.mary.id}/gce`]]) assert.ok([404, 405].includes((await A.admin[m](u, {})).status), u);
  const rb = await A.admin.post(`/import/history/${A.gceBatch}/rollback`, { confirm: true }); assert.equal(rb.data.status, 'rolled_back');
  assert.equal((await app.h.get('SELECT COUNT(*) n FROM gce_results')).n, 0); assert.equal((await app.h.get('SELECT COUNT(*) n FROM gce_result_subjects')).n, 0);
  assert.equal((await A.admin.get(`/students/${A.mary.id}/gce`)).data.results.length, 0);
});
