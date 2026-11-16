import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { PlotMap } from '@/components/PlotMap';
import { Banner, Button, Field, Loading, Muted, Row, confirm } from '@/components/ui';
import { currentPosition } from '@/hooks/useMyLocation';
import { useProject } from '@/hooks/useProject';
import { makeGeo, parseLatLng, type GeoPoint } from '@/lib/geo';
import { snapPoint } from '@/lib/shapes';
import type { Pt } from '@/lib/types';
import { fmtNum } from '@/lib/units';
import { C } from '@/theme';

type Partial2 = [Partial<GeoPoint>, Partial<GeoPoint>];

/** Admin: tie the drawing to GPS with two points (stand there, or paste coordinates from Google Maps). */
export default function GpsSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, toast } = useApp();
  const { project, plots, layout, loading, isAdmin } = useProject(id);
  const [draft, setDraft] = useState<Partial2 | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading || !project) return <Loading />;
  if (!isAdmin) return <Banner text="Only admins can align the layout with GPS." />;
  const pts: Partial2 = draft ?? (project.geo ? [project.geo.points[0], project.geo.points[1]] : [{}, {}]);
  const cur = pts[step];
  const setPt = (i: 0 | 1, v: Partial<GeoPoint>) => {
    const next: Partial2 = [{ ...pts[0] }, { ...pts[1] }];
    next[i] = { ...next[i], ...v };
    setDraft(next);
  };
  const complete = (p: Partial<GeoPoint>): p is GeoPoint => p.x != null && p.y != null && p.lat != null && p.lng != null;
  const geo = complete(pts[0]) && complete(pts[1]) ? makeGeo({ points: [pts[0], pts[1]] }, project.drawingUnit) : null;
  const scaleOk = geo ? Math.abs(geo.scale - 1) <= 0.1 : false;

  const onTap = (pt: Pt, upp: number) => {
    const snapped = snapPoint(pt, plots.map((p) => p.polygon), 14 * upp);
    setPt(step, { x: snapped.x, y: snapped.y });
  };

  const hereNow = async () => {
    setBusy(true);
    try {
      const p = await currentPosition();
      setPt(step, { lat: p.lat, lng: p.lng });
      toast(`Location saved (±${Math.round(p.accuracy)} m)`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom', 'left', 'right']}>
      <View style={styles.mapBox}>
        <PlotMap
          plots={plots}
          layout={layout}
          bounds={project.bounds}
          neutral
          onTap={onTap}
          overlay={{ pins: pts.filter((p) => p.x != null).map((p) => ({ x: p.x!, y: p.y! })) }}
          testID="gps-map"
        />
      </View>
      <View style={styles.panel}>
        <Row style={{ marginBottom: 8 }}>
          <Button small variant={step === 0 ? 'primary' : 'secondary'} title={`Point 1 ${complete(pts[0]) ? '✓' : ''}`} onPress={() => setStep(0)} />
          <Button small variant={step === 1 ? 'primary' : 'secondary'} title={`Point 2 ${complete(pts[1]) ? '✓' : ''}`} onPress={() => setStep(1)} />
        </Row>
        <Muted style={{ fontSize: 13 }}>
          {cur.x == null
            ? `1) Tap a spot on the layout for point ${step + 1} — e.g. a plot corner or the main gate. Pick two points far apart.`
            : cur.lat == null
              ? '2) Stand exactly at that spot and tap “I am here”, or paste its coordinates from Google Maps (long-press the spot → copy).'
              : `Point ${step + 1} is set (${cur.lat.toFixed(6)}, ${cur.lng!.toFixed(6)}). Tap the map to move it.`}
        </Muted>
        {cur.x != null ? (
          <>
            <Row style={{ marginTop: 8 }}>
              <Button small icon="locate-outline" title="I am here now" loading={busy} onPress={hereNow} />
            </Row>
            <Row style={{ marginTop: 6, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label="Or paste coordinates" value={typed} onChangeText={setTyped} placeholder="26.912434, 75.787270" testID="gps-coords" />
              </View>
              <Button
                small
                variant="secondary"
                title="Use"
                style={{ marginBottom: 12 }}
                onPress={() => {
                  const ll = parseLatLng(typed);
                  if (!ll) return toast('Could not read the coordinates');
                  setPt(step, ll);
                  setTyped('');
                  if (step === 0 && !complete(pts[1])) setStep(1);
                }}
                testID="gps-use"
              />
            </Row>
          </>
        ) : null}
        {geo ? (
          <Banner
            tone={scaleOk ? 'info' : 'warn'}
            text={`Distance between the points: ${fmtNum(geo.drawingMetres, 0)} m on the drawing, ${fmtNum(geo.groundMetres, 0)} m on the ground.${scaleOk ? ' Looks right.' : ' These differ a lot — check the points or the drawing unit in Settings.'}`}
          />
        ) : null}
        <Row>
          <Button
            title="Save alignment"
            icon="checkmark"
            disabled={!geo}
            style={{ flex: 1 }}
            onPress={async () => {
              if (!geo || !complete(pts[0]) || !complete(pts[1])) return;
              if (!scaleOk && !(await confirm('Save anyway?', 'The distances do not match well, so "you are here" may be off.', 'Save'))) return;
              await backend.updateProject(id, { geo: { points: [pts[0], pts[1]] } });
              setDraft(null);
              toast('GPS alignment saved');
            }}
            testID="gps-save"
          />
          {project.geo ? (
            <Button
              title="Remove"
              variant="ghost"
              onPress={async () => {
                if (await confirm('Remove GPS alignment?', 'Directions and "you are here" will stop working.', 'Remove', true)) {
                  await backend.updateProject(id, { geo: null });
                  setDraft(null);
                }
              }}
            />
          ) : null}
        </Row>
        <Text style={styles.small}>Tip: points 100 m or more apart give the best result.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mapBox: { flex: 1, minHeight: 260 },
  panel: { backgroundColor: '#fff', padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  small: { fontSize: 12, color: C.muted, marginTop: 6 },
});
