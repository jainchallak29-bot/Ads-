import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectPlots, suggestLayers } from '../src/lib/cad/detect';
import { readDxf } from '../src/lib/cad/dxfRead';
import { exportCsv, exportDxf, parsePaths, reportHtml, summarize } from '../src/lib/export/exporters';
import { polygonArea } from '../src/lib/geometry';
import { deleteCorner, insertCorner, isSimplePolygon, mergePlots, moveCorner, snapPoint, splitNames, splitPlot } from '../src/lib/shapes';
import type { Plot, Project, Pt } from '../src/lib/types';
import { plotPrice, priceBreakdown } from '../src/lib/pricing';
import { fmtDimensions, plotArea } from '../src/lib/units';

const sq = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const project: Project = {
  id: 'p1',
  name: 'Green Valley',
  location: 'Jaipur',
  ownerUid: 'u1',
  drawingUnit: 'ft',
  areaUnit: 'sqyd',
  lengthUnit: 'ft',
  currency: '₹',
  salesCanEdit: true,
  bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
  origin: { x: 1000, y: 2000 },
  createdAt: 0,
  updatedAt: 0,
  layoutVersion: 1,
};

test('merge two touching plots', () => {
  const m = mergePlots(sq(0, 0, 30, 40), sq(30, 0, 30, 40));
  assert.equal(m.length, 4);
  assert.ok(Math.abs(polygonArea(m) - 2400) < 1e-6);
  assert.throws(() => mergePlots(sq(0, 0, 30, 40), sq(100, 0, 30, 40)), /do not touch/);
});

test('split a plot with a line', () => {
  const pieces = splitPlot(sq(0, 0, 30, 40), { x: 15, y: -5 }, { x: 15, y: 50 });
  assert.equal(pieces.length, 2);
  for (const p of pieces) assert.ok(Math.abs(polygonArea(p) - 600) < 1e-6);
  assert.throws(() => splitPlot(sq(0, 0, 30, 40), { x: 100, y: 0 }, { x: 100, y: 10 }), /across/);
  assert.deepEqual(splitNames('12', 2, new Set(['12A'])), ['12B', '12C']);
});

test('corner editing and snapping', () => {
  const p = sq(0, 0, 10, 10);
  assert.equal(insertCorner(p, 0).length, 5);
  assert.deepEqual(insertCorner(p, 0)[1], { x: 5, y: 0 });
  assert.equal(deleteCorner(insertCorner(p, 0), 1).length, 4);
  assert.throws(() => deleteCorner(sq(0, 0, 1, 1).slice(0, 3), 0));
  assert.deepEqual(moveCorner(p, 2, { x: 12, y: 12 })[2], { x: 12, y: 12 });
  assert.ok(!isSimplePolygon(moveCorner(p, 2, { x: -5, y: 5 })));
  assert.ok(isSimplePolygon(p));
  assert.deepEqual(snapPoint({ x: 10.2, y: 9.9 }, [p], 0.5), { x: 10, y: 10 });
  assert.deepEqual(snapPoint({ x: 5, y: 0.1 }, [p], 0.5), { x: 5, y: 0 });
});

test('units: area, dimensions, price', () => {
  const plot: Plot = { id: 'a', number: '1', polygon: sq(0, 0, 30, 40), status: 'sold', rate: 10000 };
  // 1200 sq ft = 133.33 sq yd
  assert.ok(Math.abs(plotArea(plot, project) - 133.333) < 0.01);
  assert.equal(fmtDimensions(plot, project), '30 × 40 ft');
  assert.equal(plotPrice(plot, project), 1333333);
  assert.equal(plotPrice({ ...plot, price: 999 }, project), 999);
  assert.ok(Math.abs(plotArea({ ...plot, areaOverrideSqm: 100 }, { ...project, areaUnit: 'sqm' }) - 100) < 1e-9);
});

test('DXF export round-trips through the importer', () => {
  const plots: Plot[] = [
    { id: 'a', number: '1', polygon: sq(0, 0, 30, 40), status: 'sold' },
    { id: 'b', number: '2', polygon: sq(30, 0, 30, 40), status: 'available' },
  ];
  const dxf = exportDxf(project, plots, { paths: ['M0 0L60 0L60 40L0 40Z'], texts: [{ t: 'ROAD', x: 30, y: 45, h: 2, r: 0 }] });
  assert.ok(dxf.includes('PLOT_SOLD'));
  const cad = readDxf(dxf);
  assert.equal(cad.drawingUnit, 'ft');
  const r = detectPlots(cad, { boundaryLayers: ['PLOT_SOLD', 'PLOT_AVAILABLE'], numberLayers: ['PLOT_NUMBERS'] });
  assert.equal(r.plots.length, 2);
  const one = r.plots.find((p) => p.number === '1')!;
  // back in CAD coordinates: x + 1000, 2000 - y
  const xs = one.polygon.map((p) => p.x);
  const ys = one.polygon.map((p) => p.y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [1000, 1030]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [1960, 2000]);
  // default layer suggestion also works on our own export
  assert.equal(detectPlots(cad, suggestLayers(cad)).plots.length, 2);
});

test('parsePaths reads background strings', () => {
  const ls = parsePaths('M0 0L1 1L2 0ZM5 5L6 6');
  assert.equal(ls.length, 2);
  assert.equal(ls[0].closed, true);
  assert.equal(ls[1].pts.length, 2);
});

test('CSV and report', () => {
  const plots: Plot[] = [
    { id: 'a', number: '10', polygon: sq(0, 0, 30, 40), status: 'sold', buyerName: 'Ravi, Kumar', rate: 5000 },
    { id: 'b', number: '2', polygon: sq(30, 0, 30, 40), status: 'available' },
  ];
  const csv = exportCsv(project, plots);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('2,'), 'sorted naturally');
  assert.ok(lines[2].includes('"Ravi, Kumar"'));
  const s = summarize(project, plots);
  assert.equal(s.counts.sold, 1);
  assert.equal(s.available, 1);
  assert.equal(s.taken, 1);
  const html = reportHtml(project, plots, null);
  assert.ok(html.includes('Green Valley') && html.includes('<svg'));
});

test('price list: base rate, block rate, plot rate and premiums', () => {
  const pricing = {
    baseRate: 10000,
    blockRates: { B: 12000 },
    premiums: [
      { id: 'corner', name: 'Corner', kind: 'pct' as const, value: 10 },
      { id: 'park', name: 'Park facing', kind: 'perUnit' as const, value: 500 },
      { id: 'fee', name: 'Club', kind: 'fixed' as const, value: 50000 },
    ],
  };
  const pr = { ...project, pricing };
  const base: Plot = { id: 'a', number: '1', polygon: sq(0, 0, 30, 40), status: 'available' }; // 133.33 sq.yd
  assert.equal(plotPrice(base, pr), Math.round((1200 / 9) * 10000));
  assert.equal(plotPrice({ ...base, block: 'B' }, pr), Math.round((1200 / 9) * 12000));
  assert.equal(plotPrice({ ...base, block: 'B', rate: 9000 }, pr), Math.round((1200 / 9) * 9000));
  const all = { ...base, premiums: ['corner', 'park', 'fee'] };
  assert.equal(plotPrice(all, pr), Math.round((1200 / 9) * 10500 * 1.1 + 50000));
  assert.equal(priceBreakdown(all, pr).premiums.length, 3);
  // explicit price wins; pricing switched off ignores the price list
  assert.equal(plotPrice({ ...all, price: 777 }, pr), 777);
  assert.equal(plotPrice(all, { ...pr, features: { pricing: false } }), null);
});

test('sharing: plot text, layout PDF, public snapshot', async () => {
  const { layoutPdfHtml, plotPdfHtml, plotShareText } = await import('../src/lib/export/exporters');
  const { buildPublic, publicStatuses, shareUrl } = await import('../src/lib/publicLayout');
  const plots: Plot[] = [
    { id: 'a', number: '1', polygon: sq(0, 0, 30, 40), status: 'sold', buyerName: 'Secret Buyer', price: 500000 },
    { id: 'b', number: '2', polygon: sq(30, 0, 30, 40), status: 'available', block: 'A', price: 600000 },
  ];
  const txt = plotShareText({ ...project, company: { name: 'GV Devs', phone: '98765' } }, plots[1], { price: true, url: 'https://x/share/t?plot=2' });
  assert.ok(txt.includes('Plot 2 (Block A)') && txt.includes('₹6,00,000') && txt.includes('GV Devs 98765') && txt.split('\n').length > 4);
  assert.ok(!plotShareText(project, plots[1], { price: false }).includes('Price'));
  const team = layoutPdfHtml(project, plots, null, 'team');
  const cust = layoutPdfHtml(project, plots, null, 'customer');
  assert.ok(team.includes('Sold 1') && cust.includes('Not available 1') && !cust.includes('Secret Buyer'));
  assert.ok(plotPdfHtml(project, plots[1], plots, null, { price: true }).includes('Plot 2'));
  const pub = buildPublic(project, plots, false);
  assert.ok(!JSON.stringify(pub).includes('Secret Buyer'), 'no buyer data in public snapshot');
  assert.equal(pub.plots.b.p, undefined, 'prices hidden');
  assert.equal(buildPublic(project, plots, true).plots.b.p, 600000);
  assert.deepEqual(publicStatuses(plots), { a: 'n', b: 'a' });
  assert.notEqual(buildPublic(project, plots, true).rev, pub.rev);
  assert.equal(shareUrl('https://gv.web.app/', 'tok', '12A'), 'https://gv.web.app/share/tok?plot=12A');
});
