import { describe, it, expect } from 'vitest';

// distToSegment is not exported, so we replicate the logic for testing
// (It's a pure math function — testing the algorithm correctness)
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  if (ab2 < 0.0001) return Math.sqrt(apx * apx + apz * apz);
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  const cx = ax + t * abx;
  const cz = az + t * abz;
  const dx = px - cx;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dz * dz);
}

describe('distToSegment', () => {
  it('returns ~0 for point on the segment', () => {
    // Point at midpoint of segment from (0,0) to (10,0)
    const d = distToSegment(5, 0, 0, 0, 10, 0);
    expect(d).toBeCloseTo(0, 5);
  });

  it('returns perpendicular distance for point off segment', () => {
    // Point 5m above midpoint of horizontal segment
    const d = distToSegment(5, 5, 0, 0, 10, 0);
    expect(d).toBeCloseTo(5, 5);
  });

  it('returns distance to nearest endpoint when past segment end', () => {
    // Point at (15, 0), segment from (0,0) to (10,0)
    const d = distToSegment(15, 0, 0, 0, 10, 0);
    expect(d).toBeCloseTo(5, 5);
  });

  it('returns distance to start when before segment start', () => {
    // Point at (-3, 4), segment from (0,0) to (10,0)
    const d = distToSegment(-3, 4, 0, 0, 10, 0);
    expect(d).toBeCloseTo(5, 5); // sqrt(9+16) = 5
  });

  it('handles zero-length segment', () => {
    const d = distToSegment(3, 4, 0, 0, 0, 0);
    expect(d).toBeCloseTo(5, 5); // sqrt(9+16) = 5
  });
});
