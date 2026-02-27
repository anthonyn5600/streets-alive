import { describe, it, expect } from 'vitest';
import { tileKey, bboxToTiles } from '@/map/tiles/vector-tiles';

describe('tileKey', () => {
  it('returns z/x/y format', () => {
    expect(tileKey({ z: 14, x: 2811, y: 6541 })).toBe('14/2811/6541');
  });

  it('handles zero values', () => {
    expect(tileKey({ z: 0, x: 0, y: 0 })).toBe('0/0/0');
  });
});

describe('bboxToTiles', () => {
  it('returns expected tiles for a known LA bbox', () => {
    // Small bbox around LA center at z=14
    const tiles = bboxToTiles({
      north: 34.06,
      south: 34.04,
      west: -118.26,
      east: -118.23,
    });
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.z).toBe(14);
      expect(t.x).toBeGreaterThan(0);
      expect(t.y).toBeGreaterThan(0);
    }
  });

  it('returns at least 1 tile for a tiny bbox', () => {
    const tiles = bboxToTiles({
      north: 34.053,
      south: 34.052,
      west: -118.244,
      east: -118.243,
    });
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
});
