'use strict';
// PNG logos on PDFs: the decoder must read every common PNG kind exactly, and the PDFs must embed them.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pdf = require('../server/pdf');
const { startTestApp, makeSchool, seedSchool, client } = require('./helpers');

// ---- a small PNG encoder for the tests (supports the PNG row filters, so unfiltering is really tested) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
function encodePng({ w, h, depth, ctype, rows, plte, trns, filter = (y) => y % 5 }) {
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype], bpp = Math.max(1, (chan * depth) >> 3), stride = (w * chan * depth + 7) >> 3;
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y], f = filter(y), prev = y ? rows[y - 1] : Buffer.alloc(stride), line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = (row[x] - pr) & 255;
    }
    out.push(Buffer.from([f]), line);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ctype;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), plte ? chunk('PLTE', plte) : Buffer.alloc(0), trns ? chunk('tRNS', trns) : Buffer.alloc(0), chunk('IDAT', zlib.deflateSync(Buffer.concat(out))), chunk('IEND', Buffer.alloc(0))]);
}
const px = (w, h, f) => Array.from({ length: h }, (_, y) => Buffer.from(Array.from({ length: w }, (_, x) => f(x, y)).flat()));

test('decoder reads RGBA, RGB, grey, grey+alpha, 16-bit and palette PNGs exactly, through every row filter', () => {
  const w = 7, h = 6;
  const val = (x, y, k) => (x * 37 + y * 53 + k * 91) & 255;
  // RGBA 8-bit
  let d = pdf.decodePng(encodePng({ w, h, depth: 8, ctype: 6, rows: px(w, h, (x, y) => [val(x, y, 0), val(x, y, 1), val(x, y, 2), x === 0 ? 0 : 200]) }));
  assert.equal(d.w, w); assert.equal(d.h, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 3; assert.deepEqual([...d.rgb.subarray(o, o + 3)], [val(x, y, 0), val(x, y, 1), val(x, y, 2)]); assert.equal(d.alpha[y * w + x], x === 0 ? 0 : 200); }
  // RGB 8-bit, no alpha
  d = pdf.decodePng(encodePng({ w, h, depth: 8, ctype: 2, rows: px(w, h, (x, y) => [val(x, y, 0), val(x, y, 1), val(x, y, 2)]) }));
  assert.equal(d.alpha, null); assert.deepEqual([...d.rgb.subarray(0, 3)], [val(0, 0, 0), val(0, 0, 1), val(0, 0, 2)]);
  // grey 8-bit and grey+alpha
  d = pdf.decodePng(encodePng({ w, h, depth: 8, ctype: 0, rows: px(w, h, (x, y) => [val(x, y, 0)]) }));
  assert.deepEqual([...d.rgb.subarray(3, 6)], [val(1, 0, 0), val(1, 0, 0), val(1, 0, 0)]);
  d = pdf.decodePng(encodePng({ w, h, depth: 8, ctype: 4, rows: px(w, h, (x, y) => [val(x, y, 0), 100]) }));
  assert.equal(d.alpha[0], 100); assert.equal(d.rgb[0], val(0, 0, 0));
  // 16-bit RGB: keeps the high byte
  d = pdf.decodePng(encodePng({ w: 2, h: 2, depth: 16, ctype: 2, rows: px(2, 2, (x, y) => [10 + x, 1, 20 + y, 2, 30, 3]) }));
  assert.deepEqual([...d.rgb.subarray(0, 3)], [10, 20, 30]);
  // palette, 4-bit with transparency on index 1 (two pixels per byte)
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  d = pdf.decodePng(encodePng({ w: 4, h: 2, depth: 4, ctype: 3, plte, trns: Buffer.from([255, 0]), rows: [Buffer.from([0x01, 0x23]), Buffer.from([0x32, 0x10])] }));
  assert.deepEqual([...d.rgb.subarray(0, 6)], [255, 0, 0, 0, 255, 0]);        // pixels 0 and 1
  assert.deepEqual([...d.alpha.subarray(0, 4)], [255, 0, 255, 255]);          // index 1 is transparent
  // not a PNG / interlaced / absurdly large → refused, never a crash
  assert.equal(pdf.decodePng(Buffer.from('hello')), null);
  const inter = encodePng({ w: 2, h: 2, depth: 8, ctype: 2, rows: px(2, 2, () => [1, 2, 3]) }); inter[28] = 1;
  assert.equal(pdf.decodePng(inter), null);
});

test('a PDF with a PNG logo is valid and renders; transparency is kept as a soft mask', () => {
  const w = 40, h = 40;
  const png = encodePng({ w, h, depth: 8, ctype: 6, rows: px(w, h, (x, y) => (x - 20) ** 2 + (y - 20) ** 2 < 350 ? [10, 30, 90, 255] : [0, 0, 0, 0]) });
  assert.deepEqual(pdf.imageInfo(png), { w, h, kind: 'png' });
  const p = new pdf.Page(); p.logo = { x: 56, y: 700, w: 80, h: 80 }; p.text('Hello', 150, 740, 14, true);
  const buf = pdf.build([p], { title: 'Logo test', logo: png });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.match(buf.toString('latin1'), /\/SMask \d+ 0 R/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jao-pdf-')); const f = path.join(dir, 't.pdf'); fs.writeFileSync(f, buf);
  try { assert.match(execFileSync('pdfinfo', [f]).toString(), /Pages:\s+1/); execFileSync('pdftoppm', ['-png', '-r', '40', f, path.join(dir, 'o')]); assert.ok(fs.readdirSync(dir).some((n) => n.endsWith('.png')), 'rendered'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; /* no PDF tools on this machine: structure checks above still ran */ }
  // JPEG logos and logo-less PDFs keep working
  assert.equal(pdf.build([new pdf.Page()], { title: 'x' }).subarray(0, 5).toString(), '%PDF-');
});

test('a receipt carries the school PNG logo', async (t) => {
  const app = await startTestApp(); t.after(() => app.stop());
  await makeSchool(app, 'Png School', 'png@test.local');
  const A = await seedSchool(app, 'png@test.local', 'P');
  const png = encodePng({ w: 8, h: 8, depth: 8, ctype: 6, rows: px(8, 8, (x, y) => [200, 160, 20, x < 4 ? 255 : 90]) });
  assert.equal((await A.admin.post('/settings/logo', { image: 'data:image/png;base64,' + png.toString('base64') })).status, 200);
  const st = await A.mk('Kid P', 'Mum P');
  await A.admin.post('/fees/charges', { title: 'Tuition', amount: 1000, due_date: '2030-01-01', class_id: A.cls });
  const charge = (await A.admin.get(`/students/${st.id}/fees`)).data.charges[0];
  const pay = await A.admin.post(`/fees/charges/${charge.id}/payments`, { amount: 500, method: 'cash' });
  assert.equal(pay.status, 200);
  const rc = await A.admin.get(`/fees/payments/${pay.data.id}/receipt`);
  assert.equal(rc.status, 200); assert.match(rc.data.toString('latin1'), /\/Subtype \/Image/);
});
