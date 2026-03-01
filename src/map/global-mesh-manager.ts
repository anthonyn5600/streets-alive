import * as THREE from 'three';
import { materialPool } from './materials';
import type { TileKey } from './types';
import type {
  CachedTileGeometry,
  CachedBuildingArrays,
  CachedColoredRoadLayer,
  CachedRoadLayerArrays,
  BuildingVertexRange,
} from './tiles/geometry-cache';

type LayerId =
  | 'buildings'
  | 'localCasing' | 'localFill' | 'localCenterLine'
  | 'hwMask' | 'hwShadow' | 'hwCasing' | 'hwFill' | 'hwCenterLine'
  | 'onewayArrows';

interface TileSlot {
  vertexOffset: number;
  vertexCount: number;
  indexOffset: number;
  indexCount: number;
}

interface LayerState {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array | null;
  colors: Float32Array | null;
  usedVertices: number;
  usedIndices: number;
  freedVertices: number;
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  tileSlots: Map<TileKey, TileSlot>;
}

const BLDG_INITIAL_VERTS = 150_000;
const BLDG_INITIAL_IDX = 300_000;
const LOCAL_ROAD_VERTS = 30_000;
const LOCAL_ROAD_IDX = 60_000;
const HW_ROAD_VERTS = 15_000;
const HW_ROAD_IDX = 30_000;
const CENTER_LINE_VERTS = 10_000;
const CENTER_LINE_IDX = 20_000;
const ONEWAY_VERTS = 5_000;
const ONEWAY_IDX = 5_000;

const ROAD_LAYERS: LayerId[] = [
  'localCasing', 'localFill', 'localCenterLine',
  'hwMask', 'hwShadow', 'hwCasing', 'hwFill', 'hwCenterLine',
  'onewayArrows',
];

export class GlobalMeshManager {
  private layers = new Map<LayerId, LayerState>();
  private scene: THREE.Scene;
  private buildingVertexRanges = new Map<TileKey, BuildingVertexRange[]>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initLayers();
  }

  private initLayers() {
    this.createLayer('buildings', {
      material: materialPool.getBuilding(),
      renderOrder: 0,
      hasNormals: true,
      hasColors: true,
      initialVertices: BLDG_INITIAL_VERTS,
      initialIndices: BLDG_INITIAL_IDX,
    });

    this.createLayer('localCasing', {
      material: materialPool.getLocalVertexColorRoad(),
      renderOrder: 1,
      hasNormals: false,
      hasColors: true,
      initialVertices: LOCAL_ROAD_VERTS,
      initialIndices: LOCAL_ROAD_IDX,
    });

    this.createLayer('localFill', {
      material: materialPool.getLocalVertexColorRoad(),
      renderOrder: 1,
      hasNormals: false,
      hasColors: true,
      initialVertices: LOCAL_ROAD_VERTS,
      initialIndices: LOCAL_ROAD_IDX,
    });

    this.createLayer('localCenterLine', {
      material: materialPool.getLocalCenterLine(),
      renderOrder: 1,
      hasNormals: false,
      hasColors: false,
      initialVertices: CENTER_LINE_VERTS,
      initialIndices: CENTER_LINE_IDX,
    });

    this.createLayer('hwMask', {
      material: materialPool.getHighwayMask(),
      renderOrder: 0,
      hasNormals: false,
      hasColors: false,
      initialVertices: HW_ROAD_VERTS,
      initialIndices: HW_ROAD_IDX,
    });

    this.createLayer('hwShadow', {
      material: materialPool.getHighwayShadow(),
      renderOrder: 2,
      hasNormals: false,
      hasColors: false,
      initialVertices: HW_ROAD_VERTS,
      initialIndices: HW_ROAD_IDX,
    });

    this.createLayer('hwCasing', {
      material: materialPool.getHighwayVertexColorRoad(),
      renderOrder: 3,
      hasNormals: false,
      hasColors: true,
      initialVertices: HW_ROAD_VERTS,
      initialIndices: HW_ROAD_IDX,
    });

    this.createLayer('hwFill', {
      material: materialPool.getHighwayVertexColorRoad(),
      renderOrder: 3,
      hasNormals: false,
      hasColors: true,
      initialVertices: HW_ROAD_VERTS,
      initialIndices: HW_ROAD_IDX,
    });

    this.createLayer('hwCenterLine', {
      material: materialPool.getHighwayCenterLine(),
      renderOrder: 3,
      hasNormals: false,
      hasColors: false,
      initialVertices: CENTER_LINE_VERTS,
      initialIndices: CENTER_LINE_IDX,
    });

    this.createLayer('onewayArrows', {
      material: materialPool.getOnewayArrows(),
      renderOrder: 1,
      hasNormals: false,
      hasColors: false,
      initialVertices: ONEWAY_VERTS,
      initialIndices: ONEWAY_IDX,
    });
  }

  private createLayer(id: LayerId, config: {
    material: THREE.Material;
    renderOrder: number;
    hasNormals: boolean;
    hasColors: boolean;
    initialVertices: number;
    initialIndices: number;
  }) {
    const positions = new Float32Array(config.initialVertices * 3);
    const indices = new Uint32Array(config.initialIndices);
    const normals = config.hasNormals ? new Float32Array(config.initialVertices * 3) : null;
    const colors = config.hasColors ? new Float32Array(config.initialVertices * 3) : null;

    const geometry = new THREE.BufferGeometry();
    this.setBufferAttributes(geometry, positions, indices, normals, colors);
    geometry.setDrawRange(0, 0);

    const mesh = new THREE.Mesh(geometry, config.material);
    mesh.renderOrder = config.renderOrder;
    mesh.frustumCulled = false;
    mesh.name = `global-${id}`;
    this.scene.add(mesh);

    this.layers.set(id, {
      positions, indices, normals, colors,
      usedVertices: 0, usedIndices: 0, freedVertices: 0,
      geometry, mesh,
      tileSlots: new Map(),
    });
  }

  private setBufferAttributes(
    geom: THREE.BufferGeometry,
    positions: Float32Array,
    indices: Uint32Array,
    normals: Float32Array | null,
    colors: Float32Array | null,
  ) {
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', posAttr);

    const idxAttr = new THREE.BufferAttribute(indices, 1);
    idxAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setIndex(idxAttr);

    if (normals) {
      const normAttr = new THREE.BufferAttribute(normals, 3);
      normAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('normal', normAttr);
    }
    if (colors) {
      const colAttr = new THREE.BufferAttribute(colors, 3);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('color', colAttr);
    }
  }

  appendTile(key: TileKey, cached: CachedTileGeometry) {
    if (cached.buildings) {
      this.appendBuildings(key, cached.buildings);
    }
    this.appendColoredLayers(key, 'localCasing', cached.roads.localCasing);
    this.appendColoredLayers(key, 'localFill', cached.roads.localFill);
    this.appendSingleLayer(key, 'localCenterLine', cached.roads.localCenterLine);
    this.appendSingleLayer(key, 'hwMask', cached.roads.hwMask);
    this.appendSingleLayer(key, 'hwShadow', cached.roads.hwShadow);
    this.appendColoredLayers(key, 'hwCasing', cached.roads.hwCasing);
    this.appendColoredLayers(key, 'hwFill', cached.roads.hwFill);
    this.appendSingleLayer(key, 'hwCenterLine', cached.roads.hwCenterLine);
    this.appendSingleLayer(key, 'onewayArrows', cached.roads.onewayArrows);
  }

  removeTile(key: TileKey) {
    this.buildingVertexRanges.delete(key);

    for (const layer of this.layers.values()) {
      const slot = layer.tileSlots.get(key);
      if (!slot) continue;

      const posStart = slot.vertexOffset * 3;
      const posEnd = posStart + slot.vertexCount * 3;
      layer.positions.fill(0, posStart, posEnd);

      const posAttr = layer.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.needsUpdate = true;

      layer.freedVertices += slot.vertexCount;
      layer.tileSlots.delete(key);
    }

    this.maybeCompact();
  }

  setLayerVisibility(group: 'buildings' | 'roads', visible: boolean) {
    if (group === 'buildings') {
      this.layers.get('buildings')!.mesh.visible = visible;
    } else {
      for (const id of ROAD_LAYERS) {
        this.layers.get(id)!.mesh.visible = visible;
      }
    }
  }

  setBuildingScale(scaleY: number) {
    this.layers.get('buildings')!.mesh.scale.y = scaleY;
  }

  updateBuildingColors(colorMap: Map<number, THREE.Color>, defaultColor: THREE.Color) {
    const layer = this.layers.get('buildings')!;
    if (!layer.colors) return;

    for (const ranges of this.buildingVertexRanges.values()) {
      for (const range of ranges) {
        const color = colorMap.get(range.buildingId) ?? defaultColor;
        const r = color.r, g = color.g, b = color.b;
        for (let v = range.startVertex; v < range.startVertex + range.vertexCount; v++) {
          layer.colors[v * 3] = r;
          layer.colors[v * 3 + 1] = g;
          layer.colors[v * 3 + 2] = b;
        }
      }
    }

    const colAttr = layer.geometry.attributes.color as THREE.BufferAttribute;
    colAttr.needsUpdate = true;
  }

  updateBuildingColorsForTile(key: TileKey, colorMap: Map<number, THREE.Color>, defaultColor: THREE.Color) {
    const ranges = this.buildingVertexRanges.get(key);
    if (!ranges) return;
    const layer = this.layers.get('buildings')!;
    if (!layer.colors) return;

    for (const range of ranges) {
      const color = colorMap.get(range.buildingId) ?? defaultColor;
      const r = color.r, g = color.g, b = color.b;
      for (let v = range.startVertex; v < range.startVertex + range.vertexCount; v++) {
        layer.colors[v * 3] = r;
        layer.colors[v * 3 + 1] = g;
        layer.colors[v * 3 + 2] = b;
      }
    }

    const colAttr = layer.geometry.attributes.color as THREE.BufferAttribute;
    colAttr.needsUpdate = true;
  }

  private appendBuildings(key: TileKey, data: CachedBuildingArrays) {
    const layer = this.layers.get('buildings')!;
    const vertexCount = data.positions.length / 3;
    const indexCount = data.indices.length;

    this.ensureCapacity(layer, vertexCount, indexCount);
    const vOff = layer.usedVertices;
    const iOff = layer.usedIndices;

    layer.positions.set(data.positions, vOff * 3);
    if (layer.normals) layer.normals.set(data.normals, vOff * 3);
    if (layer.colors) layer.colors.set(data.colors, vOff * 3);

    for (let i = 0; i < indexCount; i++) {
      layer.indices[iOff + i] = data.indices[i] + vOff;
    }

    layer.tileSlots.set(key, { vertexOffset: vOff, vertexCount, indexOffset: iOff, indexCount });
    layer.usedVertices += vertexCount;
    layer.usedIndices += indexCount;

    this.buildingVertexRanges.set(key, data.vertexRanges.map(r => ({
      ...r,
      startVertex: r.startVertex + vOff,
    })));

    this.markDirty(layer);
  }

  private appendColoredLayers(key: TileKey, layerId: LayerId, subLayers: CachedColoredRoadLayer[]) {
    if (subLayers.length === 0) return;

    const layer = this.layers.get(layerId)!;
    let totalVerts = 0;
    let totalIdx = 0;
    for (const sub of subLayers) {
      totalVerts += sub.positions.length / 3;
      totalIdx += sub.indices.length;
    }
    if (totalVerts === 0) return;

    this.ensureCapacity(layer, totalVerts, totalIdx);
    const baseVOff = layer.usedVertices;
    const baseIOff = layer.usedIndices;
    let localVOff = 0;
    let localIOff = 0;

    for (const sub of subLayers) {
      const subVertCount = sub.positions.length / 3;
      const subIdxCount = sub.indices.length;
      const vOff = baseVOff + localVOff;
      const iOff = baseIOff + localIOff;

      layer.positions.set(sub.positions, vOff * 3);

      if (layer.colors) {
        const c = new THREE.Color(sub.color);
        const r = c.r, g = c.g, b = c.b;
        for (let v = 0; v < subVertCount; v++) {
          const ci = (vOff + v) * 3;
          layer.colors[ci] = r;
          layer.colors[ci + 1] = g;
          layer.colors[ci + 2] = b;
        }
      }

      for (let i = 0; i < subIdxCount; i++) {
        layer.indices[iOff + i] = sub.indices[i] + vOff;
      }

      localVOff += subVertCount;
      localIOff += subIdxCount;
    }

    layer.tileSlots.set(key, {
      vertexOffset: baseVOff, vertexCount: totalVerts,
      indexOffset: baseIOff, indexCount: totalIdx,
    });
    layer.usedVertices += totalVerts;
    layer.usedIndices += totalIdx;

    this.markDirty(layer);
  }

  private appendSingleLayer(key: TileKey, layerId: LayerId, data: CachedRoadLayerArrays | null) {
    if (!data) return;

    const layer = this.layers.get(layerId)!;
    const vertexCount = data.positions.length / 3;
    const indexCount = data.indices.length;
    if (vertexCount === 0) return;

    this.ensureCapacity(layer, vertexCount, indexCount);
    const vOff = layer.usedVertices;
    const iOff = layer.usedIndices;

    layer.positions.set(data.positions, vOff * 3);

    for (let i = 0; i < indexCount; i++) {
      layer.indices[iOff + i] = data.indices[i] + vOff;
    }

    layer.tileSlots.set(key, { vertexOffset: vOff, vertexCount, indexOffset: iOff, indexCount });
    layer.usedVertices += vertexCount;
    layer.usedIndices += indexCount;

    this.markDirty(layer);
  }

  private ensureCapacity(layer: LayerState, addVerts: number, addIdx: number) {
    const maxVerts = layer.positions.length / 3;
    const maxIdx = layer.indices.length;

    let newMaxVerts = maxVerts;
    let newMaxIdx = maxIdx;
    let needsRealloc = false;

    while (layer.usedVertices + addVerts > newMaxVerts) {
      newMaxVerts = Math.ceil(newMaxVerts * 1.5);
      needsRealloc = true;
    }
    while (layer.usedIndices + addIdx > newMaxIdx) {
      newMaxIdx = Math.ceil(newMaxIdx * 1.5);
      needsRealloc = true;
    }

    if (!needsRealloc) return;

    const newPos = new Float32Array(newMaxVerts * 3);
    newPos.set(layer.positions.subarray(0, layer.usedVertices * 3));
    layer.positions = newPos;

    const newIdx = new Uint32Array(newMaxIdx);
    newIdx.set(layer.indices.subarray(0, layer.usedIndices));
    layer.indices = newIdx;

    if (layer.normals) {
      const newNorm = new Float32Array(newMaxVerts * 3);
      newNorm.set(layer.normals.subarray(0, layer.usedVertices * 3));
      layer.normals = newNorm;
    }
    if (layer.colors) {
      const newCol = new Float32Array(newMaxVerts * 3);
      newCol.set(layer.colors.subarray(0, layer.usedVertices * 3));
      layer.colors = newCol;
    }

    this.setBufferAttributes(layer.geometry, layer.positions, layer.indices, layer.normals, layer.colors);
  }

  private markDirty(layer: LayerState) {
    (layer.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (layer.geometry.index as THREE.BufferAttribute).needsUpdate = true;
    if (layer.normals) {
      (layer.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    }
    if (layer.colors) {
      (layer.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    layer.geometry.setDrawRange(0, layer.usedIndices);
  }

  private maybeCompact() {
    for (const [id, layer] of this.layers) {
      if (layer.usedVertices === 0) continue;
      if (layer.freedVertices / layer.usedVertices < 0.3) continue;
      this.compactLayer(id, layer);
    }
  }

  private compactLayer(layerId: LayerId, layer: LayerState) {
    const sorted = Array.from(layer.tileSlots.entries())
      .sort(([, a], [, b]) => a.vertexOffset - b.vertexOffset);

    const newPos = new Float32Array(layer.positions.length);
    const newIdx = new Uint32Array(layer.indices.length);
    const newNorm = layer.normals ? new Float32Array(layer.normals.length) : null;
    const newCol = layer.colors ? new Float32Array(layer.colors.length) : null;

    let newVOff = 0;
    let newIOff = 0;

    for (const [key, slot] of sorted) {
      const srcV3 = slot.vertexOffset * 3;
      const dstV3 = newVOff * 3;
      const len3 = slot.vertexCount * 3;

      newPos.set(layer.positions.subarray(srcV3, srcV3 + len3), dstV3);
      if (newNorm && layer.normals) {
        newNorm.set(layer.normals.subarray(srcV3, srcV3 + len3), dstV3);
      }
      if (newCol && layer.colors) {
        newCol.set(layer.colors.subarray(srcV3, srcV3 + len3), dstV3);
      }

      const vertexDelta = newVOff - slot.vertexOffset;
      for (let i = 0; i < slot.indexCount; i++) {
        newIdx[newIOff + i] = layer.indices[slot.indexOffset + i] + vertexDelta;
      }

      if (layerId === 'buildings' && vertexDelta !== 0) {
        const ranges = this.buildingVertexRanges.get(key);
        if (ranges) {
          for (const range of ranges) {
            range.startVertex += vertexDelta;
          }
        }
      }

      layer.tileSlots.set(key, {
        vertexOffset: newVOff, vertexCount: slot.vertexCount,
        indexOffset: newIOff, indexCount: slot.indexCount,
      });

      newVOff += slot.vertexCount;
      newIOff += slot.indexCount;
    }

    layer.positions = newPos;
    layer.indices = newIdx;
    layer.normals = newNorm;
    layer.colors = newCol;
    layer.usedVertices = newVOff;
    layer.usedIndices = newIOff;
    layer.freedVertices = 0;

    this.setBufferAttributes(layer.geometry, layer.positions, layer.indices, layer.normals, layer.colors);
    layer.geometry.setDrawRange(0, layer.usedIndices);
  }

  dispose() {
    for (const layer of this.layers.values()) {
      this.scene.remove(layer.mesh);
      layer.geometry.dispose();
    }
    this.layers.clear();
    this.buildingVertexRanges.clear();
  }
}
