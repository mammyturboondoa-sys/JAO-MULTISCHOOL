'use strict';
// Starting list of prefect posts. Only a convenience: every school can rename, add or switch off any post (Prefects > Posts).
const POSTS = [
  ['Head Prefect (Boy)', 'Préfet en chef (garçon)'], ['Head Prefect (Girl)', 'Préfète en cheffe (fille)'],
  ['Assistant Head Prefect', 'Préfet en chef adjoint'], ['Senior Prefect', 'Préfet principal'],
  ['Discipline Prefect', 'Préfet de discipline'], ['Dining Hall Prefect', 'Préfet du réfectoire'],
  ['Dormitory Prefect', 'Préfet du dortoir'], ['Assembly Prefect', 'Préfet des rassemblements'],
  ['Academic Prefect', 'Préfet aux études'], ['Library Prefect', 'Préfet de la bibliothèque'],
  ['Laboratory Prefect', 'Préfet du laboratoire'], ['ICT Prefect', 'Préfet informatique'],
  ['Sports Prefect', 'Préfet des sports'], ['Entertainment Prefect', 'Préfet des loisirs'],
  ['Health and Sanitation Prefect', 'Préfet de la santé et de l’hygiène'], ['Environment Prefect', 'Préfet de l’environnement'],
  ['Social Prefect', 'Préfet des affaires sociales'], ['Chapel / Religious Prefect', 'Préfet des affaires religieuses'],
  ['Cultural Prefect', 'Préfet de la culture'],
];
// Only these classes may hold a prefect post: Form 5, Lower Sixth, Upper Sixth (English and French spellings).
// The class NAME is matched (the section letter is separate), so "Lower Sixth Arts" and "Form 5 B" both qualify.
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ELIGIBLE = /^(form(5|five)|f5|lower(6|sixth|6th)|l6|upper(6|sixth|6th)|u6|premiere|terminale|tle)(?![0-9])/;
const isEligibleClass = (className) => ELIGIBLE.test(norm(className));

// Run inside the transaction that creates a school (or migrates an existing one). Safe to run twice.
async function seedPrefects(h, schoolId) {
  if (await h.get('SELECT 1 FROM prefect_posts WHERE school_id = ?', schoolId)) return;
  let i = 0;
  for (const [en, fr] of POSTS) await h.run('INSERT INTO prefect_posts (school_id, name_en, name_fr, sort_order) VALUES (?,?,?,?)', schoolId, en, fr, i++);
}
module.exports = { POSTS, isEligibleClass, seedPrefects };
