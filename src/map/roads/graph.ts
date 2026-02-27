import { project } from '../projection';
import {
  getLaneOffset,
  isDefaultOneway,
} from './style';
import { computeMiterNormals } from './renderer';
import type { BuildingData, RoadData } from '../types';

export interface GraphNode {
  id: number;
  lat: number;
  lng: number;
  x: number;
  z: number;
}

export interface GraphEdge {
  from: number;
  to: number;
  distance: number;
  cost: number;
  roadType: string;
  waypoints: Array<{ x: number; y: number; z: number }>;
}

export const SPEED_WEIGHTS: Record<string, number> = {
  motorway: 1.0,
  motorway_link: 0.95,
  trunk: 0.9,
  trunk_link: 0.85,
  primary: 0.8,
  primary_link: 0.75,
  secondary: 0.7,
  secondary_link: 0.65,
  tertiary: 0.6,
  tertiary_link: 0.55,
  residential: 0.5,
  residential_link: 0.45,
  unclassified: 0.5,
  living_street: 0.4,
  service: 0.3,
  service_link: 0.25,
};

interface IndexedBuilding {
  centroidX: number;
  centroidZ: number;
  nearestNodeId: number;
}

const CLUSTER_TOLERANCE = 10; // meters
const MIN_SPAWN_SPEED = 0.55;
const MAX_BUILDING_NODE_DIST_SQ = 100 * 100;

function offsetWaypointsRight(
  pts: Array<{ x: number; y: number; z: number }>,
  offset: number
): Array<{ x: number; y: number; z: number }> {
  if (offset === 0 || pts.length < 2) return pts;

  const pts2d = pts.map(p => ({ x: p.x, z: p.z }));
  const normals = computeMiterNormals(pts2d);
  const result: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    result.push({
      x: pts[i].x + normals[i].x * offset,
      y: pts[i].y,
      z: pts[i].z + normals[i].z * offset,
    });
  }
  return result;
}

export class RoadGraph {
  nodes: GraphNode[] = [];
  adjacency: Map<number, GraphEdge[]> = new Map();
  private grid = new Map<string, number>();
  private connectedNodes: number[] = [];
  private carSpawnNodes: number[] = [];
  private indexedBuildings: IndexedBuilding[] = [];

  build(roads: RoadData[]) {
    this.nodes = [];
    this.adjacency = new Map();
    this.grid = new Map();
    this.indexedBuildings = [];

    for (const road of roads) {
      if (road.points.length < 2) continue;
      const speed = SPEED_WEIGHTS[road.type];
      if (speed === undefined) continue;

      const projected = road.points.map(p => {
        const pt = project(p);
        return { lat: p.lat, lng: p.lng, x: pt.x, z: pt.z };
      });

      const startNode = this.getOrCreateNode(projected[0]);
      const endNode = this.getOrCreateNode(projected[projected.length - 1]);

      const waypoints = projected.map(p => ({ x: p.x, y: 0, z: p.z }));

      let totalDist = 0;
      for (let i = 1; i < projected.length; i++) {
        const dx = projected[i].x - projected[i - 1].x;
        const dz = projected[i].z - projected[i - 1].z;
        totalDist += Math.sqrt(dx * dx + dz * dz);
      }

      if (totalDist < 1) continue;
      const cost = totalDist / speed;

      const effectiveOneway = road.oneway !== 0 ? road.oneway : (isDefaultOneway(road.type) ? 1 : 0);

      if (!this.adjacency.has(startNode)) this.adjacency.set(startNode, []);
      if (!this.adjacency.has(endNode)) this.adjacency.set(endNode, []);

      if (effectiveOneway >= 0) {
        this.adjacency.get(startNode)!.push({
          from: startNode,
          to: endNode,
          distance: totalDist,
          cost,
          roadType: road.type,
          waypoints,
        });
      }

      if (effectiveOneway <= 0) {
        this.adjacency.get(endNode)!.push({
          from: endNode,
          to: startNode,
          distance: totalDist,
          cost,
          roadType: road.type,
          waypoints: [...waypoints].reverse(),
        });
      }
    }

    this.connectedNodes = [];
    for (const [nodeId, edges] of this.adjacency) {
      if (edges.length > 0) this.connectedNodes.push(nodeId);
    }

    this.carSpawnNodes = this.connectedNodes.filter(nodeId => {
      const edges = this.adjacency.get(nodeId);
      return edges?.some(e => (SPEED_WEIGHTS[e.roadType] ?? 0) >= MIN_SPAWN_SPEED) ?? false;
    });
  }

  private getOrCreateNode(p: { lat: number; lng: number; x: number; z: number }): number {
    const gx = Math.round(p.x / CLUSTER_TOLERANCE);
    const gz = Math.round(p.z / CLUSTER_TOLERANCE);
    const key = `${gx},${gz}`;

    const existing = this.grid.get(key);
    if (existing !== undefined) return existing;

    const id = this.nodes.length;
    this.nodes.push({ id, lat: p.lat, lng: p.lng, x: p.x, z: p.z });
    this.grid.set(key, id);
    return id;
  }

  dijkstra(startId: number, endId: number): number[] | null {
    if (startId === endId) return null;
    if (!this.adjacency.has(startId) || !this.adjacency.has(endId)) return null;

    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    dist[startId] = 0;

    // Priority queue (linear scan -- sufficient for our graph size)
    const heap: Array<{ cost: number; node: number }> = [{ cost: 0, node: startId }];

    while (heap.length > 0) {
      let minIdx = 0;
      for (let i = 1; i < heap.length; i++) {
        if (heap[i].cost < heap[minIdx].cost) minIdx = i;
      }
      const { cost, node } = heap[minIdx];
      heap[minIdx] = heap[heap.length - 1];
      heap.pop();

      if (node === endId) break;
      if (cost > dist[node]) continue;

      const edges = this.adjacency.get(node);
      if (!edges) continue;

      for (const edge of edges) {
        const newCost = dist[node] + edge.cost;
        if (newCost < dist[edge.to]) {
          dist[edge.to] = newCost;
          prev[edge.to] = node;
          heap.push({ cost: newCost, node: edge.to });
        }
      }
    }

    if (dist[endId] === Infinity) return null;

    // Reconstruct path
    const path: number[] = [];
    let cur = endId;
    while (cur !== -1) {
      path.push(cur);
      cur = prev[cur];
    }
    path.reverse();
    return path;
  }

  getRouteWaypoints(nodePath: number[]): Array<{ x: number; y: number; z: number }> {
    const waypoints: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < nodePath.length - 1; i++) {
      const from = nodePath[i];
      const to = nodePath[i + 1];
      const edges = this.adjacency.get(from);
      if (!edges) continue;

      const edge = edges.find(e => e.to === to);
      if (!edge) {
        // Fallback: straight line
        waypoints.push({ x: this.nodes[from].x, y: 0, z: this.nodes[from].z });
        continue;
      }

      // Add waypoints (skip first if not the start to avoid duplication)
      const start = i === 0 ? 0 : 1;
      for (let w = start; w < edge.waypoints.length; w++) {
        waypoints.push(edge.waypoints[w]);
      }
    }

    return waypoints;
  }

  getRouteWaypointsWithOffset(nodePath: number[]): Array<{ x: number; y: number; z: number }> {
    const waypoints: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i < nodePath.length - 1; i++) {
      const from = nodePath[i];
      const to = nodePath[i + 1];
      const edges = this.adjacency.get(from);
      if (!edges) continue;

      const edge = edges.find(e => e.to === to);
      if (!edge) {
        waypoints.push({ x: this.nodes[from].x, y: 0, z: this.nodes[from].z });
        continue;
      }

      const offset = getLaneOffset(edge.roadType);
      const edgePts = offset > 0 ? offsetWaypointsRight(edge.waypoints, offset) : edge.waypoints;

      const start = i === 0 ? 0 : 1;
      for (let w = start; w < edgePts.length; w++) {
        waypoints.push(edgePts[w]);
      }
    }

    return waypoints;
  }

  getRouteRoadTypes(nodePath: number[]): string[] {
    const types: string[] = [];
    for (let i = 0; i < nodePath.length - 1; i++) {
      const from = nodePath[i];
      const to = nodePath[i + 1];
      const edges = this.adjacency.get(from);
      const edge = edges?.find(e => e.to === to);
      types.push(edge?.roadType ?? 'residential');
    }
    return types;
  }

  getRandomNode(): number | null {
    if (this.connectedNodes.length === 0) return null;
    return this.connectedNodes[Math.floor(Math.random() * this.connectedNodes.length)];
  }

  getRandomCarNode(): number | null {
    if (this.carSpawnNodes.length === 0) return this.getRandomNode();
    return this.carSpawnNodes[Math.floor(Math.random() * this.carSpawnNodes.length)];
  }

  buildBuildingIndex(buildings: BuildingData[]) {
    this.indexedBuildings = [];
    if (this.connectedNodes.length === 0) return;

    // Build a grid of connected nodes for O(1) spatial lookup
    const CELL = 100; // meters per cell, matches MAX_BUILDING_NODE_DIST
    const nodeGrid = new Map<string, number[]>();
    for (const nodeId of this.connectedNodes) {
      const node = this.nodes[nodeId];
      const cx = Math.floor(node.x / CELL);
      const cz = Math.floor(node.z / CELL);
      const key = `${cx},${cz}`;
      let bucket = nodeGrid.get(key);
      if (!bucket) { bucket = []; nodeGrid.set(key, bucket); }
      bucket.push(nodeId);
    }

    for (const b of buildings) {
      if (b.polygon.length === 0) continue;
      let sumLat = 0, sumLng = 0;
      for (const p of b.polygon) {
        sumLat += p.lat;
        sumLng += p.lng;
      }
      const centroid = project({ lat: sumLat / b.polygon.length, lng: sumLng / b.polygon.length });

      const cx = Math.floor(centroid.x / CELL);
      const cz = Math.floor(centroid.z / CELL);
      let bestDist = Infinity;
      let bestNode = -1;

      // Search 3x3 neighborhood of grid cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = nodeGrid.get(`${cx + dx},${cz + dz}`);
          if (!bucket) continue;
          for (const nodeId of bucket) {
            const node = this.nodes[nodeId];
            const ddx = node.x - centroid.x;
            const ddz = node.z - centroid.z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestDist) {
              bestDist = d2;
              bestNode = nodeId;
            }
          }
        }
      }

      if (bestNode !== -1 && bestDist < MAX_BUILDING_NODE_DIST_SQ) {
        this.indexedBuildings.push({
          centroidX: centroid.x,
          centroidZ: centroid.z,
          nearestNodeId: bestNode,
        });
      }
    }
  }

  getRandomBuildingDestination(): { nodeId: number; buildingX: number; buildingZ: number } | null {
    if (this.indexedBuildings.length === 0) return null;
    const b = this.indexedBuildings[Math.floor(Math.random() * this.indexedBuildings.length)];
    return { nodeId: b.nearestNodeId, buildingX: b.centroidX, buildingZ: b.centroidZ };
  }
}
