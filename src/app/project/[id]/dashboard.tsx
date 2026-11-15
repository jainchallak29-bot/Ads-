import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { ColumnChart, MeterList, RankedBars, SegmentedBar, StatTile } from '@/components/charts';
import { Card, H, Loading, Muted, Screen } from '@/components/ui';
import { useAccounts } from '@/hooks/useAccounts';
import { useProject } from '@/hooks/useProject';
import { comparePlotNumbers } from '@/lib/cad/detect';
import { summarize } from '@/lib/export/exporters';
import { accountStatus } from '@/lib/finance';
import { STATUS_COLOR, enabledStatuses, features, isTaken, statusLabel } from '@/lib/status';
import { AREA_UNIT_SHORT, fmtNum, plotArea } from '@/lib/units';

/** 12.9L / 3.4Cr style compact rupee amounts */
function compactMoney(n: number, cur: string) {
  if (n >= 1e7) return `${cur}${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2)} Cr`;
  if (n >= 1e5) return `${cur}${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)} L`;
  return `${cur}${Math.round(n).toLocaleString('en-IN')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, plots, loading, isAdmin } = useProject(id);
  const f = features(project);
  const { accounts, brokers } = useAccounts(id, isAdmin && (f.payments || f.commission));

  const monthly = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const count = new Map(keys.map((k) => [k, 0]));
    for (const p of plots) {
      if (!isTaken(p.status) || !p.bookingDate) continue;
      const k = p.bookingDate.slice(0, 7);
      if (count.has(k)) count.set(k, count.get(k)! + 1);
    }
    return keys.map((k) => ({ label: MONTHS[Number(k.slice(5)) - 1], value: count.get(k) || 0 }));
  }, [plots]);

  if (loading || !project) return <Loading />;
  const s = summarize(project, plots);
  const au = AREA_UNIT_SHORT[project.areaUnit];
  const cur = project.currency;
  const pct = s.total ? Math.round((s.taken / s.total) * 100) : 0;

  const stages = enabledStatuses(project);
  for (const p of plots) if (!stages.includes(p.status)) stages.push(p.status);
  const stageArea = (st: string) => plots.filter((p) => p.status === st).reduce((a, p) => a + plotArea(p, project), 0);

  const blocks = [...new Set(plots.map((p) => p.block).filter((b): b is string => !!b))].sort(comparePlotNumbers);
  const sellers = new Map<string, number>();
  for (const p of plots) if (isTaken(p.status) && p.soldBy) sellers.set(p.soldBy, (sellers.get(p.soldBy) || 0) + 1);
  const brokerCounts = new Map<string, number>();
  for (const p of plots) {
    const b = accounts[p.id]?.brokerId;
    if (b && isTaken(p.status)) brokerCounts.set(b, (brokerCounts.get(b) || 0) + 1);
  }

  let received = 0;
  let overdue = 0;
  if (isAdmin && f.payments) {
    for (const p of plots) {
      if (!isTaken(p.status)) continue;
      const st = accountStatus(p, project, accounts[p.id]);
      received += st.paid;
      overdue += st.overdue;
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <StatTile label="Plots sold / booked" value={`${s.taken} of ${s.total}`} sub={`${pct}% of the project`} testID="kpi-sold" />
        <StatTile label="Available" value={String(s.available)} sub={`${fmtNum(s.areaTotal - s.areaTaken - stageArea('blocked'), 0)} ${au} left`} />
        <StatTile label="Sale value" value={compactMoney(s.valueTaken, cur)} sub={`${fmtNum(s.areaTaken, 0)} ${au} sold`} />
        {isAdmin && f.payments ? <StatTile label="Received" value={compactMoney(received, cur)} sub={overdue ? `${compactMoney(overdue, cur)} overdue` : 'Nothing overdue'} /> : null}
      </View>

      <Card>
        <H>Plots by stage</H>
        <SegmentedBar
          unit="plots"
          parts={stages.map((st) => ({
            key: st,
            label: statusLabel(project, st),
            value: s.counts[st],
            color: STATUS_COLOR[st],
            extra: `${fmtNum(stageArea(st), 0)} ${au}`,
          }))}
        />
      </Card>

      <Card>
        <H>Bookings per month</H>
        <Muted style={{ marginBottom: 10, fontSize: 13 }}>Plots booked or sold, by booking date (last 12 months). Tap a column.</Muted>
        {monthly.some((m) => m.value) ? <ColumnChart data={monthly} format={(n) => `${n}`} /> : <Muted>No bookings with a booking date yet.</Muted>}
      </Card>

      {f.blocks && blocks.length ? (
        <Card>
          <H>Blocks</H>
          <MeterList
            data={blocks.map((b) => {
              const inB = plots.filter((p) => p.block === b);
              const sold = inB.filter((p) => isTaken(p.status)).length;
              return { label: `Block ${b}`, value: sold, total: inB.length, text: `${sold} of ${inB.length} sold` };
            })}
          />
        </Card>
      ) : null}

      {sellers.size ? (
        <Card>
          <H>Sales by team member</H>
          <RankedBars data={[...sellers.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} format={(n) => `${n} plot${n === 1 ? '' : 's'}`} />
        </Card>
      ) : null}

      {isAdmin && f.commission && brokerCounts.size ? (
        <Card>
          <H>Sales by broker</H>
          <RankedBars
            data={[...brokerCounts.entries()].sort((a, b) => b[1] - a[1]).map(([bid, value]) => ({ label: brokers.find((b) => b.id === bid)?.name || 'Unknown', value }))}
            format={(n) => `${n} plot${n === 1 ? '' : 's'}`}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
