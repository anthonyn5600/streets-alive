import type { ActivityType, NeedType } from '../types';
import type { PopulationManager } from './population';
import { ACTIVITY_RESTORE, NEED_TYPES, SUPERMARKET_COST, RESTAURANT_COSTS, MALL_COSTS, PERSONALITY_CONFIG, cheapestMealCost, cheapestMallCost } from './population';

interface ActionOption {
  activity: ActivityType;
  buildingId: number;
  score: number;
}

function urgency(value: number): number {
  const deficit = (100 - value) / 100;
  return deficit * deficit;
}

export class TripPlanner {
  scoreActions(
    occupantIds: number[],
    population: PopulationManager,
    driverPersonId: number,
    lastActivity: ActivityType | null = null
  ): ActionOption[] {
    const options: ActionOption[] = [];
    const activities: ActivityType[] = ['home', 'work', 'mall', 'social', 'restaurant', 'supermarket'];

    const driver = population.people.get(driverPersonId);
    if (!driver) return options;
    const driverHousehold = population.getHouseholdByPerson(driverPersonId);

    for (const activity of activities) {
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

      // Supermarket urgency based on household food supply
      if (activity === 'supermarket' && driverHousehold) {
        const supplyDeficit = (100 - driverHousehold.foodSupply) / 100;
        avgScore += supplyDeficit * supplyDeficit * 1.5;
      }

      // Wallet-based scoring adjustments
      if (activity === 'work') {
        const walletLevel = Math.min(driver.wallet, 100);
        avgScore += urgency(walletLevel) * 1.5;
      } else if (activity === 'restaurant' && driver.wallet < cheapestMealCost()) {
        avgScore = 0;
      } else if (activity === 'mall' && driver.wallet < cheapestMallCost()) {
        avgScore = 0;
      } else if (activity === 'supermarket' && driver.wallet < SUPERMARKET_COST) {
        avgScore = 0;
      }

      // Broke and no food at home: strongly prefer work to earn money
      if (activity === 'work' && driverHousehold) {
        const cantAffordFood = driver.wallet < cheapestMealCost() && driver.wallet < SUPERMARKET_COST;
        if (cantAffordFood && driverHousehold.foodSupply < 10) {
          avgScore += 2.0;
        }
      }

      // Cautious personality avoids unnecessary mall spending
      if (activity === 'mall' && driver.personality === 'cautious') {
        avgScore *= 0.7;
      }

      if (activity === lastActivity) {
        avgScore *= 0.3;
      }
      const noise = Math.random() * 0.15;

      let buildingId: number;
      const bias = PERSONALITY_CONFIG[driver.personality].spendingBias;

      switch (activity) {
        case 'home':
          buildingId = driver.homeBuildingId;
          break;
        case 'work':
          buildingId = driver.workBuildingId;
          break;
        case 'mall': {
          const malls = Array.from(population.mallBuildingIds);
          if (malls.length === 0) { buildingId = driver.workBuildingId; break; }
          const sorted = malls
            .map(id => ({ id, cost: MALL_COSTS[population.mallSubtypes.get(id) ?? 'mall'] }))
            .sort((a, b) => a.cost - b.cost);
          const idx = Math.min(sorted.length - 1, Math.floor(bias * sorted.length));
          buildingId = sorted[idx].id;
          break;
        }
        case 'restaurant': {
          const restaurants = Array.from(population.restaurantBuildingIds);
          if (restaurants.length === 0) { buildingId = driver.workBuildingId; break; }
          const sorted = restaurants
            .map(id => ({ id, cost: RESTAURANT_COSTS[population.restaurantSubtypes.get(id) ?? 'fast_food'] }))
            .sort((a, b) => a.cost - b.cost);
          const idx = Math.min(sorted.length - 1, Math.floor(bias * sorted.length));
          buildingId = sorted[idx].id;
          break;
        }
        case 'supermarket': {
          const markets = Array.from(population.supermarketBuildingIds);
          buildingId = markets.length > 0
            ? markets[Math.floor(Math.random() * markets.length)]
            : driver.workBuildingId;
          break;
        }
        case 'social': {
          let targetBuildingId = driver.homeBuildingId;
          const households = Array.from(population.households.values());
          const otherHouseholds = households.filter(h => h.id !== driverHousehold?.id);
          if (otherHouseholds.length > 0) {
            targetBuildingId = otherHouseholds[Math.floor(Math.random() * otherHouseholds.length)].buildingId;
          } else {
            // Only 1 household: visit a restaurant or mall instead of own home
            const fallbacks = [...Array.from(population.restaurantBuildingIds), ...Array.from(population.mallBuildingIds)];
            if (fallbacks.length > 0) {
              targetBuildingId = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }
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

    options.sort((a, b) => b.score - a.score);
    return options;
  }

  pickNextTrip(
    occupantIds: number[],
    population: PopulationManager,
    driverPersonId: number,
    lastActivity: ActivityType | null = null
  ): { activity: ActivityType; buildingId: number } {
    const driver = population.people.get(driverPersonId);

    // Scavenge check: broke and hungry
    if (driver) {
      const threshold = PERSONALITY_CONFIG[driver.personality].hungerThreshold;
      if (driver.wallet < cheapestMealCost() && driver.needs.hunger.value < threshold) {
        if (Math.random() < 0.4) {
          driver.needs.hunger.value = Math.min(100, driver.needs.hunger.value + 15);
          driver.wallet += 5;
        }
      }
    }

    const options = this.scoreActions(occupantIds, population, driverPersonId, lastActivity);
    const best = options[0] ?? { activity: 'home' as ActivityType, buildingId: 0 };
    return {
      activity: best.activity,
      buildingId: best.buildingId,
    };
  }
}
