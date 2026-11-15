import type { PlotStatus } from './types';

export const STATUS_LABEL: Record<PlotStatus, string> = {
  available: 'Available',
  booked: 'Booked',
  sold: 'Sold',
};

/** Outline / badge colours. */
export const STATUS_COLOR: Record<PlotStatus, string> = {
  available: '#2E9F5B',
  booked: '#E2A400',
  sold: '#D64545',
};

/** Opaque plot fills (map and PDF), so original CAD lines under a plot (e.g. after a merge) are hidden. */
export const STATUS_FILL_SOLID: Record<PlotStatus, string> = {
  available: '#C2E1CC',
  booked: '#F2DDA1',
  sold: '#EDB6B4',
};

/** AutoCAD colour index used when exporting to DXF. */
export const STATUS_ACI: Record<PlotStatus, number> = {
  available: 3,
  booked: 2,
  sold: 1,
};

export function isPlotStatus(s: unknown): s is PlotStatus {
  return s === 'available' || s === 'booked' || s === 'sold';
}
