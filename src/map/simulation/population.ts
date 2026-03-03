import type { NeedType, ActivityType, JobType, Person, Need, Household, PersonInfo, PersonLocation, HouseholdInfo, PersonalityType, WorkplaceType, RestaurantSubtype, MallSubtype } from '../types';
import type { IndexedBuilding } from '../roads/graph';

export type BuildingRole = 'home' | 'work' | 'mall' | 'restaurant' | 'supermarket';

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Dorothy', 'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna',
  'Kenneth', 'Michelle', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Timothy', 'Deborah',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts',
];

const JOBS: JobType[] = [
  'Office Worker', 'Retail', 'Restaurant', 'Healthcare',
  'Teacher', 'Construction', 'Tech', 'Artist',
];

const NEED_DECAY: Record<NeedType, number> = {
  energy: 0.5,
  hunger: 0.3,
  social: 0.3,
  fun: 0.3,
  health: 0.05,
};

const ACTIVITY_RESTORE: Record<ActivityType, Partial<Record<NeedType, number>>> = {
  home: { energy: 2.0, health: 0.5, hunger: 1.5 },
  work: { hunger: 0.5 },
  mall: { fun: 1.5 },
  social: { social: 1.5, fun: 1.0 },
  restaurant: { hunger: 2.0 },
  supermarket: {},
};

const NEED_TYPES: NeedType[] = ['energy', 'hunger', 'social', 'fun', 'health'];

const RESTAURANT_COSTS: Record<RestaurantSubtype, number> = {
  fast_food: 8, diner: 15, cafe: 12, fine_dining: 30,
};

const MALL_COSTS: Record<MallSubtype, number> = {
  mall: 25, outlet: 15, plaza: 10,
};

const SUPERMARKET_COST = 20;

const RESTAURANT_SUBTYPES: RestaurantSubtype[] = ['fast_food', 'diner', 'cafe', 'fine_dining'];
const MALL_SUBTYPES: MallSubtype[] = ['mall', 'outlet', 'plaza'];

function cheapestMealCost(): number {
  return Math.min(...Object.values(RESTAURANT_COSTS));
}

function cheapestMallCost(): number {
  return Math.min(...Object.values(MALL_COSTS));
}

const JOB_CONFIG: Record<JobType, { workplaceType: WorkplaceType | 'restaurant' | 'mall'; earnRate: number }> = {
  'Office Worker': { workplaceType: 'office',      earnRate: 3.5 },
  'Tech':          { workplaceType: 'tech_office',  earnRate: 5.0 },
  'Healthcare':    { workplaceType: 'clinic',       earnRate: 4.5 },
  'Teacher':       { workplaceType: 'school',       earnRate: 2.5 },
  'Construction':  { workplaceType: 'warehouse',    earnRate: 3.0 },
  'Artist':        { workplaceType: 'studio',       earnRate: 2.0 },
  'Restaurant':    { workplaceType: 'restaurant',   earnRate: 1.0 },
  'Retail':        { workplaceType: 'mall',         earnRate: 1.5 },
};

const PERSONALITY_WEIGHTS: { type: PersonalityType; weight: number }[] = [
  { type: 'wild', weight: 10 },
  { type: 'aggressive', weight: 15 },
  { type: 'normal', weight: 50 },
  { type: 'cautious', weight: 20 },
  { type: 'impaired', weight: 5 },
];

const PERSONALITY_TOTAL_WEIGHT = PERSONALITY_WEIGHTS.reduce((s, p) => s + p.weight, 0);

const PERSONALITY_CONFIG: Record<PersonalityType, {
  speedMult: number;
  spendingBias: number;
  hungerThreshold: number;
}> = {
  wild:       { speedMult: 2.0, spendingBias: 1.0, hungerThreshold: 10 },
  aggressive: { speedMult: 1.5, spendingBias: 0.7, hungerThreshold: 20 },
  normal:     { speedMult: 1.0, spendingBias: 0.5, hungerThreshold: 20 },
  cautious:   { speedMult: 0.8, spendingBias: 0.1, hungerThreshold: 40 },
  impaired:   { speedMult: 0.4, spendingBias: 0.5, hungerThreshold: 10 },
};

const WORKPLACE_COLORS: Record<WorkplaceType, number> = {
  office:      0x64B5F6,
  tech_office: 0x42A5F5,
  clinic:      0x80DEEA,
  school:      0x7986CB,
  warehouse:   0x78909C,
  studio:      0x9FA8DA,
};

let nextPersonId = 1;
let nextHouseholdId = 1;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPersonality(): PersonalityType {
  let roll = Math.random() * PERSONALITY_TOTAL_WEIGHT;
  for (const p of PERSONALITY_WEIGHTS) {
    roll -= p.weight;
    if (roll <= 0) return p.type;
  }
  return 'normal';
}

function randomShift(): { start: number; end: number } {
  const shifts = [
    { start: 8, end: 17, weight: 60 },
    { start: 6, end: 14, weight: 15 },
    { start: 14, end: 22, weight: 15 },
    { start: 22, end: 6, weight: 10 },
  ];
  const total = shifts.reduce((s, sh) => s + sh.weight, 0);
  let roll = Math.random() * total;
  for (const sh of shifts) {
    roll -= sh.weight;
    if (roll <= 0) return { start: sh.start, end: sh.end };
  }
  return { start: 8, end: 17 };
}

function createNeeds(): Record<NeedType, Need> {
  const needs = {} as Record<NeedType, Need>;
  for (const type of NEED_TYPES) {
    needs[type] = {
      value: randomRange(20, 60),
      decayRate: NEED_DECAY[type],
    };
  }
  return needs;
}

export class PopulationManager {
  people = new Map<number, Person>();
  households = new Map<number, Household>();
  mallBuildingIds = new Set<number>();
  restaurantBuildingIds = new Set<number>();
  supermarketBuildingIds = new Set<number>();
  restaurantSubtypes = new Map<number, RestaurantSubtype>();
  mallSubtypes = new Map<number, MallSubtype>();
  buildingProfessions = new Map<number, WorkplaceType | 'restaurant' | 'mall'>();
  expandedWorkBuildingIds = new Set<number>();
  private personToHousehold = new Map<number, number>();
  private initialized = false;

  init(buildings: IndexedBuilding[]): void {
    if (this.initialized || buildings.length < 30) return;
    this.initialized = true;

    const buildingIds = buildings.map(b => b.buildingId);
    const numHouseholds = Math.floor(randomRange(40, 60));
    const targetPeople = Math.floor(randomRange(100, 150));

    // Distribute people across households
    const householdSizes: number[] = [];
    let totalPeople = 0;
    for (let i = 0; i < numHouseholds; i++) {
      const size = totalPeople + 4 <= targetPeople
        ? Math.floor(randomRange(1, 4.99))
        : Math.max(1, Math.min(4, targetPeople - totalPeople));
      if (totalPeople >= targetPeople) break;
      householdSizes.push(size);
      totalPeople += size;
    }

    for (let h = 0; h < householdSizes.length; h++) {
      const householdBuildingId = randomPick(buildingIds);
      const householdId = nextHouseholdId++;
      const memberIds: number[] = [];

      for (let m = 0; m < householdSizes[h]; m++) {
        const personId = nextPersonId++;
        const firstName = randomPick(FIRST_NAMES);
        const lastName = randomPick(LAST_NAMES);

        // Pick a workplace different from home
        let workBuildingId = randomPick(buildingIds);
        let attempts = 0;
        while (workBuildingId === householdBuildingId && attempts < 10) {
          workBuildingId = randomPick(buildingIds);
          attempts++;
        }

        const shift = randomShift();
        const person: Person = {
          id: personId,
          name: `${firstName} ${lastName}`,
          job: randomPick(JOBS),
          needs: createNeeds(),
          homeBuildingId: householdBuildingId,
          workBuildingId,
          location: { type: 'home', buildingId: householdBuildingId },
          wallet: randomRange(30, 80),
          earnings: 0,
          personality: randomPersonality(),
          shiftStart: shift.start,
          shiftEnd: shift.end,
        };

        this.people.set(personId, person);
        memberIds.push(personId);
        this.personToHousehold.set(personId, householdId);
      }

      const household: Household = {
        id: householdId,
        buildingId: householdBuildingId,
        memberIds,
        carActive: false,
        foodSupply: Math.floor(randomRange(50, 80)),
      };
      this.households.set(householdId, household);
    }

    // Allocate commercial buildings (not homes or workplaces)
    const usedBuildings = new Set<number>();
    for (const h of this.households.values()) usedBuildings.add(h.buildingId);
    for (const p of this.people.values()) usedBuildings.add(p.workBuildingId);
    const candidates = buildingIds.filter(id => !usedBuildings.has(id)).sort(() => Math.random() - 0.5);

    const supermarketCount = Math.floor(randomRange(10, 16));
    const restaurantCount = Math.floor(randomRange(15, 26));
    const mallCount = Math.floor(randomRange(5, 8));
    let ci = 0;

    for (let i = 0; i < supermarketCount && ci < candidates.length; i++, ci++) {
      this.supermarketBuildingIds.add(candidates[ci]);
    }
    for (let i = 0; i < restaurantCount && ci < candidates.length; i++, ci++) {
      const id = candidates[ci];
      this.restaurantBuildingIds.add(id);
      this.restaurantSubtypes.set(id, randomPick(RESTAURANT_SUBTYPES));
    }
    for (let i = 0; i < mallCount && ci < candidates.length; i++, ci++) {
      const id = candidates[ci];
      this.mallBuildingIds.add(id);
      this.mallSubtypes.set(id, randomPick(MALL_SUBTYPES));
    }

    // If not enough unique candidates, backfill from all unused buildings
    if (ci < supermarketCount + restaurantCount + mallCount) {
      for (const id of buildingIds) {
        if (usedBuildings.has(id)) continue;
        if (this.supermarketBuildingIds.has(id) || this.restaurantBuildingIds.has(id) || this.mallBuildingIds.has(id)) continue;
        if (this.supermarketBuildingIds.size < supermarketCount) {
          this.supermarketBuildingIds.add(id);
        } else if (this.restaurantBuildingIds.size < restaurantCount) {
          this.restaurantBuildingIds.add(id);
          this.restaurantSubtypes.set(id, randomPick(RESTAURANT_SUBTYPES));
        } else if (this.mallBuildingIds.size < mallCount) {
          this.mallBuildingIds.add(id);
          this.mallSubtypes.set(id, randomPick(MALL_SUBTYPES));
        } else {
          break;
        }
      }
    }

    // Second pass: match workers to profession-appropriate buildings
    const workersByType = new Map<WorkplaceType | 'restaurant' | 'mall', Person[]>();
    for (const person of this.people.values()) {
      const wt = JOB_CONFIG[person.job].workplaceType;
      let group = workersByType.get(wt);
      if (!group) { group = []; workersByType.set(wt, group); }
      group.push(person);
    }

    // Restaurant workers → work at restaurant buildings
    const restaurantWorkers = workersByType.get('restaurant') ?? [];
    const restaurantArr = Array.from(this.restaurantBuildingIds);
    for (let i = 0; i < restaurantWorkers.length; i++) {
      if (restaurantArr.length > 0) {
        const worker = restaurantWorkers[i];
        let picked = restaurantArr[i % restaurantArr.length];
        if (picked === worker.homeBuildingId && restaurantArr.length > 1) {
          picked = restaurantArr[(i + 1) % restaurantArr.length];
        }
        worker.workBuildingId = picked;
      }
    }
    for (const id of restaurantArr) this.buildingProfessions.set(id, 'restaurant');

    // Retail workers → work at mall buildings
    const mallWorkers = workersByType.get('mall') ?? [];
    const mallArr = Array.from(this.mallBuildingIds);
    for (let i = 0; i < mallWorkers.length; i++) {
      if (mallArr.length > 0) {
        const worker = mallWorkers[i];
        let picked = mallArr[i % mallArr.length];
        if (picked === worker.homeBuildingId && mallArr.length > 1) {
          picked = mallArr[(i + 1) % mallArr.length];
        }
        worker.workBuildingId = picked;
      }
    }
    for (const id of mallArr) this.buildingProfessions.set(id, 'mall');

    // Other profession types → allocate dedicated work buildings
    const professionCandidates = buildingIds.filter(id =>
      !this.supermarketBuildingIds.has(id) &&
      !this.restaurantBuildingIds.has(id) &&
      !this.mallBuildingIds.has(id)
    ).sort(() => Math.random() - 0.5);

    let pci = 0;
    const workplaceTypes: WorkplaceType[] = ['office', 'tech_office', 'clinic', 'school', 'warehouse', 'studio'];
    for (const wt of workplaceTypes) {
      const workers = workersByType.get(wt) ?? [];
      if (workers.length === 0) continue;
      const count = Math.min(Math.floor(randomRange(3, 6)), Math.max(professionCandidates.length - pci, 1));
      const allocated: number[] = [];
      for (let i = 0; i < count && pci < professionCandidates.length; i++, pci++) {
        allocated.push(professionCandidates[pci]);
        this.buildingProfessions.set(professionCandidates[pci], wt);
      }
      if (allocated.length > 0) {
        for (let i = 0; i < workers.length; i++) {
          let picked = allocated[i % allocated.length];
          if (picked === workers[i].homeBuildingId && allocated.length > 1) {
            picked = allocated[(i + 1) % allocated.length];
          }
          workers[i].workBuildingId = picked;
        }
      }
    }
  }

  expandRoles(buildings: IndexedBuilding[]): boolean {
    if (!this.initialized) return false;
    const existingRoles = this.getBuildingRoles();
    const candidates = buildings.filter(b => !existingRoles.has(b.buildingId) && b.roadName !== '');
    if (candidates.length === 0) return false;

    let added = false;
    const MAX_RESTAURANTS = 40;
    const MAX_SUPERMARKETS = 20;
    const MAX_MALLS = 10;
    for (const b of candidates) {
      const roll = Math.random();
      if (roll < 0.20) {
        this.expandedWorkBuildingIds.add(b.buildingId);
        added = true;
      } else if (roll < 0.35 && this.restaurantBuildingIds.size < MAX_RESTAURANTS) {
        this.restaurantBuildingIds.add(b.buildingId);
        this.restaurantSubtypes.set(b.buildingId, randomPick(RESTAURANT_SUBTYPES));
        added = true;
      } else if (roll < 0.45 && this.supermarketBuildingIds.size < MAX_SUPERMARKETS) {
        this.supermarketBuildingIds.add(b.buildingId);
        added = true;
      } else if (roll < 0.48 && this.mallBuildingIds.size < MAX_MALLS) {
        this.mallBuildingIds.add(b.buildingId);
        this.mallSubtypes.set(b.buildingId, randomPick(MALL_SUBTYPES));
        added = true;
      }
    }
    return added;
  }

  getBuildingRoles(): Map<number, BuildingRole> {
    const roles = new Map<number, BuildingRole>();
    // Work buildings (lowest priority)
    for (const p of this.people.values()) {
      roles.set(p.workBuildingId, 'work');
    }
    // Expanded work buildings
    for (const id of this.expandedWorkBuildingIds) {
      roles.set(id, 'work');
    }
    // Supermarket buildings
    for (const id of this.supermarketBuildingIds) {
      roles.set(id, 'supermarket');
    }
    // Restaurant buildings
    for (const id of this.restaurantBuildingIds) {
      roles.set(id, 'restaurant');
    }
    // Mall buildings
    for (const id of this.mallBuildingIds) {
      roles.set(id, 'mall');
    }
    // Home buildings (highest priority)
    for (const h of this.households.values()) {
      roles.set(h.buildingId, 'home');
    }
    return roles;
  }

  getBuildingColors(): Map<number, number> {
    const colors = new Map<number, number>();
    // Role-based base colors
    for (const h of this.households.values()) colors.set(h.buildingId, 0x8BC34A);
    for (const id of this.mallBuildingIds) colors.set(id, 0xFFB74D);
    for (const id of this.restaurantBuildingIds) colors.set(id, 0xE57373);
    for (const id of this.supermarketBuildingIds) colors.set(id, 0xAED581);
    // Profession-specific blues for work buildings
    for (const [id, profession] of this.buildingProfessions) {
      if (profession !== 'restaurant' && profession !== 'mall') {
        colors.set(id, WORKPLACE_COLORS[profession]);
      }
    }
    // Default blue for work buildings without a profession entry
    for (const p of this.people.values()) {
      if (!colors.has(p.workBuildingId)) {
        colors.set(p.workBuildingId, 0x64B5F6);
      }
    }
    for (const id of this.expandedWorkBuildingIds) {
      if (!colors.has(id)) colors.set(id, 0x64B5F6);
    }
    return colors;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  updateNeeds(deltaTime: number): void {
    for (const person of this.people.values()) {
      for (const type of NEED_TYPES) {
        const need = person.needs[type];
        need.value = Math.max(0, need.value - need.decayRate * deltaTime);
      }
    }
  }

  applyActivity(personId: number, activity: ActivityType, deltaTime: number): void {
    const person = this.people.get(personId);
    if (!person) return;
    const restores = ACTIVITY_RESTORE[activity];
    for (const [needType, rate] of Object.entries(restores) as [NeedType, number][]) {
      if (activity === 'home' && needType === 'hunger') {
        const household = this.getHouseholdByPerson(personId);
        if (!household || household.foodSupply <= 0) continue;
        household.foodSupply = Math.max(0, household.foodSupply - 0.03 * deltaTime / household.memberIds.length);
      }
      person.needs[needType].value = Math.min(100, person.needs[needType].value + rate * deltaTime);
    }
    if (activity === 'work') {
      const earn = JOB_CONFIG[person.job].earnRate * deltaTime;
      person.wallet += earn;
      person.earnings += earn;
    }
  }

  getPersonInfo(id: number): PersonInfo | null {
    const person = this.people.get(id);
    if (!person) return null;
    const needs = {} as Record<NeedType, number>;
    for (const type of NEED_TYPES) {
      needs[type] = person.needs[type].value;
    }
    return { id: person.id, name: person.name, job: person.job, needs, location: person.location,
             homeBuildingId: person.homeBuildingId, workBuildingId: person.workBuildingId,
             wallet: person.wallet, earnings: person.earnings, personality: person.personality };
  }

  setPersonLocation(personId: number, location: PersonLocation): void {
    const person = this.people.get(personId);
    if (person) person.location = location;
  }

  getPeopleAtBuilding(buildingId: number): Person[] {
    const result: Person[] = [];
    for (const person of this.people.values()) {
      if ((person.location.type === 'home' || person.location.type === 'building') &&
          person.location.buildingId === buildingId) {
        result.push(person);
      }
    }
    return result;
  }

  getHouseholdInfos(): HouseholdInfo[] {
    const infos: HouseholdInfo[] = [];
    for (const h of this.households.values()) {
      const members: PersonInfo[] = [];
      for (const mid of h.memberIds) {
        const info = this.getPersonInfo(mid);
        if (info) members.push(info);
      }
      infos.push({
        id: h.id,
        buildingId: h.buildingId,
        members,
        carActive: h.carActive,
        foodSupply: h.foodSupply,
      });
    }
    return infos;
  }

  getHouseholdByPerson(personId: number): Household | undefined {
    const hid = this.personToHousehold.get(personId);
    return hid !== undefined ? this.households.get(hid) : undefined;
  }

  markHouseholdCarActive(householdId: number, active: boolean): void {
    const h = this.households.get(householdId);
    if (h) h.carActive = active;
  }

  getLowestNeed(personId: number): number {
    const person = this.people.get(personId);
    if (!person) return 100;
    let lowest = 100;
    for (const type of NEED_TYPES) {
      if (person.needs[type].value < lowest) lowest = person.needs[type].value;
    }
    return lowest;
  }

  getHouseholdLowestNeed(householdId: number): number {
    const h = this.households.get(householdId);
    if (!h) return 100;
    let lowest = 100;
    for (const memberId of h.memberIds) {
      const memberLowest = this.getLowestNeed(memberId);
      if (memberLowest < lowest) lowest = memberLowest;
    }
    return lowest;
  }
}

export { ACTIVITY_RESTORE, NEED_TYPES, JOB_CONFIG, RESTAURANT_COSTS, MALL_COSTS, SUPERMARKET_COST, PERSONALITY_CONFIG, WORKPLACE_COLORS, cheapestMealCost, cheapestMallCost };
