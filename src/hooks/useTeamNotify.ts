import { useCallback, useEffect, useState } from 'react';

import { useApp } from '@/components/AppProvider';
import { getPushToken, sendPush } from '@/lib/notify';
import { features } from '@/lib/status';
import type { Member, Project } from '@/lib/types';

export type NotifyTarget = 'all' | 'admins' | { uid: string };

/**
 * Registers this phone for team notifications and returns a function that
 * notifies the other members (only when the Notifications feature is on).
 */
export function useTeamNotify(project: Project | null, membership: Member | null) {
  const { backend, uid } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const pid = project?.id;
  const enabled = !!project && features(project).notifications && backend.kind === 'firebase' && !!membership;

  useEffect(() => {
    if (!enabled || !pid) return;
    return backend.watchMembers(pid, setMembers, () => undefined);
  }, [backend, pid, enabled]);

  const myToken = membership?.pushToken;
  useEffect(() => {
    if (!enabled || !pid) return;
    let alive = true;
    getPushToken().then((t) => {
      if (alive && t && t !== myToken) backend.setMyNotifications(pid, { pushToken: t }).catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, [backend, pid, enabled, myToken]);

  return useCallback(
    (target: NotifyTarget, title: string, body: string) => {
      if (!enabled || !pid) return;
      const to = members.filter(
        (m) => m.uid !== uid && m.notify !== false && !!m.pushToken && (target === 'all' ? true : target === 'admins' ? m.role === 'admin' : m.uid === target.uid),
      );
      sendPush(
        to.map((m) => m.pushToken!),
        title,
        body,
        { projectId: pid },
      );
    },
    [enabled, pid, members, uid],
  );
}
