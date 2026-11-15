// Interactive layout map: pinch to zoom, drag to pan, tap to select.
// While a gesture is running the drawing is moved with a cheap transform;
// when the fingers lift the SVG viewBox is updated so lines and text are
// redrawn crisp at the new zoom level.

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';

import { labelPoint, polygonToPath } from '@/lib/geometry';
import { STATUS_COLOR, STATUS_FILL_SOLID } from '@/lib/status';
import type { BgText, Bounds, LayoutData, Plot, Pt } from '@/lib/types';
import { C } from '@/theme';

export interface MapOverlay {
  draft?: Pt[];
  handles?: Pt[];
  activeHandle?: number | null;
  midHandles?: Pt[];
  line?: Pt[];
  markers?: Pt[];
}

export interface PlotMapProps {
  plots: Plot[];
  layout: LayoutData | null;
  bounds: Bounds;
  selectedIds?: string[];
  /** plots greyed out (e.g. not matching the current filter) */
  fadedIds?: Set<string> | null;
  neutral?: boolean;
  overlay?: MapOverlay;
  onTap?: (pt: Pt, unitsPerPx: number) => void;
  /** change `key` to zoom to `bounds` */
  focus?: { bounds: Bounds; key: number } | null;
  testID?: string;
}

type VB = { x: number; y: number; w: number; h: number };

// SVG text defaults to a serif font in browsers
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;

function fitVB(b: Bounds, W: number, H: number, pad = 0.06): VB {
  const bw = Math.max(b.maxX - b.minX, 1e-6);
  const bh = Math.max(b.maxY - b.minY, 1e-6);
  const upp = Math.max(bw / W, bh / H) * (1 + pad * 2);
  const w = W * upp;
  const h = H * upp;
  return { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w, h };
}

type PlotGeo = { id: string; d: string; label: Pt; r: number; number: string; bb: Bounds };

const PlotShapes = memo(function PlotShapes({
  geo,
  plots,
  sw,
  fadedIds,
  neutral,
}: {
  geo: PlotGeo[];
  plots: Plot[];
  sw: number;
  fadedIds?: Set<string> | null;
  neutral?: boolean;
}) {
  return (
    <G>
      {geo.map((g, i) => {
        const p = plots[i];
        const faded = fadedIds?.has(p.id);
        const fill = neutral ? '#D8E5F6' : faded ? '#EEEFEE' : STATUS_FILL_SOLID[p.status];
        const stroke = neutral ? C.primary : faded ? '#C4C9D0' : STATUS_COLOR[p.status];
        return <Path key={g.id} d={g.d} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />;
      })}
    </G>
  );
});

const Background = memo(function Background({ paths, sw }: { paths: string[]; sw: number }) {
  return (
    <G>
      {paths.map((d, i) => (
        <Path key={i} d={d} fill="none" stroke={C.bgLine} strokeWidth={sw} />
      ))}
    </G>
  );
});

export function PlotMap({ plots, layout, bounds, selectedIds = [], fadedIds, neutral, overlay, onTap, focus, testID }: PlotMapProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tx] = useState(() => new Animated.Value(0));
  const [ty] = useState(() => new Animated.Value(0));
  const [sc] = useState(() => new Animated.Value(1));
  // The view is fitted to the layout until the user zooms/pans; a change of the
  // layout bounds or screen size refits it.
  const boundsKey = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
  const fitKey = `${boundsKey}|${size.w}x${size.h}`;
  const [view, setView] = useState<{ key: string; vb: VB } | null>(null);
  const [seenFocus, setSeenFocus] = useState<number | null>(null);
  if (focus && focus.key !== seenFocus && size.w && size.h) {
    // zoom to a plot (adjusting state while rendering, as React recommends for derived state)
    setSeenFocus(focus.key);
    const b = focus.bounds;
    const m = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.6;
    setView({ key: fitKey, vb: fitVB({ minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m }, size.w, size.h, 0) });
  }
  const vb: VB | null = size.w && size.h ? (view && view.key === fitKey ? view.vb : fitVB(bounds, size.w, size.h)) : null;
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const pageOffset = useRef({ x: 0, y: 0 });

  const geo: PlotGeo[] = useMemo(
    () =>
      plots.map((p) => {
        const lp = labelPoint(p.polygon);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const q of p.polygon) {
          minX = Math.min(minX, q.x);
          minY = Math.min(minY, q.y);
          maxX = Math.max(maxX, q.x);
          maxY = Math.max(maxY, q.y);
        }
        return { id: p.id, d: polygonToPath(p.polygon), label: lp.pt, r: lp.radius, number: p.number, bb: { minX, minY, maxX, maxY } };
      }),
    [plots],
  );

  // ---- latest values for the gesture handlers (which are created once)
  const st = useRef({ vb, size, onTap, fitKey, bounds });
  useLayoutEffect(() => {
    st.current = { vb, size, onTap, fitKey, bounds };
  });

  const setVb = useCallback((v: VB) => setView({ key: st.current.fitKey, vb: v }), []);

  const fitTo = useCallback(
    (b: Bounds, pad?: number) => {
      const { size: s } = st.current;
      if (!s.w || !s.h) return;
      setVb(fitVB(b, s.w, s.h, pad));
    },
    [setVb],
  );

  // after a new viewBox has been rendered, drop the temporary gesture transform
  const vbKey = vb ? `${vb.x},${vb.y},${vb.w},${vb.h}` : '';
  useLayoutEffect(() => {
    tx.setValue(0);
    ty.setValue(0);
    sc.setValue(1);
  }, [vbKey, tx, ty, sc]);

  const measure = useCallback(() => {
    containerRef.current?.measure?.((_x: number, _y: number, _w: number, _h: number, px: number, py: number) => {
      if (Number.isFinite(px)) pageOffset.current = { x: px, y: py };
    });
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: Math.round(width), h: Math.round(height) });
    setTimeout(measure, 50);
  };

  // ---- gesture state
  const gRef = useRef({
    t: { x: 0, y: 0 },
    k: 1,
    // base of the current single-finger drag or pinch
    base: { t: { x: 0, y: 0 }, k: 1, p: { x: 0, y: 0 }, d: 1, n: 0 },
    start: { x: 0, y: 0, time: 0 },
    moved: false,
    multi: false,
  });

  const commit = useCallback(() => {
    const g = gRef.current;
    const { vb: v, size: s } = st.current;
    if (!v || !s.w) return;
    const k = g.k;
    if (k === 1 && g.t.x === 0 && g.t.y === 0) return;
    const cx = s.w / 2;
    const cy = s.h / 2;
    // view point that is now at the top-left corner of the screen
    const p0x = cx + (0 - cx - g.t.x) / k;
    const p0y = cy + (0 - cy - g.t.y) / k;
    const upp = v.w / s.w;
    setVb({ x: v.x + p0x * upp, y: v.y + p0y * upp, w: v.w / k, h: v.h / k });
    g.t = { x: 0, y: 0 };
    g.k = 1;
  }, [setVb]);

  const touchesOf = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches?.length ? e.nativeEvent.touches : [e.nativeEvent];
    return Array.from(ts).map((t) => ({ x: t.pageX - pageOffset.current.x, y: t.pageY - pageOffset.current.y }));
  };

  const setBase = (pts: { x: number; y: number }[]) => {
    const g = gRef.current;
    const n = Math.min(pts.length, 2);
    const p = n === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const d = n === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1 : 1;
    g.base = { t: { ...g.t }, k: g.k, p, d, n };
  };

  const clampK = (k: number) => {
    const { vb: v, bounds } = st.current;
    if (!v) return k;
    const fitW = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const newW = v.w / k;
    if (newW > fitW * 4) return v.w / (fitW * 4);
    if (newW < fitW / 400) return v.w / (fitW / 400);
    return k;
  };

  // Created once; the handlers only read refs when touches happen, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const g = gRef.current;
          measure();
          const pts = touchesOf(e);
          g.start = { x: pts[0].x, y: pts[0].y, time: Date.now() };
          g.moved = false;
          g.multi = pts.length > 1;
          setBase(pts);
        },
        onPanResponderMove: (e) => {
          const g = gRef.current;
          const pts = touchesOf(e);
          const n = Math.min(pts.length, 2);
          if (n !== g.base.n) setBase(pts);
          if (n === 2) g.multi = true;
          const { size: s } = st.current;
          const cx = s.w / 2;
          const cy = s.h / 2;
          if (n === 2) {
            const m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            const k = clampK(g.base.k * (d / g.base.d));
            const r = k / g.base.k;
            g.k = k;
            g.t = { x: m.x - cx - r * (g.base.p.x - cx - g.base.t.x), y: m.y - cy - r * (g.base.p.y - cy - g.base.t.y) };
          } else {
            g.t = { x: g.base.t.x + pts[0].x - g.base.p.x, y: g.base.t.y + pts[0].y - g.base.p.y };
          }
          if (Math.hypot(pts[0].x - g.start.x, pts[0].y - g.start.y) > 6) g.moved = true;
          tx.setValue(g.t.x);
          ty.setValue(g.t.y);
          sc.setValue(g.k);
        },
        onPanResponderRelease: () => {
          const g = gRef.current;
          const isTap = !g.moved && !g.multi && Date.now() - g.start.time < 500;
          if (isTap) {
            const { vb: v, size: s, onTap: tap } = st.current;
            if (v && s.w && tap) {
              const upp = v.w / s.w;
              tap({ x: v.x + g.start.x * upp, y: v.y + g.start.y * upp }, upp);
            }
            g.t = { x: 0, y: 0 };
            g.k = 1;
            tx.setValue(0);
            ty.setValue(0);
            sc.setValue(1);
            return;
          }
          commit();
        },
        onPanResponderTerminate: () => commit(),
      }),
  );

  // mouse wheel zoom in browsers
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = containerRef.current as unknown as HTMLElement | null;
    if (!el || !el.addEventListener) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const { vb: v, size: s } = st.current;
      if (!v || !s.w) return;
      const f = Math.exp(-ev.deltaY * 0.0015);
      const k = clampK(f);
      const upp = v.w / s.w;
      const mx = v.x + (ev.clientX - rect.left) * upp;
      const my = v.y + (ev.clientY - rect.top) * upp;
      const w = v.w / k;
      const h = v.h / k;
      setVb({ x: mx - (mx - v.x) / k, y: my - (my - v.y) / k, w, h });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, boundsKey]);

  const zoomBy = (k: number) => {
    const v = st.current.vb;
    if (!v) return;
    const kk = clampK(k);
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    setVb({ x: cx - v.w / kk / 2, y: cy - v.h / kk / 2, w: v.w / kk, h: v.h / kk });
  };

  const upp = vb && size.w ? vb.w / size.w : 1;
  const selected = new Set(selectedIds);

  // labels & background texts only where readable and on screen
  const labels = useMemo(() => {
    if (!vb) return [];
    const out: { id: string; x: number; y: number; fs: number; t: string }[] = [];
    for (const g2 of geo) {
      if (g2.bb.maxX < vb.x || g2.bb.minX > vb.x + vb.w || g2.bb.maxY < vb.y || g2.bb.minY > vb.y + vb.h) continue;
      const len = Math.max(g2.number.length, 1);
      const fs = Math.min(g2.r * 1.1, (g2.r * 1.7) / (0.62 * len));
      if (fs / upp < 7) continue;
      out.push({ id: g2.id, x: g2.label.x, y: g2.label.y + fs * 0.35, fs: Math.min(fs, upp * 26), t: g2.number });
    }
    return out;
  }, [geo, vb, upp]);

  const bgTexts = useMemo(() => {
    if (!vb || !layout?.texts?.length) return [] as BgText[];
    const out: BgText[] = [];
    for (const t of layout.texts) {
      if (t.h / upp < 6) continue;
      if (t.x < vb.x - vb.w * 0.2 || t.x > vb.x + vb.w * 1.2 || t.y < vb.y - vb.h * 0.2 || t.y > vb.y + vb.h * 1.2) continue;
      out.push(t);
      if (out.length > 300) break;
    }
    return out;
  }, [layout, vb, upp]);

  const ov = overlay || {};
  const hr = 8 * upp;

  return (
    <View ref={containerRef} style={styles.wrap} onLayout={onLayout} testID={testID} {...responder.panHandlers}>
      {vb && size.w > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{ width: size.w, height: size.h, transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] }}
        >
          <Svg width={size.w} height={size.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
            <Background paths={layout?.paths || []} sw={upp * 0.8} />
            {bgTexts.map((t, i) => (
              <SvgText
                key={i}
                x={t.x}
                y={t.y + t.h * 0.35}
                fontSize={t.h}
                fill="#7A8088"
                fontFamily={FONT}
                textAnchor="middle"
                transform={t.r ? `rotate(${t.r} ${t.x} ${t.y})` : undefined}
              >
                {t.t}
              </SvgText>
            ))}
            <PlotShapes geo={geo} plots={plots} sw={upp * 1.2} fadedIds={fadedIds} neutral={neutral} />
            {geo
              .filter((x) => selected.has(x.id))
              .map((x) => (
                <Path key={'sel' + x.id} d={x.d} fill="rgba(31,111,235,0.18)" stroke={C.primary} strokeWidth={upp * 3.5} strokeLinejoin="round" />
              ))}
            {labels.map((l) => (
              <SvgText key={'l' + l.id} x={l.x} y={l.y} fontSize={l.fs} fontWeight="bold" fill="#1B1F24" textAnchor="middle" fontFamily={FONT}>
                {l.t}
              </SvgText>
            ))}
            {ov.markers?.map((m, i) => (
              <Circle key={'m' + i} cx={m.x} cy={m.y} r={5 * upp} fill={C.danger} stroke="#fff" strokeWidth={upp * 1.5} />
            ))}
            {ov.draft && ov.draft.length > 0 ? (
              <G>
                <Polyline points={ov.draft.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(31,111,235,0.12)" stroke={C.primary} strokeWidth={upp * 2.5} strokeDasharray={`${upp * 6},${upp * 4}`} />
                {ov.draft.map((p, i) => (
                  <Circle key={'d' + i} cx={p.x} cy={p.y} r={hr * 0.7} fill={i === 0 ? '#F59E0B' : C.primary} stroke="#fff" strokeWidth={upp * 1.5} />
                ))}
              </G>
            ) : null}
            {ov.line && ov.line.length === 2 ? (
              <Line x1={ov.line[0].x} y1={ov.line[0].y} x2={ov.line[1].x} y2={ov.line[1].y} stroke="#F59E0B" strokeWidth={upp * 3} strokeDasharray={`${upp * 8},${upp * 5}`} />
            ) : null}
            {ov.line?.map((p, i) => (
              <Circle key={'lp' + i} cx={p.x} cy={p.y} r={hr * 0.7} fill="#F59E0B" stroke="#fff" strokeWidth={upp * 1.5} />
            ))}
            {ov.midHandles?.map((p, i) => (
              <Circle key={'mh' + i} cx={p.x} cy={p.y} r={hr * 0.6} fill="#fff" stroke={C.primary} strokeWidth={upp * 2} />
            ))}
            {ov.handles?.map((p, i) => (
              <Circle key={'h' + i} cx={p.x} cy={p.y} r={hr} fill={ov.activeHandle === i ? '#F59E0B' : C.primary} stroke="#fff" strokeWidth={upp * 2} />
            ))}
          </Svg>
        </Animated.View>
      ) : null}
      <View style={styles.zoom}>
        <Pressable accessibilityLabel="Zoom in" style={styles.zoomBtn} onPress={() => zoomBy(1.6)}>
          <Ionicons name="add" size={22} color={C.text} />
        </Pressable>
        <Pressable accessibilityLabel="Zoom out" style={styles.zoomBtn} onPress={() => zoomBy(1 / 1.6)}>
          <Ionicons name="remove" size={22} color={C.text} />
        </Pressable>
        <Pressable accessibilityLabel="Show whole layout" style={styles.zoomBtn} onPress={() => fitTo(bounds)}>
          <Ionicons name="scan-outline" size={20} color={C.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: C.mapBg },
  zoom: { position: 'absolute', right: 12, top: 12, gap: 8 },
  zoomBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
