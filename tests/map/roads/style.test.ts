import { describe, it, expect } from 'vitest';
import {
  getRoadStyle,
  isDividedRoad,
  isDefaultOneway,
  getRoadPriority,
  isHighwayType,
  getHighwayTier,
  getHighwayElevation,
  getLaneOffset,
  getCasingWidth,
  getParkingOffset,
  HIGHWAY_BASE_ELEVATION,
  HIGHWAY_TIER_STEP,
} from '@/map/roads/style';

describe('getRoadStyle', () => {
  it('returns style for known road types', () => {
    const motorway = getRoadStyle('motorway', 0);
    expect(motorway).not.toBeNull();
    expect(motorway!.fillWidth).toBe(18);
    expect(motorway!.fillColor).toBe(0xf0c14b);
  });

  it('returns null for unknown road types', () => {
    expect(getRoadStyle('imaginary_road', 10)).toBeNull();
    expect(getRoadStyle('', 10)).toBeNull();
  });

  it('returns null when zoom is below minZoom', () => {
    expect(getRoadStyle('residential', 1)).toBeNull();
    expect(getRoadStyle('service', 2)).toBeNull();
  });

  it('returns style when zoom meets minZoom', () => {
    expect(getRoadStyle('residential', 3)).not.toBeNull();
    expect(getRoadStyle('service', 5)).not.toBeNull();
  });
});

describe('isDividedRoad', () => {
  it.each(['motorway', 'trunk', 'primary'])('returns true for %s', (type) => {
    expect(isDividedRoad(type)).toBe(true);
  });

  it.each(['residential', 'service'])(
    'returns false for %s', (type) => {
      expect(isDividedRoad(type)).toBe(false);
    }
  );
});

describe('isDefaultOneway', () => {
  it.each(['motorway', 'motorway_link', 'trunk', 'trunk_link'])(
    'returns true for %s', (type) => {
      expect(isDefaultOneway(type)).toBe(true);
    }
  );

  it.each(['primary', 'residential'])(
    'returns false for %s', (type) => {
      expect(isDefaultOneway(type)).toBe(false);
    }
  );
});

describe('getRoadPriority', () => {
  it.each([
    ['motorway', 3],
    ['motorway_link', 3],
    ['trunk', 2],
    ['trunk_link', 2],
    ['primary', 1],
    ['secondary', 1],
    ['residential', 0],
    ['service', 0],
    ['tertiary', 0],
  ] as const)('returns %i for %s', (type, expected) => {
    expect(getRoadPriority(type)).toBe(expected);
  });
});

describe('isHighwayType', () => {
  it.each(['motorway', 'motorway_link', 'trunk', 'trunk_link'])(
    'returns true for %s', (type) => {
      expect(isHighwayType(type)).toBe(true);
    }
  );

  it.each(['primary', 'residential'])(
    'returns false for %s', (type) => {
      expect(isHighwayType(type)).toBe(false);
    }
  );
});

describe('getHighwayTier', () => {
  it('returns tier 1 for due north (0 degrees)', () => {
    expect(getHighwayTier(0)).toBe(1);
  });

  it('returns tier 1 for due south (180 degrees)', () => {
    expect(getHighwayTier(180)).toBe(1);
  });

  it('returns tier 0 for due east (90 degrees)', () => {
    expect(getHighwayTier(90)).toBe(0);
  });

  it('returns tier 1 at boundary 315 degrees (N-S side)', () => {
    expect(getHighwayTier(315)).toBe(1);
  });

  it('returns tier 0 at boundary 45 degrees (E-W side)', () => {
    expect(getHighwayTier(45)).toBe(0);
  });

  it('normalizes negative bearings', () => {
    expect(getHighwayTier(-90)).toBe(0); // same as 270
  });
});

describe('getHighwayElevation', () => {
  it('returns 6m for tier 0 (E-W)', () => {
    expect(getHighwayElevation(0)).toBe(HIGHWAY_BASE_ELEVATION);
    expect(getHighwayElevation(0)).toBe(6);
  });

  it('returns 12m for tier 1 (N-S)', () => {
    expect(getHighwayElevation(1)).toBe(HIGHWAY_BASE_ELEVATION + HIGHWAY_TIER_STEP);
    expect(getHighwayElevation(1)).toBe(12);
  });
});

describe('getLaneOffset', () => {
  it('returns fillWidth * 0.3 for divided roads', () => {
    // primary has fillWidth 14, is divided
    expect(getLaneOffset('primary')).toBeCloseTo(14 * 0.3, 5);
  });

  it('returns fillWidth * 0.25 for non-divided roads', () => {
    // residential has fillWidth 7, not divided
    expect(getLaneOffset('residential')).toBeCloseTo(7 * 0.25, 5);
  });

  it('returns 0 for unknown road type', () => {
    expect(getLaneOffset('nonexistent')).toBe(0);
  });
});

describe('getCasingWidth', () => {
  it('returns casing width for known type', () => {
    expect(getCasingWidth('motorway')).toBe(22);
    expect(getCasingWidth('residential')).toBe(11);
  });

  it('returns 11 for unknown type', () => {
    expect(getCasingWidth('nonexistent')).toBe(11);
  });
});

describe('getParkingOffset', () => {
  it('computes correct offset for residential', () => {
    // residential casingWidth = 11
    // offset = casingWidth/2 - 1 - 0.15 = 5.5 - 1 - 0.15 = 4.35
    expect(getParkingOffset('residential')).toBeCloseTo(4.35, 5);
  });

  it('returns 0 for road types without casing', () => {
    // footway has casingColor=null, casingWidth=0
    expect(getParkingOffset('footway')).toBe(0);
  });

  it('returns 0 for unknown road types', () => {
    expect(getParkingOffset('nonexistent')).toBe(0);
  });
});
