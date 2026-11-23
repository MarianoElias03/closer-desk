/**
 * A tiny one-page PDF writer: filled shapes, text in the built-in Helvetica faces, and clickable links.
 * Enough for a branded summary sheet without pulling in a PDF library. Coordinates are points from the
 * top-left (converted to PDF's bottom-left here). A4 by default.
 */

// Helvetica advance widths (per 1000 em) for printable ASCII, from the standard font metrics.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Keep to what Helvetica's built-in encoding can show (curly quotes and dashes become plain ones). */
export function pdfSafe(s) {
  return String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e]/g, '');
}
export function textWidth(s, size, bold = false) {
  const w = bold ? W_BOLD : W_REG;
  let t = 0;
  for (const ch of pdfSafe(s)) t += w[ch.charCodeAt(0) - 32] ?? 556;
  return (t * size) / 1000;
}
/** Split text into lines that fit a width. */
export function wrap(s, size, width, bold = false) {
  const out = [];
  for (const para of pdfSafe(s).split(/\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const esc = (s) => pdfSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v) => (Math.round(v * 100) / 100).toString();
function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
}

export class Page {
  constructor(width = 595.28, height = 841.89) {
    this.w = width;
    this.h = height;
    this.ops = [];
    this.links = [];
  }
  rect(x, y, w, h, fill, radius = 0) {
    const Y = this.h - y - h;
    this.ops.push(`${rgb(fill)} rg`);
    if (!radius) this.ops.push(`${n(x)} ${n(Y)} ${n(w)} ${n(h)} re f`);
    else {
      const r = Math.min(radius, w / 2, h / 2);
      const k = r * 0.5523;
      this.ops.push(
        [
          `${n(x + r)} ${n(Y)} m`,
          `${n(x + w - r)} ${n(Y)} l`,
          `${n(x + w - r + k)} ${n(Y)} ${n(x + w)} ${n(Y + r - k)} ${n(x + w)} ${n(Y + r)} c`,
          `${n(x + w)} ${n(Y + h - r)} l`,
          `${n(x + w)} ${n(Y + h - r + k)} ${n(x + w - r + k)} ${n(Y + h)} ${n(x + w - r)} ${n(Y + h)} c`,
          `${n(x + r)} ${n(Y + h)} l`,
          `${n(x + r - k)} ${n(Y + h)} ${n(x)} ${n(Y + h - r + k)} ${n(x)} ${n(Y + h - r)} c`,
          `${n(x)} ${n(Y + r)} l`,
          `${n(x)} ${n(Y + r - k)} ${n(x + r - k)} ${n(Y)} ${n(x + r)} ${n(Y)} c`,
          'f'
        ].join('\n')
      );
    }
    return this;
  }
  /** Text with its top at y. align: left | right | center (x is the anchor). */
  text(s, x, y, { size = 11, bold = false, color = '#111111', align = 'left' } = {}) {
    const w = textWidth(s, size, bold);
    const X = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const Y = this.h - y - size * 0.8;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(color)} rg ${n(X)} ${n(Y)} Td (${esc(s)}) Tj ET`);
    return w;
  }
  /** Wrapped paragraph; returns the height used. */
  para(s, x, y, width, opts = {}) {
    const size = opts.size || 11;
    const lh = opts.lineHeight || size * 1.4;
    const lines = wrap(s, size, width, opts.bold);
    lines.forEach((l, i) => this.text(l, x, y + i * lh, opts));
    return lines.length * lh;
  }
  /** A clickable area that opens a web address. */
  link(x, y, w, h, url) {
    this.links.push({ x, y: this.h - y - h, w, h, url });
    return this;
  }
}

/** Build the PDF file (one page). */
export function renderPdf(page, { title = 'Document', author = '' } = {}) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const stream = page.ops.join('\n');
  const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  const annots = page.links.map((l) =>
    add(`<< /Type /Annot /Subtype /Link /Rect [${n(l.x)} ${n(l.y)} ${n(l.x + l.w)} ${n(l.y + l.h)}] /Border [0 0 0] /A << /S /URI /URI (${esc(l.url)}) >> >>`)
  );
  const pageObj = add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.w)} ${n(page.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`
  );
  objs[1] = `<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`;
  const info = add(`<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (Closer Desk) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
