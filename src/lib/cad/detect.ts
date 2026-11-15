// Finds plots in a CAD drawing: each plot = a closed shape that contains exactly
// one plot-number text. Works when plots are closed polylines AND when they are
// made of separate lines (via polygonize).

import { boundsOf, cleanPolygon, distToPolygonEdge, isFiniteBounds, labelPoint, pointInPolygon, polygonArea } from '../geometry';
import type { Bounds, Pt } from '../types';
import { asPlotNumber, type CadData, type RawPolyline, type RawText } from './dxfRead';
import { polygonize } from './polygonize';

export interface DetectOptions {
  boundaryLayers: string[];
  numberLayers: string[];
  /** gap-closing tolerance in drawing units; default = 0.02% of drawing size */
  tolerance?: number;
}

export interface DetectedPlot {
  number: string;
  /** CAD coordinates (Y up) */
  polygon: Pt[];
  source: 'polyline' | 'lines';
}

export interface DetectResult {
  plots: DetectedPlot[];
  /** plot-number texts for which no enclosing shape was found */
  unmatched: { number: string; x: number; y: number }[];
  duplicates: string[];
  tolerance: number;
}

const SKIP_LAYER = /DIM|HATCH|GRID|TITLE|BORDER|FRAME|DEFPOINTS|NORTH|LOGO|TREE|PLANT|ANNO|TEXT|LEGEND|VIEWPORT|VPORT|KEY/i;

/** Sensible starting layer selection; the user can change it on the import screen. */
export function suggestLayers(cad: CadData): { boundaryLayers: string[]; numberLayers: string[] } {
  const numberLayers = cad.layers.filter((l) => l.numberTextCount >= 2).map((l) => l.name);
  let boundaryLayers = cad.layers.filter((l) => l.lineCount > 0 && !SKIP_LAYER.test(l.name)).map((l) => l.name);
  if (!boundaryLayers.length) boundaryLayers = cad.layers.filter((l) => l.lineCount > 0).map((l) => l.name);
  return { boundaryLayers, numberLayers: numberLayers.length ? numberLayers : cad.layers.filter((l) => l.numberTextCount > 0).map((l) => l.name) };
}

type NumText = { number: string; t: RawText; used: boolean };

/** Picks the plot number for a shape from the number-texts inside it. */
function chooseText(poly: Pt[], inside: NumText[]): NumText | null {
  const free = inside.filter((n) => !n.used);
  if (!free.length) return null;
  if (inside.length === 1) return free[0];
  // Several number-like texts inside: accept only if one is clearly the biggest
  // (plot numbers are usually written larger than dimensions).
  const sorted = [...inside].sort((a, b) => b.t.h - a.t.h);
  if (sorted[0].t.h >= sorted[1].t.h * 1.2 && !sorted[0].used) return sorted[0];
  // or if exactly one of them is well inside (not sitting on an edge like a dimension)
  const lp = labelPoint(poly).radius;
  const central = inside.filter((n) => distToPolygonEdge(n.t, poly) > lp * 0.35);
  if (central.length === 1 && !central[0].used) return central[0];
  return null;
}

export function detectPlots(cad: CadData, opts: DetectOptions): DetectResult {
  const bLayers = new Set(opts.boundaryLayers);
  const nLayers = new Set(opts.numberLayers);

  const numTexts: NumText[] = [];
  for (const t of cad.texts) {
    if (!nLayers.has(t.layer)) continue;
    const number = asPlotNumber(t.text);
    if (number) numTexts.push({ number, t, used: false });
  }

  const boundary: RawPolyline[] = cad.polylines.filter((p) => bLayers.has(p.layer) && p.kind !== 'circle');

  // tolerance relative to the size of the area with plot numbers (or the whole drawing)
  const area: Bounds = numTexts.length > 2 ? boundsOf(numTexts.map((n) => n.t)) : cad.bounds;
  const diag = isFiniteBounds(area) ? Math.hypot(area.maxX - area.minX, area.maxY - area.minY) : 1;
  const tol = opts.tolerance ?? Math.max(diag * 2e-4, 1e-6);

  const textsIn = (poly: Pt[]): NumText[] => {
    const b = boundsOf(poly);
    return numTexts.filter((n) => n.t.x >= b.minX && n.t.x <= b.maxX && n.t.y >= b.minY && n.t.y <= b.maxY && pointInPolygon(n.t, poly));
  };

  const result: DetectedPlot[] = [];

  // 1) closed polylines, smallest first so a plot wins over the block around it
  const closed = boundary
    .filter((p) => p.closed && p.pts.length >= 3)
    .map((p) => cleanPolygon(p.pts, tol * 1e-3))
    .filter((p) => p.length >= 3)
    .map((p) => ({ p, a: polygonArea(p) }))
    .filter((x) => x.a > 0)
    .sort((x, y) => x.a - y.a);
  for (const { p } of closed) {
    const inside = textsIn(p);
    if (!inside.length || inside.length > 3) continue;
    const pick = chooseText(p, inside);
    if (!pick) continue;
    pick.used = true;
    result.push({ number: pick.number, polygon: p, source: 'polyline' });
  }

  // 2) faces formed by loose lines, for numbers still without a shape
  if (numTexts.some((n) => !n.used) && boundary.length) {
    // only consider linework near the numbers to keep this fast
    const pad = diag * 0.5;
    const lines = boundary.filter((p) => {
      const b = boundsOf(p.pts);
      return b.maxX >= area.minX - pad && b.minX <= area.maxX + pad && b.maxY >= area.minY - pad && b.minY <= area.maxY + pad;
    });
    const faces = polygonize(
      lines.map((l) => l.pts),
      lines.map((l) => l.closed),
      { tolerance: tol, maxSegments: 400000 },
    )
      .map((p) => ({ p, a: polygonArea(p) }))
      .sort((x, y) => x.a - y.a);
    for (const { p } of faces) {
      if (!numTexts.some((n) => !n.used)) break;
      const inside = textsIn(p);
      if (!inside.length || inside.length > 3) continue;
      const pick = chooseText(p, inside);
      if (!pick) continue;
      pick.used = true;
      result.push({ number: pick.number, polygon: p, source: 'lines' });
    }
  }

  // 3) drop shapes that are far bigger than a typical plot (e.g. a whole block
  //    picked up because a plot's own lines are missing)
  if (result.length >= 5) {
    const areas = result.map((r) => polygonArea(r.polygon)).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    for (let i = result.length - 1; i >= 0; i--) {
      if (polygonArea(result[i].polygon) > median * 25) {
        const n = numTexts.find((x) => x.number === result[i].number && x.used);
        if (n) n.used = false;
        result.splice(i, 1);
      }
    }
  }

  const seen = new Map<string, number>();
  for (const r of result) seen.set(r.number, (seen.get(r.number) || 0) + 1);
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);

  return {
    plots: result,
    unmatched: numTexts.filter((n) => !n.used).map((n) => ({ number: n.number, x: n.t.x, y: n.t.y })),
    duplicates,
    tolerance: tol,
  };
}

/** Natural sort for plot numbers: 2 < 10 < 10A < A-1 */
export function comparePlotNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
