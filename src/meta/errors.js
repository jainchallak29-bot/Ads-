import { GraphError } from './graph.js';

// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
const INSTAGRAM_SUBCODES = {
  2207001: 'Instagram had a temporary server problem. Please try again.',
  2207003: 'Instagram took too long to download the media. Please try again.',
  2207004: 'The image is too large for Instagram (maximum 8 MB).',
  2207005: 'Instagram does not support this image format (JPEG only).',
  2207006: 'Instagram could not find the uploaded media. Reconnect your account in Settings and try again.',
  2207008: 'Instagram had a temporary problem publishing. Please try again in a minute.',
  2207009: 'Instagram does not accept this image shape. Photos must be between 4:5 (portrait) and 1.91:1 (landscape).',
  2207010: 'The caption is too long for Instagram (maximum 2,200 characters, 30 hashtags and 20 @mentions).',
  2207020: 'The upload expired before it was published. Please try again.',
  2207026: 'Instagram does not support this video format. Use an MP4 file with H.264 video and AAC audio. (If ffmpeg is installed, this app converts videos automatically.)',
  2207027: 'Instagram is still processing the media. Please try again in a minute.',
  2207028: 'Instagram carousels need between 2 and 10 photos.',
  2207032: 'Instagram could not create the post. Please try again.',
  2207040: 'Too many @mentions for Instagram (maximum 20).',
  2207042: 'This Instagram account reached its daily limit of posts published through apps. Try again tomorrow.',
  2207050: 'This Instagram account is restricted or inactive. Open the Instagram app and resolve any notices there.',
  2207051: 'Instagram blocked this action because it looked like spam. Try again later, or post from the Instagram app.',
  2207052: 'Instagram could not download the photo from this app. Make sure PUBLIC_BASE_URL is a web address that works from the internet (see README).',
  2207053: 'Instagram had an unknown problem with the upload. Please try again.',
};

// https://developers.facebook.com/docs/video-api/guides/reels-publishing (error codes)
const FACEBOOK_VIDEO_CODES = {
  1363040: 'Facebook does not accept this video shape. Use a video between 16:9 (landscape) and 9:16 (vertical).',
  1363127: 'The video resolution is too low for a Facebook Reel (minimum 540×960).',
  1363128: 'Facebook Reels must be 3–90 seconds long. Post it as a regular "Video post" instead.',
  1363129: 'The video frame rate is not supported for a Facebook Reel (24–60 frames per second).',
};

/** Turn any error into one clear sentence for the person using the app. */
export function friendlyError(err) {
  if (!(err instanceof GraphError)) return err?.message || String(err);
  const { code, subcode } = err;
  if (INSTAGRAM_SUBCODES[subcode]) return INSTAGRAM_SUBCODES[subcode];
  if (FACEBOOK_VIDEO_CODES[code]) return FACEBOOK_VIDEO_CODES[code];
  if (FACEBOOK_VIDEO_CODES[subcode]) return FACEBOOK_VIDEO_CODES[subcode];
  if (code === 190) return 'Your Facebook connection expired or was revoked. Open Settings and connect again.';
  if (code === 10 || (code >= 200 && code < 300)) {
    return `Facebook says a permission is missing (${err.apiMessage || 'permission error'}). Open Settings, connect again and allow every permission and every Page/Instagram account.`;
  }
  if ([4, 17, 32, 613, 80001, 80002].includes(code)) return 'Facebook rate limit reached. Wait a while and try again.';
  if (code === 368) return 'Facebook temporarily blocked this action because it looked like spam. Try again later.';
  if (code === 100 && /does not exist|cannot be loaded due to missing permissions/i.test(err.apiMessage || '')) {
    return `Facebook could not find this Page/account with your current permissions. Open Settings and connect again. (${err.apiMessage})`;
  }
  return err.userMessage || err.apiMessage || err.message;
}

/** Technical details kept with failed posts to help with troubleshooting. */
export function errorDetails(err) {
  if (!(err instanceof GraphError)) return null;
  const d = { code: err.code, subcode: err.subcode, type: err.type, message: err.apiMessage, fbtraceId: err.fbtraceId };
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}
