import fs from 'node:fs';
import crypto from 'node:crypto';

export class GraphError extends Error {
  /**
   * @param {string} message
   * @param {object} info status, code, subcode, type, userTitle, userMessage, apiMessage, fbtraceId, transient, network
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'GraphError';
    Object.assign(this, info);
  }
}

// Error codes Meta documents as temporary.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 341]);

function parseDebugMessage(message) {
  // rupload failures look like {"debug_info":{"message":"{\"success\":false,\"error\":{\"message\":\"...\"}}"}}
  try {
    const inner = JSON.parse(message);
    return inner?.error?.message || message;
  } catch {
    return message;
  }
}

export function toGraphError(status, body) {
  const e = body?.error;
  if (e && typeof e === 'object') {
    return new GraphError(e.error_user_msg || e.message || 'The Facebook API returned an error.', {
      status,
      code: e.code,
      subcode: e.error_subcode,
      type: e.type,
      userTitle: e.error_user_title,
      userMessage: e.error_user_msg,
      apiMessage: e.message,
      fbtraceId: e.fbtrace_id,
      transient: Boolean(e.is_transient) || TRANSIENT_CODES.has(e.code),
    });
  }
  if (body?.debug_info) {
    const message = parseDebugMessage(String(body.debug_info.message || 'Upload failed.'));
    return new GraphError(message, {
      status,
      type: body.debug_info.type,
      apiMessage: message,
      transient: Boolean(body.debug_info.retriable),
    });
  }
  if (body?.success === false) {
    return new GraphError('The upload was not accepted by Facebook.', { status });
  }
  return new GraphError(`The Facebook API answered with HTTP ${status}.`, { status });
}

function networkError(err, what) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new GraphError(`${what} timed out. Check your internet connection and try again.`, { network: true, transient: true });
  }
  const reason = err?.cause?.code || err?.cause?.message || err?.message || 'unknown error';
  return new GraphError(`Could not reach Facebook (${reason}). Check your internet connection and try again.`, {
    network: true,
    transient: true,
  });
}

function encodeValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Minimal client for the Meta Graph API (Facebook + Instagram).
 * Tokens are sent as `access_token` parameters (or `Authorization: OAuth` headers for binary uploads)
 * and are never logged.
 */
export function createGraphClient(meta, timing, { fetch: fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  const version = meta.graphVersion;
  const sleep = timing.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const endpoint = (base, path) => `${base}/${version}/${String(path).replace(/^\/+/, '')}`;

  function authParams(target, token) {
    if (!token) return;
    target.set('access_token', token);
    if (meta.appsecretProof && meta.appSecret) {
      target.set('appsecret_proof', crypto.createHmac('sha256', meta.appSecret).update(token).digest('hex'));
    }
  }

  async function parse(res) {
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!res.ok || body?.error || body?.debug_info || body?.success === false) throw toGraphError(res.status, body);
    return body;
  }

  async function send(method, url, init, what) {
    log(`${method} ${url.split('?')[0]}`);
    let res;
    try {
      res = await fetchImpl(url, { method, ...init });
    } catch (err) {
      throw networkError(err, what);
    }
    return parse(res);
  }

  async function call(method, path, params = {}, token, { base = meta.graphBase, timeoutMs, retries } = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') body.set(k, encodeValue(v));
    }
    authParams(body, token);
    let url = endpoint(base, path);
    const init = {};
    if (method === 'GET' || method === 'DELETE') {
      const qs = body.toString();
      if (qs) url += `?${qs}`;
    } else {
      init.body = body;
    }
    // Only reads are retried automatically; a retried POST could publish twice.
    const attempts = 1 + (retries ?? (method === 'GET' ? 2 : 0));
    for (let i = 1; ; i++) {
      try {
        return await send(method, url, { ...init, signal: AbortSignal.timeout(timeoutMs ?? timing.requestTimeoutMs) }, 'The request to Facebook');
      } catch (err) {
        if (i >= attempts || !(err instanceof GraphError) || !err.transient) throw err;
        await sleep(1000 * i * i);
      }
    }
  }

  /** multipart/form-data POST with a file read lazily from disk (videos can be large). */
  async function postMultipart(path, { fields = {}, file, fileField = 'source', token, base = meta.graphBase, timeoutMs } = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== '') form.set(k, encodeValue(v));
    }
    const auth = new URLSearchParams();
    authParams(auth, token);
    for (const [k, v] of auth) form.set(k, v);
    if (file) {
      const blob = await fs.openAsBlob(file.path, { type: file.mime || 'application/octet-stream' });
      form.set(fileField, blob, file.name || 'upload');
    }
    return send('POST', endpoint(base, path), { body: form, signal: AbortSignal.timeout(timeoutMs ?? timing.uploadTimeoutMs) }, 'The upload');
  }

  /** Raw binary upload used by rupload.facebook.com (Reels) and the Resumable Upload API. */
  async function uploadBinary(url, { token, filePath, headers = {}, timeoutMs } = {}) {
    const { size } = await fs.promises.stat(filePath);
    const blob = await fs.openAsBlob(filePath);
    return send(
      'POST',
      url,
      {
        headers: {
          Authorization: `OAuth ${token}`,
          offset: '0',
          file_size: String(size),
          'Content-Type': 'application/octet-stream',
          ...headers,
        },
        body: blob,
        signal: AbortSignal.timeout(timeoutMs ?? timing.uploadTimeoutMs),
      },
      'The upload',
    );
  }

  return {
    version,
    meta,
    endpoint,
    get: (path, params, token, opts) => call('GET', path, params, token, opts),
    post: (path, params, token, opts) => call('POST', path, params, token, opts),
    delete: (path, params, token, opts) => call('DELETE', path, params, token, opts),
    postMultipart,
    uploadBinary,
    ruploadUrl: (kind, id) => `${meta.ruploadBase}/${kind}/${version}/${id}`,
  };
}
