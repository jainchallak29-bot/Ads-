import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeGeo, parseLatLng } from '../src/lib/geo';

test('two-point georeference maps drawing ↔ GPS', () => {
  // drawing in metres; point B is 100 m east and 50 m north (map y is down) of A
  const A = { x: 0, y: 100, lat: 26.9, lng: 75.8 };
  const g = makeGeo({ points: [A, { x: 100, y: 50, lat: 0, lng: 0 }] }, 'm');
  // compute the true GPS of B for a north-up drawing
  const dLat = (50 / 6371008.8) * (180 / Math.PI);
  const dLng = (100 / (6371008.8 * Math.cos((26.9 * Math.PI) / 180))) * (180 / Math.PI);
  const geo = makeGeo({ points: [A, { x: 100, y: 50, lat: 26.9 + dLat, lng: 75.8 + dLng }] }, 'm')!;
  assert.equal(g === null || g.scale > 1000, true, 'bogus point gives a huge scale');
  assert.ok(Math.abs(geo.scale - 1) < 1e-6);
  const mid = geo.toLatLng({ x: 50, y: 75 });
  assert.ok(Math.abs(mid.lat - (26.9 + dLat / 2)) < 1e-7 && Math.abs(mid.lng - (75.8 + dLng / 2)) < 1e-7);
  const back = geo.fromLatLng(mid.lat, mid.lng);
  assert.ok(Math.abs(back.x - 50) < 1e-6 && Math.abs(back.y - 75) < 1e-6);
  // a drawing in feet with the same ground points has scale 1/0.3048
  const ft = makeGeo({ points: [A, { x: 100, y: 50, lat: 26.9 + dLat, lng: 75.8 + dLng }] }, 'ft')!;
  assert.ok(Math.abs(ft.scale - 1 / 0.3048) < 1e-6);
});

test('parse coordinates from text or Google Maps links', () => {
  assert.deepEqual(parseLatLng('26.912434, 75.787270'), { lat: 26.912434, lng: 75.78727 });
  assert.deepEqual(parseLatLng('https://www.google.com/maps/@26.9124,75.7873,17z'), { lat: 26.9124, lng: 75.7873 });
  assert.equal(parseLatLng('hello'), null);
});
