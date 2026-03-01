import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createRoadMeshes } from '@/map/roads/renderer';
import { createBuildingMeshes } from '@/map/buildings';
import { setCenter } from '@/map/projection';
import type { RoadData, BuildingData } from '@/map/types';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

function getVertexCount(obj: THREE.Object3D): number {
  let count = 0;
  obj.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const posAttr = child.geometry?.getAttribute('position');
      if (posAttr) count += posAttr.count;
    }
  });
  return count;
}

function makeSampleRoad(type: string): RoadData {
  return {
    id: 100,
    points: [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0525, lng: -118.2430 },
      { lat: 34.0528, lng: -118.2425 },
    ],
    type,
    name: 'Test Road',
    lanes: 2,
    oneway: 0,
  };
}

function makeSampleBuilding(): BuildingData {
  const baseLat = 34.0522;
  const baseLng = -118.2437;
  const d = 0.0003;
  return {
    id: 200,
    polygon: [
      { lat: baseLat, lng: baseLng },
      { lat: baseLat, lng: baseLng + d },
      { lat: baseLat + d, lng: baseLng + d },
      { lat: baseLat + d, lng: baseLng },
      { lat: baseLat, lng: baseLng },
    ],
    height: 20,
    minHeight: 0,
  };
}

describe('scene integration', () => {
  it('motorway renders flat (no elevated geometry)', () => {
    const result = createRoadMeshes([makeSampleRoad('motorway')], 10);
    expect(result.highwayFill).not.toBeNull();
    result.highwayFill!.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const pos = child.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          expect(pos.getY(i)).toBeLessThan(1);
        }
      }
    });
  });

  it('residential does not produce highway meshes', () => {
    const result = createRoadMeshes([makeSampleRoad('residential')], 10);
    expect(result.highwayFill).toBeNull();
    expect(result.highwayCasing).toBeNull();
    expect(result.highwayMask).toBeNull();
    expect(result.highwayShadow).toBeNull();
  });

  it('buildings and roads together produce meshes with geometry', () => {
    const roads = [makeSampleRoad('secondary'), makeSampleRoad('residential')];
    const buildings = [makeSampleBuilding()];

    const roadResult = createRoadMeshes(roads, 10);
    const buildingMesh = createBuildingMeshes(buildings);

    expect(roadResult.localFill).not.toBeNull();
    expect(getVertexCount(roadResult.localFill!)).toBeGreaterThan(0);

    expect(buildingMesh).not.toBeNull();
    expect(buildingMesh!.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
});
