import * as THREE from 'three';
import { MapCameraController } from './camera';
import { TileManager } from './tiles/manager';
import { CarManager } from './cars';
import { PopulationManager, resetSimIdCounters } from './simulation/population';
import { TripPlanner } from './simulation/trip-planner';
import { RuntimeTestRunner } from './simulation/runtime-test-runner';
import { SimClock } from './simulation/clock';
import { setCenter, project, unproject } from './projection';
import { openTileCache, evictOldTiles, evictExcessTiles } from './tiles/vector-tiles';
import { geometryCache, openGeometryCache, evictOldGeometry, evictExcessGeometry } from './tiles/geometry-cache';
import { materialPool } from './materials';
import type { SimCarInfo, HouseholdInfo, MapState, LatLng, RuntimeTestResult, BBox, RoadData, TileKey, BuildingData } from './types';

const _clickNdc = new THREE.Vector2();

interface SkyKeyframe {
  hour: number;
  sky: number;
  fog: number;
  sunIntensity: number;
  sunColor: number;
  ambientIntensity: number;
  hemiIntensity: number;
  moonOpacity: number;
}

// Keyframes define the sky at specific hours; engine lerps between adjacent pairs
const SKY_KEYFRAMES: SkyKeyframe[] = [
  { hour: 0,  sky: 0x0a1628, fog: 0x0a1628, sunIntensity: 0.0, sunColor: 0x4466aa, ambientIntensity: 0.15, hemiIntensity: 0.05, moonOpacity: 1.0 },
  { hour: 5,  sky: 0x0a1628, fog: 0x0a1628, sunIntensity: 0.0, sunColor: 0x4466aa, ambientIntensity: 0.15, hemiIntensity: 0.05, moonOpacity: 1.0 },
  { hour: 6,  sky: 0x4a3060, fog: 0x3a2848, sunIntensity: 0.3, sunColor: 0xff8844, ambientIntensity: 0.2,  hemiIntensity: 0.1,  moonOpacity: 0.4 },
  { hour: 7,  sky: 0xf0a060, fog: 0xe89050, sunIntensity: 0.8, sunColor: 0xffaa66, ambientIntensity: 0.3,  hemiIntensity: 0.2,  moonOpacity: 0.0 },
  { hour: 8,  sky: 0xd4e6f1, fog: 0xd4e6f1, sunIntensity: 1.2, sunColor: 0xffffff, ambientIntensity: 0.4,  hemiIntensity: 0.3,  moonOpacity: 0.0 },
  { hour: 17, sky: 0xd4e6f1, fog: 0xd4e6f1, sunIntensity: 1.2, sunColor: 0xffffff, ambientIntensity: 0.4,  hemiIntensity: 0.3,  moonOpacity: 0.0 },
  { hour: 18, sky: 0xf0a060, fog: 0xe89050, sunIntensity: 0.8, sunColor: 0xffaa66, ambientIntensity: 0.3,  hemiIntensity: 0.2,  moonOpacity: 0.0 },
  { hour: 19, sky: 0x4a3060, fog: 0x3a2848, sunIntensity: 0.3, sunColor: 0xff6644, ambientIntensity: 0.2,  hemiIntensity: 0.1,  moonOpacity: 0.4 },
  { hour: 20, sky: 0x0a1628, fog: 0x0a1628, sunIntensity: 0.0, sunColor: 0x4466aa, ambientIntensity: 0.15, hemiIntensity: 0.05, moonOpacity: 1.0 },
  { hour: 24, sky: 0x0a1628, fog: 0x0a1628, sunIntensity: 0.0, sunColor: 0x4466aa, ambientIntensity: 0.15, hemiIntensity: 0.05, moonOpacity: 1.0 },
];

const _skyA = new THREE.Color();
const _skyB = new THREE.Color();

function lerpSky(hour: number): { sky: THREE.Color; fog: THREE.Color; sunIntensity: number; sunColor: THREE.Color; ambientIntensity: number; hemiIntensity: number; moonOpacity: number } {
  let i = 0;
  while (i < SKY_KEYFRAMES.length - 1 && SKY_KEYFRAMES[i + 1].hour <= hour) i++;
  const a = SKY_KEYFRAMES[i];
  const b = SKY_KEYFRAMES[Math.min(i + 1, SKY_KEYFRAMES.length - 1)];
  const range = b.hour - a.hour;
  const t = range > 0 ? (hour - a.hour) / range : 0;

  return {
    sky: _skyA.set(a.sky).lerp(_skyB.set(b.sky), t).clone(),
    fog: _skyA.set(a.fog).lerp(_skyB.set(b.fog), t).clone(),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    sunColor: _skyA.set(a.sunColor).lerp(_skyB.set(b.sunColor), t).clone(),
    ambientIntensity: a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t,
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    moonOpacity: a.moonOpacity + (b.moonOpacity - a.moonOpacity) * t,
  };
}

interface SceneLights {
  sun: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  moon: THREE.Sprite;
  moonMaterial: THREE.SpriteMaterial;
}

function createMoonTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2;

  // Outer glow (fills the full canvas, fades to transparent)
  const glowR = size * 0.48;
  const moonR = size * 0.22;
  const glow = ctx.createRadialGradient(cx, cy, moonR, cx, cy, glowR);
  glow.addColorStop(0, 'rgba(210, 208, 190, 0.18)');
  glow.addColorStop(0.4, 'rgba(190, 188, 170, 0.06)');
  glow.addColorStop(0.7, 'rgba(170, 168, 155, 0.02)');
  glow.addColorStop(1, 'rgba(150, 148, 140, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Moon disc — off-center highlight for 3D illusion
  const disc = ctx.createRadialGradient(cx - moonR * 0.15, cy - moonR * 0.15, 0, cx, cy, moonR);
  disc.addColorStop(0, '#f5f0e0');
  disc.addColorStop(0.4, '#ebe5d0');
  disc.addColorStop(0.75, '#d8d0b8');
  disc.addColorStop(0.95, '#c0b898');
  disc.addColorStop(1, 'rgba(160, 152, 120, 0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, moonR * 1.05, 0, Math.PI * 2);
  ctx.fill();

  // Maria (dark patches)
  const maria = [
    { x: 0.44, y: 0.42, r: 0.06, a: 0.18 },
    { x: 0.52, y: 0.48, r: 0.08, a: 0.14 },
    { x: 0.46, y: 0.54, r: 0.04, a: 0.12 },
    { x: 0.56, y: 0.43, r: 0.035, a: 0.10 },
    { x: 0.42, y: 0.50, r: 0.05, a: 0.12 },
  ];
  for (const m of maria) {
    const mg = ctx.createRadialGradient(m.x * size, m.y * size, 0, m.x * size, m.y * size, m.r * size);
    mg.addColorStop(0, `rgba(90, 80, 60, ${m.a})`);
    mg.addColorStop(1, 'rgba(90, 80, 60, 0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, size, size);
  }

  // Craters
  const craters = [
    { x: 0.45, y: 0.40, r: 0.012 }, { x: 0.54, y: 0.52, r: 0.010 },
    { x: 0.50, y: 0.56, r: 0.008 }, { x: 0.57, y: 0.46, r: 0.007 },
    { x: 0.43, y: 0.53, r: 0.009 }, { x: 0.48, y: 0.44, r: 0.006 },
  ];
  for (const c of craters) {
    const px = c.x * size, py = c.y * size, pr = c.r * size;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(70, 65, 50, 0.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + pr * 0.3, py + pr * 0.3, pr * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 250, 230, 0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createScene(): { scene: THREE.Scene; lights: SceneLights } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd4e6f1);
  scene.fog = new THREE.Fog(0xd4e6f1, 2000, 8000);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(200, 500, 300);
  sun.castShadow = false;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xb97a20, 0.3);
  scene.add(hemi);

  const moonTexture = createMoonTexture();
  const moonMaterial = new THREE.SpriteMaterial({
    map: moonTexture,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const moon = new THREE.Sprite(moonMaterial);
  moon.scale.set(350, 350, 1);
  moon.renderOrder = -1;
  scene.add(moon);

  const groundGeom = new THREE.PlaneGeometry(30000, 30000);
  const ground = new THREE.Mesh(groundGeom, materialPool.getGround());
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = 'ground';
  scene.add(ground);

  return { scene, lights: { sun, ambient, hemi, moon, moonMaterial } };
}

export class MapEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cameraController!: MapCameraController;
  private tileManager!: TileManager;
  private carManager!: CarManager;
  private populationManager!: PopulationManager;
  private tripPlanner!: TripPlanner;
  private testRunner!: RuntimeTestRunner;
  private clock!: SimClock;
  private lights!: SceneLights;
  private animationId: number | null = null;
  private canvas!: HTMLCanvasElement;
  private onStateChange: ((state: MapState) => void) | null = null;
  private cursorLatLng: LatLng | null = null;
  private onCursorChange: ((pos: LatLng | null) => void) | null = null;
  private onCarStateChangeCallback: ((cars: SimCarInfo[]) => void) | null = null;
  private onHouseholdChangeCallback: ((households: HouseholdInfo[]) => void) | null = null;
  private onTestResultsCallback: ((results: RuntimeTestResult[]) => void) | null = null;
  private onSimTimeChangeCallback: ((time: string) => void) | null = null;
  private disposed = false;
  private lastFrameTime = 0;
  private raycaster = new THREE.Raycaster();
  private lastRolesVersion = 0;
  private graphRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private evictionIntervalId: ReturnType<typeof setInterval> | null = null;
  private persistentRoadData = new Map<TileKey, RoadData[]>();
  private persistentRoadVersion = 0;
  private persistentSimBuildings = new Map<number, BuildingData>();
  private stateDirty = false;
  private stateRafId: number | null = null;

  init(canvas: HTMLCanvasElement, onStateChange: (state: MapState) => void) {
    this.canvas = canvas;
    this.onStateChange = onStateChange;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Scene
    const { scene, lights } = createScene();
    this.scene = scene;
    this.lights = lights;

    // Camera
    this.cameraController = new MapCameraController(canvas, width, height);

    // Tile manager
    this.tileManager = new TileManager(this.scene);
    this.tileManager.setCamera(this.cameraController.camera);
    this.tileManager.setOnStateChange(() => {
      this.markStateDirty();
      if (this.graphRebuildTimer !== null) clearTimeout(this.graphRebuildTimer);
      this.graphRebuildTimer = setTimeout(() => {
        this.graphRebuildTimer = null;
        this.updateCarGraph();
      }, 100);
    });

    this.tileManager.setCanvasSize(width, height);

    // Population and trip planner
    this.populationManager = new PopulationManager();
    this.tripPlanner = new TripPlanner();

    // Car manager
    this.carManager = new CarManager(this.scene);

    // Runtime test runner
    this.testRunner = new RuntimeTestRunner();
    this.testRunner.setOnResults((results) => this.onTestResultsCallback?.(results));

    // Simulation clock (start at 8 AM = 28800 sim-seconds)
    this.clock = new SimClock();
    this.clock.simTime = 28800;

    this.carManager.population = this.populationManager;
    this.carManager.tripPlanner = this.tripPlanner;
    this.carManager.onCarStateChange = (cars) => {
      this.onCarStateChangeCallback?.(cars);
      if (this.onHouseholdChangeCallback && this.populationManager.isInitialized()) {
        this.onHouseholdChangeCallback(this.populationManager.getHouseholdInfos());
      }
    };

    // Set center to LA
    setCenter(34.0522, -118.2437);

    // Initialize persistent caches (fire-and-forget)
    openTileCache().then(() => Promise.all([evictOldTiles(), evictExcessTiles()])).catch(() => {});
    openGeometryCache().then(() => Promise.all([evictOldGeometry(), evictExcessGeometry()])).catch(() => {});

    // Periodic eviction every 30 minutes
    const EVICTION_INTERVAL_MS = 30 * 60 * 1000;
    this.evictionIntervalId = setInterval(() => {
      evictOldTiles().catch(() => {});
      evictExcessTiles().catch(() => {});
      evictOldGeometry().catch(() => {});
      evictExcessGeometry().catch(() => {});
    }, EVICTION_INTERVAL_MS);

    // Initial tile load
    this.cameraController.onViewChange(() => this.loadVisibleTiles());
    this.loadVisibleTiles();

    // Mouse move for cursor lat/lng
    canvas.addEventListener('mousemove', this.handleMouseMove);
    // Click for car selection
    canvas.addEventListener('click', this.handleClick);

    // Initialize sky to match clock
    this.updateDayNight(this.clock.getHourFraction());

    // Start render loop
    this.animate();
  }

  private handleMouseMove = (e: MouseEvent) => {
    this.cursorLatLng = this.cameraController.getCursorLatLng(
      e.offsetX, e.offsetY,
      this.canvas.clientWidth, this.canvas.clientHeight
    );
    this.onCursorChange?.(this.cursorLatLng);
  };

  private handleClick = (e: MouseEvent) => {
    _clickNdc.set(
      (e.offsetX / this.canvas.clientWidth) * 2 - 1,
      -(e.offsetY / this.canvas.clientHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(_clickNdc, this.cameraController.camera);

    const hitCarId = this.carManager.getCarAtPosition(this.raycaster);
    if (hitCarId !== null) {
      const selected = this.carManager.getSelectedCarIds();
      if (selected.has(hitCarId)) {
        this.carManager.deselectCar(hitCarId);
      } else {
        this.carManager.selectCar(hitCarId);
      }
    }
  };

  getCursorLatLng(): LatLng | null {
    return this.cursorLatLng;
  }

  setOnCursorChange(cb: (pos: LatLng | null) => void) {
    this.onCursorChange = cb;
  }

  setOnCarStateChange(cb: (cars: SimCarInfo[]) => void) {
    this.onCarStateChangeCallback = cb;
  }

  setOnHouseholdChange(cb: (households: HouseholdInfo[]) => void) {
    this.onHouseholdChangeCallback = cb;
  }

  setOnTestResults(cb: (results: RuntimeTestResult[]) => void) {
    this.onTestResultsCallback = cb;
  }

  setOnSimTimeChange(cb: (time: string) => void) {
    this.onSimTimeChangeCallback = cb;
  }

  selectCarById(id: number) {
    this.carManager.selectCar(id);
  }

  deselectCar(carId?: number) {
    if (carId !== undefined) {
      this.carManager.deselectCar(carId);
    } else {
      this.carManager.deselectAll();
    }
  }

  getCarInfo(): SimCarInfo[] {
    return this.carManager.getSimCarInfo();
  }

  getCarPosition(carId: number): { x: number; z: number } | null {
    return this.carManager.getCarPosition(carId);
  }

  getBuildingPosition(buildingId: number): { x: number; z: number } | null {
    return this.carManager.getBuildingPosition(buildingId);
  }

  flyToPersonLocation(personId: number): void {
    if (!this.populationManager.isInitialized()) return;
    const person = this.populationManager.people.get(personId);
    if (!person) return;

    if (person.location.type === 'car' || person.location.type === 'traveling') {
      const car = this.carManager.getCarByPersonId(personId);
      if (car) {
        this.selectCarById(car.id);
        this.flyToScenePos(car.x, car.z);
      }
      return;
    }

    // home or building
    const buildingId = person.location.buildingId ?? person.homeBuildingId;
    const pos = this.carManager.getBuildingPosition(buildingId);
    if (pos) {
      this.flyToScenePos(pos.x, pos.z);
    }
  }

  private loadVisibleTiles() {
    if (this.disposed) return;
    const bbox = this.cameraController.getVisibleBBox();
    const zoom = this.cameraController.getZoomLevel();
    const LOAD_RADIUS_DEG = 0.03;
    const expandedBBox: BBox = {
      south: bbox.south - LOAD_RADIUS_DEG,
      north: bbox.north + LOAD_RADIUS_DEG,
      west: bbox.west - LOAD_RADIUS_DEG,
      east: bbox.east + LOAD_RADIUS_DEG,
    };
    this.tileManager.updateVisibleTiles(expandedBBox, zoom);
    this.markStateDirty();
  }

  private async updateCarGraph() {
    // Merge loaded tile roads into persistent store
    for (const [key, tile] of this.tileManager.getTileEntries()) {
      if (tile.roadData && !this.persistentRoadData.has(key)) {
        this.persistentRoadData.set(key, tile.roadData);
        this.persistentRoadVersion++;
      }
    }

    // Prune tiles beyond ~20km from camera center
    this.prunePersistentRoads();

    // Roads from persistent store, buildings from loaded tiles + persistent sim buildings
    const roads: RoadData[] = [];
    for (const tileRoads of this.persistentRoadData.values()) {
      roads.push(...tileRoads);
    }
    const buildings = this.tileManager.getAllBuildingData();

    // Ensure sim-critical buildings survive tile unloads
    if (this.persistentSimBuildings.size > 0) {
      const loadedIds = new Set(buildings.map(b => b.id));
      for (const [id, data] of this.persistentSimBuildings) {
        if (!loadedIds.has(id)) buildings.unshift(data);
      }
    }

    await this.carManager.rebuildGraph(roads, this.persistentRoadVersion, buildings);

    // Capture role buildings into persistent store so they survive tile unloads
    if (this.populationManager.isInitialized()) {
      const roles = this.populationManager.getBuildingRoles();
      for (const b of buildings) {
        if (roles.has(b.id) && !this.persistentSimBuildings.has(b.id)) {
          this.persistentSimBuildings.set(b.id, b);
        }
      }
    }

    if (this.populationManager.isInitialized() && this.carManager.rolesVersion !== this.lastRolesVersion) {
      this.lastRolesVersion = this.carManager.rolesVersion;
      this.applyBuildingColors();
    }
  }

  private prunePersistentRoads() {
    const PERSIST_RADIUS_DEG = 0.18;
    const center = this.cameraController.controls.target;
    const cameraLatLng = unproject({ x: center.x, z: center.z });

    for (const key of this.persistentRoadData.keys()) {
      // Parse tile key "z/x/y" to get tile center lat/lng
      const parts = key.split('/');
      if (parts.length !== 3) continue;
      const z = parseInt(parts[0], 10);
      const tx = parseInt(parts[1], 10);
      const ty = parseInt(parts[2], 10);
      const n = Math.pow(2, z);
      const tileCenterLng = ((tx + 0.5) / n) * 360 - 180;
      const tileCenterLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 0.5)) / n))) * 180) / Math.PI;

      const dLat = tileCenterLat - cameraLatLng.lat;
      const cosLat = Math.cos(cameraLatLng.lat * Math.PI / 180);
      const dLng = (tileCenterLng - cameraLatLng.lng) * cosLat;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);

      if (dist > PERSIST_RADIUS_DEG) {
        this.persistentRoadData.delete(key);
      }
    }
  }

  private applyBuildingColors() {
    const profColors = this.populationManager.getBuildingColors();
    const colorMap = new Map<number, THREE.Color>();
    for (const [buildingId, hex] of profColors) {
      colorMap.set(buildingId, new THREE.Color(hex));
    }
    this.tileManager.setBuildingColorMap(colorMap);
  }

  private updateDayNight(hour: number) {
    const sky = lerpSky(hour);
    (this.scene.background as THREE.Color).copy(sky.sky);
    (this.scene.fog as THREE.Fog).color.copy(sky.fog);
    this.lights.sun.intensity = sky.sunIntensity;
    this.lights.sun.color.copy(sky.sunColor);
    this.lights.ambient.intensity = sky.ambientIntensity;
    this.lights.hemi.intensity = sky.hemiIntensity;
    this.lights.moonMaterial.opacity = sky.moonOpacity;
    this.lights.moon.visible = sky.moonOpacity > 0.01;
    if (this.lights.moon.visible) {
      // Fixed position high in the sky, offset from map center
      this.lights.moon.position.set(2000, 3000, -2000);
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);

    const now = performance.now() / 1000;
    const deltaTime = this.lastFrameTime === 0 ? 0.016 : Math.min(now - this.lastFrameTime, 0.1);
    this.lastFrameTime = now;

    this.tileManager.drainMeshQueue();
    this.cameraController.update();
    const timeChanged = this.clock.update(deltaTime);
    if (timeChanged) {
      this.onSimTimeChangeCallback?.(this.clock.formatFull());
      this.updateDayNight(this.clock.getHourFraction());
    }
    this.populationManager.updateNeeds(deltaTime);
    this.carManager.update(deltaTime, this.clock);
    this.testRunner.update(deltaTime, this.carManager, this.populationManager);
    const target = this.cameraController.controls.target;
    const camDist = this.cameraController.camera.position.distanceTo(target);
    materialPool.updateBuildingFlatten(target.x, target.z, camDist * 1.0, camDist * 3.0);

    this.renderer.render(this.scene, this.cameraController.camera);
  };

  private markStateDirty() {
    this.stateDirty = true;
    if (this.stateRafId === null) {
      this.stateRafId = requestAnimationFrame(() => {
        this.stateRafId = null;
        this.flushState();
      });
    }
  }

  private flushState() {
    if (!this.stateDirty || !this.onStateChange) return;
    this.stateDirty = false;

    const center = this.cameraController.controls.target;
    const cameraLatLng = unproject({ x: center.x, z: center.z });

    this.onStateChange({
      loading: this.tileManager.getLoadingCount() > 0,
      loadingTiles: this.tileManager.getLoadingCount(),
      totalTiles: this.tileManager.getTotalTileCount(),
      cursorLatLng: this.cursorLatLng,
      cameraLatLng,
      zoomLevel: this.cameraController.getZoomLevel(),
    });
  }

  setLayerVisibility(layer: 'buildings' | 'roads' | 'labels' | 'landuse', visible: boolean) {
    this.tileManager.setLayerVisibility(layer, visible);
  }

  setParkingDebug(show: boolean) {
    this.carManager.setParkingDebug(show);
  }

  setHeightMultiplier(mult: number) {
    this.tileManager.setHeightMultiplier(mult);
  }

  setTestRunnerEnabled(enabled: boolean) {
    this.testRunner.setEnabled(enabled);
  }

  async flyTo(lat: number, lng: number) {
    const pt = project({ lat, lng });
    await this.cameraController.flyTo(pt.x, pt.z);
    setTimeout(() => this.loadVisibleTiles(), 0);
  }

  async flyToScenePos(x: number, z: number) {
    await this.cameraController.flyTo(x, z);
    setTimeout(() => this.loadVisibleTiles(), 0);
  }

  getPerformanceLog() {
    return this.tileManager.getPerformanceLog();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.cameraController.resize(width, height);
    this.tileManager.setCanvasSize(width, height);
    this.loadVisibleTiles();
  }

  dispose() {
    this.disposed = true;
    if (this.evictionIntervalId !== null) {
      clearInterval(this.evictionIntervalId);
      this.evictionIntervalId = null;
    }
    if (this.graphRebuildTimer !== null) {
      clearTimeout(this.graphRebuildTimer);
      this.graphRebuildTimer = null;
    }
    if (this.stateRafId !== null) {
      cancelAnimationFrame(this.stateRafId);
      this.stateRafId = null;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('click', this.handleClick);
    this.lights.moonMaterial.map?.dispose();
    this.lights.moonMaterial.dispose();
    this.carManager.dispose();
    resetSimIdCounters();
    this.tileManager.dispose();
    this.persistentRoadData.clear();
    this.persistentSimBuildings.clear();
    geometryCache.clear();
    materialPool.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
