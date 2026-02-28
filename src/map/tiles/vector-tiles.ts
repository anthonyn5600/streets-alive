import type { BuildingData, RoadData } from '../types';
import { decodeTile } from './decode';

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
        // Fallback -- will work until the date path changes
        tileUrlTemplate = 'https://tiles.openfreemap.org/planet/20260218_001001_pt/{z}/{x}/{y}.pbf';
      }
    })();
  }
  await tileJsonPromise;
  return tileUrlTemplate!;
}

// --- LRU cache (decoded tile data) ---

const CACHE_MAX = 200;
const cache = new Map<string, { buildings: BuildingData[]; roads: RoadData[] }>();

function cacheGet(key: string) {
  const val = cache.get(key);
  if (val) {
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: { buildings: BuildingData[]; roads: RoadData[] }) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(key, val);
}

export function cacheSetDecoded(key: string, val: { buildings: BuildingData[]; roads: RoadData[] }) {
  cacheSet(key, val);
}

// --- Raw buffer fetch (IDB + network, no decode) ---

const inFlightBuffers = new Map<string, Promise<ArrayBuffer>>();

export function fetchTileBuffer(
  tile: TileCoord,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const key = tileKey(tile);

  let inFlight = inFlightBuffers.get(key);
  if (!inFlight) {
    inFlight = fetchTileBufferInner(tile, key).finally(() => {
      inFlightBuffers.delete(key);
    });
    inFlightBuffers.set(key, inFlight);
  }

  if (!signal) return inFlight;

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    inFlight!.then(
      (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); }
    );
  });
}

async function fetchTileBufferInner(
  tile: TileCoord,
  key: string,
): Promise<ArrayBuffer> {
  const idbBuffer = await getCachedPbf(key);
  if (idbBuffer) {
    console.log(`[vector-tiles] ${key}: buffer from IDB`);
    return idbBuffer;
  }

  const urlTemplate = await ensureTileUrl();
  const url = urlTemplate
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));

  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) {
    throw new Error(`Tile fetch failed: ${resp.status} for ${key}`);
  }

  const buffer = await resp.arrayBuffer();
  putCachedPbf(key, buffer).catch(() => {});
  return buffer;
}

// --- Public API (decoded data, used by prefetch) ---

const inFlightTiles = new Map<string, Promise<{ buildings: BuildingData[]; roads: RoadData[] }>>();

export function fetchTileData(
  tile: TileCoord,
  signal?: AbortSignal
): Promise<{ buildings: BuildingData[]; roads: RoadData[] }> {
  const key = tileKey(tile);

  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  let inFlight = inFlightTiles.get(key);
  if (!inFlight) {
    inFlight = fetchTileDataInner(tile, key).finally(() => {
      inFlightTiles.delete(key);
    });
    inFlightTiles.set(key, inFlight);
  }

  if (!signal) return inFlight;

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    inFlight!.then(
      (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); }
    );
  });
}

async function fetchTileDataInner(
  tile: TileCoord,
  key: string,
): Promise<{ buildings: BuildingData[]; roads: RoadData[] }> {
  const buffer = await fetchTileBuffer(tile);
  const result = decodeTile(buffer, tile);
  cacheSet(key, result);
  console.log(`[vector-tiles] ${key}: ${result.buildings.length} buildings, ${result.roads.length} roads`);
  return result;
}
