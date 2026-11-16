import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth, type Auth, type Persistence } from 'firebase/auth';

// The React Native build of firebase/auth exports getReactNativePersistence, but
// the published TypeScript types only describe the browser build.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: typeof AsyncStorage): Persistence;
}

// On phones the sign-in must be stored in AsyncStorage, otherwise every app
// restart would create a new anonymous user and the phone would lose access
// to its projects.
export function makeAuth(app: FirebaseApp): Auth {
  return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
}
