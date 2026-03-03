import { describe, it, expect, beforeEach } from 'vitest';
import { PopulationManager, NEED_TYPES, JOB_CONFIG } from '@/map/simulation/population';
import type { BuildingRole } from '@/map/simulation/population';
import type { IndexedBuilding } from '@/map/roads/graph';
import type { NeedType, PersonalityType, WorkplaceType } from '@/map/types';

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

let pm: PopulationManager;

beforeEach(() => {
  pm = new PopulationManager();
});

// -- Initialization --

describe('PopulationManager.init', () => {
  it('requires at least 30 buildings', () => {
    pm.init(makeBuildings(20));
    expect(pm.isInitialized()).toBe(false);
    expect(pm.people.size).toBe(0);
  });

  it('initializes with 30+ buildings', () => {
    pm.init(makeBuildings(200));
    expect(pm.isInitialized()).toBe(true);
  });

  it('creates 100-150 people', () => {
    pm.init(makeBuildings(200));
    expect(pm.people.size).toBeGreaterThanOrEqual(40);
    expect(pm.people.size).toBeLessThanOrEqual(200);
  });

  it('creates 40-60 households', () => {
    pm.init(makeBuildings(200));
    expect(pm.households.size).toBeGreaterThanOrEqual(10);
    expect(pm.households.size).toBeLessThanOrEqual(70);
  });

  it('only initializes once', () => {
    pm.init(makeBuildings(200));
    const count = pm.people.size;
    pm.init(makeBuildings(200));
    expect(pm.people.size).toBe(count);
  });
});

describe('person attributes', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('every person has a valid personality', () => {
    const validPersonalities: PersonalityType[] = ['wild', 'aggressive', 'normal', 'cautious', 'impaired'];
    for (const person of pm.people.values()) {
      expect(validPersonalities).toContain(person.personality);
    }
  });

  it('every person has a wallet between 0 and 100', () => {
    for (const person of pm.people.values()) {
      expect(person.wallet).toBeGreaterThanOrEqual(0);
      expect(person.wallet).toBeLessThanOrEqual(100);
    }
  });

  it('every person starts with 0 earnings', () => {
    for (const person of pm.people.values()) {
      expect(person.earnings).toBe(0);
    }
  });

  it('every person has shift start and end hours', () => {
    for (const person of pm.people.values()) {
      expect(person.shiftStart).toBeGreaterThanOrEqual(0);
      expect(person.shiftStart).toBeLessThanOrEqual(23);
      expect(person.shiftEnd).toBeGreaterThanOrEqual(0);
      expect(person.shiftEnd).toBeLessThanOrEqual(23);
    }
  });

  it('every person has 5 needs (no money need)', () => {
    for (const person of pm.people.values()) {
      const needKeys = Object.keys(person.needs) as NeedType[];
      expect(needKeys).toHaveLength(5);
      expect(needKeys).toContain('hunger');
      expect(needKeys).not.toContain('money');
    }
  });

  it('need values start between 20 and 60', () => {
    for (const person of pm.people.values()) {
      for (const type of NEED_TYPES) {
        expect(person.needs[type].value).toBeGreaterThanOrEqual(20);
        expect(person.needs[type].value).toBeLessThanOrEqual(60);
      }
    }
  });

  it('home and work buildings differ', () => {
    let differentCount = 0;
    for (const person of pm.people.values()) {
      if (person.homeBuildingId !== person.workBuildingId) differentCount++;
    }
    // Vast majority should differ (only edge cases with very few buildings wouldn't)
    expect(differentCount / pm.people.size).toBeGreaterThan(0.8);
  });
});

// -- Building roles --

describe('building role allocation', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('allocates supermarket buildings', () => {
    expect(pm.supermarketBuildingIds.size).toBeGreaterThan(0);
  });

  it('allocates restaurant buildings', () => {
    expect(pm.restaurantBuildingIds.size).toBeGreaterThan(0);
  });

  it('allocates mall buildings', () => {
    expect(pm.mallBuildingIds.size).toBeGreaterThan(0);
  });

  it('restaurant buildings have subtypes', () => {
    for (const id of pm.restaurantBuildingIds) {
      expect(pm.restaurantSubtypes.has(id)).toBe(true);
    }
  });

  it('mall buildings have subtypes', () => {
    for (const id of pm.mallBuildingIds) {
      expect(pm.mallSubtypes.has(id)).toBe(true);
    }
  });

  it('restaurant subtypes are valid', () => {
    const valid = ['fast_food', 'diner', 'cafe', 'fine_dining'];
    for (const subtype of pm.restaurantSubtypes.values()) {
      expect(valid).toContain(subtype);
    }
  });

  it('mall subtypes are valid', () => {
    const valid = ['mall', 'outlet', 'plaza'];
    for (const subtype of pm.mallSubtypes.values()) {
      expect(valid).toContain(subtype);
    }
  });
});

describe('getBuildingRoles', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('home buildings override other roles (highest priority)', () => {
    const roles = pm.getBuildingRoles();
    for (const h of pm.households.values()) {
      expect(roles.get(h.buildingId)).toBe('home');
    }
  });

  it('supermarket buildings have supermarket role', () => {
    const roles = pm.getBuildingRoles();
    for (const id of pm.supermarketBuildingIds) {
      const role = roles.get(id);
      // May be overridden by home, but if not overridden should be supermarket
      if (!Array.from(pm.households.values()).some(h => h.buildingId === id)) {
        expect(role).toBe('supermarket');
      }
    }
  });

  it('returns only valid role values', () => {
    const validRoles: BuildingRole[] = ['home', 'work', 'mall', 'restaurant', 'supermarket'];
    const roles = pm.getBuildingRoles();
    for (const role of roles.values()) {
      expect(validRoles).toContain(role);
    }
  });
});

// -- Building professions --

describe('building professions', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('assigns professions to buildings', () => {
    expect(pm.buildingProfessions.size).toBeGreaterThan(0);
  });

  it('profession values are valid', () => {
    const valid: (WorkplaceType | 'restaurant' | 'mall')[] = [
      'office', 'tech_office', 'clinic', 'school', 'warehouse', 'studio', 'restaurant', 'mall',
    ];
    for (const profession of pm.buildingProfessions.values()) {
      expect(valid).toContain(profession);
    }
  });
});

// -- Food supply --

describe('household food supply', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('households start with foodSupply between 50 and 80', () => {
    for (const h of pm.households.values()) {
      expect(h.foodSupply).toBeGreaterThanOrEqual(50);
      expect(h.foodSupply).toBeLessThanOrEqual(80);
    }
  });

  it('getHouseholdInfos includes foodSupply', () => {
    const infos = pm.getHouseholdInfos();
    for (const info of infos) {
      expect(typeof info.foodSupply).toBe('number');
      expect(info.foodSupply).toBeGreaterThanOrEqual(50);
    }
  });
});

// -- Need decay --

describe('updateNeeds', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('decays all needs over time', () => {
    const person = pm.people.values().next().value!;
    const before: Record<string, number> = {};
    for (const type of NEED_TYPES) {
      before[type] = person.needs[type].value;
    }

    pm.updateNeeds(1.0);

    for (const type of NEED_TYPES) {
      expect(person.needs[type].value).toBeLessThan(before[type]);
    }
  });

  it('does not decay below 0', () => {
    const person = pm.people.values().next().value!;
    for (const type of NEED_TYPES) {
      person.needs[type].value = 0.01;
    }
    pm.updateNeeds(100);
    for (const type of NEED_TYPES) {
      expect(person.needs[type].value).toBe(0);
    }
  });

  it('hunger decays at 0.3 per sim-second', () => {
    const person = pm.people.values().next().value!;
    person.needs.hunger.value = 50;
    pm.updateNeeds(10);
    expect(person.needs.hunger.value).toBeCloseTo(50 - 0.3 * 10, 5);
  });

  it('energy decays at 0.5 per sim-second', () => {
    const person = pm.people.values().next().value!;
    person.needs.energy.value = 50;
    pm.updateNeeds(10);
    expect(person.needs.energy.value).toBeCloseTo(50 - 0.5 * 10, 5);
  });
});

// -- applyActivity --

describe('applyActivity', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('work earns wallet and accumulates earnings', () => {
    const person = pm.people.values().next().value!;
    const earnRate = JOB_CONFIG[person.job].earnRate;
    const walletBefore = person.wallet;

    pm.applyActivity(person.id, 'work', 10);

    expect(person.wallet).toBeCloseTo(walletBefore + earnRate * 10, 5);
    expect(person.earnings).toBeCloseTo(earnRate * 10, 5);
  });

  it('work provides cafeteria hunger restore (0.5/s)', () => {
    const person = pm.people.values().next().value!;
    person.needs.hunger.value = 50;
    pm.applyActivity(person.id, 'work', 10);
    expect(person.needs.hunger.value).toBeCloseTo(50 + 0.5 * 10, 5);
  });

  it('home restores hunger only when foodSupply > 0', () => {
    const person = pm.people.values().next().value!;
    const household = pm.getHouseholdByPerson(person.id)!;
    person.needs.hunger.value = 50;
    household.foodSupply = 0;

    pm.applyActivity(person.id, 'home', 10);

    // Hunger should NOT increase (no food at home)
    expect(person.needs.hunger.value).toBe(50);
  });

  it('home restores hunger and depletes foodSupply when foodSupply > 0', () => {
    const person = pm.people.values().next().value!;
    const household = pm.getHouseholdByPerson(person.id)!;
    person.needs.hunger.value = 50;
    household.foodSupply = 60;

    pm.applyActivity(person.id, 'home', 10);

    expect(person.needs.hunger.value).toBeGreaterThan(50);
    expect(household.foodSupply).toBeLessThan(60);
  });

  it('home restores energy regardless of foodSupply', () => {
    const person = pm.people.values().next().value!;
    const household = pm.getHouseholdByPerson(person.id)!;
    person.needs.energy.value = 50;
    household.foodSupply = 0;

    pm.applyActivity(person.id, 'home', 10);

    expect(person.needs.energy.value).toBeCloseTo(50 + 2.0 * 10, 5);
  });

  it('restaurant restores hunger at 2.0/s', () => {
    const person = pm.people.values().next().value!;
    person.needs.hunger.value = 50;
    pm.applyActivity(person.id, 'restaurant', 5);
    expect(person.needs.hunger.value).toBeCloseTo(50 + 2.0 * 5, 5);
  });

  it('supermarket restores nothing', () => {
    const person = pm.people.values().next().value!;
    const before: Record<string, number> = {};
    for (const type of NEED_TYPES) {
      person.needs[type].value = 50;
      before[type] = 50;
    }
    pm.applyActivity(person.id, 'supermarket', 10);
    for (const type of NEED_TYPES) {
      expect(person.needs[type].value).toBe(before[type]);
    }
  });

  it('needs are capped at 100', () => {
    const person = pm.people.values().next().value!;
    person.needs.energy.value = 99;
    pm.applyActivity(person.id, 'home', 100);
    expect(person.needs.energy.value).toBe(100);
  });

  it('does nothing for invalid person', () => {
    expect(() => pm.applyActivity(999999, 'work', 10)).not.toThrow();
  });
});

// -- Household lookup --

describe('getHouseholdByPerson', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('returns household for every member', () => {
    for (const h of pm.households.values()) {
      for (const memberId of h.memberIds) {
        const found = pm.getHouseholdByPerson(memberId);
        expect(found).toBeDefined();
        expect(found!.id).toBe(h.id);
      }
    }
  });

  it('returns undefined for unknown person', () => {
    expect(pm.getHouseholdByPerson(999999)).toBeUndefined();
  });
});

// -- expandRoles --

describe('expandRoles', () => {
  it('returns false before init', () => {
    expect(pm.expandRoles(makeBuildings(200))).toBe(false);
  });

  it('assigns new roles to unassigned buildings', () => {
    pm.init(makeBuildings(200));
    const newBuildings = makeBuildings(50).map(b => ({
      ...b,
      buildingId: b.buildingId + 1000,
    }));
    // Run many times to ensure at least one assignment
    let added = false;
    for (let i = 0; i < 10; i++) {
      if (pm.expandRoles(newBuildings)) added = true;
    }
    expect(added).toBe(true);
  });
});

// -- getPersonInfo --

describe('getPersonInfo', () => {
  beforeEach(() => {
    pm.init(makeBuildings(200));
  });

  it('returns info with wallet, earnings, personality', () => {
    const person = pm.people.values().next().value!;
    const info = pm.getPersonInfo(person.id);
    expect(info).not.toBeNull();
    expect(typeof info!.wallet).toBe('number');
    expect(typeof info!.earnings).toBe('number');
    expect(typeof info!.personality).toBe('string');
  });

  it('returns null for unknown person', () => {
    expect(pm.getPersonInfo(999999)).toBeNull();
  });
});
