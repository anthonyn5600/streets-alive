import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openTileCache, getCachedPbf, putCachedPbf, evictOldTiles, _setDb, _getDb } from '@/map/tiles/vector-tiles';

describe('tile-cache', () => {
  beforeEach(() => {
    _setDb(null);
  });

  it('opens the database successfully', async () => {
    await openTileCache();
    expect(_getDb()).not.toBeNull();
  });

  it('round-trips put and get', async () => {
    await openTileCache();
    const key = '14/2811/6541';
    const data = new ArrayBuffer(8);
    new Uint8Array(data).set([1, 2, 3, 4, 5, 6, 7, 8]);

    await putCachedPbf(key, data);
    const result = await getCachedPbf(key);

    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('returns null for a missing key', async () => {
    await openTileCache();
    const result = await getCachedPbf('14/9999/9999');
    expect(result).toBeNull();
  });

  it('returns null for expired entries', async () => {
    await openTileCache();
    const db = _getDb()!;
    const key = '14/1000/2000';
    const data = new ArrayBuffer(4);

    // Write with old timestamp directly
    const tx = db.transaction('pbf-tiles', 'readwrite');
    const store = tx.objectStore('pbf-tiles');
    store.put({ key, data, timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 }); // 8 days ago
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });

    const result = await getCachedPbf(key);
    expect(result).toBeNull();
  });

  it('evicts old tiles', async () => {
    await openTileCache();
    const db = _getDb()!;

    // Insert one fresh and one old entry
    const tx = db.transaction('pbf-tiles', 'readwrite');
    const store = tx.objectStore('pbf-tiles');
    store.put({ key: 'old', data: new ArrayBuffer(1), timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000 });
    store.put({ key: 'fresh', data: new ArrayBuffer(1), timestamp: Date.now() });
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });

    await evictOldTiles();

    const freshResult = await getCachedPbf('fresh');
    const oldResult = await getCachedPbf('old');
    expect(freshResult).not.toBeNull();
    expect(oldResult).toBeNull();
  });

  it('degrades gracefully when db is null', async () => {
    // Don't open the db
    const getResult = await getCachedPbf('14/0/0');
    expect(getResult).toBeNull();

    // Should not throw
    await putCachedPbf('14/0/0', new ArrayBuffer(4));
    await evictOldTiles();
  });
});
