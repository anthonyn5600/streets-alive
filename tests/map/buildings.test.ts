import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { buildBuildingGeometryArrays, createBuildingMeshes, createBuildingMeshFromArrays } from '@/map/buildings';
import { setCenter } from '@/map/projection';
import type { BuildingData } from '@/map/types';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

// Rectangular building polygon (closed ring — 5 points, first == last)
function makeRect(height = 15, minHeight = 0): BuildingData {
  const baseLat = 34.0522;
  const baseLng = -118.2437;
  const d = 0.0002; // ~20m
  return {
    id: 1,
    polygon: [
      { lat: baseLat, lng: baseLng },
      { lat: baseLat, lng: baseLng + d },
      { lat: baseLat + d, lng: baseLng + d },
      { lat: baseLat + d, lng: baseLng },
      { lat: baseLat, lng: baseLng }, // closed ring
    ],
    height,
    minHeight,
  };
}

describe('buildBuildingGeometryArrays', () => {
  it('returns null for empty input', () => {
    expect(buildBuildingGeometryArrays([])).toBeNull();
  });

  it('returns null for polygon with fewer than 4 vertices', () => {
    const building: BuildingData = {
      id: 1,
      polygon: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0523, lng: -118.2437 },
        { lat: 34.0522, lng: -118.2437 },
      ],
      height: 10,
      minHeight: 0,
    };
    expect(buildBuildingGeometryArrays([building])).toBeNull();
  });

  it('produces correct vertex count for a rectangle', () => {
    // Rectangle: 4 unique points (polygon has 5 with closed ring, minus 1 = 4)
    // Top cap: 4 vertices
    // Walls: 4 edges * 4 vertices each = 16
    // Total: 20 vertices
    const result = buildBuildingGeometryArrays([makeRect()]);
    expect(result).not.toBeNull();
    expect(result!.positions.length / 3).toBe(20);
    expect(result!.normals.length / 3).toBe(20);
    expect(result!.colors.length / 3).toBe(20);
  });

  it('top cap vertices are all at building height', () => {
    const height = 25;
    const result = buildBuildingGeometryArrays([makeRect(height)])!;
    // First 4 vertices are the top cap
    for (let i = 0; i < 4; i++) {
      expect(result.positions[i * 3 + 1]).toBe(height);
    }
  });

  it('top cap normals all point up (0, 1, 0)', () => {
    const result = buildBuildingGeometryArrays([makeRect()])!;
    for (let i = 0; i < 4; i++) {
      expect(result.normals[i * 3]).toBe(0);
      expect(result.normals[i * 3 + 1]).toBe(1);
      expect(result.normals[i * 3 + 2]).toBe(0);
    }
  });

  it('wall vertices span from height to minHeight', () => {
    const height = 20;
    const minHeight = 5;
    const result = buildBuildingGeometryArrays([makeRect(height, minHeight)])!;
    // Wall vertices start at index 4 (after top cap)
    // Each edge has 4 wall verts: top-left, top-right at height; bottom-right, bottom-left at minHeight
    const wallStart = 4;
    for (let edge = 0; edge < 4; edge++) {
      const base = wallStart + edge * 4;
      // First two at height
      expect(result.positions[(base + 0) * 3 + 1]).toBe(height);
      expect(result.positions[(base + 1) * 3 + 1]).toBe(height);
      // Last two at minHeight
      expect(result.positions[(base + 2) * 3 + 1]).toBe(minHeight);
      expect(result.positions[(base + 3) * 3 + 1]).toBe(minHeight);
    }
  });

  it('wall normals are horizontal (Y=0)', () => {
    const result = buildBuildingGeometryArrays([makeRect()])!;
    const wallStart = 4;
    for (let i = wallStart; i < 20; i++) {
      expect(result.normals[i * 3 + 1]).toBe(0);
    }
  });

  it('minHeight > 0 produces no Y=0 vertices', () => {
    const result = buildBuildingGeometryArrays([makeRect(20, 5)])!;
    for (let i = 0; i < result.positions.length / 3; i++) {
      expect(result.positions[i * 3 + 1]).not.toBe(0);
    }
  });

  it('tracks vertex ranges per building for multiple buildings', () => {
    const b1 = makeRect();
    const b2: BuildingData = {
      ...makeRect(),
      id: 2,
      polygon: b1.polygon.map(p => ({ lat: p.lat + 0.001, lng: p.lng + 0.001 })),
    };
    const result = buildBuildingGeometryArrays([b1, b2])!;

    expect(result.vertexRanges).toHaveLength(2);
    expect(result.vertexRanges[0].buildingId).toBe(1);
    expect(result.vertexRanges[1].buildingId).toBe(2);
    // Each rect produces 20 vertices
    expect(result.vertexRanges[0].startVertex).toBe(0);
    expect(result.vertexRanges[0].vertexCount).toBe(20);
    expect(result.vertexRanges[1].startVertex).toBe(20);
    expect(result.vertexRanges[1].vertexCount).toBe(20);
    // Total vertex count
    expect(result.positions.length / 3).toBe(40);
  });
});

describe('createBuildingMeshes', () => {
  it('returns null for empty input', () => {
    expect(createBuildingMeshes([])).toBeNull();
  });

  it('returns a mesh with correct vertex count for a rectangle', () => {
    const mesh = createBuildingMeshes([makeRect()])!;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry.getAttribute('position').count).toBe(20);
  });

  it('mesh has position, normal, and color attributes', () => {
    const mesh = createBuildingMeshes([makeRect()])!;
    expect(mesh.geometry.getAttribute('position')).toBeDefined();
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
  });
});

describe('createBuildingMeshFromArrays with colorMap', () => {
  it('applies colors to correct vertex ranges', () => {
    const b1 = makeRect();
    const b2: BuildingData = {
      ...makeRect(),
      id: 2,
      polygon: b1.polygon.map(p => ({ lat: p.lat + 0.001, lng: p.lng + 0.001 })),
    };
    const arrays = buildBuildingGeometryArrays([b1, b2])!;

    const colorMap = new Map<number, THREE.Color>();
    colorMap.set(2, new THREE.Color(1, 0, 0)); // Red for building 2

    const mesh = createBuildingMeshFromArrays(arrays, colorMap);
    const colorAttr = mesh.geometry.getAttribute('color');

    // Building 2 vertices start at index 20, verify they are red
    expect(colorAttr.getX(20)).toBeCloseTo(1, 2); // R
    expect(colorAttr.getY(20)).toBeCloseTo(0, 2); // G
    expect(colorAttr.getZ(20)).toBeCloseTo(0, 2); // B
  });
});
