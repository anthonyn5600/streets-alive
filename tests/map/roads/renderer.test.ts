import { describe, it, expect } from 'vitest';
import { buildRibbon, createRoadMeshes } from '@/map/roads/renderer';
import { setCenter } from '@/map/projection';
import type { RoadStyle } from '@/map/types';

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
});

describe('createRoadMeshes', () => {
  it('produces localFill for residential road', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 1,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0523, lng: -118.2430 },
        { lat: 34.0525, lng: -118.2425 },
      ],
      type: 'residential',
      name: 'Test Rd',
      lanes: 2,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.localFill).not.toBeNull();
  });

  it('produces localCasing for primary road', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 2,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0525, lng: -118.2430 },
      ],
      type: 'primary',
      name: 'Main St',
      lanes: 2,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.localCasing).not.toBeNull();
  });

  it('produces localCenterLine for divided local roads (primary)', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 3,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2420 },
      ],
      type: 'primary',
      name: 'Main Blvd',
      lanes: 4,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.localCenterLine).not.toBeNull();
  });

  it('motorway produces highwayFill and highwayCasing', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 3,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2420 },
      ],
      type: 'motorway',
      name: 'I-10',
      lanes: 4,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.highwayFill).not.toBeNull();
    expect(result.highwayCasing).not.toBeNull();
    expect(result.highwayMask).not.toBeNull();
    expect(result.highwayShadow).not.toBeNull();
    expect(result.highwayCenterLine).not.toBeNull();
  });

  it('motorway does not produce local meshes', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 3,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2420 },
      ],
      type: 'motorway',
      name: 'I-10',
      lanes: 4,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.localFill).toBeNull();
    expect(result.localCasing).toBeNull();
    expect(result.localCenterLine).toBeNull();
  });

  it('no center line for minor roads (residential)', () => {
    setCenter(34.0522, -118.2437);
    const roads = [{
      id: 4,
      points: [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0523, lng: -118.2430 },
      ],
      type: 'residential',
      name: 'Side St',
      lanes: 2,
      oneway: 0 as const,
    }];
    const result = createRoadMeshes(roads, 10);
    expect(result.localCenterLine).toBeNull();
  });
});
