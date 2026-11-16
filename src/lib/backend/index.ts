import { isFirebaseConfigured } from './config';
import { FirebaseBackend } from './firebaseBackend';
import { LocalBackend } from './localBackend';
import type { Backend } from './types';

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (!instance) instance = isFirebaseConfigured ? new FirebaseBackend() : new LocalBackend();
  return instance;
}

export { backgroundErrors } from './firebaseBackend';
export * from './types';
