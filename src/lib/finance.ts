// Money calculations for payments, instalments, commission and receipts.

import { plotPrice } from './pricing';
import type { Broker, Commission, Instalment, Plot, PlotAccount, Project } from './types';
import { plotArea } from './units';

export function emptyAccount(plotId: string): PlotAccount {
  return { plotId, agreedPrice: null, schedule: [], payments: [], brokerId: null, commission: null, commissionPayments: [] };
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Price the buyer pays: agreed price, else the plot's list price. */
export function dealPrice(plot: Plot, project: Project, acc?: PlotAccount | null): number | null {
  if (acc?.agreedPrice != null && acc.agreedPrice > 0) return acc.agreedPrice;
  return plotPrice(plot, project);
}

export function totalPaid(acc?: PlotAccount | null): number {
  return (acc?.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
}

export function scheduledTotal(acc?: PlotAccount | null): number {
  return (acc?.schedule || []).reduce((s, p) => s + (p.amount || 0), 0);
}

export interface AccountStatus {
  price: number | null;
  paid: number;
  balance: number | null;
  /** sum of instalments due on or before `on` */
  dueToDate: number;
  overdue: number;
  /** first instalment not fully covered by payments */
  next: (Instalment & { remaining: number }) | null;
}

export function accountStatus(plot: Plot, project: Project, acc: PlotAccount | null | undefined, on = today()): AccountStatus {
  const price = dealPrice(plot, project, acc);
  const paid = totalPaid(acc);
  const sched = [...(acc?.schedule || [])].sort((a, b) => a.due.localeCompare(b.due));
  const dueToDate = sched.filter((i) => i.due <= on).reduce((s, i) => s + i.amount, 0);
  let covered = paid;
  let next: AccountStatus['next'] = null;
  for (const i of sched) {
    if (covered >= i.amount) {
      covered -= i.amount;
      continue;
    }
    next = { ...i, remaining: i.amount - covered };
    break;
  }
  return { price, paid, balance: price != null ? price - paid : null, dueToDate, overdue: Math.max(0, dueToDate - paid), next };
}

export function commissionAmount(plot: Plot, project: Project, acc: PlotAccount | null | undefined, broker: Broker | null | undefined): number {
  const c: Commission | null | undefined = acc?.commission ?? broker?.commission;
  if (!c || !acc?.brokerId) return 0;
  if (c.kind === 'fixed') return c.value;
  if (c.kind === 'perUnit') return Math.round(c.value * plotArea(plot, project));
  const price = dealPrice(plot, project, acc) || 0;
  return Math.round((price * c.value) / 100);
}

export function commissionPaid(acc?: PlotAccount | null): number {
  return (acc?.commissionPayments || []).reduce((s, p) => s + (p.amount || 0), 0);
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1 + months, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/**
 * Builds a payment plan: optional token, optional booking amount (% of the rest),
 * then equal monthly (or every N months) instalments for the balance.
 */
export function makeSchedule(opts: {
  total: number;
  token: number;
  bookingPct: number;
  count: number;
  start: string;
  everyMonths: number;
  newId: () => string;
}): Instalment[] {
  const out: Instalment[] = [];
  let rest = Math.max(0, Math.round(opts.total));
  if (opts.token > 0) {
    out.push({ id: opts.newId(), label: 'Token', due: opts.start, amount: Math.min(rest, Math.round(opts.token)) });
    rest -= out[0].amount;
  }
  if (opts.bookingPct > 0) {
    const b = Math.round((opts.total * opts.bookingPct) / 100) - (opts.token > 0 ? out[0].amount : 0);
    if (b > 0) {
      out.push({ id: opts.newId(), label: 'Booking amount', due: opts.start, amount: Math.min(rest, b) });
      rest -= Math.min(rest, b);
    }
  }
  const n = Math.max(1, Math.round(opts.count));
  const each = Math.floor(rest / n);
  for (let i = 0; i < n && rest > 0; i++) {
    const amt = i === n - 1 ? rest : each;
    out.push({ id: opts.newId(), label: n === 1 ? 'Balance' : `Instalment ${i + 1}`, due: addMonths(opts.start, opts.everyMonths * (i + 1)), amount: amt });
    rest -= amt;
  }
  return out;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + ' ' + ONES[n % 10]).trim();
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** 1234567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven" (Indian numbering). */
export function amountInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push((crore >= 100 ? amountInWords(crore) : twoDigits(crore)) + ' Crore');
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}

export const PAYMENT_MODE_LABEL = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank: 'Bank transfer', other: 'Other' } as const;
