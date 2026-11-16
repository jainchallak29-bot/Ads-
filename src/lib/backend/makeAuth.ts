import type { FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

// Web: the default browser persistence (IndexedDB) is fine.
export function makeAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}
