// What customers see through the share link: plot shapes, numbers, size and
// (optionally) price, plus Available / Not available. No buyer data ever.

import { flatten } from './backend/serialize';
import { plotPrice } from './pricing';
import { features } from './status';
import type { Bounds, Plot, PlotStatus, Project } from './types';
import { plotAreaSqm } from './units';

export type PublicState = 'a' | 'n' | 'x';

export interface PublicPlot {
  n: string;
  pts: number[];
  b?: string;
  /** size as written in the drawing */
  z?: string;
  f?: string;
  c?: boolean;
  /** area in square metres */
  a: number;
  p?: number | null;
}

export interface PublicInfo {
  projectId: string;
  name: string;
  location: string;
  company: { name: string; phone: string; email: string } | null;
  bounds: Bounds;
  areaUnit: Project['areaUnit'];
  lengthUnit: Project['lengthUnit'];
  drawingUnit: Project['drawingUnit'];
  currency: string;
  showPrices: boolean;
  layoutVersion: number;
  /** GPS alignment, so customers can get directions to a plot */
  geo: Project['geo'] | null;
  /** fingerprint of everything above + plots, to know when to republish */
  rev: string;
}

export interface PublicDoc extends PublicInfo {
  plots: Record<string, PublicPlot>;
  /** status per plot id: a = available, n = not available, x = not for sale */
  st: Record<string, PublicState>;
  updatedAt: number;
}

export function publicState(s: PlotStatus): PublicState {
  return s === 'available' ? 'a' : s === 'blocked' ? 'x' : 'n';
}

export function publicStatuses(plots: Plot[]): Record<string, PublicState> {
  return Object.fromEntries(plots.map((p) => [p.id, publicState(p.status)]));
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function buildPublic(project: Project, plots: Plot[], showPrices: boolean): Omit<PublicDoc, 'st' | 'updatedAt'> {
  const out: Record<string, PublicPlot> = {};
  for (const p of plots) {
    const price = showPrices ? plotPrice(p, project) : null;
    out[p.id] = {
      n: p.number,
      pts: flatten(p.polygon).map((v) => +v.toFixed(3)),
      ...(p.block ? { b: p.block } : {}),
      ...(p.sizeLabel ? { z: p.sizeLabel } : {}),
      ...(p.facing ? { f: p.facing } : {}),
      ...(p.isCorner ? { c: true } : {}),
      a: +plotAreaSqm(p, project.drawingUnit).toFixed(3),
      ...(price ? { p: price } : {}),
    };
  }
  const co = project.company;
  const info: Omit<PublicInfo, 'rev'> = {
    projectId: project.id,
    name: project.name,
    location: project.location || '',
    company: co?.name || co?.phone ? { name: co.name || '', phone: co.phone || '', email: co.email || '' } : null,
    bounds: project.bounds,
    areaUnit: project.areaUnit,
    lengthUnit: project.lengthUnit,
    drawingUnit: project.drawingUnit,
    currency: project.currency,
    showPrices,
    layoutVersion: project.layoutVersion,
    geo: features(project).gps && project.geo ? project.geo : null,
  };
  const rev = hash(JSON.stringify([info, out]));
  return { ...info, rev, plots: out };
}

/** Link customers open. Firebase Hosting serves the web app at https://<projectId>.web.app by default. */
export function shareUrl(base: string, token: string, plotNumber?: string): string {
  const b = base.replace(/\/+$/, '');
  return `${b}/share/${token}${plotNumber ? `?plot=${encodeURIComponent(plotNumber)}` : ''}`;
}
