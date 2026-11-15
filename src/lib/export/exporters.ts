// Export a project to DXF (back to CAD), CSV (Excel) and an HTML report (→ PDF).

import { DxfWriter, triangulate } from '../cad/dxfWrite';
import { comparePlotNumbers } from '../cad/detect';
import { labelPoint, polygonToPath } from '../geometry';
import { STATUS_ACI, STATUS_COLOR, STATUS_FILL_SOLID, STATUS_LABEL } from '../status';
import type { LayoutData, Plot, Project, Pt } from '../types';
import { AREA_UNIT_SHORT, fmtDimensions, fmtMoney, fmtNum, plotArea, plotPrice } from '../units';

const INSUNITS: Record<Project['drawingUnit'], number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

/** Parse our own "M x yL x y...Z" background strings back into polylines. */
export function parsePaths(d: string): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  const re = /([MLZ])([^MLZ]*)/g;
  let cur: { pts: Pt[]; closed: boolean } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const cmd = m[1];
    if (cmd === 'Z') {
      if (cur) cur.closed = true;
      continue;
    }
    const nums = m[2].trim().split(/[\s,]+/).map(Number);
    const p = { x: nums[0], y: nums[1] };
    if (cmd === 'M') {
      cur = { pts: [p], closed: false };
      out.push(cur);
    } else if (cur) cur.pts.push(p);
  }
  return out;
}

export function exportDxf(project: Project, plots: Plot[], layout: LayoutData | null, opts: { fill: boolean } = { fill: true }): string {
  const w = new DxfWriter(4);
  const toCad = (p: Pt): Pt => ({ x: p.x + project.origin.x, y: project.origin.y - p.y });
  w.layer('LAYOUT', 8)
    .layer('LAYOUT_TEXT', 8)
    .layer('PLOT_AVAILABLE', STATUS_ACI.available)
    .layer('PLOT_BOOKED', STATUS_ACI.booked)
    .layer('PLOT_SOLD', STATUS_ACI.sold)
    .layer('PLOT_NUMBERS', 7)
    .layer('PLOT_STATUS', 7);
  if (opts.fill) {
    w.layer('PLOT_FILL_AVAILABLE', STATUS_ACI.available).layer('PLOT_FILL_BOOKED', STATUS_ACI.booked).layer('PLOT_FILL_SOLD', STATUS_ACI.sold);
  }

  for (const chunk of layout?.paths || []) {
    for (const l of parsePaths(chunk)) w.polyline(l.pts.map(toCad), l.closed, 'LAYOUT');
  }
  for (const t of layout?.texts || []) w.text(t.t, toCad(t), t.h, 'LAYOUT_TEXT', -t.r);

  for (const p of plots) {
    const poly = p.polygon.map(toCad);
    const suffix = p.status.toUpperCase();
    if (opts.fill) {
      for (const [a, b, c] of triangulate(poly)) w.solid(a, b, c, c, 'PLOT_FILL_' + suffix);
    }
    w.polyline(poly, true, 'PLOT_' + suffix);
    const lp = labelPoint(p.polygon);
    const h = Math.max(lp.radius * 0.6, 1e-3);
    const c = toCad(lp.pt);
    w.text(p.number, { x: c.x, y: c.y + h * 0.3 }, h * 0.8, 'PLOT_NUMBERS');
    w.text(STATUS_LABEL[p.status].toUpperCase(), { x: c.x, y: c.y - h * 0.55 }, h * 0.35, 'PLOT_STATUS', 0, STATUS_ACI[p.status]);
  }
  return w.toString(INSUNITS[project.drawingUnit]);
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function exportCsv(project: Project, plots: Plot[]): string {
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const header = [
    'Plot No',
    'Status',
    `Area (${au})`,
    'Dimensions',
    'Facing',
    'Corner',
    `Rate (per ${au})`,
    'Price',
    'Buyer',
    'Buyer phone',
    'Booking date',
    'Amount received',
    'Notes',
    'Last updated by',
    'Last updated',
  ];
  const rows = [...plots]
    .sort((a, b) => comparePlotNumbers(a.number, b.number))
    .map((p) => [
      p.number,
      STATUS_LABEL[p.status],
      plotArea(p, project).toFixed(2),
      fmtDimensions(p, project),
      p.facing || '',
      p.isCorner ? 'Yes' : '',
      p.rate ?? '',
      plotPrice(p, project) ?? '',
      p.buyerName || '',
      p.buyerPhone || '',
      p.bookingDate || '',
      p.amountReceived ?? '',
      p.notes || '',
      p.updatedByName || '',
      p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
    ]);
  // BOM so Excel opens UTF-8 (₹, names) correctly
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface Summary {
  total: number;
  available: number;
  booked: number;
  sold: number;
  areaTotal: number;
  areaSold: number;
  valueSold: number;
  received: number;
}

export function summarize(project: Project, plots: Plot[]): Summary {
  const s: Summary = { total: plots.length, available: 0, booked: 0, sold: 0, areaTotal: 0, areaSold: 0, valueSold: 0, received: 0 };
  for (const p of plots) {
    s[p.status]++;
    const a = plotArea(p, project);
    s.areaTotal += a;
    if (p.status !== 'available') {
      s.areaSold += a;
      s.valueSold += plotPrice(p, project) || 0;
    }
    s.received += p.amountReceived || 0;
  }
  return s;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Stand-alone SVG of the layout with coloured plots (used in the PDF report). */
export function layoutSvg(project: Project, plots: Plot[], layout: LayoutData | null): string {
  const b = project.bounds;
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const pad = Math.max(w, h) * 0.02;
  const sw = Math.max(w, h) / 1200;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}" style="width:100%;height:auto;background:#fff">`,
  );
  for (const d of layout?.paths || []) parts.push(`<path d="${d}" fill="none" stroke="#9aa0a6" stroke-width="${sw}"/>`);
  for (const p of plots) {
    parts.push(`<path d="${polygonToPath(p.polygon)}" fill="${STATUS_FILL_SOLID[p.status]}" stroke="${STATUS_COLOR[p.status]}" stroke-width="${sw * 1.5}"/>`);
  }
  for (const p of plots) {
    const lp = labelPoint(p.polygon);
    const fs = Math.max(lp.radius * 0.7, sw * 4);
    parts.push(
      `<text x="${lp.pt.x}" y="${lp.pt.y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica,Arial" font-weight="bold" fill="#1f2328">${esc(p.number)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

export function reportHtml(project: Project, plots: Plot[], layout: LayoutData | null): string {
  const s = summarize(project, plots);
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const sortedPlots = [...plots].sort((a, b) => comparePlotNumbers(a.number, b.number));
  const rows = sortedPlots
    .map(
      (p) => `<tr>
  <td><b>${esc(p.number)}</b></td>
  <td><span class="dot" style="background:${STATUS_COLOR[p.status]}"></span>${STATUS_LABEL[p.status]}</td>
  <td class="n">${fmtNum(plotArea(p, project))}</td>
  <td>${esc(fmtDimensions(p, project))}</td>
  <td>${esc(p.facing || '')}${p.isCorner ? ' (corner)' : ''}</td>
  <td class="n">${esc(fmtMoney(plotPrice(p, project), project.currency))}</td>
  <td>${esc(p.buyerName || '')}${p.buyerPhone ? '<br/><small>' + esc(p.buyerPhone) + '</small>' : ''}</td>
  <td>${esc(p.bookingDate || '')}</td>
</tr>`,
    )
    .join('');
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
body{font-family:Helvetica,Arial,sans-serif;color:#1f2328;margin:24px;font-size:12px}
h1{font-size:20px;margin:0 0 2px} .muted{color:#667085}
.cards{display:flex;gap:8px;margin:14px 0}
.card{flex:1;border:1px solid #e4e7ec;border-radius:8px;padding:8px 10px}
.card b{display:block;font-size:18px}
table{width:100%;border-collapse:collapse;margin-top:14px}
th,td{border-bottom:1px solid #e4e7ec;padding:5px 6px;text-align:left;vertical-align:top}
th{background:#f2f4f7;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:9px;height:9px;border-radius:5px;margin-right:5px}
.map{border:1px solid #e4e7ec;border-radius:8px;padding:6px;margin-top:8px;page-break-inside:avoid}
</style></head><body>
<h1>${esc(project.name)}</h1>
<div class="muted">${project.location ? esc(project.location) + ' · ' : ''}Inventory report · ${date}</div>
<div class="cards">
 <div class="card">Total plots<b>${s.total}</b></div>
 <div class="card" style="border-color:${STATUS_COLOR.available}">Available<b>${s.available}</b></div>
 <div class="card" style="border-color:${STATUS_COLOR.booked}">Booked<b>${s.booked}</b></div>
 <div class="card" style="border-color:${STATUS_COLOR.sold}">Sold<b>${s.sold}</b></div>
</div>
<div class="muted">Total area ${fmtNum(s.areaTotal)} ${au} · Booked/sold ${fmtNum(s.areaSold)} ${au} · Booked/sold value ${esc(fmtMoney(s.valueSold, project.currency))}</div>
<div class="map">${layoutSvg(project, plots, layout)}</div>
<table><thead><tr><th>Plot</th><th>Status</th><th>Area (${au})</th><th>Size</th><th>Facing</th><th>Price</th><th>Buyer</th><th>Booked on</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}
