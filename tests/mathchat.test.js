'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { solve } = require('../server/mathchat');

test('basic arithmetic, with correct precedence', () => {
  assert.equal(solve('12*5'), '12 × 5 = 60');
  assert.equal(solve('100 - 3 * 4 + 2'), '100 - 3 × 4 + 2 = 90');
  assert.equal(solve('(3+4)*2'), '(3 + 4) × 2 = 14');
  assert.equal(solve('10 / 4'), '10 ÷ 4 = 2.5');
  assert.equal(solve('0.1+0.2'), '0.1 + 0.2 = 0.3'); // no floating-point noise
  assert.equal(solve('2^10'), '2^10 = 1024');
  assert.equal(solve('17 mod 5'), '17 mod 5 = 2');
});
test('natural sentences in English and French', () => {
  assert.equal(solve('What is 15% of 200?'), '15% × 200 = 30');
  assert.equal(solve('6 times 7'), '6 × 7 = 42');
  assert.equal(solve('square root of 144'), 'sqrt(144) = 12');
  assert.equal(solve('Combien font 3 fois 4 ?', 'fr'), '3 × 4 = 12');
  assert.equal(solve('calcule 2,5 + 1,5', 'fr'), '2,5 + 1,5 = 4');
  assert.equal(solve('racine carrée de 81', 'fr'), 'sqrt(81) = 9');
});
test('logic and comparisons', () => {
  assert.equal(solve('true and false'), 'true AND false → false');
  assert.equal(solve('true or false'), 'true OR false → true');
  assert.equal(solve('not true'), 'NOT true → false');
  assert.equal(solve('true xor true'), 'true XOR true → false');
  assert.equal(solve('5 > 3 and 2 < 1'), '5 > 3 AND 2 < 1 → false');
  assert.equal(solve('2+2=4'), '2 + 2 = 4 → true');
  assert.equal(solve('1 < 2 < 3'), '1 < 2 < 3 → true');
  assert.equal(solve('vrai et faux', 'fr'), 'vrai ET faux → faux');
  assert.equal(solve('5 est supérieur à 3', 'fr'), '5 > 3 → vrai');
});
test('errors are explained, never crash or return Infinity', () => {
  assert.match(solve('10/0'), /divide by zero/);
  assert.match(solve('10/0', 'fr'), /diviser par zéro/);
  assert.match(solve('sqrt(-4)'), /negative/);
  assert.match(solve('10^400'), /too large/);
});
test('normal school questions are NOT treated as calculations', () => {
  for (const q of ['When was the school founded?', 'who is the headmaster', 'I and you', 'hello', '5', '(1+2', 'How do I register a student?', 'Quand l’école a-t-elle été fondée ?'])
    assert.equal(solve(q), null, q);
});
test('no code can be executed through the calculator', () => {
  for (const q of ['process.exit()', 'constructor', '1+require("fs")', 'alert(1)', '2+__proto__', 'a=1']) assert.equal(solve(q), null, q);
});
test('very long or deeply nested input is refused safely', () => {
  assert.equal(solve('('.repeat(500) + '1' + ')'.repeat(500)), null);
  assert.equal(solve('1+'.repeat(200) + '1'), null);
});

test('numbers written in words, in English and French', () => {
  assert.equal(solve('two plus two'), '2 + 2 = 4');
  assert.equal(solve('What is twenty five times four?'), '25 × 4 = 100');
  assert.equal(solve('one hundred and five minus five'), '105 - 5 = 100');
  assert.equal(solve('vingt-cinq fois deux', 'fr'), '25 × 2 = 50');
  assert.equal(solve('quatre-vingt-dix moins dix', 'fr'), '90 - 10 = 80');
  assert.equal(solve('soixante et onze plus un', 'fr'), '71 + 1 = 72');
  assert.equal(solve('Combien font trois fois quatre ?', 'fr'), '3 × 4 = 12');
});
test('sentences: sum, subtract, multiply, divide, difference, half, double, square', () => {
  assert.equal(solve('What is the sum of 5 and 3?'), '5 + 3 = 8');
  assert.equal(solve('subtract 2 from 9'), '9 - 2 = 7');
  assert.equal(solve('multiply 4 by 5'), '4 × 5 = 20');
  assert.equal(solve('divide 20 by 4'), '20 ÷ 4 = 5');
  assert.equal(solve('difference between 10 and 4'), '10 - 4 = 6');
  assert.equal(solve('half of 50'), '50 ÷ 2 = 25');
  assert.equal(solve('double 8'), '8 × 2 = 16');
  assert.equal(solve('le double de 21', 'fr'), '21 × 2 = 42');
  assert.equal(solve('la somme de 5 et 3', 'fr'), '5 + 3 = 8');
  assert.equal(solve('soustrais 2 de 9', 'fr'), '9 - 2 = 7');
  assert.equal(solve('the square of 9'), '9^2 = 81');
});
test('even / odd / prime questions and yes-no comparisons', () => {
  assert.equal(solve('Is 7 odd?'), '7 is odd → true');
  assert.equal(solve('is 12 prime?'), '12 is prime → false');
  assert.equal(solve('est-ce que 13 est premier ?', 'fr'), '13 est premier → vrai');
  assert.equal(solve('6 est pair', 'fr'), '6 est pair → vrai');
  assert.equal(solve('Is 5 greater than 3?'), '5 > 3 → true');
  assert.equal(solve('is 2+2=4?'), '2 + 2 = 4 → true');
});
test('ordinary sentences containing number words are still not calculations', () => {
  for (const q of ['one of the students is here', 'when is the school open', 'two three', 'Combien d’élèves y a-t-il dans la classe ?', 'Is the shop open on Saturday?']) assert.equal(solve(q), null, q);
});
