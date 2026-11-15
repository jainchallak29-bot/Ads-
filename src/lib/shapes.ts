// Plot shape editing: merge, split, corner edits, snapping.

import polygonClipping, { type Polygon as PCPolygon, type MultiPolygon } from 'polygon-clipping';

import { boundsOf, cleanPolygon, dist, polygonArea, projectOnSegment } from './geometry';
import type { Pt } from './types';

const toPC = (poly: Pt[]): PCPolygon => [[...poly.map((p) => [p.x, p.y] as [number, number]), [poly[0].x, poly[0].y]]];

function outerRings(mp: MultiPolygon): Pt[][] {
  return mp
    .map((poly) => poly[0].slice(0, -1).map(([x, y]) => ({ x, y })))
    .map((r) => cleanPolygon(r, 1e-9))
    .filter((r) => r.length >= 3);
}

/** Snap b's corners onto a's corners/edges when they are within tol (closes hairline gaps). */
function snapTo(b: Pt[], a: Pt[], tol: number): Pt[] {
  return b.map((p) => {
    let best: Pt = p;
    let bd = tol;
    for (const q of a) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best !== p) return best;
    for (let i = 0; i < a.length; i++) {
      const r = projectOnSegment(p, a[i], a[(i + 1) % a.length]);
      if (r.d < bd) {
        bd = r.d;
        best = r.pt;
      }
    }
    return best;
  });
}

export function mergePlots(a: Pt[], b: Pt[]): Pt[] {
  const bb = boundsOf([...a, ...b]);
  const tol = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) * 1e-5;
  const res = outerRings(polygonClipping.union(toPC(a), toPC(snapTo(b, a, tol))));
  if (res.length !== 1) throw new Error('These plots do not touch each other, so they cannot be merged.');
  return res[0];
}

/** Split a plot along the straight line through p1 and p2. */
export function splitPlot(poly: Pt[], p1: Pt, p2: Pt): Pt[][] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) throw new Error('Pick two different points for the cut line.');
  const b = boundsOf(poly);
  const L = (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) + dist(p1, { x: b.minX, y: b.minY })) * 4;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const A = { x: p1.x - ux * L, y: p1.y - uy * L };
  const B = { x: p1.x + ux * L, y: p1.y + uy * L };
  const side = (s: number): Pt[] => [A, B, { x: B.x + nx * L * s, y: B.y + ny * L * s }, { x: A.x + nx * L * s, y: A.y + ny * L * s }];
  const pieces = [
    ...outerRings(polygonClipping.intersection(toPC(poly), toPC(side(1)))),
    ...outerRings(polygonClipping.intersection(toPC(poly), toPC(side(-1)))),
  ].filter((r) => polygonArea(r) > polygonArea(poly) * 1e-4);
  if (pieces.length < 2) throw new Error('The cut line must go across the plot.');
  return pieces;
}

export function moveCorner(poly: Pt[], index: number, to: Pt): Pt[] {
  return poly.map((p, i) => (i === index ? { x: to.x, y: to.y } : p));
}

export function deleteCorner(poly: Pt[], index: number): Pt[] {
  if (poly.length <= 3) throw new Error('A plot needs at least 3 corners.');
  return poly.filter((_, i) => i !== index);
}

/** Insert a new corner in the middle of edge (index → index+1). */
export function insertCorner(poly: Pt[], edgeIndex: number, at?: Pt): Pt[] {
  const a = poly[edgeIndex];
  const b = poly[(edgeIndex + 1) % poly.length];
  const p = at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = [...poly];
  out.splice(edgeIndex + 1, 0, p);
  return out;
}

/** Nearest existing corner within `tol` (for snapping new points to existing plots). */
export function snapPoint(p: Pt, polygons: Pt[][], tol: number): Pt {
  let best: Pt | null = null;
  let bd = tol;
  for (const poly of polygons) {
    for (const q of poly) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  if (best) return { x: best.x, y: best.y };
  // then onto edges
  let ep: Pt | null = null;
  bd = tol * 0.75;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const r = projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
      if (r.d < bd) {
        bd = r.d;
        ep = r.pt;
      }
    }
  }
  return ep ?? p;
}

/** Name pieces after a split: 12 → 12A, 12B ... */
export function splitNames(base: string, count: number, taken: Set<string>): string[] {
  const out: string[] = [];
  let code = 65;
  while (out.length < count && code < 91) {
    const n = base + String.fromCharCode(code++);
    if (!taken.has(n)) out.push(n);
  }
  while (out.length < count) out.push(base + '-' + (out.length + 1));
  return out;
}

export function isSimplePolygon(poly: Pt[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      const d1 = (a2.x - a1.x) * (b1.y - a1.y) - (a2.y - a1.y) * (b1.x - a1.x);
      const d2 = (a2.x - a1.x) * (b2.y - a1.y) - (a2.y - a1.y) * (b2.x - a1.x);
      const d3 = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x);
      const d4 = (b2.x - b1.x) * (a2.y - b1.y) - (b2.y - b1.y) * (a2.x - b1.x);
      if (d1 * d2 < 0 && d3 * d4 < 0) return false;
    }
  }
  return true;
}
