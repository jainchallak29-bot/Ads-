import fs from 'node:fs';
import { loadConfig, isLoopbackHost } from './config.js';
import { createApp } from './app.js';

// Load settings from .env (process.loadEnvFile exists on Node 20.12+; tiny fallback otherwise).
function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file);
    return;
  }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotEnv();
const config = loadConfig();

const reachableFromOutside = Boolean(config.publicBaseUrl) || !isLoopbackHost(config.host);
if (reachableFromOutside && !config.appPassword) {
  console.error(
    '\nNot starting: the app would be reachable from other computers (PUBLIC_BASE_URL or HOST is set),\n' +
      'but APP_PASSWORD is empty. Anyone could post to your Pages. Set APP_PASSWORD in .env and start again.\n',
  );
  process.exit(1);
}

const { app, media, publicUrls, close } = await createApp(config);
const server = app.listen(config.port, config.host, () => {
  const meta = config.meta;
  const lines = [
    '',
    '  Social Poster is running',
    `  Open:            ${config.publicBaseUrl || `http://localhost:${config.port}`}`,
    `  Meta app:        ${meta.appId ? `App ID ${meta.appId} (Graph API ${meta.graphVersion})` : 'not configured (you can still paste an access token in Settings)'}`,
    `  Instagram photos: ${{ base_url: `served from ${config.publicBaseUrl}`, imgbb: 'temporary links via imgbb.com', none: 'disabled until PUBLIC_BASE_URL or IMGBB_API_KEY is set (Reels work)' }[publicUrls.mode]}`,
    `  ffmpeg:          ${media.tools.ffmpeg ? 'found (videos are converted automatically when needed)' : 'not found (optional, see README)'}`,
    `  Password:        ${config.appPassword ? 'on' : 'off (local use only)'}`,
    '',
  ];
  console.log(lines.join('\n'));
});
// Large video uploads can take a long time on slow connections.
server.requestTimeout = 0;
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Set PORT in .env to another number.` : err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    close().finally(() => process.exit(0));
  });
}
