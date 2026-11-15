import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountStatus, amountInWords, commissionAmount, commissionPaid, emptyAccount, makeSchedule } from '../src/lib/finance';
import type { Plot, Project } from '../src/lib/types';

const project: Project = {
  id: 'p',
  name: 'T',
  ownerUid: 'u',
  drawingUnit: 'ft',
  areaUnit: 'sqft',
  lengthUnit: 'ft',
  currency: '₹',
  salesCanEdit: true,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  origin: { x: 0, y: 0 },
  createdAt: 0,
  updatedAt: 0,
  layoutVersion: 1,
};
const plot: Plot = {
  id: 'a',
  number: '1',
  status: 'booked',
  price: 1_000_000,
  polygon: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 40 },
    { x: 0, y: 40 },
  ],
};
let n = 0;
const newId = () => 'i' + n++;

test('payment plan adds up to the total', () => {
  const s = makeSchedule({ total: 1_000_000, token: 51_000, bookingPct: 25, count: 3, start: '2026-01-31', everyMonths: 1, newId });
  assert.equal(s.reduce((a, i) => a + i.amount, 0), 1_000_000);
  assert.equal(s[0].label, 'Token');
  assert.equal(s[0].amount, 51_000);
  assert.equal(s[1].amount, 250_000 - 51_000);
  assert.deepEqual(
    s.slice(2).map((i) => i.due),
    ['2026-02-28', '2026-03-31', '2026-04-30'],
  );
});

test('account status: paid, balance, overdue, next due', () => {
  const acc = {
    ...emptyAccount('a'),
    schedule: [
      { id: '1', label: 'Token', due: '2026-01-01', amount: 100_000 },
      { id: '2', label: 'I1', due: '2026-02-01', amount: 400_000 },
      { id: '3', label: 'I2', due: '2026-03-01', amount: 500_000 },
    ],
    payments: [{ id: 'p', date: '2026-01-02', amount: 300_000, mode: 'upi' as const }],
  };
  const st = accountStatus(plot, project, acc, '2026-02-15');
  assert.equal(st.price, 1_000_000);
  assert.equal(st.paid, 300_000);
  assert.equal(st.balance, 700_000);
  assert.equal(st.dueToDate, 500_000);
  assert.equal(st.overdue, 200_000);
  assert.equal(st.next?.label, 'I1');
  assert.equal(st.next?.remaining, 200_000);
  // agreed price overrides the list price
  assert.equal(accountStatus(plot, project, { ...acc, agreedPrice: 900_000 }).balance, 600_000);
});

test('commission: percent, per unit, fixed, override', () => {
  const broker = { id: 'b', name: 'B', commission: { kind: 'pct' as const, value: 2 } };
  const acc = { ...emptyAccount('a'), brokerId: 'b', commissionPayments: [{ id: 'c', date: '2026-01-01', amount: 5000 }] };
  assert.equal(commissionAmount(plot, project, acc, broker), 20_000);
  assert.equal(commissionAmount(plot, project, { ...acc, commission: { kind: 'perUnit', value: 10 } }, broker), 12_000);
  assert.equal(commissionAmount(plot, project, { ...acc, commission: { kind: 'fixed', value: 7000 } }, broker), 7000);
  assert.equal(commissionAmount(plot, project, { ...acc, brokerId: null }, broker), 0);
  assert.equal(commissionPaid(acc), 5000);
});

test('amount in words (Indian numbering)', () => {
  assert.equal(amountInWords(0), 'Zero');
  assert.equal(amountInWords(51000), 'Fifty One Thousand');
  assert.equal(amountInWords(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven');
  assert.equal(amountInWords(25_00_00_000), 'Twenty Five Crore');
  assert.equal(amountInWords(100), 'One Hundred');
});
