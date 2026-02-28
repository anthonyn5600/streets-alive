import type { NeedType, ActivityType, JobType, Person, Need, Household, PersonInfo, PersonLocation, HouseholdInfo } from '../types';
import type { IndexedBuilding } from '../roads/graph';

export type BuildingRole = 'home' | 'work' | 'shopping';

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
  social: 0.3,
  money: 0.1,
  fun: 0.3,
  health: 0.05,
};

const ACTIVITY_RESTORE: Record<ActivityType, Partial<Record<NeedType, number>>> = {
  home: { energy: 2.0, health: 0.5 },
  work: { money: 1.0 },
  shopping: { fun: 1.5 },
  social: { social: 1.5, fun: 1.0 },
};

const NEED_TYPES: NeedType[] = ['energy', 'social', 'money', 'fun', 'health'];

let nextPersonId = 1;
let nextHouseholdId = 1;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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
  shoppingBuildingIds = new Set<number>();
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

        const person: Person = {
          id: personId,
          name: `${firstName} ${lastName}`,
          job: randomPick(JOBS),
          needs: createNeeds(),
          homeBuildingId: householdBuildingId,
          workBuildingId,
          location: { type: 'home', buildingId: householdBuildingId },
        };

        this.people.set(personId, person);
        memberIds.push(personId);
      }

      const household: Household = {
        id: householdId,
        buildingId: householdBuildingId,
        memberIds,
        carActive: false,
      };
      this.households.set(householdId, household);
    }

    // Pick 8-12 random buildings as shopping destinations (not homes or workplaces)
    const usedBuildings = new Set<number>();
    for (const h of this.households.values()) usedBuildings.add(h.buildingId);
    for (const p of this.people.values()) usedBuildings.add(p.workBuildingId);
    const candidateShops = buildingIds.filter(id => !usedBuildings.has(id));
    const shopCount = Math.floor(randomRange(8, 13));
    const shuffled = candidateShops.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(shopCount, shuffled.length); i++) {
      this.shoppingBuildingIds.add(shuffled[i]);
    }
    // If not enough unique candidates, add from all buildings
    if (this.shoppingBuildingIds.size < shopCount) {
      for (const id of buildingIds) {
        if (this.shoppingBuildingIds.size >= shopCount) break;
        if (!usedBuildings.has(id)) this.shoppingBuildingIds.add(id);
      }
    }
  }

  getBuildingRoles(): Map<number, BuildingRole> {
    const roles = new Map<number, BuildingRole>();
    // Work buildings (lowest priority)
    for (const p of this.people.values()) {
      roles.set(p.workBuildingId, 'work');
    }
    // Shopping buildings (medium priority)
    for (const id of this.shoppingBuildingIds) {
      roles.set(id, 'shopping');
    }
    // Home buildings (highest priority)
    for (const h of this.households.values()) {
      roles.set(h.buildingId, 'home');
    }
    return roles;
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
      person.needs[needType].value = Math.min(100, person.needs[needType].value + rate * deltaTime);
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
             homeBuildingId: person.homeBuildingId, workBuildingId: person.workBuildingId };
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
      });
    }
    return infos;
  }

  getHouseholdByPerson(personId: number): Household | undefined {
    for (const h of this.households.values()) {
      if (h.memberIds.includes(personId)) return h;
    }
    return undefined;
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

export { ACTIVITY_RESTORE, NEED_TYPES };
