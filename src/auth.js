import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isLoopbackHost } from './config.js';

const COOKIE = 'sp_session';
const SESSION_SECONDS = 30 * 24 * 3600;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// Paths reachable without logging in (when APP_PASSWORD is set).
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/styles.css', '/favicon.svg', '/api/login', '/healthz', '/auth/facebook/callback']);
const PUBLIC_PREFIXES = ['/media/'];

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'social-poster';

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function loadOrCreateSecret(dataDir, configured) {
  if (configured) return configured;
  const file = path.join(dataDir, '.session-secret');
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file, secret, { mode: 0o600 });
    return secret;
  }
}

/**
 * Optional password protection. When APP_PASSWORD is empty the app is open, which is only
 * allowed while it listens on localhost (enforced in server.js).
 */
export async function createAuth(config) {
  const enabled = Boolean(config.appPassword);
  const secret = await loadOrCreateSecret(config.dataDir, config.sessionSecret);
  // Changing APP_PASSWORD invalidates existing sessions.
  const key = crypto.createHash('sha256').update(`${secret}:${config.appPassword}`).digest();
  const passwordHash = crypto.createHash('sha256').update(config.appPassword).digest();
  const secureCookie = config.publicBaseUrl.startsWith('https://');
  const failures = new Map(); // ip -> { count, resetAt }

  const sign = (value) => crypto.createHmac('sha256', key).update(value).digest('base64url');

  function hasSession(req) {
    if (!enabled) return true;
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw) return false;
    const dot = raw.lastIndexOf('.');
    if (dot < 0) return false;
    const value = raw.slice(0, dot);
    const given = Buffer.from(raw.slice(dot + 1));
    const expected = Buffer.from(sign(value));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
    return Number(value.split('.')[0]) > Date.now() / 1000;
  }

  function setSessionCookie(res) {
    const value = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${crypto.randomBytes(9).toString('base64url')}`;
    res.append('Set-Cookie', `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`);
  }

  function clearSessionCookie(res) {
    res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`);
  }

  function login(req, res) {
    if (!enabled) return res.json({ ok: true });
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = failures.get(ip);
    if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_FAILURES) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    const candidate = crypto.createHash('sha256').update(String(req.body?.password ?? '')).digest();
    if (!crypto.timingSafeEqual(candidate, passwordHash)) {
      const next = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      next.count += 1;
      failures.set(ip, next);
      return res.status(401).json({ error: 'Wrong password.' });
    }
    failures.delete(ip);
    setSessionCookie(res);
    return res.json({ ok: true });
  }

  function logout(_req, res) {
    clearSessionCookie(res);
    res.json({ ok: true });
  }

  /** Blocks everything except public paths for visitors without a session. */
  function requireLogin(req, res, next) {
    if (!enabled || hasSession(req)) return next();
    if (PUBLIC_PATHS.has(req.path) || PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please log in.', loginRequired: true });
    return res.redirect(302, '/login.html');
  }

  return { enabled, hasSession, login, logout, requireLogin };
}

/**
 * Protects a locally running app from other websites open in the same browser:
 *  - DNS-rebinding: when listening on localhost, only accept Host headers that point to localhost.
 *  - CSRF: state-changing API calls must carry a custom header, which a foreign site cannot send
 *    without a CORS preflight (which this app never approves).
 */
export function requestGuard(config) {
  const localOnly = !config.publicBaseUrl && isLoopbackHost(config.host);
  return (req, res, next) => {
    if (localOnly) {
      const hostname = String(req.headers.host ?? '').replace(/:\d+$/, '');
      if (!isLoopbackHost(hostname)) {
        return res.status(421).type('text/plain').send('This app only accepts requests addressed to localhost.');
      }
    }
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!safeMethod && req.path.startsWith('/api/') && req.get(CSRF_HEADER) !== CSRF_VALUE) {
      return res.status(403).json({ error: 'Request blocked: missing app header.' });
    }
    return next();
  };
}
