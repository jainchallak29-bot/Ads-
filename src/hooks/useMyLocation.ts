import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface MyLocation {
  lat: number;
  lng: number;
  /** metres */
  accuracy: number;
}

/** Live GPS position while `on` is true. */
export function useMyLocation(on: boolean): { loc: MyLocation | null; error: string | null } {
  const [loc, setLoc] = useState<MyLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          if (alive) setError('Location permission was not given.');
          return;
        }
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 2000 }, (p) => {
          if (alive) setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 20 });
        });
      } catch (e) {
        if (alive) setError((e as Error).message || 'Location is not available.');
      }
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [on]);
  return { loc: on ? loc : null, error: on ? error : null };
}

/** One accurate reading (for the alignment points). */
export async function currentPosition(): Promise<MyLocation> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Location permission was not given.');
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 20 };
}
