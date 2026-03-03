import * as THREE from 'three';

const MAX_ENTRIES = 200;

export interface BuildingVertexRange {
  buildingId: number;
  startVertex: number;
  vertexCount: number;
}

export interface CachedBuildingArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  vertexRanges: BuildingVertexRange[];
}

export interface CachedRoadLayerArrays {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CachedColoredRoadLayer {
  color: number;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CachedRoadArrays {
  localCasing: CachedColoredRoadLayer[];
  localFill: CachedColoredRoadLayer[];
  localCenterLine: CachedRoadLayerArrays | null;
  hwMask: CachedRoadLayerArrays | null;
  hwShadow: CachedRoadLayerArrays | null;
  hwCasing: CachedColoredRoadLayer[];
  hwFill: CachedColoredRoadLayer[];
  hwCenterLine: CachedRoadLayerArrays | null;
  onewayArrows: CachedRoadLayerArrays | null;
}

export interface CachedLabelPlacement {
  text: string;
  worldX: number;
  worldZ: number;
  angle: number;
}

export interface CachedTileGeometry {
  buildings: CachedBuildingArrays | null;
  roads: CachedRoadArrays;
  labelPlacements: CachedLabelPlacement[] | null;
  landUse: CachedColoredRoadLayer[];
}

class GeometryCache {
  private entries = new Map<string, CachedTileGeometry>();
  private order: string[] = [];

  get(key: string): CachedTileGeometry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Move to front (most recently used)
    const idx = this.order.indexOf(key);
    if (idx !== -1) {
      this.order.splice(idx, 1);
      this.order.push(key);
    }
    return entry;
  }

  set(key: string, data: CachedTileGeometry): void {
    if (this.entries.has(key)) {
      // Update existing, move to front
      this.entries.set(key, data);
      const idx = this.order.indexOf(key);
      if (idx !== -1) {
        this.order.splice(idx, 1);
        this.order.push(key);
      }
      return;
    }

    // Evict oldest if at capacity
    while (this.order.length >= MAX_ENTRIES) {
      const oldest = this.order.shift()!;
      this.entries.delete(oldest);
    }

    this.entries.set(key, data);
    this.order.push(key);
  }

  clear(): void {
    this.entries.clear();
    this.order.length = 0;
  }
}

export const geometryCache = new GeometryCache();

// --- Persistent geometry cache (IndexedDB) ---

const GEO_DB_NAME = 'geometry-cache';
const GEO_STORE_NAME = 'geometry';
const GEO_DB_VERSION = 1;
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 3;

let geoDB: IDBDatabase | null = null;

export function geometryIdbKey(tileKey: string, zoomLevel: number): string {
  return `${tileKey}@z${Math.floor(zoomLevel)}@v${SCHEMA_VERSION}`;
}

export function openGeometryCache(): Promise<void> {
  if (geoDB) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(GEO_DB_NAME, GEO_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(GEO_STORE_NAME)) {
          database.createObjectStore(GEO_STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        geoDB = request.result;
        resolve();
      };

      request.onerror = () => {
        console.warn('[geometry-cache] Failed to open IndexedDB:', request.error);
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

export function getGeometryCached(key: string): Promise<CachedTileGeometry | null> {
  if (!geoDB) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const tx = geoDB!.transaction(GEO_STORE_NAME, 'readonly');
      const store = tx.objectStore(GEO_STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as { key: string; data: CachedTileGeometry; timestamp: number } | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > GEO_TTL_MS) {
          try {
            const delTx = geoDB!.transaction(GEO_STORE_NAME, 'readwrite');
            delTx.objectStore(GEO_STORE_NAME).delete(key);
          } catch { /* ignore */ }
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

export function putGeometryCached(key: string, data: CachedTileGeometry): Promise<void> {
  if (!geoDB) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const tx = geoDB!.transaction(GEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(GEO_STORE_NAME);
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function evictOldGeometry(maxAgeMs: number = GEO_TTL_MS): Promise<void> {
  if (!geoDB) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const tx = geoDB!.transaction(GEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(GEO_STORE_NAME);
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

export function evictExcessGeometry(maxEntries: number = 800): Promise<void> {
  if (!geoDB) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const tx = geoDB!.transaction(GEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(GEO_STORE_NAME);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();

      const countReq = store.count();

      countReq.onsuccess = () => {
        if (countReq.result <= maxEntries) {
          return;
        }

        const entries: { key: string; timestamp: number }[] = [];
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const val = cursor.value as { key: string; timestamp: number };
            entries.push({ key: val.key, timestamp: val.timestamp });
            cursor.continue();
          } else {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = entries.slice(0, entries.length - maxEntries);
            for (const entry of toDelete) {
              store.delete(entry.key);
            }
          }
        };
        cursorReq.onerror = () => resolve();
      };

      countReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Exposed for testing only */
export function _setGeoDB(database: IDBDatabase | null) {
  geoDB = database;
}

/** Exposed for testing only */
export function _getGeoDB(): IDBDatabase | null {
  return geoDB;
}

export function geometryFromArrays(
  positions: Float32Array,
  indices: Uint32Array,
  normals?: Float32Array,
  colors?: Float32Array
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  if (normals) {
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  }
  if (colors) {
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geom;
}

export function applyBuildingColorsToArrays(
  cached: CachedBuildingArrays,
  colorMap: Map<number, THREE.Color>,
  defaultColor: THREE.Color
): Float32Array {
  const colors = new Float32Array(cached.colors);
  for (const range of cached.vertexRanges) {
    const color = colorMap.get(range.buildingId) ?? defaultColor;
    const r = color.r, g = color.g, b = color.b;
    for (let v = range.startVertex; v < range.startVertex + range.vertexCount; v++) {
      colors[v * 3] = r;
      colors[v * 3 + 1] = g;
      colors[v * 3 + 2] = b;
    }
  }
  return colors;
}
