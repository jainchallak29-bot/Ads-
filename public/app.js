import { buildPostText, normalizeHashtags, analyzeText, instagramTextProblems, facebookTextProblems, LIMITS } from './shared/caption.js';
import {
  describeSelection,
  formatsFor,
  suggestFacebookVideoFormat,
  facebookReelProblems,
  instagramReelProblems,
  instagramNeedsPadding,
  isPortrait,
  formatSeconds,
  FORMAT_LABELS,
} from './shared/rules.js';

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
let seq = 0;
const nextLocalId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4000);
}

async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: { 'x-requested-with': 'social-poster' } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && data?.loginRequired) {
    location.href = '/login.html';
    throw new Error('Please log in.');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const canCopyImages = () => Boolean(window.ClipboardItem && navigator.clipboard?.write);

async function copyImage(url) {
  const png = (async () => {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  })();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

// ---------------------------------------------------------------- state
const DRAFT_KEY = 'social-poster-draft-v1';
const state = {
  server: null,
  media: [], // { localId, name, kind, status, progress, error, record, previewUrl }
  caption: '',
  hashtags: [],
  targets: {}, // key -> { on, format, auto }
  coverSeconds: '',
  job: null,
  jobTimer: null,
  history: [],
};

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        caption: state.caption,
        hashtags: state.hashtags,
        targets: state.targets,
        coverSeconds: state.coverSeconds,
        mediaIds: state.media.filter((m) => m.status === 'ready').map((m) => m.record.id),
      }),
    );
  } catch {
    // Private mode or storage disabled: drafts are just a convenience.
  }
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

const readyMedia = () => state.media.filter((m) => m.status === 'ready');
const selectionKind = () => describeSelection(readyMedia().map((m) => m.record)).kind;
const postText = () => buildPostText(state.caption, state.hashtags);

// ---------------------------------------------------------------- destinations
function destinations() {
  const s = state.server;
  if (!s) return [];
  const list = [];
  for (const p of s.pages) {
    list.push({ key: `fb_page:${p.id}`, type: 'fb_page', id: p.id, name: p.name, picture: p.pictureUrl, canPost: p.canPost });
  }
  const igPhotosBlocked = s.app.publicMediaMode === 'none' && selectionKind() === 'image';
  for (const p of s.pages) {
    if (!p.instagram) continue;
    const ig = p.instagram;
    list.push({
      key: `ig:${ig.id}`,
      type: 'ig',
      id: ig.id,
      name: ig.username ? `@${ig.username}` : ig.name || 'Instagram',
      picture: ig.pictureUrl,
      canPost: !igPhotosBlocked,
      blockedReason: igPhotosBlocked ? 'Photo posts need IMGBB_API_KEY or PUBLIC_BASE_URL (see README) — Reels work already' : null,
      quota: ig.quota,
      viaPage: p.name,
    });
  }
  for (const g of s.groups) list.push({ key: `fb_group:${g.id}`, type: 'fb_group', id: g.id, name: g.name, url: g.url, canPost: true });
  return list;
}

function ensureTargetDefaults() {
  const kind = selectionKind();
  const video = kind === 'video' ? readyMedia()[0].record : null;
  for (const d of destinations()) {
    const t = (state.targets[d.key] ||= { on: d.type !== 'fb_group' && (d.canPost || Boolean(d.blockedReason)), format: null, auto: true });
    const allowed = formatsFor(d.type, kind || 'image');
    if (d.type === 'fb_page' && video && (t.auto || !allowed.includes(t.format))) {
      t.format = suggestFacebookVideoFormat(video);
    } else if (!allowed.includes(t.format)) {
      t.format = allowed[0];
    }
  }
}

function chosenTargets() {
  const kind = selectionKind() || 'image';
  return destinations()
    .filter((d) => d.canPost && state.targets[d.key]?.on)
    .map((d) => {
      const allowed = formatsFor(d.type, kind);
      const f = state.targets[d.key].format;
      return { ...d, format: allowed.includes(f) ? f : allowed[0] };
    });
}

// ---------------------------------------------------------------- validation
/** Whether Instagram's copy of these photos will get blurred borders (same rule as the server). */
function instagramPadded(records) {
  if (records.length === 1) return instagramNeedsPadding(records[0]);
  const shape = (r) => Math.min(1.91, Math.max(0.8, r.width / r.height));
  const first = shape(records[0]);
  return records.some((r) => instagramNeedsPadding(r) || Math.abs(r.width / r.height - first) > 0.01);
}

function computeProblems() {
  const out = [];
  const add = (level, text) => {
    if (!out.some((p) => p.text === text)) out.push({ level, text });
  };
  const ready = readyMedia();
  if (state.media.some((m) => m.status === 'uploading')) add('block', 'Waiting for uploads to finish…');
  if (!ready.length && !state.media.some((m) => m.status === 'uploading')) add('block', 'Add a photo or a video.');
  const selection = describeSelection(ready.map((m) => m.record));
  if (selection.error) add('error', selection.error);
  const targets = chosenTargets();
  if (!targets.length) add('block', 'Choose at least one place to post.');
  const text = postText();
  const first = ready[0]?.record;
  for (const t of targets) {
    if (t.type === 'ig') {
      instagramTextProblems(text).forEach((p) => add('error', `Instagram: ${p}`));
      if (selection.kind === 'video') instagramReelProblems(first).forEach((p) => add('error', p));
      if (selection.kind === 'image' && instagramPadded(ready.map((m) => m.record))) {
        add(
          'info',
          ready.length > 1
            ? 'On Instagram every carousel photo takes the shape of the first one (between 4:5 and 1.91:1). Photos with a different shape get soft blurred borders, so nothing is cut off.'
            : 'Instagram only accepts photos between 4:5 and 1.91:1, so this photo gets soft blurred borders on Instagram — nothing is cut off.',
        );
      }
    }
    if (t.type === 'fb_page') {
      facebookTextProblems(text).forEach((p) => add('error', p));
      if (t.format === 'reel') {
        facebookReelProblems(first).forEach((p) => add('error', `${t.name}: ${p}`));
        if (first && first.width && !isPortrait(first)) add('warn', 'Reels look best as vertical (9:16) videos.');
      }
    }
  }
  if (targets.some((t) => t.type !== 'fb_group') && !text) add('warn', 'The post has no caption or hashtags.');
  return out;
}

// ---------------------------------------------------------------- rendering: header & banner
function renderHeader() {
  const s = state.server;
  const pill = $('#conn-pill');
  pill.hidden = !s;
  if (s) {
    const connected = Boolean(s.connection && s.pages.length);
    pill.className = `pill ${connected ? 'ok' : ''}`;
    const label = connected
      ? `Connected${s.connection.userName ? ` · ${s.connection.userName}` : ''}`
      : s.connection
        ? 'No Pages found'
        : 'Not connected';
    pill.innerHTML = `<span>${esc(label)}</span>`;
    pill.title = label;
  }
  $('#logout-btn').hidden = !s?.app.passwordProtected;

  const banner = $('#connect-banner');
  if (s && !s.pages.length) {
    banner.hidden = false;
    banner.innerHTML = `<strong>Connect your Facebook account to get started.</strong> Your Facebook Pages and the Instagram accounts linked to them will appear under “Where to post”. <a href="#settings">Open Settings →</a>`;
  } else {
    banner.hidden = true;
  }
}

// ---------------------------------------------------------------- rendering: media
function renderMedia() {
  const grid = $('#media-grid');
  const multi = state.media.length > 1;
  grid.innerHTML = state.media
    .map((m, i) => {
      const preview = m.previewUrl
        ? m.kind === 'video'
          ? `<video src="${esc(m.previewUrl)}" muted playsinline preload="metadata"></video>`
          : `<img src="${esc(m.previewUrl)}" alt="">`
        : '';
      const rec = m.record;
      const dims = rec?.width ? `${rec.width}×${rec.height}` : m.width ? `${m.width}×${m.height}` : '';
      const duration = rec?.duration || m.duration;
      const notes = [
        ...(m.error ? [`<div class="note bad">${esc(m.error)}</div>`] : []),
        ...(rec?.warnings ?? []).map((w) => `<div class="note warn">⚠ ${esc(w)}</div>`),
        ...(rec?.notes ?? []).map((n) => `<div class="note muted">${esc(n)}</div>`),
      ].join('');
      return `
        <div class="thumb" data-id="${esc(m.localId)}">
          <div class="frame">
            ${preview}
            ${multi && m.kind === 'image' ? `<span class="order">${i + 1}</span>` : ''}
            ${m.kind === 'video' && duration ? `<span class="badge">▶ ${esc(formatSeconds(duration))}</span>` : ''}
            <div class="actions">
              ${multi && i > 0 ? `<button class="icon-btn" data-action="left" title="Move earlier" aria-label="Move earlier">‹</button>` : ''}
              <button class="icon-btn" data-action="remove" title="Remove" aria-label="Remove">×</button>
            </div>
          </div>
          ${m.status === 'uploading' ? `<div class="bar"><span style="width:${Math.round(m.progress * 100)}%"></span></div>` : ''}
          <div class="meta" title="${esc(m.name)}">${esc(m.name)}${dims ? ` · ${dims}` : ''}${rec ? ` · ${fmtSize(rec.size)}` : ''}</div>
          ${notes}
        </div>`;
    })
    .join('');
  $('#video-options').hidden = selectionKind() !== 'video';
}

// ---------------------------------------------------------------- rendering: hashtags
function renderTags() {
  const box = $('#tag-box');
  box.querySelectorAll('.chip').forEach((c) => c.remove());
  const input = $('#tag-entry');
  for (const tag of state.hashtags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${esc(tag)}</span><button type="button" aria-label="Remove ${esc(tag)}" data-tag="${esc(tag)}">×</button>`;
    box.insertBefore(chip, input);
  }
  const sets = state.server?.hashtagSets ?? [];
  const select = $('#tagset-select');
  select.innerHTML =
    `<option value="">${sets.length ? 'Insert a saved set…' : 'No saved hashtag sets yet'}</option>` +
    sets.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.tags.length})</option>`).join('');
  select.disabled = !sets.length;
  $('#tags-clear').hidden = !state.hashtags.length;
  $('#tagset-save').disabled = !state.hashtags.length;
}

function addTags(raw) {
  const added = normalizeHashtags(raw);
  if (!added.length) return;
  state.hashtags = normalizeHashtags([...state.hashtags, ...added]);
  renderTags();
  renderSummary();
  saveDraft();
}

// ---------------------------------------------------------------- rendering: destinations
function renderTargets() {
  ensureTargetDefaults();
  const s = state.server;
  const el = $('#targets');
  if (!s) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    return;
  }
  const kind = selectionKind() || 'image';
  const ready = readyMedia();
  const all = destinations();
  const row = (d) => {
    const t = state.targets[d.key];
    const allowed = formatsFor(d.type, kind);
    let format = '';
    if (!d.canPost) {
      format = '';
    } else if (d.type === 'fb_page' && allowed.length > 1) {
      format = `<span class="segmented" role="group" aria-label="Post as">${allowed
        .map((f) => `<button type="button" data-format="${f}" data-key="${esc(d.key)}" aria-pressed="${t.format === f}">${esc(FORMAT_LABELS[f])}</button>`)
        .join('')}</span>`;
    } else if (d.type !== 'fb_group') {
      const label = d.type === 'ig' && kind === 'image' && ready.length > 1 ? 'Carousel' : d.type === 'fb_page' && ready.length > 1 ? 'Multi-photo post' : FORMAT_LABELS[allowed[0]];
      format = `<span class="format-label">${esc(label)}</span>`;
    }
    const platform = { fb_page: '<span class="platform fb">FB</span>', ig: '<span class="platform ig">IG</span>', fb_group: '<span class="platform grp">GROUP</span>' }[d.type];
    const avatar = d.picture ? `<img class="avatar" src="${esc(d.picture)}" alt="" referrerpolicy="no-referrer" data-fallback="hide">` : '';
    const sub = d.blockedReason
      ? esc(d.blockedReason)
      : d.type === 'ig'
        ? `via ${esc(d.viaPage)}${d.quota?.total ? ` · ${d.quota.used}/${d.quota.total} API posts in last 24h` : ''}`
        : d.type === 'fb_page' && !d.canPost
          ? 'You need the "Create content" permission on this Page'
          : d.type === 'fb_group'
            ? 'You click “Post” in the group — we prepare everything'
            : '';
    return `
      <div class="dest-row ${d.canPost ? '' : 'disabled'}">
        <input type="checkbox" id="t-${esc(d.key)}" data-key="${esc(d.key)}" ${t.on && d.canPost ? 'checked' : ''} ${d.canPost ? '' : 'disabled'}>
        <label class="who" for="t-${esc(d.key)}">${platform}${avatar}<span><span class="name">${esc(d.name)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span></label>
        ${format}
      </div>`;
  };
  const section = (title, items, empty, extra = '') => `
    <div class="dest-group">
      <div class="dest-title"><span>${title}</span>${extra}</div>
      ${items.length ? items.map(row).join('') : `<p class="dest-hint">${empty}</p>`}
    </div>`;
  const fb = all.filter((d) => d.type === 'fb_page');
  const ig = all.filter((d) => d.type === 'ig');
  const groups = all.filter((d) => d.type === 'fb_group');
  el.innerHTML =
    section('Facebook Pages', fb, s.connection ? 'No Pages found for this login.' : '<a href="#settings">Connect Facebook in Settings</a> to see your Pages.') +
    section('Instagram', ig, s.pages.length ? 'None of your Pages has a linked Instagram professional account.' : 'Instagram business/creator accounts linked to your Pages appear here.') +
    section(
      'Facebook Groups <span class="muted small">(assisted)</span>',
      groups,
      'Add the groups you post in under <a href="#settings">Settings</a>.',
      groups.length ? '<a href="#settings" class="small">Manage</a>' : '',
    );
}

// ---------------------------------------------------------------- rendering: preview, counters, problems
function highlight(text) {
  return esc(text).replace(/(^|[\s(])(#[\p{L}\p{N}\p{M}_]+)/gu, '$1<span class="tag">$2</span>');
}

function renderSummary() {
  const text = postText();
  $('#preview').innerHTML = text ? highlight(text) : '';
  const a = analyzeText(text);
  const igOn = chosenTargets().some((t) => t.type === 'ig');
  const over = (n, max) => (igOn && n > max ? 'over' : '');
  $('#counters').innerHTML = `
    <span class="${over(a.chars, LIMITS.instagramCaptionChars)}">${a.chars.toLocaleString()} ${igOn ? `/ ${LIMITS.instagramCaptionChars.toLocaleString()} ` : ''}characters</span>
    <span class="${over(a.hashtags, LIMITS.instagramHashtags)}">${a.hashtags} ${igOn ? `/ ${LIMITS.instagramHashtags} ` : ''}hashtags</span>
    ${a.mentions ? `<span class="${over(a.mentions, LIMITS.instagramMentions)}">${a.mentions} ${igOn ? `/ ${LIMITS.instagramMentions} ` : ''}@mentions</span>` : ''}`;

  const problems = computeProblems();
  $('#problems').innerHTML = problems
    .filter((p) => p.level !== 'block')
    .map((p) => `<div class="problem ${p.level === 'warn' ? 'warn' : p.level === 'info' ? 'info' : ''}">${esc(p.text)}</div>`)
    .join('');
  const blocking = problems.filter((p) => p.level === 'block' || p.level === 'error');
  const btn = $('#post-btn');
  btn.disabled = blocking.length > 0 || Boolean(state.job && state.job.status === 'running');
  const n = chosenTargets().length;
  btn.textContent = n ? `Post now to ${n} place${n === 1 ? '' : 's'}` : 'Post now';
  btn.title = blocking.map((p) => p.text).join('\n');
}

function renderCompose() {
  renderHeader();
  renderMedia();
  renderTags();
  renderTargets();
  renderSummary();
}

// ---------------------------------------------------------------- media upload
function readLocalMeta(file, kind) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const done = (meta) => resolve({ url, ...meta });
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    const timer = setTimeout(() => done({}), 10000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, duration: Number.isFinite(video.duration) ? video.duration : undefined });
    };
    video.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    video.src = url;
  });
}

function guessKind(file) {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name) ? 'video' : 'image';
}

function uploadFile(item, file, meta) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('meta', JSON.stringify({ width: meta.width, height: meta.height, duration: meta.duration }));
    form.append('file', file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.setRequestHeader('x-requested-with', 'social-poster');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      item.progress = e.loaded / e.total;
      const bar = document.querySelector(`.thumb[data-id="${item.localId}"] .bar > span`);
      if (bar) bar.style.width = `${Math.round(item.progress * 100)}%`;
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status === 401) location.href = '/login.html';
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error || `Upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check that the app is still running.'));
    xhr.send(form);
  });
}

async function addFiles(fileList) {
  for (const file of [...fileList]) {
    const kind = guessKind(file);
    const current = state.media.filter((m) => m.status !== 'error');
    const check = describeSelection([...current, { kind }]);
    if (check.error) {
      toast(check.error, 'error');
      continue;
    }
    const maxMb = state.server?.app.maxUploadMb ?? 1024;
    if (file.size > maxMb * 1048576) {
      toast(`${file.name} is larger than ${maxMb} MB.`, 'error');
      continue;
    }
    const item = { localId: nextLocalId(), name: file.name, kind, status: 'uploading', progress: 0 };
    state.media.push(item);
    const meta = await readLocalMeta(file, kind);
    Object.assign(item, { previewUrl: meta.url, width: meta.width, height: meta.height, duration: meta.duration });
    renderCompose();
    uploadFile(item, file, meta)
      .then((record) => {
        item.record = record;
        item.status = 'ready';
        item.kind = record.kind;
      })
      .catch((err) => {
        item.status = 'error';
        item.error = err.message;
      })
      .finally(() => {
        renderCompose();
        saveDraft();
      });
  }
}

function removeMedia(localId) {
  const i = state.media.findIndex((m) => m.localId === localId);
  if (i < 0) return;
  const [m] = state.media.splice(i, 1);
  if (m.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl);
  if (m.record) api(`/api/media/${m.record.id}`, { method: 'DELETE' }).catch(() => {});
  renderCompose();
  saveDraft();
}

// ---------------------------------------------------------------- posting & progress
const STATUS_LABELS = {
  queued: 'Queued',
  preparing: 'Preparing',
  uploading: 'Uploading',
  processing: 'Processing',
  publishing: 'Publishing',
  published: 'Published ✓',
  failed: 'Failed',
  manual: 'Your turn',
  done: 'Posted ✓',
};
const BUSY = new Set(['queued', 'preparing', 'uploading', 'processing', 'publishing']);

async function submitPost(onlyTargets) {
  const targets = onlyTargets ?? chosenTargets().map((t) => ({ type: t.type, id: t.id, format: t.format }));
  const body = {
    mediaIds: readyMedia().map((m) => m.record.id),
    caption: state.caption,
    hashtags: state.hashtags,
    coverSeconds: state.coverSeconds,
    targets,
  };
  const btn = $('#post-btn');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    state.job = await api('/api/posts', { method: 'POST', body });
    renderProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    pollJob();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    renderSummary();
  }
}

function pollJob() {
  clearTimeout(state.jobTimer);
  if (!state.job || state.job.status !== 'running') return;
  state.jobTimer = setTimeout(async () => {
    try {
      state.job = await api(`/api/posts/${state.job.id}`);
      renderProgress();
      if (state.job.status !== 'running') {
        const failed = state.job.targets.filter((t) => t.status === 'failed').length;
        if (state.job.status === 'needs_action') toast('Automatic posts finished. Now post in your groups below.', 'ok');
        else if (failed) toast(`${failed} destination${failed > 1 ? 's' : ''} failed — see details.`, 'error');
        else toast('All done! Your post is live.', 'ok');
        renderSummary();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    pollJob();
  }, 1500);
}

function targetLink(t) {
  if (!t.url || t.type === 'fb_group') return '';
  return `<a class="btn small" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">View ↗</a>`;
}

function assistBox(job, t) {
  const images = job.media.filter((m) => m.kind === 'image');
  const video = job.media.find((m) => m.kind === 'video');
  const copyPhoto =
    images.length && canCopyImages()
      ? images.map((m, i) => `<button class="btn small" data-act="copy-image" data-media="${esc(m.id)}">Copy photo${images.length > 1 ? ` ${i + 1}` : ''}</button>`).join('')
      : '';
  const downloads = job.media
    .map((m, i) => `<a class="btn small ghost" href="/api/media/${esc(m.id)}/file?download=1" download>Download ${m.kind === 'video' ? 'video' : `photo${job.media.length > 1 ? ` ${i + 1}` : ''}`}</a>`)
    .join('');
  const done = t.status === 'done';
  return `
    <div class="assist">
      <ol>
        <li>Copy the text <div class="row gap wrap"><button class="btn small" data-act="copy-text">Copy text</button></div></li>
        <li>${video ? 'Have the video ready' : 'Copy or download the photo'} <div class="row gap wrap">${copyPhoto}${downloads}</div></li>
        <li>Open the group, click “Write something…”, paste the text${images.length && canCopyImages() ? ' and the photo' : ''}, attach any file you downloaded, then click Post.
          <div class="row gap wrap"><a class="btn small primary" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open group ↗</a></div></li>
        <li><div class="row gap wrap"><button class="btn small ${done ? 'done' : ''}" data-act="manual" data-key="${esc(t.key)}" data-done="${done ? '0' : '1'}">${done ? '✓ Posted (undo)' : 'Mark as posted'}</button></div></li>
      </ol>
    </div>`;
}

function renderProgress() {
  const job = state.job;
  const el = $('#progress');
  $('#composer').hidden = Boolean(job);
  if (!job) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const running = job.status === 'running';
  const title = {
    running: 'Posting…',
    needs_action: 'Almost done — finish the group posts',
    done: 'Posted successfully',
    partial: 'Posted, with some problems',
    failed: 'Posting failed',
  }[job.status];
  const failed = job.targets.filter((t) => t.status === 'failed');
  el.innerHTML = `
    <h2><span>${esc(title)}</span><span class="muted small">${esc(fmtDate(job.createdAt))}</span></h2>
    ${job.targets
      .map((t) => {
        const platform = { fb_page: '<span class="platform fb">FB</span>', ig: '<span class="platform ig">IG</span>', fb_group: '<span class="platform grp">GROUP</span>' }[t.type];
        return `
        <div class="target">
          ${platform}
          <div class="title">${esc(t.name)} <span class="muted small">· ${esc(FORMAT_LABELS[t.format] || t.format)}</span></div>
          <span class="status ${esc(t.status)} ${BUSY.has(t.status) ? 'busy' : ''}">${esc(STATUS_LABELS[t.status] || t.status)}</span>
          <div class="msg ${t.status === 'failed' ? 'bad' : ''}">${esc(t.message || '')} ${targetLink(t)}</div>
          ${t.type === 'fb_group' ? assistBox(job, t) : ''}
        </div>`;
      })
      .join('')}
    <div class="progress-actions">
      ${!running && failed.length ? `<button class="btn" data-act="retry">Retry failed (${failed.length})</button>` : ''}
      ${!running ? '<button class="btn primary" data-act="new-post">Create another post</button>' : ''}
      ${!running ? '<button class="btn ghost" data-act="close">Close</button>' : ''}
    </div>`;
}

function resetComposer() {
  for (const m of state.media) if (m.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl);
  state.media = [];
  state.caption = '';
  state.coverSeconds = '';
  state.job = null;
  $('#caption').value = '';
  $('#cover-seconds').value = '';
  for (const t of Object.values(state.targets)) t.auto = true;
  renderProgress();
  renderCompose();
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------- history
async function loadHistory() {
  try {
    state.history = await api('/api/history');
  } catch (err) {
    toast(err.message, 'error');
  }
  renderHistory();
}

function renderHistory() {
  const el = $('#history-list');
  if (!state.history.length) {
    el.innerHTML = '<div class="card empty">Nothing posted yet. Your posts will be listed here.</div>';
    return;
  }
  el.innerHTML = state.history
    .map((job) => {
      const thumbs = job.media
        .map((m) =>
          m.kind === 'image'
            ? `<img src="/api/media/${esc(m.id)}/file" alt="" loading="lazy" data-fallback="photo">`
            : '<div class="vid">▶ video</div>',
        )
        .join('');
      const targets = job.targets
        .map(
          (t) => `<li><span class="status ${esc(t.status)}">${esc(STATUS_LABELS[t.status] || t.status)}</span> <strong>${esc(t.name)}</strong>
            <span class="muted">${esc(FORMAT_LABELS[t.format] || '')}</span>
            ${t.url && t.type !== 'fb_group' ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">View ↗</a>` : ''}
            ${t.status === 'failed' ? `<span class="muted small">— ${esc(t.message)}</span>` : ''}</li>`,
        )
        .join('');
      return `
        <article class="card history-item">
          <div class="row between wrap gap"><span class="when">${esc(fmtDate(job.createdAt))}</span>
            <span class="row gap">
              ${job.status === 'needs_action' ? `<button class="btn small" data-act="open-job" data-id="${esc(job.id)}">Finish group posts</button>` : ''}
              <button class="btn small ghost" data-act="reuse" data-id="${esc(job.id)}">Use again</button>
            </span></div>
          <div class="text">${job.text ? highlight(job.text) : '<span class="muted">(no caption)</span>'}</div>
          <div class="thumbs">${thumbs}</div>
          <ul>${targets}</ul>
        </article>`;
    })
    .join('');
}

async function reuseJob(id) {
  const job = state.history.find((h) => h.id === id);
  if (!job) return;
  resetComposer();
  state.caption = job.caption || '';
  state.hashtags = job.hashtags || [];
  $('#caption').value = state.caption;
  for (const m of job.media) {
    try {
      const record = await api(`/api/media/${m.id}`);
      state.media.push({ localId: nextLocalId(), name: record.name, kind: record.kind, status: 'ready', progress: 1, record, previewUrl: record.url });
    } catch {
      toast(`"${m.name}" is no longer stored — please add it again.`, 'error');
    }
  }
  for (const t of job.targets) {
    if (state.targets[t.key]) state.targets[t.key] = { ...state.targets[t.key], on: true, format: t.format, auto: false };
  }
  for (const [key, t] of Object.entries(state.targets)) if (!job.targets.some((x) => x.key === key)) t.on = false;
  saveDraft();
  showTab('compose');
  renderCompose();
}

// ---------------------------------------------------------------- settings
function renderSettings() {
  const s = state.server;
  if (!s) return;
  const c = s.connection;
  const app = s.app;
  const expires = c?.tokenExpiresAt ? new Date(c.tokenExpiresAt) : null;
  const daysLeft = expires ? Math.round((expires - Date.now()) / 86400000) : null;
  const accounts = s.pages
    .map(
      (p) => `
      <div class="account">
        <span class="platform fb">FB</span>${p.pictureUrl ? `<img class="avatar" src="${esc(p.pictureUrl)}" alt="" referrerpolicy="no-referrer" data-fallback="hide">` : ''}
        <strong>${esc(p.name)}</strong>${p.canPost ? '' : ' <span class="muted small">(no posting permission)</span>'}
        ${p.instagram ? `<span class="muted">→</span><span class="platform ig">IG</span><strong>@${esc(p.instagram.username || p.instagram.name)}</strong>` : '<span class="muted small">no linked Instagram account</span>'}
      </div>`,
    )
    .join('');

  const oauthBox = app.oauthAvailable
    ? `<div class="connect-box">
        <h3>Connect with Facebook <span class="muted small">(recommended)</span></h3>
        <p class="muted small">Log in with Facebook and allow access to your Pages and Instagram accounts.</p>
        <a class="btn primary" href="/auth/facebook/start">Connect with Facebook</a>
        <p class="muted small">If Facebook says the URL is blocked, add this to <em>Facebook Login → Settings → Valid OAuth Redirect URIs</em> in your Meta app:<br><code>${esc(app.redirectUri)}</code></p>
      </div>`
    : `<div class="connect-box">
        <h3>Connect with Facebook</h3>
        <p class="muted small">To use the login button, put your Meta app’s <code>META_APP_ID</code> and <code>META_APP_SECRET</code> in the <code>.env</code> file and restart the app (see README, step 2).</p>
      </div>`;
  const tokenBox = `
    <div class="connect-box">
      <h3>Or paste an access token</h3>
      <ol>
        <li>Open the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer</a> and pick your app.</li>
        <li>Add the permissions <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>business_management</code>.</li>
        <li>Click <em>Generate Access Token</em>, allow access, copy the token and paste it here.</li>
      </ol>
      <form id="token-form" class="row gap wrap">
        <textarea id="token-input" placeholder="EAAB…" autocomplete="off" spellcheck="false" required></textarea>
        <button class="btn" type="submit">Connect with token</button>
      </form>
      ${app.canExtendTokens ? '' : '<p class="muted small">Tip: with META_APP_ID and META_APP_SECRET set, pasted tokens are automatically extended to ~60 days.</p>'}
    </div>`;

  $('#connection-card').innerHTML = `
    <h2>Facebook &amp; Instagram connection</h2>
    ${
      c
        ? `<p>Connected${c.userName ? ` as <strong>${esc(c.userName)}</strong>` : ''} ${c.method === 'oauth' ? 'with Facebook Login' : 'with an access token'}.
           ${c.method === 'token' && c.kind === 'user' && !c.tokenExtended ? '<strong>This token could not be extended and may stop working within hours.</strong> Set META_APP_ID and META_APP_SECRET, restart, and connect again for a ~60-day login. ' : ''}
           ${c.kind === 'page' ? 'Using a Page token.' : expires ? `Login valid until <strong>${esc(expires.toLocaleDateString())}</strong>${daysLeft !== null && daysLeft < 10 ? ' — <strong>reconnect soon</strong>' : ''}. Page posting keeps working after that as long as you don’t change your Facebook password or remove the app.` : ''}</p>
           <div class="account-list">${accounts || '<p class="muted">No Pages found. Reconnect and make sure you select your Pages.</p>'}</div>
           <div class="row gap wrap" style="margin-top:1rem">
             <button class="btn" data-act="refresh">Refresh accounts</button>
             <button class="btn danger ghost" data-act="disconnect">Disconnect</button>
           </div>`
        : '<p class="muted">Not connected yet. Choose one of the options below.</p>'
    }
    ${
      c
        ? `<details class="reconnect"><summary>Reconnect or use a different account</summary><div class="connect-options">${oauthBox}${tokenBox}</div></details>`
        : `<div class="connect-options">${oauthBox}${tokenBox}</div>`
    }`;

  $('#group-list').innerHTML = s.groups.length
    ? s.groups
        .map(
          (g) => `<li><span class="platform grp">GROUP</span><span class="grow"><strong>${esc(g.name)}</strong><br><a class="small" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.url)}</a></span>
            <button class="btn small ghost danger" data-act="delete-group" data-id="${esc(g.id)}">Remove</button></li>`,
        )
        .join('')
    : '<li class="muted">No groups saved yet.</li>';

  $('#tagset-list').innerHTML = s.hashtagSets.length
    ? s.hashtagSets
        .map(
          (t) => `<li><span class="grow"><strong>${esc(t.name)}</strong><br><span class="muted small">${esc(t.tags.join(' '))}</span></span>
            <button class="btn small ghost danger" data-act="delete-tagset" data-id="${esc(t.id)}">Delete</button></li>`,
        )
        .join('')
    : '<li class="muted">No saved sets yet.</li>';

  const mediaMode = {
    base_url: `Served by this app at <code>${esc(app.publicBaseUrl)}</code>`,
    imgbb: 'Temporary links on imgbb.com (deleted automatically after an hour)',
    none: 'Not set up — Instagram photo posts are disabled. Set <code>PUBLIC_BASE_URL</code> or <code>IMGBB_API_KEY</code> (see README). Reels work without it.',
  }[app.publicMediaMode];
  $('#system-card').innerHTML = `
    <h2>App status</h2>
    <dl class="kv">
      <dt>Instagram photo hosting</dt><dd>${mediaMode}</dd>
      <dt>Video conversion (ffmpeg)</dt><dd>${app.ffmpeg ? 'Installed — videos are fixed automatically for Instagram/Reels when needed' : 'Not installed (optional). Install ffmpeg so videos with unusual formats are converted automatically.'}</dd>
      <dt>Meta Graph API</dt><dd>${esc(app.graphVersion)}</dd>
      <dt>Max upload size</dt><dd>${esc(app.maxUploadMb)} MB</dd>
      <dt>Password protection</dt><dd>${app.passwordProtected ? 'On' : 'Off (fine while the app only runs on your computer)'}</dd>
    </dl>`;
}

// ---------------------------------------------------------------- tabs
function showTab(name) {
  const tab = ['compose', 'history', 'settings'].includes(name) ? name : 'compose';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const id of ['compose', 'history', 'settings']) $(`#tab-${id}`).hidden = id !== tab;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `${location.pathname}#${tab}`);
  if (tab === 'history') loadHistory();
  if (tab === 'settings') renderSettings();
}

// ---------------------------------------------------------------- data loading
async function loadState() {
  state.server = await api('/api/state');
  renderCompose();
  renderSettings();
}

async function restoreDraft() {
  const draft = loadDraft();
  if (!draft) return;
  state.caption = draft.caption || '';
  state.hashtags = normalizeHashtags(draft.hashtags || []);
  state.targets = draft.targets || {};
  state.coverSeconds = draft.coverSeconds || '';
  $('#caption').value = state.caption;
  $('#cover-seconds').value = state.coverSeconds;
  for (const id of draft.mediaIds || []) {
    try {
      const record = await api(`/api/media/${id}`);
      state.media.push({ localId: nextLocalId(), name: record.name, kind: record.kind, status: 'ready', progress: 1, record, previewUrl: record.url });
    } catch {
      // The upload was cleaned up; just drop it from the draft.
    }
  }
}

// ---------------------------------------------------------------- events
function bindEvents() {
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login.html';
  });

  // media
  const input = $('#file-input');
  const drop = $('#dropzone');
  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('dragging');
    });
  }
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  $('#media-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.thumb').dataset.id;
    if (btn.dataset.action === 'remove') removeMedia(id);
    if (btn.dataset.action === 'left') {
      const i = state.media.findIndex((m) => m.localId === id);
      if (i > 0) [state.media[i - 1], state.media[i]] = [state.media[i], state.media[i - 1]];
      renderCompose();
      saveDraft();
    }
  });

  // caption
  $('#caption').addEventListener('input', (e) => {
    state.caption = e.target.value;
    renderSummary();
    saveDraft();
  });
  $('#cover-seconds').addEventListener('input', (e) => {
    state.coverSeconds = e.target.value;
    saveDraft();
  });

  // hashtags
  const entry = $('#tag-entry');
  const commit = () => {
    if (entry.value.trim()) addTags(entry.value);
    entry.value = '';
  };
  entry.addEventListener('keydown', (e) => {
    if ([' ', ',', 'Enter'].includes(e.key) || (e.key === 'Tab' && entry.value.trim())) {
      if (e.key === 'Tab' || entry.value.trim()) e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !entry.value && state.hashtags.length) {
      state.hashtags.pop();
      renderTags();
      renderSummary();
      saveDraft();
    }
  });
  entry.addEventListener('input', () => {
    // Mobile keyboards often don't fire keydown for space/comma.
    if (/[\s,;]/.test(entry.value)) commit();
  });
  entry.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text');
    if (text) {
      e.preventDefault();
      addTags(`${entry.value} ${text}`);
      entry.value = '';
    }
  });
  entry.addEventListener('blur', commit);
  $('#tag-box').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tag]');
    if (btn) {
      state.hashtags = state.hashtags.filter((t) => t !== btn.dataset.tag);
      renderTags();
      renderSummary();
      saveDraft();
    } else {
      entry.focus();
    }
  });
  $('#tagset-select').addEventListener('change', (e) => {
    const set = state.server.hashtagSets.find((s) => s.id === e.target.value);
    if (set) addTags(set.tags);
    e.target.value = '';
  });
  $('#tagset-save').addEventListener('click', async () => {
    const name = prompt('Name for this hashtag set (e.g. "Summer sale"):');
    if (!name?.trim()) return;
    try {
      await api('/api/hashtag-sets', { method: 'POST', body: { name: name.trim(), tags: state.hashtags } });
      await loadState();
      toast(`Saved “${name.trim()}”.`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#tags-clear').addEventListener('click', () => {
    state.hashtags = [];
    renderTags();
    renderSummary();
    saveDraft();
  });

  // destinations
  $('#targets').addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"][data-key]');
    if (!box) return;
    state.targets[box.dataset.key].on = box.checked;
    renderSummary();
    saveDraft();
  });
  $('#targets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-format]');
    if (!btn) return;
    Object.assign(state.targets[btn.dataset.key], { format: btn.dataset.format, auto: false, on: true });
    renderTargets();
    renderSummary();
    saveDraft();
  });

  // post
  $('#post-btn').addEventListener('click', () => submitPost());
  $('#progress').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !state.job) return;
    const act = btn.dataset.act;
    if (act === 'copy-text') {
      toast((await copyText(state.job.text)) ? 'Text copied — paste it in the group.' : 'Could not copy. Select the text in the preview instead.', 'ok');
    } else if (act === 'copy-image') {
      try {
        await copyImage(`/api/media/${btn.dataset.media}/file`);
        toast('Photo copied — paste it into the group post (Ctrl+V / ⌘V).', 'ok');
      } catch {
        toast('Your browser could not copy the photo. Use Download instead.', 'error');
      }
    } else if (act === 'manual') {
      try {
        state.job = await api(`/api/posts/${state.job.id}/targets/${encodeURIComponent(btn.dataset.key)}/manual`, {
          method: 'POST',
          body: { done: btn.dataset.done === '1' },
        });
        renderProgress();
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (act === 'retry') {
      const failed = state.job.targets.filter((t) => t.status === 'failed').map((t) => ({ type: t.type, id: t.accountId, format: t.format }));
      const old = state.job;
      state.caption = old.caption;
      state.hashtags = old.hashtags;
      if (!readyMedia().length) {
        for (const m of old.media) {
          try {
            const record = await api(`/api/media/${m.id}`);
            state.media.push({ localId: nextLocalId(), name: record.name, kind: record.kind, status: 'ready', progress: 1, record, previewUrl: record.url });
          } catch {
            toast('The original file is no longer stored. Please add it again.', 'error');
            return;
          }
        }
      }
      submitPost(failed);
    } else if (act === 'new-post') {
      resetComposer();
    } else if (act === 'close') {
      state.job = null;
      renderProgress();
      renderSummary();
    }
  });

  // history
  $('#history-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'reuse') reuseJob(btn.dataset.id);
    if (btn.dataset.act === 'open-job') {
      try {
        state.job = await api(`/api/posts/${btn.dataset.id}`);
        showTab('compose');
        renderProgress();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
  $('#history-clear').addEventListener('click', async () => {
    if (!confirm('Clear the posting history? (Your posts on Facebook/Instagram are not affected.)')) return;
    await api('/api/history', { method: 'DELETE' }).catch((err) => toast(err.message, 'error'));
    loadHistory();
  });

  // settings
  $('#tab-settings').addEventListener('submit', async (e) => {
    if (e.target.id !== 'token-form') return;
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      state.server = await api('/api/connect/token', { method: 'POST', body: { token: $('#token-input').value } });
      toast(state.server.warning || 'Connected!', state.server.warning ? 'error' : 'ok');
      state.targets = {};
      renderCompose();
      renderSettings();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Connect with token';
    }
  });
  $('#tab-settings').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'refresh') {
        btn.disabled = true;
        state.server = await api('/api/connect/refresh', { method: 'POST' });
        toast('Accounts refreshed.', 'ok');
      } else if (act === 'disconnect') {
        if (!confirm('Disconnect Facebook and Instagram from this app?')) return;
        state.server = await api('/api/disconnect', { method: 'POST' });
        state.targets = {};
      } else if (act === 'delete-group') {
        await api(`/api/groups/${btn.dataset.id}`, { method: 'DELETE' });
        await loadState();
        return;
      } else if (act === 'delete-tagset') {
        await api(`/api/hashtag-sets/${btn.dataset.id}`, { method: 'DELETE' });
        await loadState();
        return;
      }
      renderCompose();
      renderSettings();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  $('#group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/groups', { method: 'POST', body: { name: $('#group-name').value, url: $('#group-url').value } });
      $('#group-name').value = '';
      $('#group-url').value = '';
      await loadState();
      toast('Group saved. It now appears under “Where to post”.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------- start
// Broken images (expired profile pictures, cleaned-up uploads). Inline onerror handlers are blocked by the CSP.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
    if (img.dataset.fallback === 'hide') {
      img.style.display = 'none';
    } else {
      const box = document.createElement('div');
      box.className = 'vid';
      box.textContent = img.dataset.fallback;
      img.replaceWith(box);
    }
  },
  true,
);

async function init() {
  bindEvents();
  const params = new URLSearchParams(location.search);
  const initialTab = params.get('tab') || location.hash.slice(1) || 'compose';
  if (params.get('connected')) toast('Facebook connected! Your Pages and Instagram accounts are ready.', 'ok');
  if (params.get('error')) toast(params.get('error'), 'error');
  if (location.search) history.replaceState(null, '', `${location.pathname}#${initialTab}`);
  try {
    await restoreDraft();
    await loadState();
  } catch (err) {
    toast(`Could not load the app: ${err.message}`, 'error');
  }
  showTab(initialTab);
}

init();
