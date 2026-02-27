import * as THREE from 'three';
import type { BBox, BuildingData, RoadData, TileKey, TileState } from '../types';
import { fetchTileData, bboxToTiles, tileKey, tileBBox, type TileCoord } from './vector-tiles';
import { createBuildingMeshes } from '../buildings';
import { createRoadMeshes, disposeObject } from '../roads/renderer';
import { createRoadLabels } from '../roads/labels';

const MAX_TILES = 64;
const UNLOAD_DISTANCE_MULTIPLIER = 4;
const PREFETCH_MAX_CONCURRENT = 4;

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

  // Layer visibility
  showBuildings = true;
  showRoads = true;
  showLabels = true;

  heightMultiplier = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

  updateVisibleTiles(bbox: BBox, zoomLevel: number) {
    this.cancelPrefetch();
    this.lastVisibleBBox = bbox;

    const allTiles = bboxToTiles(bbox);

    // Safety: if too many tiles, skip (camera too far out)
    if (allTiles.length > MAX_TILES * 4) {
      return;
    }

    const visibleKeys = new Set<TileKey>();

    // Sort by distance from center (load center tiles first)
    const centerX = allTiles.reduce((s, t) => s + t.x, 0) / allTiles.length;
    const centerY = allTiles.reduce((s, t) => s + t.y, 0) / allTiles.length;
    allTiles.sort((a, b) => {
      const da = Math.abs(a.x - centerX) + Math.abs(a.y - centerY);
      const db = Math.abs(b.x - centerX) + Math.abs(b.y - centerY);
      return da - db;
    });

    // Cap to MAX_TILES
    const toLoad = allTiles.slice(0, MAX_TILES);

    for (const coord of toLoad) {
      const key = tileKey(coord);
      visibleKeys.add(key);

      if (!this.tiles.has(key)) {
        const bbox = tileBBox(coord);
        this.loadTile(key, bbox, zoomLevel, coord);
      }
    }

    // Unload distant tiles
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
  }

  private async loadTile(key: TileKey, bbox: BBox, zoomLevel: number, coord: TileCoord) {
    const abortController = new AbortController();
    const tile: TileState = {
      key,
      bbox,
      status: 'loading',
      buildings: null,
      roads: null,
      labels: null,
      roadData: null,
      buildingData: null,
      abortController,
    };

    this.tiles.set(key, tile);
    this.loadingCount++;
    this.onStateChange?.();

    try {
      const { buildings, roads } = await fetchTileData(coord, abortController.signal);

      // Check if tile was unloaded while loading
      if (!this.tiles.has(key)) {
        this.loadingCount--;
        this.onStateChange?.();
        return;
      }

      tile.roadData = roads;
      tile.buildingData = buildings;

      // Create building meshes
      const buildingMesh = createBuildingMeshes(buildings);
      if (buildingMesh) {
        const buildingGroup = new THREE.Group();
        buildingGroup.name = `buildings-${key}`;
        buildingGroup.add(buildingMesh);
        buildingGroup.visible = this.showBuildings;
        if (this.heightMultiplier !== 1) {
          buildingGroup.scale.y = this.heightMultiplier;
        }
        tile.buildings = buildingGroup;
        this.scene.add(buildingGroup);
      }

      // Create road meshes
      const roadResult = createRoadMeshes(roads, zoomLevel);
      const roadGroup = new THREE.Group();
      roadGroup.name = `roads-${key}`;
      if (roadResult.highwayMask) roadGroup.add(roadResult.highwayMask);
      if (roadResult.localCasing) roadGroup.add(roadResult.localCasing);
      if (roadResult.localFill) roadGroup.add(roadResult.localFill);
      if (roadResult.localCenterLine) roadGroup.add(roadResult.localCenterLine);
      if (roadResult.highwayShadow) roadGroup.add(roadResult.highwayShadow);
      if (roadResult.highwayCasing) roadGroup.add(roadResult.highwayCasing);
      if (roadResult.highwayFill) roadGroup.add(roadResult.highwayFill);
      if (roadResult.highwayCenterLine) roadGroup.add(roadResult.highwayCenterLine);
      if (roadGroup.children.length > 0) {
        roadGroup.visible = this.showRoads;
        tile.roads = roadGroup;
        this.scene.add(roadGroup);
      }

      // Create road labels
      const labelGroup = createRoadLabels(
        roads, zoomLevel, this.camera ?? undefined,
        this.canvasWidth || undefined, this.canvasHeight || undefined
      );
      if (labelGroup.children.length > 0) {
        labelGroup.visible = this.showLabels;
        tile.labels = labelGroup;
        this.scene.add(labelGroup);
      }

      tile.status = 'loaded';
      this.roadDataVersion++;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Tile was cancelled
      } else {
        console.warn(`Failed to load tile ${key}:`, err);
        tile.status = 'error';
      }
    }

    this.loadingCount--;
    this.onStateChange?.();

    if (this.loadingCount === 0 && this.lastVisibleBBox) {
      this.schedulePrefetch(this.lastVisibleBBox);
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
      // Fallback for environments without requestIdleCallback
      this.prefetchIdleId = setTimeout(() => this.runPrefetch(bbox), 200) as unknown as number;
      return;
    }
    this.prefetchIdleId = requestIdleCallback(() => this.runPrefetch(bbox));
  }

  private async runPrefetch(bbox: BBox) {
    this.prefetchIdleId = null;
    const expand = 0.024; // ~2 tile widths at z14 / LA latitude
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

    // Fetch in batches of PREFETCH_MAX_CONCURRENT
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

    if (tile.buildings) {
      this.scene.remove(tile.buildings);
      disposeObject(tile.buildings);
    }
    if (tile.roads) {
      this.scene.remove(tile.roads);
      disposeObject(tile.roads);
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
      const group = layer === 'buildings' ? tile.buildings
        : layer === 'roads' ? tile.roads
          : tile.labels;
      if (group) group.visible = visible;
    }
  }

  setHeightMultiplier(mult: number) {
    this.heightMultiplier = mult;
    for (const tile of this.tiles.values()) {
      if (tile.buildings) {
        tile.buildings.scale.y = mult;
      }
    }
  }

  dispose() {
    this.cancelPrefetch();
    for (const key of Array.from(this.tiles.keys())) {
      this.unloadTile(key);
    }
  }
}
