import type { Lead, LeadSource, LeadStage } from './types';

export const LEAD_STAGES: LeadStage[] = ['new', 'contacted', 'visit', 'negotiation', 'won', 'lost'];

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  visit: 'Site visit',
  negotiation: 'Negotiation',
  won: 'Booked',
  lost: 'Lost',
};

export const STAGE_COLOR: Record<LeadStage, string> = {
  new: '#3B82C4',
  contacted: '#0C8599',
  visit: '#7048E8',
  negotiation: '#E2A400',
  won: '#2E9F5B',
  lost: '#868E96',
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  walkin: 'Walk-in',
  call: 'Phone call',
  broker: 'Broker',
  online: 'Online / ad',
  reference: 'Reference',
  other: 'Other',
};

export const isOpen = (l: Lead) => l.stage !== 'won' && l.stage !== 'lost';

/** Follow-ups due today or earlier (open leads only). */
export function isDue(l: Lead, today: string): boolean {
  return isOpen(l) && !!l.nextFollowUp && l.nextFollowUp <= today;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** "Plot 12, 14 A" → ["12", "14A"] */
export function parsePlotList(s: string): string[] {
  return [...new Set(s.split(/[,;\n]+/).map((x) => x.trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean))];
}

export function whatsappUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  const full = digits.length === 10 ? '91' + digits : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
