import { getHighwayTier, getHighwayElevation } from './style';

const SMOOTH_DIST = 100;

export function computeHighwayElevations(pts: Array<{ x: number; z: number }>): number[] {
  const raw: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    let dx = 0, dz = 0;
    if (i < pts.length - 1) { dx += pts[i + 1].x - pts[i].x; dz += pts[i + 1].z - pts[i].z; }
    if (i > 0) { dx += pts[i].x - pts[i - 1].x; dz += pts[i].z - pts[i - 1].z; }
    const bearing = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
    const tier = getHighwayTier(bearing);
    raw.push(getHighwayElevation(tier));
  }
  return smoothElevations(raw, pts);
}

export function smoothElevations(elevations: number[], pts: Array<{ x: number; z: number }>): number[] {
  const result: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    let sum = 0, weight = 0;
    for (let j = 0; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x;
      const dz = pts[j].z - pts[i].z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < SMOOTH_DIST) {
        const w = 1 - dist / SMOOTH_DIST;
        sum += elevations[j] * w;
        weight += w;
      }
    }
    result.push(weight > 0 ? sum / weight : elevations[i]);
  }
  return result;
}

export function smoothRampElevation(t: number): number {
  return 3 * t * t - 2 * t * t * t;
}

export interface HwPolylineElev {
  pts: Array<{ x: number; z: number }>;
  elevations: number[];
}

export function nearestHighwayElevFromPolylines(
  pt: { x: number; z: number },
  hwPolylines: HwPolylineElev[],
  maxDist: number
): number | null {
  let bestDist = Infinity;
  let bestElev = 0;

  for (const hw of hwPolylines) {
    const { pts, elevations } = hw;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x, az = pts[i].z;
      const bx = pts[i + 1].x, bz = pts[i + 1].z;
      const dx = bx - ax, dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 0.0001) continue;

      let t = ((pt.x - ax) * dx + (pt.z - az) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const cx = ax + t * dx;
      const cz = az + t * dz;
      const ddx = pt.x - cx, ddz = pt.z - cz;
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);

      if (dist < bestDist) {
        bestDist = dist;
        bestElev = elevations[i] + t * (elevations[i + 1] - elevations[i]);
      }
    }
  }

  return bestDist <= maxDist ? bestElev : null;
}
