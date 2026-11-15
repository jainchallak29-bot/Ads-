import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Banner, Button, Card, Field, H, InfoRow, Loading, Muted, Screen, Segmented, Toggle } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status';
import type { Activity, Plot, PlotPatch, PlotStatus } from '@/lib/types';
import { AREA_UNIT_SHORT, computedAreaSqm, fmtArea, fmtDimensions, fmtMoney, fmtNum, plotPrice, sqmTo, toSqm } from '@/lib/units';
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
  const { backend, userName, toast } = useApp();
  const { project, plots, loading, isAdmin, canEditStatus } = useProject(id);
  const plot = plots.find((p) => p.id === plotId);
  // null until the user edits: until then the form follows the live plot data
  const [draft, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Activity[]>([]);

  const toForm = (p: Plot): Form => ({
    number: p.number,
    status: p.status,
    facing: p.facing || '',
    isCorner: !!p.isCorner,
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
  const preview = { ...plot, ...patch };

  const save = async () => {
    setSaving(true);
    try {
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
        <Segmented
          value={form.status}
          disabled={!statusEditable}
          onChange={(s) => setForm({ ...form, status: s, bookingDate: s !== 'available' && !form.bookingDate ? new Date().toISOString().slice(0, 10) : form.bookingDate })}
          options={(['available', 'booked', 'sold'] as PlotStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] }))}
        />
        {!statusEditable ? <Muted>Only the admin can change plots in this project.</Muted> : null}
      </Card>

      <Card>
        <H>Plot</H>
        <InfoRow label="Area" value={fmtArea(preview as Plot, project)} />
        <InfoRow label="Size" value={fmtDimensions(plot, project)} />
        <InfoRow label="Price" value={fmtMoney(plotPrice(preview as Plot, project), project.currency)} />
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
            <Field label={`Rate per ${au} (${project.currency})`} value={form.rate} onChangeText={up('rate')} keyboardType="decimal-pad" />
            <Field label={`Total price (${project.currency})`} value={form.price} onChangeText={up('price')} keyboardType="decimal-pad" hint="Leave empty to use rate × area." />
          </>
        ) : (
          <>
            <InfoRow label="Facing" value={`${plot.facing || '-'}${plot.isCorner ? ' · Corner' : ''}`} />
            <InfoRow label="Rate" value={plot.rate ? `${fmtMoney(plot.rate, project.currency)} / ${au}` : '-'} />
          </>
        )}
      </Card>

      <Card>
        <H>Buyer</H>
        <Field label="Buyer name" value={form.buyerName} onChangeText={up('buyerName')} editable={statusEditable} autoCapitalize="words" testID="buyer-name" />
        <Field label="Phone" value={form.buyerPhone} onChangeText={up('buyerPhone')} editable={statusEditable} keyboardType="phone-pad" />
        {plot.buyerPhone ? <Button small variant="ghost" icon="call-outline" title={`Call ${plot.buyerPhone}`} onPress={() => Linking.openURL(`tel:${plot.buyerPhone}`)} style={{ alignSelf: 'flex-start', marginBottom: 8 }} /> : null}
        <Field label="Booking date (YYYY-MM-DD)" value={form.bookingDate} onChangeText={up('bookingDate')} editable={statusEditable} placeholder="2026-11-15" />
        {isAdmin ? <Field label={`Amount received (${project.currency})`} value={form.amountReceived} onChangeText={up('amountReceived')} keyboardType="decimal-pad" /> : null}
        <Field label="Notes" value={form.notes} onChangeText={up('notes')} editable={statusEditable} multiline />
      </Card>

      {statusEditable ? <Button title="Save" icon="checkmark" onPress={save} loading={saving} disabled={!dirty} testID="save-plot" /> : null}

      {history.length ? (
        <Card style={{ marginTop: 16 }}>
          <H>History</H>
          {history.slice(0, 20).map((a) => (
            <View key={a.id} style={{ paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
              <Text style={{ color: C.text, fontSize: 14 }}>
                {a.action === 'status'
                  ? `${STATUS_LABEL[a.from as PlotStatus] ?? a.from} → ${STATUS_LABEL[a.to as PlotStatus] ?? a.to}`
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
