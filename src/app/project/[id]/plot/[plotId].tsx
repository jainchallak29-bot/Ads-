import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import Ionicons from '@expo/vector-icons/Ionicons';

import { StatusPicker } from '@/components/StatusPicker';
import { Banner, Button, Card, Field, H, InfoRow, Loading, Muted, Row, Screen, Segmented, Toggle } from '@/components/ui';
import { useAccounts } from '@/hooks/useAccounts';
import { useProject } from '@/hooks/useProject';
import { accountStatus, commissionAmount, commissionPaid } from '@/lib/finance';
import { comparePlotNumbers } from '@/lib/cad/detect';
import { premiumText, priceBreakdown } from '@/lib/pricing';
import { features, statusLabel } from '@/lib/status';
import type { Activity, Plot, PlotPatch, PlotStatus } from '@/lib/types';
import { AREA_UNIT_SHORT, computedAreaSqm, fmtArea, fmtDimensions, fmtMoney, fmtNum, sqmTo, toSqm } from '@/lib/units';
import { C } from '@/theme';

const FACINGS = ['', 'North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West'];

const numOrNull = (s: string): number | null => {
  const n = Number(s.replace(/,/g, '').trim());
  return s.trim() && Number.isFinite(n) ? n : null;
};
const numStr = (n: number | null | undefined) => (n == null ? '' : String(n));

interface Form {
  number: string;
  status: PlotStatus;
  facing: string;
  isCorner: boolean;
  block: string;
  premiums: string[];
  area: string;
  rate: string;
  price: string;
  buyerName: string;
  buyerPhone: string;
  bookingDate: string;
  amountReceived: string;
  notes: string;
}

export default function PlotDetails() {
  const { id, plotId } = useLocalSearchParams<{ id: string; plotId: string }>();
  const { backend, userName, toast, uid } = useApp();
  const { project, plots, loading, isAdmin, canEditStatus } = useProject(id);
  const plot = plots.find((p) => p.id === plotId);
  const { accounts, brokers } = useAccounts(id, isAdmin);
  // null until the user edits: until then the form follows the live plot data
  const [draft, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]);

  const toForm = (p: Plot): Form => ({
    number: p.number,
    status: p.status,
    facing: p.facing || '',
    isCorner: !!p.isCorner,
    block: p.block || '',
    premiums: p.premiums || [],
    area: p.areaOverrideSqm && project ? fmtNum(sqmTo(p.areaOverrideSqm, project.areaUnit)).replace(/,/g, '') : '',
    rate: numStr(p.rate),
    price: numStr(p.price),
    buyerName: p.buyerName || '',
    buyerPhone: p.buyerPhone || '',
    bookingDate: p.bookingDate || '',
    amountReceived: numStr(p.amountReceived),
    notes: p.notes || '',
  });


  const form: Form | null = draft ?? (plot && project ? toForm(plot) : null);

  useEffect(() => {
    if (!id || !plotId) return;
    return backend.watchActivity(id, plotId, setHistory, () => undefined);
  }, [backend, id, plotId]);

  const patch: PlotPatch = useMemo(() => {
    if (!form || !plot || !project) return {};
    const p: PlotPatch = {};
    const set = <K extends keyof PlotPatch>(k: K, v: PlotPatch[K], old: PlotPatch[K]) => {
      if ((v ?? '') !== (old ?? '')) p[k] = v;
    };
    set('status', form.status, plot.status);
    set('buyerName', form.buyerName.trim(), plot.buyerName || '');
    set('buyerPhone', form.buyerPhone.trim(), plot.buyerPhone || '');
    set('bookingDate', form.bookingDate.trim(), plot.bookingDate || '');
    set('notes', form.notes.trim(), plot.notes || '');
    if (isAdmin) {
      set('number', form.number.trim() || plot.number, plot.number);
      set('facing', form.facing, plot.facing || '');
      if (form.isCorner !== !!plot.isCorner) p.isCorner = form.isCorner;
      set('block', form.block.trim(), plot.block || '');
      if ([...form.premiums].sort().join() !== [...(plot.premiums || [])].sort().join()) p.premiums = form.premiums;
      set('rate', numOrNull(form.rate), plot.rate ?? null);
      set('price', numOrNull(form.price), plot.price ?? null);
      set('amountReceived', numOrNull(form.amountReceived), plot.amountReceived ?? null);
      const a = numOrNull(form.area);
      const newOverride = a && a > 0 ? toSqm(a, project.areaUnit) : null;
      const oldOverride = plot.areaOverrideSqm ?? null;
      if ((newOverride == null) !== (oldOverride == null) || (newOverride != null && oldOverride != null && Math.abs(newOverride - oldOverride) > 1e-3)) {
        p.areaOverrideSqm = newOverride;
      }
    }
    return p;
  }, [form, plot, project, isAdmin]);

  if (loading || !project) return <Loading />;
  if (!plot) {
    return (
      <Screen>
        <Banner tone="warn" text="This plot no longer exists (it may have been merged or deleted)." />
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!form) return <Loading />;

  const up = (k: keyof Form) => (v: string | boolean) => setForm({ ...form, [k]: v } as Form);
  const dirty = Object.keys(patch).length > 0;
  const statusEditable = canEditStatus;
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const computed = sqmTo(computedAreaSqm(plot, project.drawingUnit), project.areaUnit);
  const preview = { ...plot, ...patch } as Plot;
  const f = features(project);
  const pb = priceBreakdown(preview, project);
  const blocks = [...new Set(plots.map((x) => x.block).filter((b): b is string => !!b))].sort(comparePlotNumbers);
  const premiumList = project.pricing?.premiums || [];
  const rateSourceText = pb.rateSource === 'plot' ? 'plot rate' : pb.rateSource === 'block' ? `block ${preview.block} rate` : pb.rateSource === 'base' ? 'base rate' : '';

  const needsApproval = !isAdmin && f.approval;
  const save = async () => {
    setSaving(true);
    try {
      const { status, ...rest } = patch;
      if (needsApproval && status) {
        if (plot.pending && plot.pending.by !== uid) throw new Error(`${plot.pending.byName} already asked to change this plot.`);
        if (Object.keys(rest).length) await backend.updatePlot(id, plot, rest, { name: userName });
        await backend.requestStatus(id, plot, status, { name: userName });
        toast('Saved. Status change sent to the admin for approval');
        router.back();
        return;
      }
      await backend.updatePlot(id, plot, patch, { name: userName });
      toast('Saved — updated on all phones');
      router.back();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `Plot ${plot.number}` }} />

      <Card>
        <H>Status</H>
        <StatusPicker
          project={project}
          value={form.status}
          disabled={!statusEditable}
          exclude={isAdmin ? [] : ['blocked']}
          onChange={(s) => setForm({ ...form, status: s, bookingDate: s !== 'available' && s !== 'blocked' && !form.bookingDate ? new Date().toISOString().slice(0, 10) : form.bookingDate })}
        />
        {!statusEditable ? <Muted>Only the admin can change plots in this project.</Muted> : null}
      </Card>

      <Card>
        <H>Plot</H>
        <InfoRow label="Area" value={fmtArea(preview, project)} />
        <InfoRow label="Size" value={fmtDimensions(plot, project)} />
        {f.blocks && preview.block ? <InfoRow label="Block" value={preview.block} /> : null}
        <InfoRow label="Price" value={fmtMoney(pb.total, project.currency)} />
        {pb.total && !pb.explicit && pb.rate ? (
          <Muted style={{ fontSize: 12.5, marginTop: 4 }}>
            {fmtNum(pb.area)} {au} × {fmtMoney(pb.rate, project.currency)} ({rateSourceText})
            {pb.premiums.map((x) => ` ${premiumText(x, project.currency, au)} ${x.name}`).join(',')}
          </Muted>
        ) : null}
        <View style={{ height: 12 }} />
        {isAdmin ? (
          <>
            <Field label="Plot number" value={form.number} onChangeText={up('number')} autoCapitalize="characters" />
            <Field
              label={`Area override (${au})`}
              value={form.area}
              onChangeText={up('area')}
              keyboardType="decimal-pad"
              placeholder={fmtNum(computed).replace(/,/g, '')}
              hint={`Leave empty to use the area from the drawing (${fmtNum(computed)} ${au}).`}
            />
            <Segmented label="Facing" value={form.facing} onChange={up('facing')} options={FACINGS.slice(1, 5).map((f) => ({ value: f, label: f }))} />
            <Segmented label="" value={form.facing} onChange={up('facing')} options={FACINGS.slice(5).map((f) => ({ value: f, label: f.replace('North', 'N').replace('South', 'S').replace('East', 'E').replace('West', 'W') }))} />
            <Toggle label="Corner plot" value={form.isCorner} onChange={up('isCorner')} />
            {f.blocks ? (
              <>
                <Field label="Block / phase" value={form.block} onChangeText={up('block')} autoCapitalize="characters" placeholder="e.g. A or Phase 2" />
                {blocks.length ? (
                  <Row style={{ flexWrap: 'wrap', marginTop: -6, marginBottom: 12 }}>
                    {blocks.map((b) => (
                      <Button key={b} small variant={form.block === b ? 'primary' : 'secondary'} title={b} onPress={() => setForm({ ...form, block: b })} />
                    ))}
                  </Row>
                ) : null}
              </>
            ) : null}
            {f.pricing && premiumList.length ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6 }}>PREMIUMS</Text>
                {premiumList.map((pr) => {
                  const on = form.premiums.includes(pr.id);
                  return (
                    <Pressable
                      key={pr.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => setForm({ ...form, premiums: on ? form.premiums.filter((x) => x !== pr.id) : [...form.premiums, pr.id] })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
                    >
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? C.primary : C.muted} />
                      <Text style={{ fontSize: 15, color: C.text, flex: 1 }}>{pr.name}</Text>
                      <Muted>{premiumText(pr, project.currency, au)}</Muted>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Field
              label={`Rate per ${au} (${project.currency})`}
              value={form.rate}
              onChangeText={up('rate')}
              keyboardType="decimal-pad"
              hint={f.pricing ? 'Leave empty to use the price list (block / base rate).' : undefined}
            />
            <Field label={`Total price (${project.currency})`} value={form.price} onChangeText={up('price')} keyboardType="decimal-pad" hint="Leave empty to calculate it from the rate." />
          </>
        ) : (
          <>
            <InfoRow label="Facing" value={`${plot.facing || '-'}${plot.isCorner ? ' · Corner' : ''}`} />
            <InfoRow label="Rate" value={pb.rate ? `${fmtMoney(pb.rate, project.currency)} / ${au}` : '-'} />
          </>
        )}
      </Card>

      <Card>
        <H>Buyer</H>
        <Field label="Buyer name" value={form.buyerName} onChangeText={up('buyerName')} editable={statusEditable} autoCapitalize="words" testID="buyer-name" />
        <Field label="Phone" value={form.buyerPhone} onChangeText={up('buyerPhone')} editable={statusEditable} keyboardType="phone-pad" />
        {plot.buyerPhone ? <Button small variant="ghost" icon="call-outline" title={`Call ${plot.buyerPhone}`} onPress={() => Linking.openURL(`tel:${plot.buyerPhone}`)} style={{ alignSelf: 'flex-start', marginBottom: 8 }} /> : null}
        <Field label="Booking date (YYYY-MM-DD)" value={form.bookingDate} onChangeText={up('bookingDate')} editable={statusEditable} placeholder="2026-11-15" />
        {isAdmin && !f.payments ? <Field label={`Amount received (${project.currency})`} value={form.amountReceived} onChangeText={up('amountReceived')} keyboardType="decimal-pad" /> : null}
        <Field label="Notes" value={form.notes} onChangeText={up('notes')} editable={statusEditable} multiline />
      </Card>

      {statusEditable ? <Button title={needsApproval && patch.status ? 'Save & ask admin' : 'Save'} icon="checkmark" onPress={save} loading={saving} disabled={!dirty} testID="save-plot" /> : null}

      {isAdmin && (f.payments || f.commission) ? (
        <Card style={{ marginTop: 16 }}>
          <H>Payments & commission</H>
          {(() => {
            const acc = accounts[plot.id];
            const st = accountStatus(plot, project, acc);
            const br = brokers.find((b) => b.id === acc?.brokerId);
            return (
              <>
                {f.payments ? (
                  <>
                    <InfoRow label="Received" value={fmtMoney(st.paid, project.currency)} />
                    <InfoRow label="Balance" value={fmtMoney(st.balance, project.currency)} />
                    {st.overdue ? <InfoRow label="Overdue" value={fmtMoney(st.overdue, project.currency)} /> : null}
                  </>
                ) : null}
                {f.commission && br ? (
                  <InfoRow label="Broker" value={`${br.name} · pending ${fmtMoney(commissionAmount(plot, project, acc, br) - commissionPaid(acc), project.currency)}`} />
                ) : null}
              </>
            );
          })()}
          <Button
            small
            variant="secondary"
            icon="wallet-outline"
            title="Open payments"
            style={{ alignSelf: 'flex-start', marginTop: 10 }}
            onPress={() => router.push({ pathname: '/project/[id]/accounts/[plotId]', params: { id, plotId: plot.id } })}
            testID="open-accounts"
          />
        </Card>
      ) : null}

      {history.length ? (
        <Card style={{ marginTop: 16 }}>
          <H>History</H>
          {history.slice(0, 20).map((a) => (
            <View key={a.id} style={{ paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
              <Text style={{ color: C.text, fontSize: 14 }}>
                {a.action === 'status'
                  ? `${statusLabel(project, a.from as PlotStatus)} → ${statusLabel(project, a.to as PlotStatus)}`
                  : a.action === 'renamed'
                    ? `Renamed ${a.from} → ${a.to}`
                    : a.to}
              </Text>
              <Muted style={{ fontSize: 12 }}>
                {a.byName} · {new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </Muted>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
