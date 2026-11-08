// Publishing to an Instagram professional account (via the Facebook Page it is linked to).
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
//       https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads

import { GraphError } from './graph.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Photo post (one image) or carousel (2–10 images).
 * Instagram downloads each photo from `imageUrls`, so they must be publicly reachable.
 */
export async function publishInstagramImages(graph, account, imageUrls, text, { onStep = () => {}, timing } = {}) {
  const { id: igId, token } = account;
  let creationId;
  if (imageUrls.length === 1) {
    onStep('uploading', 'Sending the photo to Instagram…');
    creationId = (await graph.post(`${igId}/media`, { image_url: imageUrls[0], caption: text }, token)).id;
  } else {
    const children = [];
    for (const [i, url] of imageUrls.entries()) {
      onStep('uploading', `Sending photo ${i + 1} of ${imageUrls.length} to Instagram…`);
      children.push((await graph.post(`${igId}/media`, { image_url: url, is_carousel_item: true }, token)).id);
    }
    onStep('processing', 'Instagram is preparing the photos…');
    for (const child of children) await waitForContainer(graph, child, token, timing);
    onStep('processing', 'Creating the carousel…');
    creationId = (await graph.post(`${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: text }, token)).id;
  }
  onStep('processing', 'Instagram is preparing the post…');
  await waitForContainer(graph, creationId, token, timing);
  return publishContainer(graph, account, creationId, { onStep, timing });
}

/** Reel uploaded straight from this computer with the resumable upload protocol (no public URL needed). */
export async function publishInstagramReel(graph, account, file, text, { onStep = () => {}, timing, coverOffsetMs } = {}) {
  const { id: igId, token } = account;
  onStep('uploading', 'Creating the Instagram Reel…');
  const params = { media_type: 'REELS', upload_type: 'resumable', caption: text };
  if (Number.isFinite(coverOffsetMs) && coverOffsetMs > 0) params.thumb_offset = Math.round(coverOffsetMs);
  const container = await graph.post(`${igId}/media`, params, token);

  onStep('uploading', 'Uploading the video to Instagram…');
  await graph.uploadBinary(graph.ruploadUrl('ig-api-upload', container.id), { token, filePath: file.path });

  onStep('processing', 'Instagram is processing the video (this can take a few minutes)…');
  await waitForContainer(graph, container.id, token, timing);
  return publishContainer(graph, account, container.id, { onStep, timing });
}

function containerError(res) {
  const status = String(res?.status ?? '');
  const sub = /\b(2207\d{3})\b/.exec(status);
  return new GraphError(status || 'Instagram could not process this media.', {
    subcode: sub ? Number(sub[1]) : undefined,
    apiMessage: status || undefined,
  });
}

/** Poll a media container until Instagram has finished processing it. */
export async function waitForContainer(graph, containerId, token, timing) {
  const sleep = timing.sleep ?? defaultSleep;
  const deadline = Date.now() + timing.instagramTimeoutMs;
  let delay = Math.min(2000, timing.pollIntervalMs);
  for (;;) {
    const res = await graph.get(containerId, { fields: 'status_code,status' }, token);
    if (res.status_code === 'FINISHED' || res.status_code === 'PUBLISHED') return res;
    if (res.status_code === 'ERROR') throw containerError(res);
    if (res.status_code === 'EXPIRED') throw new GraphError('The Instagram upload expired before it was published. Please try again.', { subcode: 2207020 });
    if (Date.now() > deadline) {
      throw new GraphError('Instagram is taking unusually long to process this media. Check the Instagram app in a few minutes before trying again.');
    }
    await sleep(delay);
    delay = timing.pollIntervalMs;
  }
}

async function publishContainer(graph, account, creationId, { onStep, timing }) {
  const sleep = timing.sleep ?? defaultSleep;
  onStep('publishing', 'Publishing on Instagram…');
  for (let attempt = 1; ; attempt++) {
    try {
      const { id } = await graph.post(`${account.id}/media_publish`, { creation_id: creationId }, account.token);
      let url = null;
      try {
        url = (await graph.get(id, { fields: 'permalink' }, account.token, { retries: 0 })).permalink || null;
      } catch {
        // The post is live; the link is only a convenience.
      }
      return { id, url: url || (account.username ? `https://www.instagram.com/${account.username}/` : null) };
    } catch (err) {
      // "Media not ready" / "temporary error": documented as safe to retry with the same container.
      const retryable = err instanceof GraphError && (err.subcode === 2207027 || err.subcode === 2207008);
      if (!retryable || attempt >= 5) throw err;
      await sleep(Math.max(timing.pollIntervalMs, 1000) * attempt);
    }
  }
}
