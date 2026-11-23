'use strict';
// Starting lists for the Discipline module. They are only a convenience: every school can rename, add or switch off
// any of them (Discipline > Setup). Sanctions are NEVER applied automatically; they are only choices on a list.
const CATEGORIES = [
  ['Lateness', 'Retard', 'minor'], ['Absence without permission', 'Absence non justifiée', 'minor'],
  ['Disrespect', 'Manque de respect', 'minor'], ['Disruption in class', 'Perturbation en classe', 'minor'],
  ['Misuse of a phone', 'Usage abusif du téléphone', 'minor'], ['Damage to property', 'Dégradation du matériel', 'serious'],
  ['Cheating', 'Tricherie', 'serious'], ['Bullying', 'Harcèlement', 'serious'], ['Physical violence', 'Violence physique', 'serious'],
];
const SANCTIONS = [
  ['Verbal warning', 'Avertissement verbal', 0], ['Written warning', 'Avertissement écrit', 0],
  ['Reprimand', 'Blâme', 0], ['Temporary suspension', 'Exclusion temporaire', 1],
];
// Run inside the same transaction that creates a school (or migrates an existing one). Safe to run twice.
async function seedDiscipline(h, schoolId) {
  if (!(await h.get('SELECT 1 FROM discipline_categories WHERE school_id = ?', schoolId))) {
    for (const [en, fr, sev] of CATEGORIES) await h.run('INSERT INTO discipline_categories (school_id, name_en, name_fr, severity) VALUES (?,?,?,?)', schoolId, en, fr, sev);
  }
  if (!(await h.get('SELECT 1 FROM sanction_types WHERE school_id = ?', schoolId))) {
    for (const [en, fr, dur] of SANCTIONS) await h.run('INSERT INTO sanction_types (school_id, name_en, name_fr, has_duration) VALUES (?,?,?,?)', schoolId, en, fr, dur);
  }
}
module.exports = { CATEGORIES, SANCTIONS, seedDiscipline };
