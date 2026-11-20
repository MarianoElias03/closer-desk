import { json } from '@sveltejs/kit';
import { authorised, handleRpc } from '$lib/server/mcp.js';

// MCP over Streamable HTTP, stateless: every POST carries one JSON-RPC message (or a batch) and
// gets a plain JSON reply. Needs "Authorization: Bearer <CLOSER_MCP_TOKEN>".
export async function POST({ request }) {
  if (!authorised(request)) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorised' } }, { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  const replies = (Array.isArray(body) ? body : [body]).map(handleRpc).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? replies : replies[0]);
}

// no server-to-client stream: tell clients to stick to POST
export const GET = () => new Response('Use POST', { status: 405, headers: { allow: 'POST' } });
export const DELETE = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
