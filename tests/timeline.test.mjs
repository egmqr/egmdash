import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compareTimeline, timelineForObject } from '../worker/timeline.js';

test('late old upload keeps original capture order', () => {
  const oldLate = { key: 'events/e/prints/c-1000-p001-photo-s0001.jpg', uploaded: new Date(9000) };
  const newEarly = { key: 'events/e/prints/c-2000-p002-photo-s0002.jpg', uploaded: new Date(3000) };

  assert.deepEqual([newEarly, oldLate].sort(compareTimeline), [oldLate, newEarly]);
  assert.equal(timelineForObject(oldLate).time, 1000);
});

test('legacy object falls back to R2 upload time', () => {
  const legacy = { key: 'events/e/prints/old-photo.jpg', uploaded: new Date(1234) };

  assert.equal(timelineForObject(legacy).time, 1234);
});

test('same millisecond uses stable key tie break', () => {
  const a = { key: 'events/e/prints/c-1000-p001-photo.jpg', uploaded: new Date(9000) };
  const b = { key: 'events/e/prints/c-1000-p002-photo.jpg', uploaded: new Date(1000) };

  assert.deepEqual([b, a].sort(compareTimeline), [a, b]);
});

test('manage refresh keeps worker gallery order', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const refresh = page.slice(page.indexOf('async function refreshManagePhotos'), page.indexOf('function startManageAutoRefresh'));

  assert.match(refresh, /const nextPhotos = result\.data \|\| \[\];/);
  assert.match(refresh, /managePhotosData = nextPhotos;/);
  assert.doesNotMatch(refresh, /nextPhotos\.sort\(/);
});
