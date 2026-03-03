import * as THREE from 'three';
import { materialPool } from './materials';
import { geometryFromArrays } from './tiles/geometry-cache';
import type { CachedColoredRoadLayer } from './tiles/geometry-cache';

export function createLandUseMeshFromArrays(
  layers: CachedColoredRoadLayer[]
): THREE.Mesh | null {
  if (layers.length === 0) return null;

  let totalVerts = 0;
  let totalIdx = 0;
  for (const layer of layers) {
    totalVerts += layer.positions.length / 3;
    totalIdx += layer.indices.length;
  }
  if (totalVerts === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);

  let vOff = 0;
  let iOff = 0;

  for (const layer of layers) {
    const subVertCount = layer.positions.length / 3;
    const subIdxCount = layer.indices.length;

    positions.set(layer.positions, vOff * 3);

    const c = new THREE.Color(layer.color);
    for (let v = 0; v < subVertCount; v++) {
      const ci = (vOff + v) * 3;
      colors[ci] = c.r;
      colors[ci + 1] = c.g;
      colors[ci + 2] = c.b;
    }

    for (let i = 0; i < subIdxCount; i++) {
      indices[iOff + i] = layer.indices[i] + vOff;
    }

    vOff += subVertCount;
    iOff += subIdxCount;
  }

  const geom = geometryFromArrays(positions, indices, undefined, colors);
  geom.computeBoundingSphere();

  const mesh = new THREE.Mesh(geom, materialPool.getLandUse());
  mesh.name = 'landuse';
  return mesh;
}
