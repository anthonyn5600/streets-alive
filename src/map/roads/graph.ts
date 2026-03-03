import { project } from '../projection';
import {
  getCasingWidth,
  getLaneOffset,
  isDefaultOneway,
  isHighwayType,
} from './style';
import { computeMiterNormals } from './miter';
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
  name: string;
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

export interface IndexedBuilding {
  buildingId: number;
  centroidX: number;
  centroidZ: number;
  nearestNodeId: number;
  roadDirX: number;
  roadDirZ: number;
  roadType: string;
  roadName: string;
}

const CLUSTER_TOLERANCE = 10; // meters
const MIN_SPAWN_SPEED = 0.55;
const MAX_BUILDING_NODE_DIST_SQ = 35 * 35;
const SNAP_THRESHOLD = 2; // meters -- snap to existing endpoint instead of splitting
const MIN_SUBEDGE_LEN = 1; // meters -- skip sub-edges shorter than this
const TURN_PENALTY = 7.5; // seconds, OSRM car.lua default
const UTURN_PENALTY = 20; // seconds, OSRM car.lua default

interface ProjectionResult {
  x: number;
  z: number;
  segIndex: number;
  t: number;
  distSq: number;
}

function projectOnPolyline(
  px: number,
  pz: number,
  pts: Array<{ x: number; z: number }>
): ProjectionResult | null {
  if (pts.length < 2) return null;
  let bestDistSq = Infinity;
  let bestX = 0, bestZ = 0, bestSeg = 0, bestT = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, az = pts[i].z;
    const bx = pts[i + 1].x, bz = pts[i + 1].z;
    const abx = bx - ax, abz = bz - az;
    const ab2 = abx * abx + abz * abz;
    if (ab2 < 0.0001) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2));
    const cx = ax + t * abx, cz = az + t * abz;
    const dx = px - cx, dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestX = cx;
      bestZ = cz;
      bestSeg = i;
      bestT = t;
    }
  }

  if (bestDistSq === Infinity) return null;
  return { x: bestX, z: bestZ, segIndex: bestSeg, t: bestT, distSq: bestDistSq };
}

function slideAwayFromEndpoint(
  wp: Array<{ x: number; y: number; z: number }>,
  fromStart: boolean,
  distance: number
): { x: number; z: number; segIndex: number; t: number } | null {
  if (fromStart) {
    let acc = 0;
    for (let i = 0; i < wp.length - 1; i++) {
      const dx = wp[i + 1].x - wp[i].x, dz = wp[i + 1].z - wp[i].z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (acc + segLen >= distance) {
        const t = (distance - acc) / segLen;
        return { x: wp[i].x + dx * t, z: wp[i].z + dz * t, segIndex: i, t };
      }
      acc += segLen;
    }
    return null;
  } else {
    let acc = 0;
    for (let i = wp.length - 1; i > 0; i--) {
      const dx = wp[i - 1].x - wp[i].x, dz = wp[i - 1].z - wp[i].z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (acc + segLen >= distance) {
        const rem = (distance - acc) / segLen;
        return { x: wp[i].x + dx * rem, z: wp[i].z + dz * rem, segIndex: i - 1, t: 1 - rem };
      }
      acc += segLen;
    }
    return null;
  }
}

function computePolylineDist(pts: Array<{ x: number; z: number }>): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    total += Math.sqrt(dx * dx + dz * dz);
  }
  return total;
}

function yieldToMain(): Promise<void> {
  return new Promise<void>(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

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

class FlatMinHeap {
  private nodes: Int32Array;
  private fCosts: Float64Array;
  private gCosts: Float64Array;
  private size = 0;

  constructor(capacity = 1024) {
    this.nodes = new Int32Array(capacity);
    this.fCosts = new Float64Array(capacity);
    this.gCosts = new Float64Array(capacity);
  }

  private grow() {
    const newCap = this.nodes.length * 2;
    const newNodes = new Int32Array(newCap);
    const newF = new Float64Array(newCap);
    const newG = new Float64Array(newCap);
    newNodes.set(this.nodes);
    newF.set(this.fCosts);
    newG.set(this.gCosts);
    this.nodes = newNodes;
    this.fCosts = newF;
    this.gCosts = newG;
  }

  insert(node: number, gCost: number, fCost: number) {
    if (this.size === this.nodes.length) this.grow();
    const i = this.size++;
    this.nodes[i] = node;
    this.fCosts[i] = fCost;
    this.gCosts[i] = gCost;
    this.siftUp(i);
  }

  extractMin(): { node: number; cost: number } | null {
    if (this.size === 0) return null;
    const node = this.nodes[0];
    const gCost = this.gCosts[0];
    this.size--;
    if (this.size > 0) {
      this.nodes[0] = this.nodes[this.size];
      this.fCosts[0] = this.fCosts[this.size];
      this.gCosts[0] = this.gCosts[this.size];
      this.siftDown(0);
    }
    return { node, cost: gCost };
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  reset() {
    this.size = 0;
  }

  private siftUp(i: number) {
    const nodes = this.nodes, f = this.fCosts, g = this.gCosts;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[i] >= f[parent]) break;
      // swap
      let tmp = nodes[i]; nodes[i] = nodes[parent]; nodes[parent] = tmp;
      let tmpF = f[i]; f[i] = f[parent]; f[parent] = tmpF;
      let tmpG = g[i]; g[i] = g[parent]; g[parent] = tmpG;
      i = parent;
    }
  }

  private siftDown(i: number) {
    const nodes = this.nodes, f = this.fCosts, g = this.gCosts;
    const n = this.size;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && f[left] < f[smallest]) smallest = left;
      if (right < n && f[right] < f[smallest]) smallest = right;
      if (smallest === i) break;
      let tmp = nodes[i]; nodes[i] = nodes[smallest]; nodes[smallest] = tmp;
      let tmpF = f[i]; f[i] = f[smallest]; f[smallest] = tmpF;
      let tmpG = g[i]; g[i] = g[smallest]; g[smallest] = tmpG;
      i = smallest;
    }
  }
}

export class RoadGraph {
  nodes: GraphNode[] = [];
  adjacency: Map<number, GraphEdge[]> = new Map();
  private grid = new Map<number, number[]>();
  private connectedNodes: number[] = [];
  private carSpawnNodes: number[] = [];
  private indexedBuildings: IndexedBuilding[] = [];
  private buildingMap = new Map<number, IndexedBuilding>();
  private intersectionNodes = new Set<number>();
  private spatialGrid = new Map<number, number[]>();
  private spatialCellSize = 100;

  private static ROAD_TYPE_IDS = new Map<string, number>(
    Object.keys(SPEED_WEIGHTS).map((k, i) => [k, i + 1])
  );

  private static gridKey(cx: number, cz: number): number {
    return (cx + 50000) * 100000 + (cz + 50000);
  }

  private static edgeKey(fromId: number, toId: number, roadType: string): number {
    const minId = Math.min(fromId, toId);
    const maxId = Math.max(fromId, toId);
    const typeId = RoadGraph.ROAD_TYPE_IDS.get(roadType) ?? 0;
    return (minId * 100000 + maxId) * 32 + typeId;
  }
  private aStarDist: Float64Array = new Float64Array(0);
  private aStarPrev: Int32Array = new Int32Array(0);
  private aStarGen: Uint32Array = new Uint32Array(0);
  private currentGen = 0;
  private heap = new FlatMinHeap();

  build(roads: RoadData[]) {
    this.nodes = [];
    this.adjacency = new Map();
    this.grid = new Map();
    this.intersectionNodes = new Set();

    for (const road of roads) {
      if (road.points.length < 2) continue;
      const speed = SPEED_WEIGHTS[road.type];
      if (speed === undefined) continue;

      const projected = road.points.map(p => {
        const pt = project(p);
        return { lat: p.lat, lng: p.lng, x: pt.x, z: pt.z };
      });

      const nodeIds = projected.map(p => this.getOrCreateNode(p));
      const effectiveOneway = road.oneway !== 0 ? road.oneway : (isDefaultOneway(road.type) ? 1 : 0);

      let segStart = 0;
      for (let i = 1; i < nodeIds.length; i++) {
        if (nodeIds[i] === nodeIds[segStart]) continue;

        let segDist = 0;
        for (let k = segStart + 1; k <= i; k++) {
          const dx = projected[k].x - projected[k - 1].x;
          const dz = projected[k].z - projected[k - 1].z;
          segDist += Math.sqrt(dx * dx + dz * dz);
        }
        if (segDist < 1) { segStart = i; continue; }

        const fromNode = nodeIds[segStart];
        const toNode = nodeIds[i];
        const wp: Array<{ x: number; y: number; z: number }> = [];
        for (let k = segStart; k <= i; k++) {
          wp.push({ x: projected[k].x, y: 0, z: projected[k].z });
        }
        const cost = segDist * (2 - speed);

        if (!this.adjacency.has(fromNode)) this.adjacency.set(fromNode, []);
        if (!this.adjacency.has(toNode)) this.adjacency.set(toNode, []);

        if (effectiveOneway >= 0) {
          this.adjacency.get(fromNode)!.push({
            from: fromNode, to: toNode, distance: segDist,
            cost, roadType: road.type, name: road.name, waypoints: wp,
          });
        }
        if (effectiveOneway <= 0) {
          this.adjacency.get(toNode)!.push({
            from: toNode, to: fromNode, distance: segDist,
            cost, roadType: road.type, name: road.name, waypoints: [...wp].reverse(),
          });
        }

        segStart = i;
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

    // Precompute intersection nodes using bidirectional neighbor counting
    // (outgoing-only misses one-way roads leading into a junction)
    const biNeighbors = new Map<number, Set<number>>();
    for (const [nodeId, edges] of this.adjacency) {
      for (const e of edges) {
        if (!biNeighbors.has(e.from)) biNeighbors.set(e.from, new Set());
        if (!biNeighbors.has(e.to)) biNeighbors.set(e.to, new Set());
        biNeighbors.get(e.from)!.add(e.to);
        biNeighbors.get(e.to)!.add(e.from);
      }
    }
    for (const [nodeId, neighbors] of biNeighbors) {
      if (neighbors.size >= 3) this.intersectionNodes.add(nodeId);
    }

    this.buildSpatialGrid();
  }

  private buildSpatialGrid() {
    this.spatialGrid = new Map();
    const cell = this.spatialCellSize;
    for (const node of this.nodes) {
      const key = RoadGraph.gridKey(Math.floor(node.x / cell), Math.floor(node.z / cell));
      let bucket = this.spatialGrid.get(key);
      if (!bucket) { bucket = []; this.spatialGrid.set(key, bucket); }
      bucket.push(node.id);
    }
  }

  private addToSpatialGrid(nodeId: number) {
    const node = this.nodes[nodeId];
    const cell = this.spatialCellSize;
    const key = RoadGraph.gridKey(Math.floor(node.x / cell), Math.floor(node.z / cell));
    let bucket = this.spatialGrid.get(key);
    if (!bucket) { bucket = []; this.spatialGrid.set(key, bucket); }
    bucket.push(nodeId);
  }

  findNearestNode(x: number, z: number): number | null {
    const cell = this.spatialCellSize;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);

    let best = -1;
    let bestDist = Infinity;

    // Check 3x3 neighborhood first
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.spatialGrid.get(RoadGraph.gridKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const nodeId of bucket) {
          const node = this.nodes[nodeId];
          const ddx = node.x - x;
          const ddz = node.z - z;
          const d = ddx * ddx + ddz * ddz;
          if (d < bestDist) { bestDist = d; best = nodeId; }
        }
      }
    }

    if (best !== -1) return best;

    // Fallback: full scan (no nodes nearby)
    for (const node of this.nodes) {
      const ddx = node.x - x;
      const ddz = node.z - z;
      const d = ddx * ddx + ddz * ddz;
      if (d < bestDist) { bestDist = d; best = node.id; }
    }
    return best === -1 ? null : best;
  }

  private getOrCreateNode(p: { lat: number; lng: number; x: number; z: number }): number {
    const gx = Math.floor(p.x / CLUSTER_TOLERANCE);
    const gz = Math.floor(p.z / CLUSTER_TOLERANCE);
    const tolSq = CLUSTER_TOLERANCE * CLUSTER_TOLERANCE;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.grid.get(RoadGraph.gridKey(gx + dx, gz + dz));
        if (!bucket) continue;
        for (const existingId of bucket) {
          const node = this.nodes[existingId];
          const ddx = node.x - p.x, ddz = node.z - p.z;
          if (ddx * ddx + ddz * ddz < tolSq) return existingId;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, lat: p.lat, lng: p.lng, x: p.x, z: p.z });
    const key = RoadGraph.gridKey(gx, gz);
    let bucket = this.grid.get(key);
    if (!bucket) { bucket = []; this.grid.set(key, bucket); }
    bucket.push(id);
    return id;
  }

  private isIntersectionNode(nodeId: number): boolean {
    return this.intersectionNodes.has(nodeId);
  }

  private computeTurnPenalty(prevId: number, currentId: number, nextId: number): number {
    if (prevId === nextId) return TURN_PENALTY + UTURN_PENALTY;

    const prev = this.nodes[prevId];
    const cur = this.nodes[currentId];
    const next = this.nodes[nextId];

    const inX = cur.x - prev.x;
    const inZ = cur.z - prev.z;
    const outX = next.x - cur.x;
    const outZ = next.z - cur.z;

    const inLen = Math.sqrt(inX * inX + inZ * inZ);
    const outLen = Math.sqrt(outX * outX + outZ * outZ);
    if (inLen < 0.001 || outLen < 0.001) return 0;

    const dot = inX * outX + inZ * outZ;
    const cosAngle = Math.max(-1, Math.min(1, dot / (inLen * outLen)));
    const angle = Math.acos(cosAngle);

    return TURN_PENALTY / (1 + Math.exp(-(13 * angle / Math.PI - 6.5)));
  }

  private findSubEdge(
    fromId: number, toId: number, px: number, pz: number, roadType: string
  ): { edge: GraphEdge; proj: ProjectionResult } | null {
    const visited = new Set<number>();
    const queue = [fromId];
    let bestResult: { edge: GraphEdge; proj: ProjectionResult } | null = null;

    while (queue.length > 0 && visited.size < 20) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.adjacency.get(current);
      if (!edges) continue;

      for (const e of edges) {
        if (e.roadType !== roadType) continue;
        const wp2d = e.waypoints.map(w => ({ x: w.x, z: w.z }));
        const proj = projectOnPolyline(px, pz, wp2d);
        if (!proj) continue;
        if (!bestResult || proj.distSq < bestResult.proj.distSq) {
          bestResult = { edge: e, proj };
        }
        if (bestResult.proj.distSq < 0.01) return bestResult;
        if (!visited.has(e.to)) queue.push(e.to);
      }
    }

    return bestResult;
  }

  private insertParkingNode(
    edge: GraphEdge,
    proj: ProjectionResult
  ): number {
    const fromNode = this.nodes[edge.from];
    const toNode = this.nodes[edge.to];

    // Snap guard: if projection is within SNAP_THRESHOLD of an endpoint, return that node
    // Skip intersection nodes (3+ neighbors) to avoid parking in junctions
    const dxFrom = proj.x - fromNode.x, dzFrom = proj.z - fromNode.z;
    if (dxFrom * dxFrom + dzFrom * dzFrom < SNAP_THRESHOLD * SNAP_THRESHOLD) {
      if (!this.isIntersectionNode(edge.from)) return edge.from;
    }
    const dxTo = proj.x - toNode.x, dzTo = proj.z - toNode.z;
    if (dxTo * dxTo + dzTo * dzTo < SNAP_THRESHOLD * SNAP_THRESHOLD) {
      if (!this.isIntersectionNode(edge.to)) return edge.to;
    }

    // Create parking node (skip lat/lng computation -- parking nodes only need scene coords)
    const parkingId = this.nodes.length;
    this.nodes.push({ id: parkingId, lat: 0, lng: 0, x: proj.x, z: proj.z });

    // Split waypoints at projection point
    const wp = edge.waypoints;
    const splitPt = { x: proj.x, y: 0, z: proj.z };

    // First half: waypoints[0..segIndex] + splitPt
    const wpA: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i <= proj.segIndex; i++) wpA.push(wp[i]);
    if (proj.t > 0.001) wpA.push(splitPt);

    // Second half: splitPt + waypoints[segIndex+1..end]
    const wpB: Array<{ x: number; y: number; z: number }> = [splitPt];
    if (proj.t < 0.999) {
      for (let i = proj.segIndex + 1; i < wp.length; i++) wpB.push(wp[i]);
    } else {
      for (let i = proj.segIndex + 2; i < wp.length; i++) wpB.push(wp[i]);
    }

    const distA = computePolylineDist(wpA);
    const distB = computePolylineDist(wpB);
    const speed = SPEED_WEIGHTS[edge.roadType] ?? 0.5;

    // Remove forward edge from→to (handle stale edges from prior splits)
    const fwdEdges = this.adjacency.get(edge.from);
    if (fwdEdges) {
      const idx = fwdEdges.indexOf(edge);
      if (idx === -1) {
        const found = this.findSubEdge(edge.from, edge.to, proj.x, proj.z, edge.roadType);
        if (found) return this.insertParkingNode(found.edge, found.proj);
        return this.findNearestNode(proj.x, proj.z) ?? edge.from;
      }
      fwdEdges.splice(idx, 1);
    }

    // Add sub-edges for forward direction
    if (!this.adjacency.has(parkingId)) this.adjacency.set(parkingId, []);

    if (wpA.length >= 2 && distA >= MIN_SUBEDGE_LEN) {
      this.adjacency.get(edge.from)!.push({
        from: edge.from, to: parkingId, distance: distA,
        cost: distA * (2 - speed), roadType: edge.roadType, name: edge.name, waypoints: wpA,
      });
    }
    if (wpB.length >= 2 && distB >= MIN_SUBEDGE_LEN) {
      this.adjacency.get(parkingId)!.push({
        from: parkingId, to: edge.to, distance: distB,
        cost: distB * (2 - speed), roadType: edge.roadType, name: edge.name, waypoints: wpB,
      });
    }

    // Check for reverse edge (bidirectional road)
    const revEdges = this.adjacency.get(edge.to);
    if (revEdges) {
      const revIdx = revEdges.findIndex(e => e.to === edge.from && e.roadType === edge.roadType);
      if (revIdx !== -1) {
        revEdges.splice(revIdx, 1);
        const wpBRev = [...wpB].reverse();
        const wpARev = [...wpA].reverse();
        if (wpBRev.length >= 2 && distB >= MIN_SUBEDGE_LEN) {
          revEdges.push({
            from: edge.to, to: parkingId, distance: distB,
            cost: distB * (2 - speed), roadType: edge.roadType, name: edge.name, waypoints: wpBRev,
          });
        }
        if (wpARev.length >= 2 && distA >= MIN_SUBEDGE_LEN) {
          this.adjacency.get(parkingId)!.push({
            from: parkingId, to: edge.from, distance: distA,
            cost: distA * (2 - speed), roadType: edge.roadType, name: edge.name, waypoints: wpARev,
          });
        }
      }
    }

    this.connectedNodes.push(parkingId);
    this.addToSpatialGrid(parkingId);
    return parkingId;
  }

  private ensureAStarArrays() {
    const n = this.nodes.length;
    if (this.aStarDist.length < n) {
      this.aStarDist = new Float64Array(n);
      this.aStarPrev = new Int32Array(n);
      this.aStarGen = new Uint32Array(n);
    }
  }

  aStar(startId: number, endId: number): number[] | null {
    if (startId === endId) return null;
    if (!this.adjacency.has(startId) || !this.adjacency.has(endId)) return null;

    this.ensureAStarArrays();
    const dist = this.aStarDist;
    const prev = this.aStarPrev;
    const gen = this.aStarGen;

    // Generation counter: O(1) reset instead of O(N) fill
    if (this.currentGen >= 0xFFFFFFFF) {
      gen.fill(0);
      this.currentGen = 0;
    }
    const thisGen = ++this.currentGen;

    // A* heuristic target coords
    const endNode = this.nodes[endId];
    const endX = endNode.x;
    const endZ = endNode.z;

    gen[startId] = thisGen;
    dist[startId] = 0;
    prev[startId] = -1;

    const heap = this.heap;
    heap.reset();
    const startNode = this.nodes[startId];
    const startH = Math.sqrt((startNode.x - endX) * (startNode.x - endX) + (startNode.z - endZ) * (startNode.z - endZ));
    heap.insert(startId, 0, startH);

    while (!heap.isEmpty()) {
      const entry = heap.extractMin()!;
      const { node, cost } = entry;

      if (node === endId) break;
      if (cost > dist[node]) continue;

      const edges = this.adjacency.get(node);
      if (!edges) continue;

      const prevNode = prev[node];
      for (const edge of edges) {
        let turnPenalty = 0;
        if (prevNode !== -1 && this.isIntersectionNode(node)) {
          turnPenalty = this.computeTurnPenalty(prevNode, node, edge.to);
        }
        const newCost = dist[node] + edge.cost + turnPenalty;
        if (gen[edge.to] !== thisGen || newCost < dist[edge.to]) {
          gen[edge.to] = thisGen;
          dist[edge.to] = newCost;
          prev[edge.to] = node;
          const toNode = this.nodes[edge.to];
          const h = Math.sqrt((toNode.x - endX) * (toNode.x - endX) + (toNode.z - endZ) * (toNode.z - endZ));
          heap.insert(edge.to, newCost, newCost + h);
        }
      }
    }

    if (gen[endId] !== thisGen || dist[endId] === Infinity) return null;

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

  getRouteWaypointsWithOffset(nodePath: number[], skipFirst = false): Array<{ x: number; y: number; z: number }> {
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

      const offset = (i === 0 && skipFirst) ? 0 : getLaneOffset(edge.roadType);
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

  clearBuildingIndex(): void {
    this.indexedBuildings = [];
    this.buildingMap.clear();
  }

  async buildBuildingIndex(buildings: BuildingData[], signal?: AbortSignal) {
    if (this.connectedNodes.length === 0) {
      this.indexedBuildings = [];
      this.rebuildBuildingMap();
      return;
    }

    // Build segment spatial grid (25m cells) for O(1) nearest-segment lookup
    // Unified grid: used both for building-to-road matching and intersection parking scan
    const SEG_CELL = 25;
    interface SegEntry {
      ax: number; az: number; bx: number; bz: number;
      edge: GraphEdge;
      segIndex: number;
      dirX: number; dirZ: number; halfCasing: number;
    }
    const segGrid = new Map<number, SegEntry[]>();
    const indexed = new Set<number>();

    for (const nodeId of this.connectedNodes) {
      const edges = this.adjacency.get(nodeId);
      if (!edges) continue;
      for (const edge of edges) {
        if (isHighwayType(edge.roadType)) continue;
        const eKey = RoadGraph.edgeKey(edge.from, edge.to, edge.roadType);
        if (indexed.has(eKey)) continue;
        indexed.add(eKey);
        const wp = edge.waypoints;
        const halfCasing = getCasingWidth(edge.roadType) / 2;
        for (let i = 0; i < wp.length - 1; i++) {
          const ax = wp[i].x, az = wp[i].z;
          const bx = wp[i + 1].x, bz = wp[i + 1].z;
          const dx = bx - ax, dz = bz - az;
          const lenSq = dx * dx + dz * dz;
          if (lenSq < 0.0001) continue;
          const len = Math.sqrt(lenSq);
          const entry: SegEntry = { ax, az, bx, bz, edge, segIndex: i, dirX: dx / len, dirZ: dz / len, halfCasing };
          const minCx = Math.floor(Math.min(ax, bx) / SEG_CELL);
          const maxCx = Math.floor(Math.max(ax, bx) / SEG_CELL);
          const minCz = Math.floor(Math.min(az, bz) / SEG_CELL);
          const maxCz = Math.floor(Math.max(az, bz) / SEG_CELL);
          for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cz = minCz; cz <= maxCz; cz++) {
              const key = RoadGraph.gridKey(cx, cz);
              let bucket = segGrid.get(key);
              if (!bucket) { bucket = []; segGrid.set(key, bucket); }
              bucket.push(entry);
            }
          }
        }
      }
    }

    // Dedicated intersection grid: includes ALL intersection nodes
    const INT_CELL = 25;
    const intNodeGrid = new Map<number, Array<{ x: number; z: number }>>();
    for (const nodeId of this.intersectionNodes) {
      const n = this.nodes[nodeId];
      const key = RoadGraph.gridKey(Math.floor(n.x / INT_CELL), Math.floor(n.z / INT_CELL));
      if (!intNodeGrid.has(key)) intNodeGrid.set(key, []);
      intNodeGrid.get(key)!.push({ x: n.x, z: n.z });
    }

    const newIndex: IndexedBuilding[] = [];
    const nearbyEdgeKeys = new Set<number>();
    const allNearbyEdges: GraphEdge[] = [];
    const bestProjBuf: ProjectionResult = { x: 0, z: 0, segIndex: 0, t: 0, distSq: Infinity };

    const YIELD_BATCH = 100;
    for (let bi = 0; bi < buildings.length; bi++) {
      if (bi > 0 && bi % YIELD_BATCH === 0) {
        if (signal?.aborted) return;
        await yieldToMain();
      }
      const b = buildings[bi];
      if (b.polygon.length === 0) continue;
      let sumLat = 0, sumLng = 0;
      for (const p of b.polygon) {
        sumLat += p.lat;
        sumLng += p.lng;
      }
      const centroid = project({ lat: sumLat / b.polygon.length, lng: sumLng / b.polygon.length });

      // Query segment grid 3x3 neighborhood
      const scx = Math.floor(centroid.x / SEG_CELL);
      const scz = Math.floor(centroid.z / SEG_CELL);

      let bestDistSq = Infinity;
      let bestEdge: GraphEdge | null = null;
      let bestProj: ProjectionResult | null = null;
      nearbyEdgeKeys.clear();
      allNearbyEdges.length = 0;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = segGrid.get(RoadGraph.gridKey(scx + dx, scz + dz));
          if (!bucket) continue;
          for (const seg of bucket) {
            // Point-to-segment distance (O(1) per segment)
            const abx = seg.bx - seg.ax, abz = seg.bz - seg.az;
            const ab2 = abx * abx + abz * abz;
            const t = Math.max(0, Math.min(1,
              ((centroid.x - seg.ax) * abx + (centroid.z - seg.az) * abz) / ab2));
            const cx = seg.ax + t * abx, cz = seg.az + t * abz;
            const ddx = centroid.x - cx, ddz = centroid.z - cz;
            const d2 = ddx * ddx + ddz * ddz;

            // Track unique edges for cross-road checks
            const eKey = RoadGraph.edgeKey(seg.edge.from, seg.edge.to, seg.edge.roadType);
            if (!nearbyEdgeKeys.has(eKey)) {
              nearbyEdgeKeys.add(eKey);
              allNearbyEdges.push(seg.edge);
            }

            if (d2 < bestDistSq) {
              bestDistSq = d2;
              bestEdge = seg.edge;
              bestProjBuf.x = cx; bestProjBuf.z = cz;
              bestProjBuf.segIndex = seg.segIndex; bestProjBuf.t = t; bestProjBuf.distSq = d2;
              bestProj = bestProjBuf;
            }
          }
        }
      }

      if (!bestEdge || !bestProj || bestDistSq >= MAX_BUILDING_NODE_DIST_SQ) continue;

      // Layer 1: Lookup intersection nodes near PROJECTION point (dedicated grid)
      const pCx = Math.floor(bestProj.x / INT_CELL);
      const pCz = Math.floor(bestProj.z / INT_CELL);
      const nearbyIntPositions: Array<{ x: number; z: number }> = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = intNodeGrid.get(RoadGraph.gridKey(pCx + dx, pCz + dz));
          if (bucket) for (const pos of bucket) nearbyIntPositions.push(pos);
        }
      }

      // Layer 2: Collect non-connected edges for cross-road check
      const bestEdgeMinMax = Math.min(bestEdge.from, bestEdge.to) * 100000 + Math.max(bestEdge.from, bestEdge.to);
      const crossEdges: Array<{ pts: Array<{ x: number; z: number }>; halfW: number }> = [];
      for (const e of allNearbyEdges) {
        const eMinMax = Math.min(e.from, e.to) * 100000 + Math.max(e.from, e.to);
        if (eMinMax === bestEdgeMinMax) continue;
        if (e.from === bestEdge.from || e.from === bestEdge.to ||
            e.to === bestEdge.from || e.to === bestEdge.to) continue;
        crossEdges.push({
          pts: e.waypoints.map(w => ({ x: w.x, z: w.z })),
          halfW: getCasingWidth(e.roadType) / 2,
        });
      }

      const INTERSECTION_CLEARANCE = 20;
      const INTERSECTION_CLEARANCE_SQ = INTERSECTION_CLEARANCE * INTERSECTION_CLEARANCE;

      const isUnsafePosition = (x: number, z: number): boolean => {
        for (const n of nearbyIntPositions) {
          const ddx = x - n.x, ddz = z - n.z;
          if (ddx * ddx + ddz * ddz < INTERSECTION_CLEARANCE_SQ) return true;
        }
        for (const ce of crossEdges) {
          const proj = projectOnPolyline(x, z, ce.pts);
          if (proj && proj.distSq < ce.halfW * ce.halfW) return true;
        }
        return false;
      };

      if (isUnsafePosition(bestProj.x, bestProj.z)) {
        const wp = bestEdge.waypoints;
        // Find which unsafe source is closest to the projection
        let nearX = 0, nearZ = 0, nearDist = Infinity;
        for (const n of nearbyIntPositions) {
          const ddx = bestProj.x - n.x, ddz = bestProj.z - n.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < nearDist) { nearDist = d2; nearX = n.x; nearZ = n.z; }
        }
        // Also check cross-road projection points as unsafe sources
        for (const ce of crossEdges) {
          const cp = projectOnPolyline(bestProj.x, bestProj.z, ce.pts);
          if (cp && cp.distSq < nearDist) { nearDist = cp.distSq; nearX = cp.x; nearZ = cp.z; }
        }
        // Determine which edge end is closer to that unsafe source
        const dxS = wp[0].x - nearX, dzS = wp[0].z - nearZ;
        const dxE = wp[wp.length - 1].x - nearX, dzE = wp[wp.length - 1].z - nearZ;
        const startCloser = (dxS * dxS + dzS * dzS) < (dxE * dxE + dzE * dzE);

        // Try sliding away from the closer end first, then the other direction
        let valid = false;
        const slid1 = slideAwayFromEndpoint(wp, startCloser, INTERSECTION_CLEARANCE);
        if (slid1 && !isUnsafePosition(slid1.x, slid1.z)) {
          bestProj.x = slid1.x; bestProj.z = slid1.z;
          bestProj.segIndex = slid1.segIndex; bestProj.t = slid1.t;
          valid = true;
        }
        if (!valid) {
          const slid2 = slideAwayFromEndpoint(wp, !startCloser, INTERSECTION_CLEARANCE);
          if (slid2 && !isUnsafePosition(slid2.x, slid2.z)) {
            bestProj.x = slid2.x; bestProj.z = slid2.z;
            bestProj.segIndex = slid2.segIndex; bestProj.t = slid2.t;
            valid = true;
          }
        }
        if (!valid) continue;
      }

      // Insert parking node by splitting the edge
      const parkingNodeId = this.insertParkingNode(bestEdge, bestProj);

      // Compute road direction from the waypoint segment at projection
      const wp = bestEdge.waypoints;
      const si = bestProj.segIndex;
      const rdx = wp[si + 1].x - wp[si].x;
      const rdz = wp[si + 1].z - wp[si].z;
      const rLen = Math.sqrt(rdx * rdx + rdz * rdz);
      let dirX = rLen > 0.001 ? rdx / rLen : 1;
      let dirZ = rLen > 0.001 ? rdz / rLen : 0;

      // Flip roadDir so perpRight (-dirZ, dirX) faces toward the building
      const perpX = -dirZ, perpZ = dirX;
      const toBldgX = centroid.x - bestProj.x, toBldgZ = centroid.z - bestProj.z;
      if (perpX * toBldgX + perpZ * toBldgZ < 0) {
        dirX = -dirX; dirZ = -dirZ;
      }

      newIndex.push({
        buildingId: b.id,
        centroidX: centroid.x,
        centroidZ: centroid.z,
        nearestNodeId: parkingNodeId,
        roadDirX: dirX,
        roadDirZ: dirZ,
        roadType: bestEdge.roadType,
        roadName: bestEdge.name,
      });
    }

    if (signal?.aborted) return;

    // Atomic swap: old index stays visible until fully built
    this.indexedBuildings = newIndex;
    this.rebuildBuildingMap();

    await this.scanAndRemoveIntersectionParking(segGrid, SEG_CELL, signal);
  }

  private async scanAndRemoveIntersectionParking(
    segGrid: Map<number, Array<{ ax: number; az: number; bx: number; bz: number; dirX: number; dirZ: number; halfCasing: number }>>,
    SEG_CELL: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.indexedBuildings.length === 0) return;

    const isInIntersection = (px: number, pz: number, rdx: number, rdz: number): boolean => {
      const cx = Math.floor(px / SEG_CELL);
      const cz = Math.floor(pz / SEG_CELL);
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcz = -1; dcz <= 1; dcz++) {
          const bucket = segGrid.get(RoadGraph.gridKey(cx + dcx, cz + dcz));
          if (!bucket) continue;
          for (const seg of bucket) {
            const sabx = seg.bx - seg.ax, sabz = seg.bz - seg.az;
            const sab2 = sabx * sabx + sabz * sabz;
            if (sab2 < 0.0001) continue;
            const t = Math.max(0, Math.min(1,
              ((px - seg.ax) * sabx + (pz - seg.az) * sabz) / sab2));
            const qx = seg.ax + t * sabx, qz = seg.az + t * sabz;
            const ddx = px - qx, ddz = pz - qz;
            const distSq = ddx * ddx + ddz * ddz;
            const clearance = Math.max(seg.halfCasing, 8);
            if (distSq > clearance * clearance) continue;
            const absDot = Math.abs(seg.dirX * rdx + seg.dirZ * rdz);
            if (absDot > 0.85) continue;
            return true;
          }
        }
      }
      return false;
    };

    // Phase 2+3: Scan each building, try relocate, else remove
    const SLIDE_DIST = 20;
    const toRemove: number[] = [];

    for (let bi = 0; bi < this.indexedBuildings.length; bi++) {
      if (bi > 0 && bi % 50 === 0) {
        if (signal?.aborted) return;
        await yieldToMain();
      }
      const b = this.indexedBuildings[bi];
      const node = this.nodes[b.nearestNodeId];
      if (!isInIntersection(node.x, node.z, b.roadDirX, b.roadDirZ)) continue;

      let relocated = false;
      const edges = this.adjacency.get(b.nearestNodeId);
      if (edges) {
        for (const edge of edges) {
          if (isHighwayType(edge.roadType)) continue;
          const slid = slideAwayFromEndpoint(edge.waypoints, true, SLIDE_DIST);
          if (!slid) continue;

          const si = slid.segIndex;
          const sdx = edge.waypoints[si + 1].x - edge.waypoints[si].x;
          const sdz = edge.waypoints[si + 1].z - edge.waypoints[si].z;
          const sLen = Math.sqrt(sdx * sdx + sdz * sdz);
          const newDirX = sLen > 0.001 ? sdx / sLen : b.roadDirX;
          const newDirZ = sLen > 0.001 ? sdz / sLen : b.roadDirZ;

          if (isInIntersection(slid.x, slid.z, newDirX, newDirZ)) continue;

          const proj: ProjectionResult = {
            x: slid.x, z: slid.z,
            segIndex: slid.segIndex, t: slid.t, distSq: 0,
          };
          const newNodeId = this.insertParkingNode(edge, proj);

          let dirX = newDirX, dirZ = newDirZ;
          const perpX = -dirZ, perpZ = dirX;
          const toBldgX = b.centroidX - slid.x, toBldgZ = b.centroidZ - slid.z;
          if (perpX * toBldgX + perpZ * toBldgZ < 0) {
            dirX = -dirX; dirZ = -dirZ;
          }

          b.nearestNodeId = newNodeId;
          b.roadDirX = dirX;
          b.roadDirZ = dirZ;
          b.roadName = edge.name;
          relocated = true;
          break;
        }
      }

      if (!relocated) toRemove.push(bi);
    }

    if (toRemove.length > 0) {
      const removeSet = new Set(toRemove);
      this.indexedBuildings = this.indexedBuildings.filter((_, i) => !removeSet.has(i));
      this.rebuildBuildingMap();
    }
  }

  private rebuildBuildingMap() {
    this.buildingMap.clear();
    for (const b of this.indexedBuildings) {
      this.buildingMap.set(b.buildingId, b);
    }
  }

  getRandomBuildingDestination(): { nodeId: number; buildingX: number; buildingZ: number; buildingId: number; roadDirX: number; roadDirZ: number; roadType: string } | null {
    if (this.indexedBuildings.length === 0) return null;
    const b = this.indexedBuildings[Math.floor(Math.random() * this.indexedBuildings.length)];
    return { nodeId: b.nearestNodeId, buildingX: b.centroidX, buildingZ: b.centroidZ, buildingId: b.buildingId, roadDirX: b.roadDirX, roadDirZ: b.roadDirZ, roadType: b.roadType };
  }

  getBuildingDestination(buildingId: number): { nodeId: number; buildingX: number; buildingZ: number; roadDirX: number; roadDirZ: number; roadType: string } | null {
    const b = this.buildingMap.get(buildingId);
    if (!b) return null;
    return { nodeId: b.nearestNodeId, buildingX: b.centroidX, buildingZ: b.centroidZ, roadDirX: b.roadDirX, roadDirZ: b.roadDirZ, roadType: b.roadType };
  }

  getBuildingRoadName(buildingId: number): string | null {
    const b = this.buildingMap.get(buildingId);
    return b?.roadName || null;
  }

  filterIndexedBuildings(keepIds: Set<number>): void {
    this.indexedBuildings = this.indexedBuildings.filter(b => keepIds.has(b.buildingId));
    this.rebuildBuildingMap();
  }

  restoreBuilding(buildingId: number, saved: {
    centroidX: number; centroidZ: number;
    parkX: number; parkZ: number;
    dirX: number; dirZ: number;
    roadType: string; roadName: string;
  }): boolean {
    const existing = this.buildingMap.get(buildingId);
    if (existing) {
      if (!existing.roadName && saved.roadName) existing.roadName = saved.roadName;
      return true;
    }

    const cell = this.spatialCellSize;
    const cx = Math.floor(saved.parkX / cell);
    const cz = Math.floor(saved.parkZ / cell);

    let bestEdge: GraphEdge | null = null;
    let bestProj: ProjectionResult | null = null;
    let bestDistSq = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.spatialGrid.get(RoadGraph.gridKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const nodeId of bucket) {
          const edges = this.adjacency.get(nodeId);
          if (!edges) continue;
          for (const edge of edges) {
            if (isHighwayType(edge.roadType)) continue;
            const wp2d = edge.waypoints.map(w => ({ x: w.x, z: w.z }));
            const proj = projectOnPolyline(saved.parkX, saved.parkZ, wp2d);
            if (!proj || proj.distSq >= bestDistSq) continue;
            bestDistSq = proj.distSq;
            bestEdge = edge;
            bestProj = proj;
          }
        }
      }
    }

    if (!bestEdge || !bestProj || bestDistSq > 30 * 30) return false;

    const parkingNodeId = this.insertParkingNode(bestEdge, bestProj);
    const ib: IndexedBuilding = {
      buildingId,
      centroidX: saved.centroidX,
      centroidZ: saved.centroidZ,
      nearestNodeId: parkingNodeId,
      roadDirX: saved.dirX,
      roadDirZ: saved.dirZ,
      roadType: saved.roadType,
      roadName: saved.roadName,
    };
    this.indexedBuildings.push(ib);
    this.buildingMap.set(buildingId, ib);
    return true;
  }

  getIndexedBuildings(): IndexedBuilding[] {
    return this.indexedBuildings;
  }
}
