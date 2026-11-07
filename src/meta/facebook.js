// Publishing to a Facebook Page: photos, multi-photo posts, videos and Reels.
// Docs: https://developers.facebook.com/docs/pages-api/posts
//       https://developers.facebook.com/docs/video-api/guides/reels-publishing

export class PublishError extends Error {}

async function permalink(graph, objectId, token, fallback) {
  try {
    const res = await graph.get(objectId, { fields: 'permalink_url' }, token, { retries: 0 });
    const link = res.permalink_url;
    if (link) return link.startsWith('http') ? link : `https://www.facebook.com${link.startsWith('/') ? '' : '/'}${link}`;
  } catch {
    // The link is a nice-to-have; the post itself succeeded.
  }
  return fallback;
}

/**
 * One photo → a photo post. Several photos → uploaded unpublished, then attached to one feed post.
 * @param {{path: string, mime: string, name: string}[]} files
 */
export async function publishPagePhotos(graph, page, files, text, { onStep = () => {} } = {}) {
  const token = page.accessToken;
  if (files.length === 1) {
    onStep('uploading', 'Uploading photo to Facebook…');
    const res = await graph.postMultipart(`${page.id}/photos`, {
      token,
      fields: { caption: text, published: true },
      file: files[0],
    });
    const postId = res.post_id || res.id;
    return { id: postId, url: await permalink(graph, postId, token, `https://www.facebook.com/${postId}`) };
  }

  const photoIds = [];
  for (const [i, file] of files.entries()) {
    onStep('uploading', `Uploading photo ${i + 1} of ${files.length} to Facebook…`);
    const res = await graph.postMultipart(`${page.id}/photos`, { token, fields: { published: false }, file });
    photoIds.push(res.id);
  }
  onStep('publishing', 'Creating the Facebook post…');
  const params = { message: text };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = { media_fbid: id };
  });
  const post = await graph.post(`${page.id}/feed`, params, token);
  return { id: post.id, url: await permalink(graph, post.id, token, `https://www.facebook.com/${post.id}`) };
}

/** Regular (non-Reel) video post. */
export async function publishPageVideo(graph, page, file, text, { onStep = () => {}, timing } = {}) {
  const token = page.accessToken;
  onStep('uploading', 'Uploading video to Facebook…');
  const res = await graph.postMultipart(`${page.id}/videos`, {
    base: graph.meta.graphVideoBase,
    token,
    fields: { description: text },
    file,
  });
  const videoId = res.id;
  onStep('processing', 'Facebook is processing the video…');
  const outcome = await waitForVideo(graph, videoId, token, timing, timing.facebookVideoTimeoutMs);
  const url = await permalink(graph, videoId, token, `https://www.facebook.com/${page.id}/videos/${videoId}`);
  return { id: videoId, url, note: outcome.note };
}

/** Facebook Reel: start an upload session, send the bytes to rupload.facebook.com, then publish. */
export async function publishPageReel(graph, page, file, text, { onStep = () => {}, timing } = {}) {
  const token = page.accessToken;
  onStep('uploading', 'Starting the Facebook Reel upload…');
  const start = await graph.post(`${page.id}/video_reels`, { upload_phase: 'start' }, token);
  const videoId = start.video_id;
  if (!videoId) throw new PublishError('Facebook did not return a video ID for the Reel upload.');

  onStep('uploading', 'Uploading the Reel video to Facebook…');
  await graph.uploadBinary(graph.ruploadUrl('video-upload', videoId), { token, filePath: file.path });

  onStep('publishing', 'Publishing the Reel…');
  await graph.post(
    `${page.id}/video_reels`,
    { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: text },
    token,
  );

  onStep('processing', 'Facebook is processing the Reel…');
  const outcome = await waitForVideo(graph, videoId, token, timing, timing.facebookVideoTimeoutMs);
  return { id: videoId, url: `https://www.facebook.com/reel/${videoId}`, note: outcome.note };
}

/**
 * Read the `status` object of a Facebook video and decide whether it is done, failed or still busy.
 * See "Get the Upload Status" in the Reels Publishing API docs.
 */
export function interpretVideoStatus(status) {
  const s = status ?? {};
  for (const phase of ['uploading_phase', 'processing_phase', 'publishing_phase']) {
    const p = s[phase];
    if (!p) continue;
    const message = p.error?.message || (Array.isArray(p.errors) && p.errors[0]?.message);
    if (p.status === 'error' || message) {
      return { state: 'error', message: message || `Facebook reported an error while ${phase.replace('_phase', '')}.` };
    }
  }
  const videoStatus = s.video_status;
  if (['error', 'upload_failed', 'expired'].includes(videoStatus)) {
    return { state: 'error', message: `Facebook reported the video as "${videoStatus.replace('_', ' ')}".` };
  }
  const pub = s.publishing_phase;
  if (pub && (pub.status === 'complete' || pub.status === 'completed' || pub.publish_status === 'published')) {
    return { state: 'done' };
  }
  if (!pub && videoStatus === 'ready') return { state: 'done' };
  return { state: 'pending' };
}

async function waitForVideo(graph, videoId, token, timing, timeoutMs) {
  const sleep = timing.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  let delay = Math.min(2000, timing.pollIntervalMs);
  for (;;) {
    let verdict = { state: 'pending' };
    try {
      const res = await graph.get(videoId, { fields: 'status' }, token);
      verdict = interpretVideoStatus(res.status);
    } catch (err) {
      // Status checks are best effort: the video was accepted, so a failing check must not fail the post.
      if (Date.now() > deadline) return { note: 'Facebook accepted the video. It may take a few minutes to appear on the Page.' };
      if (err?.code === 190) throw err;
    }
    if (verdict.state === 'error') throw new PublishError(verdict.message);
    if (verdict.state === 'done') return { note: null };
    if (Date.now() > deadline) {
      return { note: 'Facebook is still processing the video. It will appear on the Page in a few minutes.' };
    }
    await sleep(delay);
    delay = timing.pollIntervalMs;
  }
}
