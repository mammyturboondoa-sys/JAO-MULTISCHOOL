'use strict';
// Spreadsheet toolkit with NO external packages: reads .xlsx and .csv, writes .xlsx (for the downloadable templates).
// Reading is defensive: file size, entry count, expanded size, rows and columns are all capped.
const zlib = require('node:zlib');

const MAX_ENTRY_BYTES = 120 * 1024 * 1024; // expanded size of one part (guards against zip bombs)
const MAX_ROWS = 20000, MAX_COLS = 120;

// ---------------- ZIP (read) ----------------
function readZip(buf) {
  if (buf.length < 22) throw new Error('not_xlsx');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not_xlsx');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count > 500) throw new Error('not_xlsx');
  const entries = new Map(); let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('not_xlsx');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    entries.set(name, { method, csize, usize, lho });
    p += 46 + nlen + elen + clen;
  }
  const read = (name) => {
    const e = entries.get(name); if (!e) return null;
    if (e.usize > MAX_ENTRY_BYTES) throw new Error('file_too_large');
    const lh = e.lho; if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('not_xlsx');
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.slice(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    throw new Error('not_xlsx');
  };
  return { names: [...entries.keys()], read };
}

// ---------------- XML helpers ----------------
const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
  if (g[0] === '#') { const n = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const attr = (s, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s); return m ? unesc(m[1]) : null; };
const textOf = (xml) => { let out = ''; const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += unesc(m[1]); return out; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

function serialToIso(n) { // Excel 1900 date system
  const ms = Math.round((n - 25569) * 86400e3); const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10);
}
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// ---------------- XLSX (read) ----------------
function readXlsx(buf) {
  const zip = readZip(buf);
  const wb = zip.read('xl/workbook.xml'); if (!wb) throw new Error('not_xlsx');
  const wbXml = wb.toString('utf8');
  const relsXml = (zip.read('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8');
  const rels = {}; for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = attr(m[1], 'Id'), tg = attr(m[1], 'Target'); if (id && tg) rels[id] = tg.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); }
  const shared = []; const ss = zip.read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  // which cell styles are dates?
  const dateXf = new Set(); const st = zip.read('xl/styles.xml');
  if (st) {
    const sx = st.toString('utf8'); const custom = {};
    for (const m of sx.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom[attr(m[1], 'numFmtId')] = attr(m[1], 'formatCode') || '';
    const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(sx);
    if (cx) { let i = 0; for (const m of cx[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) { const id = Number(attr(m[1], 'numFmtId')); const code = custom[id]; if (BUILTIN_DATE.has(id) || (code && /[ymd]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^general$/i.test(code))) dateXf.add(i); i++; } }
  }
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name'); const rid = attr(m[1], 'r:id') || attr(m[1], 'id');
    const target = rels[rid]; if (!name || !target) continue;
    const data = zip.read(target); if (!data) continue;
    const xml = data.toString('utf8'); const rows = []; let maxCol = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = (Number(attr(rm[1], 'r')) || rows.length + 1) - 1; if (rIdx >= MAX_ROWS) throw new Error('too_many_rows');
      const cells = [];
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r'); if (!ref) continue; const ci = colIndex(ref); if (ci >= MAX_COLS) continue;
        const t = attr(cm[1], 't'), s = Number(attr(cm[1], 's') || 0), inner = cm[2] || '';
        const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner); let val = '';
        if (t === 's') val = shared[Number(vm && vm[1])] ?? '';
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'e') val = vm ? unesc(vm[1]) : '';
        else if (t === 'b') val = vm && vm[1] === '1' ? 'TRUE' : 'FALSE';
        else if (vm) { const n = Number(vm[1]); val = dateXf.has(s) && Number.isFinite(n) ? serialToIso(n) : (Number.isFinite(n) ? String(parseFloat(n.toPrecision(15))) : unesc(vm[1])); }
        cells[ci] = String(val).trim(); if (ci + 1 > maxCol) maxCol = ci + 1;
      }
      rows[rIdx] = cells;
    }
    const out = []; for (let i = 0; i < rows.length; i++) { const r = rows[i] || []; const row = []; for (let c = 0; c < maxCol; c++) row.push(r[c] ?? ''); out.push(row); }
    sheets.push({ name, rows: out });
  }
  if (!sheets.length) throw new Error('not_xlsx');
  return sheets;
}

// ---------------- CSV (read) ----------------
function decodeText(buf) {
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { s = new TextDecoder('windows-1252').decode(buf); }
  return s.replace(/^\uFEFF/, '');
}
function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const cnt = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const delim = [';', '\t', ','].map((d) => [d, cnt(d)]).sort((a, b) => b[1] - a[1])[0];
  const D = delim[1] > 0 ? delim[0] : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === '') q = true;
    else if (c === D) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; if (rows.length > MAX_ROWS) throw new Error('too_many_rows'); }
    else cur += c;
  }
  row.push(cur.trim()); if (row.some((x) => x !== '')) rows.push(row);
  const width = Math.min(MAX_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0));
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

// Detect the kind of an uploaded file from its bytes (never from its name or from what the browser claims).
function sniff(buf) {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0) return 'xls';
  return 'text';
}
// Returns [{name, rows}] for xlsx or csv/text. Throws Error with a short code.
function readTable(buf) {
  const kind = sniff(buf);
  if (kind === 'xlsx') return readXlsx(buf);
  if (kind === 'xls') throw new Error('old_xls');
  if (kind === 'pdf') throw new Error('is_pdf');
  const rows = parseCsv(decodeText(buf));
  if (!rows.length) throw new Error('empty_file');
  return [{ name: 'CSV', rows }];
}

// ---------------- ZIP + XLSX (write) ----------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function writeZip(files) { // files: [{name, data: Buffer}]
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const raw = f.data; const comp = zlib.deflateRawSync(raw); const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// sheets: [{ name, rows: [[cell...]], widths?: [n...], header?: {rowIndex, required: [bool...]}, styleRows?: {idx: 'example'|'title'|'note'}, lists?: [{col, values:[..]}] }]
// Cell styles: 0 normal, 1 required heading, 2 optional heading, 3 example row, 4 title, 5 wrapped text
function writeXlsx(sheets) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0B2A5B"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF7A7A7A"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF0B2A5B"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2A5B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8FB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4CF"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBBC7DD"/></left><right style="thin"><color rgb="FFBBC7DD"/></right><top style="thin"><color rgb="FFBBC7DD"/></top><bottom style="thin"><color rgb="FFBBC7DD"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const files = [];
  files.push({ name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) });
  files.push({ name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
  files.push({ name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) });
  files.push({ name: 'xl/styles.xml', data: Buffer.from(styles) });
  sheets.forEach((s, i) => {
    const cols = s.widths ? `<cols>${s.widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rowsXml = s.rows.map((r, ri) => {
      const kind = s.styleRows && s.styleRows[ri];
      const cells = r.map((v, ci) => {
        if (v === '' || v === null || v === undefined) return '';
        let st = 0;
        if (kind === 'heading') st = (s.header && s.header.required && s.header.required[ci]) ? 1 : 2;
        else if (kind === 'example') st = 3; else if (kind === 'title') st = 4; else if (kind === 'wrap') st = 5;
        return `<c r="${colName(ci)}${ri + 1}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const dv = s.lists && s.lists.length ? `<dataValidations count="${s.lists.length}">${s.lists.map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colName(l.col)}2:${colName(l.col)}5000"><formula1>"${esc(l.values.join(',')).slice(0, 250)}"</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    const view = s.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rowsXml}</sheetData>${dv}</worksheet>`) });
  });
  return writeZip(files);
}

module.exports = { readTable, readXlsx, parseCsv, decodeText, writeXlsx, sniff, colName, serialToIso };
