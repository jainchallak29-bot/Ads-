import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openStore } from './store.js';
import { createAuth, requestGuard } from './auth.js';
import { createGraphClient } from './meta/graph.js';
import { createMediaLibrary, PUBLIC_FILE_RE } from './media.js';
import { createPublicUrlProvider } from './publicUrl.js';
import { createJobRunner } from './jobs.js';
import { createApiRouter, apiErrorHandler } from './routes/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultLog(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
}

/**
 * Build the whole application. Exported separately from server.js so tests can run it
 * against a fake Meta API.
 * @param {ReturnType<import('./config.js').loadConfig>} config
 */
export async function createApp(config, { fetch = globalThis.fetch, log = defaultLog, sleep } = {}) {
  const store = await openStore(config.dataDir);
  const auth = await createAuth(config);
  const timing = { ...config.timing, ...(sleep ? { sleep } : {}) };
  const graph = createGraphClient(config.meta, timing, { fetch, log: config.debug ? (m) => log(`[graph] ${m}`) : undefined });
  const media = await createMediaLibrary(config, { log });
  const publicUrls = createPublicUrlProvider(config, { fetch });
  const jobs = createJobRunner({ store, media, graph, publicUrls, timing, log });
  await jobs.recoverInterrupted();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(requestGuard(config));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Prepared Instagram photos must be downloadable by Instagram's servers without logging in.
  // Names are 128-bit random, so they cannot be guessed.
  app.get('/media/:file', (req, res) => {
    const name = req.params.file;
    if (!PUBLIC_FILE_RE.test(name)) return res.status(404).end();
    return res.sendFile(name, { root: media.dir, dotfiles: 'deny', headers: { 'Cache-Control': 'public, max-age=86400' } }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.use(auth.requireLogin);
  const { api, oauth } = createApiRouter({ config, store, media, graph, jobs, publicUrls, auth, log });
  app.use('/api', api);
  app.use('/auth/facebook', oauth);
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.use(apiErrorHandler(log));

  const cleanup = () =>
    media
      .cleanup()
      .then((n) => n && log(`Removed ${n} old uploaded file(s).`))
      .catch((err) => log(`Cleanup failed: ${err.message}`));
  cleanup();
  const timer = setInterval(cleanup, 6 * 3600 * 1000);
  timer.unref();

  return {
    app,
    store,
    media,
    jobs,
    graph,
    publicUrls,
    async close() {
      clearInterval(timer);
      await store.flush();
    },
  };
}
