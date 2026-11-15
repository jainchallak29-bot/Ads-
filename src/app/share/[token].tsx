import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { PlotMap } from '@/components/PlotMap';
import { Badge, Button, IconButton, InfoRow, Loading, Muted } from '@/components/ui';
import { boundsOf, pointInPolygon, polygonArea } from '@/lib/geometry';
import type { PublicDoc } from '@/lib/publicLayout';
import { unflatten } from '@/lib/backend/serialize';
import { STATUS_COLOR } from '@/lib/status';
import type { LayoutData, Plot, Pt } from '@/lib/types';
import { AREA_UNIT_SHORT, fmtDimensions, fmtMoney, fmtNum, sqmTo } from '@/lib/units';
import { C } from '@/theme';

/** Public page for customers: available plots, sizes and (optionally) prices. */
export default function CustomerPage() {
  const { token, plot: plotParam } = useLocalSearchParams<{ token: string; plot?: string }>();
  const { backend } = useApp();
  const [doc, setDoc] = useState<PublicDoc | null | undefined>(undefined);
  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ bounds: ReturnType<typeof boundsOf>; key: number } | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  useEffect(() => {
    if (!token) return;
    const a = backend.watchPublic(token, setDoc, () => setDoc(null));
    const b = backend.watchPublicLayout(token, setLayout, () => undefined);
    return () => {
      a();
      b();
    };
  }, [backend, token]);

  // plots in the shape the map understands; "not available" is drawn grey
  const plots: (Plot & { areaSqm: number; price?: number | null })[] = useMemo(() => {
    if (!doc) return [];
    return Object.entries(doc.plots || {}).map(([id, p]) => ({
      id,
      number: p.n,
      polygon: unflatten(p.pts),
      status: (doc.st?.[id] ?? 'a') === 'a' ? 'available' : 'blocked',
      block: p.b,
      facing: p.f,
      isCorner: p.c,
      areaSqm: p.a,
      price: p.p ?? null,
    }));
  }, [doc]);

  // open a plot from the link (?plot=12)
  const [opened, setOpened] = useState(false);
  if (!opened && plotParam && plots.length) {
    setOpened(true);
    const hit = plots.find((p) => p.number.toUpperCase() === String(plotParam).toUpperCase());
    if (hit) {
      setSelectedId(hit.id);
      setFocus({ bounds: boundsOf(hit.polygon), key: 1 });
    }
  }

  if (doc === undefined) return <Loading text="Loading layout…" />;
  if (doc === null) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Layout', headerBackVisible: false }} />
        <Text style={styles.big}>This link is not active</Text>
        <Muted>Please ask the developer for a new link.</Muted>
      </View>
    );
  }

  const available = plots.filter((p) => p.status === 'available');
  const sel = plots.find((p) => p.id === selectedId) || null;
  const au = AREA_UNIT_SHORT[doc.areaUnit];
  const unitsProject = { drawingUnit: doc.drawingUnit, lengthUnit: doc.lengthUnit };
  const phone = doc.company?.phone || '';
  const contactMsg = (n: string) => `Hello, I am interested in plot ${n} at ${doc.name}. Please share details.`;
  const faded = onlyAvailable ? new Set(plots.filter((p) => p.status !== 'available').map((p) => p.id)) : null;

  const onTap = (pt: Pt) => {
    let best: string | null = null;
    let bestA = Infinity;
    for (const p of plots) {
      if (pointInPolygon(pt, p.polygon)) {
        const a = polygonArea(p.polygon);
        if (a < bestA) {
          bestA = a;
          best = p.id;
        }
      }
    }
    setSelectedId(best);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.mapBg }} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: doc.name, headerBackVisible: false }} />
      <View style={styles.top}>
        {doc.company?.name ? <Text style={styles.company}>{doc.company.name}</Text> : null}
        {doc.location ? <Muted style={{ fontSize: 13 }}>{doc.location}</Muted> : null}
        <View style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR.available }]} />
          <Text style={styles.legendText} testID="share-available">
            {available.length} available
          </Text>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR.blocked }]} />
          <Text style={styles.legendText}>{plots.length - available.length} not available</Text>
          <View style={{ flex: 1 }} />
          <Button small variant={onlyAvailable ? 'primary' : 'secondary'} title="Only available" onPress={() => setOnlyAvailable(!onlyAvailable)} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <PlotMap plots={plots} layout={layout} bounds={doc.bounds} selectedIds={selectedId ? [selectedId] : []} fadedIds={faded} onTap={onTap} focus={focus} testID="share-map" />
        {sel ? (
          <View style={styles.sheet} testID="share-sheet">
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{sel.block ? `PLOT · BLOCK ${sel.block.toUpperCase()}` : 'PLOT'}</Text>
                <Text style={styles.num}>{sel.number}</Text>
              </View>
              <Badge text={sel.status === 'available' ? 'Available' : 'Not available'} color={STATUS_COLOR[sel.status]} />
              <IconButton icon="close" label="Close" onPress={() => setSelectedId(null)} />
            </View>
            <InfoRow label="Area" value={`${fmtNum(sqmTo(sel.areaSqm, doc.areaUnit))} ${au}`} />
            <InfoRow label="Size" value={fmtDimensions(sel, unitsProject)} />
            {sel.facing || sel.isCorner ? <InfoRow label="Facing" value={[sel.facing, sel.isCorner ? 'Corner plot' : ''].filter(Boolean).join(' · ')} /> : null}
            {doc.showPrices && sel.price && sel.status === 'available' ? <InfoRow label="Price" value={fmtMoney(sel.price, doc.currency)} /> : null}
            {phone && sel.status === 'available' ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button small icon="call-outline" title="Call" onPress={() => Linking.openURL(`tel:${phone}`)} style={{ flex: 1 }} />
                <Button
                  small
                  variant="secondary"
                  icon="logo-whatsapp"
                  title="WhatsApp"
                  style={{ flex: 1 }}
                  onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(contactMsg(sel.number))}`)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  big: { fontSize: 20, fontWeight: '800', color: C.text },
  top: { backgroundColor: '#fff', padding: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  company: { fontSize: 15, fontWeight: '700', color: C.text },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 13.5, fontWeight: '600', color: C.text, marginRight: 8 },
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 1 },
  num: { fontSize: 28, fontWeight: '800', color: C.text },
});
