'use strict';
// DOUDOUS² calculator: basic arithmetic and logic, in English and French.
// Safe by design: it has its own small parser and never uses eval() or Function().
// solve(text, lang) returns the answer text, or null when the message is not a calculation
// (so the normal school-knowledge answer is used instead).

class MathFail extends Error { constructor(code) { super(code); this.code = code; } }

const FN = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
const WORDS = new Set(['and', 'or', 'not', 'xor', 'mod', 'true', 'false', 'pi', ...Object.keys(FN)]);

const MSG = {
  en: { zero: 'I can’t divide by zero.', big: 'That result is too large for me to show.', neg: 'I can’t take the square root of a negative number.', true: 'true', false: 'false', and: 'AND', or: 'OR', not: 'NOT', xor: 'XOR' },
  fr: { zero: 'Je ne peux pas diviser par zéro.', big: 'Ce résultat est trop grand pour que je l’affiche.', neg: 'Je ne peux pas calculer la racine carrée d’un nombre négatif.', true: 'vrai', false: 'faux', and: 'ET', or: 'OU', not: 'NON', xor: 'OU EXCLUSIF' },
};

const NUM = '(\\d+(?:\\.\\d+)?)';


// ---- numbers written in words (English and French): "twenty five", "vingt-cinq", "quatre-vingt-dix" ----
const NW = new Map(Object.entries({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, cents: 100, mille: 1000 }));
const SEP = /^[\s-]+$/;
function runValue(words) {
  let total = 0, cur = 0, last = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], v = NW.get(w); const small = v < 20 && !['hundred', 'thousand', 'cent', 'cents', 'mille'].includes(w);
    if (w === 'quatre' && (words[i + 1] === 'vingt' || words[i + 1] === 'vingts')) { cur += 80; i++; last = 'tens'; continue; }
    if (w === 'hundred' || w === 'cent' || w === 'cents') { cur = (cur || 1) * 100; last = 'big'; continue; }
    if (w === 'thousand' || w === 'mille') { total += (cur || 1) * 1000; cur = 0; last = 'big'; continue; }
    if (small) { if (last === 'small' && !(words[i - 1] === 'dix' && v >= 7 && v <= 9)) return null; cur += v; last = 'small'; continue; }
    if (last === 'tens' && !(words[i - 1] === 'vingt' || words[i - 1] === 'vingts')) return null;
    cur += v; last = 'tens';
  }
  return total + cur;
}
function wordsToNumbers(s) {
  const parts = s.split(/([a-z]+)/); const out = []; let i = 0;
  while (i < parts.length) {
    const w = parts[i];
    if (i % 2 === 1 && NW.has(w)) {
      const words = [w]; let j = i;
      while (j + 2 < parts.length) {
        const sep = parts[j + 1], nx = parts[j + 2];
        if (SEP.test(sep) && NW.has(nx)) { words.push(nx); j += 2; }
        else if (SEP.test(sep) && (nx === 'and' || nx === 'et') && j + 4 < parts.length && SEP.test(parts[j + 3]) && NW.has(parts[j + 4])
          && (nx === 'and' ? ['hundred', 'thousand'].includes(words[words.length - 1]) && NW.get(parts[j + 4]) < 100 : ['vingt', 'trente', 'quarante', 'cinquante', 'soixante'].includes(words[words.length - 1]) && ['un', 'une', 'onze'].includes(parts[j + 4]))) { words.push(parts[j + 4]); j += 4; }
        else break;
      }
      const v = runValue(words); out.push(v === null ? parts.slice(i, j + 1).join('') : String(v)); i = j + 1;
    } else { out.push(w); i++; }
  }
  return out.join('');
}
// "the sum of 5 and 3", "subtract 2 from 9", "half of 50", "double 8", "la moitié de 50" ...
const N = '(-?\\d+(?:\\.\\d+)?|\\([^()]*\\))';
const PHRASES = [
  [new RegExp(`(?:sum of|somme de|total of)\\s+${N}\\s*(?:and|et|,)\\s*${N}`, 'g'), '$1+$2'],
  [new RegExp(`(?:add|additionne|ajoute)\\s+${N}\\s*(?:and|to|et|a)\\s+${N}`, 'g'), '$1+$2'],
  [new RegExp(`(?:subtract|soustrais|soustraire|enleve|retire)\\s+${N}\\s*(?:from|de)\\s+${N}`, 'g'), '$2-$1'],
  [new RegExp(`(?:difference|ecart)\\s*(?:between|of|entre|de)\\s+${N}\\s*(?:and|et)\\s*${N}`, 'g'), '$1-$2'],
  [new RegExp(`(?:multiply|multiplie|multiplier)\\s+${N}\\s*(?:by|with|and|par|et)\\s+${N}`, 'g'), '$1*$2'],
  [new RegExp(`(?:product of|produit de|produit des)\\s+${N}\\s*(?:and|et)\\s*${N}`, 'g'), '$1*$2'],
  [new RegExp(`(?:divide|divise|diviser)\\s+${N}\\s*(?:by|par)\\s+${N}`, 'g'), '$1/$2'],
  [new RegExp(`(?:half of|half|la moitie de|moitie de|la moitie)\\s+${N}`, 'g'), '($1/2)'],
  [new RegExp(`(?:double of|double de|double|twice|le double de|le double)\\s+${N}`, 'g'), '($1*2)'],
  [new RegExp(`(?:triple of|triple de|triple|thrice|le triple de|le triple)\\s+${N}`, 'g'), '($1*3)'],
  [new RegExp(`(?:square of|the square of|le carre de|carre de)\\s+${N}`, 'g'), '($1^2)'],
  [new RegExp(`(?:cube of|the cube of|le cube de|cube de)\\s+${N}`, 'g'), '($1^3)'],
];
function isPrime(n) { if (!Number.isSafeInteger(n) || n < 2) return false; if (n % 2 === 0) return n === 2; for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false; return true; }
// "is 7 odd?", "est-ce que 13 est premier ?"
function propertyQuestion(s, lang) {
  const m = /^(?:is|are|est ce que|est ce|est)?\s*(\d{1,15})\s*(?:is\s+|est\s+)?(?:an?\s+|un\s+|une\s+)?(even|odd|prime|pair|impair|premier)(?:\s+(?:number|nombre))?$/.exec(s.replace(/-/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const n = Number(m[1]); const kind = { pair: 'even', impair: 'odd', premier: 'prime' }[m[2]] || m[2];
  const ok = kind === 'even' ? n % 2 === 0 : kind === 'odd' ? n % 2 === 1 : isPrime(n);
  const word = lang === 'fr' ? { even: 'pair', odd: 'impair', prime: 'premier' }[kind] : kind;
  return `${n} ${lang === 'fr' ? 'est' : 'is'} ${word} → ${MSG[lang][ok ? 'true' : 'false']}`;
}

// Turn a natural sentence ("what is 15% of 200?", "combien font 3 fois 4 ?") into a plain expression.
function normalize(raw) {
  let s = String(raw).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=');
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2'); // 1,000 -> 1000 ; 2,5 -> 2.5
  s = wordsToNumbers(s);
  // leading filler such as "what is", "calculate", "combien font" (repeat: they can be stacked)
  const lead = /^\s*(?:please|s'il (?:te|vous) plait|can you|could you|peux-tu|pouvez-vous|tell me|dis-moi|what's|whats|what is|what are|is|are|est ce que|est ce|est-ce que|est-ce|calculate|compute|solve|evaluate|how much is|how much are|combien font|combien fait|combien est|combien|calcule|calculez|calculer|resous|quel est le resultat de|quel est|c'est quoi|ca fait|donne-moi|give me|the result of|le resultat de|resultat de)\b[\s:,]*/;
  for (let i = 0; i < 4 && lead.test(s); i++) s = s.replace(lead, '');
  s = s.replace(/^(?:the|le|la|les|l')\s*/, '');
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  if (/^\([^()]*\)$/.test(s.trim())) s = s.trim().slice(1, -1); // "half of 50" -> 50/2, no needless brackets
  s = s.replace(/[?!.=\s]+$/g, ''); // drop a trailing ? ! . =
  // percentages: "20% of 150", "20 percent of 150", "20 pour cent de 150"
  s = s.replace(new RegExp(`${NUM}\\s*(?:%|percent|per cent|pour cent|pourcent)\\s*(?:of|de|d')\\s*`, 'g'), '$1%*');
  // roots, squares, cubes, powers
  s = s.replace(new RegExp(`(?:square root|racine carree|racine)\\s*(?:of|de|d')?\\s*${NUM}`, 'g'), 'sqrt($1)');
  s = s.replace(new RegExp(`${NUM}\\s*(?:squared|au carre)`, 'g'), '$1^2').replace(new RegExp(`${NUM}\\s*(?:cubed|au cube)`, 'g'), '$1^3');
  s = s.replace(/\b(?:to the power of|raised to|power of|a la puissance|puissance|power)\b/g, '^');
  // words -> symbols (longest phrases first)
  const rep = [
    [/\b(?:is not equal to|not equal to|n'est pas egal a|different de)\b/g, '!='],
    [/\b(?:is greater than or equal to|greater than or equal to|superieur ou egal a|superieur ou egale a)\b/g, '>='],
    [/\b(?:is less than or equal to|less than or equal to|inferieur ou egal a|inferieur ou egale a)\b/g, '<='],
    [/\b(?:is greater than|greater than|is bigger than|bigger than|est superieur a|superieur a|plus grand que)\b/g, '>'],
    [/\b(?:is less than|less than|is smaller than|smaller than|est inferieur a|inferieur a|plus petit que)\b/g, '<'],
    [/\b(?:is equal to|equal to|equals|est egal a|egal a|egale|egal)\b/g, '=='],
    [/\b(?:multiplied by|multiplie par|multiplie|times|fois)\b/g, '*'],
    [/\b(?:divided by|divise par|divise|over)\b/g, '/'],
    [/\b(?:plus)\b/g, '+'], [/\b(?:minus|moins)\b/g, '-'],
    [/\b(?:modulo|mod)\b/g, ' mod '],
    [/\b(?:and|et)\b/g, ' and '], [/\b(?:or|ou)\b/g, ' or '], [/\b(?:not|non|pas)\b/g, ' not '],
    [/\b(?:true|vrai)\b/g, ' true '], [/\b(?:false|faux)\b/g, ' false '],
    [/&&|&/g, ' and '], [/\|\||\|/g, ' or '], [/!(?!=)/g, ' not '], [/<>/g, '!='], [/\*\*/g, '^'],
  ];
  for (const [re, to] of rep) s = s.replace(re, to);
  s = s.replace(/(\d|\))\s*x\s*(?=[\d(])/g, '$1*'); // "3 x 4"
  return s;
}

function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m;
    if ((m = /^\d+(?:\.\d+)?|^\.\d+/.exec(s.slice(i)))) { out.push({ k: 'num', v: parseFloat(m[0]), raw: m[0] }); i += m[0].length; continue; }
    if ((m = /^[a-z]+/.exec(s.slice(i)))) { if (!WORDS.has(m[0])) return null; out.push({ k: 'word', v: m[0] }); i += m[0].length; continue; }
    if ((m = /^(?:<=|>=|==|!=)/.exec(s.slice(i)))) { out.push({ k: 'op', v: m[0] }); i += 2; continue; }
    if ('+-*/^()<>%='.includes(ch)) { out.push({ k: 'op', v: ch === '=' ? '==' : ch }); i++; continue; }
    return null; // any other character: not a calculation
  }
  return out;
}

function parse(tokens) {
  let p = 0; let depth = 0; let binary = 0; // binary counts real operations, so a lone number is not "a calculation"
  const peek = () => tokens[p];
  const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
  const isWord = (v) => peek() && peek().k === 'word' && peek().v === v;
  const startsOperand = (t) => t && ((t.k === 'num') || (t.k === 'op' && t.v === '(') || (t.k === 'word' && (t.v === 'pi' || FN[t.v])));
  const fail = () => { throw new MathFail('syntax'); };
  const num = (v) => { if (typeof v !== 'number') fail(); return v; };
  const bool = (v) => (typeof v === 'boolean' ? v : num(v) !== 0);
  const fix = (v) => { if (!Number.isFinite(v)) throw new MathFail('big'); return v; };

  function orExpr() {
    let l = xorExpr();
    while (isWord('or')) { p++; binary++; const r = xorExpr(); l = bool(l) || bool(r); }
    return l;
  }
  function xorExpr() {
    let l = andExpr();
    while (isWord('xor')) { p++; binary++; const r = andExpr(); l = bool(l) !== bool(r); }
    return l;
  }
  function andExpr() {
    let l = notExpr();
    while (isWord('and')) { p++; binary++; const r = notExpr(); l = bool(l) && bool(r); }
    return l;
  }
  function notExpr() {
    if (isWord('not')) { p++; binary++; if (++depth > 40) fail(); const v = notExpr(); depth--; return !bool(v); }
    return cmpExpr();
  }
  function cmpExpr() {
    let l = addExpr(); let result = null;
    while (peek() && peek().k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
      const op = peek().v; p++; binary++;
      const r = addExpr();
      if ((op !== '==' && op !== '!=') && (typeof l !== 'number' || typeof r !== 'number')) fail();
      const ok = op === '<' ? l < r : op === '>' ? l > r : op === '<=' ? l <= r : op === '>=' ? l >= r : op === '==' ? l === r : l !== r;
      result = result === null ? ok : result && ok; l = r;
    }
    return result === null ? l : result;
  }
  function addExpr() {
    let l = mulExpr();
    while (isOp('+') || isOp('-')) { const op = peek().v; p++; binary++; const r = mulExpr(); l = fix(op === '+' ? num(l) + num(r) : num(l) - num(r)); }
    return l;
  }
  function mulExpr() {
    let l = unary();
    for (;;) {
      const t = peek();
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/')) {
        p++; binary++; const r = unary();
        if (t.v === '/') { if (num(r) === 0) throw new MathFail('zero'); l = fix(num(l) / r); } else l = fix(num(l) * num(r));
      } else if (isWord('mod') || (isOp('%') && startsOperand(tokens[p + 1]))) {
        p++; binary++; const r = unary(); if (num(r) === 0) throw new MathFail('zero'); l = fix(((num(l) % r) + r) % r);
      } else if (isOp('(') && typeof l === 'number') { binary++; const r = unary(); l = fix(l * num(r)); } // 2(3+4)
      else break;
    }
    return l;
  }
  function unary() {
    if (isOp('-')) { p++; if (++depth > 40) fail(); const v = unary(); depth--; return -num(v); }
    if (isOp('+')) { p++; if (++depth > 40) fail(); const v = unary(); depth--; return num(v); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp('^')) {
      p++; binary++; if (++depth > 40) fail(); const e = unary(); depth--;
      if (Math.abs(num(e)) > 1000) throw new MathFail('big');
      const r = Math.pow(num(base), num(e)); if (Number.isNaN(r)) fail(); return fix(r);
    }
    return base;
  }
  function postfix() {
    let v = primary();
    while (isOp('%') && !startsOperand(tokens[p + 1])) { p++; binary++; v = num(v) / 100; }
    return v;
  }
  function primary() {
    const t = peek(); if (!t) fail();
    if (t.k === 'num') { p++; return t.v; }
    if (t.k === 'word') {
      if (t.v === 'true' || t.v === 'false') { p++; return t.v === 'true'; }
      if (t.v === 'pi') { p++; return Math.PI; }
      if (FN[t.v]) {
        p++; if (!isOp('(')) fail(); p++; binary++; if (++depth > 40) fail();
        const a = num(orExpr()); depth--; if (!isOp(')')) fail(); p++;
        if (t.v === 'sqrt' && a < 0) throw new MathFail('neg');
        return fix(FN[t.v](a));
      }
      fail();
    }
    if (t.k === 'op' && t.v === '(') {
      p++; if (++depth > 40) fail(); const v = orExpr(); depth--; if (!isOp(')')) fail(); p++; return v;
    }
    return fail();
  }
  const value = orExpr();
  if (p !== tokens.length) fail();
  return { value, binary };
}

const clean = (n) => parseFloat(n.toPrecision(15)); // 0.1 + 0.2 -> 0.3
const fmtNum = (n, lang) => {
  const v = clean(n); if (Object.is(v, -0)) return '0';
  const s = Math.abs(v) >= 1e21 || (Math.abs(v) < 1e-7 && v !== 0) ? String(v) : v.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 12, useGrouping: false });
  return lang === 'fr' ? s.replace('.', ',') : s;
};

function show(tokens, lang) {
  const m = MSG[lang]; const parts = []; let prev = null;
  const OPS = { '*': '×', '/': '÷', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥' };
  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti]; let x;
    if (t.k === 'num') x = lang === 'fr' ? t.raw.replace('.', ',') : t.raw;
    else if (t.k === 'word') x = ['and', 'or', 'not', 'xor', 'true', 'false'].includes(t.v) ? m[t.v] : t.v === 'mod' ? 'mod' : t.v;
    else x = OPS[t.v] || t.v;
    const modPct = t.k === 'op' && t.v === '%' && tokens[ti + 1] && (tokens[ti + 1].k === 'num' || (tokens[ti + 1].k === 'op' && tokens[ti + 1].v === '(') || (tokens[ti + 1].k === 'word' && (tokens[ti + 1].v === 'pi' || FN[tokens[ti + 1].v])));
    if (modPct) x = 'mod';
    const unaryNow = t.k === 'op' && (t.v === '-' || t.v === '+') && (!prev || (prev.k === 'op' && prev.v !== ')' && prev.v !== '%') || (prev && prev.k === 'word' && ['and', 'or', 'not', 'xor', 'mod'].includes(prev.v)));
    const prevUnary = parts.length && parts[parts.length - 1].unary;
    const glueBefore = (t.k === 'op' && (t.v === ')' || (t.v === '%' && !modPct) || t.v === '^')) || (t.k === 'op' && t.v === '(' && prev && prev.k === 'word' && FN[prev.v]) || prevUnary || (prev && prev.k === 'op' && (prev.v === '(' || prev.v === '^'));
    parts.push({ x, unary: unaryNow, glue: glueBefore });
    prev = t;
  }
  return parts.map((q, i) => (i === 0 || q.glue ? '' : ' ') + q.x).join('');
}

function solve(text, lang = 'en') {
  lang = lang === 'fr' ? 'fr' : 'en';
  const prop = propertyQuestion(wordsToNumbers(String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[?!.\s]+$/g, '')), lang);
  if (prop) return prop;
  const s = normalize(text);
  if (!s || s.length > 300) return null;
  const tokens = tokenize(s);
  if (!tokens || !tokens.length || tokens.length > 120) return null;
  let r;
  try { r = parse(tokens); } catch (e) {
    if (e instanceof MathFail && ['zero', 'big', 'neg'].includes(e.code) && tokens.some((t) => t.k === 'op' || t.k === 'word')) return MSG[lang][e.code];
    return null;
  }
  if (!r.binary) return null; // a lone number or word is not a calculation
  const expr = show(tokens, lang);
  if (typeof r.value === 'boolean') return `${expr} → ${MSG[lang][r.value ? 'true' : 'false']}`;
  return `${expr} = ${fmtNum(r.value, lang)}`;
}

module.exports = { solve, normalize };
