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
