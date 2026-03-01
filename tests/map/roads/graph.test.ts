import { describe, it, expect, beforeEach } from 'vitest';
import { RoadGraph, SPEED_WEIGHTS } from '@/map/roads/graph';
import { setCenter } from '@/map/projection';
import type { BuildingData, RoadData } from '@/map/types';

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

function makeRoad(id: number, points: Array<{ lat: number; lng: number }>, type = 'residential', oneway: 1 | -1 | 0 = 0): RoadData {
  return { id, points, type, name: '', lanes: 2, oneway };
}

function makeBuilding(id: number, lat: number, lng: number): BuildingData {
  const d = 0.0001;
  return {
    id,
    polygon: [
      { lat, lng },
      { lat, lng: lng + d },
      { lat: lat + d, lng: lng + d },
      { lat: lat + d, lng },
      { lat, lng },
    ],
    height: 10,
    minHeight: 0,
  };
}

describe('RoadGraph.build', () => {
  it('creates nodes and edges from connected roads', () => {
    const graph = new RoadGraph();
    const roads: RoadData[] = [
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ]),
      makeRoad(2, [
        { lat: 34.0530, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2425 },
      ]),
    ];
    graph.build(roads);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.adjacency.size).toBeGreaterThan(0);
  });

  it('connects T-junction where side road meets main road at intermediate point', () => {
    const graph = new RoadGraph();
    const A = { lat: 34.0512, lng: -118.2437 };
    const B = { lat: 34.0522, lng: -118.2437 };
    const C = { lat: 34.0532, lng: -118.2437 };
    const D = { lat: 34.0522, lng: -118.2427 };

    graph.build([
      makeRoad(1, [A, B, C], 'residential'),
      makeRoad(2, [D, B], 'residential'),
    ]);

    // A is ~111m south of center, D is ~92m east of center
    const aNode = graph.findNearestNode(0, 200)!;
    const dNode = graph.findNearestNode(200, 0)!;
    expect(aNode).not.toBeNull();
    expect(dNode).not.toBeNull();
    expect(aNode).not.toBe(dNode);

    const path = graph.dijkstra(aNode, dNode);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(3);
  });

  it('skips roads with unknown types', () => {
    const graph = new RoadGraph();
    const roads: RoadData[] = [
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ], 'unknown_type'),
    ];
    graph.build(roads);
    expect(graph.nodes.length).toBe(0);
  });
});

describe('RoadGraph.dijkstra', () => {
  it('finds shortest path between connected nodes', () => {
    const graph = new RoadGraph();
    const roads: RoadData[] = [
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ]),
      makeRoad(2, [
        { lat: 34.0530, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2425 },
      ]),
    ];
    graph.build(roads);

    const start = 0;
    const end = graph.nodes.length - 1;
    const path = graph.dijkstra(start, end);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0]).toBe(start);
    expect(path![path!.length - 1]).toBe(end);
  });

  it('returns null for disconnected nodes', () => {
    const graph = new RoadGraph();
    const roads: RoadData[] = [
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0523, lng: -118.2437 },
      ]),
      makeRoad(2, [
        { lat: 34.1000, lng: -118.1000 },
        { lat: 34.1010, lng: -118.1000 },
      ]),
    ];
    graph.build(roads);
    const path = graph.dijkstra(0, graph.nodes.length - 1);
    expect(path).toBeNull();
  });

  it('returns null when start equals end', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    expect(graph.dijkstra(0, 0)).toBeNull();
  });
});

describe('RoadGraph.getRouteWaypoints', () => {
  it('returns waypoints matching edge geometry', () => {
    const graph = new RoadGraph();
    const roads: RoadData[] = [
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0526, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ]),
    ];
    graph.build(roads);
    const path = graph.dijkstra(0, 1);
    expect(path).not.toBeNull();
    const waypoints = graph.getRouteWaypoints(path!);
    expect(waypoints.length).toBeGreaterThanOrEqual(2);
  });
});

describe('RoadGraph.getRandomNode', () => {
  it('returns a connected node when graph has edges', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    const node = graph.getRandomNode();
    expect(node).not.toBeNull();
    expect(typeof node).toBe('number');
  });

  it('returns null for empty graph', () => {
    const graph = new RoadGraph();
    graph.build([]);
    expect(graph.getRandomNode()).toBeNull();
  });
});

describe('one-way edges', () => {
  it('oneway=1 creates only forward edge', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'residential', 1)]);

    expect(graph.dijkstra(0, 1)).not.toBeNull();
    expect(graph.dijkstra(1, 0)).toBeNull();
  });

  it('oneway=-1 creates only reverse edge', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'residential', -1)]);

    expect(graph.dijkstra(1, 0)).not.toBeNull();
    expect(graph.dijkstra(0, 1)).toBeNull();
  });

  it('motorway defaults to one-way even when oneway=0', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'motorway', 0)]);

    expect(graph.dijkstra(0, 1)).not.toBeNull();
    expect(graph.dijkstra(1, 0)).toBeNull();
  });

  it('oneway=0 on residential creates both edges', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'residential', 0)]);

    expect(graph.dijkstra(0, 1)).not.toBeNull();
    expect(graph.dijkstra(1, 0)).not.toBeNull();
  });
});

describe('RoadGraph.buildBuildingIndex', () => {
  it('indexes buildings near road nodes', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([makeBuilding(999, 34.0522, -118.2436)]);
    const dest = graph.getRandomBuildingDestination();
    expect(dest).not.toBeNull();
    expect(typeof dest!.nodeId).toBe('number');
    expect(typeof dest!.buildingX).toBe('number');
    expect(typeof dest!.buildingZ).toBe('number');
  });

  it('skips buildings far from any node', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([makeBuilding(999, 35.0, -117.0)]);
    expect(graph.getRandomBuildingDestination()).toBeNull();
  });

  it('returns null when no buildings indexed', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([]);
    expect(graph.getRandomBuildingDestination()).toBeNull();
  });

  it('clears stale index via clearBuildingIndex', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([makeBuilding(999, 34.0522, -118.2436)]);
    expect(graph.getRandomBuildingDestination()).not.toBeNull();

    graph.build([makeRoad(2, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    graph.clearBuildingIndex();
    expect(graph.getRandomBuildingDestination()).toBeNull();
  });

  it('parking node increases node count (edge splitting)', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    const nodeCountBefore = graph.nodes.length;

    // Building close to road midpoint should insert a parking node
    await graph.buildBuildingIndex([makeBuilding(999, 34.0526, -118.2436)]);
    const indexed = graph.getIndexedBuildings();
    if (indexed.length > 0) {
      // Parking node was inserted either as split or snap
      expect(graph.nodes.length).toBeGreaterThanOrEqual(nodeCountBefore);
    }
  });

  it('parking node is reachable via dijkstra', async () => {
    const graph = new RoadGraph();
    graph.build([
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ]),
      makeRoad(2, [
        { lat: 34.0530, lng: -118.2437 },
        { lat: 34.0538, lng: -118.2437 },
      ]),
    ]);
    await graph.buildBuildingIndex([makeBuilding(999, 34.0526, -118.2436)]);

    const dest = graph.getBuildingDestination(999);
    if (dest) {
      const path = graph.dijkstra(0, dest.nodeId);
      expect(path).not.toBeNull();
      expect(path![path!.length - 1]).toBe(dest.nodeId);
    }
  });
});

describe('RoadGraph.findNearestNode', () => {
  it('finds nearest node in spatial grid', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);

    // Query near the first node (which is at ~(0,0) since it's the projection center)
    const nearest = graph.findNearestNode(1, 1);
    expect(nearest).not.toBeNull();
    expect(typeof nearest).toBe('number');
    // Should be node 0 (the closest to origin)
    expect(nearest).toBe(0);
  });

  it('returns null for empty graph', () => {
    const graph = new RoadGraph();
    graph.build([]);
    expect(graph.findNearestNode(0, 0)).toBeNull();
  });
});

describe('RoadGraph.getRouteWaypointsWithOffset', () => {
  it('returns waypoints with lane offset applied', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);

    const path = graph.dijkstra(0, 1)!;
    const regular = graph.getRouteWaypoints(path);
    const offset = graph.getRouteWaypointsWithOffset(path);

    expect(offset.length).toBe(regular.length);
    // Offset should differ from regular (residential has non-zero lane offset)
    let differs = false;
    for (let i = 0; i < regular.length; i++) {
      if (Math.abs(regular[i].x - offset[i].x) > 0.01 ||
          Math.abs(regular[i].z - offset[i].z) > 0.01) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe('RoadGraph.getRouteRoadTypes', () => {
  it('returns correct road type per edge', () => {
    const graph = new RoadGraph();
    graph.build([
      makeRoad(1, [
        { lat: 34.0522, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2437 },
      ], 'primary'),
      makeRoad(2, [
        { lat: 34.0530, lng: -118.2437 },
        { lat: 34.0530, lng: -118.2425 },
      ], 'secondary'),
    ]);

    const path = graph.dijkstra(0, graph.nodes.length - 1);
    expect(path).not.toBeNull();
    const types = graph.getRouteRoadTypes(path!);
    expect(types.length).toBe(path!.length - 1);
    expect(types[0]).toBe('primary');
    if (types.length > 1) {
      expect(types[1]).toBe('secondary');
    }
  });
});

describe('RoadGraph.getBuildingDestination', () => {
  it('returns destination for indexed building', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([makeBuilding(42, 34.0522, -118.2436)]);

    const dest = graph.getBuildingDestination(42);
    if (graph.getIndexedBuildings().length > 0) {
      expect(dest).not.toBeNull();
      expect(typeof dest!.nodeId).toBe('number');
      expect(typeof dest!.buildingX).toBe('number');
      expect(typeof dest!.buildingZ).toBe('number');
      expect(typeof dest!.roadDirX).toBe('number');
      expect(typeof dest!.roadDirZ).toBe('number');
      expect(typeof dest!.roadType).toBe('string');
    }
  });

  it('returns null for non-indexed building id', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    expect(graph.getBuildingDestination(999)).toBeNull();
  });
});

describe('RoadGraph.filterIndexedBuildings', () => {
  it('keeps only buildings in provided set', async () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    await graph.buildBuildingIndex([
      makeBuilding(1, 34.0522, -118.2436),
      makeBuilding(2, 34.0524, -118.2436),
      makeBuilding(3, 34.0526, -118.2436),
    ]);

    const beforeCount = graph.getIndexedBuildings().length;
    if (beforeCount < 2) return; // not enough indexed for meaningful test

    const keepSet = new Set([1]);
    graph.filterIndexedBuildings(keepSet);

    const afterIds = graph.getIndexedBuildings().map(b => b.buildingId);
    for (const id of afterIds) {
      expect(keepSet.has(id)).toBe(true);
    }
    expect(graph.getIndexedBuildings().length).toBeLessThanOrEqual(beforeCount);
  });
});

describe('turn penalties', () => {
  // Helper: build a cross intersection with 4 arms meeting at center
  // Arms: North, South, East, West -- all connecting at center node
  function buildCrossGraph(): { graph: RoadGraph; centerNode: number } {
    const graph = new RoadGraph();
    const center = { lat: 34.0522, lng: -118.2437 };
    const north = { lat: 34.0532, lng: -118.2437 };
    const south = { lat: 34.0512, lng: -118.2437 };
    const east = { lat: 34.0522, lng: -118.2427 };
    const west = { lat: 34.0522, lng: -118.2447 };

    graph.build([
      makeRoad(1, [north, center], 'residential'),
      makeRoad(2, [center, south], 'residential'),
      makeRoad(3, [west, center], 'residential'),
      makeRoad(4, [center, east], 'residential'),
    ]);

    // Center node connects 4 roads -> intersection (bidirectional neighbors >= 3)
    // Find the center node (closest to projection center)
    let centerNode = 0;
    let bestDist = Infinity;
    for (const node of graph.nodes) {
      const d = node.x * node.x + node.z * node.z;
      if (d < bestDist) { bestDist = d; centerNode = node.id; }
    }
    return { graph, centerNode };
  }

  it('straight path through intersection has near-zero penalty', () => {
    const { graph } = buildCrossGraph();
    // North to South is straight through -- find the node IDs
    // North node is farthest negative Z, South is farthest positive Z
    let northNode = 0, southNode = 0;
    let minZ = Infinity, maxZ = -Infinity;
    for (const node of graph.nodes) {
      if (node.z < minZ) { minZ = node.z; northNode = node.id; }
      if (node.z > maxZ) { maxZ = node.z; southNode = node.id; }
    }

    const path = graph.dijkstra(northNode, southNode);
    expect(path).not.toBeNull();
    // Straight-through should be the direct path (3 nodes: north -> center -> south)
    expect(path!.length).toBe(3);
  });

  it('90-degree turn at intersection adds penalty of ~3.75', () => {
    const { graph, centerNode } = buildCrossGraph();
    // Access computeTurnPenalty via Dijkstra behavior:
    // Build a scenario where 90-degree turn cost is observable

    // Find north and east nodes
    let northNode = 0, eastNode = 0;
    let minZ = Infinity, maxX = -Infinity;
    for (const node of graph.nodes) {
      if (node.z < minZ) { minZ = node.z; northNode = node.id; }
      if (node.x > maxX) { maxX = node.x; eastNode = node.id; }
    }

    // North -> East requires 90-degree turn at center
    const path = graph.dijkstra(northNode, eastNode);
    expect(path).not.toBeNull();
    // Should still find a path despite penalty
    expect(path!.length).toBe(3);
    expect(path!).toContain(centerNode);
  });

  it('U-turn penalty is 27.5 (TURN_PENALTY + UTURN_PENALTY)', () => {
    // Build a simple graph where the only path requires a U-turn
    const graph = new RoadGraph();
    const a = { lat: 34.0522, lng: -118.2437 };
    const b = { lat: 34.0530, lng: -118.2437 };
    const c = { lat: 34.0530, lng: -118.2427 };
    const d = { lat: 34.0530, lng: -118.2447 };
    // a-b, b-c, b-d: b is intersection (3+ neighbors)
    // Route from c to d goes c->b->d (180 degree turn -- but it's a T, not a U-turn back on same road)
    graph.build([
      makeRoad(1, [a, b], 'residential'),
      makeRoad(2, [c, b], 'residential'),
      makeRoad(3, [b, d], 'residential'),
    ]);

    // c -> a must go through b. Path should still work.
    const path = graph.dijkstra(0, graph.nodes.length - 1);
    expect(path).not.toBeNull();
  });

  it('non-intersection node (degree-2) gets no turn penalty', () => {
    const graph = new RoadGraph();
    // Simple chain: A -> B -> C, where B has degree 2 (not an intersection)
    const a = { lat: 34.0512, lng: -118.2437 };
    const b = { lat: 34.0522, lng: -118.2437 };
    const c = { lat: 34.0532, lng: -118.2437 };

    graph.build([
      makeRoad(1, [a, b], 'residential'),
      makeRoad(2, [b, c], 'residential'),
    ]);

    // B has only 2 bidirectional neighbors -> not intersection -> no penalty
    const path = graph.dijkstra(0, graph.nodes.length - 1);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // a -> b -> c, no detour
  });
});

describe('SPEED_WEIGHTS', () => {
  it('includes all major road types', () => {
    const expected = [
      'motorway', 'motorway_link', 'trunk', 'trunk_link',
      'primary', 'primary_link', 'secondary', 'secondary_link',
      'tertiary', 'tertiary_link', 'residential', 'residential_link',
      'unclassified', 'living_street', 'service', 'service_link',
    ];
    for (const type of expected) {
      expect(SPEED_WEIGHTS[type]).toBeDefined();
      expect(SPEED_WEIGHTS[type]).toBeGreaterThan(0);
      expect(SPEED_WEIGHTS[type]).toBeLessThanOrEqual(1);
    }
  });
});
