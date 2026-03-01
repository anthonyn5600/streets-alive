import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openTileCache, getCachedPbf, putCachedPbf, evictOldTiles, evictExcessTiles, _setDb, _getDb } from '@/map/tiles/vector-tiles';

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

  it('overwrites existing key with new data', async () => {
    await openTileCache();
    const key = '14/5000/5000';

    const data1 = new ArrayBuffer(4);
    new Uint8Array(data1).set([1, 2, 3, 4]);
    await putCachedPbf(key, data1);

    const data2 = new ArrayBuffer(4);
    new Uint8Array(data2).set([5, 6, 7, 8]);
    await putCachedPbf(key, data2);

    const result = await getCachedPbf(key);
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([5, 6, 7, 8]));
  });

  it('degrades gracefully when db is null', async () => {
    // Don't open the db
    const getResult = await getCachedPbf('14/0/0');
    expect(getResult).toBeNull();

    // Should not throw
    await putCachedPbf('14/0/0', new ArrayBuffer(4));
    await evictOldTiles();
    await evictExcessTiles();
  });

  it('stale read deletes expired entry from IDB', async () => {
    await openTileCache();
    const db = _getDb()!;
    const key = '14/7777/8888';

    const tx = db.transaction('pbf-tiles', 'readwrite');
    const store = tx.objectStore('pbf-tiles');
    store.put({ key, data: new ArrayBuffer(4), timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });

    // This should return null and fire-and-forget delete the entry
    const result = await getCachedPbf(key);
    expect(result).toBeNull();

    // Give the fire-and-forget delete time
    await new Promise(r => setTimeout(r, 50));

    // Verify it was deleted
    const checkTx = db.transaction('pbf-tiles', 'readonly');
    const checkStore = checkTx.objectStore('pbf-tiles');
    const checkReq = checkStore.get(key);
    const exists = await new Promise<boolean>(resolve => {
      checkReq.onsuccess = () => resolve(checkReq.result != null);
      checkReq.onerror = () => resolve(false);
    });
    expect(exists).toBe(false);
  });

  it('evictExcessTiles keeps only newest entries', async () => {
    await openTileCache();
    const db = _getDb()!;

    // Clear any leftover entries from previous tests
    const clearTx = db.transaction('pbf-tiles', 'readwrite');
    clearTx.objectStore('pbf-tiles').clear();
    await new Promise<void>(resolve => { clearTx.oncomplete = () => resolve(); });

    // Insert 5 entries with staggered timestamps
    for (let i = 0; i < 5; i++) {
      const tx = db.transaction('pbf-tiles', 'readwrite');
      const store = tx.objectStore('pbf-tiles');
      store.put({ key: `excess-${i}`, data: new ArrayBuffer(1), timestamp: Date.now() - (5 - i) * 1000 });
      await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    }

    await evictExcessTiles(2);

    // Count remaining
    const countTx = db.transaction('pbf-tiles', 'readonly');
    const countStore = countTx.objectStore('pbf-tiles');
    const countReq = countStore.count();
    const count = await new Promise<number>(resolve => {
      countReq.onsuccess = () => resolve(countReq.result);
    });
    expect(count).toBe(2);

    // The newest 2 should remain
    const result3 = await getCachedPbf('excess-3');
    const result4 = await getCachedPbf('excess-4');
    expect(result3).not.toBeNull();
    expect(result4).not.toBeNull();
  });

  it('evictExcessTiles on empty DB is a no-op', async () => {
    await openTileCache();
    await evictExcessTiles(2);
  });
});
