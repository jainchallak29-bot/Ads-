import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Card, H, IconButton, Loading, Muted, Row, Screen, Segmented } from '@/components/ui';
import { useAccounts } from '@/hooks/useAccounts';
import { useProject } from '@/hooks/useProject';
import { accountStatus, today } from '@/lib/finance';
import { isTaken, statusLabel } from '@/lib/status';
import { fmtMoney } from '@/lib/units';
import { C } from '@/theme';

type View_ = 'overdue' | 'upcoming' | 'all';

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00');
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Money to collect: overdue instalments, dues in the next 30 days, balances. */
export default function Collections() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, plots, loading, isAdmin } = useProject(id);
  const { accounts } = useAccounts(id, isAdmin);
  const [view, setView] = useState<View_>('overdue');

  const rows = useMemo(() => {
    if (!project) return [];
    const t = today();
    const soon = addDays(t, 30);
    return plots
      .filter((p) => isTaken(p.status))
      .map((p) => ({ p, st: accountStatus(p, project, accounts[p.id]) }))
      .filter(({ st }) => (view === 'overdue' ? st.overdue > 0 : view === 'upcoming' ? !!st.next && st.next.due >= t && st.next.due <= soon : true))
      .sort((a, b) => (view === 'overdue' ? b.st.overdue - a.st.overdue : view === 'upcoming' ? (a.st.next?.due || '').localeCompare(b.st.next?.due || '') : (b.st.balance || 0) - (a.st.balance || 0)));
  }, [plots, project, accounts, view]);

  if (loading || !project) return <Loading />;
  if (!isAdmin) return <Screen><Banner text="Payments are visible to Admins only." /></Screen>;

  const all = plots.filter((p) => isTaken(p.status)).map((p) => accountStatus(p, project, accounts[p.id]));
  const tot = all.reduce((s, x) => ({ value: s.value + (x.price || 0), paid: s.paid + x.paid, overdue: s.overdue + x.overdue }), { value: 0, paid: 0, overdue: 0 });
  const money = (n: number | null) => fmtMoney(n, project.currency);

  return (
    <Screen>
      <Card>
        <H>Collections</H>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Muted>Sale value</Muted>
            <Text style={styles.big}>{money(tot.value)}</Text>
          </View>
          <View>
            <Muted>Received</Muted>
            <Text style={styles.big}>{money(tot.paid)}</Text>
          </View>
          <View>
            <Muted>Overdue</Muted>
            <Text style={[styles.big, { color: tot.overdue ? C.danger : C.text }]}>{money(tot.overdue)}</Text>
          </View>
        </Row>
        <Muted style={{ marginTop: 6 }}>Balance to collect: {money(tot.value - tot.paid)}</Muted>
      </Card>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'overdue', label: 'Overdue' },
          { value: 'upcoming', label: 'Next 30 days' },
          { value: 'all', label: 'All balances' },
        ]}
      />
      {rows.length === 0 ? <Muted style={{ textAlign: 'center', marginTop: 20 }}>Nothing here.</Muted> : null}
      {rows.map(({ p, st }) => (
        <Pressable key={p.id} onPress={() => router.push({ pathname: '/project/[id]/accounts/[plotId]', params: { id, plotId: p.id } })}>
          <Card style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.plot}>
                Plot {p.number} <Text style={styles.stage}>· {statusLabel(project, p.status)}</Text>
              </Text>
              <Muted style={{ fontSize: 13 }}>{p.buyerName || 'No buyer name'}</Muted>
              <Muted style={{ fontSize: 13 }}>
                {view === 'overdue'
                  ? `Overdue ${money(st.overdue)}`
                  : view === 'upcoming' && st.next
                    ? `${money(st.next.remaining)} due ${st.next.due}`
                    : `Balance ${money(st.balance)} · received ${money(st.paid)}`}
              </Muted>
            </View>
            {p.buyerPhone ? (
              <>
                <IconButton icon="call-outline" label={`Call ${p.buyerName}`} onPress={() => Linking.openURL(`tel:${p.buyerPhone}`)} />
                <IconButton
                  icon="logo-whatsapp"
                  label={`WhatsApp ${p.buyerName}`}
                  color="#25D366"
                  onPress={() =>
                    Linking.openURL(
                      `https://wa.me/${p.buyerPhone!.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(
                        `Dear ${p.buyerName || 'Sir/Madam'}, a payment of ${money(view === 'overdue' ? st.overdue : st.next?.remaining ?? st.balance)} for plot ${p.number}, ${project.name} is due. Kindly arrange the payment. Thank you.`,
                      )}`,
                    )
                  }
                />
              </>
            ) : null}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 17, fontWeight: '800', color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  plot: { fontSize: 16, fontWeight: '700', color: C.text },
  stage: { fontWeight: '500', color: C.muted, fontSize: 14 },
});
