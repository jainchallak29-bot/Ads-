import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { startTestApp, makeFixturesDir, makeImage, makeVideo, hasFfmpeg } from './helpers/setup.js';
import { TOKENS } from './helpers/mockMeta.js';

const FFMPEG = await hasFfmpeg();
const IG_ID = '17841400000000001';

describe('posting through the fake Meta API', () => {
  let t;
  let dir;
  let portrait;
  let square;
  let png;
  before(async () => {
    t = await startTestApp();
    dir = await makeFixturesDir();
    portrait = await makeImage(dir, 'portrait.jpg', { width: 1080, height: 1920 });
    square = await makeImage(dir, 'square.jpg', { width: 1200, height: 1200 });
    png = await makeImage(dir, 'logo.png', { width: 800, height: 400, format: 'png', alpha: true });
    const res = await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });
  after(async () => {
    await t.close();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  test('connecting with a user token finds Pages and the linked Instagram account', async () => {
    const { data } = await t.api('GET', '/api/state');
    assert.equal(data.connection.userName, 'Test User');
    assert.equal(data.connection.method, 'token');
    assert.ok(data.connection.tokenExpiresAt > Date.now() + 50 * 24 * 3600 * 1000, 'token was extended to ~60 days');
    assert.equal(data.pages.length, 2);
    assert.equal(data.pages[0].instagram.username, 'testshop');
    assert.deepEqual(data.pages[0].instagram.quota, { used: 3, total: 100 });
    assert.equal(data.pages[1].canPost, false, 'page without CREATE_CONTENT task cannot post');
    assert.equal(JSON.stringify(data).includes(TOKENS.page1), false, 'tokens never reach the browser');
    assert.equal(JSON.stringify(data).includes(TOKENS.longUser), false, 'tokens never reach the browser');
    const exchange = t.mock.find((c) => c.path.endsWith('oauth/access_token'));
    assert.equal(exchange[0].params.grant_type, 'fb_exchange_token');
  });

  test('one photo → Facebook photo post + Instagram post (padded to 4:5)', async () => {
    const up = await t.upload(portrait, {});
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.kind, 'image');
    assert.equal(up.data.width, 1080);
    assert.equal(up.data.height, 1920);

    const post = await t.api('POST', '/api/posts', {
      mediaIds: [up.data.id],
      caption: 'New arrivals are here!',
      hashtags: ['sale', '#Shoes'],
      targets: [
        { type: 'fb_page', id: '1001', format: 'photo' },
        { type: 'ig', id: IG_ID, format: 'post' },
      ],
    });
    assert.equal(post.status, 202, JSON.stringify(post.data));
    const job = await t.waitForJob(post.data.id);
    assert.equal(job.status, 'done', JSON.stringify(job.targets, null, 2));
    const expectedText = 'New arrivals are here!\n\n#sale #Shoes';
    assert.equal(job.text, expectedText);

    const fb = t.mock.find((c) => c.path === '/v27.0/1001/photos').at(-1);
    // multipart/form-data sends line breaks as CRLF (same as a browser form); Facebook treats both alike.
    assert.equal(fb.params.caption.replace(/\r\n/g, '\n'), expectedText);
    assert.equal(fb.params.published, 'true');
    assert.equal(fb.params.access_token, TOKENS.page1);
    assert.ok(fb.files.source.size > 1000);
    const fbTarget = job.targets.find((x) => x.type === 'fb_page');
    assert.match(fbTarget.url, /^https:\/\/www\.facebook\.com\//);

    const igCreate = t.mock.find((c) => c.path === `/v27.0/${IG_ID}/media` && c.params.image_url).at(-1);
    assert.equal(igCreate.params.caption, expectedText);
    assert.match(igCreate.params.image_url, new RegExp(`^${t.base}/media/[a-f0-9]{32}\\.ig\\.jpg$`));
    const fetched = t.mock.fetchedImages.at(-1);
    const meta = await sharp(fetched.bytes).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.ok(Math.abs(meta.width / meta.height - 0.8) < 0.01, `ratio ${meta.width}x${meta.height}`);
    assert.ok(meta.width <= 1440);
    const igTarget = job.targets.find((x) => x.type === 'ig');
    assert.equal(igTarget.status, 'published');
    assert.match(igTarget.url, /^https:\/\/www\.instagram\.com\/p\//);
    assert.ok(t.mock.find((c) => c.path === `/v27.0/${IG_ID}/media_publish`).length >= 1);
  });

  test('several photos → Facebook multi-photo post + Instagram carousel', async () => {
    const a = await t.upload(square);
    const b = await t.upload(png);
    assert.equal(b.data.format, 'png');
    const before = t.mock.calls.length;
    const post = await t.api('POST', '/api/posts', {
      mediaIds: [a.data.id, b.data.id],
      caption: 'Two looks',
      hashtags: 'style',
      targets: [
        { type: 'fb_page', id: '1001' },
        { type: 'ig', id: IG_ID },
      ],
    });
    assert.equal(post.status, 202, JSON.stringify(post.data));
    const job = await t.waitForJob(post.data.id);
    assert.equal(job.status, 'done', JSON.stringify(job.targets, null, 2));
    const calls = t.mock.calls.slice(before);

    const unpublished = calls.filter((c) => c.path === '/v27.0/1001/photos');
    assert.equal(unpublished.length, 2);
    assert.ok(unpublished.every((c) => c.params.published === 'false'));
    const feed = calls.find((c) => c.path === '/v27.0/1001/feed');
    assert.equal(feed.params.message, 'Two looks\n\n#style');
    assert.ok(JSON.parse(feed.params['attached_media[0]']).media_fbid);
    assert.ok(JSON.parse(feed.params['attached_media[1]']).media_fbid);

    const children = calls.filter((c) => c.path === `/v27.0/${IG_ID}/media` && c.params.is_carousel_item === 'true');
    assert.equal(children.length, 2);
    assert.ok(children.every((c) => !c.params.caption), 'carousel items have no caption');
    const carousel = calls.find((c) => c.params.media_type === 'CAROUSEL');
    assert.equal(carousel.params.caption, 'Two looks\n\n#style');
    assert.equal(carousel.params.children.split(',').length, 2);
    // Both carousel photos were padded to the first photo's (square) shape.
    for (const img of t.mock.fetchedImages.slice(-2)) {
      const m = await sharp(img.bytes).metadata();
      assert.ok(Math.abs(m.width / m.height - 1) < 0.01, `${m.width}x${m.height}`);
    }
  });

  test('vertical video → Facebook Reel + Instagram Reel via resumable upload', { skip: !FFMPEG && 'ffmpeg not installed' }, async () => {
    const video = await makeVideo(dir, 'clip.mp4', { width: 720, height: 1280, seconds: 4 });
    const up = await t.upload(video, { width: 720, height: 1280, duration: 4 });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.kind, 'video');
    assert.ok(Math.abs(up.data.duration - 4) < 0.2);
    assert.match(up.data.notes.join(' '), /fast start/, 'non-faststart video gets fixed');

    const before = t.mock.calls.length;
    const post = await t.api('POST', '/api/posts', {
      mediaIds: [up.data.id],
      caption: 'Watch this',
      hashtags: ['reels'],
      coverSeconds: 1.5,
      targets: [
        { type: 'fb_page', id: '1001', format: 'reel' },
        { type: 'ig', id: IG_ID, format: 'reel' },
      ],
    });
    assert.equal(post.status, 202, JSON.stringify(post.data));
    const job = await t.waitForJob(post.data.id);
    assert.equal(job.status, 'done', JSON.stringify(job.targets, null, 2));
    const calls = t.mock.calls.slice(before);

    const start = calls.find((c) => c.path === '/v27.0/1001/video_reels' && c.params.upload_phase === 'start');
    assert.ok(start);
    const fbUpload = calls.find((c) => c.host === 'rupload' && c.path.startsWith('/video-upload/v27.0/'));
    assert.equal(fbUpload.headers.authorization, `OAuth ${TOKENS.page1}`);
    assert.equal(fbUpload.headers.offset, '0');
    assert.equal(Number(fbUpload.headers.file_size), fbUpload.bodySize);
    const finish = calls.find((c) => c.path === '/v27.0/1001/video_reels' && c.params.upload_phase === 'finish');
    assert.equal(finish.params.video_state, 'PUBLISHED');
    assert.equal(finish.params.description, 'Watch this\n\n#reels');
    assert.match(job.targets[0].url, /facebook\.com\/reel\//);

    const igCreate = calls.find((c) => c.path === `/v27.0/${IG_ID}/media` && c.params.media_type === 'REELS');
    assert.equal(igCreate.params.upload_type, 'resumable');
    assert.equal(igCreate.params.caption, 'Watch this\n\n#reels');
    assert.equal(igCreate.params.thumb_offset, '1500');
    const igUpload = calls.find((c) => c.host === 'rupload' && c.path.startsWith('/ig-api-upload/v27.0/'));
    assert.equal(Number(igUpload.headers.file_size), igUpload.bodySize);
    // The uploaded file is the fast-start copy: its first box after ftyp is moov, not mdat.
    assert.equal(fbUpload.bodySize, igUpload.bodySize);
    assert.ok(calls.some((c) => c.path === `/v27.0/${IG_ID}/media_publish`));
    const files = await fsp.readdir(t.instance.media.dir);
    assert.ok(files.some((f) => f.endsWith('.prepared.mp4')), 'converted copy was created');
  });

  test('landscape video → regular Facebook video post', { skip: !FFMPEG && 'ffmpeg not installed' }, async () => {
    const video = await makeVideo(dir, 'wide.mp4', { width: 1280, height: 720, seconds: 3 });
    const up = await t.upload(video);
    const before = t.mock.calls.length;
    const post = await t.api('POST', '/api/posts', {
      mediaIds: [up.data.id],
      caption: 'Behind the scenes',
      hashtags: [],
      targets: [{ type: 'fb_page', id: '1001', format: 'video' }],
    });
    const job = await t.waitForJob(post.data.id);
    assert.equal(job.status, 'done', JSON.stringify(job.targets, null, 2));
    const call = t.mock.calls.slice(before).find((c) => c.host === 'video' && c.path === '/v27.0/1001/videos');
    assert.equal(call.params.description, 'Behind the scenes');
    assert.ok(call.files.source.size > 1000);
    assert.equal(job.targets[0].url, 'https://www.facebook.com/1001/videos/' + job.targets[0].remoteId + '/');
  });

  test('Facebook groups are tracked as assisted posts', async () => {
    const g = await t.api('POST', '/api/groups', { name: 'Local Deals', url: 'https://www.facebook.com/groups/localdeals' });
    assert.equal(g.status, 200, JSON.stringify(g.data));
    const bad = await t.api('POST', '/api/groups', { name: 'Evil', url: 'javascript:alert(1)' });
    assert.equal(bad.status, 400);
    const up = await t.upload(square);
    const post = await t.api('POST', '/api/posts', {
      mediaIds: [up.data.id],
      caption: 'Group post',
      hashtags: [],
      targets: [{ type: 'fb_group', id: g.data.id }],
    });
    assert.equal(post.status, 202);
    assert.equal(post.data.status, 'needs_action');
    assert.equal(post.data.targets[0].status, 'manual');
    assert.equal(post.data.targets[0].url, 'https://www.facebook.com/groups/localdeals');
    const key = encodeURIComponent(post.data.targets[0].key);
    const done = await t.api('POST', `/api/posts/${post.data.id}/targets/${key}/manual`, { done: true });
    assert.equal(done.data.status, 'done');
    assert.equal(done.data.targets[0].status, 'done');
    const history = await t.api('GET', '/api/history');
    assert.equal(history.data.find((h) => h.id === post.data.id).status, 'done');
  });

  test('validation stops posts Instagram would reject', async () => {
    const up = await t.upload(square);
    const tags = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    const res = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', hashtags: tags, targets: [{ type: 'ig', id: IG_ID }] });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /30 hashtags/);
    const none = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', hashtags: [], targets: [] });
    assert.match(none.data.error, /at least one place/);
    const noPerm = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', targets: [{ type: 'fb_page', id: '1002' }] });
    assert.match(noPerm.data.error, /permission/);
  });

  test('rejects files that are not photos or videos', async () => {
    const file = `${dir}/notes.txt`;
    await fsp.writeFile(file, 'hello world, this is not an image');
    const res = await t.upload(file);
    assert.equal(res.status, 400);
    assert.match(res.data.error, /Unsupported file/);
  });

  test('only prepared Instagram photos are public; originals need the app', async () => {
    const up = await t.upload(square);
    const original = await fetch(`${t.base}/media/${up.data.id}.jpg`);
    assert.equal(original.status, 404);
    const traversal = await fetch(`${t.base}/media/..%2Fstore.json`);
    assert.equal(traversal.status, 404);
    const viaApi = await t.api('GET', `/api/media/${up.data.id}/file`, undefined, { raw: true });
    assert.equal(viaApi.status, 200);
    assert.equal(viaApi.headers.get('content-type'), 'image/jpeg');
  });
});

describe('error handling', () => {
  test('Instagram processing errors become plain-language messages', { skip: !FFMPEG && 'ffmpeg not installed' }, async () => {
    const t = await startTestApp({ mockBehavior: { igContainerError: '2207026' } });
    const dir = await makeFixturesDir();
    try {
      await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
      const video = await makeVideo(dir, 'v.mp4', { seconds: 3 });
      const up = await t.upload(video);
      const post = await t.api('POST', '/api/posts', {
        mediaIds: [up.data.id],
        caption: 'Oops',
        targets: [
          { type: 'ig', id: IG_ID, format: 'reel' },
          { type: 'fb_page', id: '1001', format: 'reel' },
        ],
      });
      const job = await t.waitForJob(post.data.id);
      assert.equal(job.status, 'partial');
      const ig = job.targets.find((x) => x.type === 'ig');
      assert.equal(ig.status, 'failed');
      assert.match(ig.message, /does not support this video format/);
      assert.equal(ig.errorDetails.subcode, 2207026);
      assert.equal(job.targets.find((x) => x.type === 'fb_page').status, 'published');
    } finally {
      await t.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('Facebook Reel duration errors are explained', { skip: !FFMPEG && 'ffmpeg not installed' }, async () => {
    const t = await startTestApp({ mockBehavior: { reelDurationError: true } });
    const dir = await makeFixturesDir();
    try {
      await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
      const up = await t.upload(await makeVideo(dir, 'v.mp4', { seconds: 3 }));
      const post = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', targets: [{ type: 'fb_page', id: '1001', format: 'reel' }] });
      const job = await t.waitForJob(post.data.id);
      assert.equal(job.status, 'failed');
      assert.match(job.targets[0].message, /3–90 seconds/);
    } finally {
      await t.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('expired connection is reported clearly', async () => {
    const t = await startTestApp({ mockBehavior: { expiredToken: TOKENS.page1 } });
    const dir = await makeFixturesDir();
    try {
      await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
      const up = await t.upload(await makeImage(dir, 'a.jpg', { width: 600, height: 600 }));
      const post = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', targets: [{ type: 'fb_page', id: '1001' }] });
      const job = await t.waitForJob(post.data.id);
      assert.match(job.targets[0].message, /expired or was revoked/);
    } finally {
      await t.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('other connection and hosting modes', () => {
  test('a Page token can be pasted directly', async () => {
    const t = await startTestApp({ env: { META_APP_ID: '', META_APP_SECRET: '' } });
    try {
      const res = await t.api('POST', '/api/connect/token', { token: TOKENS.page1 });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.connection.kind, 'page');
      assert.equal(res.data.pages.length, 1);
      assert.equal(res.data.pages[0].id, '1001');
      assert.equal(res.data.pages[0].instagram.id, IG_ID);
    } finally {
      await t.close();
    }
  });

  test('OAuth login flow (Connect with Facebook)', async () => {
    const t = await startTestApp();
    try {
      const start = await t.api('GET', '/auth/facebook/start', undefined, { raw: true });
      assert.equal(start.status, 302);
      const dialog = new URL(start.headers.get('location'));
      assert.equal(dialog.pathname, '/dialog/v27.0/dialog/oauth');
      assert.equal(dialog.searchParams.get('client_id'), '12345');
      assert.match(dialog.searchParams.get('scope'), /instagram_content_publish/);
      assert.equal(dialog.searchParams.get('redirect_uri'), `${t.base}/auth/facebook/callback`);
      const state = dialog.searchParams.get('state');

      const errorOf = (res) => new URLSearchParams(res.headers.get('location').split('?')[1]).get('error');
      const forged = await t.api('GET', `/auth/facebook/callback?code=GOOD_CODE&state=forged`, undefined, { raw: true });
      assert.match(errorOf(forged), /expired or was already used/);

      const cb = await t.api('GET', `/auth/facebook/callback?code=GOOD_CODE&state=${state}`, undefined, { raw: true });
      assert.equal(cb.status, 302);
      assert.match(cb.headers.get('location'), /connected=1/);
      const { data } = await t.api('GET', '/api/state');
      assert.equal(data.connection.method, 'oauth');
      assert.equal(data.pages.length, 2);
      const replay = await t.api('GET', `/auth/facebook/callback?code=GOOD_CODE&state=${state}`, undefined, { raw: true });
      assert.match(errorOf(replay), /expired or was already used/);
    } finally {
      await t.close();
    }
  });

  test('without a public URL, Instagram photos go through imgbb when a key is set', async () => {
    const t = await startTestApp({ publicUrl: false, env: { IMGBB_API_KEY: 'IMGBB_TEST_KEY' } });
    const dir = await makeFixturesDir();
    try {
      await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
      const state = await t.api('GET', '/api/state');
      assert.equal(state.data.app.publicMediaMode, 'imgbb');
      const up = await t.upload(await makeImage(dir, 'wide.webp', { width: 2000, height: 800, format: 'webp' }));
      const post = await t.api('POST', '/api/posts', {
        mediaIds: [up.data.id],
        caption: 'imgbb route',
        targets: [{ type: 'ig', id: IG_ID }, { type: 'fb_page', id: '1001' }],
      });
      const job = await t.waitForJob(post.data.id);
      assert.equal(job.status, 'done', JSON.stringify(job.targets, null, 2));
      const igCreate = t.mock.find((c) => c.params.image_url).at(-1);
      assert.match(igCreate.params.image_url, /\/imgbb\/i\//);
      const imgbbCall = t.mock.find((c) => c.host === 'imgbb' && c.path === '/1/upload')[0];
      assert.equal(imgbbCall.params.expiration, '3600');
      // Too-wide photo was padded to Instagram's 1.91:1 maximum.
      const m = await sharp(t.mock.fetchedImages.at(-1).bytes).metadata();
      assert.ok(Math.abs(m.width / m.height - 1.91) < 0.01, `${m.width}x${m.height}`);
      // WebP is converted to JPEG for Facebook too.
      const fb = t.mock.find((c) => c.path === '/v27.0/1001/photos').at(-1);
      assert.equal(fb.files.source.type, 'image/jpeg');
    } finally {
      await t.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  test('without any public URL option, Instagram photo posts are refused with help text', async () => {
    const t = await startTestApp({ publicUrl: false });
    const dir = await makeFixturesDir();
    try {
      await t.api('POST', '/api/connect/token', { token: TOKENS.shortUser });
      const up = await t.upload(await makeImage(dir, 'a.jpg', { width: 600, height: 600 }));
      const res = await t.api('POST', '/api/posts', { mediaIds: [up.data.id], caption: 'x', targets: [{ type: 'ig', id: IG_ID }] });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /PUBLIC_BASE_URL|IMGBB_API_KEY/);
    } finally {
      await t.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
