import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { SheetModal } from '@/components/SheetModal';
import { StatusPicker } from '@/components/StatusPicker';
import { Button, Muted, Row } from '@/components/ui';
import { premiumText } from '@/lib/pricing';
import { features } from '@/lib/status';
import type { Plot, PlotPatch, Project } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtNum, plotArea } from '@/lib/units';
import { C } from '@/theme';

type Dialog = null | 'status' | 'block' | 'premiums' | 'rate';

/** Toolbar for "Select many" mode: change status, block, premiums or rate of many plots at once. */
export function BulkBar({
  project,
  selected,
  blocks,
  onApply,
  onSelectAll,
  onClear,
  onDone,
}: {
  project: Project;
  selected: Plot[];
  blocks: string[];
  onApply: (patch: (p: Plot) => PlotPatch | null, label: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const f = features(project);
  const premiums = project.pricing?.premiums || [];
  const n = selected.length;
  const area = selected.reduce((s, p) => s + plotArea(p, project), 0);
  const au = AREA_UNIT_SHORT[project.areaUnit];

  const open = (d: Dialog, initial = '') => {
    setText(initial);
    setDialog(d);
  };
  const close = () => setDialog(null);

  return (
    <View style={styles.bar}>
      <Text style={styles.hint}>
        {n ? `${n} plots selected · ${fmtNum(area, 0)} ${au}` : 'Tap plots to select them.'}
      </Text>
      <View style={styles.row}>
        <Button small title="Status" icon="flag-outline" disabled={!n} onPress={() => open('status')} testID="bulk-status" />
        {f.blocks ? <Button small variant="secondary" title="Block" icon="albums-outline" disabled={!n} onPress={() => open('block', selected[0]?.block || '')} testID="bulk-block" /> : null}
        {f.pricing && premiums.length ? <Button small variant="secondary" title="Premiums" icon="star-outline" disabled={!n} onPress={() => open('premiums')} /> : null}
        <Button small variant="secondary" title="Rate" icon="pricetag-outline" disabled={!n} onPress={() => open('rate')} />
        <Button small variant="ghost" title="Select all shown" onPress={onSelectAll} testID="bulk-all" />
        {n ? <Button small variant="ghost" title="Clear" onPress={onClear} /> : null}
        <Button small variant="ghost" title="Done" onPress={onDone} testID="bulk-done" />
      </View>

      <SheetModal visible={dialog === 'status'} title={`Status for ${n} plots`} onClose={close}>
        <StatusPicker
          project={project}
          value={null}
          onChange={(s) => {
            close();
            onApply((p) => (p.status === s ? null : { status: s }), `${n} plots updated`);
          }}
        />
      </SheetModal>

      <SheetModal visible={dialog === 'block'} title={`Block / phase for ${n} plots`} onClose={close}>
        <TextInput value={text} onChangeText={setText} placeholder="e.g. A, B, Phase 2" placeholderTextColor="#98A2B3" style={styles.input} autoCapitalize="characters" testID="bulk-block-input" />
        {blocks.length ? (
          <Row style={{ flexWrap: 'wrap', marginTop: 10 }}>
            {blocks.map((b) => (
              <Button key={b} small variant="secondary" title={b} onPress={() => setText(b)} />
            ))}
          </Row>
        ) : null}
        <Muted style={{ marginTop: 10 }}>Leave empty to remove the block.</Muted>
        <Button
          title="Apply"
          style={{ marginTop: 12 }}
          onPress={() => {
            const b = text.trim();
            close();
            onApply((p) => ((p.block || '') === b ? null : { block: b }), b ? `${n} plots moved to ${b}` : 'Block removed');
          }}
          testID="bulk-block-apply"
        />
      </SheetModal>

      <SheetModal visible={dialog === 'premiums'} title={`Premiums for ${n} plots`} onClose={close}>
        {premiums.map((pr) => (
          <View key={pr.id} style={styles.premRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.premName}>{pr.name}</Text>
              <Muted style={{ fontSize: 12 }}>{premiumText(pr, project.currency, AREA_UNIT_SHORT[project.areaUnit])}</Muted>
            </View>
            <Button
              small
              variant="secondary"
              title="Add"
              onPress={() => onApply((p) => (p.premiums?.includes(pr.id) ? null : { premiums: [...(p.premiums || []), pr.id] }), `${pr.name} added`)}
            />
            <Button
              small
              variant="ghost"
              title="Remove"
              onPress={() => onApply((p) => (p.premiums?.includes(pr.id) ? { premiums: (p.premiums || []).filter((x) => x !== pr.id) } : null), `${pr.name} removed`)}
            />
          </View>
        ))}
        <Button title="Close" variant="secondary" style={{ marginTop: 12 }} onPress={close} />
      </SheetModal>

      <SheetModal visible={dialog === 'rate'} title={`Rate per ${au} for ${n} plots`} onClose={close}>
        <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder={`${project.currency} per ${au}`} placeholderTextColor="#98A2B3" style={styles.input} />
        <Muted style={{ marginTop: 10 }}>Leave empty to use the price list (block / base rate) again.</Muted>
        <Button
          title="Apply"
          style={{ marginTop: 12 }}
          onPress={() => {
            const v = Number(text.replace(/,/g, ''));
            const rate = text.trim() && Number.isFinite(v) && v > 0 ? v : null;
            close();
            onApply(() => ({ rate }), rate ? `Rate set for ${n} plots` : 'Rate cleared');
          }}
        />
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  hint: { fontSize: 13.5, color: C.muted, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: C.text },
  premRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  premName: { fontSize: 15, fontWeight: '600', color: C.text },
});
