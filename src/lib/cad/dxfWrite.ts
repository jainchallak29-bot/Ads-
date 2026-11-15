// Minimal DXF (AutoCAD R12 / AC1009) writer. R12 DXF opens in every CAD
// program (AutoCAD, BricsCAD, ZWCAD, LibreCAD, DraftSight, QCAD...).

import type { Pt } from '../types';

export interface DxfLayer {
  name: string;
  /** AutoCAD colour index: 1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white/black, 8 grey */
  color: number;
}

export class DxfWriter {
  private out: string[] = [];
  private layers = new Map<string, DxfLayer>();
  constructor(private digits = 4) {}

  private g(code: number, value: string | number) {
    this.out.push(String(code), typeof value === 'number' ? this.num(value) : value);
  }
  private num(n: number) {
    if (Number.isInteger(n)) return String(n);
    return String(+n.toFixed(this.digits));
  }

  layer(name: string, color: number) {
    this.layers.set(name, { name, color });
    return this;
  }

  line(a: Pt, b: Pt, layer: string) {
    this.g(0, 'LINE');
    this.g(8, layer);
    this.g(10, a.x);
    this.g(20, a.y);
    this.g(30, 0);
    this.g(11, b.x);
    this.g(21, b.y);
    this.g(31, 0);
  }

  polyline(pts: Pt[], closed: boolean, layer: string, color?: number) {
    if (pts.length < 2) return;
    this.g(0, 'POLYLINE');
    this.g(8, layer);
    if (color != null) this.g(62, color);
    this.g(66, 1);
    this.g(10, 0);
    this.g(20, 0);
    this.g(30, 0);
    this.g(70, closed ? 1 : 0);
    for (const p of pts) {
      this.g(0, 'VERTEX');
      this.g(8, layer);
      this.g(10, p.x);
      this.g(20, p.y);
      this.g(30, 0);
    }
    this.g(0, 'SEQEND');
    this.g(8, layer);
  }

  /** Text centred (middle) on point p. */
  text(s: string, p: Pt, height: number, layer: string, rotationDeg = 0, color?: number) {
    this.g(0, 'TEXT');
    this.g(8, layer);
    if (color != null) this.g(62, color);
    this.g(10, p.x);
    this.g(20, p.y);
    this.g(30, 0);
    this.g(40, height);
    this.g(1, s.replace(/[\r\n]+/g, ' '));
    if (rotationDeg) this.g(50, rotationDeg);
    this.g(72, 1); // centre
    this.g(11, p.x);
    this.g(21, p.y);
    this.g(31, 0);
    this.g(73, 2); // middle
  }

  /** Filled triangle/quad (R12 has no HATCH). Points in DXF SOLID order. */
  solid(a: Pt, b: Pt, c: Pt, d: Pt, layer: string) {
    this.g(0, 'SOLID');
    this.g(8, layer);
    this.g(10, a.x);
    this.g(20, a.y);
    this.g(30, 0);
    this.g(11, b.x);
    this.g(21, b.y);
    this.g(31, 0);
    this.g(12, c.x);
    this.g(22, c.y);
    this.g(32, 0);
    this.g(13, d.x);
    this.g(23, d.y);
    this.g(33, 0);
  }

  /** Raw entity groups (used by tests to produce other entity types). */
  raw(groups: [number, string | number][]) {
    for (const [c, v] of groups) this.g(c, v);
  }

  toString(insunits?: number): string {
    const head: string[] = [];
    const h = (c: number, v: string | number) => head.push(String(c), String(v));
    h(0, 'SECTION');
    h(2, 'HEADER');
    h(9, '$ACADVER');
    h(1, 'AC1009');
    if (insunits != null) {
      h(9, '$INSUNITS');
      h(70, insunits);
    }
    h(0, 'ENDSEC');
    h(0, 'SECTION');
    h(2, 'TABLES');
    h(0, 'TABLE');
    h(2, 'LTYPE');
    h(70, 1);
    h(0, 'LTYPE');
    h(2, 'CONTINUOUS');
    h(70, 0);
    h(3, 'Solid line');
    h(72, 65);
    h(73, 0);
    h(40, '0.0');
    h(0, 'ENDTAB');
    h(0, 'TABLE');
    h(2, 'LAYER');
    h(70, this.layers.size + 1);
    for (const l of [{ name: '0', color: 7 }, ...this.layers.values()]) {
      h(0, 'LAYER');
      h(2, l.name);
      h(70, 0);
      h(62, l.color);
      h(6, 'CONTINUOUS');
    }
    h(0, 'ENDTAB');
    h(0, 'ENDSEC');
    h(0, 'SECTION');
    h(2, 'ENTITIES');
    const tail = ['0', 'ENDSEC', '0', 'EOF'];
    return [...head, ...this.out, ...tail].join('\n') + '\n';
  }
}

/** Ear-clipping triangulation of a simple polygon (for filled plots in DXF). */
export function triangulate(poly: Pt[]): [Pt, Pt, Pt][] {
  const pts = [...poly];
  // ensure counter-clockwise
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) pts.reverse();
  const idx = pts.map((_, i) => i);
  const tris: [Pt, Pt, Pt][] = [];
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inTri = (p: Pt, a: Pt, b: Pt, c: Pt) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i - 1 + idx.length) % idx.length]];
      const b = pts[idx[i]];
      const c = pts[idx[(i + 1) % idx.length]];
      if (cross(a, b, c) <= 0) continue;
      let ok = true;
      for (const j of idx) {
        const p = pts[j];
        if (p === a || p === b || p === c) continue;
        if (inTri(p, a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate polygon; give up on the rest
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
  return tris;
}
