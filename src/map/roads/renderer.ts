import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { project } from '../projection';
import { materialPool } from '../materials';
import { geometryFromArrays } from '../tiles/geometry-cache';
import {
  getRoadPriority,
  getRoadStyle,
  isDividedRoad,
  isHighwayType,
  HIGHWAY_MASK_EXTRA,
  HIGHWAY_SHADOW_EXTRA,
} from './style';
import { computeMiterNormals } from './miter';
import type { RoadData, RoadStyle } from '../types';
import type { CachedRoadArrays, CachedColoredRoadLayer, CachedRoadLayerArrays } from '../tiles/geometry-cache';

const LOCAL_CASING_Y = 0.05;
const LOCAL_FILL_Y = 0.15;
const HW_SHADOW_Y = 0.20;
const HW_CASING_Y = 0.25;
const HW_FILL_Y = 0.35;
const CENTER_LINE_Y = 0.40;
const PRIORITY_STEP = 0.001;

const CENTER_LINE_COLOR = 0xf0c14b;
const CENTER_LINE_HALF_WIDTH = 0.5;
const CENTER_LINE_DASH_ON = 4;
const CENTER_LINE_DASH_OFF = 4;

const centerLineDashStyle: RoadStyle = {
  fillColor: CENTER_LINE_COLOR,
  casingColor: null,
  fillWidth: CENTER_LINE_HALF_WIDTH * 2,
  casingWidth: 0,
  dashed: true,
  dashOn: CENTER_LINE_DASH_ON,
  dashOff: CENTER_LINE_DASH_OFF,
  minZoom: 0,
};

export interface RoadMeshResult {
  localCasing: THREE.Object3D | null;
  localFill: THREE.Object3D | null;
  localCenterLine: THREE.Object3D | null;
  highwayMask: THREE.Object3D | null;
  highwayShadow: THREE.Object3D | null;
  highwayCasing: THREE.Object3D | null;
  highwayFill: THREE.Object3D | null;
  highwayCenterLine: THREE.Object3D | null;
}

function extractLayerArrays(geoms: THREE.BufferGeometry[]): CachedRoadLayerArrays | null {
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  if (!merged) return null;
  const posAttr = merged.attributes.position as THREE.BufferAttribute;
  const indexAttr = merged.index!;
  const result: CachedRoadLayerArrays = {
    positions: new Float32Array(posAttr.array as Float32Array),
    indices: new Uint32Array(indexAttr.array as Uint32Array),
  };
  merged.dispose();
  return result;
}

function extractColoredLayerArrays(colorMap: Map<number, THREE.BufferGeometry[]>): CachedColoredRoadLayer[] {
  const layers: CachedColoredRoadLayer[] = [];
  for (const [color, geoms] of colorMap) {
    if (geoms.length === 0) continue;
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) continue;
    const posAttr = merged.attributes.position as THREE.BufferAttribute;
    const indexAttr = merged.index!;
    layers.push({
      color,
      positions: new Float32Array(posAttr.array as Float32Array),
      indices: new Uint32Array(indexAttr.array as Uint32Array),
    });
    merged.dispose();
  }
  return layers;
}

export function buildRoadGeometryArrays(
  roads: RoadData[],
  zoomLevel: number
): CachedRoadArrays {
  const localCasingColors = new Map<number, THREE.BufferGeometry[]>();
  const localFillColors = new Map<number, THREE.BufferGeometry[]>();
  const localCenterLineGeoms: THREE.BufferGeometry[] = [];

  const hwCasingColors = new Map<number, THREE.BufferGeometry[]>();
  const hwFillColors = new Map<number, THREE.BufferGeometry[]>();
  const hwCenterLineGeoms: THREE.BufferGeometry[] = [];
  const hwMaskGeoms: THREE.BufferGeometry[] = [];
  const hwShadowGeoms: THREE.BufferGeometry[] = [];

  for (const road of roads) {
    const style = getRoadStyle(road.type, zoomLevel);
    if (!style) continue;

    const pts = road.points.map(p => project(p));
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

    if (isHw) {
      const maskHalfWidth = style.casingWidth / 2 + HIGHWAY_MASK_EXTRA;
      const maskGeom = buildRibbon(pts, maskHalfWidth, null, HW_SHADOW_Y);
      if (maskGeom) hwMaskGeoms.push(maskGeom);

      const shadowHalfWidth = style.casingWidth / 2 + HIGHWAY_SHADOW_EXTRA;
      const shadowGeom = buildRibbon(pts, shadowHalfWidth, null, HW_SHADOW_Y);
      if (shadowGeom) hwShadowGeoms.push(shadowGeom);
    }

    if (isDividedRoad(road.type)) {
      const laneHalf = (style.fillWidth * 0.4) / 2;
      const laneOffset = style.fillWidth * 0.3;
      const normals = computeMiterNormals(pts);

      const leftPts = pts.map((p, i) => ({
        x: p.x + normals[i].x * laneOffset,
        z: p.z + normals[i].z * laneOffset,
      }));
      const rightPts = pts.map((p, i) => ({
        x: p.x - normals[i].x * laneOffset,
        z: p.z - normals[i].z * laneOffset,
      }));

      const leftGeom = buildRibbon(leftPts, laneHalf, style, fillY);
      const rightGeom = buildRibbon(rightPts, laneHalf, style, fillY);

      if (!fillColors.has(style.fillColor)) fillColors.set(style.fillColor, []);
      const bucket = fillColors.get(style.fillColor)!;
      if (leftGeom) bucket.push(leftGeom);
      if (rightGeom) bucket.push(rightGeom);
    } else {
      const fillGeom = buildRibbon(pts, style.fillWidth / 2, style, fillY);
      if (fillGeom) {
        if (!fillColors.has(style.fillColor)) fillColors.set(style.fillColor, []);
        fillColors.get(style.fillColor)!.push(fillGeom);
      }
    }

    if (isDividedRoad(road.type)) {
      const clGeom = buildRibbon(pts, CENTER_LINE_HALF_WIDTH, centerLineDashStyle, CENTER_LINE_Y);
      if (clGeom) {
        if (isHw) hwCenterLineGeoms.push(clGeom);
        else localCenterLineGeoms.push(clGeom);
      }
    }

    if (style.casingColor !== null) {
      const casingGeom = buildRibbon(pts, style.casingWidth / 2, null, casingY);
      if (casingGeom) {
        if (!casingColors.has(style.casingColor)) casingColors.set(style.casingColor, []);
        casingColors.get(style.casingColor)!.push(casingGeom);
      }
    }
  }

  return {
    localCasing: extractColoredLayerArrays(localCasingColors),
    localFill: extractColoredLayerArrays(localFillColors),
    localCenterLine: extractLayerArrays(localCenterLineGeoms),
    hwMask: extractLayerArrays(hwMaskGeoms),
    hwShadow: extractLayerArrays(hwShadowGeoms),
    hwCasing: extractColoredLayerArrays(hwCasingColors),
    hwFill: extractColoredLayerArrays(hwFillColors),
    hwCenterLine: extractLayerArrays(hwCenterLineGeoms),
    onewayArrows: null,
  };
}

export function createRoadMeshesFromArrays(cached: CachedRoadArrays): RoadMeshResult {
  // Local casing
  const localCasingMeshes: THREE.Mesh[] = [];
  for (const layer of cached.localCasing) {
    const geom = geometryFromArrays(layer.positions, layer.indices);
    localCasingMeshes.push(new THREE.Mesh(geom, materialPool.getLocalRoadColor(layer.color)));
  }

  // Local fill
  const localFillMeshes: THREE.Mesh[] = [];
  for (const layer of cached.localFill) {
    const geom = geometryFromArrays(layer.positions, layer.indices);
    localFillMeshes.push(new THREE.Mesh(geom, materialPool.getLocalRoadColor(layer.color)));
  }

  // Highway casing
  const hwCasingMeshes: THREE.Mesh[] = [];
  for (const layer of cached.hwCasing) {
    const geom = geometryFromArrays(layer.positions, layer.indices);
    hwCasingMeshes.push(new THREE.Mesh(geom, materialPool.getHighwayRoadColor(layer.color)));
  }

  // Highway fill
  const hwFillMeshes: THREE.Mesh[] = [];
  for (const layer of cached.hwFill) {
    const geom = geometryFromArrays(layer.positions, layer.indices);
    hwFillMeshes.push(new THREE.Mesh(geom, materialPool.getHighwayRoadColor(layer.color)));
  }

  // Highway mask
  let highwayMask: THREE.Object3D | null = null;
  if (cached.hwMask) {
    const geom = geometryFromArrays(cached.hwMask.positions, cached.hwMask.indices);
    const mesh = new THREE.Mesh(geom, materialPool.getHighwayMask());
    mesh.renderOrder = 0;
    highwayMask = mesh;
  }

  // Highway shadow
  let highwayShadow: THREE.Object3D | null = null;
  if (cached.hwShadow) {
    const geom = geometryFromArrays(cached.hwShadow.positions, cached.hwShadow.indices);
    const mesh = new THREE.Mesh(geom, materialPool.getHighwayShadow());
    mesh.renderOrder = 2;
    highwayShadow = mesh;
  }

  // Local center line
  let localCenterLine: THREE.Object3D | null = null;
  if (cached.localCenterLine) {
    const geom = geometryFromArrays(cached.localCenterLine.positions, cached.localCenterLine.indices);
    const mesh = new THREE.Mesh(geom, materialPool.getLocalCenterLine());
    mesh.renderOrder = 1;
    localCenterLine = mesh;
  }

  // Highway center line
  let highwayCenterLine: THREE.Object3D | null = null;
  if (cached.hwCenterLine) {
    const geom = geometryFromArrays(cached.hwCenterLine.positions, cached.hwCenterLine.indices);
    const mesh = new THREE.Mesh(geom, materialPool.getHighwayCenterLine());
    mesh.renderOrder = 3;
    highwayCenterLine = mesh;
  }

  const localCasing = assembleGroup(localCasingMeshes, 1);
  const localFill = assembleGroup(localFillMeshes, 1);
  const hwCasing = assembleGroup(hwCasingMeshes, 3);
  const hwFill = assembleGroup(hwFillMeshes, 3);

  return {
    localCasing,
    localFill,
    localCenterLine,
    highwayMask,
    highwayShadow,
    highwayCasing: hwCasing,
    highwayFill: hwFill,
    highwayCenterLine,
  };
}

export function createRoadMeshes(
  roads: RoadData[],
  zoomLevel: number
): RoadMeshResult {
  const cached = buildRoadGeometryArrays(roads, zoomLevel);
  return createRoadMeshesFromArrays(cached);
}

function assembleGroup(meshes: THREE.Mesh[], renderOrder: number): THREE.Object3D | null {
  if (meshes.length === 0) return null;
  for (const m of meshes) m.renderOrder = renderOrder;
  if (meshes.length === 1) return meshes[0];
  const group = new THREE.Group();
  group.renderOrder = renderOrder;
  for (const m of meshes) group.add(m);
  return group;
}

export { computeMiterNormals };

export function buildRibbon(
  pts: Array<{ x: number; z: number }>,
  halfWidth: number,
  dashStyle: RoadStyle | null,
  yOffset: number,
  perVertexY?: number[],
  perVertexHalfWidth?: number[]
): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;

  const positions: number[] = [];
  const indices: number[] = [];

  const normals = computeMiterNormals(pts);

  if (dashStyle && dashStyle.dashed) {
    return buildDashedRibbon(pts, normals, halfWidth, dashStyle, yOffset, perVertexY);
  }

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = normals[i];
    const hw = perVertexHalfWidth ? perVertexHalfWidth[i] : halfWidth;
    const y = perVertexY ? perVertexY[i] + yOffset : yOffset;
    positions.push(p.x + n.x * hw, y, p.z + n.z * hw);
    positions.push(p.x - n.x * hw, y, p.z - n.z * hw);
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const vi = i * 2;
    indices.push(vi, vi + 2, vi + 1);
    indices.push(vi + 1, vi + 2, vi + 3);
  }

  if (positions.length < 6) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  return geom;
}

function buildDashedRibbon(
  pts: Array<{ x: number; z: number }>,
  normals: Array<{ x: number; z: number }>,
  halfWidth: number,
  style: RoadStyle,
  yOffset: number,
  perVertexY?: number[]
): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const dashOn = style.dashOn;
  const dashOff = style.dashOff;
  const dashTotal = dashOn + dashOff;
  let accumulated = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    if (segLen < 0.001) continue;

    const dirX = dx / segLen;
    const dirZ = dz / segLen;

    const y0 = perVertexY ? perVertexY[i] + yOffset : yOffset;
    const y1 = perVertexY ? perVertexY[i + 1] + yOffset : yOffset;

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
        const dashY0 = y0 + (y1 - y0) * t0;
        const dashY1 = y0 + (y1 - y0) * t1;

        const vi = vertexCount;
        positions.push(x0 + n0x * halfWidth, dashY0, z0 + n0z * halfWidth);
        positions.push(x0 - n0x * halfWidth, dashY0, z0 - n0z * halfWidth);
        positions.push(x1 + n1x * halfWidth, dashY1, z1 + n1z * halfWidth);
        positions.push(x1 - n1x * halfWidth, dashY1, z1 - n1z * halfWidth);

        indices.push(vi, vi + 2, vi + 1);
        indices.push(vi + 1, vi + 2, vi + 3);
        vertexCount += 4;
      }

      walked += step;
      accumulated += step;
    }
  }

  if (positions.length < 6) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  return geom;
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of materials) {
        if (!m) continue;
        if (m.userData?.shared) continue;
        if (m instanceof THREE.MeshBasicMaterial && m.map) {
          m.map.dispose();
        }
        m.dispose();
      }
    }
  });
}
