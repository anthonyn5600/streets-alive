import * as THREE from 'three';
import { MapCameraController } from './camera';
import { TileManager } from './tiles/manager';
import { CarManager } from './cars';
import { PopulationManager } from './simulation/population';
import { TripPlanner } from './simulation/trip-planner';
import { ProgressBarManager } from './simulation/progress-bar';
import { RuntimeTestRunner } from './simulation/runtime-test-runner';
import { setCenter, project, unproject } from './projection';
import { openTileCache, evictOldTiles } from './tiles/vector-tiles';
import { geometryCache, openGeometryCache, evictOldGeometry } from './tiles/geometry-cache';
import { materialPool } from './materials';
import type { SimCarInfo, HouseholdInfo, MapState, LatLng, RuntimeTestResult } from './types';
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

  const groundGeom = new THREE.PlaneGeometry(20000, 20000);
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
      this.emitState();
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
    openTileCache().then(() => evictOldTiles()).catch(() => {});
    openGeometryCache().then(() => evictOldGeometry()).catch(() => {});

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
    this.tileManager.updateVisibleTiles(bbox, zoom);
    this.emitState();
  }

  private updateCarGraph() {
    const roads = this.tileManager.getAllRoadData();
    const buildings = this.tileManager.getAllBuildingData();
    const version = this.tileManager.getRoadDataVersion();
    this.carManager.rebuildGraph(roads, version, buildings);

    if (!this.buildingColorsApplied && this.populationManager.isInitialized()) {
      this.buildingColorsApplied = true;
      this.applyBuildingColors();
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

  private emitState() {
    if (!this.onStateChange) return;

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

  async flyTo(lat: number, lng: number) {
    const pt = project({ lat, lng });
    await this.cameraController.flyTo(pt.x, pt.z);
    this.loadVisibleTiles();
  }

  async flyToScenePos(x: number, z: number) {
    await this.cameraController.flyTo(x, z);
    this.loadVisibleTiles();
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
    if (this.graphRebuildTimer !== null) {
      clearTimeout(this.graphRebuildTimer);
      this.graphRebuildTimer = null;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('click', this.handleClick);
    this.progressBarManager.dispose();
    this.carManager.dispose();
    this.tileManager.dispose();
    geometryCache.clear();
    materialPool.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
