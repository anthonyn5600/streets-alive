import { describe, it, expect } from 'vitest';
import { smoothRampElevation, nearestHighwayElevFromPolylines } from '@/map/roads/elevation';
import type { HwPolylineElev } from '@/map/roads/elevation';

describe('smoothRampElevation', () => {
  it('returns 0 at t=0', () => {
    expect(smoothRampElevation(0)).toBe(0);
  });

  it('returns 1 at t=1', () => {
    expect(smoothRampElevation(1)).toBe(1);
  });

  it('returns 0.5 at t=0.5', () => {
    expect(smoothRampElevation(0.5)).toBe(0.5);
  });

  it('has gentle slope near endpoints', () => {
    const eps = 0.01;
    const slopeAtStart = smoothRampElevation(eps) / eps;
    const slopeAtEnd = (1 - smoothRampElevation(1 - eps)) / eps;
    // Derivative at t=0 and t=1 is 0, so slope near endpoints should be small
    expect(slopeAtStart).toBeLessThan(0.1);
    expect(slopeAtEnd).toBeLessThan(0.1);
  });

  it('is monotonically increasing on [0,1]', () => {
    let prev = smoothRampElevation(0);
    for (let t = 0.05; t <= 1.0; t += 0.05) {
      const val = smoothRampElevation(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });
});

describe('nearestHighwayElevFromPolylines', () => {
  const hwPolylines: HwPolylineElev[] = [
    {
      pts: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }],
      elevations: [5, 10, 15],
    },
  ];

  it('returns interpolated elevation at polyline mid-point', () => {
    // Point near (50, 0) — midpoint of first segment, elevation should be ~7.5
    const elev = nearestHighwayElevFromPolylines({ x: 50, z: 5 }, hwPolylines, 50);
    expect(elev).toBeCloseTo(7.5, 1);
  });

  it('returns interpolated elevation at segment boundary', () => {
    // Point near (100, 0) — boundary between segments, elevation = 10
    const elev = nearestHighwayElevFromPolylines({ x: 100, z: 2 }, hwPolylines, 50);
    expect(elev).toBeCloseTo(10, 1);
  });

  it('returns interpolated elevation on second segment', () => {
    // Point near (150, 0) — midpoint of second segment, elevation should be ~12.5
    const elev = nearestHighwayElevFromPolylines({ x: 150, z: 3 }, hwPolylines, 50);
    expect(elev).toBeCloseTo(12.5, 1);
  });

  it('returns null when point is beyond maxDist', () => {
    const elev = nearestHighwayElevFromPolylines({ x: 50, z: 100 }, hwPolylines, 50);
    expect(elev).toBeNull();
  });

  it('picks closest polyline when multiple exist', () => {
    const multi: HwPolylineElev[] = [
      { pts: [{ x: 0, z: 50 }, { x: 100, z: 50 }], elevations: [20, 20] },
      { pts: [{ x: 0, z: 0 }, { x: 100, z: 0 }], elevations: [5, 10] },
    ];
    // Point at (50, 5) is closer to second polyline (z=0)
    const elev = nearestHighwayElevFromPolylines({ x: 50, z: 5 }, multi, 50);
    expect(elev).toBeCloseTo(7.5, 1);
  });
});
