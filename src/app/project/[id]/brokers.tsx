import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { SheetModal } from '@/components/SheetModal';
import { Banner, Button, Card, Field, H, IconButton, Loading, Muted, Row, Screen, Segmented, confirm } from '@/components/ui';
import { useAccounts } from '@/hooks/useAccounts';
import { useProject } from '@/hooks/useProject';
import { commissionAmount, commissionPaid } from '@/lib/finance';
import type { Broker, CommissionKind } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtMoney } from '@/lib/units';
import { C } from '@/theme';

export default function Brokers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, toast } = useApp();
  const { project, plots, loading, isAdmin } = useProject(id);
  const { accounts, brokers } = useAccounts(id, isAdmin);
  const [edit, setEdit] = useState<Broker | null>(null);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  if (loading || !project) return <Loading />;
  if (!isAdmin) return <Screen><Banner text="Brokers and commission are visible to Admins only." /></Screen>;
  const money = (n: number) => fmtMoney(n, project.currency);

  const stats = (b: Broker) => {
    const sold = plots.filter((p) => accounts[p.id]?.brokerId === b.id);
    let earned = 0;
    let paid = 0;
    for (const p of sold) {
      earned += commissionAmount(p, project, accounts[p.id], b);
      paid += commissionPaid(accounts[p.id]);
    }
    return { sold, earned, paid };
  };
  const totals = brokers.map(stats).reduce((t, s) => ({ earned: t.earned + s.earned, paid: t.paid + s.paid }), { earned: 0, paid: 0 });

  const startEdit = (b?: Broker) => {
    const nb = b ?? { id: backend.newId(), name: '', phone: '', firm: '', commission: { kind: 'pct' as CommissionKind, value: 2 } };
    setEdit(nb);
    setValue(String(nb.commission.value));
  };

  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    const v = Number(value.replace(/,/g, ''));
    try {
      await backend.saveBroker(id, { ...edit, name: edit.name.trim(), commission: { ...edit.commission, value: Number.isFinite(v) ? v : 0 } });
      toast('Broker saved');
      setEdit(null);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Screen>
      <Card>
        <H>Commission</H>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Muted>Earned</Muted>
            <Text style={styles.big}>{money(totals.earned)}</Text>
          </View>
          <View>
            <Muted>Paid</Muted>
            <Text style={styles.big}>{money(totals.paid)}</Text>
          </View>
          <View>
            <Muted>Pending</Muted>
            <Text style={[styles.big, { color: totals.earned - totals.paid > 0 ? C.danger : C.text }]}>{money(totals.earned - totals.paid)}</Text>
          </View>
        </Row>
      </Card>
      <Button title="Add broker" icon="person-add-outline" onPress={() => startEdit()} style={{ marginBottom: 12 }} testID="add-broker" />
      {brokers.map((b) => {
        const s = stats(b);
        return (
          <Card key={b.id}>
            <Pressable onPress={() => setOpen(open === b.id ? null : b.id)}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{b.name}</Text>
                  <Muted style={{ fontSize: 12.5 }}>
                    {[b.firm, b.phone].filter(Boolean).join(' · ')}
                    {b.firm || b.phone ? ' · ' : ''}
                    {b.commission.kind === 'pct' ? `${b.commission.value}%` : b.commission.kind === 'perUnit' ? `${money(b.commission.value)}/${AREA_UNIT_SHORT[project.areaUnit]}` : money(b.commission.value)}
                  </Muted>
                </View>
                {b.phone ? <IconButton icon="call-outline" label={`Call ${b.name}`} onPress={() => Linking.openURL(`tel:${b.phone}`)} /> : null}
                <IconButton icon="create-outline" label={`Edit ${b.name}`} onPress={() => startEdit(b)} />
              </Row>
              <Muted style={{ marginTop: 6 }}>
                {s.sold.length} plots · earned {money(s.earned)} · paid {money(s.paid)} · <Text style={{ fontWeight: '700', color: C.text }}>pending {money(s.earned - s.paid)}</Text>
              </Muted>
            </Pressable>
            {open === b.id
              ? s.sold.map((p) => (
                  <Pressable key={p.id} onPress={() => router.push({ pathname: '/project/[id]/accounts/[plotId]', params: { id, plotId: p.id } })} style={styles.plotRow}>
                    <Text style={{ fontWeight: '700', width: 60 }}>{p.number}</Text>
                    <Muted style={{ flex: 1 }}>{p.buyerName || ''}</Muted>
                    <Muted>{money(commissionAmount(p, project, accounts[p.id], b) - commissionPaid(accounts[p.id]))} pending</Muted>
                  </Pressable>
                ))
              : null}
          </Card>
        );
      })}

      <SheetModal visible={!!edit} title={edit && brokers.some((b) => b.id === edit.id) ? 'Edit broker' : 'New broker'} onClose={() => setEdit(null)}>
        {edit ? (
          <>
            <Field label="Name" value={edit.name} onChangeText={(t) => setEdit({ ...edit, name: t })} autoCapitalize="words" testID="broker-name" />
            <Field label="Phone" value={edit.phone || ''} onChangeText={(t) => setEdit({ ...edit, phone: t })} keyboardType="phone-pad" />
            <Field label="Firm (optional)" value={edit.firm || ''} onChangeText={(t) => setEdit({ ...edit, firm: t })} />
            <Segmented
              label="Default commission"
              value={edit.commission.kind}
              onChange={(k) => setEdit({ ...edit, commission: { ...edit.commission, kind: k } })}
              options={[
                { value: 'pct', label: '% of price' },
                { value: 'perUnit', label: `per ${AREA_UNIT_SHORT[project.areaUnit]}` },
                { value: 'fixed', label: 'Fixed' },
              ]}
            />
            <Field label="Value" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
            <Row>
              <Button title="Save" onPress={save} style={{ flex: 1 }} testID="broker-save" />
              {brokers.some((b) => b.id === edit.id) ? (
                <Button
                  title="Delete"
                  variant="danger"
                  onPress={async () => {
                    if (!(await confirm('Delete broker?', `${edit.name} will be removed. Their plots keep their payment records.`, 'Delete', true))) return;
                    await backend.deleteBroker(id, edit.id);
                    setEdit(null);
                  }}
                />
              ) : null}
            </Row>
          </>
        ) : null}
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 18, fontWeight: '800', color: C.text },
  name: { fontSize: 17, fontWeight: '700', color: C.text },
  plotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, marginTop: 6 },
});
