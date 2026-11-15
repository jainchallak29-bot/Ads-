import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, IconButton, InfoRow, Segmented } from '@/components/ui';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status';
import type { Plot, PlotStatus, Project } from '@/lib/types';
import { fmtArea, fmtDimensions, fmtMoney, plotPrice } from '@/lib/units';
import { C } from '@/theme';

export function PlotSheet({
  plot,
  project,
  canEditStatus,
  onStatus,
  onClose,
}: {
  plot: Plot;
  project: Project;
  canEditStatus: boolean;
  onStatus: (s: PlotStatus) => void;
  onClose: () => void;
}) {
  const price = plotPrice(plot, project);
  return (
    <View style={styles.sheet} testID="plot-sheet">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>PLOT</Text>
          <Text style={styles.number} testID="sheet-plot-number">
            {plot.number}
          </Text>
        </View>
        <Badge text={STATUS_LABEL[plot.status]} color={STATUS_COLOR[plot.status]} />
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      {canEditStatus ? (
        <Segmented
          value={plot.status}
          onChange={onStatus}
          options={(['available', 'booked', 'sold'] as PlotStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] }))}
        />
      ) : null}
      <InfoRow label="Area" value={fmtArea(plot, project)} />
      <InfoRow label="Size" value={fmtDimensions(plot, project)} />
      {plot.facing || plot.isCorner ? <InfoRow label="Facing" value={`${plot.facing || ''}${plot.isCorner ? (plot.facing ? ' · ' : '') + 'Corner plot' : ''}`} /> : null}
      {price ? <InfoRow label="Price" value={fmtMoney(price, project.currency)} /> : null}
      {plot.buyerName || plot.buyerPhone ? <InfoRow label="Buyer" value={[plot.buyerName, plot.buyerPhone].filter(Boolean).join(' · ')} /> : null}
      {plot.updatedByName ? (
        <Text style={styles.updated}>
          Last change by {plot.updatedByName}
          {plot.updatedAt ? ' · ' + new Date(plot.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}
        </Text>
      ) : null}
      <Button
        title="Details & buyer info"
        icon="create-outline"
        variant="secondary"
        small
        style={{ marginTop: 10 }}
        onPress={() => router.push({ pathname: '/project/[id]/plot/[plotId]', params: { id: project.id, plotId: plot.id } })}
        testID="open-details"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    paddingTop: 10,
    maxWidth: 560,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 1 },
  number: { fontSize: 28, fontWeight: '800', color: C.text, marginTop: -2 },
  updated: { fontSize: 12, color: C.muted, marginTop: 8 },
});
