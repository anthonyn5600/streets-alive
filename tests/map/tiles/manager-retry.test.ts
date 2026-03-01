import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { TileManager } from '@/map/tiles/manager';

vi.mock('@/map/tiles/vector-tiles', () => ({
  bboxToTiles: vi.fn(() => [{ z: 14, x: 2811, y: 6541 }]),
  tileKey: vi.fn((t: { z: number; x: number; y: number }) => `${t.z}/${t.x}/${t.y}`),
  tileBBox: vi.fn(() => ({ south: 33.9, west: -118.3, north: 34.0, east: -118.2 })),
  fetchTileBuffer: vi.fn(() => Promise.reject(new Error('Network error'))),
  fetchTileData: vi.fn(),
  cacheSetDecoded: vi.fn(),
}));

vi.mock('@/map/tiles/geometry-cache', () => ({
  geometryCache: { get: vi.fn(() => null), set: vi.fn() },
  getGeometryCached: vi.fn(() => Promise.resolve(null)),
  putGeometryCached: vi.fn(() => Promise.resolve()),
  geometryIdbKey: vi.fn((k: string, z: number) => `${k}@z${z}@v1`),
}));

vi.mock('@/map/tiles/worker-pool', () => ({
  WorkerPool: class MockWorkerPool {
    postJob = vi.fn(() => Promise.reject(new Error('Worker error')));
    dispose = vi.fn();
  },
}));

vi.mock('@/map/projection', () => ({
  getProjectionConstants: vi.fn(() => ({ centerLat: 34.0522, centerLng: -118.2437, scale: 1 })),
}));

vi.mock('@/map/tiles/geometry.worker.ts?worker', () => {
  return { default: vi.fn() };
});

describe('TileManager retry backoff', () => {
  let manager: TileManager;
  let scene: THREE.Scene;

  beforeEach(() => {
    vi.useFakeTimers();
    scene = new THREE.Scene();
    manager = new TileManager(scene);
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const bbox = { south: 33.9, west: -118.3, north: 34.1, east: -118.1 };

  it('records failure and sets backoff after first error', async () => {
    manager.updateVisibleTiles(bbox, 14);
    // Let the processTile promise settle
    await vi.runAllTimersAsync();

    // Access internal state via casting
    const failedTiles = (manager as any).failedTiles as Map<string, { retries: number; nextRetryTime: number }>;
    expect(failedTiles.size).toBe(1);
    const entry = failedTiles.values().next().value!;
    expect(entry.retries).toBe(1);
  });

  it('skips tile during backoff window', async () => {
    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    const failedTiles = (manager as any).failedTiles as Map<string, { retries: number; nextRetryTime: number }>;
    expect(failedTiles.size).toBe(1);

    // Try again immediately -- should be skipped (within backoff)
    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    // Retries should still be 1 because it was skipped
    const entry = failedTiles.values().next().value!;
    expect(entry.retries).toBe(1);
  });

  it('retries after backoff window expires', async () => {
    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    const failedTiles = (manager as any).failedTiles as Map<string, { retries: number; nextRetryTime: number }>;
    expect(failedTiles.size).toBe(1);

    // Advance past the 1s initial backoff
    vi.advanceTimersByTime(1100);

    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    const entry = failedTiles.values().next().value!;
    expect(entry.retries).toBe(2);
  });

  it('permanently skips tile after MAX_RETRIES (5)', async () => {
    for (let i = 0; i < 5; i++) {
      // Advance past any backoff
      vi.advanceTimersByTime(120000);
      manager.updateVisibleTiles(bbox, 14);
      await vi.runAllTimersAsync();
    }

    const failedTiles = (manager as any).failedTiles as Map<string, { retries: number; nextRetryTime: number }>;
    const entry = failedTiles.values().next().value!;
    expect(entry.retries).toBe(5);

    // Try again after a long time -- should still skip
    vi.advanceTimersByTime(999999);
    const tilesBefore = (manager as any).tiles.size;
    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    // No new tile should have been created
    expect(entry.retries).toBe(5);
  });

  it('retryFailedTiles() clears tracking', async () => {
    manager.updateVisibleTiles(bbox, 14);
    await vi.runAllTimersAsync();

    const failedTiles = (manager as any).failedTiles as Map<string, unknown>;
    expect(failedTiles.size).toBe(1);

    manager.retryFailedTiles();
    expect(failedTiles.size).toBe(0);
  });

  it('backoff doubles each retry and caps at 60s', async () => {
    const failedTiles = (manager as any).failedTiles as Map<string, { retries: number; nextRetryTime: number }>;

    const expectedBackoffs = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(120000);
      const now = Date.now();
      manager.updateVisibleTiles(bbox, 14);
      await vi.runAllTimersAsync();

      const entry = failedTiles.values().next().value!;
      const actualBackoff = entry.nextRetryTime - now;
      // Allow small tolerance for timing
      expect(actualBackoff).toBeCloseTo(expectedBackoffs[i], -2);
    }
  });
});
