import type * as THREE from 'three';
import type { BuildingVertexRange } from './tiles/geometry-cache';
import type { RoadMeshResult } from './roads/renderer';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point2D {
  x: number;
  z: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface BuildingData {
  id: number;
  polygon: LatLng[];
  height: number;
  minHeight: number;
}

export interface RoadData {
  id: number;
  points: LatLng[];
  type: string;
  name: string;
  lanes: number;
  oneway: 1 | -1 | 0;
}

export interface RoadStyle {
  fillColor: number;
  casingColor: number | null;
  fillWidth: number;
  casingWidth: number;
  dashed: boolean;
  dashOn: number;
  dashOff: number;
  minZoom: number;
}

export type TileKey = string;

export interface TileState {
  key: TileKey;
  bbox: BBox;
  status: 'loading' | 'loaded' | 'error';
  labels: THREE.Group | null;
  roadData: RoadData[] | null;
  buildingData: BuildingData[] | null;
  abortController: AbortController;
  meshGroup: THREE.Group | null;
  buildingMesh: THREE.Mesh | null;
  buildingVertexRanges: BuildingVertexRange[] | null;
  roadMeshes: RoadMeshResult | null;
}

export interface CarInfo {
  id: number;
  color: number;
  roadType: string;
  speed: number;
  selected: boolean;
}

// Life simulation types
export type NeedType = 'energy' | 'social' | 'money' | 'fun' | 'health';
export type ActivityType = 'home' | 'work' | 'shopping' | 'social';
export type JobType = 'Office Worker' | 'Retail' | 'Restaurant' | 'Healthcare'
  | 'Teacher' | 'Construction' | 'Tech' | 'Artist';

export type PersonLocationType = 'home' | 'car' | 'building' | 'traveling';
export interface PersonLocation {
  type: PersonLocationType;
  buildingId?: number;
  carId?: number;
  activity?: ActivityType;
}

export interface Need {
  value: number; // 0-100
  decayRate: number; // per-second
}

export interface Person {
  id: number;
  name: string;
  job: JobType;
  needs: Record<NeedType, Need>;
  homeBuildingId: number;
  workBuildingId: number;
  location: PersonLocation;
}

export interface Household {
  id: number;
  buildingId: number;
  memberIds: number[];
  carActive: boolean;
}

export interface PersonInfo {
  id: number;
  name: string;
  job: JobType;
  needs: Record<NeedType, number>; // just the values
  location: PersonLocation;
  homeBuildingId: number;
  workBuildingId: number;
}

export interface HouseholdInfo {
  id: number;
  buildingId: number;
  members: PersonInfo[];
  carActive: boolean;
}

export interface SimCarInfo {
  id: number;
  color: number;
  roadType: string;
  speed: number;
  selected: boolean;
  state: 'driving' | 'parked';
  activity: ActivityType | null;
  occupants: PersonInfo[];
  guestOccupants: PersonInfo[];
  dwellProgress: number; // 0-1
  dwellRemaining: number;
  householdId: number;
  routeProgress: number; // 0-1 driving progress, -1 if parked
  originBuildingId: number | null;
  destinationBuildingId: number | null;
  originAddress: string | null;
  destinationAddress: string | null;
  originPos: { x: number; z: number } | null;
  destinationPos: { x: number; z: number } | null;
}

export interface MapState {
  loading: boolean;
  loadingTiles: number;
  totalTiles: number;
  cursorLatLng: LatLng | null;
  cameraLatLng: LatLng | null;
  zoomLevel: number;
}

export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface RuntimeTestResult {
  id: string;
  category: string;
  name: string;
  status: TestStatus;
  message: string;
  sampleCount: number;
  failCount: number;
}

export interface CarTestData {
  id: number;
  state: 'driving' | 'parked';
  waypointCount: number;
  waypointIndex: number;
  originBuildingId: number | null;
  destinationBuildingId: number | null;
  householdId: number;
  activity: ActivityType | null;
  dwellTotal: number;
  dwellRemaining: number;
  speed: number;
  occupantIds: number[];
  guestOccupantIds: number[];
  pendingDropoffs: number;
  isDropoffTrip: boolean;
  hidden: boolean;
}

export interface PersonTestData {
  id: number;
  locationType: string;
  locationCarId: number | undefined;
  locationBuildingId: number | undefined;
  householdId: number;
}

export interface RuntimeTestSnapshot {
  cars: CarTestData[];
  households: HouseholdInfo[];
  persons: PersonTestData[];
  indexedBuildingIds: Set<number>;
  buildingRoleIds: Set<number>;
  shoppingBuildingCount: number;
  populationInitialized: boolean;
}
