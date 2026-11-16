// Plot price = area × (rate + per-unit premiums) × (1 + % premiums) + fixed premiums
// rate: plot's own rate → its block's rate → project base rate.
// An explicit total price on the plot always wins.

import { features } from './status';
import type { Plot, Premium, Project } from './types';
import { plotArea } from './units';

type ProjectLike = Pick<Project, 'drawingUnit' | 'areaUnit'> & Partial<Pick<Project, 'pricing' | 'features'>>;

export interface PriceBreakdown {
  area: number;
  rate: number | null;
  rateSource: 'plot' | 'block' | 'base' | null;
  premiums: Premium[];
  /** price before % and fixed premiums */
  base: number | null;
  total: number | null;
  explicit: boolean;
}

export function applicablePremiums(plot: Pick<Plot, 'premiums'>, project: ProjectLike): Premium[] {
  if (!features(project).pricing) return [];
  const ids = new Set(plot.premiums || []);
  return (project.pricing?.premiums || []).filter((p) => ids.has(p.id));
}

export function priceBreakdown(plot: Plot, project: ProjectLike): PriceBreakdown {
  const area = plotArea(plot, project);
  const pricingOn = features(project).pricing;
  const prem = applicablePremiums(plot, project);
  let rate: number | null = null;
  let rateSource: PriceBreakdown['rateSource'] = null;
  if (plot.rate != null && plot.rate > 0) {
    rate = plot.rate;
    rateSource = 'plot';
  } else if (pricingOn) {
    const br = plot.block ? project.pricing?.blockRates?.[plot.block] : undefined;
    if (br != null && br > 0) {
      rate = br;
      rateSource = 'block';
    } else if (project.pricing?.baseRate != null && project.pricing.baseRate > 0) {
      rate = project.pricing.baseRate;
      rateSource = 'base';
    }
  }
  let base: number | null = null;
  let total: number | null = null;
  if (rate != null) {
    const perUnit = prem.filter((p) => p.kind === 'perUnit').reduce((s, p) => s + p.value, 0);
    const pct = prem.filter((p) => p.kind === 'pct').reduce((s, p) => s + p.value, 0);
    const fixed = prem.filter((p) => p.kind === 'fixed').reduce((s, p) => s + p.value, 0);
    base = area * (rate + perUnit);
    total = Math.round(base * (1 + pct / 100) + fixed);
  }
  if (plot.price != null && plot.price > 0) {
    return { area, rate, rateSource, premiums: prem, base, total: plot.price, explicit: true };
  }
  return { area, rate, rateSource, premiums: prem, base, total, explicit: false };
}

export function plotPrice(plot: Plot, project: ProjectLike): number | null {
  return priceBreakdown(plot, project).total;
}

export function premiumText(p: Premium, currency: string, areaUnitShort: string): string {
  if (p.kind === 'pct') return `+${p.value}%`;
  if (p.kind === 'perUnit') return `+${currency}${p.value.toLocaleString('en-IN')}/${areaUnitShort}`;
  return `+${currency}${p.value.toLocaleString('en-IN')}`;
}
