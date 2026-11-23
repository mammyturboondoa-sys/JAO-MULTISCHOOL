'use strict';
// DOUDOUS² answers about scholarships. Uses ONLY real records: the school's own open scholarships, the external scholarships the school approved
// (with their official links and only the dates the official page states), and the asker's own applications. Nothing is invented.
const A = require('./access');

const TRIGGER = /\b(scholarships?|bourses?|bursar(?:y|ies)|funding|financial aid|aide financi[eè]re|chevening|daad|eiffel|erasmus|mastercard)\b/i;
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const T = {
  en: { head: 'Scholarships at your school', none: 'Your school has no open scholarship right now.', closes: 'closes', min: 'minimum average', ext: 'External scholarships your school shows (check the official page for the latest rules and dates)', noext: '',
    official: 'official page', deadline: 'deadline', nodate: 'no date stated on the official page', apply: 'To apply for a school scholarship: open Scholarships → Opportunities, choose one and press Apply. Parents apply for their child; the school reviews the application.',
    mine: 'Your applications', nomine: 'You have no scholarship application yet.', status: { submitted: 'submitted', under_review: 'under review', approved: 'approved', rejected: 'not accepted', waitlisted: 'on the waiting list' },
    staff: 'Open Scholarships in the menu to see applications and recipients.', admin: (n, p) => `Your school has ${n} scholarship application(s) waiting for a decision. Open Scholarships → Applications.`.replace('{p}', p),
    unavailable: 'Open the Scholarships page in JAO for details.' },
  fr: { head: 'Bourses de votre école', none: 'Votre école n’a aucune bourse ouverte pour le moment.', closes: 'clôture', min: 'moyenne minimale', ext: 'Bourses externes affichées par votre école (vérifiez la page officielle pour les règles et dates à jour)', noext: '',
    official: 'page officielle', deadline: 'date limite', nodate: 'aucune date indiquée sur la page officielle', apply: 'Pour demander une bourse de l’école : ouvrez Bourses → Bourses, choisissez-en une et appuyez sur Postuler. Le parent postule pour son enfant ; l’école étudie la candidature.',
    mine: 'Vos candidatures', nomine: 'Vous n’avez pas encore de candidature de bourse.', status: { submitted: 'soumise', under_review: 'en cours d’examen', approved: 'acceptée', rejected: 'non retenue', waitlisted: 'sur liste d’attente' },
    staff: 'Ouvrez Bourses dans le menu pour voir les candidatures et les bénéficiaires.', admin: (n) => `Votre école a ${n} candidature(s) de bourse en attente de décision. Ouvrez Bourses → Candidatures.`,
    unavailable: 'Ouvrez la page Bourses dans JAO pour les détails.' },
};

// returns an answer string, or null when the message is not about scholarships
async function answer(h, { user, lang, text }) {
  if (!user || !TRIGGER.test(text)) return null;
  const m = T[lang] || T.en;
  const lines = [];
  const asksStatus = /\b(my|mine|status|statut|ma |mon |mes |candidature|application|applied|postul)/i.test(text);
  if (asksStatus && (user.role === 'parent' || user.role === 'student')) {
    const sc = A.studentScope(user);
    const rows = await h.all(`SELECT a.status, sc2.title, s.full_name FROM scholarship_applications a JOIN scholarships sc2 ON sc2.id = a.scholarship_id AND sc2.school_id = a.school_id
      JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id WHERE a.status <> 'draft' AND ${sc.where} ORDER BY a.id DESC LIMIT 10`, ...sc.params);
    lines.push(rows.length ? `${m.mine}:\n${rows.map((r) => `• ${r.full_name} — ${r.title}: ${m.status[r.status] || r.status}`).join('\n')}` : m.nomine);
    return lines.join('\n\n');
  }
  if (asksStatus && user.role === 'school_admin') {
    const n = (await h.get("SELECT COUNT(*) n FROM scholarship_applications WHERE school_id = ? AND status IN ('submitted','under_review')", user.school_id)).n;
    return m.admin(n);
  }
  if (user.role === 'teacher') return m.staff;
  const open = await h.all("SELECT title, benefits, min_average, closes_on FROM scholarships WHERE school_id = ? AND status = 'open' AND (closes_on IS NULL OR closes_on >= ?) ORDER BY title LIMIT 15", user.school_id, today());
  lines.push(`${m.head}:`);
  lines.push(open.length ? open.map((s) => `• ${s.title} — ${s.benefits}${s.min_average != null ? ` (${m.min}: ${s.min_average})` : ''}${s.closes_on ? ` — ${m.closes}: ${s.closes_on}` : ''}`).join('\n') : m.none);
  const ext = await h.all(`SELECT e.title, e.provider, e.deadline, e.official_url FROM external_scholarships e WHERE e.status = 'published' AND EXISTS (SELECT 1 FROM school_external_scholarships s WHERE s.external_id = e.id AND s.school_id = ?) ORDER BY e.title LIMIT 15`, user.school_id);
  if (ext.length) lines.push(`${m.ext}:\n${ext.map((e) => `• ${e.title} (${e.provider}) — ${e.deadline ? `${m.deadline}: ${e.deadline}` : m.nodate} — ${m.official}: ${e.official_url}`).join('\n')}`);
  if (user.role !== 'school_admin') lines.push(m.apply);
  return lines.join('\n\n');
}
module.exports = { answer, TRIGGER };
