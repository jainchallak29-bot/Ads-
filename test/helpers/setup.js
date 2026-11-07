import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { startMockMeta } from './mockMeta.js';

const execFileP = promisify(execFile);

export async function hasFfmpeg() {
  try {
    await execFileP('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** Start the real app wired to the fake Meta API. */
export async function startTestApp({ env = {}, mockBehavior = {}, publicUrl = true } = {}) {
  const mock = await startMockMeta(mockBehavior);
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-poster-test-'));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    PORT: String(port),
    DATA_DIR: dataDir,
    META_APP_ID: '12345',
    META_APP_SECRET: mock.appSecret,
    META_GRAPH_BASE: mock.graphBase,
    META_GRAPH_VIDEO_BASE: mock.graphVideoBase,
    META_RUPLOAD_BASE: mock.ruploadBase,
    META_DIALOG_BASE: `${mock.base}/dialog`,
    IMGBB_API_BASE: mock.imgbbBase,
    POLL_INTERVAL_MS: '20',
    ...(publicUrl ? { PUBLIC_BASE_URL: base } : {}),
    ...env,
  });
  const logs = [];
  const instance = await createApp(config, { log: (m) => logs.push(m) });
  server.on('request', instance.app);

  let cookie = '';
  async function api(method, p, body, { headers = {}, raw = false } = {}) {
    const init = { method, redirect: 'manual', headers: { 'x-requested-with': 'social-poster', ...(cookie ? { cookie } : {}), ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const res = await fetch(base + p, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  async function upload(filePath, meta = {}) {
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    form.set('file', await fs.openAsBlob(filePath), path.basename(filePath));
    return api('POST', '/api/media', form);
  }

  async function waitForJob(id, { timeoutMs = 30000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await api('GET', `/api/posts/${id}`);
      if (data.status !== 'running') return data;
      if (Date.now() > deadline) throw new Error(`Job still running: ${JSON.stringify(data, null, 2)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function close() {
    await instance.close();
    await new Promise((resolve) => server.close(resolve));
    await mock.close();
    await fsp.rm(dataDir, { recursive: true, force: true });
  }

  return { base, mock, api, upload, waitForJob, close, instance, config, dataDir, logs, setCookie: (c) => (cookie = c) };
}

export async function makeFixturesDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'social-poster-fixtures-'));
}

export async function makeImage(dir, name, { width, height, format = 'jpeg', alpha = false }) {
  const file = path.join(dir, name);
  const channels = alpha ? 4 : 3;
  const background = alpha ? { r: 200, g: 40, b: 90, alpha: 0.5 } : { r: 200, g: 40, b: 90 };
  let img = sharp({ create: { width, height, channels, background } }).composite([
    { input: Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#ffd400"/></svg>`) },
  ]);
  img = format === 'png' ? img.png() : format === 'webp' ? img.webp() : img.jpeg();
  await img.toFile(file);
  return file;
}

/** Test video. ffmpeg writes the index ("moov") at the end by default, so it is not fast-start. */
export async function makeVideo(dir, name, { width = 720, height = 1280, seconds = 4, codec = 'libx264', audio = 'aac', fps = 30 } = {}) {
  const file = path.join(dir, name);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', codec, '-pix_fmt', 'yuv420p',
  ];
  if (codec === 'libx264') args.push('-preset', 'ultrafast');
  args.push('-c:a', audio, '-shortest', file);
  await execFileP('ffmpeg', args);
  return file;
}
