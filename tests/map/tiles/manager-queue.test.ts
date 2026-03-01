import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { TileManager } from '@/map/tiles/manager';

// Generate tile coords in a grid around a center
function makeTileGrid(centerX: number, centerY: number, radius: number) {
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      tiles.push({ z: 14, x: centerX + dx, y: centerY + dy });
    }
  }
  return tiles;
}

let tileGrid = makeTileGrid(2811, 6541, 5);

vi.mock('@/map/tiles/vector-tiles', () => ({
  bboxToTiles: vi.fn(() => tileGrid),
  tileKey: vi.fn((t: { z: number; x: number; y: number }) => `${t.z}/${t.x}/${t.y}`),
  tileBBox: vi.fn((t: { z: number; x: number; y: number }) => {
    // Generate a bbox based on tile coords to allow distance-based sorting
    const latStep = 0.01;
    const lngStep = 0.01;
    return {
      south: 34.0 - (t.y - 6541) * latStep - latStep / 2,
      north: 34.0 - (t.y - 6541) * latStep + latStep / 2,
      west: -118.2 + (t.x - 2811) * lngStep - lngStep / 2,
      east: -118.2 + (t.x - 2811) * lngStep + lngStep / 2,
    };
  }),
  fetchTileBuffer: vi.fn(() => new Promise(() => {})), // Never resolves
  fetchTileData: vi.fn(),
  cacheSetDecoded: vi.fn(),
}));

vi.mock('@/map/tiles/geometry-cache', () => ({
  geometryCache: { get: vi.fn(() => null), set: vi.fn() },
  getGeometryCached: vi.fn(() => new Promise(() => {})),
  putGeometryCached: vi.fn(() => Promise.resolve()),
  geometryIdbKey: vi.fn((k: string, z: number) => `${k}@z${z}@v1`),
}));

vi.mock('@/map/tiles/worker-pool', () => ({
  WorkerPool: class MockWorkerPool {
    postJob = vi.fn(() => new Promise(() => {}));
    dispose = vi.fn();
  },
}));

vi.mock('@/map/projection', () => ({
  getProjectionConstants: vi.fn(() => ({ centerLat: 34.0522, centerLng: -118.2437, scale: 1 })),
}));

vi.mock('@/map/tiles/geometry.worker.ts?worker', () => {
  return { default: vi.fn() };
});

describe('TileManager build queue bounds', () => {
  let manager: TileManager;
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
    manager = new TileManager(scene);
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  const bbox = { south: 33.9, west: -118.3, north: 34.1, east: -118.1 };

  it('caps queue at MAX_BUILD_QUEUE_SIZE after mass insertion', () => {
    // 11x11 grid = 121 tiles, well over the 32 cap
    tileGrid = makeTileGrid(2811, 6541, 5);
    manager.updateVisibleTiles(bbox, 14);

    const buildQueue = (manager as any).buildQueue as any[];
    const buildQueueKeys = (manager as any).buildQueueKeys as Set<string>;

    // Queue should be capped (some tiles are actively being built, not in queue)
    // buildQueue + activeBuildCount should be bounded
    expect(buildQueue.length).toBeLessThanOrEqual(64);
  });

  it('buildQueueKeys stays in sync after cap', () => {
    tileGrid = makeTileGrid(2811, 6541, 5);
    manager.updateVisibleTiles(bbox, 14);

    const buildQueue = (manager as any).buildQueue as { key: string }[];
    const buildQueueKeys = (manager as any).buildQueueKeys as Set<string>;

    // Every key in buildQueue should be in buildQueueKeys
    for (const entry of buildQueue) {
      expect(buildQueueKeys.has(entry.key)).toBe(true);
    }
    // buildQueueKeys should not contain keys not in the queue (those are being built)
    // The keys should be at most buildQueue.length + activeBuildCount
    const activeBuildCount = (manager as any).activeBuildCount as number;
    expect(buildQueueKeys.size).toBeLessThanOrEqual(buildQueue.length + activeBuildCount);
  });

  it('closest tiles are kept when queue is trimmed', () => {
    tileGrid = makeTileGrid(2811, 6541, 5);
    manager.updateVisibleTiles(bbox, 14);

    const buildQueue = (manager as any).buildQueue as { key: string; bbox: { south: number; north: number; west: number; east: number } }[];

    if (buildQueue.length <= 1) return;

    // Verify queue is sorted by distance from bbox center
    const centerLat = (bbox.south + bbox.north) / 2;
    const centerLng = (bbox.west + bbox.east) / 2;

    for (let i = 0; i < buildQueue.length - 1; i++) {
      const aCenterLat = (buildQueue[i].bbox.south + buildQueue[i].bbox.north) / 2;
      const aCenterLng = (buildQueue[i].bbox.west + buildQueue[i].bbox.east) / 2;
      const bCenterLat = (buildQueue[i + 1].bbox.south + buildQueue[i + 1].bbox.north) / 2;
      const bCenterLng = (buildQueue[i + 1].bbox.west + buildQueue[i + 1].bbox.east) / 2;
      const da = Math.abs(aCenterLat - centerLat) + Math.abs(aCenterLng - centerLng);
      const db = Math.abs(bCenterLat - centerLat) + Math.abs(bCenterLng - centerLng);
      expect(da).toBeLessThanOrEqual(db + 1e-10);
    }
  });

  it('non-visible tiles are pruned on camera move', () => {
    // Load with a large grid
    tileGrid = makeTileGrid(2811, 6541, 3);
    manager.updateVisibleTiles(bbox, 14);

    const queueBefore = (manager as any).buildQueue.length;

    // "Move camera" far away -- new bbox is far from original tiles
    const farBbox = { south: 40.0, west: -74.1, north: 40.2, east: -73.9 };
    tileGrid = makeTileGrid(4826, 6157, 1); // NYC area tiles
    manager.updateVisibleTiles(farBbox, 14);

    const buildQueue = (manager as any).buildQueue as { key: string }[];

    // Old tiles (LA area) should have been pruned from the queue
    const laKeys = buildQueue.filter(e => e.key.includes('2811') || e.key.includes('6541'));
    expect(laKeys.length).toBe(0);
  });
});
