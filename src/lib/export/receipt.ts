import { PAYMENT_MODE_LABEL, accountStatus, amountInWords } from '../finance';
import type { Payment, Plot, PlotAccount, Project } from '../types';
import { fmtArea, fmtMoney } from '../units';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  if (!y) return d;
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A one-page payment receipt (HTML for expo-print → PDF). */
export function receiptHtml(project: Project, plot: Plot, acc: PlotAccount, payment: Payment): string {
  const co = project.company;
  const st = accountStatus(plot, project, acc);
  // balance right after this payment (payments entered up to and including this one)
  const idx = acc.payments.findIndex((p) => p.id === payment.id);
  const paidUpTo = (idx >= 0 ? acc.payments.slice(0, idx + 1) : [...acc.payments, payment]).reduce((s, p) => s + p.amount, 0);
  const balance = st.price != null ? st.price - paidUpTo : null;
  const money = (n: number | null) => esc(fmtMoney(n, project.currency));
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
body{font-family:Helvetica,Arial,sans-serif;color:#1f2328;margin:24px;font-size:13px;max-width:720px}
.head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #1f2328;padding-bottom:12px}
.head img{max-height:64px;max-width:160px}
.co h1{margin:0;font-size:20px}.co div{color:#555;font-size:12px}
h2{text-align:center;letter-spacing:3px;margin:18px 0 6px;font-size:16px}
.meta{display:flex;justify-content:space-between;margin-bottom:14px}
table{width:100%;border-collapse:collapse}
td{padding:7px 8px;border-bottom:1px solid #e4e7ec;vertical-align:top}
td.l{color:#667085;width:34%}
.amt{font-size:22px;font-weight:700}
.words{font-style:italic;color:#444}
.sign{margin-top:56px;display:flex;justify-content:space-between}
.sign div{border-top:1px solid #999;padding-top:6px;width:200px;text-align:center;color:#555}
.note{margin-top:18px;color:#888;font-size:11px}
</style></head><body>
<div class="head">
 ${co?.logo ? `<img src="${co.logo}"/>` : ''}
 <div class="co"><h1>${esc(co?.name || project.name)}</h1>
 ${co?.address ? `<div>${esc(co.address)}</div>` : ''}
 <div>${[co?.phone, co?.email].filter(Boolean).map((x) => esc(x!)).join(' · ')}</div>
 ${co?.gstin ? `<div>GSTIN: ${esc(co.gstin)}</div>` : ''}</div>
</div>
<h2>PAYMENT RECEIPT</h2>
<div class="meta"><div><b>Receipt No.</b> ${payment.receiptNo ?? '-'}</div><div><b>Date</b> ${esc(fmtDate(payment.date))}</div></div>
<table>
<tr><td class="l">Received from</td><td><b>${esc(plot.buyerName || '-')}</b>${plot.buyerPhone ? ' · ' + esc(plot.buyerPhone) : ''}</td></tr>
<tr><td class="l">Project</td><td>${esc(project.name)}${project.location ? ', ' + esc(project.location) : ''}</td></tr>
<tr><td class="l">Plot</td><td>No. <b>${esc(plot.number)}</b>${plot.block ? ', Block ' + esc(plot.block) : ''} · ${esc(fmtArea(plot, project))}</td></tr>
<tr><td class="l">Amount received</td><td class="amt">${money(payment.amount)}</td></tr>
<tr><td class="l">In words</td><td class="words">Rupees ${esc(amountInWords(payment.amount))} only</td></tr>
<tr><td class="l">Mode</td><td>${esc(PAYMENT_MODE_LABEL[payment.mode] || payment.mode)}${payment.ref ? ' · Ref: ' + esc(payment.ref) : ''}</td></tr>
${payment.note ? `<tr><td class="l">Towards</td><td>${esc(payment.note)}</td></tr>` : ''}
<tr><td class="l">Plot price</td><td>${money(st.price)}</td></tr>
<tr><td class="l">Total received so far</td><td>${money(paidUpTo)}</td></tr>
<tr><td class="l">Balance</td><td><b>${money(balance)}</b></td></tr>
</table>
<div class="sign"><div>Customer</div><div>For ${esc(co?.name || project.name)}</div></div>
<div class="note">This is a computer generated receipt. Cheque payments are subject to realisation.</div>
</body></html>`;
}
