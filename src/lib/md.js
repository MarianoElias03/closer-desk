// Tiny, safe markdown for Fathom summaries: headings, bullets, bold, links.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function md(src = '') {
  const out = [];
  let list = false;
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*]\s+(.*)/);
    if (b) {
      if (!list) out.push('<ul>'), (list = true);
      out.push(`<li>${inline(b[1])}</li>`);
      continue;
    }
    if (list) out.push('</ul>'), (list = false);
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
