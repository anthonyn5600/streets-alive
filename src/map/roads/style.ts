import type { RoadStyle } from '../types';

// minZoom values calibrated for our zoom formula: log2(20000 / cameraDistance)
// Initial view at 500m height ≈ zoom 5.3
const ROAD_STYLES: Record<string, RoadStyle> = {
  motorway: {
    fillColor: 0xf0c14b,
    casingColor: 0xc49a2a,
    fillWidth: 18,
    casingWidth: 22,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  motorway_link: {
    fillColor: 0xf0c14b,
    casingColor: 0xc49a2a,
    fillWidth: 10,
    casingWidth: 14,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  trunk: {
    fillColor: 0xf5a623,
    casingColor: 0xc4841d,
    fillWidth: 16,
    casingWidth: 20,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  trunk_link: {
    fillColor: 0xf5a623,
    casingColor: 0xc4841d,
    fillWidth: 10,
    casingWidth: 14,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  primary: {
    fillColor: 0xffffff,
    casingColor: 0xb0b0b0,
    fillWidth: 14,
    casingWidth: 18,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  secondary: {
    fillColor: 0xffffff,
    casingColor: 0xcccccc,
    fillWidth: 11,
    casingWidth: 15,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 0,
  },
  tertiary: {
    fillColor: 0xffffff,
    casingColor: 0xdddddd,
    fillWidth: 9,
    casingWidth: 13,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 2,
  },
  residential: {
    fillColor: 0xffffff,
    casingColor: 0xdddddd,
    fillWidth: 7,
    casingWidth: 11,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 3,
  },
  living_street: {
    fillColor: 0xffffff,
    casingColor: 0xdddddd,
    fillWidth: 6,
    casingWidth: 10,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 4,
  },
  service: {
    fillColor: 0xffffff,
    casingColor: 0xeeeeee,
    fillWidth: 4,
    casingWidth: 8,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 5,
  },
  unclassified: {
    fillColor: 0xffffff,
    casingColor: 0xdddddd,
    fillWidth: 7,
    casingWidth: 11,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 3,
  },
  footway: {
    fillColor: 0xf7cba2,
    casingColor: null,
    fillWidth: 1.5,
    casingWidth: 0,
    dashed: true,
    dashOn: 3,
    dashOff: 3,
    minZoom: 6,
  },
  path: {
    fillColor: 0xf7cba2,
    casingColor: null,
    fillWidth: 1.5,
    casingWidth: 0,
    dashed: true,
    dashOn: 3,
    dashOff: 3,
    minZoom: 6,
  },
  cycleway: {
    fillColor: 0x7ec8e3,
    casingColor: null,
    fillWidth: 1.5,
    casingWidth: 0,
    dashed: true,
    dashOn: 3,
    dashOff: 3,
    minZoom: 6,
  },
  pedestrian: {
    fillColor: 0xe8e6e0,
    casingColor: 0xcccccc,
    fillWidth: 8,
    casingWidth: 12,
    dashed: false,
    dashOn: 0,
    dashOff: 0,
    minZoom: 4,
  },
};

export function getRoadStyle(roadType: string, zoomLevel: number): RoadStyle | null {
  const style = ROAD_STYLES[roadType];
  if (!style) return null;
  if (zoomLevel < style.minZoom) return null;
  return style;
}

const DIVIDED_TYPES = new Set([
  'motorway',
  'trunk',
  'primary',
]);

export function isDividedRoad(roadType: string): boolean {
  return DIVIDED_TYPES.has(roadType);
}

const DEFAULT_ONEWAY_TYPES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

export function isDefaultOneway(roadType: string): boolean {
  return DEFAULT_ONEWAY_TYPES.has(roadType);
}

export function getRoadPriority(roadType: string): number {
  switch (roadType) {
    case 'motorway':
    case 'motorway_link':
      return 3;
    case 'trunk':
    case 'trunk_link':
      return 2;
    case 'primary':
    case 'secondary':
      return 1;
    default:
      return 0;
  }
}

export const HIGHWAY_BASE_ELEVATION = 6;
export const HIGHWAY_TIER_STEP = 6;

export function getHighwayTier(bearingDeg: number): number {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  // N-S roads (heading roughly north or south) = tier 1 (12m)
  // E-W roads (heading roughly east or west) = tier 0 (6m)
  if ((normalized >= 315 || normalized < 45) || (normalized >= 135 && normalized < 225)) {
    return 1; // N-S
  }
  return 0; // E-W
}

export function getHighwayElevation(tier: number): number {
  return HIGHWAY_BASE_ELEVATION + tier * HIGHWAY_TIER_STEP;
}

export function isHighwayType(roadType: string): boolean {
  return roadType === 'motorway' || roadType === 'motorway_link'
    || roadType === 'trunk' || roadType === 'trunk_link';
}

export const HIGHWAY_MASK_EXTRA = 4;
export const HIGHWAY_SHADOW_EXTRA = 8;

export function getLaneOffset(roadType: string): number {
  const style = ROAD_STYLES[roadType];
  if (!style) return 0;
  if (isDividedRoad(roadType)) {
    return style.fillWidth * 0.3;
  }
  return style.fillWidth * 0.25;
}

export function getCasingWidth(roadType: string): number {
  return ROAD_STYLES[roadType]?.casingWidth ?? 11;
}

export function getParkingOffset(roadType: string): number {
  const style = ROAD_STYLES[roadType];
  if (!style || !style.casingWidth) return 0;
  // Park car with outer edge 0.15m inside casing edge
  // carHalfWidth=1m (BoxGeometry width=2)
  return style.casingWidth / 2 - 1 - 0.15;
}
