import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { unproject } from './projection';
import { throttle } from '@/lib/utils';
import type { BBox, LatLng } from './types';

export class MapCameraController {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  private onChange: (() => void) | null = null;
  private throttledChange: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.camera = new THREE.PerspectiveCamera(60, width / height, 1, 50000);
    // Start nearly top-down for a good initial view
    this.camera.position.set(0, 500, 50);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = false;

    // Pan with left click, rotate with right click
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    // Polar angle constraints (no underground)
    this.controls.minPolarAngle = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.4; // ~72 degrees

    // Zoom distance
    this.controls.minDistance = 50;
    this.controls.maxDistance = 10000;

    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  onViewChange(callback: () => void) {
    this.onChange = callback;
    this.throttledChange = throttle(() => {
      callback();
    }, 300);
    this.controls.addEventListener('change', this.throttledChange);
  }

  update() {
    this.controls.update();
  }

  getZoomLevel(): number {
    const dist = this.camera.position.distanceTo(this.controls.target);
    return Math.max(0, Math.min(20, Math.log2(20000 / dist)));
  }

  getVisibleBBox(): BBox {
    // Sample 16 points around viewport perimeter to capture frustum projection
    // on the ground plane. 4 corners alone miss edge midpoints that can bulge
    // outward when the camera is tilted/rotated.
    const samplePoints = [
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(1, -1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(0, -1),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(0, 1),
      new THREE.Vector2(-1, 0),
      new THREE.Vector2(-0.5, -1),
      new THREE.Vector2(0.5, -1),
      new THREE.Vector2(-0.5, 1),
      new THREE.Vector2(0.5, 1),
      new THREE.Vector2(-1, -0.5),
      new THREE.Vector2(-1, 0.5),
      new THREE.Vector2(1, -0.5),
      new THREE.Vector2(1, 0.5),
    ];

    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const maxRadius = Math.max(dist * 1.5, 2500);

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let hitCount = 0;

    for (const pt of samplePoints) {
      this.raycaster.setFromCamera(pt, this.camera);
      const hit = new THREE.Vector3();
      const result = this.raycaster.ray.intersectPlane(this.ground, hit);
      if (result) {
        const dx = hit.x - target.x;
        const dz = hit.z - target.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > maxRadius) {
          hit.x = target.x + (dx / d) * maxRadius;
          hit.z = target.z + (dz / d) * maxRadius;
        }
        minX = Math.min(minX, hit.x);
        maxX = Math.max(maxX, hit.x);
        minZ = Math.min(minZ, hit.z);
        maxZ = Math.max(maxZ, hit.z);
        hitCount++;
      }
    }

    // If no sample points hit ground, use fallback
    if (hitCount === 0) {
      minX = target.x - maxRadius;
      maxX = target.x + maxRadius;
      minZ = target.z - maxRadius;
      maxZ = target.z + maxRadius;
    }

    // Convert scene coords to lat/lng
    const sw = unproject({ x: minX, z: maxZ });
    const ne = unproject({ x: maxX, z: minZ });

    return {
      south: Math.min(sw.lat, ne.lat),
      west: Math.min(sw.lng, ne.lng),
      north: Math.max(sw.lat, ne.lat),
      east: Math.max(sw.lng, ne.lng),
    };
  }

  getCursorLatLng(mouseX: number, mouseY: number, canvasWidth: number, canvasHeight: number): LatLng | null {
    const ndc = new THREE.Vector2(
      (mouseX / canvasWidth) * 2 - 1,
      -(mouseY / canvasHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    const result = this.raycaster.ray.intersectPlane(this.ground, hit);
    if (!result) return null;
    return unproject({ x: hit.x, z: hit.z });
  }

  flyTo(x: number, z: number, duration = 1000): Promise<void> {
    return new Promise(resolve => {
      const startTarget = this.controls.target.clone();
      const startPos = this.camera.position.clone();
      const endTarget = new THREE.Vector3(x, 0, z);
      const offset = startPos.clone().sub(startTarget);
      const endPos = endTarget.clone().add(offset);
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const ease = t * (2 - t); // ease-out quadratic

        this.controls.target.lerpVectors(startTarget, endTarget, ease);
        this.camera.position.lerpVectors(startPos, endPos, ease);
        this.controls.update();

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
          this.onChange?.();
        }
      };

      animate();
    });
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.throttledChange) {
      this.controls.removeEventListener('change', this.throttledChange);
    }
    this.controls.dispose();
  }
}
