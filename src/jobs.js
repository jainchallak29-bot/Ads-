// Runs one "post" across all chosen destinations and tracks each destination's progress.

import { newId } from './store.js';
import { buildPostText } from '../public/shared/caption.js';
import { MEDIA_RULES } from '../public/shared/rules.js';
import { publishPagePhotos, publishPageVideo, publishPageReel } from './meta/facebook.js';
import { publishInstagramImages, publishInstagramReel } from './meta/instagram.js';
import { friendlyError, errorDetails } from './meta/errors.js';

const ACTIVE = new Set(['queued', 'preparing', 'uploading', 'processing', 'publishing']);
const LIVE_JOB_TTL_MS = 24 * 3600 * 1000;

function jobStatus(job, finished) {
  const auto = job.targets.filter((t) => t.type !== 'fb_group');
  if (!finished && auto.some((t) => ACTIVE.has(t.status))) return 'running';
  if (job.targets.some((t) => t.status === 'manual')) return 'needs_action';
  const failed = auto.filter((t) => t.status === 'failed').length;
  if (auto.length && failed === auto.length) return 'failed';
  return failed ? 'partial' : 'done';
}

export function createJobRunner({ store, media, graph, publicUrls, timing, log = () => {} }) {
  const live = new Map();

  async function persist(job) {
    const copy = structuredClone(job);
    await store.update((d) => {
      const i = d.history.findIndex((h) => h.id === job.id);
      if (i >= 0) d.history[i] = copy;
      else d.history.unshift(copy);
    });
  }

  function get(id) {
    return live.get(id) ?? store.data.history.find((h) => h.id === id) ?? null;
  }

  /** Mark posts that were still running when the app stopped. */
  async function recoverInterrupted() {
    let changed = 0;
    await store.update((d) => {
      for (const job of d.history) {
        if (job.status !== 'running') continue;
        for (const t of job.targets) {
          if (ACTIVE.has(t.status)) {
            t.status = 'failed';
            t.message = 'Interrupted because the app was stopped. Check the Page/Instagram account before posting again — it may already be live.';
          }
        }
        job.status = jobStatus(job, true);
        changed += 1;
      }
    });
    return changed;
  }

  function pageFor(target) {
    const pages = store.data.pages ?? [];
    return target.type === 'ig' ? pages.find((p) => p.instagram?.id === target.accountId) : pages.find((p) => p.id === target.accountId);
  }

  async function runTarget(job, target, records) {
    const step = (status, message) => {
      target.status = status;
      target.message = message;
    };
    target.startedAt = new Date().toISOString();
    try {
      const page = pageFor(target);
      if (!page) throw new Error('This account is no longer connected. Open Settings and reconnect, then try again.');
      let result;
      if (target.type === 'fb_page') {
        if (target.format === 'photo') {
          step('preparing', 'Preparing photos…');
          const files = await Promise.all(records.map((r) => media.forFacebookPhoto(r)));
          result = await publishPagePhotos(graph, page, files, job.text, { onStep: step });
        } else {
          step('preparing', 'Preparing the video…');
          const file = await media.forVideo(records[0]);
          const publish = target.format === 'reel' ? publishPageReel : publishPageVideo;
          result = await publish(graph, page, file, job.text, { onStep: step, timing });
        }
      } else {
        const account = { id: page.instagram.id, username: page.instagram.username, token: page.accessToken };
        if (target.format === 'post') {
          step('preparing', 'Preparing photos for Instagram…');
          let files;
          if (records.length === 1) {
            files = [await media.forInstagramPhoto(records[0])];
          } else {
            // Instagram crops every carousel photo to the first one's shape, so pad them all to it.
            const { minRatio, maxRatio } = MEDIA_RULES.instagramImage;
            const ratio = Math.min(maxRatio, Math.max(minRatio, records[0].width / records[0].height));
            files = await Promise.all(records.map((r) => media.forInstagramPhoto(r, { targetRatio: ratio })));
          }
          const urls = [];
          for (const f of files) urls.push(await publicUrls.urlFor(f.path));
          result = await publishInstagramImages(graph, account, urls, job.text, { onStep: step, timing });
        } else {
          step('preparing', 'Preparing the video for Instagram…');
          const file = await media.forVideo(records[0]);
          result = await publishInstagramReel(graph, account, file, job.text, {
            onStep: step,
            timing,
            coverOffsetMs: job.options?.coverOffsetMs,
          });
        }
      }
      target.status = 'published';
      target.message = result.note || 'Published';
      target.url = result.url || null;
      target.remoteId = result.id || null;
    } catch (err) {
      target.status = 'failed';
      target.message = friendlyError(err);
      target.errorDetails = errorDetails(err);
      log(`[post ${job.id}] ${target.key} failed: ${err.message}${target.errorDetails ? ` ${JSON.stringify(target.errorDetails)}` : ''}`);
    } finally {
      target.finishedAt = new Date().toISOString();
      await persist(job).catch((e) => log(`Could not save history: ${e.message}`));
    }
  }

  async function run(job, records) {
    await Promise.all(job.targets.filter((t) => t.type !== 'fb_group').map((t) => runTarget(job, t, records)));
    job.status = jobStatus(job, true);
    job.finishedAt = new Date().toISOString();
    await persist(job);
  }

  /**
   * @param {object} input
   * @param {string} input.caption
   * @param {string[]} input.hashtags
   * @param {object[]} input.records media records (already validated)
   * @param {object[]} input.targets [{ key, type, accountId, name, format, groupUrl? }]
   */
  async function start({ caption, hashtags, records, targets, options = {} }) {
    const now = Date.now();
    for (const [id, j] of live) if (now - Date.parse(j.createdAt) > LIVE_JOB_TTL_MS) live.delete(id);

    const job = {
      id: newId(8),
      createdAt: new Date().toISOString(),
      status: 'running',
      caption,
      hashtags,
      text: buildPostText(caption, hashtags),
      options,
      media: records.map((r) => ({ id: r.id, kind: r.kind, name: r.name, width: r.width, height: r.height })),
      targets: targets.map((t) => ({
        key: t.key,
        type: t.type,
        accountId: t.accountId,
        name: t.name,
        format: t.format,
        status: t.type === 'fb_group' ? 'manual' : 'queued',
        message: t.type === 'fb_group' ? 'Waiting for you to post in the group.' : 'Waiting to start…',
        url: t.type === 'fb_group' ? t.groupUrl : null,
      })),
    };
    if (!job.targets.some((t) => t.type !== 'fb_group')) job.status = jobStatus(job, true);
    live.set(job.id, job);
    await persist(job);
    if (job.status === 'running') {
      run(job, records).catch((err) => log(`[post ${job.id}] crashed: ${err.stack || err}`));
    }
    return job;
  }

  /** Facebook Groups are posted by hand; the user ticks them off here. */
  async function setManualDone(jobId, key, done) {
    const job = get(jobId);
    const target = job?.targets.find((t) => t.key === key && t.type === 'fb_group');
    if (!target) return null;
    target.status = done ? 'done' : 'manual';
    target.message = done ? 'Marked as posted' : 'Waiting for you to post in the group.';
    target.finishedAt = done ? new Date().toISOString() : null;
    if (job.status !== 'running') job.status = jobStatus(job, true);
    await persist(job);
    return job;
  }

  return { start, get, setManualDone, recoverInterrupted };
}
