import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { SheetModal } from '@/components/SheetModal';
import { Banner, Button, Card, Field, H, IconButton, Loading, Muted, Row, Screen, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { useTeamNotify } from '@/hooks/useTeamNotify';
import { today } from '@/lib/finance';
import { LEAD_STAGES, SOURCE_LABEL, STAGE_COLOR, STAGE_LABEL, addDays, parsePlotList, whatsappUrl } from '@/lib/leads';
import { cancelFollowUp, scheduleFollowUp } from '@/lib/notify';
import { STATUS_COLOR, features, statusLabel } from '@/lib/status';
import type { Lead, LeadSource } from '@/lib/types';
import { C } from '@/theme';

function Chip({ label, on, color, onPress, testID }: { label: string; on: boolean; color: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: color }, on && { backgroundColor: color }]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export default function LeadScreen() {
  const { id, leadId } = useLocalSearchParams<{ id: string; leadId: string }>();
  const { backend, uid, userName, toast } = useApp();
  const { project, plots, loading, membership, isAdmin, canEditStatus } = useProject(id);
  const notify = useTeamNotify(project, membership);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [draft, setDraft] = useState<Lead | null>(null);
  const [plotText, setPlotText] = useState<string | null>(null);
  const [visit, setVisit] = useState<{ date: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = leadId === 'new';
  const [newId] = useState(() => backend.newId());
  const [createdAt] = useState(() => Date.now());

  useEffect(() => {
    if (!membership) return;
    return backend.watchLeads(id, setLeads, () => undefined);
  }, [backend, id, membership]);

  if (loading || !project || (!isNew && !leads)) return <Loading />;
  const saved = isNew ? null : (leads || []).find((l) => l.id === leadId) || null;
  if (!isNew && !saved) {
    return (
      <Screen>
        <Banner tone="warn" text="This lead was deleted." />
      </Screen>
    );
  }
  const base: Lead = saved ?? {
    id: newId,
    name: '',
    phone: '',
    budget: null,
    source: 'walkin',
    interested: [],
    stage: 'new',
    nextFollowUp: addDays(today(), 1),
    visits: [],
    notes: '',
    createdBy: uid || '',
    createdByName: userName,
    createdAt,
    updatedAt: createdAt,
  };
  const lead = draft ?? base;
  const set = (patch: Partial<Lead>) => setDraft({ ...lead, ...patch });
  const dirty = isNew || (draft != null && JSON.stringify(draft) !== JSON.stringify(saved)) || plotText != null;

  const persist = async (l: Lead, msg: string, back = false) => {
    setSaving(true);
    try {
      await backend.saveLead(id, l);
      if (l.stage === 'won' || l.stage === 'lost') await cancelFollowUp(l.id);
      else await scheduleFollowUp(l.id, l.nextFollowUp, `Follow up: ${l.name}`, `${l.phone} · ${project.name}${l.interested.length ? ' · plots ' + l.interested.join(', ') : ''}`);
      setDraft(null);
      setPlotText(null);
      toast(msg);
      if (back) router.back();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!lead.name.trim()) return toast('Enter a name');
    const interested = plotText != null ? parsePlotList(plotText) : lead.interested;
    persist({ ...lead, name: lead.name.trim(), phone: lead.phone.trim(), interested }, 'Lead saved', isNew);
  };

  const book = async (number: string) => {
    const plot = plots.find((p) => p.number.toUpperCase() === number.toUpperCase());
    if (!plot) return toast(`Plot ${number} not found`);
    if (plot.status !== 'available') return toast(`Plot ${number} is not available`);
    const approval = !isAdmin && features(project).approval;
    if (!(await confirm(`Book plot ${plot.number}?`, `${lead.name} will be saved as the buyer${approval ? ' and the admin will be asked to approve' : ''}.`, 'Book'))) return;
    try {
      const who = { name: userName };
      await backend.updatePlot(id, plot, { buyerName: lead.name, buyerPhone: lead.phone, bookingDate: today() }, who);
      if (approval) {
        await backend.requestStatus(id, plot, 'booked', who);
        notify('admins', `Approval needed · Plot ${plot.number}`, `${userName} asks: ${statusLabel(project, 'booked')} for ${lead.name}`);
      } else {
        await backend.updatePlot(id, { ...plot, buyerName: lead.name }, { status: 'booked' }, who);
        notify('all', `Plot ${plot.number} → ${statusLabel(project, 'booked')}`, `by ${userName} · ${lead.name}`);
      }
      await persist({ ...lead, stage: 'won', wonPlotId: plot.id, interested: lead.interested.includes(plot.number) ? lead.interested : [...lead.interested, plot.number] }, `Plot ${plot.number} booked for ${lead.name}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const plotStatus = (n: string) => plots.find((p) => p.number.toUpperCase() === n.toUpperCase());

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New lead' : lead.name || 'Lead' }} />
      <Card>
        <Field label="Name" value={lead.name} onChangeText={(t) => set({ name: t })} autoCapitalize="words" testID="lead-name" />
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Phone" value={lead.phone} onChangeText={(t) => set({ phone: t })} keyboardType="phone-pad" testID="lead-phone" />
          </View>
          {lead.phone ? (
            <>
              <IconButton icon="call-outline" label="Call" onPress={() => Linking.openURL(`tel:${lead.phone}`)} />
              <IconButton icon="logo-whatsapp" color="#25D366" label="WhatsApp" onPress={() => Linking.openURL(whatsappUrl(lead.phone, `Hello ${lead.name}, regarding plots at ${project.name}.`))} />
            </>
          ) : null}
        </Row>
        <Field
          label={`Budget (${project.currency}, optional)`}
          value={lead.budget ? String(lead.budget) : ''}
          onChangeText={(t) => {
            const n = Number(t.replace(/,/g, ''));
            set({ budget: t.trim() && Number.isFinite(n) ? n : null });
          }}
          keyboardType="decimal-pad"
        />
        <Text style={styles.label}>SOURCE</Text>
        <View style={styles.chips}>
          {(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => (
            <Chip key={s} label={SOURCE_LABEL[s]} on={lead.source === s} color={C.text} onPress={() => set({ source: s })} />
          ))}
        </View>
      </Card>

      <Card>
        <H>Stage</H>
        <View style={styles.chips}>
          {LEAD_STAGES.map((s) => (
            <Chip key={s} label={STAGE_LABEL[s]} on={lead.stage === s} color={STAGE_COLOR[s]} onPress={() => set({ stage: s })} testID={`stage-${s}`} />
          ))}
        </View>
        <Text style={[styles.label, { marginTop: 8 }]}>NEXT FOLLOW-UP</Text>
        <Field label="Date (YYYY-MM-DD)" value={lead.nextFollowUp || ''} onChangeText={(t) => set({ nextFollowUp: t.trim() })} testID="lead-followup" />
        <Row style={{ flexWrap: 'wrap', marginTop: -4 }}>
          {[
            ['Today', 0],
            ['Tomorrow', 1],
            ['+3 days', 3],
            ['+1 week', 7],
          ].map(([l, n]) => (
            <Button key={l as string} small variant="secondary" title={l as string} onPress={() => set({ nextFollowUp: addDays(today(), n as number) })} />
          ))}
          <Button small variant="ghost" title="None" onPress={() => set({ nextFollowUp: '' })} />
        </Row>
        <Muted style={{ fontSize: 12.5, marginTop: 6 }}>This phone reminds you at 10 am on that day.</Muted>
      </Card>

      <Card>
        <H>Interested plots</H>
        <Field
          label="Plot numbers"
          value={plotText ?? lead.interested.join(', ')}
          onChangeText={setPlotText}
          placeholder="e.g. 12, 14, 15"
          autoCapitalize="characters"
          testID="lead-plots"
        />
        {lead.interested.map((n) => {
          const p = plotStatus(n);
          return (
            <View key={n} style={styles.plotRow}>
              <View style={[styles.dot, { backgroundColor: p ? STATUS_COLOR[p.status] : C.border }]} />
              <Text style={{ flex: 1, fontSize: 15, color: C.text }}>
                Plot {n} <Text style={{ color: C.muted }}>{p ? `· ${statusLabel(project, p.status)}` : '· not found'}</Text>
              </Text>
              {p && p.status === 'available' && canEditStatus && !isNew ? <Button small title="Book" onPress={() => book(n)} testID={`book-${n}`} /> : null}
            </View>
          );
        })}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <H>Site visits</H>
          <Button small variant="secondary" icon="add" title="Add visit" onPress={() => setVisit({ date: today(), note: '' })} testID="add-visit" />
        </Row>
        {lead.visits.length ? (
          [...lead.visits]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((v) => (
              <View key={v.id} style={styles.visit}>
                <Text style={{ fontWeight: '700', color: C.text }}>{v.date}</Text>
                <Muted style={{ fontSize: 13 }}>
                  {v.note || 'Visited the site'} · {v.byName}
                </Muted>
              </View>
            ))
        ) : (
          <Muted>No visits yet.</Muted>
        )}
        <Field label="Notes" value={lead.notes || ''} onChangeText={(t) => set({ notes: t })} multiline />
      </Card>

      <Button title={isNew ? 'Save lead' : 'Save changes'} icon="checkmark" onPress={save} loading={saving} disabled={!dirty} testID="save-lead" />
      {!isNew && (isAdmin || lead.createdBy === uid) ? (
        <Button
          title="Delete lead"
          variant="ghost"
          style={{ marginTop: 8 }}
          onPress={async () => {
            if (!(await confirm('Delete lead?', lead.name, 'Delete', true))) return;
            await backend.deleteLead(id, lead.id);
            await cancelFollowUp(lead.id);
            router.back();
          }}
        />
      ) : null}

      <SheetModal visible={!!visit} title="Site visit" onClose={() => setVisit(null)}>
        <Field label="Date (YYYY-MM-DD)" value={visit?.date || ''} onChangeText={(t) => setVisit({ ...visit!, date: t })} />
        <Field label="What happened? (optional)" value={visit?.note || ''} onChangeText={(t) => setVisit({ ...visit!, note: t })} multiline placeholder="e.g. Liked plot 12, wants a discount" testID="visit-note" />
        <Button
          title="Save visit"
          onPress={() => {
            if (!visit) return;
            const next: Lead = {
              ...lead,
              visits: [...lead.visits, { id: backend.newId(), date: visit.date || today(), note: visit.note.trim(), byName: userName }],
              stage: lead.stage === 'new' || lead.stage === 'contacted' ? 'visit' : lead.stage,
            };
            setVisit(null);
            if (isNew) setDraft(next);
            else persist(next, 'Visit saved');
          }}
          testID="save-visit"
        />
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6, letterSpacing: 0.3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, backgroundColor: '#fff' },
  chipText: { fontSize: 13.5, fontWeight: '700', color: C.text },
  plotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  visit: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
});
