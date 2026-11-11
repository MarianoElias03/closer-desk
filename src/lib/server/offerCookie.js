// Remembers the open offer per browser. Readable by the page so other tabs notice a switch.
export function rememberOffer(cookies, id) {
  cookies.set('offer', String(id), { path: '/', maxAge: 60 * 60 * 24 * 400, httpOnly: false, sameSite: 'lax', secure: false });
}
