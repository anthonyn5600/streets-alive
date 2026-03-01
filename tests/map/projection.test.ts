import { describe, it, expect, beforeEach } from 'vitest';
import { project, unproject, setCenter } from '@/map/projection';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

describe('project / unproject', () => {
  it('round-trips approximately', () => {
    const original = { lat: 34.06, lng: -118.25 };
    const projected = project(original);
    const back = unproject(projected);
    expect(back.lat).toBeCloseTo(original.lat, 4);
    expect(back.lng).toBeCloseTo(original.lng, 4);
  });

  it('center projects to approximately origin', () => {
    const pt = project({ lat: 34.0522, lng: -118.2437 });
    expect(pt.x).toBeCloseTo(0, 1);
    expect(pt.z).toBeCloseTo(0, 1);
  });

  it('east increases X', () => {
    const pt = project({ lat: 34.0522, lng: -118.2400 });
    expect(pt.x).toBeGreaterThan(0);
  });

  it('south increases Z', () => {
    const pt = project({ lat: 34.0500, lng: -118.2437 });
    expect(pt.z).toBeGreaterThan(0);
  });

  it('north decreases Z', () => {
    const pt = project({ lat: 34.0550, lng: -118.2437 });
    expect(pt.z).toBeLessThan(0);
  });

  it('west decreases X', () => {
    const pt = project({ lat: 34.0522, lng: -118.2500 });
    expect(pt.x).toBeLessThan(0);
  });
});

describe('setCenter', () => {
  it('changes the projection origin', () => {
    // Project a point with default center
    const ptDefault = project({ lat: 34.06, lng: -118.25 });

    // Change center to a different location
    setCenter(40.7128, -74.0060); // NYC
    const ptNyc = project({ lat: 34.06, lng: -118.25 });

    // Same lat/lng should project to very different coords with different center
    expect(Math.abs(ptDefault.x - ptNyc.x)).toBeGreaterThan(1000);
  });
});

describe('edge cases', () => {
  it('distant point projects to large coordinates', () => {
    // ~1 degree away from center (~111km)
    const pt = project({ lat: 35.0522, lng: -118.2437 });
    expect(Math.abs(pt.z)).toBeGreaterThan(100000); // >100km in meters
  });

  it('round-trip precision at moderate distances', () => {
    // ~500m from center
    const original = { lat: 34.0567, lng: -118.2390 };
    const projected = project(original);
    const back = unproject(projected);
    expect(back.lat).toBeCloseTo(original.lat, 5);
    expect(back.lng).toBeCloseTo(original.lng, 5);
  });
});
