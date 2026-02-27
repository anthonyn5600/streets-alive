import * as THREE from 'three';
import { RoadGraph, SPEED_WEIGHTS } from './roads/graph';
import { computeMiterNormals } from './roads/renderer';
import type { BuildingData, CarInfo, RoadData } from './types';

const CAR_Y = 0.8;
const ROUTE_Y = 0.08;
const MAX_CARS = 30;
const BASE_SPEED = 40;
const CAR_COLORS = [0xcc3333, 0x3333cc, 0x33aa33, 0xdd8800, 0x8833aa, 0x338888];
const ROAD_TOLERANCE = 15; // meters -- max allowed distance from waypoint segment

interface Car {
  id: number;
  mesh: THREE.Mesh;
  routeMesh: THREE.Mesh | null;
  waypoints: Array<{ x: number; y: number; z: number }>;
  waypointIndex: number;
  speed: number;
  progress: number;
  color: number;
  selected: boolean;
  roadType: string;
}

let nextCarId = 1;

function createCarGeometry() {
  return new THREE.BoxGeometry(2, 1.5, 4);
}

function createRouteMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  if (ab2 < 0.0001) return Math.sqrt(apx * apx + apz * apz);
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  const cx = ax + t * abx;
  const cz = az + t * abz;
  const dx = px - cx;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dz * dz);
}

export class CarManager {
  private cars: Car[] = [];
  private scene: THREE.Scene;
  private graph = new RoadGraph();
  private lastRoadVersion = -1;
  private selectedCarId: number | null = null;
  private stateThrottleTimer = 0;
  private carGeometry: THREE.BoxGeometry;
  private routeMaterial: THREE.MeshBasicMaterial;
  private carMaterials: Map<number, THREE.MeshLambertMaterial>;
  private toRemove = new Set<number>();
  onCarStateChange: ((cars: CarInfo[]) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.carGeometry = createCarGeometry();
    this.routeMaterial = createRouteMaterial();
    this.carMaterials = new Map();
    for (const color of CAR_COLORS) {
      this.carMaterials.set(color, new THREE.MeshLambertMaterial({ color }));
    }
  }

  rebuildGraph(roads: RoadData[], version: number, buildings?: BuildingData[]) {
    if (version === this.lastRoadVersion) return;
    this.lastRoadVersion = version;
    this.graph.build(roads);
    if (buildings && buildings.length > 0) {
      this.graph.buildBuildingIndex(buildings);
    }

    // Re-validate existing cars against new graph
    for (const car of this.cars) {
      const nearest = this.findNearestNode(car.mesh.position.x, car.mesh.position.z);
      if (nearest === null) continue;
      const node = this.graph.nodes[nearest];
      const dx = car.mesh.position.x - node.x;
      const dz = car.mesh.position.z - node.z;
      if (Math.sqrt(dx * dx + dz * dz) > ROAD_TOLERANCE * 2) {
        this.assignRoute(car, nearest);
      }
    }

    this.spawnCars();
  }

  private spawnCars() {
    if (this.graph.nodes.length < 10) return;
    let attempts = 0;
    while (this.cars.length < MAX_CARS && attempts < 50) {
      attempts++;
      const car = this.createCar();
      if (car) this.cars.push(car);
    }
  }

  private createCar(): Car | null {
    const startNode = this.graph.getRandomCarNode();
    if (startNode === null) return null;

    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const mesh = new THREE.Mesh(this.carGeometry, this.carMaterials.get(color)!);

    const node = this.graph.nodes[startNode];
    mesh.position.x = node.x;
    mesh.position.z = node.z;
    mesh.position.y = CAR_Y;
    this.scene.add(mesh);

    const car: Car = {
      id: nextCarId++,
      mesh,
      routeMesh: null,
      waypoints: [],
      waypointIndex: 0,
      speed: BASE_SPEED,
      progress: 0,
      color,
      selected: false,
      roadType: 'residential',
    };

    this.assignRoute(car, startNode);
    if (car.waypoints.length < 2) {
      this.scene.remove(mesh);
      return null;
    }
    return car;
  }

  private removeCar(car: Car) {
    this.scene.remove(car.mesh);
    if (car.routeMesh) {
      this.scene.remove(car.routeMesh);
      car.routeMesh.geometry.dispose();
      car.routeMesh = null;
    }
    if (this.selectedCarId === car.id) {
      this.selectedCarId = null;
    }
  }

  private assignRoute(car: Car, fromNode?: number) {
    // Remove old route mesh
    if (car.routeMesh) {
      this.scene.remove(car.routeMesh);
      car.routeMesh.geometry.dispose();
      car.routeMesh = null;
    }

    const start = fromNode ?? this.findNearestNode(car.mesh.position.x, car.mesh.position.z);
    if (start === null) return;

    for (let attempt = 0; attempt < 10; attempt++) {
      const dest = this.graph.getRandomBuildingDestination();
      const end = dest ? dest.nodeId : this.graph.getRandomCarNode();
      if (end === null || end === start) continue;

      const nodePath = this.graph.dijkstra(start, end);
      if (!nodePath || nodePath.length < 2) continue;

      const waypoints = this.graph.getRouteWaypointsWithOffset(nodePath);
      if (waypoints.length < 2) continue;

      // Append final off-road segment to building centroid
      if (dest) {
        waypoints.push({ x: dest.buildingX, y: 0, z: dest.buildingZ });
      }

      car.waypoints = waypoints;
      car.waypointIndex = 0;
      car.progress = 0;

      const types = this.graph.getRouteRoadTypes(nodePath);
      car.roadType = types[0] ?? 'residential';
      const weight = SPEED_WEIGHTS[car.roadType] ?? 0.5;
      car.speed = BASE_SPEED * weight;

      // Only create route mesh if this car is selected
      if (car.selected) {
        car.routeMesh = this.createRouteMesh(waypoints);
        if (car.routeMesh) this.scene.add(car.routeMesh);
      }

      return;
    }
  }

  private findNearestNode(x: number, z: number): number | null {
    let best = -1;
    let bestDist = Infinity;
    for (const node of this.graph.nodes) {
      const dx = node.x - x;
      const dz = node.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = node.id;
      }
    }
    return best === -1 ? null : best;
  }

  private createRouteMesh(waypoints: Array<{ x: number; y: number; z: number }>): THREE.Mesh | null {
    if (waypoints.length < 2) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const halfWidth = 1;

    // Compute 2D normals for ribbon width
    const pts2d = waypoints.map(p => ({ x: p.x, z: p.z }));
    const normals = computeMiterNormals(pts2d);

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const n = normals[i];
      const y = wp.y + ROUTE_Y;
      positions.push(wp.x + n.x * halfWidth, y, wp.z + n.z * halfWidth);
      positions.push(wp.x - n.x * halfWidth, y, wp.z - n.z * halfWidth);
    }

    for (let i = 0; i < waypoints.length - 1; i++) {
      const vi = i * 2;
      indices.push(vi, vi + 2, vi + 1);
      indices.push(vi + 1, vi + 2, vi + 3);
    }

    if (positions.length < 6) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    return new THREE.Mesh(geom, this.routeMaterial);
  }

  selectCar(carId: number) {
    // Deselect previous
    if (this.selectedCarId !== null) {
      this.deselectCar(this.selectedCarId);
    }

    const car = this.cars.find(c => c.id === carId);
    if (!car) return;

    car.selected = true;
    this.selectedCarId = carId;

    // Create route mesh if car has waypoints
    if (!car.routeMesh && car.waypoints.length >= 2) {
      car.routeMesh = this.createRouteMesh(car.waypoints);
      if (car.routeMesh) this.scene.add(car.routeMesh);
    }
  }

  deselectCar(carId: number) {
    const car = this.cars.find(c => c.id === carId);
    if (!car) return;

    car.selected = false;
    if (car.routeMesh) {
      this.scene.remove(car.routeMesh);
      car.routeMesh.geometry.dispose();
      car.routeMesh = null;
    }

    if (this.selectedCarId === carId) {
      this.selectedCarId = null;
    }
  }

  deselectAll() {
    if (this.selectedCarId !== null) {
      this.deselectCar(this.selectedCarId);
    }
  }

  getSelectedCarId(): number | null {
    return this.selectedCarId;
  }

  getCarAtPosition(raycaster: THREE.Raycaster): number | null {
    let closest: Car | null = null;
    let closestDist = Infinity;

    for (const car of this.cars) {
      const intersects = raycaster.intersectObject(car.mesh);
      if (intersects.length > 0 && intersects[0].distance < closestDist) {
        closestDist = intersects[0].distance;
        closest = car;
      }
    }

    return closest ? closest.id : null;
  }

  getCarPosition(carId: number): { x: number; z: number } | null {
    const car = this.cars.find(c => c.id === carId);
    if (!car) return null;
    return { x: car.mesh.position.x, z: car.mesh.position.z };
  }

  getCarInfo(): CarInfo[] {
    return this.cars.map(c => ({
      id: c.id,
      color: c.color,
      roadType: c.roadType,
      speed: c.speed,
      selected: c.selected,
    }));
  }

  update(deltaTime: number) {
    const toRemove = this.toRemove;
    toRemove.clear();

    for (const car of this.cars) {
      if (car.waypoints.length < 2) {
        this.removeCar(car);
        toRemove.add(car.id);
        continue;
      }

      const wp0 = car.waypoints[car.waypointIndex];
      const wp1 = car.waypoints[car.waypointIndex + 1];
      if (!wp0 || !wp1) {
        this.removeCar(car);
        toRemove.add(car.id);
        continue;
      }

      const dx = wp1.x - wp0.x;
      const dz = wp1.z - wp0.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);

      if (segLen < 0.001) {
        car.waypointIndex++;
        continue;
      }

      const isFinalSegment = car.waypointIndex === car.waypoints.length - 2;
      const effectiveSpeed = isFinalSegment ? car.speed * 0.3 : car.speed;
      car.progress += (effectiveSpeed * deltaTime) / segLen;

      if (car.progress >= 1) {
        car.waypointIndex++;
        car.progress = 0;

        if (car.waypointIndex >= car.waypoints.length - 1) {
          this.removeCar(car);
          toRemove.add(car.id);
          continue;
        }
      }

      // Interpolate position
      const t = car.progress;
      const newX = wp0.x + dx * t;
      const newZ = wp0.z + dz * t;
      const newY = wp0.y + (wp1.y - wp0.y) * t + CAR_Y;

      // Validate car stays on road segment
      const d = distToSegment(newX, newZ, wp0.x, wp0.z, wp1.x, wp1.z);
      if (d > ROAD_TOLERANCE) {
        // Snap to nearest point on segment
        const abx = wp1.x - wp0.x;
        const abz = wp1.z - wp0.z;
        const ab2 = abx * abx + abz * abz;
        const clampedT = ab2 > 0 ? Math.max(0, Math.min(1, ((newX - wp0.x) * abx + (newZ - wp0.z) * abz) / ab2)) : 0;
        car.mesh.position.x = wp0.x + clampedT * abx;
        car.mesh.position.z = wp0.z + clampedT * abz;
        car.mesh.position.y = wp0.y + (wp1.y - wp0.y) * clampedT + CAR_Y;
      } else {
        car.mesh.position.x = newX;
        car.mesh.position.z = newZ;
        car.mesh.position.y = newY;
      }

      // Orient car to heading
      const angle = Math.atan2(-dx, -dz);
      car.mesh.rotation.y = angle;
    }

    if (toRemove.size > 0) {
      this.cars = this.cars.filter(c => !toRemove.has(c.id));
      this.spawnCars();
    }

    // Throttled state emission (~4 times/sec)
    this.stateThrottleTimer += deltaTime;
    if (this.stateThrottleTimer >= 0.25) {
      this.stateThrottleTimer = 0;
      this.onCarStateChange?.(this.getCarInfo());
    }
  }

  dispose() {
    for (const car of this.cars) {
      this.scene.remove(car.mesh);
      if (car.routeMesh) {
        this.scene.remove(car.routeMesh);
        car.routeMesh.geometry.dispose();
      }
    }
    this.cars = [];
    this.carGeometry.dispose();
    this.routeMaterial.dispose();
    for (const mat of this.carMaterials.values()) mat.dispose();
  }
}
