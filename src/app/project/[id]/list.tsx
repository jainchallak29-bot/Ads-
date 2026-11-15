import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Loading, Muted, Segmented } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { summarize } from '@/lib/export/exporters';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status';
import type { PlotStatus } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtArea, fmtDimensions, fmtMoney, fmtNum } from '@/lib/units';
import { C } from '@/theme';

type F = 'all' | PlotStatus;

export default function PlotList() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, plots, loading } = useProject(id);
  const [filter, setFilter] = useState<F>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return plots.filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!s || p.number.toLowerCase().includes(s) || (p.buyerName || '').toLowerCase().includes(s) || (p.buyerPhone || '').includes(s)),
    );
  }, [plots, filter, q]);

  if (loading || !project) return <Loading />;
  const sum = summarize(project, plots);
  const au = AREA_UNIT_SHORT[project.areaUnit];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      <View style={styles.head}>
        <Text style={styles.summary}>
          {sum.total} plots · {fmtNum(sum.areaTotal, 0)} {au}
        </Text>
        <Muted style={{ fontSize: 13, marginBottom: 10 }}>
          Booked + sold: {sum.booked + sum.sold} ({fmtNum(sum.areaSold, 0)} {au}) · Value {fmtMoney(sum.valueSold, project.currency)}
        </Muted>
        <TextInput value={q} onChangeText={setQ} placeholder="Search plot no., buyer or phone" placeholderTextColor="#98A2B3" style={styles.search} />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${sum.total}` },
            { value: 'available', label: `Avail. ${sum.available}`, color: STATUS_COLOR.available },
            { value: 'booked', label: `Booked ${sum.booked}`, color: STATUS_COLOR.booked },
            { value: 'sold', label: `Sold ${sum.sold}`, color: STATUS_COLOR.sold },
          ]}
        />
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
            <Text style={styles.num}>{p.number}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.main}>
                {fmtArea(p, project)} · {fmtDimensions(p, project)}
              </Text>
              {p.buyerName ? <Muted style={{ fontSize: 13 }}>{p.buyerName}</Muted> : null}
            </View>
            <Badge text={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} soft />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: '#fff', padding: 12, paddingBottom: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  summary: { fontSize: 17, fontWeight: '800', color: C.text },
  search: { backgroundColor: '#F2F4F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10, color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, paddingLeft: 0, marginBottom: 8, overflow: 'hidden' },
  stripe: { width: 5, alignSelf: 'stretch', borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  num: { fontSize: 18, fontWeight: '800', color: C.text, minWidth: 44 },
  main: { fontSize: 14, color: C.text, fontWeight: '500' },
});
