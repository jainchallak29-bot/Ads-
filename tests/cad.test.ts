import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLayout } from '../src/lib/cad/buildLayout';
import { comparePlotNumbers, detectPlots, suggestLayers } from '../src/lib/cad/detect';
import { asPlotNumber, cleanMText, readDxf } from '../src/lib/cad/dxfRead';
import { triangulate } from '../src/lib/cad/dxfWrite';
import { polygonize } from '../src/lib/cad/polygonize';
import { polygonArea } from '../src/lib/geometry';
import { dxfBlocksWithAttribs, dxfClosedPolylines, dxfLooseLines } from './helpers';

const sorted = (xs: string[]) => [...xs].sort(comparePlotNumbers);

test('asPlotNumber accepts plot numbers and rejects dimensions/areas', () => {
  for (const [input, want] of [
    ['12', '12'],
    ['A-12', 'A-12'],
    ['12A', '12A'],
    ['Plot No. 7', '7'],
    ['PLOT NO-45', '45'],
    ['p 3', 'P3'],
  ] as const) {
    assert.equal(asPlotNumber(input), want, input);
  }
  for (const bad of ["30'-0\"", '12.19', '1200 SQ.FT', '150.00 SQ.YDS', '9 M', 'ROAD', '', '45°', '30\'']) {
    assert.equal(asPlotNumber(bad), null, bad);
  }
});

test('cleanMText strips formatting codes', () => {
  assert.equal(cleanMText('{\\fArial|b1;12}'), '12');
  assert.equal(cleanMText('\\H2.5;PLOT\\P12'), 'PLOT\n12');
});

test('polygonize finds the faces of a grid drawn with lines', () => {
  const lines = [
    [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    [{ x: 0, y: 10 }, { x: 20, y: 10 }],
    [{ x: 0, y: 0 }, { x: 0, y: 10 }],
    [{ x: 10, y: 0 }, { x: 10, y: 10 }],
    [{ x: 20, y: 0 }, { x: 20, y: 10 }],
    // dangling line must be ignored
    [{ x: 20, y: 10 }, { x: 25, y: 15 }],
  ];
  const faces = polygonize(lines, lines.map(() => false), { tolerance: 0.001 });
  assert.equal(faces.length, 2);
  for (const f of faces) assert.ok(Math.abs(polygonArea(f) - 100) < 1e-6);
});

test('detects plots drawn as closed polylines', () => {
  const cad = readDxf(dxfClosedPolylines());
  assert.equal(cad.drawingUnit, 'ft');
  const layers = suggestLayers(cad);
  assert.ok(layers.numberLayers.includes('PLOT NO'));
  const r = detectPlots(cad, layers);
  assert.deepEqual(sorted(r.plots.map((p) => p.number)), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  for (const p of r.plots) assert.ok(Math.abs(polygonArea(p.polygon) - 1200) < 1e-6, `plot ${p.number}`);
  assert.equal(r.unmatched.length, 0);
});

test('detects plots drawn with loose lines (gaps, overshoots, trees, MTEXT)', () => {
  const cad = readDxf(dxfLooseLines());
  const layers = suggestLayers(cad);
  assert.ok(!layers.boundaryLayers.includes('TREES'));
  const r = detectPlots(cad, layers);
  assert.deepEqual(sorted(r.plots.map((p) => p.number)), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  for (const p of r.plots) {
    assert.equal(p.source, 'lines');
    assert.ok(Math.abs(polygonArea(p.polygon) - 1200) < 1, `plot ${p.number} area ${polygonArea(p.polygon)}`);
  }
});

test('detects plots from blocks with attribute plot numbers', () => {
  const cad = readDxf(dxfBlocksWithAttribs());
  assert.equal(cad.drawingUnit, 'm');
  const r = detectPlots(cad, suggestLayers(cad));
  assert.deepEqual(sorted(r.plots.map((p) => p.number)), ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
  const a1 = r.plots.find((p) => p.number === 'A-1')!;
  const xs = a1.polygon.map((p) => p.x);
  assert.equal(Math.min(...xs), 100);
  assert.equal(Math.max(...xs), 109);
});

test('buildLayout converts to map coordinates with Y down', () => {
  const cad = readDxf(dxfClosedPolylines());
  const r = detectPlots(cad, suggestLayers(cad));
  const built = buildLayout(cad, r.plots);
  assert.equal(built.plots.length, 10);
  // plot 1 is at the bottom-left in CAD (y 0..40) → bottom of the map (largest y)
  const p1 = built.plots.find((p) => p.number === '1')!;
  const p6 = built.plots.find((p) => p.number === '6')!;
  assert.ok(Math.min(...p1.polygon.map((p) => p.y)) > Math.max(...p6.polygon.map((p) => p.y)) - 1e-9);
  assert.ok(built.layout.paths.join('').startsWith('M'));
  assert.ok(built.layout.texts.some((t) => t.t.includes('ROAD')));
  // plot numbers are not repeated as background text
  assert.ok(!built.layout.texts.some((t) => t.t === '1'));
});

test('triangulate covers the polygon area', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ];
  const tris = triangulate(L);
  assert.equal(tris.length, 4);
  const total = tris.reduce((s, t) => s + polygonArea(t), 0);
  assert.ok(Math.abs(total - 3) < 1e-9);
});
