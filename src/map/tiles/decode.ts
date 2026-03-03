import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { BuildingData, LandUseData, LatLng, RoadData } from '../types';

export interface TileCoordLike {
  z: number;
  x: number;
  y: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function tileToLatLng(px: number, py: number, extent: number, tx: number, ty: number, tz: number): LatLng {
  const size = extent * (1 << tz);
  return {
    lng: (px + tx * extent) / size * 360 - 180,
    lat: 360 / Math.PI * Math.atan(Math.exp((1 - 2 * (py + ty * extent) / size) * Math.PI)) - 90,
  };
}

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

function decodeBuildings(vt: VectorTile, tile: TileCoordLike): BuildingData[] {
  const layer = vt.layers['building'];
  if (!layer) return [];

  const buildings: BuildingData[] = [];
  const { x: tx, y: ty, z: tz } = tile;

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3) continue;

    const rings = feature.loadGeometry();
    if (rings.length === 0) continue;

    const extent = feature.extent;
    const polygons = classifyRings(rings);

    const props = feature.properties;
    let height = Number(props.render_height) || 0;
    if (height === 0) {
      height = 8 + seededRandom(feature.id ?? i) * 7;
    }
    const minHeight = Number(props.render_min_height) || 0;
    const baseId = feature.id ?? i + tx * 10000 + ty * 100000;

    for (let r = 0; r < polygons.length; r++) {
      const outerRing = polygons[r][0];
      if (!outerRing || outerRing.length < 4) continue;

      const polygon: LatLng[] = [];
      for (let k = 0; k < outerRing.length; k++) {
        polygon.push(tileToLatLng(outerRing[k].x, outerRing[k].y, extent, tx, ty, tz));
      }

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

function decodeTransportation(vt: VectorTile, tile: TileCoordLike): RoadData[] {
  const layer = vt.layers['transportation'];
  if (!layer) return [];

  const roads: RoadData[] = [];
  const { x: tx, y: ty, z: tz } = tile;

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 2) continue;

    const props = feature.properties;
    const cls = props.class as string | undefined;
    if (!cls) continue;

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

    const lines = feature.loadGeometry();
    if (lines.length === 0) continue;

    const extent = feature.extent;
    const baseId = feature.id ?? i + tx * 10000 + ty * 100000;

    for (let s = 0; s < lines.length; s++) {
      const line = lines[s];
      if (line.length < 2) continue;

      const points: LatLng[] = [];
      for (let k = 0; k < line.length; k++) {
        points.push(tileToLatLng(line[k].x, line[k].y, extent, tx, ty, tz));
      }

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

function applyRoadNames(vt: VectorTile, tile: TileCoordLike, roads: RoadData[]): void {
  const layer = vt.layers['transportation_name'];
  if (!layer || roads.length === 0) return;

  // Index all points (not just first) to handle reversed/offset name geometries
  const index = new Map<string, number>();
  for (let i = 0; i < roads.length; i++) {
    for (const p of roads[i].points) {
      const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      if (!index.has(key)) index.set(key, i);
    }
  }

  const { x: tx, y: ty, z: tz } = tile;

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const name = feature.properties.name as string | undefined;
    if (!name) continue;

    const lines = feature.loadGeometry();
    outer: for (const line of lines) {
      for (const pt of line) {
        const coord = tileToLatLng(pt.x, pt.y, feature.extent, tx, ty, tz);
        const key = `${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`;
        const roadIdx = index.get(key);
        if (roadIdx !== undefined) {
          roads[roadIdx].name = name;
          break outer;
        }
      }
    }
  }
}

const LAND_USE_LAYERS = ['landuse', 'landcover', 'water', 'park'] as const;

function decodeLandUse(vt: VectorTile, tile: TileCoordLike): LandUseData[] {
  const results: LandUseData[] = [];
  const { x: tx, y: ty, z: tz } = tile;

  for (const layerName of LAND_USE_LAYERS) {
    const layer = vt.layers[layerName];
    if (!layer) continue;

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 3) continue;

      const rings = feature.loadGeometry();
      if (rings.length === 0) continue;

      const extent = feature.extent;
      const polygons = classifyRings(rings);

      const cls = (feature.properties.class as string) || layerName;
      const baseId = feature.id ?? i + tx * 10000 + ty * 100000;

      for (let r = 0; r < polygons.length; r++) {
        const outerRing = polygons[r][0];
        if (!outerRing || outerRing.length < 4) continue;

        const polygon: LatLng[] = [];
        for (let k = 0; k < outerRing.length; k++) {
          polygon.push(tileToLatLng(outerRing[k].x, outerRing[k].y, extent, tx, ty, tz));
        }

        results.push({
          id: baseId + r * 1000000,
          polygon,
          class: cls,
        });
      }
    }
  }

  return results;
}

export function decodeTile(buffer: ArrayBuffer, tile: TileCoordLike): { buildings: BuildingData[]; roads: RoadData[]; landUse: LandUseData[] } {
  const vt = new VectorTile(new Pbf(buffer));
  const buildings = decodeBuildings(vt, tile);
  const roads = decodeTransportation(vt, tile);
  applyRoadNames(vt, tile, roads);
  const landUse = decodeLandUse(vt, tile);
  return { buildings, roads, landUse };
}
