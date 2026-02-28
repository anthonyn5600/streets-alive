import * as THREE from 'three';
import type { ActivityType } from '../types';

const BAR_WIDTH = 4;
const BAR_HEIGHT = 0.5;
const BAR_Y_OFFSET = 3.0;

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  home: 'At Home',
  work: 'Working',
  shopping: 'Shopping',
  social: 'Socializing',
};

function createTextTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

interface BarEntry {
  carId: number;
  group: THREE.Group;
  fillMesh: THREE.Mesh;
  bgMesh: THREE.Mesh;
  sprite: THREE.Sprite;
}

export class ProgressBarManager {
  private scene: THREE.Scene;
  private bars = new Map<number, BarEntry>();
  private bgMaterial: THREE.MeshBasicMaterial;
  private fillMaterial: THREE.MeshBasicMaterial;
  private textTextures = new Map<ActivityType, THREE.CanvasTexture>();
  private bgGeometry: THREE.PlaneGeometry;
  private fillGeometry: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x44bb44,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.bgGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    this.fillGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
  }

  create(carId: number, x: number, y: number, z: number, activity: ActivityType): void {
    if (this.bars.has(carId)) return;

    const group = new THREE.Group();
    group.position.set(x, y + BAR_Y_OFFSET, z);
    group.renderOrder = 10;

    // Background bar
    const bgMesh = new THREE.Mesh(this.bgGeometry, this.bgMaterial);
    bgMesh.renderOrder = 10;
    group.add(bgMesh);

    // Fill bar (starts at 0 width)
    const fillMesh = new THREE.Mesh(this.fillGeometry, this.fillMaterial);
    fillMesh.renderOrder = 11;
    fillMesh.scale.x = 0.001;
    fillMesh.position.z = 0.01; // slightly in front of bg
    group.add(fillMesh);

    // Text sprite
    let tex = this.textTextures.get(activity);
    if (!tex) {
      tex = createTextTexture(ACTIVITY_LABELS[activity]);
      this.textTextures.set(activity, tex);
    }
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(4, 1, 1);
    sprite.position.y = 0.8;
    sprite.renderOrder = 12;
    group.add(sprite);

    this.scene.add(group);
    this.bars.set(carId, { carId, group, fillMesh, bgMesh, sprite });
  }

  updateBar(carId: number, progress: number, x: number, y: number, z: number): void {
    const bar = this.bars.get(carId);
    if (!bar) return;
    bar.fillMesh.scale.x = Math.max(0.001, Math.min(1, progress));
    bar.fillMesh.position.x = -(BAR_WIDTH / 2) * (1 - progress);
    bar.group.position.set(x, y + BAR_Y_OFFSET, z);
  }

  remove(carId: number): void {
    const bar = this.bars.get(carId);
    if (!bar) return;
    this.scene.remove(bar.group);
    // Dispose sprite material (unique per bar instance)
    if (bar.sprite.material instanceof THREE.SpriteMaterial) {
      bar.sprite.material.dispose();
    }
    this.bars.delete(carId);
  }

  update(camera: THREE.Camera): void {
    // Billboard all bars toward camera
    for (const bar of this.bars.values()) {
      bar.group.quaternion.copy(camera.quaternion);
    }
  }

  dispose(): void {
    for (const bar of this.bars.values()) {
      this.scene.remove(bar.group);
      if (bar.sprite.material instanceof THREE.SpriteMaterial) {
        bar.sprite.material.dispose();
      }
    }
    this.bars.clear();
    this.bgMaterial.dispose();
    this.fillMaterial.dispose();
    this.bgGeometry.dispose();
    this.fillGeometry.dispose();
    for (const tex of this.textTextures.values()) {
      tex.dispose();
    }
    this.textTextures.clear();
  }
}
