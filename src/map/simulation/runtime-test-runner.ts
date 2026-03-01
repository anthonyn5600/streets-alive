import { runAllTests } from './runtime-tests';
import type { CarManager } from '../cars';
import type { PopulationManager } from './population';
import type { RuntimeTestResult, RuntimeTestSnapshot } from '../types';

const RUN_INTERVAL = 2; // seconds

export class RuntimeTestRunner {
  private elapsed = 0;
  private lastResults: RuntimeTestResult[] = [];
  private onResults: ((results: RuntimeTestResult[]) => void) | null = null;
  private enabled = false;

  setOnResults(cb: (results: RuntimeTestResult[]) => void) {
    this.onResults = cb;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  getLastResults(): RuntimeTestResult[] {
    return this.lastResults;
  }

  update(dt: number, carManager: CarManager, population: PopulationManager) {
    if (!this.enabled) return;

    this.elapsed += dt;
    if (this.elapsed < RUN_INTERVAL) return;
    this.elapsed = 0;

    try {
      const snap = this.collectSnapshot(carManager, population);
      this.lastResults = runAllTests(snap);
      this.onResults?.(this.lastResults);
      this.writeResultsToDisk(this.lastResults);
    } catch {
      // Never break the simulation
    }
  }

  private collectSnapshot(carManager: CarManager, population: PopulationManager): RuntimeTestSnapshot {
    return {
      cars: carManager.getCarTestData(),
      households: population.getHouseholdInfos(),
      persons: Array.from(population.people.values()).map(p => ({
        id: p.id,
        locationType: p.location.type,
        locationCarId: p.location.carId,
      })),
      indexedBuildingIds: carManager.getIndexedBuildingIds(),
      buildingRoleIds: new Set(population.getBuildingRoles().keys()),
      shoppingBuildingCount: population.shoppingBuildingIds.size,
      populationInitialized: population.isInitialized(),
    };
  }

  private writeResultsToDisk(results: RuntimeTestResult[]) {
    try {
      fetch('/__test-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      }).catch(() => {});
    } catch {
      // Fire-and-forget
    }
  }
}
