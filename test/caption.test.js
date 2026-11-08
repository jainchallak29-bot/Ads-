import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHashtags,
  buildPostText,
  analyzeText,
  instagramTextProblems,
  extractHashtags,
} from '../public/shared/caption.js';
import { describeSelection, formatsFor, suggestFacebookVideoFormat, facebookReelProblems, instagramReelProblems, instagramNeedsPadding } from '../public/shared/rules.js';

test('normalizeHashtags cleans, prefixes and de-duplicates', () => {
  assert.deepEqual(normalizeHashtags('sale, #Summer  #summer deals;#new#arrivals'), ['#sale', '#Summer', '#deals', '#new', '#arrivals']);
  assert.deepEqual(normalizeHashtags(['#a-b', "don't", '##', '']), ['#ab', '#dont']);
});

test('normalizeHashtags keeps non-Latin scripts including combining marks', () => {
  assert.deepEqual(normalizeHashtags('#हिंदी #café #日本'), ['#हिंदी', '#café', '#日本']);
});

test('buildPostText appends hashtags after a blank line without repeating ones in the caption', () => {
  assert.equal(buildPostText('Big sale today! #sale', ['sale', 'shoes']), 'Big sale today! #sale\n\n#shoes');
  assert.equal(buildPostText('  Hello\r\nworld  ', []), 'Hello\nworld');
  assert.equal(buildPostText('', 'a b'), '#a #b');
  assert.equal(buildPostText('Only caption', ''), 'Only caption');
});

test('analyzeText counts characters, hashtags and mentions', () => {
  const a = analyzeText('Hi @shop and @friend.name! #one #two email me@example.com &#35;x');
  assert.equal(a.hashtags, 2);
  assert.equal(a.mentions, 2);
  assert.equal(analyzeText('👍🏽 ok').chars, 5);
  assert.deepEqual(extractHashtags('#a,#b #c'), ['#a', '#b', '#c']);
});

test('instagramTextProblems enforces Instagram limits', () => {
  assert.deepEqual(instagramTextProblems('fine #ok'), []);
  const many = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  assert.match(instagramTextProblems(many)[0], /at most 30 hashtags/);
  assert.match(instagramTextProblems('x'.repeat(2201))[0], /2200 characters/);
});

test('media selection rules', () => {
  assert.deepEqual(describeSelection([]), { kind: null, error: null });
  assert.equal(describeSelection([{ kind: 'video' }]).kind, 'video');
  assert.match(describeSelection([{ kind: 'video' }, { kind: 'image' }]).error, /one video/);
  assert.match(describeSelection(Array(11).fill({ kind: 'image' })).error, /at most 10/);
  assert.deepEqual(formatsFor('fb_page', 'video'), ['reel', 'video']);
  assert.deepEqual(formatsFor('ig', 'image'), ['post']);
  assert.deepEqual(formatsFor('fb_group', 'image'), ['assist']);
});

test('video format suggestions and limits', () => {
  assert.equal(suggestFacebookVideoFormat({ width: 1080, height: 1920, duration: 30 }), 'reel');
  assert.equal(suggestFacebookVideoFormat({ width: 1920, height: 1080, duration: 30 }), 'video');
  assert.equal(suggestFacebookVideoFormat({ width: 1080, height: 1920, duration: 120 }), 'video');
  assert.match(facebookReelProblems({ width: 1080, height: 1920, duration: 95 })[0], /3–90 seconds/);
  assert.match(facebookReelProblems({ width: 360, height: 640, duration: 10 })[0], /540×960/);
  assert.deepEqual(instagramReelProblems({ duration: 60, size: 10 }), []);
  assert.match(instagramReelProblems({ duration: 2, size: 10 })[0], /3 seconds/);
  assert.equal(instagramNeedsPadding({ width: 1080, height: 1920 }), true);
  assert.equal(instagramNeedsPadding({ width: 1080, height: 1350 }), false);
  assert.equal(instagramNeedsPadding({ width: 1920, height: 1000 }), true);
});
