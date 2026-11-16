// Small chart components for the dashboard (plain Views: crisp, accessible, fast).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C } from '@/theme';

const ACCENT = '#3B82C4';
const TRACK = '#DCE7F3';

export function StatTile({ label, value, sub, testID }: { label: string; value: string; sub?: string; testID?: string }) {
  return (
    <View style={styles.tile} testID={testID}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

/** One whole split into parts (≤ 6): tall segmented bar + legend with figures. */
export function SegmentedBar({ parts, unit }: { parts: { key: string; label: string; value: number; color: string; extra?: string }[]; unit: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <View>
      <View style={styles.segBar} accessibilityLabel={parts.map((p) => `${p.label} ${p.value} ${unit}`).join(', ')}>
        {shown.map((p, i) => {
          const pct = (p.value / total) * 100;
          return (
            <View
              key={p.key}
              style={[styles.seg, { flex: p.value, backgroundColor: p.color, marginLeft: i ? 2 : 0 }]}
            >
              {pct >= 9 ? <Text style={styles.segText}>{Math.round(pct)}%</Text> : null}
            </View>
          );
        })}
      </View>
      {parts.map((p) => (
        <View key={p.key} style={styles.legendRow}>
          <View style={[styles.swatch, { backgroundColor: p.color }]} />
          <Text style={styles.legendLabel}>{p.label}</Text>
          <Text style={styles.legendValue}>
            {p.value} {p.value === 1 ? unit.replace(/s$/, '') : unit}
            {p.extra ? <Text style={styles.legendExtra}> · {p.extra}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Columns over time, one hue; tap a column to read its value. */
export function ColumnChart({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 140;
  return (
    <View>
      <View style={[styles.cols, { height: H + 22 }]}>
        {data.map((d, i) => {
          const h = d.value ? Math.max(4, (d.value / max) * H) : 0;
          return (
            <Pressable
              key={d.label + i}
              style={styles.colSlot}
              onPress={() => setSel(sel === i ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${format(d.value)}`}
            >
              <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
                {sel === i || (sel == null && d.value === max && d.value > 0) ? <Text style={styles.colValue}>{format(d.value)}</Text> : null}
                <View style={[styles.col, { height: h, backgroundColor: sel == null || sel === i ? ACCENT : '#A9C3E0' }]} />
              </View>
              <Text style={styles.colLabel} numberOfLines={1}>
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.baseline} />
    </View>
  );
}

/** Ranked horizontal bars (largest first), one hue, value at the bar end. */
export function RankedBars({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 10 }}>
      {data.map((d) => (
        <View key={d.label}>
          <Text style={styles.rankLabel}>{d.label}</Text>
          <View style={styles.rankRow}>
            <View style={[styles.rankBar, { width: `${Math.max(2, (d.value / max) * 82)}%` }]} />
            <Text style={styles.rankValue}>{format(d.value)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** One ratio per row against its own whole (e.g. sold / total per block). */
export function MeterList({ data }: { data: { label: string; value: number; total: number; text: string }[] }) {
  return (
    <View style={{ gap: 10 }}>
      {data.map((d) => (
        <View key={d.label}>
          <View style={styles.meterHead}>
            <Text style={styles.rankLabel}>{d.label}</Text>
            <Text style={styles.meterText}>{d.text}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${d.total ? (d.value / d.total) * 100 : 0}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  tileLabel: { fontSize: 13, color: C.muted, marginBottom: 4 },
  tileValue: { fontSize: 24, fontWeight: '700', color: C.text },
  tileSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  segBar: { flexDirection: 'row', height: 28, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  seg: { justifyContent: 'center', paddingLeft: 6, borderRadius: 4 },
  segText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { flex: 1, fontSize: 14, color: C.text },
  legendValue: { fontSize: 14, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  legendExtra: { fontWeight: '400', color: C.muted },
  cols: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  colSlot: { flex: 1, height: '100%' },
  col: { width: '70%', maxWidth: 24, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colValue: { fontSize: 11, fontWeight: '700', color: C.text, marginBottom: 2 },
  colLabel: { fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 4, height: 14 },
  baseline: { height: 1, backgroundColor: C.border, marginTop: -18 },
  rankLabel: { fontSize: 13.5, color: C.text, marginBottom: 3 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rankBar: { height: 14, backgroundColor: ACCENT, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  rankValue: { fontSize: 13, fontWeight: '600', color: C.text },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between' },
  meterText: { fontSize: 13, color: C.muted },
  track: { height: 8, borderRadius: 4, backgroundColor: TRACK, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: ACCENT },
});
