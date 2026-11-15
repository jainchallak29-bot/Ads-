// Turns loose linework (LINEs, open polylines, arcs) into closed faces, the way
// a person reads a layout plan: every region fully enclosed by lines is a face.
//
// Steps: snap nearby endpoints, split segments at crossings / T-junctions
// (also closing small gaps where a line stops just short of another), drop
// dangling lines, then walk the planar graph to collect every bounded face.

import { cleanPolygon, signedArea } from '../geometry';
import type { Pt } from '../types';

type Seg = { a: Pt; b: Pt };

class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(private size: number) {}
  private key(ix: number, iy: number) {
    return ix + ',' + iy;
  }
  insertBox(minX: number, minY: number, maxX: number, maxY: number, v: T) {
    const s = this.size;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const y0 = Math.floor(minY / s);
    const y1 = Math.floor(maxY / s);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
      // huge item; register in a coarse "big" list instead
      this.big.push(v);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(v);
      }
    }
  }
  big: T[] = [];
  queryBox(minX: number, minY: number, maxX: number, maxY: number, out: Set<T>) {
    const s = this.size;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const y0 = Math.floor(minY / s);
    const y1 = Math.floor(maxY / s);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
      for (const c of this.cells.values()) for (const v of c) out.add(v);
    } else {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const c = this.cells.get(this.key(x, y));
          if (c) for (const v of c) out.add(v);
        }
      }
    }
    for (const v of this.big) out.add(v);
  }
}

export interface PolygonizeOptions {
  /** Distance under which points are considered the same and small gaps are closed. */
  tolerance: number;
  /** Safety limit to keep the phone responsive on enormous drawings. */
  maxSegments?: number;
}

export function polygonize(lines: Pt[][], closedFlags: boolean[], opts: PolygonizeOptions): Pt[][] {
  const tol = Math.max(opts.tolerance, 1e-9);
  const segs: Seg[] = [];
  lines.forEach((pts, i) => {
    const n = pts.length;
    const count = closedFlags[i] ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % n];
      if (Math.hypot(a.x - b.x, a.y - b.y) > tol * 0.01) segs.push({ a, b });
    }
  });
  if (opts.maxSegments && segs.length > opts.maxSegments) {
    throw new Error(`Too many lines (${segs.length}). Choose fewer layers for plot boundaries.`);
  }
  if (!segs.length) return [];

  // --- spatial index of segments
  let totalLen = 0;
  for (const s of segs) totalLen += Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y);
  const cell = Math.max(tol * 4, (totalLen / segs.length) * 2);
  const grid = new Grid<number>(cell);
  segs.forEach((s, i) =>
    grid.insertBox(Math.min(s.a.x, s.b.x) - tol, Math.min(s.a.y, s.b.y) - tol, Math.max(s.a.x, s.b.x) + tol, Math.max(s.a.y, s.b.y) + tol, i),
  );

  // split parameters per segment (t in [0,1]) with the point to use there
  const splits: { t: number; p: Pt }[][] = segs.map(() => []);
  const near = new Set<number>();

  const endpointOnSeg = (p: Pt, j: number): { t: number; p: Pt } | null => {
    const s = segs[j];
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return null;
    const t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2;
    const len = Math.sqrt(len2);
    if (t * len < -tol || (t - 1) * len > tol) return null;
    const tc = Math.max(0, Math.min(1, t));
    const q = { x: s.a.x + tc * dx, y: s.a.y + tc * dy };
    if (Math.hypot(q.x - p.x, q.y - p.y) > tol) return null;
    return { t: tc, p: q };
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    near.clear();
    grid.queryBox(Math.min(s.a.x, s.b.x) - tol, Math.min(s.a.y, s.b.y) - tol, Math.max(s.a.x, s.b.x) + tol, Math.max(s.a.y, s.b.y) + tol, near);
    for (const j of near) {
      if (j <= i) continue;
      const o = segs[j];
      // proper crossing
      const d1x = s.b.x - s.a.x;
      const d1y = s.b.y - s.a.y;
      const d2x = o.b.x - o.a.x;
      const d2y = o.b.y - o.a.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) > 1e-12 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) {
        const t = ((o.a.x - s.a.x) * d2y - (o.a.y - s.a.y) * d2x) / den;
        const u = ((o.a.x - s.a.x) * d1y - (o.a.y - s.a.y) * d1x) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) {
          const p = { x: s.a.x + t * d1x, y: s.a.y + t * d1y };
          splits[i].push({ t, p });
          splits[j].push({ t: u, p });
        }
      }
      // endpoints touching / almost touching the other segment (T-junctions, gaps, overlaps)
      for (const p of [o.a, o.b]) {
        const hit = endpointOnSeg(p, i);
        if (hit) {
          splits[i].push(hit);
          // pull the endpoint onto the segment so the gap closes
          splits[j].push({ t: p === o.a ? 0 : 1, p: hit.p });
        }
      }
      for (const p of [s.a, s.b]) {
        const hit = endpointOnSeg(p, j);
        if (hit) {
          splits[j].push(hit);
          splits[i].push({ t: p === s.a ? 0 : 1, p: hit.p });
        }
      }
    }
  }

  // --- vertices with snapping (union of points within tol)
  const vx: Pt[] = [];
  const vgrid = new Map<string, number[]>();
  const vkey = (x: number, y: number) => Math.floor(x / tol) + ',' + Math.floor(y / tol);
  const vertexId = (p: Pt): number => {
    const ix = Math.floor(p.x / tol);
    const iy = Math.floor(p.y / tol);
    let best = -1;
    let bestD = tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = vgrid.get(ix + dx + ',' + (iy + dy));
        if (!c) continue;
        for (const id of c) {
          const d = Math.hypot(vx[id].x - p.x, vx[id].y - p.y);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    if (best >= 0) return best;
    const id = vx.length;
    vx.push({ x: p.x, y: p.y });
    const k = vkey(p.x, p.y);
    let c = vgrid.get(k);
    if (!c) vgrid.set(k, (c = []));
    c.push(id);
    return id;
  };

  const adj = new Map<number, Set<number>>();
  const addEdge = (u: number, v: number) => {
    if (u === v) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };

  segs.forEach((s, i) => {
    const pts = [{ t: 0, p: s.a }, ...splits[i], { t: 1, p: s.b }];
    // endpoints may have been replaced by snapped positions (t=0 / t=1 entries)
    pts.sort((x, y) => x.t - y.t);
    const startOverride = splits[i].filter((q) => q.t === 0).pop();
    const endOverride = splits[i].filter((q) => q.t === 1).pop();
    if (startOverride) pts[0] = startOverride;
    if (endOverride) pts[pts.length - 1] = endOverride;
    let prev = vertexId(pts[0].p);
    for (let k = 1; k < pts.length; k++) {
      const cur = vertexId(pts[k].p);
      addEdge(prev, cur);
      prev = cur;
    }
  });

  // --- prune dangling edges (vertices of degree 1)
  const stack: number[] = [];
  for (const [v, ns] of adj) if (ns.size <= 1) stack.push(v);
  while (stack.length) {
    const v = stack.pop()!;
    const ns = adj.get(v);
    if (!ns) continue;
    if (ns.size > 1) continue;
    for (const w of ns) {
      const nw = adj.get(w)!;
      nw.delete(v);
      if (nw.size <= 1) stack.push(w);
    }
    adj.delete(v);
  }

  // --- sort neighbours by angle
  const sorted = new Map<number, number[]>();
  for (const [v, ns] of adj) {
    const p = vx[v];
    sorted.set(
      v,
      [...ns].sort((a, b) => Math.atan2(vx[a].y - p.y, vx[a].x - p.x) - Math.atan2(vx[b].y - p.y, vx[b].x - p.x)),
    );
  }

  // --- walk faces: from edge u->v, continue with the neighbour of v that comes
  // right before u in counter-clockwise order (i.e. the sharpest left turn's mirror).
  // This traces bounded faces counter-clockwise (positive area in Y-up coordinates).
  const visited = new Set<string>();
  const faces: Pt[][] = [];
  for (const [u, ns] of sorted) {
    for (const v of ns) {
      const startKey = u + '>' + v;
      if (visited.has(startKey)) continue;
      const ring: number[] = [];
      let a = u;
      let b = v;
      let guard = 0;
      while (guard++ < 100000) {
        const k = a + '>' + b;
        if (visited.has(k)) break;
        visited.add(k);
        ring.push(a);
        const around = sorted.get(b)!;
        const idx = around.indexOf(a);
        const next = around[(idx - 1 + around.length) % around.length];
        a = b;
        b = next;
      }
      if (ring.length >= 3 && a === u && b === v) {
        const poly = ring.map((id) => vx[id]);
        if (signedArea(poly) > 0) faces.push(cleanPolygon(poly, tol * 1e-3));
      }
    }
  }
  return faces.filter((f) => f.length >= 3);
}
