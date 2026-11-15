import { edgeLengths, polygonArea } from './geometry';
import type { AreaUnit, DrawingUnit, LengthUnit, Plot, Project } from './types';

/** Metres per drawing unit. */
export const DRAWING_UNIT_M: Record<DrawingUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
};

export const DRAWING_UNIT_LABEL: Record<DrawingUnit, string> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
  in: 'Inches',
  ft: 'Feet',
};

/** Square metres per area unit. */
export const AREA_UNIT_SQM: Record<AreaUnit, number> = {
  sqm: 1,
  sqft: 0.09290304,
  sqyd: 0.83612736,
};

export const AREA_UNIT_LABEL: Record<AreaUnit, string> = {
  sqft: 'sq.ft',
  sqyd: 'sq.yd (gaj)',
  sqm: 'sq.m',
};

export const AREA_UNIT_SHORT: Record<AreaUnit, string> = {
  sqft: 'sq.ft',
  sqyd: 'sq.yd',
  sqm: 'sq.m',
};

export const LENGTH_UNIT_M: Record<LengthUnit, number> = { ft: 0.3048, m: 1 };

/** Map DXF $INSUNITS header value to a drawing unit, if recognised. */
export function insunitsToDrawingUnit(code: unknown): DrawingUnit | null {
  switch (Number(code)) {
    case 1:
      return 'in';
    case 2:
      return 'ft';
    case 4:
      return 'mm';
    case 5:
      return 'cm';
    case 6:
      return 'm';
    default:
      return null;
  }
}

/**
 * Guess drawing units from the typical size of plots when the DXF header doesn't say.
 * A residential plot is usually 50–2000 m² and 5–60 m wide.
 */
export function guessDrawingUnit(typicalPlotWidth: number): DrawingUnit {
  if (!(typicalPlotWidth > 0)) return 'ft';
  if (typicalPlotWidth > 2000) return 'mm';
  if (typicalPlotWidth > 200) return 'cm';
  if (typicalPlotWidth > 30) return 'ft';
  return 'm';
}

export function computedAreaSqm(plot: Pick<Plot, 'polygon'>, unit: DrawingUnit): number {
  const f = DRAWING_UNIT_M[unit];
  return polygonArea(plot.polygon) * f * f;
}

export function plotAreaSqm(plot: Plot, unit: DrawingUnit): number {
  if (plot.areaOverrideSqm != null && plot.areaOverrideSqm > 0) return plot.areaOverrideSqm;
  return computedAreaSqm(plot, unit);
}

export function sqmTo(areaSqm: number, unit: AreaUnit): number {
  return areaSqm / AREA_UNIT_SQM[unit];
}

export function toSqm(area: number, unit: AreaUnit): number {
  return area * AREA_UNIT_SQM[unit];
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function plotArea(plot: Plot, project: Pick<Project, 'drawingUnit' | 'areaUnit'>): number {
  return sqmTo(plotAreaSqm(plot, project.drawingUnit), project.areaUnit);
}

export function fmtArea(plot: Plot, project: Pick<Project, 'drawingUnit' | 'areaUnit'>): string {
  return `${fmtNum(plotArea(plot, project))} ${AREA_UNIT_SHORT[project.areaUnit]}`;
}

/** Side lengths of a plot in the project's length unit. */
export function plotSides(plot: Pick<Plot, 'polygon'>, project: Pick<Project, 'drawingUnit' | 'lengthUnit'>): number[] {
  const f = DRAWING_UNIT_M[project.drawingUnit] / LENGTH_UNIT_M[project.lengthUnit];
  return edgeLengths(plot.polygon).map((l) => l * f);
}

/** "30 × 40 ft" for 4-sided plots, otherwise all sides. */
export function fmtDimensions(plot: Pick<Plot, 'polygon'>, project: Pick<Project, 'drawingUnit' | 'lengthUnit'>): string {
  const s = plotSides(plot, project);
  const u = project.lengthUnit === 'ft' ? 'ft' : 'm';
  if (s.length === 4) {
    const a = (s[0] + s[2]) / 2;
    const b = (s[1] + s[3]) / 2;
    const irregular = Math.abs(s[0] - s[2]) > 0.05 * a || Math.abs(s[1] - s[3]) > 0.05 * b;
    if (!irregular) return `${fmtNum(Math.min(a, b), 1)} × ${fmtNum(Math.max(a, b), 1)} ${u}`;
  }
  return s.map((v) => fmtNum(v, 1)).join(' / ') + ` ${u}`;
}

export function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${currency}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Total price: explicit price, else rate × area. */
export function plotPrice(plot: Plot, project: Pick<Project, 'drawingUnit' | 'areaUnit'>): number | null {
  if (plot.price != null && plot.price > 0) return plot.price;
  if (plot.rate != null && plot.rate > 0) return Math.round(plot.rate * plotArea(plot, project));
  return null;
}
