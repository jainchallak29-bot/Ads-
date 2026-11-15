import { ALL_STATUSES, DEFAULT_FEATURES, DEFAULT_STATUSES, type Features, type PlotStatus, type Project } from './types';

export const STATUS_LABEL: Record<PlotStatus, string> = {
  available: 'Available',
  token: 'Token',
  booked: 'Booked',
  agreement: 'Agreement',
  sold: 'Sold',
  blocked: 'Not for sale',
};

/** Outline / badge colours. */
export const STATUS_COLOR: Record<PlotStatus, string> = {
  available: '#2E9F5B',
  token: '#0C8599',
  booked: '#E2A400',
  agreement: '#7048E8',
  sold: '#D64545',
  blocked: '#868E96',
};

/** Opaque plot fills (map and PDF), so original CAD lines under a plot (e.g. after a merge) are hidden. */
export const STATUS_FILL_SOLID: Record<PlotStatus, string> = {
  available: '#C2E1CC',
  token: '#BFE3E8',
  booked: '#F2DDA1',
  agreement: '#D9D0F7',
  sold: '#EDB6B4',
  blocked: '#DEE0E3',
};

/** AutoCAD colour index used when exporting to DXF. */
export const STATUS_ACI: Record<PlotStatus, number> = {
  available: 3,
  token: 4,
  booked: 2,
  agreement: 6,
  sold: 1,
  blocked: 8,
};

export function isPlotStatus(s: unknown): s is PlotStatus {
  return typeof s === 'string' && (ALL_STATUSES as string[]).includes(s);
}

/** Booked in any form (token … sold): counts as "not available" for customers. */
export function isTaken(s: PlotStatus): boolean {
  return s !== 'available' && s !== 'blocked';
}

type P = Pick<Project, 'statuses'> | null | undefined;

export function statusLabel(project: P, s: PlotStatus): string {
  return project?.statuses?.labels?.[s]?.trim() || STATUS_LABEL[s] || String(s);
}

/** Statuses switched on for the project, always in stage order and always including Available. */
export function enabledStatuses(project: P): PlotStatus[] {
  const on = new Set<PlotStatus>(project?.statuses?.enabled?.length ? project.statuses.enabled : DEFAULT_STATUSES);
  on.add('available');
  return ALL_STATUSES.filter((s) => on.has(s));
}

export function features(project: Pick<Project, 'features'> | null | undefined): Features {
  return { ...DEFAULT_FEATURES, ...(project?.features || {}) };
}
