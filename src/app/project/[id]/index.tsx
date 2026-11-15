import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { PlotMap, type MapOverlay } from '@/components/PlotMap';
import { PlotSheet } from '@/components/PlotSheet';
import { Banner, Button, H, IconButton, Loading, Muted, PromptModal, Row, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { boundsOf, dist, pointInPolygon, polygonArea } from '@/lib/geometry';
import { deleteCorner, insertCorner, isSimplePolygon, mergePlots, moveCorner, snapPoint, splitNames, splitPlot } from '@/lib/shapes';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/status';
import type { Plot, PlotStatus, Pt } from '@/lib/types';
import { C } from '@/theme';

type Mode = 'view' | 'edit' | 'add' | 'corners' | 'split' | 'merge';

const HINTS: Record<Mode, string> = {
  view: '',
  edit: 'Tap a plot to change its shape, or add a new plot.',
  add: 'Tap the corners of the new plot one by one. Points snap to nearby corners.',
  corners: 'Tap a blue corner, then tap where it should go. Tap a white dot to add a corner.',
  split: 'Tap two points to draw the cut line across the plot.',
  merge: 'Tap the neighbouring plot to merge with.',
};

export default function ProjectMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, userName, toast, forgetProject, rememberProject } = useApp();
  const data = useProject(id);
  const { project, plots, layout, isAdmin, canEditStatus } = data;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlotStatus | null>(null);
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<{ bounds: ReturnType<typeof boundsOf>; key: number } | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [cut, setCut] = useState<Pt[]>([]);
  const [prompt, setPrompt] = useState<null | { title: string; message?: string; initial?: string; onSubmit: (v: string) => void }>(null);

  const selected = plots.find((p) => p.id === selectedId) ?? null;

  // keep the list of projects on this phone up to date (name/role)
  useEffect(() => {
    if (project && data.membership) {
      rememberProject({ id: project.id, name: project.name, role: data.membership.role, joinedAt: data.membership.joinedAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.name, data.membership?.role]);

  const counts = useMemo(() => {
    const c = { available: 0, booked: 0, sold: 0 };
    for (const p of plots) c[p.status]++;
    return c;
  }, [plots]);

  const plotAt = useCallback(
    (pt: Pt): Plot | null => {
      let best: Plot | null = null;
      let bestA = Infinity;
      for (const p of plots) {
        if (pointInPolygon(pt, p.polygon)) {
          const a = polygonArea(p.polygon);
          if (a < bestA) {
            bestA = a;
            best = p;
          }
        }
      }
      return best;
    },
    [plots],
  );

  const resetEdit = () => {
    setDraft([]);
    setCut([]);
    setActiveCorner(null);
  };

  const who = { name: userName };

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const savePolygon = (plot: Plot, polygon: Pt[], note: string) => {
    if (!isSimplePolygon(polygon)) {
      toast('That would make the plot boundary cross itself.');
      return;
    }
    run(() => backend.applyShapeEdit(id, { upserts: [{ ...plot, polygon }], deletes: [], note }, who));
  };

  const finishAdd = (pts: Pt[]) => {
    if (pts.length < 3) return;
    if (!isSimplePolygon(pts)) {
      toast('The boundary crosses itself. Undo a point and try again.');
      return;
    }
    setPrompt({
      title: 'New plot number',
      message: 'Enter the number for this plot.',
      onSubmit: (num) => {
        setPrompt(null);
        if (plots.some((p) => p.number === num)) toast(`Note: plot ${num} already exists.`);
        const plot: Plot = { id: backend.newId(), number: num, polygon: pts, status: 'available' };
        run(() => backend.applyShapeEdit(id, { upserts: [plot], deletes: [], note: `Added plot ${num}` }, who), `Plot ${num} added`);
        setDraft([]);
        setSelectedId(plot.id);
        setMode('edit');
      },
    });
  };

  const onTap = (pt: Pt, upp: number) => {
    const snapTol = 14 * upp;
    const others = (excludeId?: string) => plots.filter((p) => p.id !== excludeId).map((p) => p.polygon);
    switch (mode) {
      case 'view':
      case 'edit': {
        const hit = plotAt(pt);
        setSelectedId(hit?.id ?? null);
        return;
      }
      case 'add': {
        const p = snapPoint(pt, [...others(), draft], snapTol);
        if (draft.length >= 3 && dist(p, draft[0]) < snapTol) {
          finishAdd(draft);
          return;
        }
        setDraft([...draft, p]);
        return;
      }
      case 'corners': {
        if (!selected) return;
        const poly = selected.polygon;
        const hi = poly.findIndex((q) => dist(q, pt) < snapTol);
        if (hi >= 0 && hi !== activeCorner) {
          setActiveCorner(hi);
          return;
        }
        const mids = poly.map((q, i) => ({ x: (q.x + poly[(i + 1) % poly.length].x) / 2, y: (q.y + poly[(i + 1) % poly.length].y) / 2 }));
        const mi = mids.findIndex((q) => dist(q, pt) < snapTol);
        if (mi >= 0 && activeCorner == null) {
          savePolygon(selected, insertCorner(poly, mi), `Added a corner to plot ${selected.number}`);
          setActiveCorner(mi + 1);
          return;
        }
        if (activeCorner != null) {
          const to = snapPoint(pt, others(selected.id), snapTol);
          savePolygon(selected, moveCorner(poly, activeCorner, to), `Moved a corner of plot ${selected.number}`);
          setActiveCorner(null);
          return;
        }
        const hit = plotAt(pt);
        if (hit && hit.id !== selected.id) setSelectedId(hit.id);
        return;
      }
      case 'split': {
        if (!selected) return;
        const next = [...cut, snapPoint(pt, others(), snapTol)].slice(-2);
        setCut(next);
        if (next.length === 2) {
          try {
            const pieces = splitPlot(selected.polygon, next[0], next[1]);
            const taken = new Set(plots.map((p) => p.number));
            const names = splitNames(selected.number, pieces.length, taken);
            confirm('Split plot', `Split plot ${selected.number} into ${names.join(', ')}?`, 'Split').then((ok) => {
              setCut([]);
              if (!ok) return;
              const upserts: Plot[] = pieces.map((poly, i) =>
                i === 0 ? { ...selected, number: names[0], polygon: poly } : { id: backend.newId(), number: names[i], polygon: poly, status: selected.status },
              );
              run(() => backend.applyShapeEdit(id, { upserts, deletes: [], note: `Split ${selected.number} → ${names.join(', ')}` }, who), 'Plot split');
              setMode('edit');
            });
          } catch (e) {
            toast((e as Error).message);
            setCut([]);
          }
        }
        return;
      }
      case 'merge': {
        if (!selected) return;
        const other = plotAt(pt);
        if (!other || other.id === selected.id) return;
        try {
          const merged = mergePlots(selected.polygon, other.polygon);
          confirm('Merge plots', `Merge plot ${other.number} into plot ${selected.number}? Plot ${other.number} will be removed.`, 'Merge').then((ok) => {
            if (!ok) return;
            run(
              () => backend.applyShapeEdit(id, { upserts: [{ ...selected, polygon: merged }], deletes: [other.id], note: `Merged ${other.number} into ${selected.number}` }, who),
              'Plots merged',
            );
            setMode('edit');
          });
        } catch (e) {
          toast((e as Error).message);
        }
        return;
      }
    }
  };

  const setStatus = (s: PlotStatus) => {
    if (!selected || s === selected.status) return;
    run(() => backend.updatePlot(id, selected, { status: s }, who), `Plot ${selected.number} marked ${STATUS_LABEL[s]}`);
  };

  const doSearch = () => {
    const q = search.trim().toUpperCase().replace(/\s/g, '');
    if (!q) return;
    const hit = plots.find((p) => p.number.toUpperCase() === q) ?? plots.find((p) => p.number.toUpperCase().startsWith(q));
    if (!hit) {
      toast(`Plot ${search.trim()} not found`);
      return;
    }
    setSelectedId(hit.id);
    setFocus({ bounds: boundsOf(hit.polygon), key: Date.now() });
  };

  const overlay: MapOverlay = useMemo(() => {
    if (mode === 'add') return { draft };
    if (mode === 'corners' && selected) {
      const poly = selected.polygon;
      return {
        handles: poly,
        activeHandle: activeCorner,
        midHandles: activeCorner == null ? poly.map((q, i) => ({ x: (q.x + poly[(i + 1) % poly.length].x) / 2, y: (q.y + poly[(i + 1) % poly.length].y) / 2 })) : [],
      };
    }
    if (mode === 'split') return { line: cut };
    return {};
  }, [mode, draft, selected, activeCorner, cut]);

  if (data.loading) return <Loading text="Loading project…" />;

  if (data.noAccess || !project) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: C.bg }}>
        <Stack.Screen options={{ title: 'Project' }} />
        <H>No access</H>
        <Muted style={{ marginBottom: 16 }}>This project was deleted, or your access was removed by the admin. Ask the admin for a new code.</Muted>
        <Button
          title="Remove from this phone"
          variant="secondary"
          onPress={async () => {
            await forgetProject(id);
            router.replace('/');
          }}
        />
      </View>
    );
  }

  const editing = mode !== 'view';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.mapBg }} edges={['bottom', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: project.name,
          headerRight: () => (
            <Row style={{ gap: 2 }}>
              <IconButton icon="list-outline" label="All plots" onPress={() => router.push({ pathname: '/project/[id]/list', params: { id } })} testID="open-list" />
              <IconButton icon="settings-outline" label="Settings" onPress={() => router.push({ pathname: '/project/[id]/settings', params: { id } })} testID="open-settings" />
            </Row>
          ),
        }}
      />

      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={C.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={doSearch}
            placeholder="Find plot no."
            placeholderTextColor="#98A2B3"
            style={styles.searchInput}
            returnKeyType="search"
            autoCapitalize="characters"
            testID="search-input"
          />
        </View>
        <View style={styles.stats}>
          {(['available', 'booked', 'sold'] as PlotStatus[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => setFilter(filter === s ? null : s)}
              style={[styles.stat, filter === s && { backgroundColor: STATUS_COLOR[s] }]}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === s }}
              testID={`stat-${s}`}
            >
              <View style={[styles.dot, { backgroundColor: filter === s ? '#fff' : STATUS_COLOR[s] }]} />
              <Text style={[styles.statText, filter === s && { color: '#fff' }]}>
                {counts[s]} {STATUS_LABEL[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <PlotMap
          plots={plots}
          layout={layout}
          bounds={project.bounds}
          selectedIds={selectedId ? [selectedId] : []}
          highlightStatus={filter}
          overlay={overlay}
          onTap={onTap}
          focus={focus}
          testID="plot-map"
        />

        {editing ? (
          <View style={styles.editBar}>
            <Text style={styles.editHint}>{mode === 'edit' && selected ? `Plot ${selected.number} selected.` : HINTS[mode]}</Text>
            {mode === 'edit' ? (
              <View style={styles.editRow}>
                <Button small icon="add" title="Add plot" onPress={() => { resetEdit(); setSelectedId(null); setMode('add'); }} testID="tool-add" />
                {selected ? (
                  <>
                    <Button small variant="secondary" icon="git-commit-outline" title="Corners" onPress={() => { resetEdit(); setMode('corners'); }} />
                    <Button small variant="secondary" icon="cut-outline" title="Split" onPress={() => { resetEdit(); setMode('split'); }} />
                    <Button small variant="secondary" icon="git-merge-outline" title="Merge" onPress={() => { resetEdit(); setMode('merge'); }} />
                    <Button
                      small
                      variant="secondary"
                      icon="text-outline"
                      title="Rename"
                      onPress={() =>
                        setPrompt({
                          title: 'Rename plot',
                          initial: selected.number,
                          onSubmit: (num) => {
                            setPrompt(null);
                            if (num === selected.number) return;
                            if (plots.some((p) => p.number === num)) toast(`Note: plot ${num} already exists.`);
                            run(() => backend.updatePlot(id, selected, { number: num }, who), `Renamed to ${num}`);
                          },
                        })
                      }
                    />
                    <Button
                      small
                      variant="danger"
                      icon="trash-outline"
                      title="Delete"
                      onPress={async () => {
                        if (!(await confirm('Delete plot', `Delete plot ${selected.number}? This cannot be undone.`, 'Delete', true))) return;
                        const n = selected.number;
                        setSelectedId(null);
                        run(() => backend.applyShapeEdit(id, { upserts: [], deletes: [selected.id], note: `Deleted plot ${n}` }, who), `Plot ${n} deleted`);
                      }}
                    />
                  </>
                ) : null}
                <Button small variant="ghost" title="Done" onPress={() => { resetEdit(); setMode('view'); }} testID="tool-done" />
              </View>
            ) : (
              <View style={styles.editRow}>
                {mode === 'add' ? (
                  <>
                    <Button small variant="secondary" icon="arrow-undo-outline" title="Undo" disabled={!draft.length} onPress={() => setDraft(draft.slice(0, -1))} />
                    <Button small icon="checkmark" title="Finish plot" disabled={draft.length < 3} onPress={() => finishAdd(draft)} testID="tool-finish" />
                  </>
                ) : null}
                {mode === 'corners' && activeCorner != null && selected ? (
                  <Button
                    small
                    variant="danger"
                    icon="remove-circle-outline"
                    title="Delete corner"
                    onPress={() => {
                      try {
                        savePolygon(selected, deleteCorner(selected.polygon, activeCorner), `Removed a corner of plot ${selected.number}`);
                      } catch (e) {
                        toast((e as Error).message);
                      }
                      setActiveCorner(null);
                    }}
                  />
                ) : null}
                <Button small variant="ghost" title={mode === 'corners' ? 'Done' : 'Cancel'} onPress={() => { resetEdit(); setMode('edit'); }} />
              </View>
            )}
          </View>
        ) : selected ? (
          <PlotSheet plot={selected} project={project} canEditStatus={canEditStatus} onStatus={setStatus} onClose={() => setSelectedId(null)} />
        ) : isAdmin ? (
          <View style={styles.fabWrap} pointerEvents="box-none">
            <Button small variant="secondary" icon="shapes-outline" title="Edit shapes" onPress={() => setMode('edit')} testID="edit-shapes" />
          </View>
        ) : null}
      </View>

      {data.error ? (
        <View style={{ position: 'absolute', top: 110, left: 12, right: 12 }}>
          <Banner tone="danger" text={data.error} />
        </View>
      ) : null}

      <PromptModal
        visible={!!prompt}
        title={prompt?.title ?? ''}
        message={prompt?.message}
        initial={prompt?.initial}
        onSubmit={(v) => prompt?.onSubmit(v)}
        onCancel={() => setPrompt(null)}
        placeholder="e.g. 45 or A-12"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { backgroundColor: '#fff', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F4F7', borderRadius: 10, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 16, color: C.text },
  stats: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, borderRadius: 8, backgroundColor: '#F2F4F7' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statText: { fontSize: 13, fontWeight: '700', color: C.text },
  editBar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  editHint: { fontSize: 13.5, color: C.muted, marginBottom: 8 },
  editRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fabWrap: { position: 'absolute', left: 12, bottom: 12 },
});
