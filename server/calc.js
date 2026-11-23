'use strict';
// Grade calculations. Kept free of database code so they can be unit-tested.
//
// Rules (school-configurable defaults, see README "Questions to confirm"):
//  * Each graded assessment becomes a percentage: score / max_score.
//  * Subject average = mean of those percentages x school grade scale (default /20).
//  * Absent / excused / missing assessments are NOT counted (never silently treated as 0).
//  * Overall average = coefficient-weighted mean of subject averages (only subjects with a result).
//    If ANY subject with a result has no coefficient, NO overall average is produced (nothing is guessed).
//  * Ranking is only produced when the school turns it on.

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// entries: [{score, max_score, status}]
function subjectAverage(entries, scale = 20, digits = 2) {
  const counted = entries.filter((e) => e.status === 'graded' && e.score != null && e.max_score > 0);
  if (!counted.length) return null;
  const mean = counted.reduce((s, e) => s + e.score / e.max_score, 0) / counted.length;
  return round(mean * scale, digits);
}

// subjects: [{average, coefficient}]
// Returns the weighted average, or null when there is nothing to average OR a required coefficient is missing.
function weightedAverage(subjects, digits = 2) {
  const use = subjects.filter((s) => s.average != null);
  if (!use.length || use.some((s) => !(s.coefficient > 0))) return null;
  const totalCoef = use.reduce((s, x) => s + x.coefficient, 0);
  return round(use.reduce((s, x) => s + x.average * x.coefficient, 0) / totalCoef, digits);
}
// Names/ids of subjects that have a result but no coefficient (these block the overall average).
function missingCoefficients(subjects) {
  return subjects.filter((s) => s.average != null && !(s.coefficient > 0));
}

function classAverage(studentAverages, digits = 2) {
  const v = studentAverages.filter((x) => x != null);
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, digits) : null;
}

// Standard competition ranking (ties share a rank). Returns Map(studentId -> rank).
function rank(list) {
  const valid = list.filter((x) => x.average != null).sort((a, b) => b.average - a.average);
  const out = new Map();
  let prev = null, r = 0;
  valid.forEach((x, i) => {
    if (x.average !== prev) { r = i + 1; prev = x.average; }
    out.set(x.id, r);
  });
  return out;
}

module.exports = { round, subjectAverage, weightedAverage, missingCoefficients, classAverage, rank };
