// Generates samples/sample-layout.dxf: a small plotted colony drawn the way many
// layout plans are (loose LINEs in feet, plot numbers as text, roads, a park).
// Run: npx tsx scripts/make-sample-dxf.ts
import { mkdirSync, writeFileSync } from 'node:fs';

import { DxfWriter } from '../src/lib/cad/dxfWrite';

const w = new DxfWriter(3);
w.layer('SITE BOUNDARY', 1).layer('PLOT LINES', 7).layer('PLOT NO', 3).layer('DIMENSIONS', 8).layer('ROAD TEXT', 4).layer('TREES', 3);

const L = 'PLOT LINES';
const plotW = 30;
const plotD = 50;
const perRow = 8;
const road = 30;
let num = 1;

const text = (s: string, x: number, y: number, h: number, layer: string, rot = 0) => w.text(s, { x, y }, h, layer, rot);

// Two blocks, each two rows of plots back to back, separated by a 30' road; a 40' road at the bottom.
const blocks = [0, 2 * plotD + road];
for (const by of blocks) {
  const width = perRow * plotW;
  for (const y of [by, by + plotD, by + 2 * plotD]) w.line({ x: 0, y }, { x: width, y }, L);
  for (let c = 0; c <= perRow; c++) {
    w.line({ x: c * plotW, y: by }, { x: c * plotW, y: by + 2 * plotD }, L);
  }
  for (const row of [1, 0]) {
    for (let c = 0; c < perRow; c++) {
      const x0 = c * plotW;
      const y0 = by + row * plotD;
      text(String(num++), x0 + plotW / 2, y0 + plotD / 2, 6, 'PLOT NO');
      text(`${plotW}'`, x0 + plotW / 2, row ? y0 + plotD - 3 : y0 + 3, 2.2, 'DIMENSIONS');
      text(`${plotD}'`, x0 + 3, y0 + plotD / 2, 2.2, 'DIMENSIONS', 90);
    }
  }
}

// Park to the right of the blocks with trees
const parkX = perRow * plotW + road;
const parkTop = blocks[1] + 2 * plotD;
w.polyline(
  [
    { x: parkX, y: 0 },
    { x: parkX + 110, y: 0 },
    { x: parkX + 110, y: parkTop },
    { x: parkX, y: parkTop },
  ],
  true,
  L,
);
text('PARK', parkX + 55, parkTop / 2, 10, 'ROAD TEXT');
for (let i = 0; i < 10; i++) {
  w.raw([
    [0, 'CIRCLE'],
    [8, 'TREES'],
    [10, parkX + 15 + (i % 5) * 20],
    [20, 25 + Math.floor(i / 5) * (parkTop - 50)],
    [30, 0],
    [40, 4],
  ]);
}

// Corner plots along the right side of the park (irregular shapes)
const cx = parkX + 110 + road;
const cornerRows = 5;
const cornerH = parkTop / cornerRows;
for (let i = 0; i <= cornerRows; i++) w.line({ x: cx, y: i * cornerH }, { x: cx + 45 + (i % 2) * 5, y: i * cornerH }, L);
w.line({ x: cx, y: 0 }, { x: cx, y: parkTop }, L);
for (let i = 0; i < cornerRows; i++) {
  w.line({ x: cx + 45 + (i % 2) * 5, y: i * cornerH }, { x: cx + 45 + ((i + 1) % 2) * 5, y: (i + 1) * cornerH }, L);
  text(String(num++), cx + 24, i * cornerH + cornerH / 2, 6, 'PLOT NO');
}

// Roads & site boundary
text("30' WIDE ROAD", (perRow * plotW) / 2, 2 * plotD + road / 2, 5, 'ROAD TEXT');
text("30' WIDE ROAD", parkX - road / 2, parkTop / 2, 5, 'ROAD TEXT', 90);
text("30' WIDE ROAD", cx - road / 2, parkTop / 2, 5, 'ROAD TEXT', 90);
text("40' WIDE MAIN ROAD", (cx + 50) / 2, -20, 6, 'ROAD TEXT');
w.polyline(
  [
    { x: -10, y: -40 },
    { x: cx + 60, y: -40 },
    { x: cx + 60, y: parkTop + 10 },
    { x: -10, y: parkTop + 10 },
  ],
  true,
  'SITE BOUNDARY',
);
text('GREEN VALLEY - LAYOUT PLAN', (cx + 50) / 2, parkTop + 25, 9, 'ROAD TEXT');

mkdirSync('samples', { recursive: true });
writeFileSync('samples/sample-layout.dxf', w.toString(2));
console.log(`samples/sample-layout.dxf written with ${num - 1} plots`);
