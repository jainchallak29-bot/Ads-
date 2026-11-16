import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { STATUS_COLOR, enabledStatuses, statusLabel } from '@/lib/status';
import type { Plot, PlotStatus, Project } from '@/lib/types';
import { C } from '@/theme';

export function MapFilters({
  project,
  plots,
  search,
  onSearch,
  onSubmitSearch,
  status,
  onStatus,
  blocks,
  block,
  onBlock,
}: {
  project: Project;
  plots: Plot[];
  search: string;
  onSearch: (s: string) => void;
  onSubmitSearch: () => void;
  status: PlotStatus | null;
  onStatus: (s: PlotStatus | null) => void;
  blocks: string[];
  block: string | null;
  onBlock: (b: string | null) => void;
}) {
  const counts = new Map<PlotStatus, number>();
  for (const p of plots) if (!block || p.block === block) counts.set(p.status, (counts.get(p.status) || 0) + 1);
  // enabled stages, plus any stage still used by a plot after it was switched off
  const shown = enabledStatuses(project);
  for (const s of counts.keys()) if (!shown.includes(s)) shown.push(s);

  return (
    <View style={styles.top}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={C.muted} />
        <TextInput
          value={search}
          onChangeText={onSearch}
          onSubmitEditing={onSubmitSearch}
          placeholder="Find plot no."
          placeholderTextColor="#98A2B3"
          style={styles.searchInput}
          returnKeyType="search"
          autoCapitalize="characters"
          testID="search-input"
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {shown.map((s) => {
          const on = status === s;
          return (
            <Pressable
              key={s}
              onPress={() => onStatus(on ? null : s)}
              style={[styles.stat, on && { backgroundColor: STATUS_COLOR[s] }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`stat-${s}`}
            >
              <View style={[styles.dot, { backgroundColor: on ? '#fff' : STATUS_COLOR[s] }]} />
              <Text style={[styles.statText, on && { color: '#fff' }]}>
                {counts.get(s) || 0} {statusLabel(project, s)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {blocks.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Pressable onPress={() => onBlock(null)} style={[styles.block, !block && styles.blockOn]} testID="block-all">
            <Text style={[styles.blockText, !block && { color: '#fff' }]}>All blocks</Text>
          </Pressable>
          {blocks.map((b) => (
            <Pressable key={b} onPress={() => onBlock(block === b ? null : b)} style={[styles.block, block === b && styles.blockOn]} testID={`block-${b}`}>
              <Text style={[styles.blockText, block === b && { color: '#fff' }]}>{b}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: '#fff', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F4F7', borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 16, color: C.text },
  row: { gap: 6 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F2F4F7' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statText: { fontSize: 13, fontWeight: '700', color: C.text },
  block: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff' },
  blockOn: { backgroundColor: C.text, borderColor: C.text },
  blockText: { fontSize: 13, fontWeight: '600', color: C.text },
});
