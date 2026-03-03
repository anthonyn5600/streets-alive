import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CarManager } from '@/map/cars';
import { setCenter } from '@/map/projection';
import type { RoadData } from '@/map/types';

function makeRoad(
  id: number,
  points: Array<{ lat: number; lng: number }>,
  type = 'residential',
  oneway: 1 | -1 | 0 = 0
): RoadData {
  return { id, points, type, name: `Road ${id}`, lanes: 2, oneway };
}

// Grid of roads producing 12+ graph nodes (spawnCars requires >= 10 nodes).
// Uses ~0.001 degree spacing (~100m) so endpoints don't cluster.
function makeTestRoads(): RoadData[] {
  const base = { lat: 34.0522, lng: -118.2437 };
  const step = 0.001;
  const roads: RoadData[] = [];
  let id = 1;
  // 6 horizontal roads
  for (let row = 0; row < 6; row++) {
    roads.push(makeRoad(id++, [
      { lat: base.lat + row * step, lng: base.lng },
      { lat: base.lat + row * step, lng: base.lng + step },
    ]));
  }
  // 6 vertical roads connecting them
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 5; row++) {
      roads.push(makeRoad(id++, [
        { lat: base.lat + row * step, lng: base.lng + col * step },
        { lat: base.lat + (row + 1) * step, lng: base.lng + col * step },
      ]));
    }
  }
  return roads;
}

beforeEach(() => {
  setCenter(34.0522, -118.2437);
});

describe('CarManager constructor', () => {
  it('starts with empty car list', () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    expect(cm.getCarInfo()).toEqual([]);
    expect(cm.getSelectedCarIds().size).toBe(0);
    cm.dispose();
  });
});

describe('CarManager.rebuildGraph', () => {
  it('spawns legacy cars when graph has enough nodes', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);

    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getCarInfo();
    expect(cars.length).toBeGreaterThan(0);
    cm.dispose();
  });

  it('skips rebuild for same road version', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);

    await cm.rebuildGraph(makeTestRoads(), 1);
    const countAfterFirst = cm.getCarInfo().length;

    // Same version should be a no-op
    await cm.rebuildGraph(makeTestRoads(), 1);
    expect(cm.getCarInfo().length).toBe(countAfterFirst);
    cm.dispose();
  });
});

describe('legacy car behavior', () => {
  it('spawns cars with state driving and positive speed', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const simCars = cm.getSimCarInfo();
    expect(simCars.length).toBeGreaterThan(0);
    for (const car of simCars) {
      expect(car.state).toBe('driving');
      expect(car.speed).toBeGreaterThan(0);
    }
    cm.dispose();
  });

  it('advances driving positions on update', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getSimCarInfo();
    if (cars.length === 0) return; // guard

    const firstCar = cars[0];
    const posBefore = cm.getCarPosition(firstCar.id);
    expect(posBefore).not.toBeNull();

    // Large dt to ensure position changes
    cm.update(2.0);

    const posAfter = cm.getCarPosition(firstCar.id);
    // Car may have been removed on arrival, which is valid behavior
    if (posAfter !== null && posBefore !== null) {
      const moved = posAfter.x !== posBefore.x || posAfter.z !== posBefore.z;
      expect(moved).toBe(true);
    }
    cm.dispose();
  });
});

describe('CarManager.selectCar / deselectCar', () => {
  it('selects and tracks a car', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getCarInfo();
    if (cars.length === 0) return;

    cm.selectCar(cars[0].id);
    expect(cm.getSelectedCarIds().has(cars[0].id)).toBe(true);
    cm.dispose();
  });

  it('deselectCar clears selection', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getCarInfo();
    if (cars.length === 0) return;

    cm.selectCar(cars[0].id);
    cm.deselectCar(cars[0].id);
    expect(cm.getSelectedCarIds().size).toBe(0);
    cm.dispose();
  });

  it('deselectAll clears selection', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getCarInfo();
    if (cars.length === 0) return;

    cm.selectCar(cars[0].id);
    cm.deselectAll();
    expect(cm.getSelectedCarIds().size).toBe(0);
    cm.dispose();
  });
});

describe('CarManager.getCarPosition', () => {
  it('returns position for valid car id', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    const cars = cm.getCarInfo();
    if (cars.length === 0) return;

    const pos = cm.getCarPosition(cars[0].id);
    expect(pos).not.toBeNull();
    expect(typeof pos!.x).toBe('number');
    expect(typeof pos!.z).toBe('number');
    cm.dispose();
  });

  it('returns null for invalid car id', () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    expect(cm.getCarPosition(999999)).toBeNull();
    cm.dispose();
  });
});

describe('CarManager.dispose', () => {
  it('removes all cars from scene and clears list', async () => {
    const scene = new THREE.Scene();
    const cm = new CarManager(scene);
    await cm.rebuildGraph(makeTestRoads(), 1);

    expect(cm.getCarInfo().length).toBeGreaterThan(0);

    cm.dispose();
    expect(cm.getCarInfo()).toEqual([]);
  });
});

