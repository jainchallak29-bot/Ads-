import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/components/AppProvider';
import { BulkBar } from '@/components/BulkBar';
import { MapFilters } from '@/components/MapFilters';
import { PlotMap, type MapOverlay } from '@/components/PlotMap';
import { PlotSheet } from '@/components/PlotSheet';
import { ShareSheet } from '@/components/ShareSheet';
import { Banner, Button, H, IconButton, Loading, Muted, PromptModal, Row, confirm } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { usePublicSync } from '@/hooks/usePublicSync';
import { useTeamNotify } from '@/hooks/useTeamNotify';
import { boundsOf, dist, pointInPolygon, polygonArea } from '@/lib/geometry';
import { deleteCorner, insertCorner, isSimplePolygon, mergePlots, moveCorner, snapPoint, splitNames, splitPlot } from '@/lib/shapes';
import { comparePlotNumbers } from '@/lib/cad/detect';
import { features, statusLabel } from '@/lib/status';
import type { Plot, PlotPatch, PlotStatus, Pt } from '@/lib/types';
import { C } from '@/theme';

type Mode = 'view' | 'edit' | 'add' | 'corners' | 'split' | 'merge' | 'multi';

const HINTS: Record<Mode, string> = {
  view: '',
  edit: 'Tap a plot to change its shape, or add a new plot.',
  add: 'Tap the corners of the new plot one by one. Points snap to nearby corners.',
  corners: 'Tap a blue corner, then tap where it should go. Tap a white dot to add a corner.',
  split: 'Tap two points to draw the cut line across the plot.',
  merge: 'Tap the neighbouring plot to merge with.',
  multi: '',
};

export default function ProjectMap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { backend, userName, toast, forgetProject, rememberProject, uid } = useApp();
  const data = useProject(id);
  const { project, plots, layout, isAdmin, canEditStatus } = data;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlotStatus | null>(null);
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<{ bounds: ReturnType<typeof boundsOf>; key: number } | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [cut, setCut] = useState<Pt[]>([]);
  const [prompt, setPrompt] = useState<null | { title: string; message?: string; initial?: string; onSubmit: (v: string) => void }>(null);

  const selected = plots.find((p) => p.id === selectedId) ?? null;
  const [shareWhat, setShareWhat] = useState<null | 'layout' | 'plot'>(null);
  usePublicSync(project, plots, layout, isAdmin, canEditStatus);
  const notify = useTeamNotify(project, data.membership);

  // keep the list of projects on this phone up to date (name/role)
  useEffect(() => {
    if (project && data.membership) {
      rememberProject({ id: project.id, name: project.name, role: data.membership.role, joinedAt: data.membership.joinedAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.name, data.membership?.role]);

  const blocks = useMemo(
    () => (features(project).blocks ? [...new Set(plots.map((p) => p.block).filter((b): b is string => !!b))].sort(comparePlotNumbers) : []),
    [plots, project],
  );
  const matches = useCallback((p: Plot) => (!filter || p.status === filter) && (!blockFilter || p.block === blockFilter), [filter, blockFilter]);
  const fadedIds = useMemo(() => (filter || blockFilter ? new Set(plots.filter((p) => !matches(p)).map((p) => p.id)) : null), [plots, filter, blockFilter, matches]);

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
      case 'multi': {
        const hit = plotAt(pt);
        if (hit) setMultiIds((ids) => (ids.includes(hit.id) ? ids.filter((x) => x !== hit.id) : [...ids, hit.id]));
        return;
      }
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

  const needsApproval = !isAdmin && features(project).approval;
  const pendingIds = useMemo(() => new Set(plots.filter((p) => p.pending).map((p) => p.id)), [plots]);

  const setStatus = (s: PlotStatus) => {
    if (!selected || s === selected.status) return;
    if (needsApproval) {
      if (selected.pending && selected.pending.by !== uid) return toast(`${selected.pending.byName} already asked to change this plot.`);
      run(async () => {
        await backend.requestStatus(id, selected, s, who);
        notify('admins', `Approval needed · Plot ${selected.number}`, `${userName} asks: ${statusLabel(project, s)} (${project!.name})`);
      }, `Request sent: plot ${selected.number} → ${statusLabel(project, s)}`);
      return;
    }
    run(async () => {
      await backend.updatePlot(id, selected, { status: s }, who);
      notify('all', `Plot ${selected.number} → ${statusLabel(project, s)}`, `by ${userName} · ${project!.name}`);
    }, `Plot ${selected.number} marked ${statusLabel(project, s)}`);
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

  const editing = mode !== 'view' && mode !== 'multi';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.mapBg }} edges={['bottom', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: project.name,
          headerRight: () => (
            <Row style={{ gap: 2 }}>
              {features(project).approval && pendingIds.size ? (
                <Pressable onPress={() => router.push({ pathname: '/project/[id]/requests', params: { id } })} style={styles.reqBadge} testID="open-requests-badge">
                  <Text style={styles.reqText}>⏳ {pendingIds.size}</Text>
                </Pressable>
              ) : null}
              <IconButton icon="share-social-outline" label="Share" onPress={() => setShareWhat('layout')} testID="open-share-sheet" />
              <IconButton icon="grid-outline" label="Menu" onPress={() => router.push({ pathname: '/project/[id]/menu', params: { id } })} testID="open-menu" />
              <IconButton icon="settings-outline" label="Settings" onPress={() => router.push({ pathname: '/project/[id]/settings', params: { id } })} testID="open-settings" />
            </Row>
          ),
        }}
      />

      <MapFilters
        project={project}
        plots={plots}
        search={search}
        onSearch={setSearch}
        onSubmitSearch={doSearch}
        status={filter}
        onStatus={setFilter}
        blocks={blocks}
        block={blockFilter}
        onBlock={setBlockFilter}
      />

      <View style={{ flex: 1 }}>
        <PlotMap
          plots={plots}
          layout={layout}
          bounds={project.bounds}
          selectedIds={mode === 'multi' ? multiIds : selectedId ? [selectedId] : []}
          fadedIds={fadedIds}
          pendingIds={pendingIds}
          overlay={overlay}
          onTap={onTap}
          focus={focus}
          testID="plot-map"
        />

        {mode === 'multi' ? (
          <BulkBar
            project={project}
            selected={plots.filter((p) => multiIds.includes(p.id))}
            blocks={blocks}
            onApply={(fn: (p: Plot) => PlotPatch | null, label: string) => {
              const items = plots
                .filter((p) => multiIds.includes(p.id))
                .map((p) => ({ before: p, patch: fn(p) }))
                .filter((x): x is { before: Plot; patch: PlotPatch } => !!x.patch);
              if (!items.length) return toast('Nothing to change');
              run(async () => {
                await backend.bulkUpdatePlots(id, items, who);
                const changed = items.filter((x) => x.patch.status && x.patch.status !== x.before.status);
                if (changed.length) notify('all', `${changed.length} plots → ${statusLabel(project, changed[0].patch.status!)}`, `by ${userName} · ${project.name}`);
              }, label);
            }}
            onSelectAll={() => setMultiIds(plots.filter(matches).map((p) => p.id))}
            onClear={() => setMultiIds([])}
            onDone={() => {
              setMultiIds([]);
              setMode('view');
            }}
          />
        ) : editing ? (
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
          <PlotSheet
            plot={selected}
            project={project}
            canEditStatus={canEditStatus}
            excludeStatuses={isAdmin ? [] : ['blocked']}
            onStatus={setStatus}
            onClose={() => setSelectedId(null)}
            isAdmin={isAdmin}
            uid={uid}
            onDecide={(ok) =>
              run(async () => {
                const req = selected.pending;
                await backend.decideRequest(id, selected, ok, who);
                if (req) notify({ uid: req.by }, `Plot ${selected.number} ${ok ? 'approved' : 'rejected'}`, `${statusLabel(project, req.status)} · ${project.name}`);
                if (req && ok) notify('all', `Plot ${selected.number} → ${statusLabel(project, req.status)}`, `approved by ${userName} · ${project.name}`);
              }, ok ? 'Approved' : 'Rejected')
            }
            onCancelRequest={() => run(() => backend.cancelRequest(id, selected, who), 'Request cancelled')}
            onShare={() => setShareWhat('plot')}
          />
        ) : isAdmin ? (
          <View style={styles.fabWrap} pointerEvents="box-none">
            <Button small variant="secondary" icon="shapes-outline" title="Edit shapes" onPress={() => setMode('edit')} testID="edit-shapes" />
            <Button
              small
              variant="secondary"
              icon="checkbox-outline"
              title="Select many"
              onPress={() => {
                setSelectedId(null);
                setMultiIds([]);
                setMode('multi');
              }}
              testID="select-many"
            />
          </View>
        ) : null}
      </View>

      {data.error ? (
        <View style={{ position: 'absolute', top: 110, left: 12, right: 12 }}>
          <Banner tone="danger" text={data.error} />
        </View>
      ) : null}

      <ShareSheet
        visible={!!shareWhat}
        onClose={() => setShareWhat(null)}
        project={project}
        plots={plots}
        layout={layout}
        plot={shareWhat === 'plot' ? selected : null}
      />

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
  reqBadge: { backgroundColor: '#F08C00', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 4 },
  reqText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  fabWrap: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', gap: 8 },
});
