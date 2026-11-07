import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const HISTORY_LIMIT = 200;

function emptyData() {
  return {
    version: 1,
    connection: null, // { method, user, userToken, userTokenExpiresAt, connectedAt }
    pages: [], // [{ id, name, accessToken, tasks, pictureUrl, instagram }]
    groups: [], // [{ id, name, url }]
    hashtagSets: [], // [{ id, name, tags }]
    history: [], // newest first
  };
}

/**
 * Tiny JSON-file database. All writes are serialized and atomic (write temp file, then rename),
 * so a crash never leaves a half-written store.json behind.
 */
export async function openStore(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'store.json');
  let data = emptyData();
  try {
    data = { ...emptyData(), ...JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const backup = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, backup).catch(() => {});
      console.warn(`[store] Could not read ${file} (${err.message}). Moved it to ${backup} and started fresh.`);
    }
  }

  let chain = Promise.resolve();
  async function persist() {
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  return {
    get data() {
      return data;
    },
    /** Apply `mutator` to the data and save. Resolves with the mutator's return value once saved. */
    update(mutator) {
      const result = mutator(data);
      if (Array.isArray(data.history) && data.history.length > HISTORY_LIMIT) {
        data.history.length = HISTORY_LIMIT;
      }
      chain = chain.then(persist, persist);
      return chain.then(() => result);
    },
    flush() {
      return chain.catch(() => {});
    },
  };
}

export function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}
