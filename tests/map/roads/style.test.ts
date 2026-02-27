import { describe, it, expect } from 'vitest';
import { getRoadStyle, isDividedRoad } from '@/map/roads/style';

describe('getRoadStyle', () => {
  it('returns style for known road types', () => {
    expect(getRoadStyle('motorway', 0)).not.toBeNull();
    expect(getRoadStyle('residential', 10)).not.toBeNull();
    expect(getRoadStyle('primary', 5)).not.toBeNull();
    expect(getRoadStyle('service', 10)).not.toBeNull();
  });

  it('returns null for unknown road types', () => {
    expect(getRoadStyle('imaginary_road', 10)).toBeNull();
    expect(getRoadStyle('', 10)).toBeNull();
  });

  it('returns null when zoom is below minZoom', () => {
    // residential has minZoom 3
    expect(getRoadStyle('residential', 1)).toBeNull();
    // service has minZoom 5
    expect(getRoadStyle('service', 2)).toBeNull();
  });

  it('returns style when zoom meets minZoom', () => {
    expect(getRoadStyle('residential', 3)).not.toBeNull();
    expect(getRoadStyle('service', 5)).not.toBeNull();
  });
});

describe('isDividedRoad', () => {
  it('returns true for divided road types', () => {
    expect(isDividedRoad('motorway')).toBe(true);
    expect(isDividedRoad('trunk')).toBe(true);
    expect(isDividedRoad('primary')).toBe(true);
  });

  it('returns false for non-divided road types', () => {
    expect(isDividedRoad('residential')).toBe(false);
    expect(isDividedRoad('service')).toBe(false);
    expect(isDividedRoad('tertiary')).toBe(false);
    expect(isDividedRoad('footway')).toBe(false);
    expect(isDividedRoad('unknown')).toBe(false);
  });
});
