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

    // Find start and end nodes
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
    // Two roads far apart (won't cluster)
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
    // Nodes from road 1 can't reach nodes from road 2
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

    // Forward (0 -> 1) should exist
    const forwardPath = graph.dijkstra(0, 1);
    expect(forwardPath).not.toBeNull();

    // Reverse (1 -> 0) should not exist
    const reversePath = graph.dijkstra(1, 0);
    expect(reversePath).toBeNull();
  });

  it('oneway=-1 creates only reverse edge', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'residential', -1)]);

    // Reverse (1 -> 0) should exist
    const reversePath = graph.dijkstra(1, 0);
    expect(reversePath).not.toBeNull();

    // Forward (0 -> 1) should not exist
    const forwardPath = graph.dijkstra(0, 1);
    expect(forwardPath).toBeNull();
  });

  it('motorway defaults to one-way even when oneway=0', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ], 'motorway', 0)]);

    // Forward should exist
    const forwardPath = graph.dijkstra(0, 1);
    expect(forwardPath).not.toBeNull();

    // Reverse should not (default one-way)
    const reversePath = graph.dijkstra(1, 0);
    expect(reversePath).toBeNull();
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

function makeBuilding(lat: number, lng: number): BuildingData {
  const d = 0.0001;
  return {
    id: 999,
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

describe('RoadGraph.buildBuildingIndex', () => {
  it('indexes buildings near road nodes', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    // Building very close to the road start
    graph.buildBuildingIndex([makeBuilding(34.0522, -118.2436)]);
    const dest = graph.getRandomBuildingDestination();
    expect(dest).not.toBeNull();
    expect(typeof dest!.nodeId).toBe('number');
    expect(typeof dest!.buildingX).toBe('number');
    expect(typeof dest!.buildingZ).toBe('number');
  });

  it('skips buildings far from any node', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    // Building very far away
    graph.buildBuildingIndex([makeBuilding(35.0, -117.0)]);
    expect(graph.getRandomBuildingDestination()).toBeNull();
  });

  it('returns null when no buildings indexed', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    graph.buildBuildingIndex([]);
    expect(graph.getRandomBuildingDestination()).toBeNull();
  });

  it('clears stale index on graph rebuild', () => {
    const graph = new RoadGraph();
    graph.build([makeRoad(1, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    graph.buildBuildingIndex([makeBuilding(34.0522, -118.2436)]);
    expect(graph.getRandomBuildingDestination()).not.toBeNull();

    // Rebuild graph without building index call
    graph.build([makeRoad(2, [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 34.0530, lng: -118.2437 },
    ])]);
    expect(graph.getRandomBuildingDestination()).toBeNull();
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
