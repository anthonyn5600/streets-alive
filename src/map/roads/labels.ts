import * as THREE from 'three';
import { project } from '../projection';
import type { RoadData } from '../types';
import { getRoadStyle } from './style';

const ATLAS_SIZE = 2048;
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

export function createRoadLabels(
  roads: RoadData[],
  zoomLevel: number,
  camera?: THREE.Camera,
  canvasWidth?: number,
  canvasHeight?: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-labels';

  // Filter to named roads visible at this zoom
  const namedRoads = roads.filter(r => {
    if (!r.name) return false;
    const style = getRoadStyle(r.type, zoomLevel);
    return style !== null;
  });

  if (namedRoads.length === 0) return group;

  // Create atlas canvas
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

  for (const road of namedRoads) {
    const pts = road.points.map(p => project(p));
    if (pts.length < 2) continue;

    // Compute road length
    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      totalLen += Math.sqrt(dx * dx + dz * dz);
    }

    if (totalLen < MIN_ROAD_LENGTH) continue;

    // Place labels along road
    const numLabels = Math.max(1, Math.floor(totalLen / LABEL_SPACING));
    const textWidth = ctx.measureText(road.name).width;

    for (let li = 0; li < numLabels; li++) {
      const targetDist = (li + 0.5) * (totalLen / numLabels);

      // Find position along road at targetDist
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

      const worldY = 0.1;

      // Check atlas space
      const lw = textWidth + padding * 2;
      const lh = lineHeight + padding * 2;

      if (atlasX + lw > ATLAS_SIZE) {
        atlasX = 0;
        atlasY += rowHeight;
        rowHeight = 0;
      }

      if (atlasY + lh > ATLAS_SIZE) break; // atlas full

      // Draw text to atlas
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(atlasX, atlasY, lw, lh);
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(road.name, atlasX + padding, atlasY + padding);

      labels.push({
        text: road.name,
        x: atlasX,
        y: atlasY,
        width: lw,
        height: lh,
        worldX: labelX,
        worldY,
        worldZ: labelZ,
        angle,
      });

      atlasX += lw;
      rowHeight = Math.max(rowHeight, lh);
    }
  }

  if (labels.length === 0) return group;

  // Screen-space overlap culling
  const w = canvasWidth ?? window.innerWidth;
  const h = canvasHeight ?? window.innerHeight;
  const culledLabels = cullOverlaps(labels, camera, w, h);

  // Create texture from atlas
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // Shared material for all labels in this tile
  const sharedMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  // Create billboard quad for each label
  for (const label of culledLabels) {
    const u0 = label.x / ATLAS_SIZE;
    const v0 = 1 - (label.y + label.height) / ATLAS_SIZE;
    const u1 = (label.x + label.width) / ATLAS_SIZE;
    const v1 = 1 - label.y / ATLAS_SIZE;

    const scaleW = label.width * 0.15;
    const scaleH = label.height * 0.15;

    const geom = new THREE.PlaneGeometry(scaleW, scaleH);
    const uvs = geom.attributes.uv;
    (uvs as THREE.BufferAttribute).setXY(0, u0, v1);
    (uvs as THREE.BufferAttribute).setXY(1, u1, v1);
    (uvs as THREE.BufferAttribute).setXY(2, u0, v0);
    (uvs as THREE.BufferAttribute).setXY(3, u1, v0);

    const mesh = new THREE.Mesh(geom, sharedMat);
    mesh.position.set(label.worldX, label.worldY, label.worldZ);

    // Rotate to lay flat and align with road direction
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -label.angle;

    group.add(mesh);
  }

  return group;
}

function cullOverlaps(labels: LabelEntry[], camera?: THREE.Camera, viewW = 1920, viewH = 1080): LabelEntry[] {
  if (!camera) return labels;

  const placed: Array<{ sx: number; sy: number; label: LabelEntry }> = [];
  const result: LabelEntry[] = [];
  const minDist = 80; // pixels

  for (const label of labels) {
    const pos = new THREE.Vector3(label.worldX, label.worldY, label.worldZ);
    const ndc = pos.project(camera);

    // Skip labels behind camera
    if (ndc.z > 1) continue;

    const sx = (ndc.x + 1) / 2 * viewW;
    const sy = (1 - ndc.y) / 2 * viewH;

    let overlapping = false;
    for (const p of placed) {
      const dx = sx - p.sx;
      const dy = sy - p.sy;
      if (Math.sqrt(dx * dx + dy * dy) < minDist) {
        overlapping = true;
        break;
      }
    }

    if (!overlapping) {
      placed.push({ sx, sy, label });
      result.push(label);
    }
  }

  return result;
}
