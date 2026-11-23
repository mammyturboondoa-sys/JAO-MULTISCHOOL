'use strict';
// Reads GCE Board results from pasted text or from a spreadsheet table into plain records.
// Official layouts differ from year to year, so this parser is deliberately cautious:
//   * it NEVER invents, converts or "fixes" a grade: it only copies the grade text exactly as it was supplied;
//   * everything it reads is shown in a review table before anything is saved;
//   * anything it is unsure about is left empty or flagged for the user.
const X = require('./xlsx');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const GRADE = '(?:[A-Fa-f][+\\-*]?|[UuOoXxWw]|ABS|Abs|AB|NG|ABSENT|Absent|PASS|FAIL|CREDIT|DISTINCTION|MERIT)';
const SUBJECT_WORDS = /\b(english|french|mathematics|maths|math|physics|chemistry|biology|geography|history|economics|literature|computer|ict|religious|citizenship|accounting|commerce|logic|philosophy|art|music|geology|further|additional|nutrition|food|technical|drawing|agricultur|business|german|spanish|bilingual|sport|physical|education|management|law|sociology|psychology|statistics|mechanics|electronics|woodwork|clothing|textile|home|health|general paper|anglais|francais|mathematiques)\b/i;
const NOT_SUBJECT = /^(name|candidate|centre|center|number|no|school|results?|subjects?|grade|grades|year|level|examination|exam|gce|board|total|page|sex|gender|serial|s\/n|n°)\b/i;

// ---- name similarity (used only to SUGGEST and to double-check a match, never to attach silently) ----
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1);
function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0;
  let common = 0; for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size);
}

function cleanCand(s) { return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').slice(0, 30); }

// ---- subject/grade pairs inside one line ----
const PAIR = new RegExp(`^(?:(\\d{3,5})\\s+)?([A-Za-z][A-Za-z0-9 .&'/()\\-]*?[A-Za-z0-9)])\\s*(?:[:=\\-–.]+\\s*|\\s+)(${GRADE})\\s*$`);
function tryPair(p) {
  const m = PAIR.exec(p.trim()); if (!m) return null;
  const name = m[2].trim(); if (name.length < 2 || (NOT_SUBJECT.test(name) && !SUBJECT_WORDS.test(name))) return null;
  return { code: m[1] || '', name, grade: m[3] };
}
function pairsOf(line) {
  const out = [];
  for (const piece of line.split(/\s*[;|]\s*|,\s+(?=[A-Za-z0-9])/).map((x) => x.trim()).filter(Boolean)) {
    const sub = piece.split(/\t|\s{3,}/).map((x) => x.trim()).filter(Boolean);
    const many = sub.length > 1 ? sub.map(tryPair) : null;
    if (many && many.every(Boolean)) { out.push(...many); continue; }
    const one = tryPair(piece.replace(/\t+/g, ' ')); if (one) out.push(one);
  }
  return out;
}

// ---- free text (pasted) ----
function parseText(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  const labelled = lines.some((l) => /(candidate|cand\.?|index)\s*(no|number|n°|num|#)/i.test(l));
  const startRe = labelled ? /(?:candidate|cand\.?|index)\s*(?:no\.?|number|n°|num\.?|#)\s*[:\-–]?\s*([A-Za-z0-9/\-]{4,25})/i : /^(\d{5,12})\b/;
  const blocks = []; let cur = null;
  for (const line of lines) {
    const m = startRe.exec(line);
    if (m) { cur = { number: cleanCand(m[1]), lines: [line], head: line, headMatch: m }; blocks.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  const results = [];
  for (const b of blocks) {
    let name = '', centre = ''; const subjects = []; const body = [];
    for (const ln of b.lines) { const cm = /(?:centre|center)\s*(?:no\.?|number|n°|num\.?|code)?\s*[:\-–]?\s*([A-Za-z0-9/\-]{2,15})/i.exec(ln); if (cm && !centre) centre = cm[1]; }
    let rest = b.head.replace(b.headMatch[0], ' ').replace(/(?:centre|center)\s*(?:no\.?|number|n°|num\.?|code)?\s*[:\-–]?\s*[A-Za-z0-9/\-]{2,15}/i, ' ').trim();
    const nm = /(?:^|\s)(?:candidate\s*)?name\s*[:\-–]\s*(.+)$/i.exec(b.lines.join('\n').replace(/\n/g, '\n'));
    body.push(rest, ...b.lines.slice(1));
    // name: explicit label wins
    const labelLine = b.lines.find((l) => /^(?:candidate\s*)?name\s*[:\-–]/i.test(l));
    if (labelLine) name = labelLine.replace(/^(?:candidate\s*)?name\s*[:\-–]\s*/i, '').replace(/\s{2,}.*$/, '').trim();
    else if (nm) name = nm[1].replace(/\s{2,}.*$/, '').trim();
    for (const ln of body) {
      if (!ln) continue;
      const ps = pairsOf(ln);
      if (ps.length) { subjects.push(...ps); continue; }
      if (!name && /[A-Za-zÀ-ÿ]{2,}/.test(ln) && !SUBJECT_WORDS.test(ln) && !NOT_SUBJECT.test(ln) && !/\d{4,}/.test(ln) && ln.length <= 80) name = ln.replace(/^(?:candidate\s*)?name\s*[:\-–]\s*/i, '').trim();
    }
    results.push({ candidate_number: b.number, centre_number: centre, name, subjects, raw: b.lines.join('\n') });
  }
  return results;
}

// ---- tables (Excel / CSV / tab-separated paste) ----
const H = {
  cand: /(candidate|cand\b|index|exam(ination)?\s*(no|number)|numero|n°)/i, name: /\b(name|nom)\b/i, centre: /(centre|center)/i,
  subject: /^(subject|matiere|course)/i, grade: /^(grade|result|resultat|note|mark)/i, code: /^(subject\s*)?code$/i, skip: /^(s\/?n|serial|no\.?|#|sex|gender|sexe|total|position|rank|school)$/i, student: /(student\s*(id|code)|matricule)/i,
};
function parseTable(rows) {
  let hi = -1, ci = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) { const j = rows[i].findIndex((c) => H.cand.test(String(c))); if (j >= 0 && rows[i].filter((c) => String(c).trim()).length >= 2) { hi = i; ci = j; break; } }
  const out = new Map();
  const add = (num, name, centre, sub, raw, stu) => {
    const key = cleanCand(num); if (!key) return;
    if (!out.has(key)) out.set(key, { candidate_number: key, centre_number: centre || '', name: name || '', subjects: [], raw: [], student_code: stu || '' });
    const r = out.get(key); if (name && !r.name) r.name = name; if (sub) r.subjects.push(sub); r.raw.push(raw);
  };
  if (hi < 0) { // no header: first cell = candidate number, second = name, the rest = "Subject grade" cells
    for (const r of rows) { const c = String(r[0] || '').trim(); if (!/^[A-Za-z0-9/\-]{5,25}$/.test(c) || !/\d/.test(c)) continue; add(c, String(r[1] || '').trim(), '', null, r.join('\t'));
      for (const cellv of r.slice(2)) for (const p of pairsOf(String(cellv))) out.get(cleanCand(c)).subjects.push(p); }
    return [...out.values()].map((x) => ({ ...x, raw: x.raw.join('\n') }));
  }
  const head = rows[hi].map((c) => String(c).trim());
  const idx = { name: head.findIndex((c) => H.name.test(c)), centre: head.findIndex((c) => H.centre.test(c)), subject: head.findIndex((c) => H.subject.test(c)), grade: head.findIndex((c) => H.grade.test(c)), code: head.findIndex((c) => H.code.test(c)), student: head.findIndex((c) => H.student.test(c)) };
  if (idx.name === ci) idx.name = -1;
  const longFmt = idx.subject >= 0 && idx.grade >= 0;
  const special = new Set([ci, idx.name, idx.centre, idx.subject, idx.grade, idx.code, idx.student]);
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; const num = String(r[ci] || '').trim(); if (!num) continue;
    const raw = r.join('\t'); const name = idx.name >= 0 ? String(r[idx.name] || '').trim() : ''; const centre = idx.centre >= 0 ? String(r[idx.centre] || '').trim() : ''; const stu = idx.student >= 0 ? String(r[idx.student] || '').trim() : '';
    if (longFmt) { const sn = String(r[idx.subject] || '').trim(), g = String(r[idx.grade] || '').trim(); add(num, name, centre, sn && g ? { code: idx.code >= 0 ? String(r[idx.code] || '').trim() : '', name: sn, grade: g } : null, raw, stu); }
    else {
      add(num, name, centre, null, raw, stu);
      head.forEach((hd, k) => { if (special.has(k) || !hd || H.skip.test(hd)) return; const g = String(r[k] || '').trim(); if (g) out.get(cleanCand(num)).subjects.push({ code: '', name: hd, grade: g }); });
    }
  }
  return [...out.values()].map((x) => ({ ...x, raw: x.raw.join('\n') }));
}

// Entry point: pasted text or uploaded rows. Returns candidate records (may be empty).
function parseResults({ text, rows }) {
  if (rows) return parseTable(rows);
  const t = String(text || '');
  const lines = t.split('\n').filter((l) => l.trim());
  const tabbed = lines.length >= 2 && lines.filter((l) => l.includes('\t')).length >= Math.ceil(lines.length * 0.6);
  if (tabbed) { const r = parseTable(X.parseCsv(t)); if (r.length) return r; }
  return parseText(t);
}

module.exports = { parseResults, parseText, parseTable, similarity, norm, cleanCand };
