import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers/setup.js';

test('password protection', async () => {
  const t = await startTestApp({ env: { APP_PASSWORD: 'correct horse' } });
  try {
    const page = await fetch(`${t.base}/`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login.html');
    assert.equal((await fetch(`${t.base}/login.html`)).status, 200);
    assert.equal((await fetch(`${t.base}/healthz`)).status, 200);

    const locked = await t.api('GET', '/api/state');
    assert.equal(locked.status, 401);

    const wrong = await t.api('POST', '/api/login', { password: 'nope' });
    assert.equal(wrong.status, 401);
    const right = await t.api('POST', '/api/login', { password: 'correct horse' });
    assert.equal(right.status, 200);
    const open = await t.api('GET', '/api/state');
    assert.equal(open.status, 200);
    assert.equal(open.data.app.passwordProtected, true);

    t.setCookie('sp_session=9999999999.abc.forged');
    assert.equal((await t.api('GET', '/api/state')).status, 401);
  } finally {
    await t.close();
  }
});

test('too many wrong passwords are throttled', async () => {
  const t = await startTestApp({ env: { APP_PASSWORD: 'secret' } });
  try {
    for (let i = 0; i < 10; i++) await t.api('POST', '/api/login', { password: `bad${i}` });
    const res = await t.api('POST', '/api/login', { password: 'secret' });
    assert.equal(res.status, 429);
  } finally {
    await t.close();
  }
});

test('API writes need the app header (blocks cross-site requests)', async () => {
  const t = await startTestApp();
  try {
    const res = await fetch(`${t.base}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'x', url: 'https://www.facebook.com/groups/x' }),
    });
    assert.equal(res.status, 403);
  } finally {
    await t.close();
  }
});

test('local mode only answers to localhost (DNS-rebinding protection)', async () => {
  const t = await startTestApp({ publicUrl: false });
  try {
    const ok = await t.api('GET', '/api/state');
    assert.equal(ok.status, 200);
    // fetch() always sends the real host, so use http.request to fake a rebinding attack.
    const status = await new Promise((resolve, reject) => {
      const url = new URL(`${t.base}/api/state`);
      http
        .get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: 'attacker.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(status, 421);
  } finally {
    await t.close();
  }
});
