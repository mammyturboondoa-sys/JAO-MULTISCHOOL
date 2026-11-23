'use strict';
// Very small PDF text reader for result sheets that were exported as text-based PDFs.
// It handles the common case (Flate-compressed content streams with text operators and ToUnicode maps).
// Scanned/image PDFs and unusual encodings cannot be read: the caller then asks the user to paste the text instead.
const zlib = require('node:zlib');

const MAX_STREAMS = 4000, MAX_OUT = 60 * 1024 * 1024;

function streams(buf) {
  const out = []; const s = buf.toString('latin1'); let i = 0;
  while (out.length < MAX_STREAMS) {
    const a = s.indexOf('stream', i); if (a < 0) break;
    let start = a + 6; if (s[start] === '\r') start++; if (s[start] === '\n') start++;
    const b = s.indexOf('endstream', start); if (b < 0) break;
    const dictStart = s.lastIndexOf('obj', a); const dict = s.slice(Math.max(0, dictStart), a);
    let data = buf.slice(start, b);
    if (/FlateDecode/.test(dict)) { try { data = zlib.inflateSync(data, { maxOutputLength: MAX_OUT }); } catch { try { data = zlib.inflateRawSync(data, { maxOutputLength: MAX_OUT }); } catch { data = null; } } }
    else if (/\/Filter/.test(dict)) data = null; // other filters (images, LZW...) are not text we can read
    if (data) out.push({ dict, text: data.toString('latin1') });
    i = b + 9;
  }
  return out;
}

function parseToUnicode(txt, map) {
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), fromHex(m[2]));
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16); if (hi - lo > 70000) continue;
      if (m[3]) { const base = parseInt(m[3], 16); for (let c = lo; c <= hi; c++) map.set(c, String.fromCodePoint(base + (c - lo))); }
      else { const list = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => fromHex(x[1])); list.forEach((v, k) => map.set(lo + k, v)); }
    }
  }
}
const fromHex = (h) => { let o = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) o += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return o; };

function unescapeLiteral(str) {
  return str.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, g) => {
    if (g === 'n') return '\n'; if (g === 'r') return '\r'; if (g === 't') return '\t'; if (g === 'b' || g === 'f') return ''; if (g === '(' || g === ')' || g === '\\') return g;
    if (/^[0-7]/.test(g)) return String.fromCharCode(parseInt(g, 8)); return '';
  });
}

function extractText(buf) {
  const ss = streams(buf); const map = new Map();
  for (const st of ss) if (/begincmap/.test(st.text)) parseToUnicode(st.text, map);
  const decodeHex = (h) => {
    h = h.replace(/\s+/g, ''); if (h.length % 2) h += '0';
    if (map.size && h.length % 4 === 0) { let o = ''; for (let i = 0; i < h.length; i += 4) { const c = parseInt(h.slice(i, i + 4), 16); o += map.get(c) ?? ''; } if (o) return o; }
    if (map.size) { let o = ''; for (let i = 0; i < h.length; i += 2) { const c = parseInt(h.slice(i, i + 2), 16); o += map.get(c) ?? String.fromCharCode(c); } return o; }
    let o = ''; for (let i = 0; i < h.length; i += 2) o += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)); return o;
  };
  const lines = [];
  for (const st of ss) {
    if (!/\bBT\b/.test(st.text)) continue;
    for (const bt of st.text.matchAll(/BT([\s\S]*?)ET/g)) {
      let line = '';
      for (const m of bt[1].matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(?:Td|TD)|\bT\*/g)) {
        if (m[1] !== undefined) { for (const p of m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d*\.?\d+)/g)) { if (p[1] !== undefined) line += unescapeLiteral(p[1]); else if (p[2] !== undefined) line += decodeHex(p[2]); else if (Number(p[3]) < -180) line += ' '; } }
        else if (m[2] !== undefined) line += unescapeLiteral(m[2]);
        else if (m[3] !== undefined) line += decodeHex(m[3]);
        else if (m[5] !== undefined) { if (Math.abs(Number(m[5])) > 0.5) { if (line.trim()) lines.push(line); line = ''; } else line += ' '; }
        else { if (line.trim()) lines.push(line); line = ''; }
      }
      if (line.trim()) lines.push(line);
    }
  }
  const text = lines.map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).filter(Boolean).join('\n');
  const printable = (text.match(/[A-Za-z0-9]/g) || []).length;
  if (printable < 20) throw new Error('pdf_no_text');
  return text;
}
module.exports = { extractText };
