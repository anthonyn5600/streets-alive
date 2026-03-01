import * as THREE from 'three';
import { MapCameraController } from './camera';
import { TileManager } from './tiles/manager';
import { CarManager } from './cars';
import { PopulationManager } from './simulation/population';
import { TripPlanner } from './simulation/trip-planner';
import { ProgressBarManager } from './simulation/progress-bar';
import { RuntimeTestRunner } from './simulation/runtime-test-runner';
import { setCenter, project, unproject } from './projection';
import { openTileCache, evictOldTiles, evictExcessTiles } from './tiles/vector-tiles';
import { geometryCache, openGeometryCache, evictOldGeometry, evictExcessGeometry } from './tiles/geometry-cache';
import { materialPool } from './materials';
import type { SimCarInfo, HouseholdInfo, MapState, LatLng, RuntimeTestResult, BBox, RoadData, TileKey } from './types';
import type { BuildingRole } from './simulation/population';

const _clickNdc = new THREE.Vector2();

function createScene(): THREE.Scene {
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

  const groundGeom = new THREE.PlaneGeometry(30000, 30000);
  const groundMat = new THREE.MeshLambertMaterial({
    color: 0xe8e6e0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = 'ground';
  scene.add(ground);

  return scene;
}

export class MapEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cameraController!: MapCameraController;
  private tileManager!: TileManager;
  private carManager!: CarManager;
  private populationManager!: PopulationManager;
  private tripPlanner!: TripPlanner;
  private progressBarManager!: ProgressBarManager;
  private testRunner!: RuntimeTestRunner;
  private animationId: number | null = null;
  private canvas!: HTMLCanvasElement;
  private onStateChange: ((state: MapState) => void) | null = null;
  private cursorLatLng: LatLng | null = null;
  private onCursorChange: ((pos: LatLng | null) => void) | null = null;
  private onCarStateChangeCallback: ((cars: SimCarInfo[]) => void) | null = null;
  private onHouseholdChangeCallback: ((households: HouseholdInfo[]) => void) | null = null;
  private onTestResultsCallback: ((results: RuntimeTestResult[]) => void) | null = null;
  private disposed = false;
  private lastFrameTime = 0;
  private raycaster = new THREE.Raycaster();
  private buildingColorsApplied = false;
  private graphRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private evictionIntervalId: ReturnType<typeof setInterval> | null = null;
  private persistentRoadData = new Map<TileKey, RoadData[]>();
  private persistentRoadVersion = 0;
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
    this.scene = createScene();

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
    // Progress bar manager
    this.progressBarManager = new ProgressBarManager(this.scene);

    // Runtime test runner
    this.testRunner = new RuntimeTestRunner();
    this.testRunner.setOnResults((results) => this.onTestResultsCallback?.(results));

    this.carManager.population = this.populationManager;
    this.carManager.tripPlanner = this.tripPlanner;
    this.carManager.progressBars = this.progressBarManager;
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
      const currentSelected = this.carManager.getSelectedCarId();
      if (currentSelected === hitCarId) {
        this.carManager.deselectCar(hitCarId);
      } else {
        this.carManager.selectCar(hitCarId);
      }
    } else {
      this.carManager.deselectAll();
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

  selectCarById(id: number) {
    this.carManager.selectCar(id);
  }

  deselectCar() {
    this.carManager.deselectAll();
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

    // Roads from persistent store, buildings from loaded tiles only
    const roads: RoadData[] = [];
    for (const tileRoads of this.persistentRoadData.values()) {
      roads.push(...tileRoads);
    }
    const buildings = this.tileManager.getAllBuildingData();
    await this.carManager.rebuildGraph(roads, this.persistentRoadVersion, buildings);

    if (!this.buildingColorsApplied && this.populationManager.isInitialized()) {
      this.buildingColorsApplied = true;
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

      const dist = Math.sqrt(
        Math.pow(tileCenterLat - cameraLatLng.lat, 2) +
        Math.pow(tileCenterLng - cameraLatLng.lng, 2)
      );

      if (dist > PERSIST_RADIUS_DEG) {
        this.persistentRoadData.delete(key);
      }
    }
  }

  private applyBuildingColors() {
    const ROLE_COLORS: Record<BuildingRole, THREE.Color> = {
      home: new THREE.Color(0x8BC34A),
      work: new THREE.Color(0x64B5F6),
      shopping: new THREE.Color(0xFFB74D),
    };

    const roles = this.populationManager.getBuildingRoles();
    const colorMap = new Map<number, THREE.Color>();
    for (const [buildingId, role] of roles) {
      colorMap.set(buildingId, ROLE_COLORS[role]);
    }
    this.tileManager.setBuildingColorMap(colorMap);
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);

    const now = performance.now() / 1000;
    const deltaTime = this.lastFrameTime === 0 ? 0.016 : Math.min(now - this.lastFrameTime, 0.1);
    this.lastFrameTime = now;

    this.tileManager.drainMeshQueue();
    this.cameraController.update();
    this.populationManager.updateNeeds(deltaTime);
    this.carManager.update(deltaTime);
    this.testRunner.update(deltaTime, this.carManager, this.populationManager);
    this.progressBarManager.update(this.cameraController.camera);

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

  setLayerVisibility(layer: 'buildings' | 'roads' | 'labels', visible: boolean) {
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
    this.progressBarManager.dispose();
    this.carManager.dispose();
    this.tileManager.dispose();
    this.persistentRoadData.clear();
    geometryCache.clear();
    materialPool.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
