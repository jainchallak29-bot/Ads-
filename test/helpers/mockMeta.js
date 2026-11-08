// A small fake of the Meta Graph API, rupload.facebook.com and imgbb, used by the tests.
// It mimics the documented request/response shapes and records every call for assertions.

import http from 'node:http';

export const TOKENS = {
  shortUser: 'SHORT_USER_TOKEN_abcdefghijklmnop',
  longUser: 'LONG_USER_TOKEN_abcdefghijklmnopq',
  page1: 'PAGE_TOKEN_ONE_abcdefghijklmnopqrs',
  page2: 'PAGE_TOKEN_TWO_abcdefghijklmnopqrs',
};

export const PAGES = [
  {
    id: '1001',
    name: 'Test Shop',
    access_token: TOKENS.page1,
    tasks: ['ADVERTISE', 'ANALYZE', 'CREATE_CONTENT', 'MODERATE', 'MANAGE'],
    picture: { data: { url: 'https://example.com/p1.jpg' } },
    instagram_business_account: { id: '17841400000000001', username: 'testshop', name: 'Test Shop IG', profile_picture_url: 'https://example.com/ig.jpg' },
  },
  {
    id: '1002',
    name: 'Second Page',
    access_token: TOKENS.page2,
    tasks: ['ANALYZE'],
    picture: { data: { url: 'https://example.com/p2.jpg' } },
  },
];

const APP_SECRET = 'test-app-secret';

function graphError(res, status, { message, code, subcode, userMsg }) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'OAuthException', code, error_subcode: subcode, error_user_msg: userMsg, fbtrace_id: 'TRACE123' } }));
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function parseFields(req, raw) {
  const ct = req.headers['content-type'] || '';
  const fields = {};
  const files = {};
  if (ct.startsWith('application/x-www-form-urlencoded')) {
    for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) fields[k] = v;
  } else if (ct.startsWith('multipart/form-data')) {
    const form = await new Response(raw, { headers: { 'content-type': ct } }).formData();
    for (const [k, v] of form) {
      if (typeof v === 'string') fields[k] = v;
      else files[k] = { name: v.name, type: v.type, size: v.size, bytes: Buffer.from(await v.arrayBuffer()) };
    }
  }
  return { fields, files };
}

export async function startMockMeta(behavior = {}) {
  const calls = [];
  const containers = new Map(); // IG containers
  const videos = new Map(); // FB videos / reels
  const imgbbFiles = new Map();
  const fetchedImages = []; // what "Instagram" downloaded
  let n = 100;
  const nextId = (prefix) => `${prefix}${++n}`;

  const tokenKind = (t) => {
    if (behavior.expiredToken && t === behavior.expiredToken) return 'expired';
    if (t === TOKENS.shortUser || t === TOKENS.longUser) return 'user';
    const page = PAGES.find((p) => p.access_token === t);
    return page ? `page:${page.id}` : null;
  };

  let base;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://mock');
      const raw = await readBody(req);
      const { fields, files } = await parseFields(req, raw);
      const params = { ...Object.fromEntries(url.searchParams), ...fields };
      const [, host, ...rest] = url.pathname.split('/');
      const call = { method: req.method, host, path: `/${rest.join('/')}`, params, files, headers: req.headers, bodySize: raw.length };
      calls.push(call);

      // ---------- imgbb ----------
      if (host === 'imgbb') {
        if (call.path === '/1/upload' && req.method === 'POST') {
          if (params.key !== 'IMGBB_TEST_KEY') return json(res, { success: false, error: { message: 'Invalid API v1 key.' } }, 400);
          const name = `${nextId('img')}.jpg`;
          imgbbFiles.set(name, files.image.bytes);
          return json(res, { success: true, status: 200, data: { url: `${base}/imgbb/i/${name}`, image: { url: `${base}/imgbb/i/${name}` } } });
        }
        const m = /^\/i\/(.+)$/.exec(call.path);
        if (m && imgbbFiles.has(m[1])) {
          res.writeHead(200, { 'content-type': 'image/jpeg' });
          return res.end(imgbbFiles.get(m[1]));
        }
        return json(res, { error: 'not found' }, 404);
      }

      // ---------- rupload ----------
      if (host === 'rupload') {
        const m = /^\/(video-upload|ig-api-upload)\/(v[\d.]+)\/(.+)$/.exec(call.path);
        if (!m) return json(res, { debug_info: { retriable: false, type: 'NotFound', message: 'bad path' } }, 404);
        const token = String(req.headers.authorization || '').replace(/^OAuth /, '');
        const kind = tokenKind(token);
        if (!kind || kind === 'expired') {
          return json(res, { debug_info: { retriable: false, type: 'ProcessingFailedError', message: '{"success":false,"error":{"message":"unauthorized user request"}}' } }, 400);
        }
        if (req.headers.offset !== '0' || Number(req.headers.file_size) !== raw.length) {
          return json(res, { debug_info: { retriable: false, type: 'PartialRequestError', message: 'Partial request (did not match length of file)' } }, 400);
        }
        const id = m[3];
        if (m[1] === 'video-upload') {
          const v = videos.get(id);
          if (!v) return json(res, { debug_info: { retriable: false, type: 'NotFound', message: 'unknown video' } }, 400);
          v.uploadedBytes = raw.length;
          return json(res, { success: true });
        }
        const c = containers.get(id);
        if (!c) return json(res, { debug_info: { retriable: false, type: 'NotFound', message: 'unknown container' } }, 400);
        c.uploadedBytes = raw.length;
        return json(res, { success: true, message: 'Upload successful.' });
      }

      // ---------- graph / graph-video ----------
      const vm = /^\/(v[\d.]+)\/(.*)$/.exec(call.path);
      if (!vm) return graphError(res, 400, { message: 'Unknown path', code: 100 });
      const p = vm[2];
      const token = params.access_token;

      if (p === 'oauth/access_token') {
        if (params.client_secret !== APP_SECRET) return graphError(res, 400, { message: 'Error validating client secret.', code: 1 });
        if (params.grant_type === 'fb_exchange_token') {
          if (tokenKind(params.fb_exchange_token) !== 'user') return graphError(res, 400, { message: 'Invalid OAuth access token.', code: 190 });
          return json(res, { access_token: TOKENS.longUser, token_type: 'bearer', expires_in: 5183944 });
        }
        if (params.code === 'GOOD_CODE') return json(res, { access_token: TOKENS.shortUser, token_type: 'bearer', expires_in: 3600 });
        return graphError(res, 400, { message: 'Invalid verification code format.', code: 100 });
      }

      const kind = tokenKind(token);
      if (kind === 'expired') return graphError(res, 400, { message: 'Error validating access token: Session has expired.', code: 190, subcode: 463 });
      if (!kind) return graphError(res, 400, { message: 'Invalid OAuth access token - Cannot parse access token', code: 190 });

      if (p === 'me' && req.method === 'GET') {
        if (kind === 'user') return json(res, { id: '555', name: 'Test User' });
        const page = PAGES.find((x) => `page:${x.id}` === kind);
        const { access_token: _omit, tasks: _t, ...rest2 } = page;
        return json(res, rest2);
      }
      if (p === 'me/accounts') {
        if (kind !== 'user') return graphError(res, 400, { message: '(#100) Tried accessing nonexisting field (accounts) on node type (Page)', code: 100 });
        return json(res, { data: PAGES, paging: { cursors: { before: 'a', after: 'b' } } });
      }

      // Instagram endpoints
      let m;
      if ((m = /^(\d{17})\/content_publishing_limit$/.exec(p))) return json(res, { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] });
      if ((m = /^(\d{17})\/media$/.exec(p)) && req.method === 'POST') {
        const id = nextId('1790000000000');
        const c = { id, params, polls: 0, uploadedBytes: 0 };
        if (params.media_type === 'REELS') {
          if (params.upload_type !== 'resumable') return graphError(res, 400, { message: 'Expected resumable', code: 100 });
          containers.set(id, c);
          return json(res, { id, uri: `https://rupload.facebook.com/ig-api-upload/v27.0/${id}` });
        }
        if (params.media_type === 'CAROUSEL') {
          const kids = String(params.children || '').split(',').filter(Boolean);
          if (kids.length < 2 || kids.some((k) => !containers.has(k))) return graphError(res, 400, { message: 'Bad children', code: 100, subcode: 2207028 });
          containers.set(id, c);
          return json(res, { id });
        }
        if (!params.image_url) return graphError(res, 400, { message: 'image_url required', code: 100 });
        // Like Instagram: download the image right away.
        let ok = false;
        try {
          const r = await fetch(params.image_url);
          const buf = Buffer.from(await r.arrayBuffer());
          ok = r.ok && buf[0] === 0xff && buf[1] === 0xd8;
          fetchedImages.push({ url: params.image_url, status: r.status, bytes: buf });
        } catch {
          ok = false;
        }
        if (!ok) return graphError(res, 400, { message: `The media could not be fetched from this uri: ${params.image_url}`, code: 9004, subcode: 2207052 });
        containers.set(id, c);
        return json(res, { id });
      }
      if ((m = /^(\d{17})\/media_publish$/.exec(p)) && req.method === 'POST') {
        const c = containers.get(params.creation_id);
        if (!c) return graphError(res, 400, { message: 'Media builder does not exist', code: 24, subcode: 2207008 });
        if (c.params.media_type === 'REELS' && !c.uploadedBytes) return graphError(res, 400, { message: 'Media not ready', code: 9007, subcode: 2207027 });
        c.published = true;
        const mediaId = nextId('1800000000000');
        return json(res, { id: mediaId });
      }
      if (/^1790000000000\d+$/.test(p) && req.method === 'GET') {
        const c = containers.get(p);
        if (!c) return graphError(res, 400, { message: 'Unsupported get request', code: 100 });
        c.polls += 1;
        if (behavior.igContainerError && c.params.media_type !== 'CAROUSEL') {
          return json(res, { id: p, status_code: 'ERROR', status: `Error: Media upload has failed with error code ${behavior.igContainerError}` });
        }
        if (c.params.media_type === 'REELS' && !c.uploadedBytes) return json(res, { id: p, status_code: 'IN_PROGRESS', status: 'In Progress' });
        return json(res, { id: p, status_code: c.polls >= 2 ? 'FINISHED' : 'IN_PROGRESS', status: 'ok' });
      }
      if (/^1800000000000\d+$/.test(p) && req.method === 'GET') return json(res, { id: p, permalink: `https://www.instagram.com/p/${p}/` });

      // Facebook Page endpoints
      if ((m = /^(\d{4})\/photos$/.exec(p)) && req.method === 'POST') {
        if (kind !== `page:${m[1]}`) return graphError(res, 403, { message: '(#200) Requires pages_manage_posts permission', code: 200 });
        if (!files.source) return graphError(res, 400, { message: 'No photo', code: 324 });
        const id = nextId('photo');
        return json(res, params.published === 'false' ? { id } : { id, post_id: `${m[1]}_${id}` });
      }
      if ((m = /^(\d{4})\/feed$/.exec(p)) && req.method === 'POST') {
        if (kind !== `page:${m[1]}`) return graphError(res, 403, { message: '(#200) Requires pages_manage_posts permission', code: 200 });
        return json(res, { id: `${m[1]}_${nextId('post')}` });
      }
      if ((m = /^(\d{4})\/videos$/.exec(p)) && req.method === 'POST') {
        if (host !== 'video') return graphError(res, 400, { message: 'Use graph-video host', code: 100 });
        if (!files.source) return graphError(res, 400, { message: 'No video', code: 100 });
        const id = nextId('vid');
        videos.set(id, { id, polls: 0, uploadedBytes: files.source.size, params });
        return json(res, { id });
      }
      if ((m = /^(\d{4})\/video_reels$/.exec(p)) && req.method === 'POST') {
        if (params.upload_phase === 'start') {
          const id = nextId('reel');
          videos.set(id, { id, polls: 0, uploadedBytes: 0, reel: true });
          return json(res, { video_id: id, upload_url: `https://rupload.facebook.com/video-upload/${id}` });
        }
        if (params.upload_phase === 'finish') {
          const v = videos.get(params.video_id);
          if (!v || !v.uploadedBytes) return graphError(res, 400, { message: 'Video not uploaded', code: 100 });
          if (behavior.reelDurationError) return graphError(res, 400, { message: 'The video you tried to upload has a duration that isn\'t supported', code: 1363128 });
          v.finishParams = params;
          return json(res, { success: true });
        }
        return graphError(res, 400, { message: '(#100) Missing parameter: upload_phase', code: 100 });
      }
      if (/^(vid|reel)\d+$/.test(p) && req.method === 'GET') {
        const v = videos.get(p);
        v.polls += 1;
        if (params.fields === 'permalink_url') return json(res, { permalink_url: `/1001/videos/${p}/`, id: p });
        const done = v.polls >= 2;
        return json(res, {
          id: p,
          status: {
            video_status: done ? 'ready' : 'processing',
            uploading_phase: { status: 'complete', bytes_transfered: v.uploadedBytes },
            processing_phase: { status: done ? 'complete' : 'in_progress' },
            publishing_phase: { status: done ? 'complete' : 'not_started', publish_status: done ? 'published' : undefined },
          },
        });
      }
      if (/^\d{4}_(photo|post)\d+$/.test(p) && req.method === 'GET') {
        return json(res, { id: p, permalink_url: `https://www.facebook.com/${p.replace('_', '/posts/')}` });
      }
      return graphError(res, 400, { message: `Unsupported ${req.method} request: ${p}`, code: 100 });
    } catch (err) {
      json(res, { error: { message: `mock crashed: ${err.stack}`, code: 1 } }, 500);
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    appSecret: APP_SECRET,
    calls,
    containers,
    videos,
    fetchedImages,
    behavior,
    graphBase: `${base}/graph`,
    graphVideoBase: `${base}/video`,
    ruploadBase: `${base}/rupload`,
    imgbbBase: `${base}/imgbb`,
    find: (pred) => calls.filter(pred),
    close: () => new Promise((r) => server.close(r)),
  };
}
