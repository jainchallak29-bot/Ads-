import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Loading, Muted } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { comparePlotNumbers } from '@/lib/cad/detect';
import { summarize } from '@/lib/export/exporters';
import { STATUS_COLOR, enabledStatuses, features, statusLabel } from '@/lib/status';
import type { PlotStatus } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtArea, fmtDimensions, fmtMoney, fmtNum } from '@/lib/units';
import { C } from '@/theme';

type F = 'all' | PlotStatus;

function Chip({ label, on, color, onPress }: { label: string; on: boolean; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && { backgroundColor: color ?? C.primary, borderColor: color ?? C.primary }]}>
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export default function PlotList() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, plots, loading } = useProject(id);
  const [filter, setFilter] = useState<F>('all');
  const [block, setBlock] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const blocks = useMemo(() => [...new Set(plots.map((p) => p.block).filter((b): b is string => !!b))].sort(comparePlotNumbers), [plots]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return plots.filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!block || p.block === block) &&
        (!s || p.number.toLowerCase().includes(s) || (p.buyerName || '').toLowerCase().includes(s) || (p.buyerPhone || '').includes(s)),
    );
  }, [plots, filter, block, q]);

  if (loading || !project) return <Loading />;
  const inBlock = block ? plots.filter((p) => p.block === block) : plots;
  const sum = summarize(project, inBlock);
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const stages = enabledStatuses(project);
  for (const p of plots) if (!stages.includes(p.status)) stages.push(p.status);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      <View style={styles.head}>
        <Text style={styles.summary}>
          {block ? `Block ${block} · ` : ''}
          {sum.total} plots · {fmtNum(sum.areaTotal, 0)} {au}
        </Text>
        <Muted style={{ fontSize: 13, marginBottom: 10 }}>
          Booked / sold: {sum.taken} ({fmtNum(sum.areaTaken, 0)} {au}) · Value {fmtMoney(sum.valueTaken, project.currency)}
        </Muted>
        <TextInput value={q} onChangeText={setQ} placeholder="Search plot no., buyer or phone" placeholderTextColor="#98A2B3" style={styles.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={`All ${sum.total}`} on={filter === 'all'} onPress={() => setFilter('all')} />
          {stages.map((s) => (
            <Chip key={s} label={`${statusLabel(project, s)} ${sum.counts[s]}`} on={filter === s} color={STATUS_COLOR[s]} onPress={() => setFilter(s)} />
          ))}
        </ScrollView>
        {features(project).blocks && blocks.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="All blocks" on={!block} color={C.text} onPress={() => setBlock(null)} />
            {blocks.map((b) => (
              <Chip key={b} label={b} on={block === b} color={C.text} onPress={() => setBlock(block === b ? null : b)} />
            ))}
          </ScrollView>
        ) : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: 24 }}>No plots match.</Muted>}
        renderItem={({ item: p }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/project/[id]/plot/[plotId]', params: { id, plotId: p.id } })}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.stripe, { backgroundColor: STATUS_COLOR[p.status] }]} />
            <View style={{ minWidth: 48 }}>
              <Text style={styles.num}>{p.number}</Text>
              {p.block ? <Muted style={{ fontSize: 11 }}>{p.block}</Muted> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.main}>
                {fmtArea(p, project)} · {fmtDimensions(p, project)}
              </Text>
              {p.buyerName ? <Muted style={{ fontSize: 13 }}>{p.buyerName}</Muted> : null}
            </View>
            <Badge text={statusLabel(project, p.status)} color={STATUS_COLOR[p.status]} soft />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: '#fff', padding: 12, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  summary: { fontSize: 17, fontWeight: '800', color: C.text },
  search: { backgroundColor: '#F2F4F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10, color: C.text },
  chips: { gap: 6, paddingBottom: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff' },
  chipText: { fontSize: 13, fontWeight: '700', color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, paddingLeft: 0, marginBottom: 8, overflow: 'hidden' },
  stripe: { width: 5, alignSelf: 'stretch', borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  num: { fontSize: 18, fontWeight: '800', color: C.text },
  main: { fontSize: 14, color: C.text, fontWeight: '500' },
});
