'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../server/calc');

test('subject average: percentages scaled to /20', () => {
  const v = calc.subjectAverage([{ score: 15, max_score: 20, status: 'graded' }, { score: 8, max_score: 10, status: 'graded' }], 20, 2);
  assert.equal(v, 15.5); // (0.75 + 0.8)/2 * 20
});
test('absent, excused and missing are NOT counted as zero', () => {
  const v = calc.subjectAverage([{ score: 10, max_score: 20, status: 'graded' }, { score: null, max_score: 20, status: 'absent' },
    { score: null, max_score: 20, status: 'excused' }, { score: null, max_score: 20, status: 'missing' }], 20, 2);
  assert.equal(v, 10);
});
test('no counted assessments gives null, never 0', () => {
  assert.equal(calc.subjectAverage([{ score: null, max_score: 20, status: 'absent' }]), null);
  assert.equal(calc.subjectAverage([]), null);
});
test('coefficient-weighted overall average', () => {
  assert.equal(calc.weightedAverage([{ average: 16, coefficient: 2 }, { average: 10, coefficient: 1 }]), 14);
});
test('subjects without a result are left out of the weighting', () => {
  assert.equal(calc.weightedAverage([{ average: 12, coefficient: 3 }, { average: null, coefficient: 5 }]), 12);
  assert.equal(calc.weightedAverage([{ average: null, coefficient: 1 }]), null);
});
test('rounding is applied as configured', () => {
  assert.equal(calc.subjectAverage([{ score: 1, max_score: 3, status: 'graded' }], 20, 1), 6.7);
  assert.equal(calc.subjectAverage([{ score: 1, max_score: 3, status: 'graded' }], 20, 0), 7);
});
test('class average ignores students without results', () => {
  assert.equal(calc.classAverage([10, 14, null]), 12);
});
test('ranking: ties share a rank, students without results are unranked', () => {
  const r = calc.rank([{ id: 1, average: 15 }, { id: 2, average: 15 }, { id: 3, average: 12 }, { id: 4, average: null }]);
  assert.equal(r.get(1), 1); assert.equal(r.get(2), 1); assert.equal(r.get(3), 3); assert.equal(r.has(4), false);
});

test('weighted average is withheld when any graded subject has no coefficient', () => {
  const c = require('../server/calc');
  assert.equal(c.weightedAverage([{ average: 16, coefficient: 3 }, { average: 10, coefficient: 1 }]), 14.5);
  assert.equal(c.weightedAverage([{ average: 16, coefficient: 3 }, { average: 10, coefficient: null }]), null);
  assert.equal(c.weightedAverage([{ average: 16, coefficient: 3 }, { average: 10, coefficient: 0 }]), null);
  assert.equal(c.weightedAverage([{ average: 16, coefficient: 3 }, { average: null, coefficient: null }]), 16); // no result => not required
  assert.deepEqual(c.missingCoefficients([{ name: 'A', average: 5, coefficient: null }, { name: 'B', average: null, coefficient: null }]).map((x) => x.name), ['A']);
});
