import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Badge, Button, Card, Loading, Muted, Row, Screen } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { STATUS_COLOR, statusLabel } from '@/lib/status';
import { C } from '@/theme';

/** Status changes requested by Sales, waiting for an Admin. */
export default function Requests() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, userName, toast } = useApp();
  const { project, plots, loading, isAdmin } = useProject(id);
  if (loading || !project) return <Loading />;
  const pending = plots.filter((p) => p.pending).sort((a, b) => (a.pending!.at || 0) - (b.pending!.at || 0));

  const decide = (pid: string, ok: boolean) => {
    const plot = plots.find((p) => p.id === pid);
    if (!plot) return;
    backend.decideRequest(id, plot, ok, { name: userName }).then(
      () => toast(ok ? `Plot ${plot.number} approved` : `Plot ${plot.number} rejected`),
      (e: Error) => toast(e.message),
    );
  };

  return (
    <Screen>
      {pending.length === 0 ? <Muted style={{ textAlign: 'center', marginTop: 24 }}>No requests waiting. 🎉</Muted> : null}
      {pending.map((p) => (
        <Card key={p.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.num}>Plot {p.number}</Text>
            <Muted style={{ fontSize: 12 }}>{new Date(p.pending!.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Muted>
          </Row>
          <Row style={{ marginVertical: 8 }}>
            <Badge text={statusLabel(project, p.status)} color={STATUS_COLOR[p.status]} soft />
            <Text style={{ color: C.muted }}>→</Text>
            <Badge text={statusLabel(project, p.pending!.status)} color={STATUS_COLOR[p.pending!.status]} />
          </Row>
          <Muted>
            Asked by <Text style={{ fontWeight: '700', color: C.text }}>{p.pending!.byName}</Text>
            {p.buyerName ? ` · Buyer: ${p.buyerName}${p.buyerPhone ? ' (' + p.buyerPhone + ')' : ''}` : ''}
          </Muted>
          {isAdmin ? (
            <View style={styles.actions}>
              <Button small title="Approve" icon="checkmark" onPress={() => decide(p.id, true)} testID={`approve-${p.number}`} />
              <Button small variant="secondary" title="Reject" icon="close" onPress={() => decide(p.id, false)} />
              <Button small variant="ghost" title="Details" onPress={() => router.push({ pathname: '/project/[id]/plot/[plotId]', params: { id, plotId: p.id } })} />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  num: { fontSize: 18, fontWeight: '800', color: C.text },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
});
