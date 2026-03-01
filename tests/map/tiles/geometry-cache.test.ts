import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openGeometryCache,
  getGeometryCached,
  putGeometryCached,
  evictOldGeometry,
  evictExcessGeometry,
  _setGeoDB,
  _getGeoDB,
} from '@/map/tiles/geometry-cache';
import type { CachedTileGeometry } from '@/map/tiles/geometry-cache';

const STORE_NAME = 'geometry';

function makeDummyGeometry(): CachedTileGeometry {
  return {
    buildings: null,
    roads: {
      localCasing: [],
      localFill: [],
      localCenterLine: null,
      hwMask: null,
      hwShadow: null,
      hwCasing: [],
      hwFill: [],
      hwCenterLine: null,
    },
    labelPlacements: null,
  };
}

describe('geometry-cache IndexedDB', () => {
  beforeEach(() => {
    _setGeoDB(null);
  });

  it('opens the database successfully', async () => {
    await openGeometryCache();
    expect(_getGeoDB()).not.toBeNull();
  });

  it('round-trips put and get', async () => {
    await openGeometryCache();
    const key = '14/2811/6541@z14@v1';
    const data = makeDummyGeometry();

    await putGeometryCached(key, data);
    const result = await getGeometryCached(key);

    expect(result).not.toBeNull();
    expect(result!.buildings).toBeNull();
  });

  it('returns null for expired entries', async () => {
    await openGeometryCache();
    const db = _getGeoDB()!;
    const key = 'expired@z14@v1';

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, data: makeDummyGeometry(), timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });

    const result = await getGeometryCached(key);
    expect(result).toBeNull();
  });

  it('stale read deletes expired entry from IDB', async () => {
    await openGeometryCache();
    const db = _getGeoDB()!;
    const key = 'stale-delete@z14@v1';

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ key, data: makeDummyGeometry(), timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });

    // This read should trigger deletion
    await getGeometryCached(key);

    // Give the fire-and-forget delete time to complete
    await new Promise(r => setTimeout(r, 50));

    // Verify the entry was deleted by checking directly
    const checkTx = db.transaction(STORE_NAME, 'readonly');
    const checkStore = checkTx.objectStore(STORE_NAME);
    const checkReq = checkStore.get(key);
    const exists = await new Promise<boolean>(resolve => {
      checkReq.onsuccess = () => resolve(checkReq.result != null);
      checkReq.onerror = () => resolve(false);
    });

    expect(exists).toBe(false);
  });

  it('evictExcessGeometry keeps only newest entries', async () => {
    await openGeometryCache();
    const db = _getGeoDB()!;

    // Clear any leftover entries from previous tests
    const clearTx = db.transaction(STORE_NAME, 'readwrite');
    clearTx.objectStore(STORE_NAME).clear();
    await new Promise<void>(resolve => { clearTx.oncomplete = () => resolve(); });

    // Insert 5 entries with different timestamps
    for (let i = 0; i < 5; i++) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key: `entry-${i}@z14@v1`, data: makeDummyGeometry(), timestamp: Date.now() - (5 - i) * 1000 });
      await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    }

    await evictExcessGeometry(2);

    // Count remaining entries
    const countTx = db.transaction(STORE_NAME, 'readonly');
    const countStore = countTx.objectStore(STORE_NAME);
    const countReq = countStore.count();
    const count = await new Promise<number>(resolve => {
      countReq.onsuccess = () => resolve(countReq.result);
    });

    expect(count).toBe(2);

    // The newest 2 should remain (entry-3 and entry-4)
    const result3 = await getGeometryCached('entry-3@z14@v1');
    const result4 = await getGeometryCached('entry-4@z14@v1');
    expect(result3).not.toBeNull();
    expect(result4).not.toBeNull();
  });

  it('evictExcessGeometry on empty DB is a no-op', async () => {
    await openGeometryCache();
    // Should not throw
    await evictExcessGeometry(2);
  });

  it('degrades gracefully when geoDB is null', async () => {
    // Don't open the db
    const result = await getGeometryCached('any-key');
    expect(result).toBeNull();

    await putGeometryCached('any-key', makeDummyGeometry());
    await evictOldGeometry();
    await evictExcessGeometry();
  });
});
