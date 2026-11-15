// Export a project to DXF (back to CAD), CSV (Excel) and an HTML report (→ PDF).

import { DxfWriter, triangulate } from '../cad/dxfWrite';
import { comparePlotNumbers } from '../cad/detect';
import { labelPoint, polygonToPath } from '../geometry';
import { applicablePremiums, plotPrice } from '../pricing';
import { STATUS_ACI, STATUS_COLOR, STATUS_FILL_SOLID, enabledStatuses, isTaken, statusLabel } from '../status';
import { ALL_STATUSES, type LayoutData, type Plot, type PlotStatus, type Project, type Pt } from '../types';
import { AREA_UNIT_SHORT, fmtDimensions, fmtMoney, fmtNum, plotArea } from '../units';

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
  w.layer('LAYOUT', 8).layer('LAYOUT_TEXT', 8).layer('PLOT_NUMBERS', 7).layer('PLOT_STATUS', 7);
  const used = new Set<PlotStatus>([...enabledStatuses(project), ...plots.map((p) => p.status)]);
  for (const st of ALL_STATUSES.filter((x) => used.has(x))) {
    w.layer('PLOT_' + st.toUpperCase(), STATUS_ACI[st]);
    if (opts.fill) w.layer('PLOT_FILL_' + st.toUpperCase(), STATUS_ACI[st]);
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
    w.text(statusLabel(project, p.status).toUpperCase(), { x: c.x, y: c.y - h * 0.55 }, h * 0.35, 'PLOT_STATUS', 0, STATUS_ACI[p.status]);
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
    'Block',
    'Status',
    `Area (${au})`,
    'Dimensions',
    'Facing',
    'Corner',
    'Premiums',
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
      p.block || '',
      statusLabel(project, p.status),
      plotArea(p, project).toFixed(2),
      fmtDimensions(p, project),
      p.facing || '',
      p.isCorner ? 'Yes' : '',
      applicablePremiums(p, project)
        .map((x) => x.name)
        .join('; '),
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
  counts: Record<PlotStatus, number>;
  available: number;
  /** token … sold */
  taken: number;
  areaTotal: number;
  areaTaken: number;
  valueTaken: number;
  received: number;
}

export function summarize(project: Project, plots: Plot[]): Summary {
  const counts = Object.fromEntries(ALL_STATUSES.map((x) => [x, 0])) as Record<PlotStatus, number>;
  const s: Summary = { total: plots.length, counts, available: 0, taken: 0, areaTotal: 0, areaTaken: 0, valueTaken: 0, received: 0 };
  for (const p of plots) {
    counts[p.status]++;
    const a = plotArea(p, project);
    s.areaTotal += a;
    if (isTaken(p.status)) {
      s.taken++;
      s.areaTaken += a;
      s.valueTaken += plotPrice(p, project) || 0;
    }
    s.received += p.amountReceived || 0;
  }
  s.available = counts.available;
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
  <td><b>${esc(p.number)}</b>${p.block ? '<br/><small>' + esc(p.block) + '</small>' : ''}</td>
  <td><span class="dot" style="background:${STATUS_COLOR[p.status]}"></span>${esc(statusLabel(project, p.status))}</td>
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
 ${enabledStatuses(project)
   .map((st) => `<div class="card" style="border-color:${STATUS_COLOR[st]}">${esc(statusLabel(project, st))}<b>${s.counts[st]}</b></div>`)
   .join('')}
</div>
<div class="muted">Total area ${fmtNum(s.areaTotal)} ${au} · Booked/sold ${fmtNum(s.areaTaken)} ${au} · Booked/sold value ${esc(fmtMoney(s.valueTaken, project.currency))}</div>
<div class="map">${layoutSvg(project, plots, layout)}</div>
<table><thead><tr><th>Plot</th><th>Status</th><th>Area (${au})</th><th>Size</th><th>Facing</th><th>Price</th><th>Buyer</th><th>Booked on</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}
