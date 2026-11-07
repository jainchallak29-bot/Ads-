import { GraphError } from './graph.js';

const IG_FIELDS = 'instagram_business_account{id,username,name,profile_picture_url}';
const PAGE_FIELDS = `id,name,access_token,tasks,picture{url},${IG_FIELDS}`;
const POSTING_TASKS = ['CREATE_CONTENT', 'MANAGE'];

export function loginUrl(meta, { redirectUri, state }) {
  const url = new URL(`${meta.dialogBase}/${meta.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', meta.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  // Facebook Login for Business uses a configuration ID instead of a scope list.
  if (meta.loginConfigId) url.searchParams.set('config_id', meta.loginConfigId);
  else url.searchParams.set('scope', meta.scopes.join(','));
  return url.toString();
}

export async function exchangeCodeForToken(graph, meta, { code, redirectUri }) {
  const res = await graph.get('oauth/access_token', {
    client_id: meta.appId,
    client_secret: meta.appSecret,
    redirect_uri: redirectUri,
    code,
  });
  return { token: res.access_token, expiresIn: res.expires_in };
}

/** Exchange a short-lived user token (about 1–2 hours) for a long-lived one (about 60 days). */
export async function extendUserToken(graph, meta, token) {
  const res = await graph.get('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: meta.appId,
    client_secret: meta.appSecret,
    fb_exchange_token: token,
  });
  return { token: res.access_token, expiresIn: res.expires_in };
}

function normalizePage(raw, fallbackToken) {
  const ig = raw.instagram_business_account;
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : null;
  return {
    id: String(raw.id),
    name: raw.name || `Page ${raw.id}`,
    accessToken: raw.access_token || fallbackToken,
    tasks,
    canPost: tasks ? tasks.some((t) => POSTING_TASKS.includes(t)) : true,
    pictureUrl: raw.picture?.data?.url || null,
    instagram: ig?.id
      ? { id: String(ig.id), username: ig.username || null, name: ig.name || null, pictureUrl: ig.profile_picture_url || null }
      : null,
  };
}

/**
 * Find the Facebook Pages (and their linked Instagram professional accounts) a token can post to.
 * Works with a User token (normal case) or with a single Page token.
 */
export async function discoverAccounts(graph, token) {
  const me = await graph.get('me', { fields: 'id,name' }, token);
  let pages;
  try {
    pages = [];
    let after;
    for (let guard = 0; guard < 25; guard++) {
      const res = await graph.get('me/accounts', { fields: PAGE_FIELDS, limit: 100, after }, token);
      pages.push(...(res.data ?? []));
      after = res.paging?.next ? res.paging?.cursors?.after : undefined;
      if (!after) break;
    }
  } catch (err) {
    // A Page token has no "accounts" edge: "(#100) Tried accessing nonexisting field (accounts) on node type (Page)".
    if (err instanceof GraphError && err.code === 100) {
      const page = await graph.get('me', { fields: `id,name,picture{url},${IG_FIELDS}` }, token);
      return { kind: 'page', user: null, pages: [normalizePage(page, token)] };
    }
    throw err;
  }
  return { kind: 'user', user: { id: String(me.id), name: me.name }, pages: pages.map((p) => normalizePage(p, null)) };
}

/** Instagram's rolling 24-hour publishing quota (best effort; returns null if unavailable). */
export async function instagramQuota(graph, igId, token) {
  try {
    const res = await graph.get(`${igId}/content_publishing_limit`, { fields: 'quota_usage,config' }, token, { retries: 0 });
    const row = res.data?.[0];
    if (!row) return null;
    return { used: row.quota_usage ?? null, total: row.config?.quota_total ?? null };
  } catch {
    return null;
  }
}
