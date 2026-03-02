import * as THREE from 'three';
import { RoadGraph, SPEED_WEIGHTS } from './roads/graph';
import { computeMiterNormals } from './roads/miter';
import { getLaneOffset, getParkingOffset } from './roads/style';
import type { PopulationManager } from './simulation/population';
import type { TripPlanner } from './simulation/trip-planner';
import type { ProgressBarManager } from './simulation/progress-bar';
import type { ActivityType, BuildingData, CarInfo, CarTestData, PersonInfo, RoadData, SimCarInfo } from './types';

const CAR_Y = 0.8;
const ROUTE_Y = 0.45;
const MAX_CARS = 50;
const HIDDEN_TIMEOUT = 30;
const HIDE_GRACE = 2;
const BASE_SPEED = 40;
const CAR_COLORS = [0xcc3333, 0x3333cc, 0x33aa33, 0xdd8800, 0x8833aa, 0x338888];
export const ROAD_TOLERANCE = 15;
export const NEED_THRESHOLD = 40;
export const DROPOFF_DWELL = 5;

const MARKER_Y = 35;
const MARKER_SCALE = 20;
const MARKER_BOB_AMPLITUDE = 3;
const MARKER_BOB_SPEED = 2;

interface DropoffStop {
  buildingId: number;
  personIds: number[];
}

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
  state: 'driving' | 'parked';
  occupantIds: number[];
  guestOccupantIds: number[];
  pendingDropoffs: DropoffStop[];
  isDropoffTrip: boolean;
  householdId: number;
  activity: ActivityType | null;
  dwellRemaining: number;
  dwellTotal: number;
  originBuildingId: number | null;
  destinationBuildingId: number | null;
  originMarker: THREE.Sprite | null;
  destinationMarker: THREE.Sprite | null;
  roadDirX: number;
  roadDirZ: number;
  hidden: boolean;
  hiddenTimer: number;
  hideGraceTimer: number;
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

let originPinTexture: THREE.CanvasTexture | null = null;
let destPinTexture: THREE.CanvasTexture | null = null;

function createPinTexture(color: string, label: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(128, 84, 64, Math.PI, 0);
    ctx.lineTo(128, 220);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(128, 84, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 88);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function getOriginPinTexture(): THREE.CanvasTexture {
  if (!originPinTexture) originPinTexture = createPinTexture('#22a855', 'A');
  return originPinTexture;
}

function getDestPinTexture(): THREE.CanvasTexture {
  if (!destPinTexture) destPinTexture = createPinTexture('#dd3333', 'B');
  return destPinTexture;
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

function offsetLastWaypointToCurb(
  waypoints: Array<{ x: number; y: number; z: number }>,
  roadType: string
): void {
  if (waypoints.length < 2) return;
  const totalOffset = getParkingOffset(roadType);
  const laneOffset = getLaneOffset(roadType);
  const additionalOffset = totalOffset - laneOffset;
  if (additionalOffset <= 0) return;

  const last = waypoints.length - 1;
  const ref = Math.max(0, last - Math.min(3, last));
  const dx = waypoints[last].x - waypoints[ref].x;
  const dz = waypoints[last].z - waypoints[ref].z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return;
  const nx = -dz / len;
  const nz = dx / len;
  waypoints[last] = {
    x: waypoints[last].x + nx * additionalOffset,
    y: waypoints[last].y,
    z: waypoints[last].z + nz * additionalOffset,
  };
}

export class CarManager {
  private cars: Car[] = [];
  private scene: THREE.Scene;
  private graph = new RoadGraph();
  private lastRoadVersion = -1;
  private selectedCarIds = new Set<number>();
  private stateThrottleTimer = 0;
  private carGeometry: THREE.BoxGeometry;
  private routeMaterial: THREE.MeshBasicMaterial;
  private carMaterials: Map<number, THREE.MeshLambertMaterial>;
  private toRemove = new Set<number>();
  private parkingDebugGroup: THREE.Group | null = null;
  private parkingDebugEnabled = false;
  private spawnTimer = 0;
  private spawnFailedHouseholds = new Set<number>();
  private spawnFailedClearTimer = 0;
  private buildAbort: AbortController | null = null;
  private graphBusy = false;
  private savedRoleParkings = new Map<number, {
    centroidX: number; centroidZ: number;
    parkX: number; parkZ: number;
    dirX: number; dirZ: number;
    roadType: string; roadName: string;
  }>();
  private elapsedTime = 0;

  population: PopulationManager | null = null;
  tripPlanner: TripPlanner | null = null;
  progressBars: ProgressBarManager | null = null;

  onCarStateChange: ((cars: SimCarInfo[]) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.carGeometry = createCarGeometry();
    this.routeMaterial = createRouteMaterial();
    this.carMaterials = new Map();
    for (const color of CAR_COLORS) {
      this.carMaterials.set(color, new THREE.MeshLambertMaterial({ color }));
    }
  }

  async rebuildGraph(roads: RoadData[], version: number, buildings?: BuildingData[]) {
    if (version === this.lastRoadVersion) return;
    this.lastRoadVersion = version;

    if (this.buildAbort) this.buildAbort.abort();
    const abort = new AbortController();
    this.buildAbort = abort;

    this.graphBusy = true;

    this.graph.build(roads);
    if (!buildings || buildings.length === 0) {
      this.graph.clearBuildingIndex();
    } else {
      await this.graph.buildBuildingIndex(buildings, abort.signal);
      if (abort.signal.aborted) {
        this.graphBusy = false;
        return;
      }
    }

    // Initialize population once we have enough buildings
    if (this.population && !this.population.isInitialized()) {
      const indexed = this.graph.getIndexedBuildings();
      if (indexed.length >= 30) {
        this.population.init(indexed);
        const roles = this.population.getBuildingRoles();
        const roleIds = new Set(roles.keys());
        this.restoreMissingRoleBuildings(roleIds);
        this.graph.filterIndexedBuildings(roleIds);
        this.saveRoleParkings();
        // Remove legacy cars so population-driven cars replace them immediately
        for (const car of this.cars) {
          if (car.householdId === -1) {
            this.removeCar(car);
            this.toRemove.add(car.id);
          }
        }
        this.cars = this.cars.filter(c => !this.toRemove.has(c.id));
        this.toRemove.clear();
      }
    } else if (this.population?.isInitialized() && buildings && buildings.length > 0) {
      const roles = this.population.getBuildingRoles();
      const roleIds = new Set(roles.keys());
      this.restoreMissingRoleBuildings(roleIds);
      this.graph.filterIndexedBuildings(roleIds);
      this.saveRoleParkings();
    }

    this.graphBusy = false;

    // Fix driving cars with stale destinations (building lost from index)
    for (const car of this.cars) {
      if (car.householdId !== -1 && car.destinationBuildingId !== null && car.state === 'driving') {
        if (!this.graph.getBuildingDestination(car.destinationBuildingId)) {
          this.continueNormalTrip(car);
        }
      }
    }

    if (this.parkingDebugEnabled) {
      this.setParkingDebug(false);
      this.setParkingDebug(true);
    }

    // Re-validate existing cars against new graph (cap re-routes per rebuild to limit Dijkstra cost)
    let rerouted = 0;
    for (const car of this.cars) {
      // Check if car is near any graph node (tile loaded)
      const nearest = this.findNearestNode(car.mesh.position.x, car.mesh.position.z);
      if (nearest === null) {
        if (!car.hidden && car.hideGraceTimer <= 0) {
          car.hideGraceTimer = HIDE_GRACE;
        }
        continue;
      }

      const node = this.graph.nodes[nearest];
      const dx = car.mesh.position.x - node.x;
      const dz = car.mesh.position.z - node.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > ROAD_TOLERANCE * 4) {
        if (!car.hidden && car.hideGraceTimer <= 0) {
          car.hideGraceTimer = HIDE_GRACE;
        }
        continue;
      }

      car.hideGraceTimer = 0;

      // Car is in a loaded area -- show if hidden
      if (car.hidden) {
        car.hidden = false;
        car.hiddenTimer = 0;
        car.mesh.visible = true;
        this.setOccupantsInCar(car);
        if (car.state === 'parked' && car.activity) {
          this.progressBars?.create(
            car.id,
            car.mesh.position.x,
            car.mesh.position.y,
            car.mesh.position.z,
            car.activity
          );
        }
      }

      if (car.state === 'driving' && dist > ROAD_TOLERANCE * 2 && rerouted < 5) {
        rerouted++;
        if (car.destinationBuildingId !== null) {
          this.assignRouteToBuilding(car, car.destinationBuildingId, nearest);
          if (car.waypoints.length < 2) {
            this.removeCar(car);
            this.toRemove.add(car.id);
          }
        } else if (car.householdId !== -1) {
          this.continueNormalTrip(car);
        } else {
          this.assignRoute(car, nearest);
        }
      }
    }

    if (this.toRemove.size > 0) {
      this.cars = this.cars.filter(c => !this.toRemove.has(c.id));
      this.toRemove.clear();
    }

    this.spawnFailedHouseholds.clear();
    this.spawnCars();
  }

  private spawnCars() {
    if (this.graph.nodes.length < 10) return;

    // If no population system, use legacy spawn
    if (!this.population) {
      let attempts = 0;
      while (this.cars.length < MAX_CARS && attempts < 3) {
        attempts++;
        const car = this.createLegacyCar();
        if (car) this.cars.push(car);
      }
      return;
    }

    // Needs-driven spawning: check households without active cars
    let attempts = 0;
    for (const household of this.population.households.values()) {
      if (this.cars.length >= MAX_CARS) break;
      if (attempts >= 2) break;
      if (household.carActive) continue;
      if (this.spawnFailedHouseholds.has(household.id)) continue;

      const lowestNeed = this.population.getHouseholdLowestNeed(household.id);
      if (lowestNeed >= NEED_THRESHOLD) continue;

      attempts++;
      const car = this.createHouseholdCar(household.id);
      if (car) {
        this.cars.push(car);
      } else {
        this.spawnFailedHouseholds.add(household.id);
      }
    }
  }

  private createLegacyCar(): Car | null {
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
      state: 'driving',
      occupantIds: [],
      guestOccupantIds: [],
      pendingDropoffs: [],
      isDropoffTrip: false,
      householdId: -1,
      activity: null,
      dwellRemaining: 0,
      dwellTotal: 0,
      originBuildingId: null,
      destinationBuildingId: null,
      originMarker: null,
      destinationMarker: null,
      roadDirX: 0,
      roadDirZ: 0,
      hidden: false,
      hiddenTimer: 0,
      hideGraceTimer: 0,
    };

    this.assignRoute(car, startNode);
    if (car.waypoints.length < 2) {
      this.scene.remove(mesh);
      return null;
    }
    return car;
  }

  private createHouseholdCar(householdId: number): Car | null {
    if (!this.population || !this.tripPlanner) return null;

    const household = this.population.households.get(householdId);
    if (!household || household.memberIds.length === 0) return null;

    const driverId = household.memberIds[0];
    const driver = this.population.people.get(driverId);
    if (!driver) return null;

    // Route from home building
    const homeDest = this.graph.getBuildingDestination(driver.homeBuildingId);
    if (!homeDest) return null;

    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const mesh = new THREE.Mesh(this.carGeometry, this.carMaterials.get(color)!);

    const homeNode = this.graph.nodes[homeDest.nodeId];
    if (!homeNode) {
      return null;
    }
    mesh.position.x = homeNode.x;
    mesh.position.z = homeNode.z;
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
      state: 'driving',
      occupantIds: this.selectTravelers(household.memberIds),
      guestOccupantIds: [],
      pendingDropoffs: [],
      isDropoffTrip: false,
      householdId,
      activity: null,
      dwellRemaining: 0,
      dwellTotal: 0,
      originBuildingId: household.buildingId,
      destinationBuildingId: null,
      originMarker: null,
      destinationMarker: null,
      roadDirX: 0,
      roadDirZ: 0,
      hidden: false,
      hiddenTimer: 0,
      hideGraceTimer: 0,
    };

    // Use trip planner for first destination (no lastActivity on first trip)
    const trip = this.tripPlanner.pickNextTrip(car.occupantIds, this.population, driverId, null);
    car.activity = trip.activity;
    car.dwellTotal = trip.dwellTime;

    this.assignRouteToBuilding(car, trip.buildingId, homeDest.nodeId);
    if (car.waypoints.length < 2) {
      this.scene.remove(mesh);
      return null;
    }

    this.population.markHouseholdCarActive(householdId, true);
    // Set all occupants to in-car location
    for (const pid of car.occupantIds) {
      this.population.setPersonLocation(pid, { type: 'car', carId: car.id });
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
    this.removeRouteMarkers(car);
    this.progressBars?.remove(car.id);
    this.selectedCarIds.delete(car.id);
    car.selected = false;
    if (car.householdId !== -1 && this.population) {
      this.population.markHouseholdCarActive(car.householdId, false);
      // Return all occupants home
      const household = this.population.households.get(car.householdId);
      if (household) {
        for (const pid of car.occupantIds) {
          this.population.setPersonLocation(pid, { type: 'home', buildingId: household.buildingId });
        }
      }
      // Drop all guests home
      this.forceDropAllGuests(car);
    }
  }

  private assignRoute(car: Car, fromNode?: number) {
    if (car.routeMesh) {
      this.scene.remove(car.routeMesh);
      car.routeMesh.geometry.dispose();
      car.routeMesh = null;
    }

    const start = fromNode ?? this.findNearestNode(car.mesh.position.x, car.mesh.position.z);
    if (start === null) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const dest = this.graph.getRandomBuildingDestination();
      const end = dest ? dest.nodeId : this.graph.getRandomCarNode();
      if (end === null || end === start) continue;

      const nodePath = this.graph.dijkstra(start, end);
      if (!nodePath || nodePath.length < 2) continue;

      const waypoints = this.graph.getRouteWaypointsWithOffset(nodePath, true);
      if (waypoints.length < 2) continue;

      const types = this.graph.getRouteRoadTypes(nodePath);

      if (dest) {
        car.destinationBuildingId = dest.buildingId;
        car.roadDirX = dest.roadDirX;
        car.roadDirZ = dest.roadDirZ;

        // Offset last waypoint toward building using stored roadDir
        const parkNode = this.graph.nodes[dest.nodeId];
        if (parkNode) {
          const perpX = -dest.roadDirZ;
          const perpZ = dest.roadDirX;
          const offset = getParkingOffset(dest.roadType);
          const lastIdx = waypoints.length - 1;
          waypoints[lastIdx] = {
            x: parkNode.x + perpX * offset,
            y: waypoints[lastIdx].y,
            z: parkNode.z + perpZ * offset,
          };
        }
      } else {
        const destRoadType = types[types.length - 1] ?? 'residential';
        offsetLastWaypointToCurb(waypoints, destRoadType);
      }

      car.waypoints = waypoints;
      car.waypointIndex = 0;
      car.progress = 0;
      car.state = 'driving';

      car.roadType = types[0] ?? 'residential';
      const weight = SPEED_WEIGHTS[car.roadType] ?? 0.5;
      car.speed = BASE_SPEED * weight;

      if (car.selected) {
        car.routeMesh = this.createRouteMesh(waypoints);
        if (car.routeMesh) this.scene.add(car.routeMesh);
        this.removeRouteMarkers(car);
        this.createRouteMarkers(car);
      }

      return;
    }
  }

  private assignRouteToBuilding(car: Car, buildingId: number, fromNode?: number) {
    if (car.routeMesh) {
      this.scene.remove(car.routeMesh);
      car.routeMesh.geometry.dispose();
      car.routeMesh = null;
    }

    const start = fromNode ?? this.findNearestNode(car.mesh.position.x, car.mesh.position.z);
    if (start === null) return;

    const dest = this.graph.getBuildingDestination(buildingId);
    if (!dest) {
      car.destinationBuildingId = null;
      this.assignRoute(car, start);
      return;
    }

    const nodePath = this.graph.dijkstra(start, dest.nodeId);
    if (!nodePath || nodePath.length < 2) {
      car.destinationBuildingId = null;
      this.assignRoute(car, start);
      return;
    }

    const waypoints = this.graph.getRouteWaypointsWithOffset(nodePath, true);
    if (waypoints.length < 2) {
      car.destinationBuildingId = null;
      this.assignRoute(car, start);
      return;
    }

    car.destinationBuildingId = buildingId;
    car.roadDirX = dest.roadDirX;
    car.roadDirZ = dest.roadDirZ;

    // Offset last waypoint toward building using stored roadDir
    const parkNode = this.graph.nodes[dest.nodeId];
    if (parkNode) {
      const perpX = -dest.roadDirZ;
      const perpZ = dest.roadDirX;
      const offset = getParkingOffset(dest.roadType);
      const lastIdx = waypoints.length - 1;
      waypoints[lastIdx] = {
        x: parkNode.x + perpX * offset,
        y: waypoints[lastIdx].y,
        z: parkNode.z + perpZ * offset,
      };
    }

    car.waypoints = waypoints;
    car.waypointIndex = 0;
    car.progress = 0;
    car.state = 'driving';

    const types = this.graph.getRouteRoadTypes(nodePath);
    car.roadType = types[0] ?? 'residential';
    const weight = SPEED_WEIGHTS[car.roadType] ?? 0.5;
    car.speed = BASE_SPEED * weight;

    if (car.selected) {
      car.routeMesh = this.createRouteMesh(waypoints);
      if (car.routeMesh) this.scene.add(car.routeMesh);
      this.removeRouteMarkers(car);
      this.createRouteMarkers(car);
    }
  }

  private parkCar(car: Car) {
    car.state = 'parked';
    car.originBuildingId = car.destinationBuildingId;
    car.dwellRemaining = car.dwellTotal;

    if (import.meta.env.DEV && this.population?.isInitialized() && car.destinationBuildingId !== null) {
      const roles = this.population!.getBuildingRoles();
      if (!roles.has(car.destinationBuildingId)) {
        console.warn('[CarManager] car', car.id, 'parked at building', car.destinationBuildingId, 'with no role');
      }
    }

    // Snap to final position
    const last = car.waypoints[car.waypoints.length - 1];
    if (last) {
      car.mesh.position.x = last.x;
      car.mesh.position.z = last.z;
      car.mesh.position.y = last.y + CAR_Y;
    }

    // Align rotation parallel to road using stored road direction
    if (car.roadDirX !== 0 || car.roadDirZ !== 0) {
      car.mesh.rotation.y = Math.atan2(-car.roadDirX, -car.roadDirZ);
    } else {
      // Fallback for cars without stored direction
      const n = car.waypoints.length;
      const segStart = n >= 3 ? car.waypoints[n - 3] : car.waypoints[n - 2];
      const segEnd = n >= 3 ? car.waypoints[n - 2] : car.waypoints[n - 1];
      if (segStart && segEnd) {
        const rdx = segEnd.x - segStart.x;
        const rdz = segEnd.z - segStart.z;
        if (rdx * rdx + rdz * rdz > 0.001) {
          car.mesh.rotation.y = Math.atan2(-rdx, -rdz);
        }
      }
    }

    // Set occupants to building location
    if (this.population && car.destinationBuildingId !== null) {
      for (const pid of car.occupantIds) {
        this.population.setPersonLocation(pid, {
          type: 'building',
          buildingId: car.destinationBuildingId,
          activity: car.activity ?? undefined,
        });
      }
    } else if (this.population && car.destinationBuildingId === null) {
      // No destination -- return occupants home
      const household = this.population.households.get(car.householdId);
      if (household) {
        for (const pid of car.occupantIds) {
          this.population.setPersonLocation(pid, { type: 'home', buildingId: household.buildingId });
        }
      }
    }

    // Pick up guests at social destinations
    if (car.activity === 'social' && car.guestOccupantIds.length === 0 && this.population && car.destinationBuildingId !== null) {
      this.pickupSocialGuests(car);
    }

    // Create progress bar
    if (this.progressBars && car.activity) {
      this.progressBars.create(
        car.id,
        car.mesh.position.x,
        car.mesh.position.y,
        car.mesh.position.z,
        car.activity
      );
    }
  }

  private unparkCar(car: Car) {
    // Remove progress bar
    this.progressBars?.remove(car.id);

    // Set occupants back to car location
    if (this.population) {
      for (const pid of car.occupantIds) {
        this.population.setPersonLocation(pid, { type: 'car', carId: car.id });
      }
      for (const pid of car.guestOccupantIds) {
        this.population.setPersonLocation(pid, { type: 'car', carId: car.id });
      }
    }

    if (!this.population || !this.tripPlanner) {
      this.forceDropAllGuests(car);
      this.removeCar(car);
      this.toRemove.add(car.id);
      return;
    }

    const driverId = car.occupantIds[0];
    if (!driverId) {
      this.forceDropAllGuests(car);
      this.removeCar(car);
      this.toRemove.add(car.id);
      return;
    }

    // If currently on a dropoff trip, discharge guests at this stop first
    if (car.isDropoffTrip) {
      this.dischargeGuestsAtStop(car);
      if (car.pendingDropoffs.length > 0) {
        this.routeToNextDropoff(car);
        return;
      }
      // All guests dropped off
      car.isDropoffTrip = false;
      this.continueNormalTrip(car);
      return;
    }

    // If we have guests and no pending dropoffs yet, build the dropoff queue
    if (car.guestOccupantIds.length > 0 && car.pendingDropoffs.length === 0) {
      this.buildDropoffQueue(car);
      if (car.pendingDropoffs.length > 0) {
        this.routeToNextDropoff(car);
        return;
      }
    }

    this.continueNormalTrip(car);
  }

  private selectTravelers(memberIds: number[]): number[] {
    if (memberIds.length <= 1) return [...memberIds];
    // Driver always goes. 0-1 additional members join.
    const travelers = [memberIds[0]];
    if (memberIds.length > 1 && Math.random() < 0.5) {
      const idx = 1 + Math.floor(Math.random() * (memberIds.length - 1));
      travelers.push(memberIds[idx]);
    }
    return travelers;
  }

  private routeToNextDropoff(car: Car) {
    const nextStop = car.pendingDropoffs[0];
    car.isDropoffTrip = true;
    car.activity = 'social';
    car.originBuildingId = car.destinationBuildingId;
    car.destinationBuildingId = nextStop.buildingId;
    car.dwellTotal = DROPOFF_DWELL;
    car.dwellRemaining = 0;

    this.assignRouteToBuilding(car, nextStop.buildingId);
    if (car.waypoints.length < 2) {
      this.forceDropAllGuests(car);
      this.continueNormalTrip(car);
    }
  }

  private pickupSocialGuests(car: Car) {
    if (!this.population || car.destinationBuildingId === null) return;

    const peopleAtBuilding = this.population.getPeopleAtBuilding(car.destinationBuildingId);
    // Filter to people who are at home at this building (not just visiting)
    const candidates = peopleAtBuilding.filter(p =>
      p.location.type === 'home' &&
      p.homeBuildingId === car.destinationBuildingId &&
      !car.occupantIds.includes(p.id)
    );
    if (candidates.length === 0) return;

    const pickupCount = Math.min(candidates.length, 1 + Math.floor(Math.random() * 2)); // 1-2
    for (let i = 0; i < pickupCount; i++) {
      const guest = candidates[i];
      car.guestOccupantIds.push(guest.id);
      this.population.setPersonLocation(guest.id, { type: 'building', buildingId: car.destinationBuildingId! });
    }
  }

  private buildDropoffQueue(car: Car) {
    if (!this.population) return;
    // Group guests by their home building
    const byBuilding = new Map<number, number[]>();
    for (const guestId of car.guestOccupantIds) {
      const person = this.population.people.get(guestId);
      if (!person) continue;
      let arr = byBuilding.get(person.homeBuildingId);
      if (!arr) { arr = []; byBuilding.set(person.homeBuildingId, arr); }
      arr.push(guestId);
    }
    car.pendingDropoffs = [];
    for (const [buildingId, personIds] of byBuilding) {
      car.pendingDropoffs.push({ buildingId, personIds });
    }
  }

  private dischargeGuestsAtStop(car: Car) {
    if (!this.population || car.pendingDropoffs.length === 0) return;
    const stop = car.pendingDropoffs.shift()!;
    for (const personId of stop.personIds) {
      car.guestOccupantIds = car.guestOccupantIds.filter(id => id !== personId);
      this.population.setPersonLocation(personId, { type: 'home', buildingId: stop.buildingId });
    }
  }

  private setOccupantsTraveling(car: Car) {
    if (!this.population) return;
    for (const pid of car.occupantIds) {
      this.population.setPersonLocation(pid, { type: 'traveling', carId: car.id });
    }
    for (const pid of car.guestOccupantIds) {
      this.population.setPersonLocation(pid, { type: 'traveling', carId: car.id });
    }
  }

  private setOccupantsInCar(car: Car) {
    if (!this.population) return;
    for (const pid of car.occupantIds) {
      this.population.setPersonLocation(pid, { type: 'car', carId: car.id });
    }
    for (const pid of car.guestOccupantIds) {
      this.population.setPersonLocation(pid, { type: 'car', carId: car.id });
    }
  }

  private forceDropAllGuests(car: Car) {
    if (!this.population) return;
    for (const guestId of car.guestOccupantIds) {
      const person = this.population.people.get(guestId);
      if (person) {
        this.population.setPersonLocation(guestId, { type: 'home', buildingId: person.homeBuildingId });
      }
    }
    car.guestOccupantIds = [];
    car.pendingDropoffs = [];
    car.isDropoffTrip = false;
  }

  private continueNormalTrip(car: Car) {
    if (!this.population || !this.tripPlanner) {
      this.removeCar(car);
      this.toRemove.add(car.id);
      return;
    }

    const driverId = car.occupantIds[0];
    if (!driverId) {
      this.removeCar(car);
      this.toRemove.add(car.id);
      return;
    }

    const allOccupants = [...car.occupantIds, ...car.guestOccupantIds];
    const trip = this.tripPlanner.pickNextTrip(allOccupants, this.population, driverId, car.activity);
    car.activity = trip.activity;
    car.originBuildingId = car.destinationBuildingId;
    car.destinationBuildingId = null;
    car.dwellTotal = trip.dwellTime;
    car.dwellRemaining = 0;

    this.assignRouteToBuilding(car, trip.buildingId);
    if (car.waypoints.length < 2) {
      this.forceDropAllGuests(car);
      this.removeCar(car);
      this.toRemove.add(car.id);
    }
  }

  private findNearestNode(x: number, z: number): number | null {
    return this.graph.findNearestNode(x, z);
  }

  private saveRoleParkings(): void {
    for (const ib of this.graph.getIndexedBuildings()) {
      const node = this.graph.nodes[ib.nearestNodeId];
      if (!node) continue;
      this.savedRoleParkings.set(ib.buildingId, {
        centroidX: ib.centroidX, centroidZ: ib.centroidZ,
        parkX: node.x, parkZ: node.z,
        dirX: ib.roadDirX, dirZ: ib.roadDirZ,
        roadType: ib.roadType, roadName: ib.roadName,
      });
    }
  }

  private restoreMissingRoleBuildings(roleIds: Set<number>): void {
    for (const [buildingId, saved] of this.savedRoleParkings) {
      if (!roleIds.has(buildingId)) continue;
      if (this.graph.getBuildingDestination(buildingId)) continue;
      this.graph.restoreBuilding(buildingId, saved);
    }
  }

  private createRouteMesh(waypoints: Array<{ x: number; y: number; z: number }>): THREE.Mesh | null {
    if (waypoints.length < 2) return null;

    const positions: number[] = [];
    const indices: number[] = [];
    const halfWidth = 1;

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

  private createRouteMarkers(car: Car) {
    this.removeRouteMarkers(car);

    let originPos: { x: number; z: number } | null = null;
    let destPos: { x: number; z: number } | null = null;

    if (car.waypoints.length > 0) {
      originPos = { x: car.waypoints[0].x, z: car.waypoints[0].z };
      const last = car.waypoints[car.waypoints.length - 1];
      destPos = { x: last.x, z: last.z };
    }

    if (originPos) {
      const mat = new THREE.SpriteMaterial({
        map: getOriginPinTexture(),
        depthTest: false,
        sizeAttenuation: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(originPos.x, MARKER_Y, originPos.z);
      sprite.scale.set(MARKER_SCALE, MARKER_SCALE, 1);
      sprite.renderOrder = 15;
      this.scene.add(sprite);
      car.originMarker = sprite;
    }

    if (destPos) {
      const mat = new THREE.SpriteMaterial({
        map: getDestPinTexture(),
        depthTest: false,
        sizeAttenuation: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(destPos.x, MARKER_Y, destPos.z);
      sprite.scale.set(MARKER_SCALE, MARKER_SCALE, 1);
      sprite.renderOrder = 15;
      this.scene.add(sprite);
      car.destinationMarker = sprite;
    }
  }

  private removeRouteMarkers(car: Car) {
    if (car.originMarker) {
      this.scene.remove(car.originMarker);
      car.originMarker.material.dispose();
      car.originMarker = null;
    }
    if (car.destinationMarker) {
      this.scene.remove(car.destinationMarker);
      car.destinationMarker.material.dispose();
      car.destinationMarker = null;
    }
  }

  selectCar(carId: number) {
    const car = this.cars.find(c => c.id === carId);
    if (!car) return;

    car.selected = true;
    this.selectedCarIds.add(carId);

    if (!car.routeMesh && car.waypoints.length >= 2) {
      car.routeMesh = this.createRouteMesh(car.waypoints);
      if (car.routeMesh) this.scene.add(car.routeMesh);
    }
    this.createRouteMarkers(car);
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
    this.removeRouteMarkers(car);
    this.selectedCarIds.delete(carId);
  }

  deselectAll() {
    for (const carId of [...this.selectedCarIds]) {
      this.deselectCar(carId);
    }
  }

  getSelectedCarIds(): Set<number> {
    return this.selectedCarIds;
  }

  getCarAtPosition(raycaster: THREE.Raycaster): number | null {
    let closest: Car | null = null;
    let closestDist = Infinity;

    for (const car of this.cars) {
      if (car.hidden) continue;
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

  getCarByPersonId(personId: number): { id: number; x: number; z: number } | null {
    for (const car of this.cars) {
      if (car.occupantIds.includes(personId) || car.guestOccupantIds.includes(personId)) {
        return { id: car.id, x: car.mesh.position.x, z: car.mesh.position.z };
      }
    }
    return null;
  }

  getPersonWorldPosition(personId: number): { x: number; z: number } | null {
    if (!this.population) return null;
    const person = this.population.people.get(personId);
    if (!person) return null;

    if (person.location.type === 'car' || person.location.type === 'traveling') {
      const car = this.getCarByPersonId(personId);
      if (car) return { x: car.x, z: car.z };
    }

    const buildingId = person.location.buildingId ?? person.homeBuildingId;
    const dest = this.graph.getBuildingDestination(buildingId);
    if (dest) return { x: dest.buildingX, z: dest.buildingZ };
    return null;
  }

  getBuildingPosition(buildingId: number): { x: number; z: number } | null {
    const dest = this.graph.getBuildingDestination(buildingId);
    if (!dest) return null;
    return { x: dest.buildingX, z: dest.buildingZ };
  }

  getCarTestData(): CarTestData[] {
    return this.cars.map(c => ({
      id: c.id,
      state: c.state,
      waypointCount: c.waypoints.length,
      waypointIndex: c.waypointIndex,
      originBuildingId: c.originBuildingId,
      destinationBuildingId: c.destinationBuildingId,
      householdId: c.householdId,
      activity: c.activity,
      dwellTotal: c.dwellTotal,
      dwellRemaining: c.dwellRemaining,
      speed: c.speed,
      occupantIds: [...c.occupantIds],
      guestOccupantIds: [...c.guestOccupantIds],
      pendingDropoffs: c.pendingDropoffs.length,
      isDropoffTrip: c.isDropoffTrip,
      hidden: c.hidden,
    }));
  }

  getIndexedBuildingIds(): Set<number> {
    return new Set(this.graph.getIndexedBuildings().map(b => b.buildingId));
  }

  setParkingDebug(show: boolean) {
    this.parkingDebugEnabled = show;
    if (!show) {
      if (this.parkingDebugGroup) {
        this.scene.remove(this.parkingDebugGroup);
        this.parkingDebugGroup.traverse(obj => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
            obj.geometry.dispose();
            if (obj.material instanceof THREE.Material) obj.material.dispose();
          }
        });
        this.parkingDebugGroup = null;
      }
      return;
    }

    if (this.parkingDebugGroup) return; // already showing

    const group = new THREE.Group();
    const indexed = this.graph.getIndexedBuildings();
    const roles = this.population?.getBuildingRoles();
    const rectW = 2, rectL = 5;
    const roleMats: Record<string, THREE.LineBasicMaterial> = {
      home: new THREE.LineBasicMaterial({ color: 0x8BC34A }),
      work: new THREE.LineBasicMaterial({ color: 0x64B5F6 }),
      shopping: new THREE.LineBasicMaterial({ color: 0xFFB74D }),
    };

    for (const b of indexed) {
      const role = roles?.get(b.buildingId);
      if (!role) continue;
      if (b.roadDirX === 0 && b.roadDirZ === 0) continue;
      const node = this.graph.nodes[b.nearestNodeId];
      if (!node) continue;

      // Perpendicular-right offset for curb position
      const perpX = -b.roadDirZ;
      const perpZ = b.roadDirX;
      const offset = getParkingOffset(b.roadType);
      const cx = node.x + perpX * offset;
      const cz = node.z + perpZ * offset;

      // Build rectangle corners oriented along road direction
      const hw = rectW / 2, hl = rectL / 2;
      const corners = [
        { x: cx + b.roadDirX * hl + perpX * hw, z: cz + b.roadDirZ * hl + perpZ * hw },
        { x: cx + b.roadDirX * hl - perpX * hw, z: cz + b.roadDirZ * hl - perpZ * hw },
        { x: cx - b.roadDirX * hl - perpX * hw, z: cz - b.roadDirZ * hl - perpZ * hw },
        { x: cx - b.roadDirX * hl + perpX * hw, z: cz - b.roadDirZ * hl + perpZ * hw },
      ];

      const positions = new Float32Array(24);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        positions[i * 6] = corners[i].x;
        positions[i * 6 + 1] = 0.50;
        positions[i * 6 + 2] = corners[i].z;
        positions[i * 6 + 3] = corners[j].x;
        positions[i * 6 + 4] = 0.50;
        positions[i * 6 + 5] = corners[j].z;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      group.add(new THREE.LineSegments(geom, roleMats[role]));
    }

    this.parkingDebugGroup = group;
    this.scene.add(group);
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

  getSimCarInfo(): SimCarInfo[] {
    return this.cars.map(c => {
      const occupants: PersonInfo[] = [];
      if (this.population) {
        for (const pid of c.occupantIds) {
          const info = this.population.getPersonInfo(pid);
          if (info) occupants.push(info);
        }
      }
      const originAddress = c.originBuildingId !== null
        ? this.graph.getBuildingRoadName(c.originBuildingId) : null;
      const destinationAddress = c.destinationBuildingId !== null
        ? this.graph.getBuildingRoadName(c.destinationBuildingId) : null;
      return {
        id: c.id,
        color: c.color,
        roadType: c.roadType,
        speed: c.state === 'driving' ? c.speed : 0,
        selected: c.selected,
        state: c.state,
        activity: c.activity,
        occupants,
        guestOccupants: this.population
          ? c.guestOccupantIds.map(pid => this.population!.getPersonInfo(pid)).filter((p): p is PersonInfo => p !== null)
          : [],
        dwellProgress: c.dwellTotal > 0 ? 1 - c.dwellRemaining / c.dwellTotal : 0,
        dwellRemaining: c.dwellRemaining,
        householdId: c.householdId,
        routeProgress: c.state === 'driving' && c.waypoints.length > 1
          ? (c.waypointIndex + c.progress) / (c.waypoints.length - 1)
          : -1,
        originBuildingId: c.originBuildingId,
        destinationBuildingId: c.destinationBuildingId,
        originAddress,
        destinationAddress,
        originPos: c.waypoints.length > 0 ? { x: c.waypoints[0].x, z: c.waypoints[0].z } : null,
        destinationPos: c.waypoints.length > 0 ? { x: c.waypoints[c.waypoints.length - 1].x, z: c.waypoints[c.waypoints.length - 1].z } : null,
      };
    });
  }

  update(deltaTime: number) {
    const toRemove = this.toRemove;
    toRemove.clear();

    for (const car of this.cars) {
      if (car.hidden) {
        car.hiddenTimer += deltaTime;
        if (car.hiddenTimer >= HIDDEN_TIMEOUT) {
          this.removeCar(car);
          toRemove.add(car.id);
        }
        continue;
      }

      if (car.hideGraceTimer > 0) {
        car.hideGraceTimer -= deltaTime;
        if (car.hideGraceTimer <= 0) {
          car.hideGraceTimer = 0;
          car.hidden = true;
          car.hiddenTimer = 0;
          car.mesh.visible = false;
          this.progressBars?.remove(car.id);
          this.setOccupantsTraveling(car);
          continue;
        }
      }

      if (car.state === 'parked') {
        this.updateParked(car, deltaTime);
        continue;
      }

      // Driving state
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
          // Reached destination
          if (car.householdId !== -1) {
            this.parkCar(car);
          } else {
            this.removeCar(car);
            toRemove.add(car.id);
          }
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
    }

    this.elapsedTime += deltaTime;
    const bobOffset = Math.sin(this.elapsedTime * MARKER_BOB_SPEED) * MARKER_BOB_AMPLITUDE;
    for (const car of this.cars) {
      if (car.originMarker) car.originMarker.position.y = MARKER_Y + bobOffset;
      if (car.destinationMarker) car.destinationMarker.position.y = MARKER_Y + bobOffset;
    }

    // Spawn new cars periodically (every 2s instead of every frame)
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= 0.25) {
      this.spawnTimer = 0;
      if (!this.graphBusy) this.spawnCars();
    }
    this.spawnFailedClearTimer += deltaTime;
    if (this.spawnFailedClearTimer >= 10) {
      this.spawnFailedClearTimer = 0;
      this.spawnFailedHouseholds.clear();
    }

    // Throttled state emission (~4 times/sec)
    this.stateThrottleTimer += deltaTime;
    if (this.stateThrottleTimer >= 0.25) {
      this.stateThrottleTimer = 0;
      this.onCarStateChange?.(this.getSimCarInfo());
    }
  }

  private updateParked(car: Car, deltaTime: number) {
    if (!this.population) return;
    if (this.graphBusy) return;

    // Apply activity restore to all occupants (including guests)
    if (car.activity) {
      for (const pid of car.occupantIds) {
        this.population.applyActivity(pid, car.activity, deltaTime);
      }
      for (const pid of car.guestOccupantIds) {
        this.population.applyActivity(pid, car.activity, deltaTime);
      }
    }

    car.dwellRemaining -= deltaTime;

    // Update progress bar
    if (this.progressBars && car.dwellTotal > 0) {
      const progress = 1 - car.dwellRemaining / car.dwellTotal;
      this.progressBars.updateBar(
        car.id, progress,
        car.mesh.position.x, car.mesh.position.y, car.mesh.position.z
      );
    }

    if (car.dwellRemaining <= 0) {
      car.dwellRemaining = 0;
      this.unparkCar(car);
    }
  }

  dispose() {
    this.setParkingDebug(false);
    for (const car of this.cars) {
      this.scene.remove(car.mesh);
      if (car.routeMesh) {
        this.scene.remove(car.routeMesh);
        car.routeMesh.geometry.dispose();
      }
      this.removeRouteMarkers(car);
    }
    this.cars = [];
    this.selectedCarIds.clear();
    this.carGeometry.dispose();
    this.routeMaterial.dispose();
    for (const mat of this.carMaterials.values()) mat.dispose();
    if (originPinTexture) { originPinTexture.dispose(); originPinTexture = null; }
    if (destPinTexture) { destPinTexture.dispose(); destPinTexture = null; }
  }
}
