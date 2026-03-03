import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GlobalMeshManager } from '@/map/global-mesh-manager';
import type {
  CachedTileGeometry,
  CachedBuildingArrays,
  CachedRoadLayerArrays,
  CachedColoredRoadLayer,
} from '@/map/tiles/geometry-cache';

vi.mock('@/map/materials', () => ({
  materialPool: {
    getBuilding: () => new THREE.MeshBasicMaterial(),
    getLocalVertexColorRoad: () => new THREE.MeshBasicMaterial(),
    getLocalCenterLine: () => new THREE.MeshBasicMaterial(),
    getHighwayMask: () => new THREE.MeshBasicMaterial(),
    getHighwayShadow: () => new THREE.MeshBasicMaterial(),
    getHighwayVertexColorRoad: () => new THREE.MeshBasicMaterial(),
    getHighwayCenterLine: () => new THREE.MeshBasicMaterial(),
    getOnewayArrows: () => new THREE.MeshBasicMaterial(),
  },
}));

function makeEmptyCached(): CachedTileGeometry {
  return {
    buildings: null,
    roads: {
      localCasing: [],
      localFill: [],
      localCenterLine: null,
      hwMask: null,
      hwShadow: null,
      hwCasing: [],
      hwFill: [],
      hwCenterLine: null,
      onewayArrows: null,
    },
    labelPlacements: null,
    landUse: [],
  };
}

function makeBuildingArrays(vertexCount: number, indexCount = 3): CachedBuildingArrays {
  const positions = new Float32Array(vertexCount * 3).fill(1);
  const normals = new Float32Array(vertexCount * 3).fill(1);
  const colors = new Float32Array(vertexCount * 3).fill(0.5);
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) indices[i] = i % vertexCount;
  return { positions, normals, colors, indices, vertexRanges: [{ buildingId: 1, startVertex: 0, vertexCount }] };
}

function makeRoadLayer(vertexCount: number): CachedRoadLayerArrays {
  return {
    positions: new Float32Array(vertexCount * 3).fill(1),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function makeColoredLayer(vertexCount: number, color = 0xff0000): CachedColoredRoadLayer {
  return {
    positions: new Float32Array(vertexCount * 3).fill(1),
    indices: new Uint32Array([0, 1, 2]),
    color,
  };
}

function getMesh(scene: THREE.Scene, name: string): THREE.Mesh {
  return scene.children.find(c => c.name === name) as THREE.Mesh;
}

let scene: THREE.Scene;
let mgr: GlobalMeshManager;

beforeEach(() => {
  scene = new THREE.Scene();
  mgr = new GlobalMeshManager(scene);
});

describe('GlobalMeshManager construction', () => {
  it('adds 10 named meshes to the scene', () => {
    expect(scene.children).toHaveLength(10);
    const expectedNames = [
      'global-buildings',
      'global-localCasing', 'global-localFill', 'global-localCenterLine',
      'global-hwMask', 'global-hwShadow', 'global-hwCasing', 'global-hwFill', 'global-hwCenterLine',
      'global-onewayArrows',
    ];
    const names = scene.children.map(c => c.name);
    for (const n of expectedNames) {
      expect(names).toContain(n);
    }
  });

  it('all meshes start with drawRange count of 0', () => {
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.geometry.drawRange.count).toBe(0);
    }
  });
});

describe('GlobalMeshManager.appendTile', () => {
  it('buildings drawRange increases after appending a tile with building data', () => {
    const cached = makeEmptyCached();
    cached.buildings = makeBuildingArrays(4, 6);
    mgr.appendTile('14/0/0', cached);

    const mesh = getMesh(scene, 'global-buildings');
    expect(mesh.geometry.drawRange.count).toBe(6);
  });

  it('road layer drawRange increases after appending a tile with road data', () => {
    const cached = makeEmptyCached();
    cached.roads.localCenterLine = makeRoadLayer(4);
    mgr.appendTile('14/0/0', cached);

    const mesh = getMesh(scene, 'global-localCenterLine');
    expect(mesh.geometry.drawRange.count).toBe(3);
  });

  it('colored road layer drawRange increases after appending', () => {
    const cached = makeEmptyCached();
    cached.roads.localCasing = [makeColoredLayer(4)];
    mgr.appendTile('14/0/0', cached);

    const mesh = getMesh(scene, 'global-localCasing');
    expect(mesh.geometry.drawRange.count).toBe(3);
  });

  it('second tile indices are offset by first tile vertex count', () => {
    // Tile 1: 3 vertices, indices [0, 1, 2]
    const cached1 = makeEmptyCached();
    cached1.buildings = makeBuildingArrays(3, 3);

    // Tile 2: 3 vertices, indices [0, 1, 2] → stored as [3, 4, 5]
    const cached2 = makeEmptyCached();
    cached2.buildings = makeBuildingArrays(3, 3);

    mgr.appendTile('14/0/0', cached1);
    mgr.appendTile('14/0/1', cached2);

    const mesh = getMesh(scene, 'global-buildings');
    const idxArr = (mesh.geometry.index as THREE.BufferAttribute).array as Uint32Array;
    // First 3 indices are from tile 1 (0, 1, 2); next 3 are tile 2 offset by 3
    expect(idxArr[3]).toBe(3);
    expect(idxArr[4]).toBe(4);
    expect(idxArr[5]).toBe(5);
  });
});

describe('GlobalMeshManager.removeTile', () => {
  it('drawRange resets to 0 after removing the only tile', () => {
    const cached = makeEmptyCached();
    cached.buildings = makeBuildingArrays(3, 3);
    mgr.appendTile('14/0/0', cached);

    expect(getMesh(scene, 'global-buildings').geometry.drawRange.count).toBe(3);

    mgr.removeTile('14/0/0');

    // 100% freed → compaction runs → drawRange resets to 0
    expect(getMesh(scene, 'global-buildings').geometry.drawRange.count).toBe(0);
  });

  it('preserves other tile data after partial removal', () => {
    const cached1 = makeEmptyCached();
    cached1.roads.localCenterLine = makeRoadLayer(4);
    const cached2 = makeEmptyCached();
    cached2.roads.localCenterLine = makeRoadLayer(4);

    mgr.appendTile('14/0/0', cached1);
    mgr.appendTile('14/0/1', cached2);

    // 6 indices total (3 per tile)
    const mesh = getMesh(scene, 'global-localCenterLine');
    expect(mesh.geometry.drawRange.count).toBe(6);

    mgr.removeTile('14/0/0');

    // One tile removed, other still present
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  });
});

describe('GlobalMeshManager.setLayerVisibility', () => {
  it('hides buildings mesh when set to false', () => {
    mgr.setLayerVisibility('buildings', false);
    expect(getMesh(scene, 'global-buildings').visible).toBe(false);
  });

  it('shows buildings mesh when set to true', () => {
    mgr.setLayerVisibility('buildings', false);
    mgr.setLayerVisibility('buildings', true);
    expect(getMesh(scene, 'global-buildings').visible).toBe(true);
  });

  it('hides all road meshes when roads visibility set to false', () => {
    mgr.setLayerVisibility('roads', false);
    const roadNames = [
      'global-localCasing', 'global-localFill', 'global-localCenterLine',
      'global-hwMask', 'global-hwShadow', 'global-hwCasing', 'global-hwFill',
      'global-hwCenterLine', 'global-onewayArrows',
    ];
    for (const name of roadNames) {
      expect(getMesh(scene, name).visible).toBe(false);
    }
  });
});

describe('GlobalMeshManager.dispose', () => {
  it('removes all meshes from the scene', () => {
    mgr.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
