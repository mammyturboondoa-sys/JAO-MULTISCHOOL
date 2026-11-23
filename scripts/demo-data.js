'use strict';
// OPTIONAL: fills the database with clearly fictional DEMO records so you can try the screens.
// Every name starts with "Demo". Do NOT run this on a real school's database.
const path = require('node:path');
const { openDatabase } = require('../server/db');
const S = require('../server/security');

async function main() {
  const dataDir = path.resolve(process.env.JAO_DATA_DIR || path.join(__dirname, '..', 'data'));
  const h = await openDatabase({ file: path.join(dataDir, 'jao.db') });
  const school = await h.get("SELECT id FROM schools WHERE slug = 'seraphim-international'");
  if (!school) { console.error('Start the app once first (npm start) so the school exists.'); process.exit(1); }
  const sid = school.id;
  if (await h.get('SELECT 1 FROM students WHERE school_id = ? AND full_name LIKE ?', sid, 'Demo %')) { console.log('Demo data already present.'); process.exit(0); }

  const pw = S.randomPassword();
  await h.tx(async () => {
    const existing = await h.get("SELECT id FROM academic_years WHERE school_id = ? AND name = 'DEMO 2026-2027'", sid);
    const y = existing ? existing.id : await h.insert("INSERT INTO academic_years (school_id, name, is_current) VALUES (?, 'DEMO 2026-2027', 1)", sid);
    const t1 = await h.insert("INSERT INTO terms (school_id, year_id, name, position) VALUES (?,?, 'Term 1', 1)", sid, y);
    await h.run("INSERT INTO terms (school_id, year_id, name, position) VALUES (?,?, 'Term 2', 2)", sid, y);
    const teacher = await h.insert("INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (?, 'demo.teacher@seraphim.local', ?, 'Demo Teacher', 'DT', 'teacher', 1)", sid, S.hashPassword(pw));
    const cls = await h.insert("INSERT INTO classes (school_id, name, section, year_id, teacher_id) VALUES (?, 'Demo Class', 'A', ?, ?)", sid, y, teacher);
    const subj = [];
    for (const s of ['Demo Mathematics:DEMOMATH:2', 'Demo English:DEMOENG:2']) {
      const [name, code, coef] = s.split(':');
      const id = await h.insert('INSERT INTO subjects (school_id, name, code, default_coefficient) VALUES (?,?,?,?)', sid, name, code, Number(coef));
      await h.run('INSERT INTO class_subjects (school_id, class_id, subject_id, coefficient, teacher_id) VALUES (?,?,?,?,?)', sid, cls, id, Number(coef), teacher);
      subj.push(id);
    }
    const names = ['Demo Student One', 'Demo Student Two', 'Demo Student Three'];
    for (let i = 0; i < names.length; i++) {
      const stId = await h.insert("INSERT INTO students (school_id, student_code, full_name, dob, gender, enrolled_on, class_id, year_id) VALUES (?,?,?, '2015-01-01', 'other', '2026-09-01', ?, ?)", sid, `2026-000${i + 1}`, names[i], cls, y);
      const g = await h.insert("INSERT INTO guardians (school_id, full_name, phone) VALUES (?, ?, '+237000000000')", sid, `Demo Guardian ${i + 1}`);
      await h.run("INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_primary) VALUES (?,?,?, 'Parent', 1)", sid, stId, g);
      await h.run("INSERT INTO student_history (school_id, student_id, event, details) VALUES (?,?, 'registered', '{\"demo\":true}')", sid, stId);
    }
    for (const s of subj) await h.run("INSERT INTO assessments (school_id, class_id, subject_id, term_id, name, type, max_score, date) VALUES (?,?,?,?, 'Demo Test 1', 'test', 20, '2026-10-15')", sid, cls, s, t1);
    await h.run("INSERT INTO products (school_id, code, name, description, category, price, quantity, low_threshold) VALUES (?, 'DEMO-NB1', 'Demo Notebook', 'Sample product (demo data)', 'notebooks', 500, 40, 10)", sid);
  });
  console.log('Demo data added (all names start with "Demo"). Demo teacher login: demo.teacher@seraphim.local  temporary password:', pw);
  await h.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
