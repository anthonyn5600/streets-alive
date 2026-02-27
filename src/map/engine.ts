import * as THREE from 'three';
import { MapCameraController } from './camera';
import { TileManager } from './tiles/manager';
import { CarManager } from './cars';
import { setCenter, project, unproject } from './projection';
import { openTileCache, evictOldTiles } from './tiles/vector-tiles';
import type { CarInfo, MapState, LatLng } from './types';

function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd4e6f1);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(200, 500, 300);
  sun.castShadow = false;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xb97a20, 0.3);
  scene.add(hemi);

  const groundGeom = new THREE.PlaneGeometry(20000, 20000);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xe8e6e0 });
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
  private animationId: number | null = null;
  private canvas!: HTMLCanvasElement;
  private onStateChange: ((state: MapState) => void) | null = null;
  private cursorLatLng: LatLng | null = null;
  private onCursorChange: ((pos: LatLng | null) => void) | null = null;
  private onCarStateChangeCallback: ((cars: CarInfo[]) => void) | null = null;
  private disposed = false;
  private lastFrameTime = 0;
  private raycaster = new THREE.Raycaster();

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
      this.updateCarGraph();
    });

    this.tileManager.setCanvasSize(width, height);

    // Car manager
    this.carManager = new CarManager(this.scene);
    this.carManager.onCarStateChange = (cars) => {
      this.onCarStateChangeCallback?.(cars);
    };

    // Set center to LA
    setCenter(34.0522, -118.2437);

    // Initialize persistent tile cache (fire-and-forget)
    openTileCache().then(() => evictOldTiles()).catch(() => {});

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
    const ndc = new THREE.Vector2(
      (e.offsetX / this.canvas.clientWidth) * 2 - 1,
      -(e.offsetY / this.canvas.clientHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.cameraController.camera);

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

  setOnCarStateChange(cb: (cars: CarInfo[]) => void) {
    this.onCarStateChangeCallback = cb;
  }

  selectCarById(id: number) {
    this.carManager.selectCar(id);
  }

  deselectCar() {
    this.carManager.deselectAll();
  }

  getCarInfo(): CarInfo[] {
    return this.carManager.getCarInfo();
  }

  getCarPosition(carId: number): { x: number; z: number } | null {
    return this.carManager.getCarPosition(carId);
  }

  private loadVisibleTiles() {
    if (this.disposed) return;
    const bbox = this.cameraController.getVisibleBBox();
    const zoom = this.cameraController.getZoomLevel();
    console.log('[MapEngine] loadVisibleTiles bbox:', bbox, 'zoom:', zoom.toFixed(1));
    this.tileManager.updateVisibleTiles(bbox, zoom);
    this.emitState();
  }

  private updateCarGraph() {
    const roads = this.tileManager.getAllRoadData();
    const buildings = this.tileManager.getAllBuildingData();
    const version = this.tileManager.getRoadDataVersion();
    this.carManager.rebuildGraph(roads, version, buildings);
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);

    const now = performance.now() / 1000;
    const deltaTime = this.lastFrameTime === 0 ? 0.016 : Math.min(now - this.lastFrameTime, 0.1);
    this.lastFrameTime = now;

    this.cameraController.update();
    this.carManager.update(deltaTime);
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

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.cameraController.resize(width, height);
    this.tileManager.setCanvasSize(width, height);
    this.loadVisibleTiles();
  }

  dispose() {
    this.disposed = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('click', this.handleClick);
    this.carManager.dispose();
    this.tileManager.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
