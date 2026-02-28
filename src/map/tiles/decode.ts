import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { BuildingData, RoadData } from '../types';

export interface TileCoordLike {
  z: number;
  x: number;
  y: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
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

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3) continue;

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

function decodeTransportation(vt: VectorTile, tile: TileCoordLike): RoadData[] {
  const layer = vt.layers['transportation'];
  if (!layer) return [];

  const roads: RoadData[] = [];

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

    const geojson = feature.toGeoJSON(tile.x, tile.y, tile.z);
    const geom = geojson.geometry;
    if (!geom) continue;

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

function applyRoadNames(vt: VectorTile, tile: TileCoordLike, roads: RoadData[]): void {
  const layer = vt.layers['transportation_name'];
  if (!layer || roads.length === 0) return;

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

export function decodeTile(buffer: ArrayBuffer, tile: TileCoordLike): { buildings: BuildingData[]; roads: RoadData[] } {
  const vt = new VectorTile(new Pbf(buffer));
  const buildings = decodeBuildings(vt, tile);
  const roads = decodeTransportation(vt, tile);
  applyRoadNames(vt, tile, roads);
  return { buildings, roads };
}
