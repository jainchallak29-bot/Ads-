// Reads what is written inside each plot besides its number: the official area
// ("150.00 sq yd", "1200 sq ft", "125.4 sq m", "150 gaj") and the side lengths
// ("7.87/7.04 x 15.71"). Also infers the drawing unit from those areas and
// offers plot-number prefixes (A-12, EWS-3) as blocks.

import { boundsOf, pointInPolygon, polygonArea } from '../geometry';
import type { DrawingUnit, Pt } from '../types';
import { DRAWING_UNIT_M } from '../units';
import type { CadData, RawText } from './dxfRead';

const AREA_RE = /([\d,]*\d(?:\.\d+)?)\s*(sq\.?\s*y(?:ar)?ds?\.?|s\.?\s*yds?|gaj|sq\.?\s*f(?:ee)?t\.?|s\.?\s*ft\.?|sq\.?\s*m(?:trs?|ts?|eters?|etres?)?\.?|m2|m²)(?![a-z])/i;

/** "150.25 sq yd" → square metres (null if the text isn't an area). */
export function parseAreaLabel(text: string): number | null {
  const m = text.replace(/²/g, '²').match(AREA_RE);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  const u = m[2].toLowerCase().replace(/[\s.]/g, '');
  if (u.startsWith('sqy') || u.startsWith('sy') || u === 'gaj') return v * 0.83612736;
  if (u.startsWith('sqf') || u.startsWith('sf')) return v * 0.09290304;
  return v; // square metres
}

/** Side-length text such as "7 x 15.7", "11.13/9.60 x" or "15.79/15.7". */
export function isSizeText(text: string): boolean {
  const t = text.trim();
  if (!/\d/.test(t) || parseAreaLabel(t) != null) return false;
  if (!/^[\d\s.,'"/x×*+-]+$/i.test(t)) return false;
  return /[x×*/]/i.test(t);
}

function normaliseSize(parts: string[]): string {
  return parts
    .join(' ')
    .replace(/\s*[x×*]\s*/gi, ' x ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^x\s+|\s+x$/g, '');
}

export interface PlotLabels {
  /** official area written inside the plot, square metres */
  areaSqm?: number;
  /** side lengths as written, e.g. "7.87/7.04 x 15.71" */
  size?: string;
  used: RawText[];
}

/** Labels inside each plot (polygons in CAD coordinates). The plot-number texts are skipped. */
export function readPlotLabels(cad: CadData, plots: { polygon: Pt[] }[], skip: Set<RawText>): PlotLabels[] {
  // simple grid index of texts
  const size = Math.max(cad.bounds.maxX - cad.bounds.minX, cad.bounds.maxY - cad.bounds.minY) / 200 || 1;
  const grid = new Map<string, RawText[]>();
  for (const t of cad.texts) {
    if (skip.has(t)) continue;
    const k = Math.floor(t.x / size) + ',' + Math.floor(t.y / size);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(t);
  }
  return plots.map((p) => {
    const b = boundsOf(p.polygon);
    const inside: RawText[] = [];
    for (let gx = Math.floor(b.minX / size); gx <= Math.floor(b.maxX / size); gx++) {
      for (let gy = Math.floor(b.minY / size); gy <= Math.floor(b.maxY / size); gy++) {
        for (const t of grid.get(gx + ',' + gy) || []) if (pointInPolygon(t, p.polygon)) inside.push(t);
      }
    }
    const out: PlotLabels = { used: [] };
    for (const t of inside) {
      const a = parseAreaLabel(t.text);
      if (a != null && out.areaSqm == null) {
        out.areaSqm = a;
        out.used.push(t);
      } else if (a != null) out.used.push(t);
    }
    // size texts in reading order (top to bottom, then left to right)
    const sizes = inside.filter((t) => isSizeText(t.text)).sort((s, t) => t.y - s.y || s.x - t.x);
    // "7/6.9 x" continued on the next line by a bare number ("15")
    const last = sizes[sizes.length - 1];
    if (last && /[x×*]\s*$/i.test(last.text)) {
      const next = inside
        .filter((t) => /^\d+(\.\d+)?$/.test(t.text.trim()) && t.y < last.y && t.y > last.y - last.h * 3)
        .sort((s, t) => t.y - s.y)[0];
      if (next) sizes.push(next);
    }
    if (sizes.length) {
      out.size = normaliseSize(sizes.map((t) => t.text));
      out.used.push(...sizes);
    }
    return out;
  });
}

/**
 * Drawing unit from the written areas: written m² ÷ drawn area ≈ (metres per unit)².
 * Returns null when there are too few labels or no unit fits.
 */
export function inferUnitFromAreas(pairs: { drawn: number; labelSqm: number }[]): DrawingUnit | null {
  const ratios = pairs.filter((p) => p.drawn > 0 && p.labelSqm > 0).map((p) => p.labelSqm / p.drawn);
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const r = ratios[Math.floor(ratios.length / 2)];
  let best: DrawingUnit | null = null;
  let bestErr = Infinity;
  for (const u of Object.keys(DRAWING_UNIT_M) as DrawingUnit[]) {
    const err = Math.abs(Math.log(r / DRAWING_UNIT_M[u] ** 2));
    if (err < bestErr) {
      bestErr = err;
      best = u;
    }
  }
  return bestErr < Math.log(1.6) ? best : null;
}

/** "A-12" → "A", "EWS-3" → "EWS". Returns per-plot prefixes when most numbers have one and there are at least two. */
export function prefixBlocks(numbers: string[]): string[] | null {
  const pre = numbers.map((n) => n.match(/^([A-Z]{1,4})[\s\-/]/)?.[1] ?? '');
  const withPrefix = pre.filter(Boolean).length;
  if (withPrefix < numbers.length * 0.5 || new Set(pre.filter(Boolean)).size < 2) return null;
  return pre;
}

/** How many written areas differ from the drawn shape by more than `tol` (fraction). */
export function areaMismatches(plots: { polygon: Pt[] }[], labels: PlotLabels[], unit: DrawingUnit, tol = 0.01): number {
  const f = DRAWING_UNIT_M[unit] ** 2;
  let n = 0;
  plots.forEach((p, i) => {
    const a = labels[i]?.areaSqm;
    if (a && Math.abs(polygonArea(p.polygon) * f - a) > a * tol) n++;
  });
  return n;
}
