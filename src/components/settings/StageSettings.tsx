import { useState } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Button, Card, H, Muted } from '@/components/ui';
import { STATUS_COLOR, STATUS_LABEL, enabledStatuses } from '@/lib/status';
import { ALL_STATUSES, type PlotStatus, type Project, type StatusConfig } from '@/lib/types';
import { C } from '@/theme';

const HINT: Record<PlotStatus, string> = {
  available: 'Free to sell',
  token: 'Token money taken',
  booked: 'Booking amount paid',
  agreement: 'Agreement signed',
  sold: 'Final stage (e.g. Sold / Registered)',
  blocked: 'Kept aside, not for sale (Admins only)',
};

/** Choose which sale stages a project uses and what they are called. */
export function StageSettings({ project }: { project: Project }) {
  const { backend, toast } = useApp();
  const saved: StatusConfig = { enabled: enabledStatuses(project), labels: project.statuses?.labels || {} };
  const [draft, setDraft] = useState<StatusConfig | null>(null);
  const cfg = draft ?? saved;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);

  const toggle = (s: PlotStatus, on: boolean) =>
    setDraft({ ...cfg, enabled: ALL_STATUSES.filter((x) => x === 'available' || (x === s ? on : cfg.enabled.includes(x))) });

  return (
    <Card>
      <H>Sale stages</H>
      <Muted style={{ marginBottom: 8 }}>Switch stages on or off and rename them. Plots keep their stage if you switch one off.</Muted>
      {ALL_STATUSES.map((s) => (
        <View key={s} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[s] }]} />
          <View style={{ flex: 1 }}>
            <TextInput
              value={cfg.labels[s] ?? ''}
              placeholder={STATUS_LABEL[s]}
              placeholderTextColor="#667085"
              onChangeText={(t) => setDraft({ ...cfg, labels: { ...cfg.labels, [s]: t } })}
              style={styles.input}
              accessibilityLabel={`Name for ${STATUS_LABEL[s]}`}
            />
            <Muted style={{ fontSize: 12 }}>{HINT[s]}</Muted>
          </View>
          <Switch
            value={s === 'available' || cfg.enabled.includes(s)}
            disabled={s === 'available'}
            onValueChange={(v) => toggle(s, v)}
            trackColor={{ true: C.primary, false: '#D0D5DD' }}
            accessibilityLabel={`Use ${STATUS_LABEL[s]}`}
          />
        </View>
      ))}
      <Button
        small
        title="Save stages"
        disabled={!dirty}
        style={{ alignSelf: 'flex-start', marginTop: 8 }}
        onPress={() => {
          const labels = Object.fromEntries(Object.entries(cfg.labels).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]));
          backend.updateProject(project.id, { statuses: { enabled: cfg.enabled, labels } }).then(
            () => {
              setDraft(null);
              toast('Stages saved');
            },
            (e: Error) => toast(e.message),
          );
        }}
        testID="stages-save"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  input: { fontSize: 15, fontWeight: '600', color: C.text, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
});
