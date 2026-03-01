import { describe, it, expect, beforeEach } from 'vitest';
import { buildRibbon, computeMiterNormals, buildRoadGeometryArrays } from '@/map/roads/renderer';
import { setCenter } from '@/map/projection';
import type { RoadStyle, RoadData } from '@/map/types';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

const dashedStyle: RoadStyle = {
  fillColor: 0xf0c14b,
  casingColor: null,
  fillWidth: 1,
  casingWidth: 0,
  dashed: true,
  dashOn: 4,
  dashOff: 4,
  minZoom: 0,
};

describe('buildRibbon', () => {
  it('returns null for fewer than 2 points', () => {
    const result = buildRibbon([{ x: 0, z: 0 }], 5, null, 0.05);
    expect(result).toBeNull();
  });

  it('produces 4 vertices for a 2-point solid line', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const geom = buildRibbon(pts, 5, null, 0.05);
    expect(geom).not.toBeNull();
    const posAttr = geom!.getAttribute('position');
    expect(posAttr.count).toBe(4);
  });

  it('dashed ribbon terminates and produces vertices', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 50 }];
    const geom = buildRibbon(pts, 0.5, dashedStyle, 0.06);
    expect(geom).not.toBeNull();
    const posAttr = geom!.getAttribute('position');
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('dashed ribbon with short segment still works', () => {
    const pts = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
    const geom = buildRibbon(pts, 0.5, dashedStyle, 0.06);
    expect(geom).not.toBeNull();
  });

  it('supports per-vertex half-width', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }];
    const perVertexHW = [5, 3, 0];
    const geom = buildRibbon(pts, 5, null, 0.05, undefined, perVertexHW);
    expect(geom).not.toBeNull();
    const posAttr = geom!.getAttribute('position');
    expect(posAttr.count).toBe(6);
    const lastLeftZ = posAttr.getZ(4);
    const lastRightZ = posAttr.getZ(5);
    expect(lastLeftZ).toBe(lastRightZ);
  });

  it('applies Y offset to all vertices', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const yOffset = 0.35;
    const geom = buildRibbon(pts, 5, null, yOffset)!;
    const posAttr = geom.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      expect(posAttr.getY(i)).toBeCloseTo(yOffset, 5);
    }
  });

  it('ribbon width matches 2 * halfWidth', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const halfWidth = 7;
    const geom = buildRibbon(pts, halfWidth, null, 0)!;
    const posAttr = geom.getAttribute('position');
    // For a horizontal line, the ribbon extends in Z direction
    // Left vertex Z - right vertex Z should be ~2*halfWidth
    const leftZ = posAttr.getZ(0);
    const rightZ = posAttr.getZ(1);
    expect(Math.abs(leftZ - rightZ)).toBeCloseTo(2 * halfWidth, 1);
  });

  it('applies per-vertex Y elevation', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const perVertexY = [10, 20];
    const yOffset = 0.05;
    const geom = buildRibbon(pts, 5, null, yOffset, perVertexY)!;
    const posAttr = geom.getAttribute('position');
    // First pair of vertices at perVertexY[0] + yOffset
    expect(posAttr.getY(0)).toBeCloseTo(10 + yOffset, 3);
    expect(posAttr.getY(1)).toBeCloseTo(10 + yOffset, 3);
    // Second pair at perVertexY[1] + yOffset
    expect(posAttr.getY(2)).toBeCloseTo(20 + yOffset, 3);
    expect(posAttr.getY(3)).toBeCloseTo(20 + yOffset, 3);
  });
});

describe('computeMiterNormals', () => {
  it('produces perpendicular normals for a straight horizontal line', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }];
    const normals = computeMiterNormals(pts);

    expect(normals).toHaveLength(3);
    // For a line along +X, normal should be in -Z direction (perpendicular)
    for (const n of normals) {
      expect(n.x).toBeCloseTo(0, 3);
      expect(Math.abs(n.z)).toBeCloseTo(1, 3);
    }
  });

  it('produces averaged miter at a right-angle turn', () => {
    // Line goes right then down: (0,0) -> (100,0) -> (100,100)
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }];
    const normals = computeMiterNormals(pts);

    expect(normals).toHaveLength(3);
    // First point: perpendicular to (0,0)->(100,0) => normal in Z
    expect(normals[0].x).toBeCloseTo(0, 3);
    // Middle point: averaged miter of the two segments
    // Both components should be non-zero for a corner
    const midLen = Math.sqrt(normals[1].x ** 2 + normals[1].z ** 2);
    expect(midLen).toBeGreaterThan(0);
    // Last point: perpendicular to (100,0)->(100,100) => normal in X
    expect(Math.abs(normals[2].x)).toBeGreaterThan(0.5);
  });

  it('handles two-point segment', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const normals = computeMiterNormals(pts);
    expect(normals).toHaveLength(2);
    // Both should be perpendicular to direction
    expect(normals[0].x).toBeCloseTo(0, 3);
    expect(normals[1].x).toBeCloseTo(0, 3);
  });
});

describe('buildRoadGeometryArrays', () => {
  function makeRoad(type: string): RoadData {
    return {
      id: 1,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2420 },
      ],
      type,
      name: 'Test',
      lanes: 4,
      oneway: 0,
    };
  }

  it('divided road produces fill layers', () => {
    const result = buildRoadGeometryArrays([makeRoad('primary')], 10);
    expect(result.localFill.length).toBeGreaterThan(0);
  });

  it('highway produces mask and shadow layers', () => {
    const result = buildRoadGeometryArrays([makeRoad('motorway')], 10);
    expect(result.hwMask).not.toBeNull();
    expect(result.hwShadow).not.toBeNull();
  });

  it('highway produces center line', () => {
    const result = buildRoadGeometryArrays([makeRoad('motorway')], 10);
    expect(result.hwCenterLine).not.toBeNull();
  });

  it('residential produces no highway layers', () => {
    const result = buildRoadGeometryArrays([makeRoad('residential')], 10);
    expect(result.hwMask).toBeNull();
    expect(result.hwShadow).toBeNull();
    expect(result.hwFill).toEqual([]);
    expect(result.hwCasing).toEqual([]);
    expect(result.hwCenterLine).toBeNull();
  });
});
