import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { Loading, Muted, type IconName } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { STATUS_COLOR, isPlotStatus, statusLabel } from '@/lib/status';
import type { Activity, PlotStatus } from '@/lib/types';
import { C } from '@/theme';

const ICON: Record<string, IconName> = {
  status: 'flag',
  request: 'hourglass-outline',
  rejected: 'close-circle-outline',
  renamed: 'text-outline',
  shape: 'shapes-outline',
  layout: 'layers-outline',
};

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Everything that changed in the project, newest first. */
export default function ActivityFeed() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend } = useApp();
  const { project, plots, loading, membership } = useProject(id);
  const [items, setItems] = useState<Activity[] | null>(null);

  useEffect(() => {
    if (!membership) return;
    return backend.watchActivity(id, null, setItems, () => setItems([]));
  }, [backend, id, membership]);

  if (loading || !project || !items) return <Loading />;
  const sections: { title: string; data: Activity[] }[] = [];
  for (const a of items) {
    const t = dayLabel(a.at);
    if (!sections.length || sections[sections.length - 1].title !== t) sections.push({ title: t, data: [] });
    sections[sections.length - 1].data.push(a);
  }

  const describe = (a: Activity) => {
    const st = (x?: string) => (isPlotStatus(x) ? statusLabel(project, x as PlotStatus) : x || '');
    switch (a.action) {
      case 'status':
        return `Plot ${a.plotNumber}: ${st(a.from)} → ${st(a.to)}${a.note ? ` (${a.note})` : ''}`;
      case 'request':
        return `Plot ${a.plotNumber}: asked to change to ${st(a.to)}`;
      case 'rejected':
        return `Plot ${a.plotNumber}: request for ${st(a.to)} rejected`;
      case 'renamed':
        return `Plot ${a.from} renamed to ${a.to}`;
      default:
        return a.to || a.action;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: 24 }}>Nothing yet.</Muted>}
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        renderItem={({ item: a }) => {
          const to = isPlotStatus(a.to) ? (a.to as PlotStatus) : null;
          const plot = plots.find((p) => p.id === a.plotId);
          return (
            <Pressable
              disabled={!plot}
              onPress={() => plot && router.push({ pathname: '/project/[id]/plot/[plotId]', params: { id, plotId: plot.id } })}
              style={styles.row}
            >
              <View style={[styles.icon, { backgroundColor: to && a.action === 'status' ? STATUS_COLOR[to] + '22' : C.primarySoft }]}>
                <Ionicons name={ICON[a.action] || 'ellipse-outline'} size={18} color={to && a.action === 'status' ? STATUS_COLOR[to] : C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{describe(a)}</Text>
                <Muted style={{ fontSize: 12.5 }}>
                  {a.byName} · {new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </Muted>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  day: { fontSize: 13, fontWeight: '700', color: C.muted, marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 6 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14.5, color: C.text },
});
