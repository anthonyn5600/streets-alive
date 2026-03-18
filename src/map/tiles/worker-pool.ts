import type { BuildingData, LandUseData, RoadData } from '../types';
import type { ProjectionConstants } from '../projection';
import type { CachedBuildingArrays, CachedColoredRoadLayer, CachedRoadArrays, CachedLabelPlacement } from './geometry-cache';

export interface GeometryJobInput {
  buffer: ArrayBuffer;
  tileCoord: { z: number; x: number; y: number };
  zoomLevel: number;
  projection: ProjectionConstants;
  buildingColor: { r: number; g: number; b: number };
}

export interface GeometryJobResult {
  buildings: CachedBuildingArrays | null;
  roads: CachedRoadArrays;
  labelPlacements: CachedLabelPlacement[];
  landUse: CachedColoredRoadLayer[];
  decodedBuildings: BuildingData[];
  decodedRoads: RoadData[];
  decodedLandUse: LandUseData[];
}

export interface DecodeOnlyJobResult {
  decodedBuildings: BuildingData[];
  decodedRoads: RoadData[];
  decodedLandUse: LandUseData[];
}

interface PendingJob {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private nextWorker = 0;
  private pending = new Map<number, PendingJob>();
  private nextId = 0;

  private workerPending = new Map<Worker, Set<number>>();

  constructor(createWorker: () => Worker) {
    const count = Math.max(1, Math.min(
      (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2) - 1,
      6
    ));
    for (let i = 0; i < count; i++) {
      const w = createWorker();
      w.onmessage = (e) => this.handleMessage(e, w);
      w.onerror = (e) => this.handleError(e, w);
      this.workers.push(w);
      this.workerPending.set(w, new Set());
    }
  }

  postJob(input: GeometryJobInput): Promise<GeometryJobResult> {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workerPending.get(worker)!.add(id);
      worker.postMessage({ id, ...input }, [input.buffer]);
    });
  }

  postDecodeJob(input: { buffer: ArrayBuffer; tileCoord: { z: number; x: number; y: number } }): Promise<DecodeOnlyJobResult> {
    const id = this.nextId++;
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workerPending.get(worker)!.add(id);
      worker.postMessage({ id, buffer: input.buffer, tileCoord: input.tileCoord, decodeOnly: true }, [input.buffer]);
    });
  }

  private handleMessage(e: MessageEvent, worker: Worker) {
    const { id, ...result } = e.data;
    const job = this.pending.get(id);
    if (job) {
      this.pending.delete(id);
      this.workerPending.get(worker)?.delete(id);
      job.resolve(result as GeometryJobResult);
    }
  }

  private handleError(e: ErrorEvent, worker: Worker) {
    console.warn('Geometry worker error:', e.message);
    const workerJobs = this.workerPending.get(worker);
    if (workerJobs) {
      for (const id of workerJobs) {
        const job = this.pending.get(id);
        if (job) {
          this.pending.delete(id);
          job.reject(new Error(`Worker error: ${e.message}`));
        }
      }
      workerJobs.clear();
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const job of this.pending.values()) {
      job.reject(new Error('Worker pool disposed'));
    }
    this.pending.clear();
  }
}
