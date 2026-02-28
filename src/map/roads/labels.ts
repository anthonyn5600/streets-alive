import * as THREE from 'three';
import { project } from '../projection';
import type { RoadData } from '../types';
import type { CachedLabelPlacement } from '../tiles/geometry-cache';
import { getRoadStyle } from './style';

const ATLAS_SIZE = 512;
const LABEL_FONT = 'bold 24px system-ui, sans-serif';
const LABEL_COLOR = '#333333';
const LABEL_SPACING = 200; // meters between labels on same road
const MIN_ROAD_LENGTH = 100; // meters

interface LabelEntry {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  angle: number;
}

export function computeLabelPlacements(
  roads: RoadData[],
  zoomLevel: number
): CachedLabelPlacement[] {
  const namedRoads = roads.filter(r => {
    if (!r.name) return false;
    const style = getRoadStyle(r.type, zoomLevel);
    return style !== null;
  });

  if (namedRoads.length === 0) return [];

  const placements: CachedLabelPlacement[] = [];

  for (const road of namedRoads) {
    const pts = road.points.map(p => project(p));
    if (pts.length < 2) continue;

    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      totalLen += Math.sqrt(dx * dx + dz * dz);
    }

    if (totalLen < MIN_ROAD_LENGTH) continue;

    const numLabels = Math.max(1, Math.floor(totalLen / LABEL_SPACING));

    for (let li = 0; li < numLabels; li++) {
      const targetDist = (li + 0.5) * (totalLen / numLabels);

      let accum = 0;
      let labelX = 0, labelZ = 0, angle = 0;
      let found = false;

      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dz = pts[i].z - pts[i - 1].z;
        const segLen = Math.sqrt(dx * dx + dz * dz);

        if (accum + segLen >= targetDist) {
          const t = (targetDist - accum) / segLen;
          labelX = pts[i - 1].x + dx * t;
          labelZ = pts[i - 1].z + dz * t;
          angle = Math.atan2(dz, dx);
          found = true;
          break;
        }
        accum += segLen;
      }

      if (!found) continue;

      placements.push({
        text: road.name,
        worldX: labelX,
        worldZ: labelZ,
        angle,
      });
    }
  }

  return placements;
}

export function createRoadLabelsFromPlacements(
  placements: CachedLabelPlacement[],
  camera?: THREE.Camera,
  canvasWidth?: number,
  canvasHeight?: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-labels';

  if (placements.length === 0) return group;

  // Create atlas canvas and measure text
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';

  const labels: LabelEntry[] = [];
  let atlasX = 0;
  let atlasY = 0;
  let rowHeight = 0;
  const padding = 4;
  const lineHeight = 30;

  for (const p of placements) {
    const textWidth = ctx.measureText(p.text).width;
    const worldY = 0.5;

    const lw = textWidth + padding * 2;
    const lh = lineHeight + padding * 2;

    if (atlasX + lw > ATLAS_SIZE) {
      atlasX = 0;
      atlasY += rowHeight;
      rowHeight = 0;
    }

    if (atlasY + lh > ATLAS_SIZE) break;

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(atlasX, atlasY, lw, lh);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(p.text, atlasX + padding, atlasY + padding);

    labels.push({
      text: p.text,
      x: atlasX,
      y: atlasY,
      width: lw,
      height: lh,
      worldX: p.worldX,
      worldY,
      worldZ: p.worldZ,
      angle: p.angle,
    });

    atlasX += lw;
    rowHeight = Math.max(rowHeight, lh);
  }

  if (labels.length === 0) return group;

  const w = canvasWidth ?? window.innerWidth;
  const h = canvasHeight ?? window.innerHeight;
  const culledLabels = cullOverlaps(labels, camera, w, h);

  if (culledLabels.length === 0) return group;

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const sharedMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const quadCount = culledLabels.length;
  const positions = new Float32Array(quadCount * 4 * 3);
  const uvs = new Float32Array(quadCount * 4 * 2);
  const indices = new Uint32Array(quadCount * 6);

  for (let qi = 0; qi < quadCount; qi++) {
    const label = culledLabels[qi];

    const u0 = label.x / ATLAS_SIZE;
    const v0 = 1 - (label.y + label.height) / ATLAS_SIZE;
    const u1 = (label.x + label.width) / ATLAS_SIZE;
    const v1 = 1 - label.y / ATLAS_SIZE;

    const halfW = (label.width * 0.15) / 2;
    const halfH = (label.height * 0.15) / 2;

    const cosA = Math.cos(-label.angle);
    const sinA = Math.sin(-label.angle);

    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [-halfW, halfH],
      [halfW, halfH],
    ];

    const baseVert = qi * 4;
    for (let ci = 0; ci < 4; ci++) {
      const lx = corners[ci][0];
      const lz = -corners[ci][1];
      const wx = lx * cosA + lz * sinA;
      const wz = -lx * sinA + lz * cosA;

      const vi = (baseVert + ci) * 3;
      positions[vi] = label.worldX + wx;
      positions[vi + 1] = label.worldY;
      positions[vi + 2] = label.worldZ + wz;

      const ui = (baseVert + ci) * 2;
      uvs[ui] = ci % 2 === 0 ? u0 : u1;
      uvs[ui + 1] = ci < 2 ? v0 : v1;
    }

    const ii = qi * 6;
    indices[ii] = baseVert;
    indices[ii + 1] = baseVert + 1;
    indices[ii + 2] = baseVert + 2;
    indices[ii + 3] = baseVert + 1;
    indices[ii + 4] = baseVert + 3;
    indices[ii + 5] = baseVert + 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));

  const mesh = new THREE.Mesh(geom, sharedMat);
  group.add(mesh);

  return group;
}

function cullOverlaps(labels: LabelEntry[], camera?: THREE.Camera, viewW = 1920, viewH = 1080): LabelEntry[] {
  if (!camera) return labels;

  const result: LabelEntry[] = [];
  const minDist = 80;
  const cellSize = minDist;
  const grid = new Map<string, Array<{ sx: number; sy: number }>>();

  function cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  for (const label of labels) {
    const pos = new THREE.Vector3(label.worldX, label.worldY, label.worldZ);
    const ndc = pos.project(camera);

    if (ndc.z > 1) continue;

    const sx = (ndc.x + 1) / 2 * viewW;
    const sy = (1 - ndc.y) / 2 * viewH;
    const cx = Math.floor(sx / cellSize);
    const cy = Math.floor(sy / cellSize);

    let overlapping = false;
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(cellKey(cx + dx, cy + dy));
        if (!neighbors) continue;
        for (const p of neighbors) {
          const ddx = sx - p.sx;
          const ddy = sy - p.sy;
          if (ddx * ddx + ddy * ddy < minDist * minDist) {
            overlapping = true;
            break outer;
          }
        }
      }
    }

    if (!overlapping) {
      const key = cellKey(cx, cy);
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push({ sx, sy });
      result.push(label);
    }
  }

  return result;
}
