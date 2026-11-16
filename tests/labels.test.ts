import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectPlots, suggestLayers } from '../src/lib/cad/detect';
import { asPlotNumber, readDxf } from '../src/lib/cad/dxfRead';
import { DxfWriter } from '../src/lib/cad/dxfWrite';
import { inferUnitFromAreas, isSizeText, parseAreaLabel, prefixBlocks, readPlotLabels } from '../src/lib/cad/labels';
import { buildLayout } from '../src/lib/cad/buildLayout';
import { fmtDimensions } from '../src/lib/units';
import { lwpoly, plainText } from './helpers';

test('area and size labels', () => {
  assert.ok(Math.abs(parseAreaLabel('131.44 sq yd')! - 109.9) < 0.01);
  assert.ok(Math.abs(parseAreaLabel('1,200 SQ.FT.')! - 111.48) < 0.01);
  assert.equal(parseAreaLabel('125.5 sq m'), 125.5);
  assert.equal(parseAreaLabel('(5,501.34 sq yd)')! > 4599, true);
  assert.ok(Math.abs(parseAreaLabel('150 Gaj')! - 125.42) < 0.01);
  assert.equal(parseAreaLabel('B-12'), null);
  assert.equal(parseAreaLabel('9.0 M WIDE ROAD'), null);
  for (const t of ['7 x 15.7', '11.13/9.60 x', '15.79/15.7', "30'x40'"]) assert.ok(isSizeText(t), t);
  for (const t of ['B-1', '131.44 sq yd', 'PARK', '12']) assert.ok(!isSizeText(t), t);
  assert.equal(asPlotNumber('A-?'), 'A-?');
});

test('unit from written areas, prefixes as blocks', () => {
  assert.equal(inferUnitFromAreas([1, 2, 3].map(() => ({ drawn: 100, labelSqm: 101 }))), 'm');
  assert.equal(inferUnitFromAreas([1, 2, 3].map(() => ({ drawn: 1200, labelSqm: 111.5 }))), 'ft');
  assert.equal(inferUnitFromAreas([1, 2, 3].map(() => ({ drawn: 1.2e8, labelSqm: 120 }))), 'mm');
  assert.equal(inferUnitFromAreas([{ drawn: 1, labelSqm: 1 }]), null);
  assert.deepEqual(prefixBlocks(['A-1', 'A-2', 'EWS-3', 'B-4']), ['A', 'A', 'EWS', 'B']);
  assert.equal(prefixBlocks(['1', '2', '3', 'A-4']), null);
  assert.equal(prefixBlocks(['A-1', 'A-2']), null);
});

test('a drawing like a real layout: written areas, split size texts, unknown and missing numbers', () => {
  const w = new DxfWriter();
  const sq = (x: number, y: number) => [
    { x, y },
    { x: x + 7, y },
    { x: x + 7, y: y + 15 },
    { x, y: y + 15 },
  ];
  for (let i = 0; i < 8; i++) {
    lwpoly(w, sq(i * 7, 0), 'PLOTS');
    // number missing on plot 7 (index 6), unknown "A-?" on plot 8 (index 7)
    if (i < 6) plainText(w, `A-${i + 1}`, { x: i * 7 + 2, y: 9 }, 1.2, 'PLOT_NUMBER');
    if (i === 7) plainText(w, 'A-?', { x: i * 7 + 2, y: 9 }, 1.2, 'PLOT_NUMBER');
    plainText(w, '7/6.9 x', { x: i * 7 + 1, y: 6 }, 0.6, 'PLOT_DIMENSIONS');
    plainText(w, '15', { x: i * 7 + 1, y: 5 }, 0.6, 'PLOT_DIMENSIONS');
    plainText(w, '131.44 sq yd', { x: i * 7 + 1, y: 3 }, 0.6, 'PLOT_AREA_SQYD');
  }
  const cad = readDxf(w.toString());
  const r = detectPlots(cad, suggestLayers(cad));
  assert.equal(r.plots.length, 8);
  assert.deepEqual(r.placeholders.sort(), ['?1', 'A-?1']);
  const used = new Set(r.plots.map((p) => p.numberText!).filter(Boolean));
  const labels = readPlotLabels(cad, r.plots, used);
  assert.ok(labels.every((l) => l.areaSqm && Math.abs(l.areaSqm - 109.9) < 0.01));
  // "7/6.9 x" continues on the next line with a bare "15"
  assert.equal(labels[0].size, '7/6.9 x 15');
  assert.equal(inferUnitFromAreas(r.plots.map((p, i) => ({ drawn: 105, labelSqm: labels[i].areaSqm! }))), 'm');
  const built = buildLayout(cad, r.plots, { includeTexts: true, skipTexts: new Set(labels.flatMap((l) => l.used)) });
  assert.ok(!built.layout.texts.some((t) => t.t.includes('sq yd')), 'area labels are not background text');
  assert.equal(fmtDimensions({ polygon: [], sizeLabel: '7 x 15.7' }, { drawingUnit: 'm', lengthUnit: 'ft' }), '7 x 15.7 m');
});
