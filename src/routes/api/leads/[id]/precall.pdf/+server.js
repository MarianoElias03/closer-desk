import { error } from '@sveltejs/kit';
import { precallPdf } from '$lib/server/precall.js';
// the pre-call snapshot as a PDF (?inline=1 opens it in the browser instead of downloading)
export function GET({ params, locals, url }) {
  try {
    const { pdf, filename } = precallPdf(locals.offer.id, params.id);
    return new Response(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${url.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${filename}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    error(400, e.message);
  }
}
