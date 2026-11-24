import { error } from '@sveltejs/kit';
import { precallPdf } from '$lib/server/precall.js';
import { logActivity } from '$lib/server/db.js';
// the pre-call snapshot as a PDF (?inline=1 opens it in the browser instead of downloading)
export function GET({ params, locals, url }) {
  try {
    const { pdf, filename } = precallPdf(locals.offer.id, params.id);
    const inline = !!url.searchParams.get('inline');
    logActivity(params.id, inline ? 'pdf-view' : 'pdf', inline ? `Pre-call PDF opened (${filename})` : `Pre-call PDF downloaded (${filename})`, { merge: 5 });
    return new Response(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    error(400, e.message);
  }
}
