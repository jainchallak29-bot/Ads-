// Media rules shared by the browser UI (for instant feedback) and the server (for validation).

export const MEDIA_RULES = Object.freeze({
  maxImages: 10,
  // https://developers.facebook.com/docs/video-api/guides/reels-publishing (video specifications)
  facebookReel: { minSeconds: 3, maxSeconds: 90, minWidth: 540, minHeight: 960 },
  // https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media (reel specifications)
  instagramReel: { minSeconds: 3, maxSeconds: 15 * 60, maxBytes: 300 * 1024 * 1024 },
  instagramImage: { minRatio: 4 / 5, maxRatio: 1.91 },
});

export const FORMAT_LABELS = Object.freeze({
  photo: 'Photo post',
  video: 'Video post',
  reel: 'Reel',
  post: 'Feed post',
  assist: 'Assisted (you click Post)',
});

/**
 * Describe a selection of uploaded media.
 * @param {{kind: 'image'|'video'}[]} media
 * @returns {{kind: 'image'|'video'|null, error: string|null}}
 */
export function describeSelection(media) {
  const list = media ?? [];
  if (!list.length) return { kind: null, error: null };
  const videos = list.filter((m) => m.kind === 'video').length;
  if (videos > 0 && list.length > 1) {
    return { kind: 'video', error: 'Post one video at a time, or up to 10 photos (videos and photos cannot be mixed).' };
  }
  if (videos === 1) return { kind: 'video', error: null };
  if (list.length > MEDIA_RULES.maxImages) {
    return { kind: 'image', error: `You can post at most ${MEDIA_RULES.maxImages} photos at once.` };
  }
  return { kind: 'image', error: null };
}

/** Formats available per destination type for the selected media kind. */
export function formatsFor(destination, kind) {
  if (destination === 'fb_group') return ['assist'];
  if (kind === 'video') return destination === 'fb_page' ? ['reel', 'video'] : ['reel'];
  return destination === 'fb_page' ? ['photo'] : ['post'];
}

/** Facebook Reels must be 3–90 seconds; vertical videos make the best Reels. */
export function suggestFacebookVideoFormat(video) {
  return facebookReelProblems(video).length === 0 && isPortrait(video) ? 'reel' : 'video';
}

export function isPortrait(m) {
  return Boolean(m?.width && m?.height && m.height >= m.width);
}

export function facebookReelProblems(video) {
  const r = MEDIA_RULES.facebookReel;
  const problems = [];
  const d = video?.duration;
  if (typeof d === 'number' && d > 0 && (d < r.minSeconds || d > r.maxSeconds)) {
    problems.push(`Facebook Reels must be ${r.minSeconds}–${r.maxSeconds} seconds long (this video is ${formatSeconds(d)}). Choose "Video post" instead.`);
  }
  const short = Math.min(video?.width || 0, video?.height || 0);
  const long = Math.max(video?.width || 0, video?.height || 0);
  if (short && long && (short < r.minWidth || long < r.minHeight)) {
    problems.push(`Facebook Reels need at least ${r.minWidth}×${r.minHeight} pixels (this video is ${video.width}×${video.height}).`);
  }
  return problems;
}

export function instagramReelProblems(video) {
  const r = MEDIA_RULES.instagramReel;
  const problems = [];
  const d = video?.duration;
  if (typeof d === 'number' && d > 0 && (d < r.minSeconds || d > r.maxSeconds)) {
    problems.push(`Instagram Reels must be between ${r.minSeconds} seconds and 15 minutes long (this video is ${formatSeconds(d)}).`);
  }
  if (video?.size > r.maxBytes) {
    problems.push(`Instagram Reels can be at most 300 MB (this file is ${Math.round(video.size / 1048576)} MB).`);
  }
  return problems;
}

/** True when Instagram would need the photo padded to fit its 4:5 – 1.91:1 range. */
export function instagramNeedsPadding(image) {
  if (!image?.width || !image?.height) return false;
  const ratio = image.width / image.height;
  const { minRatio, maxRatio } = MEDIA_RULES.instagramImage;
  return ratio < minRatio - 0.005 || ratio > maxRatio + 0.005;
}

export function formatSeconds(total) {
  const s = Math.round(total);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
