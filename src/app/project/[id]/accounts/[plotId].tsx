import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { SheetModal } from '@/components/SheetModal';
import { Banner, Button, Card, Field, H, IconButton, InfoRow, Loading, Muted, Row, Screen, Segmented, Toggle, confirm } from '@/components/ui';
import { useAccounts } from '@/hooks/useAccounts';
import { useProject } from '@/hooks/useProject';
import { receiptHtml } from '@/lib/export/receipt';
import { sharePdf } from '@/lib/files';
import {
  PAYMENT_MODE_LABEL,
  accountStatus,
  commissionAmount,
  commissionPaid,
  emptyAccount,
  makeSchedule,
  today,
} from '@/lib/finance';
import { features } from '@/lib/status';
import type { CommissionKind, Payment, PaymentMode, PlotAccount } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtMoney } from '@/lib/units';
import { C } from '@/theme';

const num = (s: string): number | null => {
  const n = Number(s.replace(/,/g, '').trim());
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Dialog = null | 'payment' | 'instalment' | 'plan' | 'commissionPay';

export default function PlotAccountScreen() {
  const { id, plotId } = useLocalSearchParams<{ id: string; plotId: string }>();
  const { backend, userName, toast } = useApp();
  const { project, plots, loading, isAdmin } = useProject(id);
  const { accounts, brokers } = useAccounts(id, isAdmin);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [makeReceipt, setMakeReceipt] = useState(true);
  const [agreedDraft, setAgreedDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading || !project) return <Loading />;
  const plot = plots.find((p) => p.id === plotId);
  if (!plot) return <Loading />;
  if (!isAdmin) {
    return (
      <Screen>
        <Banner text="Payments and commission are visible to Admins only." />
      </Screen>
    );
  }
  const feat = features(project);
  const acc: PlotAccount = { ...emptyAccount(plot.id), ...(accounts[plot.id] || {}) };
  const st = accountStatus(plot, project, acc);
  const broker = brokers.find((b) => b.id === acc.brokerId) || null;
  const comm = commissionAmount(plot, project, acc, broker);
  const commPaid = commissionPaid(acc);
  const money = (n: number | null | undefined) => fmtMoney(n ?? null, project.currency);
  const who = { name: userName };

  const save = async (next: PlotAccount, msg?: string) => {
    try {
      await backend.saveAccount(id, next, who);
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const open = (d: Dialog, init: Record<string, string> = {}) => {
    setF(init);
    setDialog(d);
  };
  const close = () => setDialog(null);

  const shareReceipt = async (p: Payment, a: PlotAccount) => {
    try {
      await sharePdf(`Receipt_${p.receiptNo ?? ''}_Plot_${plot.number}.pdf`, receiptHtml(project, plot, a, p), 'portrait');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const addPayment = async () => {
    const amount = num(f.amount || '');
    const date = (f.date || today()).trim();
    if (!amount || !DATE_RE.test(date)) return toast('Enter the amount and a date like 2026-11-15');
    setBusy(true);
    try {
      const receiptNo = makeReceipt ? await backend.nextReceiptNo(id) : null;
      const p: Payment = { id: backend.newId(), date, amount, mode, ref: (f.ref || '').trim(), note: (f.note || '').trim(), receiptNo };
      const next = { ...acc, payments: [...acc.payments, p] };
      await save(next, 'Payment saved');
      close();
      if (makeReceipt) await shareReceipt(p, next);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addInstalment = () => {
    const amount = num(f.amount || '');
    const due = (f.due || '').trim();
    if (!amount || !DATE_RE.test(due)) return toast('Enter the amount and a due date like 2026-12-01');
    save({ ...acc, schedule: [...acc.schedule, { id: backend.newId(), label: (f.label || '').trim() || `Instalment ${acc.schedule.length + 1}`, due, amount }] }, 'Instalment added');
    close();
  };

  const makePlan = async () => {
    const total = num(f.total || '') ?? st.price ?? 0;
    const start = (f.start || today()).trim();
    if (!total || !DATE_RE.test(start)) return toast('Enter the total and a start date');
    if (acc.schedule.length && !(await confirm('Replace payment plan?', 'The current instalments will be replaced.', 'Replace'))) return;
    const schedule = makeSchedule({
      total,
      token: num(f.token || '') ?? 0,
      bookingPct: num(f.bookingPct || '') ?? 0,
      count: num(f.count || '') ?? 1,
      everyMonths: num(f.every || '') ?? 1,
      start,
      newId: () => backend.newId(),
    });
    save({ ...acc, schedule }, `Plan with ${schedule.length} payments created`);
    close();
  };

  const sortedSchedule = [...acc.schedule].sort((a, b) => a.due.localeCompare(b.due));
  // payments cover instalments in date order
  const scheduleRows = sortedSchedule.reduce<{ rows: (typeof sortedSchedule[number] & { paid: number; late: boolean })[]; left: number }>(
    (acc2, i) => {
      const paid = Math.min(acc2.left, i.amount);
      acc2.rows.push({ ...i, paid, late: paid < i.amount && i.due < today() });
      return { rows: acc2.rows, left: acc2.left - paid };
    },
    { rows: [], left: st.paid },
  ).rows;

  return (
    <Screen>
      <Stack.Screen options={{ title: `Plot ${plot.number} · Payments` }} />
      <Card>
        <H>Summary</H>
        <InfoRow label="Buyer" value={[plot.buyerName, plot.buyerPhone].filter(Boolean).join(' · ') || '—'} />
        <InfoRow label="Price" value={money(st.price)} />
        <InfoRow label="Received" value={money(st.paid)} />
        <InfoRow label="Balance" value={money(st.balance)} />
        {st.overdue > 0 ? <InfoRow label="Overdue" value={money(st.overdue)} /> : null}
        {st.next ? <InfoRow label="Next due" value={`${money(st.next.remaining)} on ${st.next.due}`} /> : null}
        <View style={{ height: 10 }} />
        <Field
          label={`Agreed price (${project.currency})`}
          value={agreedDraft ?? (acc.agreedPrice ? String(acc.agreedPrice) : '')}
          onChangeText={setAgreedDraft}
          keyboardType="decimal-pad"
          hint="Optional: final price after discount. Empty = price list price."
          testID="agreed-price"
        />
        {agreedDraft != null ? (
          <Button
            small
            title="Save price"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => {
              save({ ...acc, agreedPrice: num(agreedDraft) }, 'Price saved');
              setAgreedDraft(null);
            }}
          />
        ) : null}
      </Card>

      {feat.payments ? (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <H>Payments received</H>
              <Button small title="Add" icon="add" onPress={() => open('payment', { date: today() })} testID="add-payment" />
            </Row>
            {acc.payments.length ? (
              acc.payments.map((p) => (
                <View key={p.id} style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.amount}>{money(p.amount)}</Text>
                    <Muted style={{ fontSize: 12.5 }}>
                      {p.date} · {PAYMENT_MODE_LABEL[p.mode]}
                      {p.ref ? ` · ${p.ref}` : ''}
                      {p.receiptNo ? ` · Receipt #${p.receiptNo}` : ''}
                    </Muted>
                  </View>
                  <IconButton icon="receipt-outline" label="Share receipt" onPress={() => shareReceipt(p, acc)} />
                  <IconButton
                    icon="trash-outline"
                    label="Delete payment"
                    color={C.danger}
                    onPress={async () => {
                      if (await confirm('Delete payment?', `${money(p.amount)} on ${p.date}`, 'Delete', true)) save({ ...acc, payments: acc.payments.filter((x) => x.id !== p.id) }, 'Payment deleted');
                    }}
                  />
                </View>
              ))
            ) : (
              <Muted>No payments yet.</Muted>
            )}
          </Card>

          <Card>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <H>Payment plan</H>
              <Row>
                <Button small variant="secondary" title="Make plan" icon="calendar-outline" onPress={() => open('plan', { total: st.price ? String(st.price) : '', start: today(), count: '6', every: '1' })} testID="make-plan" />
                <Button small variant="secondary" title="Add" icon="add" onPress={() => open('instalment')} />
              </Row>
            </Row>
            {scheduleRows.length ? (
              scheduleRows.map((i) => (
                <View key={i.id} style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{i.label}</Text>
                    <Muted style={{ fontSize: 12.5, color: i.late ? C.danger : C.muted }}>
                      Due {i.due}
                      {i.paid >= i.amount ? ' · Paid ✓' : i.paid > 0 ? ` · ${money(i.paid)} paid` : i.late ? ' · Overdue' : ''}
                    </Muted>
                  </View>
                  <Text style={styles.amount}>{money(i.amount)}</Text>
                  <IconButton icon="close" label="Remove instalment" onPress={() => save({ ...acc, schedule: acc.schedule.filter((x) => x.id !== i.id) })} />
                </View>
              ))
            ) : (
              <Muted>No plan. Optional — use “Make plan” for token + instalments.</Muted>
            )}
          </Card>
        </>
      ) : null}

      {feat.commission ? (
        <Card>
          <H>Broker & commission</H>
          <Row style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            <Button small variant={!acc.brokerId ? 'primary' : 'secondary'} title="No broker" onPress={() => save({ ...acc, brokerId: null })} />
            {brokers.map((b) => (
              <Button key={b.id} small variant={acc.brokerId === b.id ? 'primary' : 'secondary'} title={b.name} onPress={() => save({ ...acc, brokerId: b.id }, `Broker: ${b.name}`)} testID={`broker-${b.name}`} />
            ))}
            <Button small variant="ghost" title="Manage brokers" onPress={() => router.push({ pathname: '/project/[id]/brokers', params: { id } })} />
          </Row>
          {broker ? (
            <>
              <InfoRow label="Commission" value={money(comm)} />
              <InfoRow label="Paid" value={money(commPaid)} />
              <InfoRow label="Pending" value={money(comm - commPaid)} />
              <Muted style={{ fontSize: 12.5, marginTop: 6 }}>
                {acc.commission ? 'Special commission for this plot' : `${broker.name}'s default`}:{' '}
                {(acc.commission ?? broker.commission).kind === 'pct'
                  ? `${(acc.commission ?? broker.commission).value}% of price`
                  : (acc.commission ?? broker.commission).kind === 'perUnit'
                    ? `${money((acc.commission ?? broker.commission).value)} per ${AREA_UNIT_SHORT[project.areaUnit]}`
                    : money((acc.commission ?? broker.commission).value)}
              </Muted>
              <Row style={{ flexWrap: 'wrap', marginTop: 10 }}>
                <Button small variant="secondary" title="Record commission paid" onPress={() => open('commissionPay', { date: today() })} />
                <Button
                  small
                  variant="ghost"
                  title={acc.commission ? 'Use broker default' : 'Special rate…'}
                  onPress={() => (acc.commission ? save({ ...acc, commission: null }) : open('commissionPay', { special: '1', kind: 'pct' }))}
                />
              </Row>
              {acc.commissionPayments.map((c) => (
                <View key={c.id} style={styles.line}>
                  <Muted style={{ flex: 1 }}>
                    {c.date} · {money(c.amount)}
                    {c.note ? ` · ${c.note}` : ''}
                  </Muted>
                  <IconButton icon="close" label="Remove" onPress={() => save({ ...acc, commissionPayments: acc.commissionPayments.filter((x) => x.id !== c.id) })} />
                </View>
              ))}
            </>
          ) : (
            <Muted>Optional. Pick the broker who sold this plot to track their commission.</Muted>
          )}
        </Card>
      ) : null}

      <SheetModal visible={dialog === 'payment'} title="Add payment" onClose={close}>
        <Field label={`Amount (${project.currency})`} value={f.amount || ''} onChangeText={(t) => setF({ ...f, amount: t })} keyboardType="decimal-pad" testID="pay-amount" />
        <Field label="Date (YYYY-MM-DD)" value={f.date || ''} onChangeText={(t) => setF({ ...f, date: t })} />
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={(Object.keys(PAYMENT_MODE_LABEL) as PaymentMode[]).slice(0, 4).map((m) => ({ value: m, label: m === 'bank' ? 'Bank' : PAYMENT_MODE_LABEL[m] }))}
        />
        <Field label="Cheque no. / UTR / reference" value={f.ref || ''} onChangeText={(t) => setF({ ...f, ref: t })} />
        <Field label="Towards (optional)" value={f.note || ''} onChangeText={(t) => setF({ ...f, note: t })} placeholder="e.g. Token, 2nd instalment" />
        <Toggle label="Create receipt (PDF)" value={makeReceipt} onChange={setMakeReceipt} />
        <Button title="Save payment" onPress={addPayment} loading={busy} style={{ marginTop: 8 }} testID="save-payment" />
      </SheetModal>

      <SheetModal visible={dialog === 'instalment'} title="Add instalment" onClose={close}>
        <Field label="Name" value={f.label || ''} onChangeText={(t) => setF({ ...f, label: t })} placeholder="e.g. Registry amount" />
        <Field label="Due date (YYYY-MM-DD)" value={f.due || ''} onChangeText={(t) => setF({ ...f, due: t })} />
        <Field label={`Amount (${project.currency})`} value={f.amount || ''} onChangeText={(t) => setF({ ...f, amount: t })} keyboardType="decimal-pad" />
        <Button title="Add" onPress={addInstalment} />
      </SheetModal>

      <SheetModal visible={dialog === 'plan'} title="Make a payment plan" onClose={close}>
        <Field label={`Total (${project.currency})`} value={f.total || ''} onChangeText={(t) => setF({ ...f, total: t })} keyboardType="decimal-pad" />
        <Field label={`Token amount (${project.currency}, optional)`} value={f.token || ''} onChangeText={(t) => setF({ ...f, token: t })} keyboardType="decimal-pad" />
        <Field label="Booking amount % incl. token (optional)" value={f.bookingPct || ''} onChangeText={(t) => setF({ ...f, bookingPct: t })} keyboardType="decimal-pad" placeholder="e.g. 25" />
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Instalments" value={f.count || ''} onChangeText={(t) => setF({ ...f, count: t })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Every N months" value={f.every || ''} onChangeText={(t) => setF({ ...f, every: t })} keyboardType="number-pad" />
          </View>
        </Row>
        <Field label="Start date (YYYY-MM-DD)" value={f.start || ''} onChangeText={(t) => setF({ ...f, start: t })} />
        <Button title="Create plan" onPress={makePlan} testID="create-plan" />
      </SheetModal>

      <SheetModal visible={dialog === 'commissionPay'} title={f.special ? 'Special commission for this plot' : 'Commission paid'} onClose={close}>
        {f.special ? (
          <>
            <Segmented
              value={(f.kind as CommissionKind) || 'pct'}
              onChange={(k) => setF({ ...f, kind: k })}
              options={[
                { value: 'pct', label: '% of price' },
                { value: 'perUnit', label: `per ${AREA_UNIT_SHORT[project.areaUnit]}` },
                { value: 'fixed', label: 'Fixed' },
              ]}
            />
            <TextInput value={f.value || ''} onChangeText={(t) => setF({ ...f, value: t })} keyboardType="decimal-pad" placeholder="Value" placeholderTextColor="#98A2B3" style={styles.input} />
            <Button
              title="Save"
              style={{ marginTop: 12 }}
              onPress={() => {
                const v = num(f.value || '');
                if (v == null) return;
                save({ ...acc, commission: { kind: (f.kind as CommissionKind) || 'pct', value: v } }, 'Commission set');
                close();
              }}
            />
          </>
        ) : (
          <>
            <Field label={`Amount (${project.currency})`} value={f.amount || ''} onChangeText={(t) => setF({ ...f, amount: t })} keyboardType="decimal-pad" />
            <Field label="Date (YYYY-MM-DD)" value={f.date || ''} onChangeText={(t) => setF({ ...f, date: t })} />
            <Field label="Note" value={f.note || ''} onChangeText={(t) => setF({ ...f, note: t })} />
            <Button
              title="Save"
              onPress={() => {
                const amount = num(f.amount || '');
                if (!amount) return;
                save({ ...acc, commissionPayments: [...acc.commissionPayments, { id: backend.newId(), date: f.date || today(), amount, note: (f.note || '').trim() }] }, 'Commission payment saved');
                close();
              }}
            />
          </>
        )}
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  amount: { fontSize: 16, fontWeight: '700', color: C.text },
  label: { fontSize: 15, fontWeight: '600', color: C.text },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: C.text, marginTop: 4 },
});
