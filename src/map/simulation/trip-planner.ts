import type { ActivityType, NeedType } from '../types';
import type { PopulationManager } from './population';
import { ACTIVITY_RESTORE, NEED_TYPES } from './population';

interface ActionOption {
  activity: ActivityType;
  buildingId: number;
  score: number;
}

export const DWELL_RANGES: Record<ActivityType, [number, number]> = {
  home: [10, 20],
  work: [30, 60],
  shopping: [15, 30],
  social: [15, 30],
};

function urgency(value: number): number {
  const deficit = (100 - value) / 100;
  return deficit * deficit;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class TripPlanner {
  scoreActions(
    occupantIds: number[],
    population: PopulationManager,
    driverPersonId: number,
    lastActivity: ActivityType | null = null
  ): ActionOption[] {
    const options: ActionOption[] = [];
    const activities: ActivityType[] = ['home', 'work', 'shopping', 'social'];

    const driver = population.people.get(driverPersonId);
    if (!driver) return options;
    const driverHousehold = population.getHouseholdByPerson(driverPersonId);

    for (const activity of activities) {
      // Compute score averaged over all occupants
      let totalScore = 0;
      for (const occupantId of occupantIds) {
        const person = population.people.get(occupantId);
        if (!person) continue;

        const restores = ACTIVITY_RESTORE[activity];
        let personScore = 0;
        for (const needType of NEED_TYPES) {
          const rate = restores[needType as NeedType];
          if (rate) {
            personScore += urgency(person.needs[needType].value) * rate;
          }
        }
        totalScore += personScore;
      }

      let avgScore = occupantIds.length > 0 ? totalScore / occupantIds.length : 0;
      if (activity === lastActivity) {
        avgScore *= 0.3;
      }
      const noise = Math.random() * 0.15;

      // Determine destination building
      let buildingId: number;
      switch (activity) {
        case 'home':
          buildingId = driver.homeBuildingId;
          break;
        case 'work':
          buildingId = driver.workBuildingId;
          break;
        case 'shopping': {
          const shops = Array.from(population.shoppingBuildingIds);
          buildingId = shops.length > 0
            ? shops[Math.floor(Math.random() * shops.length)]
            : driver.workBuildingId;
          break;
        }
        case 'social': {
          // Random other household's building
          let targetBuildingId = driver.homeBuildingId;
          const households = Array.from(population.households.values());
          const otherHouseholds = households.filter(h => h.id !== driverHousehold?.id);
          if (otherHouseholds.length > 0) {
            targetBuildingId = otherHouseholds[Math.floor(Math.random() * otherHouseholds.length)].buildingId;
          }
          buildingId = targetBuildingId;
          break;
        }
      }

      options.push({
        activity,
        buildingId,
        score: avgScore + noise,
      });
    }

    // Sort descending by score
    options.sort((a, b) => b.score - a.score);
    return options;
  }

  pickNextTrip(
    occupantIds: number[],
    population: PopulationManager,
    driverPersonId: number,
    lastActivity: ActivityType | null = null
  ): { activity: ActivityType; buildingId: number; dwellTime: number } {
    const options = this.scoreActions(occupantIds, population, driverPersonId, lastActivity);
    const best = options[0] ?? { activity: 'home' as ActivityType, buildingId: 0 };
    const [min, max] = DWELL_RANGES[best.activity];
    return {
      activity: best.activity,
      buildingId: best.buildingId,
      dwellTime: randomRange(min, max),
    };
  }
}
