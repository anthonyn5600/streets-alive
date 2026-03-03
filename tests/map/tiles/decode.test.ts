import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { decodeTile } from '@/map/tiles/decode';

vi.mock('@mapbox/vector-tile', () => ({
  VectorTile: vi.fn(),
  classifyRings: vi.fn(((rings: unknown[]) => (rings as unknown[][]).map((r: unknown[]) => [r])) as any),
}));

vi.mock('pbf', () => ({ default: vi.fn() }));

const TILE = { z: 14, x: 2811, y: 6541 };
const RING = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const LINE = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

function mockVT(layers: Record<string, unknown>) {
  vi.mocked(VectorTile).mockImplementation(function() { return { layers }; } as any);
}

function makeLayer(features: object[]) {
  return { length: features.length, feature: (i: number) => features[i] };
}

beforeEach(() => {
  vi.mocked(VectorTile).mockReset();
  vi.mocked(classifyRings).mockImplementation(
    ((rings: unknown[]) => (rings as unknown[][]).map((r: unknown[]) => [r])) as any
  );
});

describe('decodeTile buildings', () => {
  it('returns empty arrays when no relevant layers exist', () => {
    mockVT({});
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.buildings).toHaveLength(0);
    expect(result.roads).toHaveLength(0);
    expect(result.landUse).toHaveLength(0);
  });

  it('uses render_height when provided', () => {
    mockVT({
      building: makeLayer([{
        type: 3, id: 1, extent: 4096,
        properties: { render_height: 25, render_min_height: 0 },
        loadGeometry: () => [RING],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.buildings[0].height).toBe(25);
  });

  it('generates seeded height when render_height is 0', () => {
    mockVT({
      building: makeLayer([{
        type: 3, id: 42, extent: 4096,
        properties: { render_height: 0, render_min_height: 0 },
        loadGeometry: () => [RING],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.buildings[0].height).toBeGreaterThan(0);
    expect(result.buildings[0].height).toBeLessThanOrEqual(15);
  });

  it('reads render_min_height', () => {
    mockVT({
      building: makeLayer([{
        type: 3, id: 1, extent: 4096,
        properties: { render_height: 10, render_min_height: 5 },
        loadGeometry: () => [RING],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.buildings[0].minHeight).toBe(5);
  });

  it('skips non-polygon features (type !== 3)', () => {
    mockVT({
      building: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { render_height: 10 },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.buildings).toHaveLength(0);
  });
});

describe('decodeTile roads — class mapping', () => {
  it('maps minor class to residential', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'minor' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].type).toBe('residential');
  });

  it('passes motorway class through unchanged', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'motorway' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].type).toBe('motorway');
  });

  it('skips roads with unknown class', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'unknown_xyz' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads).toHaveLength(0);
  });

  it('subclass footway overrides minor class', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'minor', subclass: 'footway' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].type).toBe('footway');
  });

  it('steps subclass maps to footway', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'path', subclass: 'steps' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].type).toBe('footway');
  });

  it('ramp property appends _link to type', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'motorway', ramp: 1 },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].type).toBe('motorway_link');
  });
});

describe('decodeTile roads — oneway', () => {
  it.each([
    [1, 1],
    [-1, -1],
    [0, 0],
  ] as [number, 0 | 1 | -1][])('oneway=%d is preserved', (raw, expected) => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'primary', oneway: raw },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].oneway).toBe(expected);
  });

  it('missing oneway defaults to 0', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'primary' },
        loadGeometry: () => [LINE],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].oneway).toBe(0);
  });
});

describe('decodeTile road names', () => {
  it('applies name from transportation_name when point matches', () => {
    const sharedPoint = { x: 500, y: 500 };
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'primary' },
        loadGeometry: () => [[sharedPoint, { x: 600, y: 500 }]],
      }]),
      transportation_name: makeLayer([{
        type: 2, id: 2, extent: 4096,
        properties: { name: 'Main Street' },
        loadGeometry: () => [[sharedPoint, { x: 700, y: 500 }]],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].name).toBe('Main Street');
  });

  it('leaves name empty when no matching point', () => {
    mockVT({
      transportation: makeLayer([{
        type: 2, id: 1, extent: 4096,
        properties: { class: 'primary' },
        loadGeometry: () => [LINE],
      }]),
      transportation_name: makeLayer([{
        type: 2, id: 2, extent: 4096,
        properties: { name: 'Oak Ave' },
        loadGeometry: () => [[{ x: 9999, y: 9999 }, { x: 9998, y: 9999 }]],
      }]),
    });
    const result = decodeTile(new ArrayBuffer(0), TILE);
    expect(result.roads[0].name).toBe('');
  });
});
