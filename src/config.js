import path from 'node:path';

// Permissions requested when you click "Connect with Facebook".
// Override with META_SCOPES if your Meta app is set up differently.
export const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
];

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function stripSlash(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function isLoopbackHost(host) {
  const h = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h.startsWith('127.');
}

export function loadConfig(env = process.env) {
  const port = int(env.PORT, 3000);
  const host = env.HOST || '127.0.0.1';

  // Public address of this app. Needed for Instagram *photo* posts, because Instagram downloads
  // photos from a public URL. Detected automatically on Render, Railway and Fly.io.
  let publicBaseUrl = stripSlash(env.PUBLIC_BASE_URL);
  if (!publicBaseUrl && env.RENDER_EXTERNAL_URL) publicBaseUrl = stripSlash(env.RENDER_EXTERNAL_URL);
  if (!publicBaseUrl && env.RAILWAY_PUBLIC_DOMAIN) publicBaseUrl = `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (!publicBaseUrl && env.FLY_APP_NAME) publicBaseUrl = `https://${env.FLY_APP_NAME}.fly.dev`;

  const dataDir = path.resolve(env.DATA_DIR || 'data');
  const version = String(env.META_GRAPH_VERSION || 'v27.0').trim();

  return {
    port,
    host,
    publicBaseUrl,
    // Used to build the Facebook Login redirect URL.
    appBaseUrl: publicBaseUrl || `http://localhost:${port}`,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    appPassword: env.APP_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    trustProxy: bool(env.TRUST_PROXY, Boolean(publicBaseUrl)),
    debug: bool(env.DEBUG),
    meta: {
      appId: (env.META_APP_ID || '').trim(),
      appSecret: (env.META_APP_SECRET || '').trim(),
      loginConfigId: (env.META_LOGIN_CONFIG_ID || '').trim(),
      scopes: (env.META_SCOPES ? env.META_SCOPES.split(',') : DEFAULT_SCOPES).map((s) => s.trim()).filter(Boolean),
      graphVersion: version.startsWith('v') ? version : `v${version}`,
      graphBase: stripSlash(env.META_GRAPH_BASE || 'https://graph.facebook.com'),
      graphVideoBase: stripSlash(env.META_GRAPH_VIDEO_BASE || 'https://graph-video.facebook.com'),
      ruploadBase: stripSlash(env.META_RUPLOAD_BASE || 'https://rupload.facebook.com'),
      dialogBase: stripSlash(env.META_DIALOG_BASE || 'https://www.facebook.com'),
      appsecretProof: bool(env.META_APPSECRET_PROOF),
    },
    imgbb: {
      apiKey: (env.IMGBB_API_KEY || '').trim(),
      apiBase: stripSlash(env.IMGBB_API_BASE || 'https://api.imgbb.com'),
      expirationSeconds: int(env.IMGBB_EXPIRATION_SECONDS, 3600),
    },
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 1024) * 1024 * 1024,
    mediaRetentionDays: int(env.MEDIA_RETENTION_DAYS, 7),
    timing: {
      pollIntervalMs: int(env.POLL_INTERVAL_MS, 5000),
      instagramTimeoutMs: int(env.IG_PROCESSING_TIMEOUT_MS, 15 * 60 * 1000),
      facebookVideoTimeoutMs: int(env.FB_VIDEO_TIMEOUT_MS, 10 * 60 * 1000),
      requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 2 * 60 * 1000),
      uploadTimeoutMs: int(env.UPLOAD_TIMEOUT_MS, 60 * 60 * 1000),
    },
  };
}
