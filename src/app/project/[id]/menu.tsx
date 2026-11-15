import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Loading, Muted, Screen, type IconName } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { features } from '@/lib/status';
import { C } from '@/theme';

type Route =
  | '/project/[id]/list'
  | '/project/[id]/dashboard'
  | '/project/[id]/requests'
  | '/project/[id]/collections'
  | '/project/[id]/brokers'
  | '/project/[id]/pricing'
  | '/project/[id]/settings';

interface Item {
  icon: IconName;
  title: string;
  sub: string;
  route: Route;
  badge?: number;
  testID: string;
}

/** Everything in a project, one tap away. */
export default function ProjectMenu() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, plots, loading, isAdmin } = useProject(id);
  if (loading || !project) return <Loading />;
  const f = features(project);
  const pending = plots.filter((p) => p.pending).length;

  const items: (Item | false)[] = [
    { icon: 'list-outline', title: 'All plots', sub: 'List with filters and search', route: '/project/[id]/list', testID: 'open-list' },
    { icon: 'stats-chart-outline', title: 'Dashboard', sub: 'Sales, stages and collections at a glance', route: '/project/[id]/dashboard', testID: 'open-dashboard' },
    f.approval && { icon: 'hourglass-outline', title: 'Approvals', sub: isAdmin ? 'Booking requests from Sales' : 'Requests waiting for the admin', route: '/project/[id]/requests', badge: pending, testID: 'open-requests' },
    isAdmin && f.payments && { icon: 'wallet-outline', title: 'Collections', sub: 'Overdue and upcoming payments', route: '/project/[id]/collections', testID: 'open-collections' },
    isAdmin && f.commission && { icon: 'people-outline', title: 'Brokers & commission', sub: 'Who sold what, commission due', route: '/project/[id]/brokers', testID: 'open-brokers' },
    f.pricing && { icon: 'pricetags-outline', title: 'Price list', sub: 'Base rate, block rates, premiums', route: '/project/[id]/pricing', testID: 'open-pricing-menu' },
    { icon: 'settings-outline', title: 'Settings', sub: 'Codes, team, features, export', route: '/project/[id]/settings', testID: 'open-settings-menu' },
  ];

  return (
    <Screen>
      <Stack.Screen options={{ title: project.name }} />
      {items.filter((x): x is Item => !!x).map((it) => (
        <Pressable key={it.title} onPress={() => router.push({ pathname: it.route, params: { id } })} testID={it.testID}>
          {({ pressed }) => (
            <View style={[styles.item, pressed && { opacity: 0.8 }]}>
              <View style={styles.icon}>
                <Ionicons name={it.icon} size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{it.title}</Text>
                <Muted style={{ fontSize: 13 }}>{it.sub}</Muted>
              </View>
              {it.badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{it.badge}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </View>
          )}
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#F08C00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
