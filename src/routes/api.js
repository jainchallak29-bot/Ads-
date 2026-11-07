import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { newId } from '../store.js';
import { publicMedia, MediaError } from '../media.js';
import { loginUrl, exchangeCodeForToken, extendUserToken, discoverAccounts, instagramQuota } from '../meta/accounts.js';
import { friendlyError } from '../meta/errors.js';
import { NO_PUBLIC_URL_HELP } from '../publicUrl.js';
import { buildPostText, normalizeHashtags, instagramTextProblems, facebookTextProblems } from '../../public/shared/caption.js';
import { describeSelection, formatsFor, facebookReelProblems, instagramReelProblems } from '../../public/shared/rules.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function sanitizeGroupUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new HttpError(400, 'Enter the full group link, for example https://www.facebook.com/groups/yourgroup');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com'))) {
    throw new HttpError(400, 'Group links must start with https://www.facebook.com/groups/…');
  }
  return url.toString();
}

function publicPage(p, quotas) {
  return {
    id: p.id,
    name: p.name,
    pictureUrl: p.pictureUrl,
    canPost: p.canPost !== false,
    instagram: p.instagram ? { ...p.instagram, quota: quotas?.[p.instagram.id] ?? null } : null,
  };
}

export function createApiRouter({ config, store, media, graph, jobs, publicUrls, auth, log }) {
  const router = express.Router();
  const oauthStates = new Map();
  const quotas = {};

  const upload = multer({
    storage: multer.diskStorage({
      destination: media.dir,
      filename: (_req, _file, cb) => cb(null, `upload-${crypto.randomBytes(12).toString('hex')}`),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  });

  const redirectUri = () => `${config.appBaseUrl}/auth/facebook/callback`;
  const oauthReady = () => Boolean(config.meta.appId && config.meta.appSecret);

  function statePayload() {
    const d = store.data;
    const c = d.connection;
    return {
      app: {
        graphVersion: config.meta.graphVersion,
        oauthAvailable: oauthReady(),
        redirectUri: redirectUri(),
        usesLoginConfig: Boolean(config.meta.loginConfigId),
        canExtendTokens: oauthReady(),
        publicMediaMode: publicUrls.mode,
        publicBaseUrl: config.publicBaseUrl || null,
        publicMediaHelp: publicUrls.mode === 'none' ? NO_PUBLIC_URL_HELP : null,
        ffmpeg: media.tools.ffmpeg,
        ffprobe: media.tools.ffprobe,
        passwordProtected: auth.enabled,
        maxUploadMb: Math.round(config.maxUploadBytes / 1048576),
      },
      connection: c
        ? {
            method: c.method,
            kind: c.kind,
            userName: c.user?.name ?? null,
            connectedAt: c.connectedAt,
            tokenExpiresAt: c.userTokenExpiresAt ?? null,
            refreshedAt: c.refreshedAt ?? null,
            tokenExtended: Boolean(c.tokenExtended),
          }
        : null,
      pages: d.pages.map((p) => publicPage(p, quotas)),
      groups: d.groups,
      hashtagSets: d.hashtagSets,
    };
  }

  async function refreshQuotas() {
    await Promise.all(
      store.data.pages
        .filter((p) => p.instagram)
        .map(async (p) => {
          quotas[p.instagram.id] = await instagramQuota(graph, p.instagram.id, p.accessToken);
        }),
    );
  }

  async function connectWithToken(token, { method, expiresIn }) {
    let userToken = token;
    let expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
    let extended = false;
    if (oauthReady()) {
      try {
        const long = await extendUserToken(graph, config.meta, token);
        userToken = long.token;
        expiresAt = long.expiresIn ? Date.now() + long.expiresIn * 1000 : null;
        extended = true;
      } catch (err) {
        // Page tokens and system-user tokens cannot be exchanged; they are used as they are.
        log(`Token exchange skipped: ${err.message}`);
      }
    }
    const found = await discoverAccounts(graph, userToken);
    await store.update((d) => {
      d.connection = {
        method,
        kind: found.kind,
        user: found.user,
        userToken: found.kind === 'user' ? userToken : null,
        userTokenExpiresAt: found.kind === 'user' ? expiresAt : null,
        tokenExtended: extended,
        connectedAt: new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
      };
      d.pages = found.pages;
    });
    await refreshQuotas();
    return found;
  }

  // ---------- session ----------
  router.post('/login', express.json({ limit: '10kb' }), (req, res) => auth.login(req, res));
  router.post('/logout', (req, res) => auth.logout(req, res));

  router.use(express.json({ limit: '1mb' }));

  // ---------- state ----------
  router.get('/state', (_req, res) => res.json(statePayload()));

  // ---------- Meta connection ----------
  router.post('/connect/token', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    if (token.length < 20) throw new HttpError(400, 'Paste the access token you copied from Meta (it is a long string of letters and numbers).');
    try {
      const found = await connectWithToken(token, { method: 'token' });
      if (!found.pages.length) {
        return res.json({ ...statePayload(), warning: 'Connected, but no Facebook Pages were found. Make sure the token includes the pages_show_list permission and that you selected your Pages when granting access.' });
      }
      return res.json(statePayload());
    } catch (err) {
      if (err?.code === 190) {
        throw new HttpError(400, `Facebook did not accept this token (${err.apiMessage || 'invalid token'}). Generate a new one and paste the whole token again.`);
      }
      throw new HttpError(400, `Could not connect: ${friendlyError(err)}`);
    }
  });

  router.post('/connect/refresh', async (_req, res) => {
    const c = store.data.connection;
    if (!c) throw new HttpError(400, 'Not connected yet.');
    try {
      if (c.kind === 'user' && c.userToken) {
        const found = await discoverAccounts(graph, c.userToken);
        await store.update((d) => {
          d.pages = found.pages;
          d.connection.refreshedAt = new Date().toISOString();
        });
      }
      await refreshQuotas();
      return res.json(statePayload());
    } catch (err) {
      throw new HttpError(400, `Could not refresh: ${friendlyError(err)}`);
    }
  });

  router.post('/disconnect', async (_req, res) => {
    await store.update((d) => {
      d.connection = null;
      d.pages = [];
    });
    res.json(statePayload());
  });

  // ---------- media ----------
  router.post('/media', (req, res, next) => {
    upload.single('file')(req, res, async (err) => {
      try {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') throw new HttpError(413, `File too large (limit ${Math.round(config.maxUploadBytes / 1048576)} MB).`);
          throw new HttpError(400, err.message);
        }
        if (!req.file) throw new HttpError(400, 'No file received.');
        let hints = {};
        try {
          hints = JSON.parse(req.body?.meta || '{}');
        } catch {
          hints = {};
        }
        const rec = await media.ingest(req.file.path, req.file.originalname, hints);
        res.json(publicMedia(rec));
      } catch (e) {
        if (e instanceof MediaError) return next(new HttpError(400, e.message));
        return next(e);
      }
    });
  });

  router.get('/media/:id', async (req, res) => {
    const rec = await media.get(req.params.id);
    if (!rec) throw new HttpError(404, 'Media not found (uploads are deleted after a few days).');
    res.json(publicMedia(rec));
  });

  router.get('/media/:id/file', async (req, res) => {
    const rec = await media.get(req.params.id);
    if (!rec) throw new HttpError(404, 'Media not found (uploads are deleted after a few days).');
    if (req.query.download) res.attachment(rec.name);
    res.sendFile(rec.file, { root: media.dir, dotfiles: 'deny', headers: { 'Cache-Control': 'private, max-age=3600' } });
  });

  router.delete('/media/:id', async (req, res) => {
    await media.remove(req.params.id);
    res.json({ ok: true });
  });

  // ---------- posting ----------
  router.post('/posts', async (req, res) => {
    const body = req.body ?? {};
    const caption = String(body.caption ?? '').slice(0, 70000);
    const hashtags = normalizeHashtags(body.hashtags ?? []);
    const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.map(String) : [];
    const wanted = Array.isArray(body.targets) ? body.targets : [];

    if (!mediaIds.length) throw new HttpError(400, 'Add a photo or video first.');
    const records = [];
    for (const id of mediaIds) {
      const rec = await media.get(id);
      if (!rec) throw new HttpError(400, 'One of the files is missing (uploads are deleted after a few days). Please upload it again.');
      records.push(rec);
    }
    const selection = describeSelection(records);
    if (selection.error) throw new HttpError(400, selection.error);
    if (!wanted.length) throw new HttpError(400, 'Choose at least one place to post.');

    const text = buildPostText(caption, hashtags);
    const d = store.data;
    const targets = [];
    const seen = new Set();
    for (const w of wanted) {
      const type = String(w?.type ?? '');
      const id = String(w?.id ?? '');
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const allowed = formatsFor(type, selection.kind);
      const format = allowed.includes(w?.format) ? w.format : allowed[0];
      if (type === 'fb_page') {
        const page = d.pages.find((p) => p.id === id);
        if (!page) throw new HttpError(400, 'Unknown Facebook Page. Refresh the page and try again.');
        if (page.canPost === false) throw new HttpError(400, `You do not have permission to post on "${page.name}".`);
        const problems = facebookTextProblems(text);
        if (format === 'reel') problems.push(...facebookReelProblems(records[0]));
        if (problems.length) throw new HttpError(400, `${page.name}: ${problems[0]}`);
        targets.push({ key, type, accountId: id, name: page.name, format });
      } else if (type === 'ig') {
        const page = d.pages.find((p) => p.instagram?.id === id);
        if (!page) throw new HttpError(400, 'Unknown Instagram account. Refresh the page and try again.');
        const name = page.instagram.username ? `@${page.instagram.username}` : page.instagram.name || 'Instagram';
        const problems = instagramTextProblems(text);
        if (format === 'reel') problems.push(...instagramReelProblems(records[0]));
        if (format === 'post' && publicUrls.mode === 'none') problems.push(NO_PUBLIC_URL_HELP);
        if (problems.length) throw new HttpError(400, `${name}: ${problems[0]}`);
        targets.push({ key, type, accountId: id, name, format });
      } else if (type === 'fb_group') {
        const group = d.groups.find((g) => g.id === id);
        if (!group) throw new HttpError(400, 'Unknown Facebook group. Refresh the page and try again.');
        targets.push({ key, type, accountId: id, name: group.name, format: 'assist', groupUrl: group.url });
      } else {
        throw new HttpError(400, 'Unknown destination type.');
      }
    }

    const cover = Number(body.coverSeconds);
    const options = Number.isFinite(cover) && cover > 0 && selection.kind === 'video' ? { coverOffsetMs: Math.round(cover * 1000) } : {};
    const job = await jobs.start({ caption, hashtags, records, targets, options });
    res.status(202).json(job);
  });

  router.get('/posts/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) throw new HttpError(404, 'Post not found.');
    res.json(job);
  });

  router.post('/posts/:id/targets/:key/manual', async (req, res) => {
    const job = await jobs.setManualDone(req.params.id, req.params.key, Boolean(req.body?.done));
    if (!job) throw new HttpError(404, 'Not found.');
    res.json(job);
  });

  router.get('/history', (_req, res) => res.json(store.data.history));

  router.delete('/history', async (_req, res) => {
    await store.update((d) => {
      d.history = d.history.filter((h) => h.status === 'running');
    });
    res.json({ ok: true });
  });

  // ---------- saved Facebook groups ----------
  router.post('/groups', async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    const url = sanitizeGroupUrl(req.body?.url);
    if (!name) throw new HttpError(400, 'Give the group a name.');
    const group = { id: newId(6), name, url };
    await store.update((d) => {
      d.groups.push(group);
    });
    res.json(group);
  });

  router.put('/groups/:id', async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    const url = sanitizeGroupUrl(req.body?.url);
    if (!name) throw new HttpError(400, 'Give the group a name.');
    const updated = await store.update((d) => {
      const g = d.groups.find((x) => x.id === req.params.id);
      if (g) Object.assign(g, { name, url });
      return g;
    });
    if (!updated) throw new HttpError(404, 'Group not found.');
    res.json(updated);
  });

  router.delete('/groups/:id', async (req, res) => {
    await store.update((d) => {
      d.groups = d.groups.filter((g) => g.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  // ---------- saved hashtag sets ----------
  router.post('/hashtag-sets', async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const tags = normalizeHashtags(req.body?.tags ?? []);
    if (!name) throw new HttpError(400, 'Give the hashtag set a name.');
    if (!tags.length) throw new HttpError(400, 'Add at least one hashtag.');
    const set = await store.update((d) => {
      const existing = d.hashtagSets.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.tags = tags;
        return existing;
      }
      const created = { id: newId(6), name, tags };
      d.hashtagSets.push(created);
      return created;
    });
    res.json(set);
  });

  router.delete('/hashtag-sets/:id', async (req, res) => {
    await store.update((d) => {
      d.hashtagSets = d.hashtagSets.filter((s) => s.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  router.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // ---------- OAuth (mounted outside /api) ----------
  const oauth = express.Router();
  oauth.get('/start', (req, res) => {
    if (!oauthReady()) return res.redirect('/?tab=settings&error=' + encodeURIComponent('Set META_APP_ID and META_APP_SECRET in the .env file first.'));
    const now = Date.now();
    for (const [k, v] of oauthStates) if (v < now) oauthStates.delete(k);
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, now + OAUTH_STATE_TTL_MS);
    return res.redirect(loginUrl(config.meta, { redirectUri: redirectUri(), state }));
  });

  oauth.get('/callback', async (req, res) => {
    const back = (params) => res.redirect(`/?tab=settings&${new URLSearchParams(params)}`);
    const state = String(req.query.state ?? '');
    const expires = oauthStates.get(state);
    oauthStates.delete(state);
    if (!expires || expires < Date.now()) return back({ error: 'The login link expired or was already used. Please click Connect again.' });
    if (req.query.error) return back({ error: String(req.query.error_description || req.query.error_reason || req.query.error) });
    try {
      const short = await exchangeCodeForToken(graph, config.meta, { code: String(req.query.code ?? ''), redirectUri: redirectUri() });
      const found = await connectWithToken(short.token, { method: 'oauth', expiresIn: short.expiresIn });
      return back(found.pages.length ? { connected: '1' } : { error: 'Connected, but no Facebook Pages were shared with this app. Click Connect again and select your Pages (and Instagram accounts).' });
    } catch (err) {
      log(`OAuth callback failed: ${err.message}`);
      return back({ error: `Facebook login failed: ${friendlyError(err)}` });
    }
  });

  return { api: router, oauth };
}

export function apiErrorHandler(log) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log(`Error on ${req.method} ${req.path}: ${err.stack || err}`);
    if (res.headersSent) return;
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    res.status(status).json({ error: status >= 500 ? `Something went wrong: ${err.message}` : err.message });
  };
}

export { HttpError };
