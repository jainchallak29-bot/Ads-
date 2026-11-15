import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { PlotMap } from '@/components/PlotMap';
import { Banner, Button, Card, Field, H, Muted, Screen, Segmented, Toggle, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { buildLayout, type BuiltLayout } from '@/lib/cad/buildLayout';
import { detectPlots, suggestLayers, type DetectResult } from '@/lib/cad/detect';
import { readDxf, type CadData } from '@/lib/cad/dxfRead';
import { pickDxf } from '@/lib/files';
import { polygonArea } from '@/lib/geometry';
import type { AreaUnit, DrawingUnit, LengthUnit, Plot } from '@/lib/types';
import { AREA_UNIT_LABEL, DRAWING_UNIT_M, fmtNum, guessDrawingUnit, sqmTo } from '@/lib/units';
import { C } from '@/theme';

const DRAWING_UNITS: { value: DrawingUnit; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
  { value: 'in', label: 'inch' },
  { value: 'ft', label: 'feet' },
];

function medianPlotArea(r: DetectResult | null): number {
  if (!r?.plots.length) return 0;
  const a = r.plots.map((p) => polygonArea(p.polygon)).sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

/** Use the unit in the file only if it gives believable plot sizes (many templates say "mm" by default). */
function pickUnit(fileUnit: DrawingUnit | null, medArea: number): DrawingUnit {
  if (!medArea) return fileUnit ?? 'ft';
  if (fileUnit) {
    const f = DRAWING_UNIT_M[fileUnit];
    const sqm = medArea * f * f;
    if (sqm >= 15 && sqm <= 20000) return fileUnit;
  }
  return guessDrawingUnit(Math.sqrt(medArea));
}

function LayerList({ title, hint, layers, selected, onToggle, count }: { title: string; hint: string; layers: string[]; selected: string[]; onToggle: (l: string) => void; count: (l: string) => string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.subTitle}>{title}</Text>
      <Muted style={{ fontSize: 12.5, marginBottom: 6 }}>{hint}</Muted>
      <View style={styles.chips}>
        {layers.map((l) => {
          const on = selected.includes(l);
          return (
            <Pressable key={l} onPress={() => onToggle(l)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={16} color={on ? '#fff' : C.muted} />
              <Text style={[styles.chipText, on && { color: '#fff' }]} numberOfLines={1}>
                {l} <Text style={{ opacity: 0.7, fontWeight: '400' }}>({count(l)})</Text>
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ImportScreen() {
  const { pid } = useLocalSearchParams<{ pid?: string }>();
  const reimport = !!pid;
  const { backend, userName, rememberProject, toast } = useApp();
  const existing = useProject(pid);

  const [fileName, setFileName] = useState<string | null>(null);
  const [cad, setCad] = useState<CadData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boundaryLayers, setBoundaryLayers] = useState<string[]>([]);
  const [numberLayers, setNumberLayers] = useState<string[]>([]);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [built, setBuilt] = useState<BuiltLayout | null>(null);
  const [unit, setUnit] = useState<DrawingUnit>('ft');
  const [showLayers, setShowLayers] = useState(false);
  const [includeTexts, setIncludeTexts] = useState(true);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('sqyd');
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('ft');
  const [currency, setCurrency] = useState('₹');
  const [salesCanEdit, setSalesCanEdit] = useState(true);
  const [saving, setSaving] = useState(false);

  const choose = async () => {
    setError(null);
    try {
      const f = await pickDxf();
      if (!f) return;
      setBusy('Reading drawing…');
      setFileName(f.name);
      if (!name && !reimport) setName(f.name.replace(/\.dxf$/i, '').replace(/[_-]+/g, ' '));
      await new Promise((r) => setTimeout(r, 60)); // let the spinner render
      const data = readDxf(f.text);
      const sug = suggestLayers(data);
      setCad(data);
      setBoundaryLayers(sug.boundaryLayers);
      setNumberLayers(sug.numberLayers);
      detect(data, sug.boundaryLayers, sug.numberLayers, includeTexts, true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  // detect plots for the current drawing + layer choice (called from the handlers)
  const detect = (data: CadData, bl: string[], nl: string[], texts: boolean, first: boolean) => {
    setBusy('Finding plots…');
    setTimeout(() => {
      try {
        const r = detectPlots(data, { boundaryLayers: bl, numberLayers: nl });
        const b = buildLayout(data, r.plots, { includeTexts: texts });
        setResult(r);
        setBuilt(b);
        if (first) {
          const u = pickUnit(data.drawingUnit, medianPlotArea(r));
          setUnit(u);
          if (!reimport) setLengthUnit(u === 'm' || u === 'mm' || u === 'cm' ? 'm' : 'ft');
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    }, 60);
  };

  const previewPlots: Plot[] = useMemo(
    () => (built?.plots || []).map((p, i) => ({ id: 'n' + i, number: p.number, polygon: p.polygon, status: 'available' as const })),
    [built],
  );
  const markers = useMemo(() => {
    if (!result || !built) return [];
    return result.unmatched.map((u) => ({ x: u.x - built.origin.x, y: built.origin.y - u.y }));
  }, [result, built]);

  const med = medianPlotArea(result);
  const typicalSqm = med * DRAWING_UNIT_M[unit] ** 2;

  // re-import: match by plot number to keep status & details
  const matchInfo = useMemo(() => {
    if (!reimport || !built) return null;
    const byNum = new Map(existing.plots.map((p) => [p.number, p]));
    const newNums = new Set(built.plots.map((p) => p.number));
    const kept = built.plots.filter((p) => byNum.has(p.number)).length;
    const removed = existing.plots.filter((p) => !newNums.has(p.number));
    return { kept, added: built.plots.length - kept, removed, removedSold: removed.filter((p) => p.status !== 'available') };
  }, [reimport, built, existing.plots]);

  const create = async () => {
    if (!built) return;
    setSaving(true);
    try {
      const plots: Plot[] = built.plots.map((p) => ({ id: backend.newId(), number: p.number, polygon: p.polygon, status: 'available' }));
      const r = await backend.createProject(
        { name: name.trim(), location: location.trim(), drawingUnit: unit, areaUnit, lengthUnit, currency: currency.trim() || '₹', salesCanEdit, bounds: built.bounds, origin: built.origin },
        built.layout,
        plots,
        { name: userName },
      );
      await rememberProject({ id: r.projectId, name: name.trim(), role: 'admin', joinedAt: Date.now() });
      toast('Project created. Share the codes from Settings ⚙︎');
      router.replace({ pathname: '/project/[id]', params: { id: r.projectId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const replace = async () => {
    if (!built || !pid || !matchInfo) return;
    if (matchInfo.removedSold.length) {
      const ok = await confirm(
        'Booked/sold plots will be removed',
        `These booked or sold plots are not in the new drawing: ${matchInfo.removedSold.map((p) => p.number).join(', ')}. Continue anyway?`,
        'Replace',
        true,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const byNum = new Map(existing.plots.map((p) => [p.number, p]));
      const used = new Set<string>();
      const upserts: Plot[] = built.plots.map((p) => {
        const old = byNum.get(p.number);
        if (old && !used.has(old.id)) {
          used.add(old.id);
          return { ...old, polygon: p.polygon, areaOverrideSqm: old.areaOverrideSqm ?? null };
        }
        return { id: backend.newId(), number: p.number, polygon: p.polygon, status: 'available' };
      });
      const deletes = existing.plots.filter((p) => !used.has(p.id)).map((p) => p.id);
      await backend.replaceLayout(pid, { bounds: built.bounds, origin: built.origin, drawingUnit: unit, layout: built.layout, upserts, deletes }, { name: userName });
      toast('Layout updated on all phones');
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleBoundary = (l: string) => {
    const next = boundaryLayers.includes(l) ? boundaryLayers.filter((x) => x !== l) : [...boundaryLayers, l];
    setBoundaryLayers(next);
    if (cad) detect(cad, next, numberLayers, includeTexts, false);
  };
  const toggleNumbers = (l: string) => {
    const next = numberLayers.includes(l) ? numberLayers.filter((x) => x !== l) : [...numberLayers, l];
    setNumberLayers(next);
    if (cad) detect(cad, boundaryLayers, next, includeTexts, false);
  };
  const toggleTexts = (v: boolean) => {
    setIncludeTexts(v);
    if (cad) detect(cad, boundaryLayers, numberLayers, v, false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: reimport ? 'Update layout (DXF)' : 'New project' }} />

      <Card>
        <H>{reimport ? '1. Choose the updated DXF' : '1. Choose your layout file'}</H>
        <Muted style={{ marginBottom: 12 }}>
          Export the layout from AutoCAD / BricsCAD / ZWCAD with <Text style={{ fontWeight: '700' }}>File → Save As → DXF</Text>, send it to this phone (WhatsApp, email, Drive) and pick it here. The app finds each plot from its boundary lines and plot number.
        </Muted>
        <Button title={fileName ? 'Choose a different file' : 'Choose DXF file'} icon="document-outline" variant={fileName ? 'secondary' : 'primary'} onPress={choose} testID="pick-dxf" />
        {fileName ? <Muted style={{ marginTop: 8 }}>📄 {fileName}</Muted> : null}
      </Card>

      {error ? <Banner tone="danger" text={error} /> : null}
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={C.primary} />
          <Muted>{busy}</Muted>
        </View>
      ) : null}

      {cad && result && built ? (
        <>
          <Card>
            <H>2. Check the plots</H>
            <Text style={styles.found} testID="found-count">
              Found <Text style={{ color: C.primary }}>{result.plots.length}</Text> plots
            </Text>
            {result.unmatched.length ? (
              <Banner
                tone="warn"
                text={`${result.unmatched.length} plot numbers have no closed boundary (red dots): ${result.unmatched
                  .slice(0, 12)
                  .map((u) => u.number)
                  .join(', ')}${result.unmatched.length > 12 ? '…' : ''}. Try other layers below, or add them later with "Edit shapes → Add plot".`}
              />
            ) : null}
            {result.duplicates.length ? <Banner tone="warn" text={`Duplicate plot numbers: ${result.duplicates.join(', ')}. You can rename them later.`} /> : null}
            <View style={styles.preview}>
              <PlotMap plots={previewPlots} layout={built.layout} bounds={built.bounds} neutral overlay={{ markers }} />
            </View>
            <Pressable onPress={() => setShowLayers(!showLayers)} style={styles.disclosure}>
              <Ionicons name={showLayers ? 'chevron-down' : 'chevron-forward'} size={18} color={C.primary} />
              <Text style={{ color: C.primary, fontWeight: '600' }}>Layers ({cad.layers.length}) — change if plots are missing</Text>
            </Pressable>
            {showLayers ? (
              <View style={{ marginTop: 10 }}>
                <LayerList
                  title="Plot boundary lines"
                  hint="Layers whose lines form the plot boundaries."
                  layers={cad.layers.filter((l) => l.lineCount > 0).map((l) => l.name)}
                  selected={boundaryLayers}
                  onToggle={toggleBoundary}
                  count={(l) => `${cad.layers.find((x) => x.name === l)?.lineCount ?? 0} lines`}
                />
                <LayerList
                  title="Plot numbers"
                  hint="Layers with the plot number texts."
                  layers={cad.layers.filter((l) => l.textCount > 0).map((l) => l.name)}
                  selected={numberLayers}
                  onToggle={toggleNumbers}
                  count={(l) => `${cad.layers.find((x) => x.name === l)?.numberTextCount ?? 0} numbers`}
                />
                <Toggle label="Show other texts from the drawing" hint="Road names, park, etc." value={includeTexts} onChange={toggleTexts} />
              </View>
            ) : null}
          </Card>

          <Card>
            <H>3. Drawing units</H>
            <Muted style={{ marginBottom: 10 }}>Which unit was the drawing made in? Check that the typical plot size below looks right.</Muted>
            <Segmented value={unit} options={DRAWING_UNITS} onChange={setUnit} />
            {med > 0 ? (
              <Banner
                text={`Typical plot ≈ ${fmtNum(sqmTo(typicalSqm, 'sqft'), 0)} sq.ft = ${fmtNum(sqmTo(typicalSqm, 'sqyd'), 0)} sq.yd = ${fmtNum(typicalSqm, 0)} sq.m`}
              />
            ) : null}
          </Card>

          {reimport ? (
            <Card>
              <H>4. Replace the layout</H>
              {matchInfo ? (
                <Muted style={{ marginBottom: 12 }}>
                  {matchInfo.kept} plots matched by number keep their status and details. {matchInfo.added} new plots will be added as Available.
                  {matchInfo.removed.length ? ` ${matchInfo.removed.length} plots not in the new drawing will be removed (${matchInfo.removed.map((p) => p.number).slice(0, 15).join(', ')}).` : ''}
                </Muted>
              ) : null}
              <Button title="Replace layout on all phones" icon="cloud-upload-outline" onPress={replace} loading={saving} disabled={!result.plots.length || !existing.isAdmin} />
            </Card>
          ) : (
            <Card>
              <H>4. Project details</H>
              <Field label="Project name" value={name} onChangeText={setName} placeholder="e.g. Green Valley Phase 1" testID="project-name" />
              <Field label="Location (optional)" value={location} onChangeText={setLocation} placeholder="e.g. Ajmer Road, Jaipur" />
              <Segmented
                label="Show plot area in"
                value={areaUnit}
                onChange={setAreaUnit}
                options={(['sqyd', 'sqft', 'sqm'] as AreaUnit[]).map((u) => ({ value: u, label: AREA_UNIT_LABEL[u] }))}
              />
              <Segmented
                label="Show plot sides in"
                value={lengthUnit}
                onChange={setLengthUnit}
                options={[
                  { value: 'ft', label: 'Feet' },
                  { value: 'm', label: 'Metres' },
                ]}
              />
              <Field label="Currency symbol" value={currency} onChangeText={setCurrency} style={{ width: 90 }} />
              <Toggle
                label="Sales team can mark plots booked / sold"
                hint="If off, people with the Sales code can only view. You can change this later."
                value={salesCanEdit}
                onChange={setSalesCanEdit}
              />
              <Button title="Create project" icon="checkmark-circle-outline" style={{ marginTop: 12 }} onPress={create} loading={saving} disabled={!name.trim() || !result.plots.length} testID="create-project" />
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  busy: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', padding: 12 },
  found: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 10 },
  preview: { height: 340, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  subTitle: { fontWeight: '700', fontSize: 15, color: C.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', maxWidth: '100%' },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: C.text, flexShrink: 1 },
});
