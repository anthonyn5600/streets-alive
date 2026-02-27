import type * as THREE from 'three';

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
  buildings: THREE.Group | null;
  roads: THREE.Group | null;
  labels: THREE.Group | null;
  roadData: RoadData[] | null;
  buildingData: BuildingData[] | null;
  abortController: AbortController;
}

export interface CarInfo {
  id: number;
  color: number;
  roadType: string;
  speed: number;
  selected: boolean;
}

export interface MapState {
  loading: boolean;
  loadingTiles: number;
  totalTiles: number;
  cursorLatLng: LatLng | null;
  cameraLatLng: LatLng | null;
  zoomLevel: number;
}
