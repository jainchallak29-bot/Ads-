import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { Badge, Button, IconButton, Loading, Muted, Segmented } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { today } from '@/lib/finance';
import { STAGE_COLOR, STAGE_LABEL, isDue, isOpen, whatsappUrl } from '@/lib/leads';
import type { Lead } from '@/lib/types';
import { C } from '@/theme';

type Tab = 'due' | 'open' | 'won' | 'lost';

export default function Leads() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend } = useApp();
  const { project, loading, membership } = useProject(id);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tab, setTab] = useState<Tab>('due');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!membership) return;
    return backend.watchLeads(id, setLeads, () => undefined);
  }, [backend, id, membership]);

  const t = today();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return leads
      .filter((l) => (tab === 'due' ? isDue(l, t) : tab === 'open' ? isOpen(l) : l.stage === tab))
      .filter((l) => !s || l.name.toLowerCase().includes(s) || l.phone.includes(s) || l.interested.some((n) => n.toLowerCase().includes(s)))
      .sort((a, b) => (tab === 'due' || tab === 'open' ? (a.nextFollowUp || '9999').localeCompare(b.nextFollowUp || '9999') : b.updatedAt - a.updatedAt));
  }, [leads, tab, q, t]);

  if (loading || !project) return <Loading />;
  const due = leads.filter((l) => isDue(l, t)).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      <View style={styles.head}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search name, phone or plot" placeholderTextColor="#98A2B3" style={styles.search} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'due', label: `Follow up ${due}` },
            { value: 'open', label: `Open ${leads.filter(isOpen).length}` },
            { value: 'won', label: 'Booked' },
            { value: 'lost', label: 'Lost' },
          ]}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: 24 }}>{tab === 'due' ? 'No follow-ups due today. 👍' : 'No leads here.'}</Muted>}
        renderItem={({ item: l }) => (
          <Pressable onPress={() => router.push({ pathname: '/project/[id]/leads/[leadId]', params: { id, leadId: l.id } })} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{l.name}</Text>
              <Muted style={{ fontSize: 13 }}>
                {l.interested.length ? `Plots ${l.interested.join(', ')} · ` : ''}
                {l.nextFollowUp && isOpen(l) ? (
                  <Text style={{ color: l.nextFollowUp < t ? C.danger : C.muted }}>follow up {l.nextFollowUp === t ? 'today' : l.nextFollowUp}</Text>
                ) : (
                  `${l.visits.length} visits`
                )}
              </Muted>
              <View style={{ marginTop: 4 }}>
                <Badge text={STAGE_LABEL[l.stage]} color={STAGE_COLOR[l.stage]} soft />
              </View>
            </View>
            {l.phone ? (
              <>
                <IconButton icon="call-outline" label={`Call ${l.name}`} onPress={() => Linking.openURL(`tel:${l.phone}`)} />
                <IconButton icon="logo-whatsapp" color="#25D366" label={`WhatsApp ${l.name}`} onPress={() => Linking.openURL(whatsappUrl(l.phone, `Hello ${l.name}, regarding plots at ${project.name}.`))} />
              </>
            ) : null}
          </Pressable>
        )}
      />
      <View style={styles.fab} pointerEvents="box-none">
        <Button title="Add lead" icon="person-add-outline" onPress={() => router.push({ pathname: '/project/[id]/leads/[leadId]', params: { id, leadId: 'new' } })} testID="add-lead" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { backgroundColor: '#fff', padding: 12, paddingBottom: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  search: { backgroundColor: '#F2F4F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10, color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '700', color: C.text },
  fab: { position: 'absolute', right: 16, bottom: 24 },
});
