import { useEffect, useRef, useState } from 'react';

import { useApp } from '@/components/AppProvider';
import { buildPublic, publicStatuses, type PublicDoc } from '@/lib/publicLayout';
import { features } from '@/lib/status';
import type { LayoutData, Plot, Project } from '@/lib/types';

/**
 * Keeps the customer share page in step with the project. Runs on any open
 * phone: Admins republish shapes/prices/drawing when they change, and anyone
 * allowed to change statuses pushes Available / Not available.
 */
export function usePublicSync(project: Project | null, plots: Plot[], layout: LayoutData | null, isAdmin: boolean, canEditStatus: boolean) {
  const { backend } = useApp();
  const token = project?.share?.enabled && features(project).share ? project.share.token : '';
  const [pub, setPub] = useState<PublicDoc | null | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    if (!token) return;
    return backend.watchPublic(token, setPub, () => setPub(null));
  }, [backend, token]);

  useEffect(() => {
    if (!token || !project || pub === undefined || !plots.length || busy.current) return;
    const t = setTimeout(async () => {
      busy.current = true;
      try {
        const st = publicStatuses(plots);
        if (isAdmin) {
          const next = buildPublic(project, plots, !!project.share?.showPrices);
          const layoutChanged = !pub || pub.layoutVersion !== project.layoutVersion;
          if (!pub || pub.rev !== next.rev || layoutChanged) {
            await backend.publishPublic(token, { ...next, st }, layoutChanged ? layout : null);
            return;
          }
        }
        if (pub && canEditStatus && JSON.stringify(pub.st || {}) !== JSON.stringify(st)) {
          await backend.updatePublicStatus(token, st);
        }
      } catch {
        // try again on the next change
      } finally {
        busy.current = false;
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [backend, token, project, plots, layout, pub, isAdmin, canEditStatus]);
}
