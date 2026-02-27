import { describe, it, expect, beforeEach } from 'vitest';
import { createBuildingMeshes } from '@/map/buildings';
import { setCenter } from '@/map/projection';
import type { BuildingData } from '@/map/types';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

// Simple rectangular building polygon (closed ring — 5 points, first == last)
function makeRect(): BuildingData {
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
    height: 15,
    minHeight: 0,
  };
}

describe('createBuildingMeshes', () => {
  it('produces a mesh for a rectangular building', () => {
    const mesh = createBuildingMeshes([makeRect()]);
    expect(mesh).not.toBeNull();
    const posAttr = mesh!.geometry.getAttribute('position');
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('building has vertices at the requested height', () => {
    const building = makeRect();
    building.height = 25;
    const mesh = createBuildingMeshes([building]);
    expect(mesh).not.toBeNull();

    const posAttr = mesh!.geometry.getAttribute('position');
    const arr = posAttr.array as Float32Array;
    // Y values are at indices 1, 4, 7, ... (every 3rd starting from 1)
    let hasHeight = false;
    for (let i = 1; i < arr.length; i += 3) {
      if (Math.abs(arr[i] - 25) < 0.01) {
        hasHeight = true;
        break;
      }
    }
    expect(hasHeight).toBe(true);
  });

  it('returns null for empty input', () => {
    const mesh = createBuildingMeshes([]);
    expect(mesh).toBeNull();
  });

  it('handles multiple buildings', () => {
    const b1 = makeRect();
    const b2 = { ...makeRect(), id: 2 };
    b2.polygon = b2.polygon.map(p => ({ lat: p.lat + 0.001, lng: p.lng + 0.001 }));
    const mesh = createBuildingMeshes([b1, b2]);
    expect(mesh).not.toBeNull();
  });
});
