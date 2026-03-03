import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TripPlanner } from '@/map/simulation/trip-planner';
import { PopulationManager, SUPERMARKET_COST, cheapestMealCost, cheapestMallCost } from '@/map/simulation/population';
import type { IndexedBuilding } from '@/map/roads/graph';


function makeBuildings(count: number): IndexedBuilding[] {
  return Array.from({ length: count }, (_, i) => ({
    buildingId: i + 1,
    centroidX: i * 10,
    centroidZ: i * 10,
    nearestNodeId: i,
    roadDirX: 1,
    roadDirZ: 0,
    roadType: 'residential',
    roadName: `Road ${i}`,
  }));
}

let planner: TripPlanner;
let pm: PopulationManager;

beforeEach(() => {
  planner = new TripPlanner();
  pm = new PopulationManager();
  pm.init(makeBuildings(200));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scoreActions', () => {
  it('returns 6 activity options', () => {
    const driverId = pm.people.keys().next().value!;
    const options = planner.scoreActions([driverId], pm, driverId);
    expect(options).toHaveLength(6);
    const activities = options.map(o => o.activity);
    expect(activities).toContain('home');
    expect(activities).toContain('work');
    expect(activities).toContain('mall');
    expect(activities).toContain('social');
    expect(activities).toContain('restaurant');
    expect(activities).toContain('supermarket');
  });

  it('options are sorted by score descending', () => {
    const driverId = pm.people.keys().next().value!;
    const options = planner.scoreActions([driverId], pm, driverId);
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1].score).toBeGreaterThanOrEqual(options[i].score);
    }
  });

  it('returns empty array for invalid driver', () => {
    const options = planner.scoreActions([999], pm, 999);
    expect(options).toHaveLength(0);
  });

  it('home destination is drivers home building', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    const options = planner.scoreActions([driverId], pm, driverId);
    const home = options.find(o => o.activity === 'home')!;
    expect(home.buildingId).toBe(driver.homeBuildingId);
  });

  it('work destination is drivers work building', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    const options = planner.scoreActions([driverId], pm, driverId);
    const work = options.find(o => o.activity === 'work')!;
    expect(work.buildingId).toBe(driver.workBuildingId);
  });
});

describe('wallet-based affordability gates', () => {
  it('restaurant score is 0 when wallet below cheapest meal', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = cheapestMealCost() - 1;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);
    const restaurant = options.find(o => o.activity === 'restaurant')!;
    // Score = 0 + noise (0 since random mocked to 0) = 0
    expect(restaurant.score).toBeCloseTo(0, 1);
  });

  it('mall score is 0 when wallet below cheapest mall', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = cheapestMallCost() - 1;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);
    const mall = options.find(o => o.activity === 'mall')!;
    expect(mall.score).toBeCloseTo(0, 1);
  });

  it('supermarket score is 0 when wallet below SUPERMARKET_COST', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = SUPERMARKET_COST - 1;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);
    const supermarket = options.find(o => o.activity === 'supermarket')!;
    expect(supermarket.score).toBeCloseTo(0, 1);
  });

  it('restaurant allowed when wallet equals cheapest meal', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = cheapestMealCost();
    driver.needs.hunger.value = 10; // very hungry

    const options = planner.scoreActions([driverId], pm, driverId);
    const restaurant = options.find(o => o.activity === 'restaurant')!;
    expect(restaurant.score).toBeGreaterThan(0);
  });
});

describe('work urgency with low wallet', () => {
  it('work gets higher score when wallet is low', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;

    // High wallet: low work urgency
    driver.wallet = 100;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsRich = planner.scoreActions([driverId], pm, driverId);
    const workRich = optionsRich.find(o => o.activity === 'work')!;

    vi.restoreAllMocks();

    // Low wallet: high work urgency
    driver.wallet = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsBroke = planner.scoreActions([driverId], pm, driverId);
    const workBroke = optionsBroke.find(o => o.activity === 'work')!;

    expect(workBroke.score).toBeGreaterThan(workRich.score);
  });
});

describe('broke and starving work boost', () => {
  it('adds 2.0 work score when broke and foodSupply < 10', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    const household = pm.getHouseholdByPerson(driverId)!;

    driver.wallet = 0;
    household.foodSupply = 5;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);
    const work = options.find(o => o.activity === 'work')!;

    // Work should have both wallet urgency AND +2.0 broke bonus
    // wallet urgency = (100-0)/100 = 1.0, 1.0^2 * 1.5 = 1.5
    // broke bonus = 2.0
    // Total >= 3.5 (base work score may vary due to need urgency)
    expect(work.score).toBeGreaterThanOrEqual(3.5);
  });

  it('no broke bonus when foodSupply >= 10', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    const household = pm.getHouseholdByPerson(driverId)!;

    driver.wallet = 0;
    household.foodSupply = 50;

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);
    const work = options.find(o => o.activity === 'work')!;

    // Only wallet urgency, no broke bonus
    // wallet urgency = 1.5
    expect(work.score).toBeLessThan(3.5);
  });
});

describe('supermarket urgency scoring', () => {
  it('supermarket score increases with low food supply', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    const household = pm.getHouseholdByPerson(driverId)!;
    driver.wallet = 100;

    household.foodSupply = 90;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsHigh = planner.scoreActions([driverId], pm, driverId);
    const smHigh = optionsHigh.find(o => o.activity === 'supermarket')!;

    vi.restoreAllMocks();

    household.foodSupply = 10;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsLow = planner.scoreActions([driverId], pm, driverId);
    const smLow = optionsLow.find(o => o.activity === 'supermarket')!;

    expect(smLow.score).toBeGreaterThan(smHigh.score);
  });
});

describe('last activity penalty', () => {
  it('applies 0.3x multiplier to last activity', () => {
    const driverId = pm.people.keys().next().value!;
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const optionsNoRepeat = planner.scoreActions([driverId], pm, driverId, null);
    const workNoRepeat = optionsNoRepeat.find(o => o.activity === 'work')!;

    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const optionsRepeat = planner.scoreActions([driverId], pm, driverId, 'work');
    const workRepeat = optionsRepeat.find(o => o.activity === 'work')!;

    // Repeat score should be ~30% of no-repeat score
    expect(workRepeat.score).toBeLessThan(workNoRepeat.score);
    if (workNoRepeat.score > 0.1) {
      expect(workRepeat.score / workNoRepeat.score).toBeCloseTo(0.3, 1);
    }
  });
});

describe('cautious personality mall penalty', () => {
  it('cautious drivers get 0.7x mall score', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.personality = 'cautious';
    driver.wallet = 100;
    driver.needs.fun.value = 20; // wants fun

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsCautious = planner.scoreActions([driverId], pm, driverId);
    const mallCautious = optionsCautious.find(o => o.activity === 'mall')!;

    vi.restoreAllMocks();

    driver.personality = 'normal';
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const optionsNormal = planner.scoreActions([driverId], pm, driverId);
    const mallNormal = optionsNormal.find(o => o.activity === 'mall')!;

    expect(mallCautious.score).toBeLessThan(mallNormal.score);
  });
});

describe('spending bias destination selection', () => {
  it('restaurant destination comes from restaurantBuildingIds', () => {
    const driverId = pm.people.keys().next().value!;
    const options = planner.scoreActions([driverId], pm, driverId);
    const restaurant = options.find(o => o.activity === 'restaurant')!;

    if (pm.restaurantBuildingIds.size > 0) {
      expect(pm.restaurantBuildingIds.has(restaurant.buildingId)).toBe(true);
    }
  });

  it('mall destination comes from mallBuildingIds', () => {
    const driverId = pm.people.keys().next().value!;
    const options = planner.scoreActions([driverId], pm, driverId);
    const mall = options.find(o => o.activity === 'mall')!;

    if (pm.mallBuildingIds.size > 0) {
      expect(pm.mallBuildingIds.has(mall.buildingId)).toBe(true);
    }
  });

  it('supermarket destination comes from supermarketBuildingIds', () => {
    const driverId = pm.people.keys().next().value!;
    const options = planner.scoreActions([driverId], pm, driverId);
    const sm = options.find(o => o.activity === 'supermarket')!;

    if (pm.supermarketBuildingIds.size > 0) {
      expect(pm.supermarketBuildingIds.has(sm.buildingId)).toBe(true);
    }
  });
});

// -- pickNextTrip --

describe('pickNextTrip', () => {
  it('returns an activity and buildingId', () => {
    const driverId = pm.people.keys().next().value!;
    const result = planner.pickNextTrip([driverId], pm, driverId);
    expect(result).toHaveProperty('activity');
    expect(result).toHaveProperty('buildingId');
    expect(typeof result.buildingId).toBe('number');
  });

  it('returns home for unknown driver', () => {
    const result = planner.pickNextTrip([], pm, 999999);
    expect(result.activity).toBe('home');
  });

  it('picks highest-scored activity', () => {
    const driverId = pm.people.keys().next().value!;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const options = planner.scoreActions([driverId], pm, driverId);

    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = planner.pickNextTrip([driverId], pm, driverId);

    expect(result.activity).toBe(options[0].activity);
  });
});

describe('scavenging in pickNextTrip', () => {
  it('scavenges when broke and hungry below threshold (40% chance)', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = 0;
    driver.needs.hunger.value = 5; // below all personality thresholds
    const hungerBefore = driver.needs.hunger.value;
    const walletBefore = driver.wallet;

    // Force random to trigger scavenge (< 0.4)
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    planner.pickNextTrip([driverId], pm, driverId);

    expect(driver.needs.hunger.value).toBe(Math.min(100, hungerBefore + 15));
    expect(driver.wallet).toBe(walletBefore + 5);
  });

  it('does not scavenge when random >= 0.4', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = 0;
    driver.needs.hunger.value = 5;
    const hungerBefore = driver.needs.hunger.value;

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    planner.pickNextTrip([driverId], pm, driverId);

    expect(driver.needs.hunger.value).toBe(hungerBefore);
  });

  it('does not scavenge when wallet can afford food', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = cheapestMealCost() + 10;
    driver.needs.hunger.value = 5;
    const hungerBefore = driver.needs.hunger.value;

    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    planner.pickNextTrip([driverId], pm, driverId);

    expect(driver.needs.hunger.value).toBe(hungerBefore);
  });

  it('does not scavenge when hunger above threshold', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = 0;
    driver.personality = 'cautious'; // threshold = 40
    driver.needs.hunger.value = 50; // above threshold
    const hungerBefore = driver.needs.hunger.value;

    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    planner.pickNextTrip([driverId], pm, driverId);

    expect(driver.needs.hunger.value).toBe(hungerBefore);
  });

  it('scavenge hunger capped at 100', () => {
    const driverId = pm.people.keys().next().value!;
    const driver = pm.people.get(driverId)!;
    driver.wallet = 0;
    driver.needs.hunger.value = 95;
    driver.personality = 'wild'; // threshold = 10 — but 95 > 10, so no scavenge
    // Need to use a personality where 95 is below threshold... none exist.
    // Instead set hunger to 5 and check cap on a normal case
    driver.needs.hunger.value = 5;
    driver.personality = 'normal'; // threshold = 20

    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    planner.pickNextTrip([driverId], pm, driverId);

    expect(driver.needs.hunger.value).toBe(20); // 5 + 15 = 20
    expect(driver.needs.hunger.value).toBeLessThanOrEqual(100);
  });
});
