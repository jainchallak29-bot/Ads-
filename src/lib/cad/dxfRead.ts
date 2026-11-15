// Reads a DXF file into simple polylines and texts in CAD coordinates (Y up).
// Block references (INSERT) are exploded, arcs/bulges/circles/ellipses/splines are
// approximated with straight segments, and MTEXT formatting is stripped.

import DxfParser from 'dxf-parser';

import { boundsOf } from '../geometry';
import { insunitsToDrawingUnit } from '../units';
import type { Bounds, DrawingUnit, Pt } from '../types';

export interface RawPolyline {
  pts: Pt[];
  closed: boolean;
  layer: string;
  /** circles/ellipses are usually trees or symbols, never plot boundaries */
  kind: 'line' | 'poly' | 'arc' | 'circle';
}

export interface RawText {
  text: string;
  /** estimated visual centre of the text */
  x: number;
  y: number;
  h: number;
  /** degrees, counter-clockwise (CAD convention) */
  rot: number;
  layer: string;
}

export interface LayerInfo {
  name: string;
  lineCount: number;
  closedCount: number;
  textCount: number;
  numberTextCount: number;
}

export interface CadData {
  polylines: RawPolyline[];
  texts: RawText[];
  layers: LayerInfo[];
  drawingUnit: DrawingUnit | null;
  bounds: Bounds;
}

// 2D affine transform [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f
type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: M, p: { x: number; y: number }): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function translate(x: number, y: number): M {
  return [1, 0, 0, 1, x, y];
}
function rotate(deg: number): M {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
function scale(sx: number, sy: number): M {
  return [sx, 0, 0, sy, 0, 0];
}

const ARC_STEP = Math.PI / 18; // 10 degrees

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, maxStep = ARC_STEP): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil(sweep / maxStep));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Points along a polyline segment with a bulge (arc), excluding the start point. */
function bulgePoints(p1: Pt, p2: Pt, bulge: number): Pt[] {
  if (!bulge || Math.abs(bulge) < 1e-9) return [p2];
  const theta = 4 * Math.atan(bulge);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [p2];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const sagittaDir = bulge > 0 ? 1 : -1;
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
  // centre lies to the left of p1->p2 for positive bulge when |theta| < PI
  const nx = -dy / chord;
  const ny = dx / chord;
  const sideFactor = Math.abs(theta) > Math.PI ? -1 : 1;
  const cx = mx + nx * h * sagittaDir * sideFactor;
  const cy = my + ny * h * sagittaDir * sideFactor;
  const a0 = Math.atan2(p1.y - cy, p1.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / ARC_STEP));
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (theta * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  pts[pts.length - 1] = { x: p2.x, y: p2.y };
  return pts;
}

export function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2')
    .replace(/\\[ACcFfHhQqTtWwp][^;]*;/g, '')
    .replace(/\\[LlOoKkNX~]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

export function cleanText(s: string): string {
  return s
    .replace(/%%[dD]/g, '°')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .trim();
}

const PLOT_PREFIX = /^(?:PLOT|PLT)\s*(?:NO|NUMBER)?\s*[.:#-]?\s*|^NO\s*[.:#-]\s*/i;
const PLOT_NUMBER = /^(?:[A-Z]{1,4}[\s\-/]?)?\d{1,4}(?:[\s\-/]?[A-Z]{1,2})?$/;

/** Returns the normalised plot number if the text looks like one, else null. */
export function asPlotNumber(raw: string): string | null {
  let t = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t || t.length > 16) return null;
  if (/['"%°]/.test(t) || /\d\.\d/.test(t) || /\b(SQ|SFT|SQM|SQFT|SYD|YDS|MTR|FT|M)\b/.test(t)) return null;
  t = t.replace(PLOT_PREFIX, '').trim();
  if (!PLOT_NUMBER.test(t)) return null;
  return t.replace(/\s/g, '');
}

/** Visual centre of a TEXT entity given its insertion/alignment points. */
function textCenter(e: any, len: number): { x: number; y: number; h: number; rot: number } {
  const h = e.textHeight || 1;
  const rot = e.rotation || 0;
  const w = len * h * 0.7 * (e.xScale || 1);
  const ha = e.halign || 0;
  const va = e.valign || 0;
  const start = e.startPoint || { x: 0, y: 0 };
  let base: Pt = start;
  let dx = w / 2;
  let dy = h / 2;
  if ((ha || va) && e.endPoint) {
    base = e.endPoint;
    if (ha === 3 || ha === 5) {
      base = { x: (start.x + e.endPoint.x) / 2, y: (start.y + e.endPoint.y) / 2 };
      dx = 0;
    } else if (ha === 1 || ha === 4) dx = 0;
    else if (ha === 2) dx = -w / 2;
    if (ha === 4) dy = 0;
    else if (va === 2) dy = 0;
    else if (va === 3) dy = -h / 2;
  }
  const r = (rot * Math.PI) / 180;
  return { x: base.x + dx * Math.cos(r) - dy * Math.sin(r), y: base.y + dx * Math.sin(r) + dy * Math.cos(r), h, rot };
}

function mtextCenter(e: any, text: string): { x: number; y: number; h: number; rot: number } {
  const h = e.height || 1;
  let rot = e.rotation || 0;
  if (!e.rotation && e.directionVector && (e.directionVector.x || e.directionVector.y)) {
    rot = (Math.atan2(e.directionVector.y, e.directionVector.x) * 180) / Math.PI;
  }
  const lines = text.split('\n');
  const maxLen = Math.max(...lines.map((l) => l.length), 1);
  let w = maxLen * h * 0.7;
  if (e.width && e.width > 0) w = Math.min(w, e.width);
  const H = lines.length * h * 1.4;
  const ap = e.attachmentPoint || 1;
  const col = (ap - 1) % 3; // 0 left, 1 centre, 2 right
  const row = Math.floor((ap - 1) / 3); // 0 top, 1 middle, 2 bottom
  const dx = col === 0 ? w / 2 : col === 1 ? 0 : -w / 2;
  const dy = row === 0 ? -H / 2 : row === 1 ? 0 : H / 2;
  const p = e.position || { x: 0, y: 0 };
  const r = (rot * Math.PI) / 180;
  return { x: p.x + dx * Math.cos(r) - dy * Math.sin(r), y: p.y + dx * Math.sin(r) + dy * Math.cos(r), h, rot };
}

// dxf-parser has no ATTRIB handler; block attributes are often used for plot
// numbers, so read them like TEXT entities.
class AttribHandler {
  ForEntityName = 'ATTRIB';
  parseEntity(scanner: any, curr: any) {
    const e: any = { type: curr.value, startPoint: { x: 0, y: 0 } };
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0) break;
      const v = curr.value;
      switch (curr.code) {
        case 10:
          e.startPoint.x = v;
          break;
        case 20:
          e.startPoint.y = v;
          break;
        case 11:
          e.endPoint = { ...(e.endPoint || { y: 0 }), x: v };
          break;
        case 21:
          e.endPoint = { ...(e.endPoint || { x: 0 }), y: v };
          break;
        case 40:
          e.textHeight = v;
          break;
        case 41:
          e.xScale = v;
          break;
        case 50:
          e.rotation = v;
          break;
        case 1:
          e.text = v;
          break;
        case 2:
          e.tag = v;
          break;
        case 8:
          e.layer = v;
          break;
        case 67:
          e.inPaperSpace = v === 1;
          break;
        case 70:
          e.hidden = (v & 1) === 1;
          break;
        case 72:
          e.halign = v;
          break;
        case 74:
          e.valign = v;
          break;
        default:
          break;
      }
      curr = scanner.next();
    }
    return e;
  }
}

export function parseDxfText(source: string): any {
  const parser = new DxfParser();
  parser.registerEntityHandler(AttribHandler as any);
  return parser.parseSync(source);
}

export function readDxf(source: string): CadData {
  const dxf = parseDxfText(source);
  if (!dxf) throw new Error('Could not read this DXF file.');
  const blocks: Record<string, any> = dxf.blocks || {};
  const layerTable: Record<string, any> = dxf.tables?.layer?.layers || {};
  const hiddenLayers = new Set(
    Object.values(layerTable)
      .filter((l: any) => l && l.visible === false)
      .map((l: any) => l.name as string),
  );

  const polylines: RawPolyline[] = [];
  const texts: RawText[] = [];

  const det = (m: M) => m[0] * m[3] - m[1] * m[2];

  const addPoly = (pts: Pt[], closed: boolean, layer: string, kind: RawPolyline['kind']) => {
    const clean = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (clean.length < 2) return;
    polylines.push({ pts: clean, closed, layer, kind });
  };

  const addText = (raw: string, c: { x: number; y: number; h: number; rot: number }, m: M, layer: string) => {
    const text = cleanText(raw);
    if (!text) return;
    const p = apply(m, c);
    const s = Math.sqrt(Math.abs(det(m))) || 1;
    const dir = apply([m[0], m[1], m[2], m[3], 0, 0], { x: Math.cos((c.rot * Math.PI) / 180), y: Math.sin((c.rot * Math.PI) / 180) });
    texts.push({ text, x: p.x, y: p.y, h: c.h * s, rot: (Math.atan2(dir.y, dir.x) * 180) / Math.PI, layer });
  };

  const walk = (entities: any[], m: M, parentLayer: string | null, depth: number) => {
    if (depth > 8) return;
    for (const e of entities || []) {
      if (!e || e.inPaperSpace) continue;
      let layer: string = e.layer ?? '0';
      // entities on layer 0 inside a block take the INSERT's layer
      if (parentLayer && layer === '0') layer = parentLayer;
      if (hiddenLayers.has(layer)) continue;
      try {
        switch (e.type) {
          case 'LINE':
            if (e.vertices?.length >= 2) addPoly([apply(m, e.vertices[0]), apply(m, e.vertices[1])], false, layer, 'line');
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE': {
            if (e.is3dPolygonMesh || e.isPolyfaceMesh) break;
            const vs: any[] = (e.vertices || []).filter((v: any) => v && Number.isFinite(v.x));
            if (vs.length < 2) break;
            let closed = !!e.shape;
            const pts: Pt[] = [{ x: vs[0].x, y: vs[0].y }];
            const n = vs.length;
            const segCount = closed ? n : n - 1;
            for (let i = 0; i < segCount; i++) {
              const a = vs[i];
              const b = vs[(i + 1) % n];
              pts.push(...bulgePoints({ x: a.x, y: a.y }, { x: b.x, y: b.y }, a.bulge || 0));
            }
            if (closed) pts.pop();
            // open polylines whose ends meet are closed shapes too
            if (!closed && pts.length > 3) {
              const f = pts[0];
              const l = pts[pts.length - 1];
              const span = Math.hypot(pts[1].x - f.x, pts[1].y - f.y) || 1;
              if (Math.hypot(f.x - l.x, f.y - l.y) < span * 1e-6) {
                pts.pop();
                closed = true;
              }
            }
            addPoly(
              pts.map((p) => apply(m, p)),
              closed,
              layer,
              'poly',
            );
            break;
          }
          case 'ARC':
            if (e.center && e.radius > 0) {
              addPoly(
                arcPoints(e.center.x, e.center.y, e.radius, e.startAngle || 0, e.endAngle || Math.PI * 2).map((p) => apply(m, p)),
                false,
                layer,
                'arc',
              );
            }
            break;
          case 'CIRCLE':
            if (e.center && e.radius > 0) {
              const pts = arcPoints(e.center.x, e.center.y, e.radius, 0, Math.PI * 2, Math.PI / 8);
              pts.pop();
              addPoly(
                pts.map((p) => apply(m, p)),
                true,
                layer,
                'circle',
              );
            }
            break;
          case 'ELLIPSE': {
            if (!e.center || !e.majorAxisEndPoint) break;
            const ax = e.majorAxisEndPoint.x;
            const ay = e.majorAxisEndPoint.y;
            const a = Math.hypot(ax, ay);
            const b = a * (e.axisRatio || 1);
            const ang = Math.atan2(ay, ax);
            const t0 = e.startAngle ?? 0;
            let t1 = e.endAngle ?? Math.PI * 2;
            while (t1 <= t0) t1 += Math.PI * 2;
            const n = Math.max(8, Math.ceil((t1 - t0) / ARC_STEP));
            const pts: Pt[] = [];
            for (let i = 0; i <= n; i++) {
              const t = t0 + ((t1 - t0) * i) / n;
              const x = a * Math.cos(t);
              const y = b * Math.sin(t);
              pts.push({ x: e.center.x + x * Math.cos(ang) - y * Math.sin(ang), y: e.center.y + x * Math.sin(ang) + y * Math.cos(ang) });
            }
            const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
            if (full) pts.pop();
            addPoly(
              pts.map((p) => apply(m, p)),
              full,
              layer,
              full ? 'circle' : 'arc',
            );
            break;
          }
          case 'SPLINE': {
            const src: any[] = e.fitPoints?.length >= 2 ? e.fitPoints : e.controlPoints || [];
            if (src.length >= 2) {
              addPoly(
                src.map((p: any) => apply(m, p)),
                !!e.closed,
                layer,
                'arc',
              );
            }
            break;
          }
          case 'TEXT':
          case 'ATTRIB': {
            if (e.hidden) break;
            const raw = e.text ?? '';
            if (!raw) break;
            addText(raw, textCenter(e, cleanText(raw).length), m, layer);
            break;
          }
          case 'MTEXT': {
            const t = cleanMText(e.text ?? '');
            if (!t.trim()) break;
            addText(t, mtextCenter(e, t), m, layer);
            break;
          }
          case 'INSERT': {
            const block = blocks[e.name];
            if (!block || !block.entities?.length) break;
            const base = block.position || { x: 0, y: 0 };
            const rows = Math.max(1, e.rowCount || 1);
            const cols = Math.max(1, e.columnCount || 1);
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const pos = e.position || { x: 0, y: 0 };
                let bm = mul(translate(pos.x, pos.y), rotate(e.rotation || 0));
                bm = mul(bm, translate(c * (e.columnSpacing || 0), r * (e.rowSpacing || 0)));
                bm = mul(bm, scale(e.xScale ?? 1, e.yScale ?? 1));
                bm = mul(bm, translate(-base.x, -base.y));
                walk(block.entities, mul(m, bm), layer, depth + 1);
              }
            }
            break;
          }
          default:
            break; // DIMENSION, HATCH, POINT, SOLID, ATTDEF... are not needed
        }
      } catch {
        // skip a malformed entity rather than failing the whole import
      }
    }
  };

  walk(dxf.entities || [], IDENTITY, null, 0);

  const layerMap = new Map<string, LayerInfo>();
  const L = (name: string) => {
    let l = layerMap.get(name);
    if (!l) {
      l = { name, lineCount: 0, closedCount: 0, textCount: 0, numberTextCount: 0 };
      layerMap.set(name, l);
    }
    return l;
  };
  for (const p of polylines) {
    const l = L(p.layer);
    l.lineCount++;
    if (p.closed && p.kind !== 'circle') l.closedCount++;
  }
  for (const t of texts) {
    const l = L(t.layer);
    l.textCount++;
    if (asPlotNumber(t.text)) l.numberTextCount++;
  }

  const allPts: Pt[] = [];
  for (const p of polylines) for (const q of p.pts) allPts.push(q);
  for (const t of texts) allPts.push(t);

  return {
    polylines,
    texts,
    layers: [...layerMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    drawingUnit: insunitsToDrawingUnit(dxf.header?.$INSUNITS),
    bounds: boundsOf(allPts),
  };
}
