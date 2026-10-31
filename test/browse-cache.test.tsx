import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BrowseCache, BROWSE_TTL} from '../src/browseCache.js';
import type {History} from '../src/operations.js';

const history = (count = 1): History => ({
  items: Array.from({length: count}, (_, index) => ({
    id: 1000 - index,
    date: '',
    content: 'Synthetic',
    own: true,
    author: 'You',
  })),
  cursor: 1001 - count,
  more: false,
});

test('browse histories bound pages, retain a real cursor, use LRU and expire without extending freshness on navigation', () => {
  let now = 0;
  const cache = new BrowseCache(undefined, () => now);
  cache.save('large', history(400));
  assert.equal(cache.history('large')!.history.items.length, 300);
  assert.equal(cache.history('large')!.history.cursor, 701);
  assert.equal(cache.history('large')!.history.more, true);
  for (let i = 0; i < 19; i++) cache.save(String(i), history());
  cache.history('large');
  cache.save('new', history());
  assert.equal(cache.history('0'), undefined);
  now = BROWSE_TTL - 1;
  cache.position('large', 4);
  assert.equal(cache.history('large')!.index, 4);
  now++;
  assert.equal(cache.history('large'), undefined);
});

test('shared in-flight reads survive one consumer leaving, while invalidation and failed reads cannot repopulate the cache', async () => {
  const cache = new BrowseCache();
  let resolve!: (value: number) => void;
  let calls = 0;
  const first = {cancelled: false};
  const second = {cancelled: false};
  const load = async () => {
    calls++;
    return new Promise<number>((done) => {
      resolve = done;
    });
  };
  const a = cache.read('peer/thread/mine', load, first);
  await Promise.resolve();
  first.cancelled = true;
  const b = cache.read('peer/thread/mine', load, second);
  resolve(1);
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
  assert.equal(await cache.read('peer/thread/mine', load), 1);
  assert.equal(calls, 1);
  const late = cache.read('late', load);
  await Promise.resolve();
  cache.clear();
  resolve(2);
  await late;
  assert.equal(await cache.read('late', async () => 3), 3);
  await assert.rejects(
    cache.read('failed', async () => {
      throw new Error('Synthetic failure');
    }),
  );
  assert.equal(await cache.read('failed', async () => 4), 4);
});

test('preview caching separates original source objects and bounds decoded bytes', () => {
  let now = 0;
  const cache = new BrowseCache(undefined, () => now);
  const post = {},
    comment = {};
  const raster = {width: 512, height: 1024, data: new Uint8Array(2 * 1024 * 1024)};
  cache.savePreview(post, raster);
  assert.equal(cache.preview(comment), undefined);
  cache.savePreview(comment, raster);
  cache.preview(post);
  cache.savePreview({}, raster);
  assert.equal(cache.preview(comment), undefined);
  assert.equal(cache.preview(post), raster);
  now = BROWSE_TTL;
  assert.equal(cache.preview(post), undefined);
});
