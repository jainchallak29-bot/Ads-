import { useEffect, useMemo, useState } from 'react';

import { useApp } from '@/components/AppProvider';
import { comparePlotNumbers } from '@/lib/cad/detect';
import type { LayoutData, Member, Plot, Project } from '@/lib/types';

export interface ProjectData {
  project: Project | null;
  plots: Plot[];
  layout: LayoutData | null;
  membership: Member | null;
  loading: boolean;
  error: string | null;
  /** true when this phone was removed from the project or it was deleted */
  noAccess: boolean;
  isAdmin: boolean;
  canEditStatus: boolean;
}

/** Live (real-time synced) data of one project. */
export function useProject(pid: string | undefined): ProjectData {
  const { backend, uid } = useApp();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [membership, setMembership] = useState<Member | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid || !uid) return;
    const onErr = (e: Error) => setError(e.message);
    const unsubs: (() => void)[] = [];
    // membership first: the other listeners are only allowed for members
    unsubs.push(
      backend.watchMembership(
        pid,
        (m) => {
          setMembership(m);
          if (m && unsubs.length === 1) {
            unsubs.push(backend.watchProject(pid, setProject, onErr));
            unsubs.push(backend.watchPlots(pid, (ps) => setPlots(ps.sort((a, b) => comparePlotNumbers(a.number, b.number))), onErr));
            unsubs.push(backend.watchLayout(pid, setLayout, onErr));
          }
        },
        onErr,
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [backend, pid, uid]);

  return useMemo(() => {
    const isAdmin = membership?.role === 'admin';
    return {
      project: project ?? null,
      plots: plots ?? [],
      layout,
      membership: membership ?? null,
      loading: membership === undefined || (membership !== null && (project === undefined || plots === null)),
      error,
      noAccess: membership === null || project === null,
      isAdmin,
      canEditStatus: isAdmin || (membership?.role === 'sales' && !!project?.salesCanEdit),
    };
  }, [project, plots, layout, membership, error]);
}
