import fs from 'node:fs';
import path from 'node:path';

export const NO_PUBLIC_URL_HELP =
  'Instagram photo posts need a public web address for the photo (Instagram downloads it). ' +
  'Set PUBLIC_BASE_URL (when the app is online) or IMGBB_API_KEY in the .env file — see README, "Instagram photos". ' +
  'Instagram Reels and all Facebook posts work without it.';

/**
 * Makes a prepared Instagram photo reachable from the internet, using either this app's own
 * public address (PUBLIC_BASE_URL) or a temporary upload to imgbb.com (IMGBB_API_KEY).
 */
export function createPublicUrlProvider(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const mode = config.publicBaseUrl ? 'base_url' : config.imgbb.apiKey ? 'imgbb' : 'none';

  async function viaImgbb(filePath) {
    const url = new URL(`${config.imgbb.apiBase}/1/upload`);
    url.searchParams.set('key', config.imgbb.apiKey);
    url.searchParams.set('expiration', String(config.imgbb.expirationSeconds));
    const form = new FormData();
    form.set('image', await fs.openAsBlob(filePath, { type: 'image/jpeg' }), path.basename(filePath));
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
    } catch (err) {
      throw new Error(`Could not upload the photo to imgbb.com (${err?.cause?.code || err.message}).`);
    }
    const body = await res.json().catch(() => ({}));
    const link = body?.data?.image?.url || body?.data?.url;
    if (!res.ok || !body?.success || !link) {
      throw new Error(`imgbb.com did not accept the photo: ${body?.error?.message || `HTTP ${res.status}`}. Check IMGBB_API_KEY.`);
    }
    return link;
  }

  async function urlFor(filePath) {
    if (mode === 'base_url') return `${config.publicBaseUrl}/media/${encodeURIComponent(path.basename(filePath))}`;
    if (mode === 'imgbb') return viaImgbb(filePath);
    throw new Error(NO_PUBLIC_URL_HELP);
  }

  return { mode, urlFor };
}
