import type { Bounds, Pt } from './types';

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: Pt[]): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const sx = poly.reduce((s, p) => s + p.x, 0);
    const sy = poly.reduce((s, p) => s + p.y, 0);
    return { x: sx / poly.length, y: sy / poly.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function boundsOf(points: Iterable<Pt>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function isFiniteBounds(b: Bounds): boolean {
  return [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const pt = { x: a.x + t * dx, y: a.y + t * dy };
  return { pt, t, d: dist(p, pt) };
}

export function distToPolygonEdge(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]).d;
    if (d < best) best = d;
  }
  return best;
}

export function edgeLengths(poly: Pt[]): number[] {
  return poly.map((p, i) => dist(p, poly[(i + 1) % poly.length]));
}

/** Remove repeated points and points lying on a straight line between neighbours. */
export function cleanPolygon(poly: Pt[], eps = 1e-9): Pt[] {
  let pts = poly.filter((p, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    return dist(p, prev) > eps;
  });
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= eps) pts = pts.slice(0, -1);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const scale = Math.max(dist(a, b), dist(b, c), eps);
      if (Math.abs(cross) / scale <= eps * 10 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Pole of inaccessibility (best point to put a label inside a polygon).
 * Simplified version of Mapbox's polylabel algorithm.
 */
export function labelPoint(poly: Pt[], precision?: number): { pt: Pt; radius: number } {
  const b = boundsOf(poly);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const cellSize = Math.min(w, h);
  if (cellSize === 0 || poly.length < 3) return { pt: { x: b.minX, y: b.minY }, radius: 0 };
  const prec = precision ?? cellSize / 50;
  const sd = (x: number, y: number) => {
    const p = { x, y };
    const d = distToPolygonEdge(p, poly);
    return pointInPolygon(p, poly) ? d : -d;
  };
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const mk = (x: number, y: number, hh: number): Cell => {
    const d = sd(x, y);
    return { x, y, h: hh, d, max: d + hh * Math.SQRT2 };
  };
  const queue: Cell[] = [];
  const half = cellSize / 2;
  for (let x = b.minX; x < b.maxX; x += cellSize) {
    for (let y = b.minY; y < b.maxY; y += cellSize) queue.push(mk(x + half, y + half, half));
  }
  const c = centroid(poly);
  let best = mk(c.x, c.y, 0);
  const bb = mk(b.minX + w / 2, b.minY + h / 2, 0);
  if (bb.d > best.d) best = bb;
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    // pop cell with max potential
    let mi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[mi].max) mi = i;
    const cell = queue.splice(mi, 1)[0];
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= prec) continue;
    const hh = cell.h / 2;
    queue.push(mk(cell.x - hh, cell.y - hh, hh), mk(cell.x + hh, cell.y - hh, hh), mk(cell.x - hh, cell.y + hh, hh), mk(cell.x + hh, cell.y + hh, hh));
  }
  return { pt: { x: best.x, y: best.y }, radius: Math.max(0, best.d) };
}

/** Intersection point of segments p1p2 and p3p4 (proper or touching), or null. */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): { pt: Pt; t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-15) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return { pt: { x: p1.x + t * d1x, y: p1.y + t * d1y }, t, u };
}

export function polygonToPath(poly: Pt[], digits = 3): string {
  if (!poly.length) return '';
  const f = (n: number) => +n.toFixed(digits);
  return 'M' + poly.map((p) => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z';
}

/** Rough "width × depth" of a plot using the oriented bounding box of its longest edge. */
export function orientedSize(poly: Pt[]): { w: number; h: number } {
  if (poly.length < 3) return { w: 0, h: 0 };
  const lens = edgeLengths(poly);
  let li = 0;
  for (let i = 1; i < lens.length; i++) if (lens[i] > lens[li]) li = i;
  const a = poly[li];
  const b = poly[(li + 1) % poly.length];
  const ux = (b.x - a.x) / (lens[li] || 1);
  const uy = (b.y - a.y) / (lens[li] || 1);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of poly) {
    const u = (p.x - a.x) * ux + (p.y - a.y) * uy;
    const v = -(p.x - a.x) * uy + (p.y - a.y) * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  return { w: maxU - minU, h: maxV - minV };
}
