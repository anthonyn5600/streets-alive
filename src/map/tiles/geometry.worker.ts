import earcut from 'earcut';
import {
  getRoadStyle,
  getRoadPriority,
  isDividedRoad,
  isHighwayType,
  HIGHWAY_MASK_EXTRA,
  HIGHWAY_SHADOW_EXTRA,
} from '../roads/style';
import type { BuildingData, RoadData } from '../types';
import type {
  CachedBuildingArrays,
  CachedRoadArrays,
  CachedRoadLayerArrays,
  CachedColoredRoadLayer,
  CachedLabelPlacement,
  BuildingVertexRange,
} from './geometry-cache';
import { decodeTile } from './decode';

// --- Projection (pure math, no module state) ---

const DEG2RAD = Math.PI / 180;
const EARTH_RADIUS = 6378137;

interface ProjConstants {
  centerLat: number;
  centerLng: number;
  cosCenter: number;
  centerMercY: number;
}

function projectPure(lat: number, lng: number, c: ProjConstants): { x: number; z: number } {
  const x = EARTH_RADIUS * (lng - c.centerLng) * DEG2RAD * c.cosCenter;
  const mercY = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * DEG2RAD / 2));
  const z = -(mercY - c.centerMercY);
  return { x, z };
}

// --- Convex polygon fast path ---

function isConvex(pts: Array<{ x: number; z: number }>): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return sign !== 0;
}

function fanTriangulate(n: number): number[] {
  const indices: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return indices;
}

// --- Building geometry (same algorithm as buildings.ts) ---

function buildBuildingArrays(
  buildings: BuildingData[],
  proj: ProjConstants,
  color: { r: number; g: number; b: number }
): CachedBuildingArrays | null {
  if (buildings.length === 0) return null;

  const preps: Array<{
    projected: Array<{ x: number; z: number }>;
    earcutIndices: number[];
    building: BuildingData;
    n: number;
  }> = [];
  let totalVertices = 0;
  let totalIndices = 0;

  for (const bld of buildings) {
    const poly = bld.polygon;
    if (poly.length < 4) continue;

    const projected: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < poly.length - 1; i++) {
      projected.push(projectPure(poly[i].lat, poly[i].lng, proj));
    }
    if (projected.length < 3) continue;

    let earcutIndices: number[];
    if (isConvex(projected)) {
      earcutIndices = fanTriangulate(projected.length);
    } else {
      const flatCoords: number[] = [];
      for (const p of projected) {
        flatCoords.push(p.x, p.z);
      }
      earcutIndices = earcut(flatCoords, undefined, 2);
    }
    if (earcutIndices.length === 0) continue;

    const n = projected.length;
    totalVertices += n + n * 4;
    totalIndices += earcutIndices.length + n * 6;
    preps.push({ projected, earcutIndices, building: bld, n });
  }

  if (preps.length === 0) return null;

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  const ranges: BuildingVertexRange[] = [];

  const cr = color.r, cg = color.g, cb = color.b;
  let vOff = 0;
  let iOff = 0;

  for (const { projected, earcutIndices, building, n } of preps) {
    const height = building.height;
    const minHeight = building.minHeight;
    const startVertex = vOff;

    for (let i = 0; i < n; i++) {
      const p = projected[i];
      const vi3 = (vOff + i) * 3;
      positions[vi3] = p.x; positions[vi3 + 1] = height; positions[vi3 + 2] = p.z;
      normals[vi3] = 0; normals[vi3 + 1] = 1; normals[vi3 + 2] = 0;
      colors[vi3] = cr; colors[vi3 + 1] = cg; colors[vi3 + 2] = cb;
    }

    for (let i = 0; i < earcutIndices.length; i++) {
      indices[iOff + i] = vOff + earcutIndices[i];
    }
    iOff += earcutIndices.length;
    vOff += n;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = projected[i];
      const p1 = projected[j];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      let nx = 0, nz = 0;
      if (len > 0) { nx = dz / len; nz = -dx / len; }

      const base = vOff;
      let vi3 = base * 3;
      positions[vi3] = p0.x; positions[vi3 + 1] = height; positions[vi3 + 2] = p0.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = cr; colors[vi3 + 1] = cg; colors[vi3 + 2] = cb;

      vi3 = (base + 1) * 3;
      positions[vi3] = p1.x; positions[vi3 + 1] = height; positions[vi3 + 2] = p1.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = cr; colors[vi3 + 1] = cg; colors[vi3 + 2] = cb;

      vi3 = (base + 2) * 3;
      positions[vi3] = p1.x; positions[vi3 + 1] = minHeight; positions[vi3 + 2] = p1.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = cr; colors[vi3 + 1] = cg; colors[vi3 + 2] = cb;

      vi3 = (base + 3) * 3;
      positions[vi3] = p0.x; positions[vi3 + 1] = minHeight; positions[vi3 + 2] = p0.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = cr; colors[vi3 + 1] = cg; colors[vi3 + 2] = cb;

      indices[iOff] = base; indices[iOff + 1] = base + 1; indices[iOff + 2] = base + 2;
      indices[iOff + 3] = base; indices[iOff + 4] = base + 2; indices[iOff + 5] = base + 3;
      iOff += 6;
      vOff += 4;
    }

    ranges.push({ buildingId: building.id, startVertex, vertexCount: vOff - startVertex });
  }

  return { positions, normals, indices, colors, vertexRanges: ranges };
}

// --- Ribbon geometry (pure math, no THREE) ---

function computeMiterNormals(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const normals: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    let nx = 0, nz = 0;
    if (i === 0) {
      const dx = pts[1].x - pts[0].x;
      const dz = pts[1].z - pts[0].z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { nx = -dz / len; nz = dx / len; }
    } else if (i === pts.length - 1) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { nx = -dz / len; nz = dx / len; }
    } else {
      const dx1 = pts[i].x - pts[i - 1].x;
      const dz1 = pts[i].z - pts[i - 1].z;
      const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1);
      const dx2 = pts[i + 1].x - pts[i].x;
      const dz2 = pts[i + 1].z - pts[i].z;
      const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
      if (len1 > 0 && len2 > 0) {
        const n1x = -dz1 / len1, n1z = dx1 / len1;
        const n2x = -dz2 / len2, n2z = dx2 / len2;
        nx = (n1x + n2x) / 2;
        nz = (n1z + n2z) / 2;
        const miterLen = Math.sqrt(nx * nx + nz * nz);
        if (miterLen > 0.001) {
          const scale = Math.min(1 / miterLen, 2);
          nx *= scale; nz *= scale;
        }
      } else if (len1 > 0) {
        nx = -dz1 / len1; nz = dx1 / len1;
      } else if (len2 > 0) {
        nx = -dz2 / len2; nz = dx2 / len2;
      }
    }
    normals.push({ x: nx, z: nz });
  }
  return normals;
}

// Accumulator for building ribbon geometry into growing arrays
interface ArrayBucket {
  positions: number[];
  indices: number[];
  vertexCount: number;
}

function newBucket(): ArrayBucket {
  return { positions: [], indices: [], vertexCount: 0 };
}

function appendRibbon(
  bucket: ArrayBucket,
  pts: Array<{ x: number; z: number }>,
  halfWidth: number,
  yOffset: number,
  perVertexHalfWidth?: number[],
  precomputedNormals?: Array<{ x: number; z: number }>
): void {
  if (pts.length < 2) return;
  const normals = precomputedNormals ?? computeMiterNormals(pts);
  const base = bucket.vertexCount;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = normals[i];
    const hw = perVertexHalfWidth ? perVertexHalfWidth[i] : halfWidth;
    const y = yOffset;
    bucket.positions.push(p.x + n.x * hw, y, p.z + n.z * hw);
    bucket.positions.push(p.x - n.x * hw, y, p.z - n.z * hw);
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const vi = base + i * 2;
    bucket.indices.push(vi, vi + 2, vi + 1);
    bucket.indices.push(vi + 1, vi + 2, vi + 3);
  }

  bucket.vertexCount += pts.length * 2;
}

function appendDashedRibbon(
  bucket: ArrayBucket,
  pts: Array<{ x: number; z: number }>,
  halfWidth: number,
  dashOn: number,
  dashOff: number,
  yOffset: number,
  precomputedNormals?: Array<{ x: number; z: number }>
): void {
  if (pts.length < 2) return;
  const normals = precomputedNormals ?? computeMiterNormals(pts);
  const dashTotal = dashOn + dashOff;
  let accumulated = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (segLen < 0.001) continue;

    const dirX = dx / segLen;
    const dirZ = dz / segLen;
    let walked = 0;

    while (walked < segLen) {
      const phase = accumulated % dashTotal;
      const isOn = phase < dashOn;
      const remaining = isOn ? dashOn - phase : dashTotal - phase;
      const step = Math.min(remaining, segLen - walked);

      if (isOn && step > 0.001) {
        const t0 = walked / segLen;
        const t1 = (walked + step) / segLen;
        const n0x = normals[i].x + (normals[i + 1].x - normals[i].x) * t0;
        const n0z = normals[i].z + (normals[i + 1].z - normals[i].z) * t0;
        const n1x = normals[i].x + (normals[i + 1].x - normals[i].x) * t1;
        const n1z = normals[i].z + (normals[i + 1].z - normals[i].z) * t1;
        const x0 = pts[i].x + dirX * walked;
        const z0 = pts[i].z + dirZ * walked;
        const x1 = pts[i].x + dirX * (walked + step);
        const z1 = pts[i].z + dirZ * (walked + step);

        const vi = bucket.vertexCount;
        bucket.positions.push(x0 + n0x * halfWidth, yOffset, z0 + n0z * halfWidth);
        bucket.positions.push(x0 - n0x * halfWidth, yOffset, z0 - n0z * halfWidth);
        bucket.positions.push(x1 + n1x * halfWidth, yOffset, z1 + n1z * halfWidth);
        bucket.positions.push(x1 - n1x * halfWidth, yOffset, z1 - n1z * halfWidth);

        bucket.indices.push(vi, vi + 2, vi + 1);
        bucket.indices.push(vi + 1, vi + 2, vi + 3);
        bucket.vertexCount += 4;
      }

      walked += step;
      accumulated += step;
    }
  }
}

// --- Road geometry builder ---

const LOCAL_CASING_Y = 0.05;
const LOCAL_FILL_Y = 0.15;
const HW_SHADOW_Y = 0.20;
const HW_CASING_Y = 0.25;
const HW_FILL_Y = 0.35;
const CENTER_LINE_Y = 0.40;
const PRIORITY_STEP = 0.001;

const CENTER_LINE_HALF_WIDTH = 0.5;
const CENTER_LINE_DASH_ON = 4;
const CENTER_LINE_DASH_OFF = 4;

function bucketToLayerArrays(bucket: ArrayBucket): CachedRoadLayerArrays | null {
  if (bucket.positions.length === 0) return null;
  return {
    positions: new Float32Array(bucket.positions),
    indices: new Uint32Array(bucket.indices),
  };
}

function colorBucketsToLayers(map: Map<number, ArrayBucket>): CachedColoredRoadLayer[] {
  const layers: CachedColoredRoadLayer[] = [];
  for (const [color, bucket] of map) {
    if (bucket.positions.length === 0) continue;
    layers.push({
      color,
      positions: new Float32Array(bucket.positions),
      indices: new Uint32Array(bucket.indices),
    });
  }
  return layers;
}

function buildRoadArrays(
  roads: RoadData[],
  zoomLevel: number,
  proj: ProjConstants
): CachedRoadArrays {
  const localCasingColors = new Map<number, ArrayBucket>();
  const localFillColors = new Map<number, ArrayBucket>();
  const localCenterLineBucket = newBucket();

  const hwCasingColors = new Map<number, ArrayBucket>();
  const hwFillColors = new Map<number, ArrayBucket>();
  const hwCenterLineBucket = newBucket();
  const hwMaskBucket = newBucket();
  const hwShadowBucket = newBucket();

  for (const road of roads) {
    const style = getRoadStyle(road.type, zoomLevel);
    if (!style) continue;

    const pts = road.points.map(p => projectPure(p.lat, p.lng, proj));
    if (pts.length < 2) continue;

    const priority = getRoadPriority(road.type);
    const isHw = isHighwayType(road.type);

    const casingColors = isHw ? hwCasingColors : localCasingColors;
    const fillColors = isHw ? hwFillColors : localFillColors;
    const fillY = isHw
      ? HW_FILL_Y + priority * PRIORITY_STEP
      : LOCAL_FILL_Y + priority * PRIORITY_STEP;
    const casingY = isHw
      ? HW_CASING_Y + priority * PRIORITY_STEP
      : LOCAL_CASING_Y + priority * PRIORITY_STEP;

    const normals = computeMiterNormals(pts);

    if (isHw) {
      const maskHalfWidth = style.casingWidth / 2 + HIGHWAY_MASK_EXTRA;
      appendRibbon(hwMaskBucket, pts, maskHalfWidth, HW_SHADOW_Y, undefined, normals);

      const shadowHalfWidth = style.casingWidth / 2 + HIGHWAY_SHADOW_EXTRA;
      appendRibbon(hwShadowBucket, pts, shadowHalfWidth, HW_SHADOW_Y, undefined, normals);
    }

    if (isDividedRoad(road.type)) {
      const laneHalf = (style.fillWidth * 0.4) / 2;
      const laneOffset = style.fillWidth * 0.3;

      const leftPts = pts.map((p, i) => ({
        x: p.x + normals[i].x * laneOffset,
        z: p.z + normals[i].z * laneOffset,
      }));
      const rightPts = pts.map((p, i) => ({
        x: p.x - normals[i].x * laneOffset,
        z: p.z - normals[i].z * laneOffset,
      }));

      if (!fillColors.has(style.fillColor)) fillColors.set(style.fillColor, newBucket());
      const bucket = fillColors.get(style.fillColor)!;
      appendRibbon(bucket, leftPts, laneHalf, fillY);
      appendRibbon(bucket, rightPts, laneHalf, fillY);
    } else {
      if (!fillColors.has(style.fillColor)) fillColors.set(style.fillColor, newBucket());
      appendRibbon(fillColors.get(style.fillColor)!, pts, style.fillWidth / 2, fillY, undefined, normals);
    }

    if (isDividedRoad(road.type)) {
      const clBucket = isHw ? hwCenterLineBucket : localCenterLineBucket;
      appendDashedRibbon(clBucket, pts, CENTER_LINE_HALF_WIDTH, CENTER_LINE_DASH_ON, CENTER_LINE_DASH_OFF, CENTER_LINE_Y, normals);
    }

    if (style.casingColor !== null) {
      if (!casingColors.has(style.casingColor)) casingColors.set(style.casingColor, newBucket());
      appendRibbon(casingColors.get(style.casingColor)!, pts, style.casingWidth / 2, casingY, undefined, normals);
    }
  }

  return {
    localCasing: colorBucketsToLayers(localCasingColors),
    localFill: colorBucketsToLayers(localFillColors),
    localCenterLine: bucketToLayerArrays(localCenterLineBucket),
    hwMask: bucketToLayerArrays(hwMaskBucket),
    hwShadow: bucketToLayerArrays(hwShadowBucket),
    hwCasing: colorBucketsToLayers(hwCasingColors),
    hwFill: colorBucketsToLayers(hwFillColors),
    hwCenterLine: bucketToLayerArrays(hwCenterLineBucket),
  };
}

// --- Label placements ---

const LABEL_SPACING = 200;
const MIN_ROAD_LENGTH = 100;

function computeLabels(
  roads: RoadData[],
  zoomLevel: number,
  proj: ProjConstants
): CachedLabelPlacement[] {
  const placements: CachedLabelPlacement[] = [];

  for (const road of roads) {
    if (!road.name) continue;
    const style = getRoadStyle(road.type, zoomLevel);
    if (!style) continue;

    const pts = road.points.map(p => projectPure(p.lat, p.lng, proj));
    if (pts.length < 2) continue;

    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      totalLen += Math.sqrt(dx * dx + dz * dz);
    }
    if (totalLen < MIN_ROAD_LENGTH) continue;

    const numLabels = Math.max(1, Math.floor(totalLen / LABEL_SPACING));
    for (let li = 0; li < numLabels; li++) {
      const targetDist = (li + 0.5) * (totalLen / numLabels);
      let accum = 0;

      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dz = pts[i].z - pts[i - 1].z;
        const segLen = Math.sqrt(dx * dx + dz * dz);
        if (accum + segLen >= targetDist) {
          const t = (targetDist - accum) / segLen;
          placements.push({
            text: road.name,
            worldX: pts[i - 1].x + dx * t,
            worldZ: pts[i - 1].z + dz * t,
            angle: Math.atan2(dz, dx),
          });
          break;
        }
        accum += segLen;
      }
    }
  }

  return placements;
}

// --- Worker message handler ---

function collectTransferables(
  buildings: CachedBuildingArrays | null,
  roads: CachedRoadArrays
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();

  if (buildings) {
    buffers.add(buildings.positions.buffer);
    buffers.add(buildings.normals.buffer);
    buffers.add(buildings.indices.buffer);
    buffers.add(buildings.colors.buffer);
  }

  function addLayer(layer: CachedRoadLayerArrays | null) {
    if (!layer) return;
    buffers.add(layer.positions.buffer);
    buffers.add(layer.indices.buffer);
  }

  function addColoredLayers(layers: CachedColoredRoadLayer[]) {
    for (const l of layers) {
      buffers.add(l.positions.buffer);
      buffers.add(l.indices.buffer);
    }
  }

  addColoredLayers(roads.localCasing);
  addColoredLayers(roads.localFill);
  addLayer(roads.localCenterLine);
  addLayer(roads.hwMask);
  addLayer(roads.hwShadow);
  addColoredLayers(roads.hwCasing);
  addColoredLayers(roads.hwFill);
  addLayer(roads.hwCenterLine);

  return Array.from(buffers);
}

self.onmessage = (e: MessageEvent) => {
  const { id, buffer, tileCoord, zoomLevel, projection, buildingColor } = e.data;

  const decoded = decodeTile(buffer, tileCoord);

  const buildingArrays = buildBuildingArrays(decoded.buildings, projection, buildingColor);
  const roadArrays = buildRoadArrays(decoded.roads, zoomLevel, projection);
  const labelPlacements = computeLabels(decoded.roads, zoomLevel, projection);

  const transferables = collectTransferables(buildingArrays, roadArrays);

  (self as unknown as Worker).postMessage(
    {
      id,
      buildings: buildingArrays,
      roads: roadArrays,
      labelPlacements,
      decodedBuildings: decoded.buildings,
      decodedRoads: decoded.roads,
    },
    transferables
  );
};
