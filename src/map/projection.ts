import type { LatLng, Point2D } from './types';

const DEG2RAD = Math.PI / 180;
const EARTH_RADIUS = 6378137; // meters

let centerLat = 34.0522;
let centerLng = -118.2437;
let cosCenter = Math.cos(centerLat * DEG2RAD);
let centerMercY = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + centerLat * DEG2RAD / 2));

export function setCenter(lat: number, lng: number) {
  centerLat = lat;
  centerLng = lng;
  cosCenter = Math.cos(centerLat * DEG2RAD);
  centerMercY = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + centerLat * DEG2RAD / 2));
}

export function getCenter(): LatLng {
  return { lat: centerLat, lng: centerLng };
}

export function project(latlng: LatLng): Point2D {
  const x = EARTH_RADIUS * (latlng.lng - centerLng) * DEG2RAD * cosCenter;
  const mercY = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + latlng.lat * DEG2RAD / 2));
  const z = -(mercY - centerMercY);
  return { x, z };
}

export interface ProjectionConstants {
  centerLat: number;
  centerLng: number;
  cosCenter: number;
  centerMercY: number;
}

export function getProjectionConstants(): ProjectionConstants {
  return { centerLat, centerLng, cosCenter, centerMercY };
}

export function unproject(point: Point2D): LatLng {
  const lng = centerLng + point.x / (EARTH_RADIUS * DEG2RAD * cosCenter);
  const mercY = centerMercY - point.z;
  const lat = (2 * Math.atan(Math.exp(mercY / EARTH_RADIUS)) - Math.PI / 2) / DEG2RAD;
  return { lat, lng };
}
