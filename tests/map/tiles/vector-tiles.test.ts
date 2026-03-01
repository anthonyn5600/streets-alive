import { describe, it, expect } from 'vitest';
import { tileKey, bboxToTiles, latLngToTile, tileBBox } from '@/map/tiles/vector-tiles';

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

describe('latLngToTile', () => {
  it('computes correct tile for LA center at z=14', () => {
    const tile = latLngToTile(34.0522, -118.2437, 14);
    expect(tile.z).toBe(14);
    // LA at z=14 should produce x ~2822, y ~6539 (approximate)
    expect(tile.x).toBeGreaterThan(2800);
    expect(tile.x).toBeLessThan(2850);
    expect(tile.y).toBeGreaterThan(6500);
    expect(tile.y).toBeLessThan(6600);
  });

  it('computes (0,0) tile for equator/antimeridian at z=0', () => {
    const tile = latLngToTile(0, -180, 0);
    expect(tile.z).toBe(0);
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it('defaults to z=14 when zoom is omitted', () => {
    const tile = latLngToTile(34.0522, -118.2437);
    expect(tile.z).toBe(14);
  });
});

describe('tileBBox', () => {
  it('round-trips with latLngToTile', () => {
    const lat = 34.0522;
    const lng = -118.2437;
    const tile = latLngToTile(lat, lng, 14);
    const bbox = tileBBox(tile);

    // The original point should be inside the bbox
    expect(lat).toBeGreaterThanOrEqual(bbox.south);
    expect(lat).toBeLessThanOrEqual(bbox.north);
    expect(lng).toBeGreaterThanOrEqual(bbox.west);
    expect(lng).toBeLessThanOrEqual(bbox.east);
  });

  it('produces reasonable dimensions at z=14', () => {
    const tile = latLngToTile(34.0522, -118.2437, 14);
    const bbox = tileBBox(tile);

    const latSpan = bbox.north - bbox.south;
    const lngSpan = bbox.east - bbox.west;
    // At z=14, each tile is ~0.022 degrees lat/lng (~1.2km)
    expect(latSpan).toBeGreaterThan(0.01);
    expect(latSpan).toBeLessThan(0.05);
    expect(lngSpan).toBeGreaterThan(0.01);
    expect(lngSpan).toBeLessThan(0.05);
  });
});
