import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

/**
 * Accounts and sign-in. One or more users with a username and password (scrypt hash, never stored in
 * plain text). Signing in issues a session: a random token, stored only as its sha256, that works as the
 * `cd_session` cookie (website, and the Android app's web screens) or as `Authorization: Bearer <token>`
 * (the Android app's own calls). Each session is one device and can be signed out on its own.
 *
 * The very first account is created from the sign-in page, which only offers that while there are no
 * users at all.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,          -- sha256 of the token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
`);

export const COOKIE = 'cd_session';
const sha = (t) => createHash('sha256').update(t).digest('hex');

function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [kind, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

export const hasUsers = () => !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

function cleanName(u) {
  const n = String(u || '').trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(n)) throw new Error('Pick a username of 2 to 40 letters, numbers, dots, dashes or underscores');
  return n;
}
function cleanPassword(pw) {
  const p = String(pw || '');
  if (p.length < 8) throw new Error('Use a password of at least 8 characters');
  if (p.length > 200) throw new Error('That password is too long');
  return p;
}

/** First account only: refused once any account exists. */
export function createFirstUser(username, password) {
  return db.transaction(() => {
    if (hasUsers()) throw new Error('An account already exists. Sign in instead.');
    const id = db
      .prepare('INSERT INTO users(username, pw_hash, created_at) VALUES(?, ?, ?)')
      .run(cleanName(username), hashPassword(cleanPassword(password)), new Date().toISOString()).lastInsertRowid;
    return id;
  })();
}

// 5 wrong passwords for a username locks it for 10 minutes (in memory; a restart clears it)
const fails = new Map();
const LOCK_AFTER = 5;
const LOCK_MS = 10 * 60 * 1000;

export function checkLogin(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const f = fails.get(key);
  if (f && f.n >= LOCK_AFTER && Date.now() - f.at < LOCK_MS) throw new Error('Too many tries. Wait 10 minutes and try again.');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  // always run scrypt so a wrong username takes as long as a wrong password
  const ok = checkPassword(String(password || ''), u?.pw_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==') && !!u;
  if (!ok) {
    const n = f && Date.now() - f.at < LOCK_MS ? f.n + 1 : 1;
    fails.set(key, { n, at: Date.now() });
    throw new Error('Wrong username or password');
  }
  fails.delete(key);
  return u;
}

export function startSession(userId, device) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO sessions(id, user_id, device, created_at, last_seen) VALUES(?, ?, ?, ?, ?)').run(
    sha(token),
    userId,
    String(device || '').slice(0, 80),
    now,
    now
  );
  return token;
}

/** The signed-in user for a token, or null. Touches last_seen at most once a minute. */
export function sessionUser(token) {
  if (!token || token.length < 20) return null;
  const s = db.prepare('SELECT s.id, s.last_seen, s.device, u.id AS user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sha(token));
  if (!s) return null;
  if (Date.now() - Date.parse(s.last_seen) > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), s.id);
  return { id: s.user_id, username: s.username, sessionId: s.id, device: s.device };
}

export const endSession = (token) => token && db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(token));

export function listSessions(userId) {
  return db
    .prepare('SELECT id, device, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC')
    .all(userId)
    .map((s) => ({ id: s.id.slice(0, 16), device: s.device || 'Unknown device', createdAt: s.created_at, lastSeen: s.last_seen }));
}
/** Sign out one device by the short id from listSessions. */
export function revokeSession(userId, shortId) {
  if (!/^[0-9a-f]{16}$/.test(shortId || '')) return 0;
  return db.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ?").run(userId, shortId).changes;
}

/** New password; every other device is signed out. */
export function changePassword(userId, current, next, keepSessionId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !checkPassword(String(current || ''), u.pw_hash)) throw new Error('Your current password is wrong');
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(cleanPassword(next)), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
}

/** The token from a request: Bearer header first (the app), then the cookie (browsers and web screens). */
export function tokenFrom(request, cookies) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : cookies.get(COOKIE) || null;
}

/** Cookie options: secure whenever the request came in over https (tailscale serve sets x-forwarded-proto). */
export function cookieOpts(url, request) {
  const https = url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: https, maxAge: 60 * 60 * 24 * 365 };
}
