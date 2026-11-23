'use strict';
// Tiny dependency-free PDF writer (A4, Helvetica). Enough for official letters: text, lines, boxes, optional JPEG logo.
// Text is encoded as WinAnsi so French accents print correctly.
const W = { 32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015,
  65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611,
  91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584 };
for (let i = 48; i <= 57; i++) W[i] = 556;
const WIN = { 0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x153: 0x9c, 0x152: 0x8c, 0x2026: 0x85 };

const toWin = (s) => Buffer.from([...String(s)].map((ch) => {
  const cp = ch.codePointAt(0);
  if (cp === 0xa0) return 0x20;
  if (cp >= 32 && cp < 127) return cp;
  if (cp >= 160 && cp < 256) return cp;
  return WIN[cp] || 0x3f;
}));
const charW = (ch, bold) => {
  const cp = ch.codePointAt(0);
  let w = W[cp];
  if (w === undefined) { const base = ch.normalize('NFD')[0].codePointAt(0); w = W[base] || (cp === 0x153 ? 889 : 556); }
  return bold ? w * 1.06 : w;
};
const textWidth = (s, size, bold) => [...String(s)].reduce((n, ch) => n + charW(ch, bold), 0) * size / 1000;

function wrap(text, size, maxW, bold) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (line && textWidth(t, size, bold) > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

class Page {
  constructor() { this.ops = []; this.y = 842 - 56; this.left = 56; this.right = 595 - 56; this.width = this.right - this.left; this.logo = null; }
  text(s, x, y, size, bold) { this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${toWin(s).toString('hex')}> Tj ET`); }
  center(s, y, size, bold) { this.text(s, 595 / 2 - textWidth(s, size, bold) / 2, y, size, bold); }
  line(x1, y1, x2, y2, w = 0.8) { this.ops.push(`${w} w ${x1} ${y1} m ${x2} ${y2} l S`); }
  rect(x, y, w, h, lw = 0.8, dash) { this.ops.push(`${lw} w ${dash ? '[3 3] 0 d' : '[] 0 d'} ${x} ${y} ${w} ${h} re S [] 0 d`); }
  color(hex) { const n = parseInt(hex, 16); this.ops.push(`${(n >> 16 & 255) / 255} ${(n >> 8 & 255) / 255} ${(n & 255) / 255} rg ${(n >> 16 & 255) / 255} ${(n >> 8 & 255) / 255} ${(n & 255) / 255} RG`); }
  para(s, size = 11, bold = false, gap = 6, lead = 1.4) {
    for (const ln of wrap(s, size, this.width, bold)) { this.text(ln, this.left, this.y, size, bold); this.y -= size * lead; }
    this.y -= gap;
  }
  labelled(label, value, size = 11) {
    const lw = textWidth(`${label}: `, size, true) + 4;
    const lines = wrap(value, size, this.width - lw, false);
    this.text(`${label}:`, this.left, this.y, size, true);
    lines.forEach((ln, i) => { this.text(ln, this.left + lw, this.y, size, false); this.y -= size * 1.4; if (i === lines.length - 1) this.y -= 2; });
  }
}

// Reads width/height of a baseline or progressive JPEG so it can be embedded untouched.
function jpegInfo(buf) {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// ---- PNG logos (so a school's PNG logo can appear on PDFs too). Dependency-free: node:zlib only. ----
// Handles non-interlaced PNGs of every common kind (grey, RGB, palette, with or without transparency, 1-16 bits).
// Returns { w, h, rgb: Buffer(w*h*3), alpha: Buffer(w*h) | null }, or null when the file is not a PNG this can read.
function decodePng(buf) {
  const zlib = require('node:zlib');
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) return null;
    let i = 8, w = 0, h = 0, depth = 0, ctype = -1, interlace = 0, plte = null, trns = null; const idat = [];
    while (i + 8 <= buf.length) {
      const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
      else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
      i += 12 + len;
    }
    if (!w || !h || w > 4000 || h > 4000 || interlace !== 0 || !idat.length) return null;
    const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; if (!chan || ![1, 2, 4, 8, 16].includes(depth)) return null;
    if (ctype === 3 && !plte) return null;
    const bpp = Math.max(1, (chan * depth) >> 3), stride = (w * chan * depth + 7) >> 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    if (raw.length < (stride + 1) * h) return null;
    const px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
        let v = raw[src + x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        else if (f !== 0) return null;
        px[dst + x] = v & 255;
      }
    }
    const sample = (y, idx) => { // idx = sample index in the row; returns value scaled to 0-255 (palette: the raw index)
      const row = y * stride;
      if (depth === 8) return px[row + idx];
      if (depth === 16) return px[row + idx * 2];
      const bit = idx * depth, byte = px[row + (bit >> 3)], v = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return ctype === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
    };
    const rgb = Buffer.alloc(w * h * 3); let alpha = (ctype === 4 || ctype === 6 || trns) ? Buffer.alloc(w * h, 255) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3; let r, g, b, a = 255;
      if (ctype === 0) { r = g = b = sample(y, x); if (trns && trns.length >= 2 && depth <= 8 && sample(y, x) === (depth === 8 ? trns[1] : Math.round(trns[1] * 255 / ((1 << depth) - 1)))) a = 0; }
      else if (ctype === 4) { r = g = b = sample(y, x * 2); a = sample(y, x * 2 + 1); }
      else if (ctype === 2) { r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2); if (trns && trns.length >= 6 && depth === 8 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0; }
      else if (ctype === 6) { r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); a = sample(y, x * 4 + 3); }
      else { const k = sample(y, x); r = plte[k * 3] || 0; g = plte[k * 3 + 1] || 0; b = plte[k * 3 + 2] || 0; a = trns && k < trns.length ? trns[k] : 255; }
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b; if (alpha) alpha[y * w + x] = a;
    }
    if (alpha && alpha.every((v) => v === 255)) alpha = null;
    return { w, h, rgb, alpha };
  } catch { return null; }
}

// Width and height of a logo that can be embedded (JPEG or PNG), else null. Used to size and place it.
function imageInfo(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  const j = jpegInfo(buf); if (j) return { w: j.w, h: j.h, kind: 'jpeg' };
  const p = decodePng(buf); return p ? { w: p.w, h: p.h, kind: 'png' } : null;
}

// build(pages, { title, author, jpeg, logo }) -> Buffer  (logo = JPEG or PNG bytes; jpeg kept for older callers)
function build(pages, meta = {}) {
  const objs = []; const add = (body) => { objs.push(body); return objs.length; };
  const cat = add(null), pagesObj = add(null), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let img = null, info = null;
  const logoBuf = meta.logo || meta.jpeg, png = logoBuf && !jpegInfo(logoBuf) ? decodePng(logoBuf) : null;
  if (png) {
    const zlib = require('node:zlib'), obj = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
    const sm = png.alpha ? add(obj(`/Type /XObject /Subtype /Image /Width ${png.w} /Height ${png.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(png.alpha))) : null;
    img = add(obj(`/Type /XObject /Subtype /Image /Width ${png.w} /Height ${png.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${sm ? ` /SMask ${sm} 0 R` : ''}`, zlib.deflateSync(png.rgb)));
  } else if (logoBuf && (info = jpegInfo(logoBuf))) {
    meta = { ...meta, jpeg: logoBuf };
    img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace /${info.comps === 1 ? 'DeviceGray' : info.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${meta.jpeg.length} >>\nstream\n`, 'latin1'), meta.jpeg, Buffer.from('\nendstream', 'latin1')]));
  }
  const infoObj = add(`<< /Title <${toWin(meta.title || 'Document').toString('hex')}> /Producer (JAO SchoolManager) >>`);
  const kids = [];
  for (const p of pages) {
    let content = p.ops.join('\n');
    if (img && p.logo) content = `q ${p.logo.w} 0 0 ${p.logo.h} ${p.logo.x} ${p.logo.y} cm /Im1 Do Q\n${content}`;
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${img ? ` /XObject << /Im1 ${img} 0 R >>` : ''} >> /Contents ${c} 0 R >>`));
  }
  objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offs = []; let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offs.push(pos); pos += b.length; parts.push(b);
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  void info;
  return Buffer.concat(parts);
}

module.exports = { build, Page, wrap, textWidth, jpegInfo, decodePng, imageInfo };
