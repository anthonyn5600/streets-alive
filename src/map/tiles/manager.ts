import * as THREE from 'three';
import type { BBox, BuildingData, RoadData, TileKey, TileState } from '../types';
import { fetchTileData, fetchTileBuffer, cacheSetDecoded, bboxToTiles, tileKey, tileBBox, type TileCoord } from './vector-tiles';
import { createRoadMeshesFromArrays, disposeObject } from '../roads/renderer';
import { createBuildingMeshFromArrays } from '../buildings';
import { createRoadLabelsFromPlacements } from '../roads/labels';
import { geometryCache, getGeometryCached, putGeometryCached, geometryIdbKey } from './geometry-cache';
import { getProjectionConstants } from '../projection';
import { WorkerPool } from './worker-pool';
import type { CachedTileGeometry } from './geometry-cache';
import GeometryWorker from './geometry.worker.ts?worker';

interface TileTiming {
  key: string;
  timestamp: number;
  cacheHit: boolean;
  fetchMs: number;
  geometryBuildMs: number;
  meshCreationMs: number;
  totalMs: number;
}

const MAX_TILES = 128;
const MAX_TIMINGS = 256;
const UNLOAD_DISTANCE_MULTIPLIER = 2;
const PREFETCH_MAX_CONCURRENT = 4;
const MAX_CONCURRENT_TILE_BUILDS = 8;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;
const MAX_BUILD_QUEUE_SIZE = 64;

const BUILDING_DEFAULT_COLOR = new THREE.Color(0xd4d0c8);

function geometryCacheKey(tileK: TileKey, zoomLevel: number): string {
  return `${tileK}@z${Math.floor(zoomLevel)}`;
}

export class TileManager {
  private tiles = new Map<TileKey, TileState>();
  private scene: THREE.Scene;
  private camera: THREE.Camera | null = null;
  private loadingCount = 0;
  private onStateChange: (() => void) | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private roadDataVersion = 0;
  private prefetchController: AbortController | null = null;
  private prefetchIdleId: number | null = null;
  private lastVisibleBBox: { south: number; west: number; north: number; east: number } | null = null;
  private lastZoomLevel = 0;
  private buildQueue: Array<{ key: TileKey; bbox: BBox; zoomLevel: number; coord: TileCoord }> = [];
  private buildQueueKeys = new Set<TileKey>();
  private activeBuildCount = 0;
  private tileTimings: TileTiming[] = [];
  private workerPool: WorkerPool;
  private meshCreationQueue: Array<{ key: TileKey; cached: CachedTileGeometry; tFetch: number; t0: number; cacheHit: boolean; tGeometry: number }> = [];
  private failedTiles = new Map<TileKey, { retries: number; nextRetryTime: number }>();

  // Layer visibility
  showBuildings = true;
  showRoads = true;
  showLabels = true;

  heightMultiplier = 1;
  private buildingColorMap: Map<number, THREE.Color> | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.workerPool = new WorkerPool(() => new GeometryWorker());
  }

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  setCanvasSize(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  setOnStateChange(cb: () => void) {
    this.onStateChange = cb;
  }

  getLoadingCount(): number {
    return this.loadingCount;
  }

  getTotalTileCount(): number {
    return this.tiles.size;
  }

  getLoadedTileCount(): number {
    let count = 0;
    for (const tile of this.tiles.values()) {
      if (tile.status === 'loaded') count++;
    }
    return count;
  }

  getPerformanceLog(): TileTiming[] {
    return this.tileTimings.slice();
  }

  private recordTiming(timing: TileTiming) {
    this.tileTimings.push(timing);
    if (this.tileTimings.length > MAX_TIMINGS) {
      this.tileTimings.splice(0, this.tileTimings.length - MAX_TIMINGS);
    }
  }

  private logBatchSummary() {
    if (this.tileTimings.length === 0) return;
    const recent = this.tileTimings.slice(-20);
    const totals = recent.map(t => t.totalMs).sort((a, b) => a - b);
    const avg = totals.reduce((s, v) => s + v, 0) / totals.length;
    const p95 = totals[Math.floor(totals.length * 0.95)] ?? totals[totals.length - 1];
    const max = totals[totals.length - 1];
    const hits = recent.filter(t => t.cacheHit).length;
    console.log(
      `[TilePerf] batch done: ${recent.length} tiles, ${hits} cache hits | avg=${avg.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`
    );
  }

  updateVisibleTiles(bbox: BBox, zoomLevel: number) {
    this.cancelPrefetch();
    this.lastVisibleBBox = bbox;
    this.lastZoomLevel = zoomLevel;

    this.pruneInvisibleFromQueue(bbox);

    const allTiles = bboxToTiles(bbox);

    if (allTiles.length > MAX_TILES * 4) {
      return;
    }

    const visibleKeys = new Set<TileKey>();

    const centerX = allTiles.reduce((s, t) => s + t.x, 0) / allTiles.length;
    const centerY = allTiles.reduce((s, t) => s + t.y, 0) / allTiles.length;
    allTiles.sort((a, b) => {
      const da = Math.abs(a.x - centerX) + Math.abs(a.y - centerY);
      const db = Math.abs(b.x - centerX) + Math.abs(b.y - centerY);
      return da - db;
    });

    const toLoad = allTiles.slice(0, MAX_TILES);

    for (const coord of toLoad) {
      const key = tileKey(coord);
      visibleKeys.add(key);

      const failed = this.failedTiles.get(key);
      if (failed) {
        if (failed.retries >= MAX_RETRIES) continue;
        if (Date.now() < failed.nextRetryTime) continue;
      }

      const existing = this.tiles.get(key);
      if (!existing) {
        const bbox = tileBBox(coord);
        this.loadTile(key, bbox, zoomLevel, coord);
      } else if (existing.status === 'error') {
        this.tiles.delete(key);
        const bbox = tileBBox(coord);
        this.loadTile(key, bbox, zoomLevel, coord);
      }
    }

    const centerLat = (bbox.south + bbox.north) / 2;
    const centerLng = (bbox.west + bbox.east) / 2;
    const viewWidth = bbox.east - bbox.west;
    const viewHeight = bbox.north - bbox.south;
    const threshold = Math.max(viewWidth, viewHeight) * UNLOAD_DISTANCE_MULTIPLIER;

    for (const [key, tile] of this.tiles) {
      if (visibleKeys.has(key)) continue;

      const tileCenterLat = (tile.bbox.south + tile.bbox.north) / 2;
      const tileCenterLng = (tile.bbox.west + tile.bbox.east) / 2;
      const dist = Math.sqrt(
        Math.pow(tileCenterLat - centerLat, 2) +
        Math.pow(tileCenterLng - centerLng, 2)
      );

      if (dist > threshold) {
        this.unloadTile(key);
      }
    }

    this.sortQueueByDistance(bbox);
  }

  private pruneInvisibleFromQueue(bbox: BBox) {
    if (this.buildQueue.length === 0) return;
    const expandedBBox = {
      south: bbox.south - (bbox.north - bbox.south) * 0.25,
      north: bbox.north + (bbox.north - bbox.south) * 0.25,
      west: bbox.west - (bbox.east - bbox.west) * 0.25,
      east: bbox.east + (bbox.east - bbox.west) * 0.25,
    };
    const keep: typeof this.buildQueue = [];
    for (const entry of this.buildQueue) {
      const tileCenterLat = (entry.bbox.south + entry.bbox.north) / 2;
      const tileCenterLng = (entry.bbox.west + entry.bbox.east) / 2;
      if (
        tileCenterLat >= expandedBBox.south && tileCenterLat <= expandedBBox.north &&
        tileCenterLng >= expandedBBox.west && tileCenterLng <= expandedBBox.east
      ) {
        keep.push(entry);
      } else {
        this.buildQueueKeys.delete(entry.key);
        const t = this.tiles.get(entry.key);
        if (t) {
          t.abortController.abort();
          this.tiles.delete(entry.key);
          this.loadingCount--;
        }
      }
    }
    this.buildQueue.length = 0;
    this.buildQueue.push(...keep);
  }

  private sortQueueByDistance(bbox: BBox) {
    if (this.buildQueue.length <= 1) return;
    const centerLat = (bbox.south + bbox.north) / 2;
    const centerLng = (bbox.west + bbox.east) / 2;
    this.buildQueue.sort((a, b) => {
      const aCenterLat = (a.bbox.south + a.bbox.north) / 2;
      const aCenterLng = (a.bbox.west + a.bbox.east) / 2;
      const bCenterLat = (b.bbox.south + b.bbox.north) / 2;
      const bCenterLng = (b.bbox.west + b.bbox.east) / 2;
      const da = Math.abs(aCenterLat - centerLat) + Math.abs(aCenterLng - centerLng);
      const db = Math.abs(bCenterLat - centerLat) + Math.abs(bCenterLng - centerLng);
      return da - db;
    });
  }

  private loadTile(key: TileKey, bbox: BBox, zoomLevel: number, coord: TileCoord) {
    const abortController = new AbortController();
    const tile: TileState = {
      key,
      bbox,
      status: 'loading',
      labels: null,
      roadData: null,
      buildingData: null,
      abortController,
      meshGroup: null,
      buildingMesh: null,
      buildingVertexRanges: null,
      roadMeshes: null,
    };

    this.tiles.set(key, tile);
    this.loadingCount++;
    this.onStateChange?.();

    if (this.buildQueueKeys.has(key)) return;
    this.buildQueueKeys.add(key);
    this.buildQueue.push({ key, bbox, zoomLevel, coord });

    if (this.buildQueue.length > MAX_BUILD_QUEUE_SIZE && this.lastVisibleBBox) {
      this.sortQueueByDistance(this.lastVisibleBBox);
      const removed = this.buildQueue.splice(MAX_BUILD_QUEUE_SIZE);
      for (const entry of removed) {
        this.buildQueueKeys.delete(entry.key);
        const t = this.tiles.get(entry.key);
        if (t) {
          t.abortController.abort();
          this.tiles.delete(entry.key);
          this.loadingCount--;
        }
      }
    }

    this.drainBuildQueue();
  }

  private drainBuildQueue() {
    while (this.buildQueue.length > 0 && this.activeBuildCount < MAX_CONCURRENT_TILE_BUILDS) {
      const item = this.buildQueue.shift()!;
      this.activeBuildCount++;
      this.processTile(item.key, item.zoomLevel, item.coord).finally(() => {
        this.activeBuildCount--;
        this.drainBuildQueue();
      });
    }
  }

  private async processTile(key: TileKey, zoomLevel: number, coord: TileCoord) {
    this.buildQueueKeys.delete(key);

    const tile = this.tiles.get(key);
    if (!tile || tile.status !== 'loading') {
      this.loadingCount--;
      this.onStateChange?.();
      return;
    }

    const t0 = performance.now();

    try {
      const cacheKey = geometryCacheKey(key, zoomLevel);
      const idbKey = geometryIdbKey(key, zoomLevel);
      let cached = geometryCache.get(cacheKey);

      const [buffer, idbCached] = await Promise.all([
        fetchTileBuffer(coord, tile.abortController.signal),
        cached ? Promise.resolve(null) : getGeometryCached(idbKey),
      ]);

      const tFetch = performance.now();

      if (!this.tiles.has(key)) {
        this.loadingCount--;
        this.onStateChange?.();
        return;
      }

      let cacheHit = true;
      let tGeometry = performance.now();

      if (!cached && idbCached) {
        console.log(`[geometry-cache] ${key}: hit (from IDB)`);
        cached = idbCached;
        geometryCache.set(cacheKey, cached);
      }

      if (!cached) {
        // Cold path: transfer raw buffer to worker for decode + geometry build
        cacheHit = false;

        const projection = getProjectionConstants();
        const buildingColor = {
          r: BUILDING_DEFAULT_COLOR.r,
          g: BUILDING_DEFAULT_COLOR.g,
          b: BUILDING_DEFAULT_COLOR.b,
        };

        const result = await this.workerPool.postJob({
          buffer,
          tileCoord: coord,
          zoomLevel,
          projection,
          buildingColor,
        });

        tGeometry = performance.now();

        if (!this.tiles.has(key)) {
          this.loadingCount--;
          this.onStateChange?.();
          return;
        }

        tile.roadData = result.decodedRoads;
        tile.buildingData = result.decodedBuildings;
        cacheSetDecoded(key, { buildings: result.decodedBuildings, roads: result.decodedRoads });

        cached = {
          buildings: result.buildings,
          roads: result.roads,
          labelPlacements: result.labelPlacements,
        };
        geometryCache.set(cacheKey, cached);
        putGeometryCached(idbKey, cached).catch(() => {});
      } else {
        // Warm path: geometry cached, decode in worker to avoid main thread block
        const decoded = await this.workerPool.postDecodeJob({ buffer, tileCoord: coord });
        tile.roadData = decoded.decodedRoads;
        tile.buildingData = decoded.decodedBuildings;
        cacheSetDecoded(key, { buildings: decoded.decodedBuildings, roads: decoded.decodedRoads });
      }

      this.meshCreationQueue.push({ key, cached, tFetch, t0, cacheHit, tGeometry });

    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Tile was cancelled
      } else {
        console.warn(`Failed to load tile ${key}:`, err);
        tile.status = 'error';
        const prev = this.failedTiles.get(key);
        const retries = (prev?.retries ?? 0) + 1;
        const backoff = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, retries - 1), MAX_BACKOFF_MS);
        this.failedTiles.set(key, { retries, nextRetryTime: Date.now() + backoff });
      }
      this.loadingCount--;
      this.onStateChange?.();

      if (this.loadingCount === 0) {
        this.logBatchSummary();
        if (this.lastVisibleBBox) {
          this.schedulePrefetch(this.lastVisibleBBox);
        }
      }
    }
  }

  drainMeshQueue() {
    const MAX_PER_FRAME = 2;
    let processed = 0;
    let anyProcessed = false;

    while (this.meshCreationQueue.length > 0 && processed < MAX_PER_FRAME) {
      const item = this.meshCreationQueue.shift()!;
      const { key, cached, tFetch, t0, cacheHit, tGeometry } = item;

      const tile = this.tiles.get(key);
      if (!tile || tile.status !== 'loading') {
        this.loadingCount--;
        continue;
      }

      const tMeshStart = performance.now();

      const group = new THREE.Group();
      group.name = `tile-${key}`;

      if (cached.buildings) {
        const buildingMesh = createBuildingMeshFromArrays(cached.buildings, this.buildingColorMap ?? undefined);
        buildingMesh.visible = this.showBuildings;
        buildingMesh.scale.y = this.heightMultiplier;
        group.add(buildingMesh);
        tile.buildingMesh = buildingMesh;
        tile.buildingVertexRanges = cached.buildings.vertexRanges;
      }

      const roadMeshes = createRoadMeshesFromArrays(cached.roads);
      tile.roadMeshes = roadMeshes;
      for (const obj of Object.values(roadMeshes)) {
        if (obj) {
          (obj as THREE.Object3D).visible = this.showRoads;
          group.add(obj as THREE.Object3D);
        }
      }

      tile.meshGroup = group;
      this.scene.add(group);

      const labelGroup = createRoadLabelsFromPlacements(
        cached.labelPlacements ?? [], this.camera ?? undefined,
        this.canvasWidth || undefined, this.canvasHeight || undefined
      );
      if (labelGroup.children.length > 0) {
        labelGroup.visible = this.showLabels;
        tile.labels = labelGroup;
        this.scene.add(labelGroup);
      }

      const tEnd = performance.now();
      this.recordTiming({
        key,
        timestamp: t0,
        cacheHit,
        fetchMs: tFetch - t0,
        geometryBuildMs: cacheHit ? 0 : tGeometry - tFetch,
        meshCreationMs: tEnd - tMeshStart,
        totalMs: tEnd - t0,
      });

      tile.status = 'loaded';
      this.loadingCount--;
      processed++;
      anyProcessed = true;

      if (this.loadingCount === 0) {
        this.logBatchSummary();
        if (this.lastVisibleBBox) {
          this.schedulePrefetch(this.lastVisibleBBox);
        }
      }
    }

    if (anyProcessed) {
      this.roadDataVersion++;
      this.onStateChange?.();
    }
  }

  private cancelPrefetch() {
    if (this.prefetchController) {
      this.prefetchController.abort();
      this.prefetchController = null;
    }
    if (this.prefetchIdleId !== null) {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(this.prefetchIdleId);
      } else {
        clearTimeout(this.prefetchIdleId);
      }
      this.prefetchIdleId = null;
    }
  }

  private schedulePrefetch(bbox: BBox) {
    if (typeof requestIdleCallback === 'undefined') {
      this.prefetchIdleId = setTimeout(() => this.runPrefetch(bbox), 200) as unknown as number;
      return;
    }
    this.prefetchIdleId = requestIdleCallback(() => this.runPrefetch(bbox));
  }

  private async runPrefetch(bbox: BBox) {
    this.prefetchIdleId = null;
    const expand = 0.024;
    const expandedBBox: BBox = {
      south: bbox.south - expand,
      west: bbox.west - expand,
      north: bbox.north + expand,
      east: bbox.east + expand,
    };

    const expandedTiles = bboxToTiles(expandedBBox);
    const loadedKeys = new Set(this.tiles.keys());
    const toFetch = expandedTiles.filter(t => !loadedKeys.has(tileKey(t)));
    if (toFetch.length === 0) return;

    this.prefetchController = new AbortController();
    const signal = this.prefetchController.signal;

    for (let i = 0; i < toFetch.length; i += PREFETCH_MAX_CONCURRENT) {
      if (signal.aborted) break;
      const batch = toFetch.slice(i, i + PREFETCH_MAX_CONCURRENT);
      await Promise.allSettled(
        batch.map(coord => fetchTileData(coord, signal).catch(() => {}))
      );
    }
  }

  private unloadTile(key: TileKey) {
    const tile = this.tiles.get(key);
    if (!tile) return;

    tile.abortController.abort();

    if (tile.meshGroup) {
      this.scene.remove(tile.meshGroup);
      disposeObject(tile.meshGroup);
    }

    if (tile.labels) {
      this.scene.remove(tile.labels);
      disposeObject(tile.labels);
    }

    this.tiles.delete(key);
    this.roadDataVersion++;
  }

  getRoadDataVersion(): number {
    return this.roadDataVersion;
  }

  getAllRoadData(): RoadData[] {
    const allRoads: RoadData[] = [];
    for (const tile of this.tiles.values()) {
      if (tile.roadData) allRoads.push(...tile.roadData);
    }
    return allRoads;
  }

  getAllBuildingData(): BuildingData[] {
    const all: BuildingData[] = [];
    for (const tile of this.tiles.values()) {
      if (tile.buildingData) all.push(...tile.buildingData);
    }
    return all;
  }

  setLayerVisibility(layer: 'buildings' | 'roads' | 'labels', visible: boolean) {
    if (layer === 'buildings') this.showBuildings = visible;
    else if (layer === 'roads') this.showRoads = visible;
    else if (layer === 'labels') this.showLabels = visible;

    for (const tile of this.tiles.values()) {
      if (layer === 'buildings' && tile.buildingMesh) {
        tile.buildingMesh.visible = visible;
      }
      if (layer === 'roads' && tile.roadMeshes) {
        for (const obj of Object.values(tile.roadMeshes)) {
          if (obj) (obj as THREE.Object3D).visible = visible;
        }
      }
      if (layer === 'labels' && tile.labels) {
        tile.labels.visible = visible;
      }
    }
  }

  setHeightMultiplier(mult: number) {
    this.heightMultiplier = mult;
    for (const tile of this.tiles.values()) {
      if (tile.buildingMesh) tile.buildingMesh.scale.y = mult;
    }
  }

  setBuildingColorMap(colorMap: Map<number, THREE.Color>) {
    this.buildingColorMap = colorMap;
    for (const tile of this.tiles.values()) {
      if (!tile.buildingMesh || !tile.buildingVertexRanges) continue;
      const colAttr = tile.buildingMesh.geometry.attributes.color as THREE.BufferAttribute;
      const colors = colAttr.array as Float32Array;
      for (const range of tile.buildingVertexRanges) {
        const color = colorMap.get(range.buildingId) ?? BUILDING_DEFAULT_COLOR;
        const r = color.r, g = color.g, b = color.b;
        for (let v = range.startVertex; v < range.startVertex + range.vertexCount; v++) {
          colors[v * 3] = r;
          colors[v * 3 + 1] = g;
          colors[v * 3 + 2] = b;
        }
      }
      colAttr.needsUpdate = true;
    }
  }

  getTileEntries(): IterableIterator<[TileKey, TileState]> {
    return this.tiles.entries();
  }

  retryFailedTiles() {
    this.failedTiles.clear();
  }

  dispose() {
    this.cancelPrefetch();
    this.buildQueue.length = 0;
    this.buildQueueKeys.clear();
    this.meshCreationQueue.length = 0;
    this.failedTiles.clear();
    this.workerPool.dispose();
    for (const key of Array.from(this.tiles.keys())) {
      this.unloadTile(key);
    }
  }
}
