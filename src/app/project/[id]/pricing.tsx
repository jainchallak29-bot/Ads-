import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Banner, Button, Card, Field, H, IconButton, Loading, Muted, Row, Screen, Segmented, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { comparePlotNumbers } from '@/lib/cad/detect';
import { premiumText } from '@/lib/pricing';
import type { Premium, PremiumKind, Pricing } from '@/lib/types';
import { AREA_UNIT_SHORT } from '@/lib/units';
import { C } from '@/theme';

const num = (s: string): number | null => {
  const n = Number(s.replace(/,/g, '').trim());
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

export default function PricingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, toast } = useApp();
  const { project, plots, loading, isAdmin } = useProject(id);
  // edited copy; null = show the saved price list
  const [draft, setDraft] = useState<Pricing | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<PremiumKind>('pct');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  if (loading || !project) return <Loading />;
  const saved: Pricing = { baseRate: null, blockRates: {}, premiums: [], ...(project.pricing || {}) };
  const pricing = draft ?? saved;
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const blocks = [...new Set(plots.map((p) => p.block).filter((b): b is string => !!b))].sort(comparePlotNumbers);
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const edit = (p: Partial<Pricing>) => setDraft({ ...pricing, ...p });

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateProject(id, { pricing });
      setDraft(null);
      toast('Price list saved');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addPremium = () => {
    const v = num(newValue);
    if (!newName.trim() || v == null) return;
    const p: Premium = { id: backend.newId(), name: newName.trim(), kind: newKind, value: v };
    edit({ premiums: [...pricing.premiums, p] });
    setNewName('');
    setNewValue('');
  };

  const usage = (pid: string) => plots.filter((p) => p.premiums?.includes(pid)).length;

  return (
    <Screen>
      {!isAdmin ? <Banner text="Only admins can change the price list." /> : null}
      <Card>
        <H>Base rate</H>
        <Muted style={{ marginBottom: 10 }}>Used for every plot unless its block or the plot itself has its own rate.</Muted>
        <Field
          label={`${project.currency} per ${au}`}
          value={pricing.baseRate == null ? '' : String(pricing.baseRate)}
          onChangeText={(t) => edit({ baseRate: num(t) })}
          keyboardType="decimal-pad"
          editable={isAdmin}
          testID="base-rate"
        />
      </Card>

      <Card>
        <H>Block rates</H>
        {blocks.length ? (
          blocks.map((b) => (
            <View key={b} style={styles.row}>
              <Text style={styles.blockName}>{b}</Text>
              <TextInput
                value={pricing.blockRates[b] == null ? '' : String(pricing.blockRates[b])}
                onChangeText={(t) => {
                  const v = num(t);
                  const next = { ...pricing.blockRates };
                  if (v == null) delete next[b];
                  else next[b] = v;
                  edit({ blockRates: next });
                }}
                placeholder={pricing.baseRate ? `base ${pricing.baseRate}` : `${project.currency} / ${au}`}
                placeholderTextColor="#98A2B3"
                keyboardType="decimal-pad"
                editable={isAdmin}
                style={styles.input}
              />
            </View>
          ))
        ) : (
          <Muted>No blocks yet. Assign blocks on the map with “Select many → Block”.</Muted>
        )}
      </Card>

      <Card>
        <H>Premiums (PLC)</H>
        <Muted style={{ marginBottom: 10 }}>Extra charges like corner, park facing, wide road or East facing. Tick them on each plot or with “Select many → Premiums”.</Muted>
        {pricing.premiums.map((p) => (
          <View key={p.id} style={styles.premRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.premName}>{p.name}</Text>
              <Muted style={{ fontSize: 12.5 }}>
                {premiumText(p, project.currency, au)} · on {usage(p.id)} plots
              </Muted>
            </View>
            {isAdmin ? (
              <IconButton
                icon="trash-outline"
                label={`Delete ${p.name}`}
                color={C.danger}
                onPress={async () => {
                  if (usage(p.id) && !(await confirm('Delete premium?', `${p.name} is used on ${usage(p.id)} plots. Their prices will change.`, 'Delete', true))) return;
                  edit({ premiums: pricing.premiums.filter((x) => x.id !== p.id) });
                }}
              />
            ) : null}
          </View>
        ))}
        {isAdmin ? (
          <View style={{ marginTop: 12 }}>
            <Field label="New premium" value={newName} onChangeText={setNewName} placeholder="e.g. Corner, Park facing" testID="premium-name" />
            <Segmented
              value={newKind}
              onChange={setNewKind}
              options={[
                { value: 'pct', label: '% of price' },
                { value: 'perUnit', label: `per ${au}` },
                { value: 'fixed', label: 'Fixed amount' },
              ]}
            />
            <Row>
              <TextInput
                value={newValue}
                onChangeText={setNewValue}
                keyboardType="decimal-pad"
                placeholder={newKind === 'pct' ? 'e.g. 10' : `${project.currency}`}
                placeholderTextColor="#98A2B3"
                style={[styles.input, { flex: 1 }]}
                testID="premium-value"
              />
              <Button small title="Add" icon="add" onPress={addPremium} disabled={!newName.trim() || num(newValue) == null} testID="premium-add" />
            </Row>
          </View>
        ) : null}
      </Card>

      {isAdmin ? <Button title="Save price list" icon="checkmark" onPress={save} loading={saving} disabled={!dirty} testID="pricing-save" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  blockName: { width: 90, fontSize: 15, fontWeight: '700', color: C.text },
  input: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: '#fff' },
  premRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  premName: { fontSize: 15, fontWeight: '600', color: C.text },
});
