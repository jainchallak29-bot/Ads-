import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STATUS_COLOR, enabledStatuses, statusLabel } from '@/lib/status';
import type { PlotStatus, Project } from '@/lib/types';
import { C } from '@/theme';

/** Wrapping status chips (up to six sale stages). */
export function StatusPicker({
  project,
  value,
  onChange,
  disabled,
  exclude = [],
}: {
  project: Project;
  value: PlotStatus | null;
  onChange: (s: PlotStatus) => void;
  disabled?: boolean;
  exclude?: PlotStatus[];
}) {
  const list = enabledStatuses(project).filter((s) => !exclude.includes(s) || s === value);
  return (
    <View style={styles.wrap}>
      {list.map((s) => {
        const on = s === value;
        return (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityLabel={statusLabel(project, s)}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(s)}
            style={[styles.chip, { borderColor: STATUS_COLOR[s] }, on && { backgroundColor: STATUS_COLOR[s] }, disabled && !on && { opacity: 0.45 }]}
          >
            <View style={[styles.dot, { backgroundColor: on ? '#fff' : STATUS_COLOR[s] }]} />
            <Text style={[styles.text, on && { color: '#fff' }]}>{statusLabel(project, s)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 14, fontWeight: '700', color: C.text },
});
