import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backgroundErrors, getBackend, type Backend } from '@/lib/backend';
import { loadJoined, loadUserName, saveJoined, saveUserName } from '@/lib/device';
import type { JoinedProject } from '@/lib/types';

interface AppState {
  backend: Backend;
  uid: string | null;
  authError: string | null;
  retryAuth: () => void;
  loaded: boolean;
  userName: string;
  setUserName: (n: string) => Promise<void>;
  joined: JoinedProject[];
  rememberProject: (p: JoinedProject) => Promise<void>;
  forgetProject: (id: string) => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userName, setName] = useState('');
  const [joined, setJoined] = useState<JoinedProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const joinedRef = useRef<JoinedProject[]>([]);

  const toast = useCallback(
    (msg: string) => {
      setToastMsg(msg);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToastMsg(null));
      }, 3200);
    },
    [opacity],
  );

  const auth = useCallback(
    () =>
      backend.ready().then(
        (u) => {
          setUid(u);
          setAuthError(null);
        },
        (e: Error) => setAuthError(e.message),
      ),
    [backend],
  );

  useEffect(() => {
    auth();
    backgroundErrors.handler = (e) => toast(e.message);
    Promise.all([loadUserName(), loadJoined()]).then(([n, j]) => {
      setName(n);
      setJoined(j);
      joinedRef.current = j;
      setLoaded(true);
    });
  }, [auth, toast]);

  const setUserName = useCallback(async (n: string) => {
    await saveUserName(n);
    setName(n.trim());
  }, []);

  const rememberProject = useCallback(async (p: JoinedProject) => {
    const next = [p, ...joinedRef.current.filter((x) => x.id !== p.id)];
    joinedRef.current = next;
    setJoined(next);
    await saveJoined(next);
  }, []);

  const forgetProject = useCallback(async (id: string) => {
    const next = joinedRef.current.filter((x) => x.id !== id);
    joinedRef.current = next;
    setJoined(next);
    await saveJoined(next);
  }, []);

  const value = useMemo<AppState>(
    () => ({ backend, uid, authError, retryAuth: () => void auth(), loaded, userName, setUserName, joined, rememberProject, forgetProject, toast }),
    [backend, uid, authError, auth, loaded, userName, setUserName, joined, rememberProject, forgetProject, toast],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity, top: insets.top + 64 }]}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: 'rgba(27,31,36,0.92)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  toastText: { color: '#fff', fontSize: 14, textAlign: 'center' },
});
