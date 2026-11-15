// Converts detected CAD plots + linework into the app's map coordinates
// (origin at the top-left of the layout, Y pointing down) and compact
// background path strings.

import { boundsOf, isFiniteBounds } from '../geometry';
import type { BgText, Bounds, LayoutData, Pt } from '../types';
import { asPlotNumber, type CadData } from './dxfRead';
import type { DetectedPlot } from './detect';

export interface BuiltLayout {
  origin: { x: number; y: number };
  bounds: Bounds;
  layout: LayoutData;
  plots: { number: string; polygon: Pt[] }[];
}

const MAX_CHUNK = 600_000; // characters per stored chunk (Firestore docs are limited to 1 MiB)
const MAX_TEXTS = 4000;

export function coordDigits(diag: number): number {
  return Math.max(0, Math.min(6, Math.ceil(-Math.log10(Math.max(diag, 1e-9) / 1e5))));
}

export function buildLayout(cad: CadData, plots: DetectedPlot[], opts: { includeTexts: boolean } = { includeTexts: true }): BuiltLayout {
  // Area of interest: around the plots (stray far-away CAD objects are dropped)
  let aoi: Bounds;
  if (plots.length) {
    const pb = boundsOf(plots.flatMap((p) => p.polygon));
    const padX = (pb.maxX - pb.minX) * 0.5 + 1e-6;
    const padY = (pb.maxY - pb.minY) * 0.5 + 1e-6;
    aoi = { minX: pb.minX - padX, minY: pb.minY - padY, maxX: pb.maxX + padX, maxY: pb.maxY + padY };
  } else {
    aoi = cad.bounds;
  }
  const inAoi = (b: Bounds) => b.maxX >= aoi.minX && b.minX <= aoi.maxX && b.maxY >= aoi.minY && b.minY <= aoi.maxY;

  const bgLines = cad.polylines.filter((p) => inAoi(boundsOf(p.pts)));
  // plot numbers are drawn by the app itself, so leave them out of the background
  const plotNumbers = new Set(plots.map((p) => p.number));
  const bgTexts = opts.includeTexts
    ? cad.texts.filter((t) => {
        if (t.x < aoi.minX || t.x > aoi.maxX || t.y < aoi.minY || t.y > aoi.maxY) return false;
        const n = asPlotNumber(t.text);
        return !(n && plotNumbers.has(n));
      })
    : [];

  const all: Pt[] = [];
  for (const p of plots) all.push(...p.polygon);
  for (const l of bgLines) all.push(...l.pts);
  let b = boundsOf(all);
  if (!isFiniteBounds(b)) b = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  // map coords: x' = x - minX, y' = maxY - y
  const origin = { x: b.minX, y: b.maxY };
  const toMap = (p: Pt): Pt => ({ x: p.x - origin.x, y: origin.y - p.y });
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  const digits = coordDigits(diag);
  const f = (n: number) => +n.toFixed(digits);

  const paths: string[] = [];
  let cur = '';
  for (const l of bgLines) {
    const pts = l.pts.map(toMap);
    let d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
    for (let i = 1; i < pts.length; i++) d += 'L' + f(pts[i].x) + ' ' + f(pts[i].y);
    if (l.closed) d += 'Z';
    if (cur.length + d.length > MAX_CHUNK) {
      paths.push(cur);
      cur = '';
    }
    cur += d;
  }
  if (cur) paths.push(cur);

  const texts: BgText[] = bgTexts
    .sort((a, c) => c.h - a.h)
    .slice(0, MAX_TEXTS)
    .map((t) => {
      const m = toMap(t);
      return { t: t.text.slice(0, 80), x: f(m.x), y: f(m.y), h: +t.h.toPrecision(3), r: +(-t.rot).toFixed(1) };
    });

  return {
    origin,
    bounds: { minX: 0, minY: 0, maxX: f(b.maxX - b.minX), maxY: f(b.maxY - b.minY) },
    layout: { paths, texts },
    plots: plots.map((p) => ({ number: p.number, polygon: p.polygon.map((q) => {
      const m = toMap(q);
      return { x: f(m.x), y: f(m.y) };
    }) })),
  };
}
