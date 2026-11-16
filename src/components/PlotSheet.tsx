import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { StatusPicker } from '@/components/StatusPicker';
import { Badge, Button, IconButton, InfoRow } from '@/components/ui';
import { applicablePremiums, plotPrice } from '@/lib/pricing';
import { STATUS_COLOR, statusLabel } from '@/lib/status';
import type { Plot, PlotStatus, Project } from '@/lib/types';
import { fmtArea, fmtDimensions, fmtMoney } from '@/lib/units';
import { C } from '@/theme';

export function PlotSheet({
  plot,
  project,
  canEditStatus,
  onStatus,
  onClose,
  excludeStatuses = [],
  isAdmin = false,
  uid,
  onDecide,
  onCancelRequest,
  onShare,
  onDirections,
}: {
  plot: Plot;
  project: Project;
  canEditStatus: boolean;
  onStatus: (s: PlotStatus) => void;
  onClose: () => void;
  excludeStatuses?: PlotStatus[];
  isAdmin?: boolean;
  uid?: string | null;
  onDecide?: (approve: boolean) => void;
  onCancelRequest?: () => void;
  onShare?: () => void;
  onDirections?: () => void;
}) {
  const price = plotPrice(plot, project);
  const premiums = applicablePremiums(plot, project);
  return (
    <View style={styles.sheet} testID="plot-sheet">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{plot.block ? `PLOT · ${plot.block.toUpperCase()}` : 'PLOT'}</Text>
          <Text style={styles.number} testID="sheet-plot-number">
            {plot.number}
          </Text>
        </View>
        <Badge text={statusLabel(project, plot.status)} color={STATUS_COLOR[plot.status]} />
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>
      {plot.pending ? (
        <View style={styles.pending} testID="pending-box">
          <Text style={styles.pendingText}>
            ⏳ Waiting for approval: {statusLabel(project, plot.pending.status)} (asked by {plot.pending.byName})
          </Text>
          {isAdmin && onDecide ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button small title="Approve" icon="checkmark" onPress={() => onDecide(true)} testID="approve" />
              <Button small variant="secondary" title="Reject" icon="close" onPress={() => onDecide(false)} testID="reject" />
            </View>
          ) : plot.pending.by === uid && onCancelRequest ? (
            <Button small variant="ghost" title="Cancel my request" onPress={onCancelRequest} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
          ) : null}
        </View>
      ) : null}
      {canEditStatus ? <StatusPicker project={project} value={plot.status} onChange={onStatus} exclude={excludeStatuses} /> : null}
      <InfoRow label="Area" value={fmtArea(plot, project)} />
      <InfoRow label="Size" value={fmtDimensions(plot, project)} />
      {plot.facing || plot.isCorner ? <InfoRow label="Facing" value={`${plot.facing || ''}${plot.isCorner ? (plot.facing ? ' · ' : '') + 'Corner plot' : ''}`} /> : null}
      {price ? <InfoRow label="Price" value={fmtMoney(price, project.currency)} /> : null}
      {premiums.length ? <InfoRow label="Premiums" value={premiums.map((x) => x.name).join(', ')} /> : null}
      {plot.buyerName || plot.buyerPhone ? <InfoRow label="Buyer" value={[plot.buyerName, plot.buyerPhone].filter(Boolean).join(' · ')} /> : null}
      {plot.updatedByName ? (
        <Text style={styles.updated}>
          Last change by {plot.updatedByName}
          {plot.updatedAt ? ' · ' + new Date(plot.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Button
          title="Details & buyer info"
          icon="create-outline"
          variant="secondary"
          small
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/project/[id]/plot/[plotId]', params: { id: project.id, plotId: plot.id } })}
          testID="open-details"
        />
        {onDirections ? <Button title="Go" icon="navigate-outline" variant="secondary" small onPress={onDirections} testID="directions" /> : null}
        {onShare ? <Button title="Share" icon="share-social-outline" variant="secondary" small onPress={onShare} testID="share-plot" /> : null}
      </View>
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
  pending: { backgroundColor: '#FFF4E5', borderRadius: 10, padding: 10, marginBottom: 10 },
  pendingText: { color: '#9A5B00', fontSize: 14, fontWeight: '600' },
});
