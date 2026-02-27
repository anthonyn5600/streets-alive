import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { BuildingData, RoadData } from '../types';

// --- Persistent tile cache (IndexedDB) ---

const DB_NAME = 'tile-cache';
const STORE_NAME = 'pbf-tiles';
const DB_VERSION = 1;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let db: IDBDatabase | null = null;

export function openTileCache(): Promise<void> {
  if (db) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        db = request.result;
        resolve();
      };

      request.onerror = () => {
        console.warn('[tile-cache] Failed to open IndexedDB:', request.error);
        resolve();
      };
    } catch {
      // Private browsing or IndexedDB unavailable
      resolve();
    }
  });
}

export function getCachedPbf(key: string): Promise<ArrayBuffer | null> {
  if (!db) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as { key: string; data: ArrayBuffer; timestamp: number } | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > DEFAULT_TTL_MS) {
          resolve(null);
          return;
        }
        resolve(entry.data);
      };

      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function putCachedPbf(key: string, data: ArrayBuffer): Promise<void> {
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function evictOldTiles(maxAgeMs: number = DEFAULT_TTL_MS): Promise<void> {
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      const cutoff = Date.now() - maxAgeMs;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const entry = cursor.value as { timestamp: number };
        if (entry.timestamp < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      };

      request.onerror = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Exposed for testing only */
export function _setDb(database: IDBDatabase | null) {
  db = database;
}

/** Exposed for testing only */
export function _getDb(): IDBDatabase | null {
  return db;
}

// --- Tile coordinate types & math ---

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

const ZOOM = 14;

export function latLngToTile(lat: number, lng: number, z: number = ZOOM): TileCoord {
  const n = Math.pow(2, z);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { z, x, y };
}

export function tileKey(t: TileCoord): string {
  return `${t.z}/${t.x}/${t.y}`;
}

export function tileBBox(t: TileCoord): { south: number; west: number; north: number; east: number } {
  const n = Math.pow(2, t.z);
  const west = (t.x / n) * 360 - 180;
  const east = ((t.x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * t.y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + 1)) / n))) * 180) / Math.PI;
  return { south, west, north, east };
}

export function bboxToTiles(bbox: { south: number; west: number; north: number; east: number }): TileCoord[] {
  const topLeft = latLngToTile(bbox.north, bbox.west, ZOOM);
  const bottomRight = latLngToTile(bbox.south, bbox.east, ZOOM);

  const tiles: TileCoord[] = [];
  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      tiles.push({ z: ZOOM, x, y });
    }
  }
  return tiles;
}

// --- Tile URL / TileJSON ---

let tileUrlTemplate: string | null = null;
let tileJsonPromise: Promise<void> | null = null;

async function ensureTileUrl(): Promise<string> {
  if (tileUrlTemplate) return tileUrlTemplate;
  if (!tileJsonPromise) {
    tileJsonPromise = (async () => {
      try {
        const resp = await fetch('https://tiles.openfreemap.org/planet');
        const json = await resp.json();
        // TileJSON has tiles array like ["https://tiles.openfreemap.org/planet/20260218_001001_pt/{z}/{x}/{y}.pbf"]
        if (json.tiles && json.tiles.length > 0) {
          tileUrlTemplate = json.tiles[0];
        }
      } catch (err) {
        console.warn('[vector-tiles] Failed to fetch TileJSON, using fallback URL', err);
      }
      if (!tileUrlTemplate) {
        // Fallback — will work until the date path changes
        tileUrlTemplate = 'https://tiles.openfreemap.org/planet/20260218_001001_pt/{z}/{x}/{y}.pbf';
      }
    })();
  }
  await tileJsonPromise;
  return tileUrlTemplate!;
}

// --- LRU cache ---

const CACHE_MAX = 200;
const cache = new Map<string, { buildings: BuildingData[]; roads: RoadData[] }>();

function cacheGet(key: string) {
  const val = cache.get(key);
  if (val) {
    // Move to end (most recently used)
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: { buildings: BuildingData[]; roads: RoadData[] }) {
  if (cache.size >= CACHE_MAX) {
    // Delete oldest entry
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(key, val);
}

// --- Seeded random (same as old overpass.ts) ---

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

// --- Highway class mapping ---

const CLASS_MAP: Record<string, string> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'residential',
  service: 'service',
  path: 'path',
  residential: 'residential',
};

const SUBCLASS_OVERRIDE: Record<string, string> = {
  pedestrian: 'pedestrian',
  cycleway: 'cycleway',
  footway: 'footway',
  steps: 'footway',
};

// --- Decode functions ---

function decodeBuildings(vt: VectorTile, tile: TileCoord): BuildingData[] {
  const layer = vt.layers['building'];
  if (!layer) return [];

  const buildings: BuildingData[] = [];

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3) continue; // Only polygons

    const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);
    const geom = geojson.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

    const props = feature.properties;
    let height = Number(props.render_height) || 0;
    if (height === 0) {
      height = 8 + seededRandom(feature.id ?? i) * 7;
    }
    const minHeight = Number(props.render_min_height) || 0;
    const baseId = feature.id ?? i + tile.x * 10000 + tile.y * 100000;

    // Collect all polygon outer rings (MultiPolygon has multiple)
    const polygonRings: number[][][] =
      geom.type === 'Polygon'
        ? [geom.coordinates[0]]
        : geom.coordinates.map((poly: number[][][]) => poly[0]);

    for (let r = 0; r < polygonRings.length; r++) {
      const ring = polygonRings[r];
      if (!ring || ring.length < 4) continue;

      const polygon = ring.map((c: number[]) => ({ lat: c[1], lng: c[0] }));

      buildings.push({
        id: baseId + r * 1000000,
        polygon,
        height,
        minHeight,
      });
    }
  }

  return buildings;
}

function decodeTransportation(vt: VectorTile, tile: TileCoord): RoadData[] {
  const layer = vt.layers['transportation'];
  if (!layer) return [];

  const roads: RoadData[] = [];

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 2) continue; // Only linestrings

    const props = feature.properties;
    const cls = props.class as string | undefined;
    if (!cls) continue;

    // Determine highway type
    let highway = CLASS_MAP[cls];
    const subclass = props.subclass as string | undefined;
    if (subclass && SUBCLASS_OVERRIDE[subclass]) {
      highway = SUBCLASS_OVERRIDE[subclass];
    }
    if (!highway) continue;

    if (props.ramp) {
      highway += '_link';
    }

    const rawOneway = props.oneway;
    let oneway: 1 | -1 | 0 = 0;
    if (rawOneway === 1) oneway = 1;
    else if (rawOneway === -1) oneway = -1;

    const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);
    const geom = geojson.geometry;
    if (!geom) continue;

    // Collect all linestrings (MultiLineString has multiple segments)
    let allLines: number[][][];
    if (geom.type === 'LineString') {
      allLines = [geom.coordinates];
    } else if (geom.type === 'MultiLineString') {
      allLines = geom.coordinates;
    } else {
      continue;
    }

    const baseId = feature.id ?? i + tile.x * 10000 + tile.y * 100000;

    for (let s = 0; s < allLines.length; s++) {
      const lineCoords = allLines[s];
      if (lineCoords.length < 2) continue;

      const points = lineCoords.map((c: number[]) => ({ lat: c[1], lng: c[0] }));

      roads.push({
        id: baseId + s * 1000000,
        points,
        type: highway,
        name: '',
        lanes: 2,
        oneway,
      });
    }
  }

  return roads;
}

function applyRoadNames(vt: VectorTile, tile: TileCoord, roads: RoadData[]): void {
  const layer = vt.layers['transportation_name'];
  if (!layer || roads.length === 0) return;

  // Build spatial index: round first point to ~1m precision, map to road index
  const index = new Map<string, number>();
  for (let i = 0; i < roads.length; i++) {
    const p = roads[i].points[0];
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    index.set(key, i);
  }

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const name = feature.properties.name as string | undefined;
    if (!name) continue;

    const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);
    let firstCoord: number[] | undefined;
    if (geojson.geometry.type === 'LineString') {
      firstCoord = geojson.geometry.coordinates[0];
    } else if (geojson.geometry.type === 'MultiLineString') {
      firstCoord = geojson.geometry.coordinates[0]?.[0];
    }
    if (!firstCoord) continue;

    const key = `${firstCoord[1].toFixed(5)},${firstCoord[0].toFixed(5)}`;
    const roadIdx = index.get(key);
    if (roadIdx !== undefined) {
      roads[roadIdx].name = name;
    }
  }
}

// --- Decode from raw buffer ---

function decodeTile(buffer: ArrayBuffer, tile: TileCoord): { buildings: BuildingData[]; roads: RoadData[] } {
  const vt = new VectorTile(new Pbf(buffer));
  const buildings = decodeBuildings(vt, tile);
  const roads = decodeTransportation(vt, tile);
  applyRoadNames(vt, tile, roads);
  return { buildings, roads };
}

// --- Public API ---

export async function fetchTileData(
  tile: TileCoord,
  signal?: AbortSignal
): Promise<{ buildings: BuildingData[]; roads: RoadData[] }> {
  const key = tileKey(tile);

  // Tier 1: In-memory LRU
  const cached = cacheGet(key);
  if (cached) return cached;

  // Tier 2: IndexedDB
  const idbBuffer = await getCachedPbf(key);
  if (idbBuffer) {
    const result = decodeTile(idbBuffer, tile);
    cacheSet(key, result);
    console.log(`[vector-tiles] ${key}: ${result.buildings.length} buildings, ${result.roads.length} roads (from IDB)`);
    return result;
  }

  // Tier 3: Network fetch
  const urlTemplate = await ensureTileUrl();
  const url = urlTemplate
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));

  const timeoutSignal = AbortSignal.timeout(15000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const resp = await fetch(url, { signal: combinedSignal });
  if (!resp.ok) {
    throw new Error(`Tile fetch failed: ${resp.status} for ${key}`);
  }

  const buffer = await resp.arrayBuffer();

  // Store in IndexedDB (fire-and-forget)
  putCachedPbf(key, buffer).catch(() => {});

  const result = decodeTile(buffer, tile);
  cacheSet(key, result);
  console.log(`[vector-tiles] ${key}: ${result.buildings.length} buildings, ${result.roads.length} roads`);
  return result;
}
