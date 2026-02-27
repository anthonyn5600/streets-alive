import * as THREE from 'three';
import earcut from 'earcut';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { project } from './projection';
import type { BuildingData } from './types';

const BUILDING_COLOR = 0xd4d0c8;

export function createBuildingMeshes(buildings: BuildingData[]): THREE.Mesh | null {
  if (buildings.length === 0) return null;

  const geometries: THREE.BufferGeometry[] = [];

  for (const bld of buildings) {
    const geom = extrudeBuilding(bld);
    if (geom) geometries.push(geom);
  }

  if (geometries.length === 0) return null;

  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();

  if (!merged) return null;

  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ color: BUILDING_COLOR, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'buildings';
  return mesh;
}

function extrudeBuilding(bld: BuildingData): THREE.BufferGeometry | null {
  const poly = bld.polygon;
  if (poly.length < 4) return null;

  // Project polygon to 2D (x, z in scene space)
  const projected: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < poly.length - 1; i++) { // skip last (duplicate of first in OSM)
    projected.push(project(poly[i]));
  }

  if (projected.length < 3) return null;

  // Flatten for earcut (x, z)
  const flatCoords: number[] = [];
  for (const p of projected) {
    flatCoords.push(p.x, p.z);
  }

  const indices = earcut(flatCoords, undefined, 2);
  if (indices.length === 0) return null;

  const n = projected.length;
  const height = bld.height;
  const minHeight = bld.minHeight;

  // Build vertex arrays
  // Top cap + bottom cap + side walls
  const positions: number[] = [];
  const indexArray: number[] = [];

  // Top cap vertices (y = height)
  for (const p of projected) {
    positions.push(p.x, height, p.z);
  }

  // Top cap indices
  for (const idx of indices) {
    indexArray.push(idx);
  }

  // Bottom cap vertices (y = minHeight)
  const bottomOffset = n;
  for (const p of projected) {
    positions.push(p.x, minHeight, p.z);
  }

  // Bottom cap indices (reversed winding)
  for (let i = 0; i < indices.length; i += 3) {
    indexArray.push(
      bottomOffset + indices[i + 2],
      bottomOffset + indices[i + 1],
      bottomOffset + indices[i]
    );
  }

  // Side walls
  const sideOffset = n * 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = projected[i];
    const p1 = projected[j];
    const vi = sideOffset + i * 4;

    // 4 vertices per wall segment
    positions.push(p0.x, height, p0.z);      // top-left
    positions.push(p1.x, height, p1.z);      // top-right
    positions.push(p1.x, minHeight, p1.z);   // bottom-right
    positions.push(p0.x, minHeight, p0.z);   // bottom-left

    // 2 triangles per wall
    indexArray.push(vi, vi + 1, vi + 2);
    indexArray.push(vi, vi + 2, vi + 3);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indexArray);
  return geom;
}
