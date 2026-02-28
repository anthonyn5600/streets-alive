import * as THREE from 'three';
import earcut from 'earcut';
import { project } from './projection';
import { materialPool } from './materials';
import { geometryFromArrays, applyBuildingColorsToArrays } from './tiles/geometry-cache';
import type { BuildingData } from './types';
import type { CachedBuildingArrays, BuildingVertexRange } from './tiles/geometry-cache';

const DEFAULT_COLOR = new THREE.Color(0xd4d0c8);
const DEFAULT_R = DEFAULT_COLOR.r;
const DEFAULT_G = DEFAULT_COLOR.g;
const DEFAULT_B = DEFAULT_COLOR.b;

export function buildBuildingGeometryArrays(
  buildings: BuildingData[]
): CachedBuildingArrays | null {
  if (buildings.length === 0) return null;

  // Pass 1: project polygons, run earcut, count total sizes
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
      projected.push(project(poly[i]));
    }
    if (projected.length < 3) continue;

    const flatCoords: number[] = [];
    for (const p of projected) {
      flatCoords.push(p.x, p.z);
    }

    const earcutIndices = earcut(flatCoords, undefined, 2);
    if (earcutIndices.length === 0) continue;

    const n = projected.length;
    // Top cap: n vertices, earcutIndices.length indices
    // Side walls: n * 4 vertices, n * 6 indices (no bottom cap)
    totalVertices += n + n * 4;
    totalIndices += earcutIndices.length + n * 6;

    preps.push({ projected, earcutIndices, building: bld, n });
  }

  if (preps.length === 0) return null;

  // Allocate final arrays once
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  const ranges: BuildingVertexRange[] = [];

  let vOff = 0;
  let iOff = 0;

  // Pass 2: fill arrays directly
  for (const { projected, earcutIndices, building, n } of preps) {
    const height = building.height;
    const minHeight = building.minHeight;
    const startVertex = vOff;

    // Top cap vertices (y = height, normal pointing up)
    for (let i = 0; i < n; i++) {
      const p = projected[i];
      const vi3 = (vOff + i) * 3;
      positions[vi3] = p.x;
      positions[vi3 + 1] = height;
      positions[vi3 + 2] = p.z;
      normals[vi3] = 0;
      normals[vi3 + 1] = 1;
      normals[vi3 + 2] = 0;
      colors[vi3] = DEFAULT_R;
      colors[vi3 + 1] = DEFAULT_G;
      colors[vi3 + 2] = DEFAULT_B;
    }

    for (let i = 0; i < earcutIndices.length; i++) {
      indices[iOff + i] = vOff + earcutIndices[i];
    }
    iOff += earcutIndices.length;
    vOff += n;

    // Side walls (4 vertices per edge, flat normals)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = projected[i];
      const p1 = projected[j];

      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      let nx = 0, nz = 0;
      if (len > 0) {
        nx = dz / len;
        nz = -dx / len;
      }

      const base = vOff;

      let vi3 = base * 3;
      positions[vi3] = p0.x; positions[vi3 + 1] = height; positions[vi3 + 2] = p0.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = DEFAULT_R; colors[vi3 + 1] = DEFAULT_G; colors[vi3 + 2] = DEFAULT_B;

      vi3 = (base + 1) * 3;
      positions[vi3] = p1.x; positions[vi3 + 1] = height; positions[vi3 + 2] = p1.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = DEFAULT_R; colors[vi3 + 1] = DEFAULT_G; colors[vi3 + 2] = DEFAULT_B;

      vi3 = (base + 2) * 3;
      positions[vi3] = p1.x; positions[vi3 + 1] = minHeight; positions[vi3 + 2] = p1.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = DEFAULT_R; colors[vi3 + 1] = DEFAULT_G; colors[vi3 + 2] = DEFAULT_B;

      vi3 = (base + 3) * 3;
      positions[vi3] = p0.x; positions[vi3 + 1] = minHeight; positions[vi3 + 2] = p0.z;
      normals[vi3] = nx; normals[vi3 + 1] = 0; normals[vi3 + 2] = nz;
      colors[vi3] = DEFAULT_R; colors[vi3 + 1] = DEFAULT_G; colors[vi3 + 2] = DEFAULT_B;

      indices[iOff] = base;
      indices[iOff + 1] = base + 1;
      indices[iOff + 2] = base + 2;
      indices[iOff + 3] = base;
      indices[iOff + 4] = base + 2;
      indices[iOff + 5] = base + 3;
      iOff += 6;
      vOff += 4;
    }

    ranges.push({
      buildingId: building.id,
      startVertex,
      vertexCount: vOff - startVertex,
    });
  }

  return { positions, normals, indices, colors, vertexRanges: ranges };
}

export function createBuildingMeshFromArrays(
  cached: CachedBuildingArrays,
  colorMap?: Map<number, THREE.Color>
): THREE.Mesh {
  const colors = colorMap
    ? applyBuildingColorsToArrays(cached, colorMap, DEFAULT_COLOR)
    : cached.colors;

  const geom = geometryFromArrays(cached.positions, cached.indices, cached.normals, colors);
  geom.computeBoundingSphere();

  const mesh = new THREE.Mesh(geom, materialPool.getBuilding());
  mesh.name = 'buildings';
  return mesh;
}

export function createBuildingMeshes(
  buildings: BuildingData[],
  colorMap?: Map<number, THREE.Color>
): THREE.Mesh | null {
  const cached = buildBuildingGeometryArrays(buildings);
  if (!cached) return null;
  return createBuildingMeshFromArrays(cached, colorMap);
}
