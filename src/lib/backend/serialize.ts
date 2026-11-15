import { isPlotStatus } from '../status';
import type { Plot, PlotPatch, Pt } from '../types';

export const flatten = (poly: Pt[]): number[] => poly.flatMap((p) => [p.x, p.y]);

export function unflatten(a: unknown): Pt[] {
  if (!Array.isArray(a)) return [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: Number(a[i]), y: Number(a[i + 1]) });
  return out;
}

/** Firestore document for a plot (polygon stored as a flat number list; no nested arrays allowed). */
export function plotToDoc(p: PlotPatch): Record<string, unknown> {
  const { polygon, ...rest } = p as PlotPatch & { id?: string };
  delete (rest as { id?: string }).id;
  const doc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) doc[k] = v;
  if (polygon) doc.pts = flatten(polygon);
  return doc;
}

export function docToPlot(id: string, d: Record<string, any>): Plot {
  return {
    id,
    number: String(d.number ?? '?'),
    polygon: unflatten(d.pts),
    status: isPlotStatus(d.status) ? d.status : 'available',
    areaOverrideSqm: d.areaOverrideSqm ?? null,
    facing: d.facing ?? '',
    isCorner: !!d.isCorner,
    rate: d.rate ?? null,
    price: d.price ?? null,
    block: d.block ?? '',
    premiums: Array.isArray(d.premiums) ? d.premiums.map(String) : [],
    buyerName: d.buyerName ?? '',
    buyerPhone: d.buyerPhone ?? '',
    bookingDate: d.bookingDate ?? '',
    amountReceived: d.amountReceived ?? null,
    notes: d.notes ?? '',
    updatedAt: d.updatedAt ?? 0,
    updatedBy: d.updatedBy ?? '',
    updatedByName: d.updatedByName ?? '',
    soldBy: d.soldBy ?? '',
    pending: d.pending && isPlotStatus(d.pending.status) ? d.pending : null,
  };
}
