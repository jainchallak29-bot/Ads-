// Firebase settings come from EXPO_PUBLIC_* variables in the .env file
// (see SETUP.md). Expo only inlines them when written out like this.

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** e.g. "localhost" or "192.168.1.5" to use the Firebase emulators during development. */
export const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '';

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/**
 * Base address of the web app for customer links. Defaults to Firebase Hosting's
 * free address for this Firebase project (https://<projectId>.web.app).
 */
export function shareBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_SHARE_URL ?? '';
  if (env) return env;
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) return window.location.origin;
  return firebaseConfig.projectId ? `https://${firebaseConfig.projectId}.web.app` : '';
}
