// Placing the layout on the earth with two reference points.
// Each point = a spot on the drawing + its GPS position (from the phone on
// site, or copied from Google Maps). Gives a scale + rotation + shift between
// drawing and ground, so the app can show "you are here" and give directions.

import { DRAWING_UNIT_M } from './units';
import type { DrawingUnit, Pt } from './types';

export interface GeoPoint {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface GeoRef {
  points: [GeoPoint, GeoPoint];
}

const R = 6371008.8; // mean earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

type C = { re: number; im: number };
const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const abs = (a: C) => Math.hypot(a.re, a.im);

export interface GeoTransform {
  toLatLng(p: Pt): { lat: number; lng: number };
  fromLatLng(lat: number, lng: number): Pt;
  /** ground distance / drawing distance between the two points (1.0 = perfect) */
  scale: number;
  /** distance between the two reference points on the drawing, metres */
  drawingMetres: number;
  groundMetres: number;
}

export function makeGeo(ref: GeoRef, unit: DrawingUnit): GeoTransform | null {
  const [p1, p2] = ref.points;
  const f = DRAWING_UNIT_M[unit];
  const lat0 = rad(p1.lat);
  // local flat-earth metres (east, north) around point 1
  const toEN = (lat: number, lng: number): C => ({ re: rad(lng - p1.lng) * Math.cos(lat0) * R, im: rad(lat - p1.lat) * R });
  const fromEN = (c: C) => ({ lat: p1.lat + (c.im / R) * (180 / Math.PI), lng: p1.lng + (c.re / (R * Math.cos(lat0))) * (180 / Math.PI) });
  // drawing metres with Y up (map Y points down)
  const toM = (p: Pt): C => ({ re: p.x * f, im: -p.y * f });
  const m1 = toM(p1);
  const m2 = toM(p2);
  const g1: C = { re: 0, im: 0 };
  const g2 = toEN(p2.lat, p2.lng);
  const dm = sub(m2, m1);
  if (abs(dm) < 1e-6 || abs(g2) < 1e-6) return null;
  const a = div(sub(g2, g1), dm); // rotation + scale
  return {
    toLatLng: (p) => fromEN(add(g1, mul(a, sub(toM(p), m1)))),
    fromLatLng: (lat, lng) => {
      const m = add(m1, div(sub(toEN(lat, lng), g1), a));
      return { x: m.re / f, y: -m.im / f };
    },
    scale: abs(a),
    drawingMetres: abs(dm),
    groundMetres: abs(g2),
  };
}

/** "26.9124, 75.7873" or a Google Maps link → lat/lng */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = s.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
