import { describe, it, expect } from 'vitest';
import {
  smoothRampElevation,
  nearestHighwayElevFromPolylines,
  computeHighwayElevations,
  smoothElevations,
} from '@/map/roads/elevation';
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
    const elev = nearestHighwayElevFromPolylines({ x: 50, z: 5 }, hwPolylines, 50);
    expect(elev).toBeCloseTo(7.5, 1);
  });

  it('returns interpolated elevation at segment boundary', () => {
    const elev = nearestHighwayElevFromPolylines({ x: 100, z: 2 }, hwPolylines, 50);
    expect(elev).toBeCloseTo(10, 1);
  });

  it('returns interpolated elevation on second segment', () => {
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
    const elev = nearestHighwayElevFromPolylines({ x: 50, z: 5 }, multi, 50);
    expect(elev).toBeCloseTo(7.5, 1);
  });
});

describe('computeHighwayElevations', () => {
  it('returns same-length array as input points', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }];
    const elevs = computeHighwayElevations(pts);
    expect(elevs).toHaveLength(pts.length);
  });

  it('assigns ~12m to N-S road (bearing ~0/180 degrees)', () => {
    // Points going due south (negative Z direction in scene = south)
    // bearing = atan2(dx, -dz), dx=0, -dz > 0 => bearing ~0 => N-S => tier 1 => 12m
    const pts = [{ x: 0, z: 0 }, { x: 0, z: -100 }];
    const elevs = computeHighwayElevations(pts);
    // Smoothing may affect values but should be close to 12
    for (const e of elevs) {
      expect(e).toBeCloseTo(12, 0);
    }
  });

  it('assigns ~6m to E-W road (bearing ~90/270 degrees)', () => {
    // Points going due east
    // bearing = atan2(dx, -dz), dx>0, dz=0 => bearing ~90 => E-W => tier 0 => 6m
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const elevs = computeHighwayElevations(pts);
    for (const e of elevs) {
      expect(e).toBeCloseTo(6, 0);
    }
  });

  it('all values are positive', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: -50 }, { x: 100, z: 0 }];
    const elevs = computeHighwayElevations(pts);
    for (const e of elevs) {
      expect(e).toBeGreaterThan(0);
    }
  });
});

describe('smoothElevations', () => {
  it('returns same-length array as input', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }];
    const elevs = [6, 6, 6];
    const smoothed = smoothElevations(elevs, pts);
    expect(smoothed).toHaveLength(3);
  });

  it('leaves uniform elevations unchanged', () => {
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }];
    const elevs = [10, 10, 10];
    const smoothed = smoothElevations(elevs, pts);
    for (const e of smoothed) {
      expect(e).toBeCloseTo(10, 5);
    }
  });

  it('smooths a spike toward neighbors', () => {
    // Three points close together, middle one spiked
    const pts = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 60, z: 0 }];
    const elevs = [6, 12, 6];
    const smoothed = smoothElevations(elevs, pts);
    // Middle should be pulled toward 6 (not still exactly 12)
    expect(smoothed[1]).toBeLessThan(12);
    expect(smoothed[1]).toBeGreaterThan(6);
  });

  it('does not affect distant points beyond smoothing radius', () => {
    // Points 200m apart (SMOOTH_DIST = 100m internal), each only influenced by self
    const pts = [{ x: 0, z: 0 }, { x: 200, z: 0 }];
    const elevs = [6, 12];
    const smoothed = smoothElevations(elevs, pts);
    expect(smoothed[0]).toBeCloseTo(6, 1);
    expect(smoothed[1]).toBeCloseTo(12, 1);
  });

  it('preserves endpoints when only self-influenced', () => {
    const pts = [{ x: 0, z: 0 }, { x: 500, z: 0 }];
    const elevs = [6, 12];
    const smoothed = smoothElevations(elevs, pts);
    expect(smoothed[0]).toBe(6);
    expect(smoothed[1]).toBe(12);
  });
});
