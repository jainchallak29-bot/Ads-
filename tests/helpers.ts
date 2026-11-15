import { DxfWriter } from '../src/lib/cad/dxfWrite';
import type { Pt } from '../src/lib/types';

/** 2 rows × 5 plots of 30×40 (feet) with a 30 ft road between the rows. */
export function sampleGrid() {
  const plots: { n: string; poly: Pt[] }[] = [];
  let n = 1;
  for (let row = 0; row < 2; row++) {
    const y0 = row === 0 ? 0 : 70;
    for (let col = 0; col < 5; col++) {
      const x0 = col * 30;
      plots.push({
        n: String(n++),
        poly: [
          { x: x0, y: y0 },
          { x: x0 + 30, y: y0 },
          { x: x0 + 30, y: y0 + 40 },
          { x: x0, y: y0 + 40 },
        ],
      });
    }
  }
  return plots;
}

export function lwpoly(w: DxfWriter, pts: Pt[], layer: string, closed = true) {
  const g: [number, string | number][] = [
    [0, 'LWPOLYLINE'],
    [8, layer],
    [90, pts.length],
    [70, closed ? 1 : 0],
  ];
  for (const p of pts) g.push([10, p.x], [20, p.y]);
  w.raw(g);
}

export function plainText(w: DxfWriter, s: string, p: Pt, h: number, layer: string) {
  w.raw([
    [0, 'TEXT'],
    [8, layer],
    [10, p.x],
    [20, p.y],
    [30, 0],
    [40, h],
    [1, s],
  ]);
}

export function mtext(w: DxfWriter, s: string, p: Pt, h: number, layer: string, attach = 5) {
  w.raw([
    [0, 'MTEXT'],
    [8, layer],
    [10, p.x],
    [20, p.y],
    [30, 0],
    [40, h],
    [71, attach],
    [1, s],
  ]);
}

/** Closed-polyline plots with plain TEXT numbers (bottom-left insertion). */
export function dxfClosedPolylines(): string {
  const w = new DxfWriter();
  for (const p of sampleGrid()) {
    lwpoly(w, p.poly, 'PLOTS');
    plainText(w, p.n, { x: p.poly[0].x + 13, y: p.poly[0].y + 18 }, 3, 'PLOT NO');
    // a dimension text inside the plot, near the edge
    plainText(w, "30'-0\"", { x: p.poly[0].x + 10, y: p.poly[0].y + 1 }, 1.5, 'DIMS');
  }
  // site boundary around everything (contains all numbers → must not become a plot)
  lwpoly(w, [{ x: -10, y: -10 }, { x: 160, y: -10 }, { x: 160, y: 120 }, { x: -10, y: 120 }], 'BOUNDARY');
  plainText(w, "30' WIDE ROAD", { x: 50, y: 53 }, 3, 'ROAD');
  return w.toString(2);
}

/** The same layout drawn with loose LINEs, gaps, overshoots, trees and MTEXT numbers. */
export function dxfLooseLines(): string {
  const w = new DxfWriter();
  const L = 'LAYOUT';
  for (const y0 of [0, 70]) {
    // long horizontal lines for each row; the top one overshoots by 0.5
    w.line({ x: 0, y: y0 }, { x: 150, y: y0 }, L);
    w.line({ x: -0.5, y: y0 + 40 }, { x: 150.5, y: y0 + 40 }, L);
    // vertical dividers; some stop 0.01 short of the lines (drafting gap)
    for (let c = 0; c <= 5; c++) {
      const gap = c % 2 ? 0.01 : 0;
      w.line({ x: c * 30, y: y0 + gap }, { x: c * 30, y: y0 + 40 - gap }, L);
    }
  }
  let n = 1;
  for (const y0 of [0, 70]) {
    for (let c = 0; c < 5; c++) {
      mtext(w, `{\\fArial|b1;${n++}}`, { x: c * 30 + 15, y: y0 + 20 }, 3, 'NUMBERS');
      // a tree (circle) inside the plot
      w.raw([
        [0, 'CIRCLE'],
        [8, 'TREES'],
        [10, c * 30 + 5],
        [20, y0 + 35],
        [30, 0],
        [40, 1],
      ]);
      // dimension number inside (smaller text, near an edge)
      plainText(w, '30', { x: c * 30 + 14, y: y0 + 0.8 }, 1.2, 'NUMBERS');
    }
  }
  return w.toString(2);
}

/** Plots as INSERTs of a block, with the plot number as an ATTRIB. */
export function dxfBlocksWithAttribs(): string {
  const lines: string[] = [];
  const g = (c: number, v: string | number) => lines.push(String(c), String(v));
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  g(70, 6);
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'BLOCK');
  g(8, '0');
  g(2, 'PLOTBLK');
  g(70, 2);
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(3, 'PLOTBLK');
  g(0, 'LWPOLYLINE');
  g(8, '0');
  g(90, 4);
  g(70, 1);
  for (const [x, y] of [
    [0, 0],
    [9, 0],
    [9, 12],
    [0, 12],
  ]) {
    g(10, x);
    g(20, y);
  }
  g(0, 'ENDBLK');
  g(8, '0');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (let i = 0; i < 6; i++) {
    const x = 100 + i * 9;
    const y = 200;
    g(0, 'INSERT');
    g(8, 'PLOTS');
    g(66, 1);
    g(2, 'PLOTBLK');
    g(10, x);
    g(20, y);
    g(30, 0);
    g(0, 'ATTRIB');
    g(8, 'PLOTNUM');
    g(10, x + 3);
    g(20, y + 5);
    g(30, 0);
    g(40, 1.2);
    g(1, `A-${i + 1}`);
    g(2, 'PLOTNO');
    g(70, 0);
    g(0, 'SEQEND');
    g(8, 'PLOTS');
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return lines.join('\n') + '\n';
}
