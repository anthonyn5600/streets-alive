import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { project } from '../projection';
import {
  getRoadPriority,
  getRoadStyle,
  isDividedRoad,
  isHighwayType,
  HIGHWAY_MASK_EXTRA,
  HIGHWAY_SHADOW_EXTRA,
} from './style';
import type { RoadData, RoadStyle } from '../types';

const LOCAL_CASING_Y = 0.02;
const LOCAL_FILL_Y = 0.05;
const HW_SHADOW_Y = 0.06;
const HW_CASING_Y = 0.065;
const HW_FILL_Y = 0.07;
const CENTER_LINE_Y = 0.075;
const PRIORITY_STEP = 0.001;

const CENTER_LINE_COLOR = 0xf0c14b;
const CENTER_LINE_HALF_WIDTH = 0.5;
const CENTER_LINE_DASH_ON = 4;
const CENTER_LINE_DASH_OFF = 4;

const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.15;

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

export function createRoadMeshes(
  roads: RoadData[],
  zoomLevel: number
): RoadMeshResult {
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

    // Highway mask + shadow ribbons
    if (isHw) {
      const maskHalfWidth = style.casingWidth / 2 + HIGHWAY_MASK_EXTRA;
      const maskGeom = buildRibbon(pts, maskHalfWidth, null, HW_SHADOW_Y);
      if (maskGeom) hwMaskGeoms.push(maskGeom);

      const shadowHalfWidth = style.casingWidth / 2 + HIGHWAY_SHADOW_EXTRA;
      const shadowGeom = buildRibbon(pts, shadowHalfWidth, null, HW_SHADOW_Y);
      if (shadowGeom) hwShadowGeoms.push(shadowGeom);
    }

    // Fill ribbons (divided lanes or single)
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

    // Center line for divided roads
    if (isDividedRoad(road.type)) {
      const clGeom = buildRibbon(pts, CENTER_LINE_HALF_WIDTH, centerLineDashStyle, CENTER_LINE_Y);
      if (clGeom) {
        if (isHw) hwCenterLineGeoms.push(clGeom);
        else localCenterLineGeoms.push(clGeom);
      }
    }

    // Casing ribbon
    if (style.casingColor !== null) {
      const casingGeom = buildRibbon(pts, style.casingWidth / 2, null, casingY);
      if (casingGeom) {
        if (!casingColors.has(style.casingColor)) casingColors.set(style.casingColor, []);
        casingColors.get(style.casingColor)!.push(casingGeom);
      }
    }
  }

  // --- Build local road meshes (with stencil test) ---
  const localCasingMeshes = buildColorMeshes(localCasingColors, {
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    stencilWrite: false,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilRef: 1,
    stencilFuncMask: 0xff,
  });

  const localFillMeshes = buildColorMeshes(localFillColors, {
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    stencilWrite: false,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilRef: 1,
    stencilFuncMask: 0xff,
  });

  // --- Build highway meshes (no stencil test) ---
  const hwCasingMeshes = buildColorMeshes(hwCasingColors, {
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const hwFillMeshes = buildColorMeshes(hwFillColors, {
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // --- Highway mask (invisible, writes stencil) ---
  let highwayMask: THREE.Object3D | null = null;
  if (hwMaskGeoms.length > 0) {
    const merged = mergeGeometries(hwMaskGeoms, false);
    for (const g of hwMaskGeoms) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 0;
      highwayMask = mesh;
    }
  }

  // --- Highway shadow (semi-transparent dark outline) ---
  let highwayShadow: THREE.Object3D | null = null;
  if (hwShadowGeoms.length > 0) {
    const merged = mergeGeometries(hwShadowGeoms, false);
    for (const g of hwShadowGeoms) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        color: SHADOW_COLOR,
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 2;
      highwayShadow = mesh;
    }
  }

  // --- Local center line ---
  let localCenterLine: THREE.Object3D | null = null;
  if (localCenterLineGeoms.length > 0) {
    const merged = mergeGeometries(localCenterLineGeoms, false);
    for (const g of localCenterLineGeoms) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        color: CENTER_LINE_COLOR,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        stencilWrite: false,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilRef: 1,
        stencilFuncMask: 0xff,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 1;
      localCenterLine = mesh;
    }
  }

  // --- Highway center line ---
  let highwayCenterLine: THREE.Object3D | null = null;
  if (hwCenterLineGeoms.length > 0) {
    const merged = mergeGeometries(hwCenterLineGeoms, false);
    for (const g of hwCenterLineGeoms) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        color: CENTER_LINE_COLOR,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.renderOrder = 3;
      highwayCenterLine = mesh;
    }
  }

  // --- Assemble local groups with renderOrder ---
  const localCasing = assembleGroup(localCasingMeshes, 1);
  const localFill = assembleGroup(localFillMeshes, 1);

  const hwCasing = assembleGroup(hwCasingMeshes, 3);
  const hwFill = assembleGroup(hwFillMeshes, 3);

  return {
    localCasing: localCasing,
    localFill: localFill,
    localCenterLine: localCenterLine,
    highwayMask: highwayMask,
    highwayShadow: highwayShadow,
    highwayCasing: hwCasing,
    highwayFill: hwFill,
    highwayCenterLine: highwayCenterLine,
  };
}

interface MaterialOptions {
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  stencilWrite?: boolean;
  stencilFunc?: THREE.StencilFunc;
  stencilRef?: number;
  stencilFuncMask?: number;
}

function buildColorMeshes(
  colorMap: Map<number, THREE.BufferGeometry[]>,
  opts: MaterialOptions
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const [color, geoms] of colorMap) {
    if (geoms.length === 0) continue;
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      polygonOffset: opts.polygonOffset,
      polygonOffsetFactor: opts.polygonOffsetFactor,
      polygonOffsetUnits: opts.polygonOffsetUnits,
    });
    if (opts.stencilFunc !== undefined) {
      mat.stencilWrite = opts.stencilWrite ?? false;
      mat.stencilFunc = opts.stencilFunc;
      mat.stencilRef = opts.stencilRef ?? 0;
      mat.stencilFuncMask = opts.stencilFuncMask ?? 0xff;
      mat.stencilFail = THREE.KeepStencilOp;
      mat.stencilZFail = THREE.KeepStencilOp;
      mat.stencilZPass = THREE.KeepStencilOp;
    }
    meshes.push(new THREE.Mesh(merged, mat));
  }
  return meshes;
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

export function computeMiterNormals(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
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
          nx *= scale;
          nz *= scale;
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
        if (m instanceof THREE.MeshBasicMaterial && m.map) {
          m.map.dispose();
        }
        m.dispose();
      }
    }
  });
}
