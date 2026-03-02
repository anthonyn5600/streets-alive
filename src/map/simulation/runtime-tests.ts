import { DROPOFF_DWELL } from '../cars';
import { DWELL_RANGES } from './trip-planner';
import type { ActivityType, RuntimeTestResult, RuntimeTestSnapshot, TestStatus } from '../types';

const MAX_CARS = 50;

function result(
  id: string, category: string, name: string,
  status: TestStatus, message: string,
  sampleCount: number, failCount: number
): RuntimeTestResult {
  return { id, category, name, status, message, sampleCount, failCount };
}

function skipResult(id: string, category: string, name: string, reason = 'Waiting for population'): RuntimeTestResult {
  return result(id, category, name, 'skip', reason, 0, 0);
}

// A. Route Validity
function testRouteValidity(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('route.waypoints', 'Route Validity', 'Driving cars have >= 2 waypoints'),
      skipResult('route.progress', 'Route Validity', 'Waypoint index in bounds'),
      skipResult('route.destination', 'Route Validity', 'Driving cars have destination'),
      skipResult('route.dest-has-role', 'Route Validity', 'Destination building has role'),
      skipResult('route.speed-positive', 'Route Validity', 'Driving cars have positive speed'),
    ];
  }

  const driving = snap.cars.filter(c => c.state === 'driving' && !c.hidden);
  const householdDriving = driving.filter(c => c.householdId !== -1);
  const allHousehold = snap.cars.filter(c => c.householdId !== -1);

  // Driving cars must have >= 2 waypoints to interpolate between
  let failWp = 0;
  for (const c of driving) {
    if (c.waypointCount < 2) failWp++;
  }

  // waypointIndex must be < waypointCount - 1 (needs current + next waypoint)
  let failProgress = 0;
  for (const c of driving) {
    if (c.waypointIndex >= c.waypointCount - 1) failProgress++;
  }

  // Driving household cars must have a non-null destination
  let failDest = 0;
  for (const c of householdDriving) {
    if (c.destinationBuildingId === null) failDest++;
  }

  // Dest building must have a role (home/work/shopping) -- if not,
  // the building has no color and shouldn't be a trip target
  let failRole = 0;
  for (const c of allHousehold) {
    if (c.destinationBuildingId !== null && !snap.buildingRoleIds.has(c.destinationBuildingId)) {
      failRole++;
    }
  }

  // Driving cars must have speed > 0 to make progress along their route
  let failSpeed = 0;
  for (const c of driving) {
    if (c.speed <= 0) failSpeed++;
  }

  return [
    result('route.waypoints', 'Route Validity', 'Driving cars have >= 2 waypoints',
      failWp > 0 ? 'fail' : 'pass',
      failWp > 0 ? `${failWp}/${driving.length} missing waypoints` : `${driving.length} OK`,
      driving.length, failWp),
    result('route.progress', 'Route Validity', 'Waypoint index in bounds',
      failProgress > 0 ? 'fail' : 'pass',
      failProgress > 0 ? `${failProgress}/${driving.length} out of bounds` : `${driving.length} OK`,
      driving.length, failProgress),
    result('route.destination', 'Route Validity', 'Driving cars have destination',
      failDest > 0 ? 'fail' : 'pass',
      failDest > 0 ? `${failDest}/${householdDriving.length} invalid dest` : `${householdDriving.length} OK`,
      householdDriving.length, failDest),
    result('route.dest-has-role', 'Route Validity', 'Destination building has role',
      failRole > 0 ? 'fail' : 'pass',
      failRole > 0 ? `${failRole}/${allHousehold.length} no role` : `${allHousehold.length} OK`,
      allHousehold.length, failRole),
    result('route.speed-positive', 'Route Validity', 'Driving cars have positive speed',
      failSpeed > 0 ? 'fail' : 'pass',
      failSpeed > 0 ? `${failSpeed}/${driving.length} zero speed` : `${driving.length} OK`,
      driving.length, failSpeed),
  ];
}

// B. Need Scoring
function testNeedScoring(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('needs.bounded', 'Need Scoring', 'All needs in [0, 100]'),
      skipResult('needs.no-nan', 'Need Scoring', 'No NaN need values'),
    ];
  }

  const allPersons = snap.households.flatMap(h => h.members);

  // Needs must stay within [0, 100]. A value outside this range means
  // applyActivity or updateNeeds has a clamping bug.
  let failBounded = 0;
  let worstVal = 0;
  for (const p of allPersons) {
    for (const val of Object.values(p.needs)) {
      if (val < -0.01 || val > 100.01) {
        failBounded++;
        worstVal = val < 0 ? Math.min(worstVal, val) : Math.max(worstVal, val);
        break;
      }
    }
  }

  // NaN silently corrupts scoring -- urgency(NaN) returns NaN, making
  // the trip planner unable to rank activities correctly.
  let failNaN = 0;
  for (const p of allPersons) {
    for (const val of Object.values(p.needs)) {
      if (Number.isNaN(val)) { failNaN++; break; }
    }
  }

  return [
    result('needs.bounded', 'Need Scoring', 'All needs in [0, 100]',
      failBounded > 0 ? 'fail' : 'pass',
      failBounded > 0 ? `${failBounded}/${allPersons.length} out of range (${worstVal.toFixed(1)})` : `${allPersons.length} OK`,
      allPersons.length, failBounded),
    result('needs.no-nan', 'Need Scoring', 'No NaN need values',
      failNaN > 0 ? 'fail' : 'pass',
      failNaN > 0 ? `${failNaN}/${allPersons.length} have NaN` : `${allPersons.length} OK`,
      allPersons.length, failNaN),
  ];
}

// C. Building Assignments
function testBuildingAssignments(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('building.home-valid', 'Building Assignments', 'Home buildings indexed'),
      skipResult('building.work-valid', 'Building Assignments', 'Work buildings indexed'),
      skipResult('building.shopping-exists', 'Building Assignments', 'Shopping buildings exist'),
      skipResult('building.roles-indexed', 'Building Assignments', 'Role buildings stay indexed'),
      skipResult('building.household-integrity', 'Building Assignments', 'Household membership valid'),
    ];
  }

  const allPersons = snap.households.flatMap(h => h.members);

  // Every person's homeBuildingId must be in the road graph's building index.
  // If a tile containing the home unloads, this fails -- a real problem because
  // the car can't route home anymore.
  let failHome = 0;
  for (const p of allPersons) {
    if (!snap.indexedBuildingIds.has(p.homeBuildingId)) failHome++;
  }

  let failWork = 0;
  for (const p of allPersons) {
    if (!snap.indexedBuildingIds.has(p.workBuildingId)) failWork++;
  }

  let failRoleIndexed = 0;
  for (const roleId of snap.buildingRoleIds) {
    if (!snap.indexedBuildingIds.has(roleId)) failRoleIndexed++;
  }

  // Every household must have >= 1 member, and every person must appear
  // in exactly one household. Violations mean population init is broken.
  let failHousehold = 0;
  const personHouseholdCount = new Map<number, number>();
  for (const h of snap.households) {
    if (h.members.length === 0) failHousehold++;
    for (const m of h.members) {
      personHouseholdCount.set(m.id, (personHouseholdCount.get(m.id) ?? 0) + 1);
    }
  }
  let failMultiHousehold = 0;
  for (const [, count] of personHouseholdCount) {
    if (count > 1) failMultiHousehold++;
  }

  return [
    result('building.home-valid', 'Building Assignments', 'Home buildings indexed',
      failHome > 0 ? 'warn' : 'pass',
      failHome > 0 ? `${failHome}/${allPersons.length} not indexed` : `${allPersons.length} OK`,
      allPersons.length, failHome),
    result('building.work-valid', 'Building Assignments', 'Work buildings indexed',
      failWork > 0 ? 'warn' : 'pass',
      failWork > 0 ? `${failWork}/${allPersons.length} not indexed` : `${allPersons.length} OK`,
      allPersons.length, failWork),
    result('building.shopping-exists', 'Building Assignments', 'Shopping buildings exist',
      snap.shoppingBuildingCount > 0 ? 'pass' : 'fail',
      `${snap.shoppingBuildingCount} shopping buildings`,
      1, snap.shoppingBuildingCount > 0 ? 0 : 1),
    result('building.roles-indexed', 'Building Assignments', 'Role buildings stay indexed',
      failRoleIndexed > 0 ? 'warn' : 'pass',
      failRoleIndexed > 0
        ? `${failRoleIndexed}/${snap.buildingRoleIds.size} role buildings not indexed`
        : `${snap.buildingRoleIds.size} OK`,
      snap.buildingRoleIds.size, failRoleIndexed),
    result('building.household-integrity', 'Building Assignments', 'Household membership valid',
      (failHousehold > 0 || failMultiHousehold > 0) ? 'fail' : 'pass',
      failHousehold > 0
        ? `${failHousehold}/${snap.households.length} empty households`
        : failMultiHousehold > 0
          ? `${failMultiHousehold} persons in multiple households`
          : `${snap.households.length} households OK`,
      snap.households.length, failHousehold + failMultiHousehold),
  ];
}

// D. Dwell Times
function testDwellTimes(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('dwell.range-valid', 'Dwell Times', 'Dwell total in valid range'),
      skipResult('dwell.remaining-bounded', 'Dwell Times', 'Remaining <= total and >= 0'),
    ];
  }

  const parked = snap.cars.filter(c => c.state === 'parked' && c.householdId !== -1);

  // dwellTotal must match DWELL_RANGES for the activity, or DROPOFF_DWELL for dropoff trips
  let failRange = 0;
  for (const c of parked) {
    if (c.isDropoffTrip) {
      if (Math.abs(c.dwellTotal - DROPOFF_DWELL) > 0.01) failRange++;
    } else if (c.activity) {
      const range = DWELL_RANGES[c.activity as ActivityType];
      if (range && (c.dwellTotal < range[0] - 0.01 || c.dwellTotal > range[1] + 0.01)) failRange++;
    }
  }

  // dwellRemaining must be <= dwellTotal (set on park) and >= some reasonable floor.
  // It decrements each frame and gets checked at <= 0, so brief negatives up to -0.1 are
  // normal. Anything below -1 means updateParked isn't triggering unpark correctly.
  let failBounded = 0;
  for (const c of parked) {
    if (c.dwellRemaining > c.dwellTotal + 0.01) failBounded++;
    if (c.dwellRemaining < -1) failBounded++;
  }

  return [
    result('dwell.range-valid', 'Dwell Times', 'Dwell total in valid range',
      failRange > 0 ? 'fail' : 'pass',
      failRange > 0 ? `${failRange}/${parked.length} out of range` : `${parked.length} OK`,
      parked.length, failRange),
    result('dwell.remaining-bounded', 'Dwell Times', 'Remaining <= total and >= 0',
      failBounded > 0 ? 'fail' : 'pass',
      failBounded > 0 ? `${failBounded}/${parked.length} out of bounds` : `${parked.length} OK`,
      parked.length, failBounded),
  ];
}

// E. Pickup/Dropoff
function testPickupDropoff(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('pickup.dropoff-has-stops', 'Pickup/Dropoff', 'Dropoff trips have stops or guests'),
      skipResult('pickup.no-self-guests', 'Pickup/Dropoff', 'No self-household guests'),
    ];
  }

  // If isDropoffTrip is true, the car must have pendingDropoffs > 0 or guestOccupantIds > 0.
  // Otherwise the dropoff flag is stale.
  const dropoffCars = snap.cars.filter(c => c.isDropoffTrip);
  let failStops = 0;
  for (const c of dropoffCars) {
    if (c.pendingDropoffs === 0 && c.guestOccupantIds.length === 0) failStops++;
  }

  // Build household member lookup
  const personHousehold = new Map<number, number>();
  for (const h of snap.households) {
    for (const m of h.members) {
      personHousehold.set(m.id, h.id);
    }
  }

  // Guests should never belong to the car's own household -- pickupSocialGuests
  // filters by p.homeBuildingId === car.destinationBuildingId, not by household.
  // If two households share a building, this could happen. That's a real bug.
  const carsWithGuests = snap.cars.filter(c => c.guestOccupantIds.length > 0);
  let failSelf = 0;
  for (const c of carsWithGuests) {
    for (const gid of c.guestOccupantIds) {
      if (personHousehold.get(gid) === c.householdId) { failSelf++; break; }
    }
  }

  return [
    dropoffCars.length > 0
      ? result('pickup.dropoff-has-stops', 'Pickup/Dropoff', 'Dropoff trips have stops or guests',
          failStops > 0 ? 'fail' : 'pass',
          failStops > 0 ? `${failStops}/${dropoffCars.length} empty dropoffs` : `${dropoffCars.length} OK`,
          dropoffCars.length, failStops)
      : skipResult('pickup.dropoff-has-stops', 'Pickup/Dropoff', 'Dropoff trips have stops or guests', 'No dropoff trips active'),
    carsWithGuests.length > 0
      ? result('pickup.no-self-guests', 'Pickup/Dropoff', 'No self-household guests',
          failSelf > 0 ? 'warn' : 'pass',
          failSelf > 0 ? `${failSelf}/${carsWithGuests.length} self-guests` : `${carsWithGuests.length} OK`,
          carsWithGuests.length, failSelf)
      : skipResult('pickup.no-self-guests', 'Pickup/Dropoff', 'No self-household guests', 'No guest trips active'),
  ];
}

// F. Occupant & State Integrity
function testOccupantIntegrity(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('occupant.no-duplicates', 'Occupant Integrity', 'No person in multiple cars'),
      skipResult('occupant.driving-has-driver', 'Occupant Integrity', 'Driving household cars have occupants'),
      skipResult('occupant.person-car-sync', 'Occupant Integrity', 'Person location matches car roster'),
      skipResult('occupant.parked-has-activity', 'Occupant Integrity', 'Parked household cars have activity'),
      skipResult('occupant.no-orphan-traveling', 'Occupant Integrity', 'No orphan traveling persons'),
      skipResult('state.car-active-sync', 'Occupant Integrity', 'carActive flag matches car existence'),
      skipResult('state.car-count', 'Occupant Integrity', 'Car count <= MAX_CARS'),
    ];
  }

  // A person appearing in multiple cars means location tracking is corrupted.
  // Check both occupantIds and guestOccupantIds across all cars.
  const personCar = new Map<number, number>();
  let failDuplicates = 0;
  const duplicatePersons = new Set<number>();
  for (const c of snap.cars) {
    for (const pid of c.occupantIds) {
      if (personCar.has(pid) && personCar.get(pid) !== c.id) {
        if (!duplicatePersons.has(pid)) {
          failDuplicates++;
          duplicatePersons.add(pid);
        }
      }
      personCar.set(pid, c.id);
    }
    for (const pid of c.guestOccupantIds) {
      if (personCar.has(pid) && personCar.get(pid) !== c.id) {
        if (!duplicatePersons.has(pid)) {
          failDuplicates++;
          duplicatePersons.add(pid);
        }
      }
      personCar.set(pid, c.id);
    }
  }

  // Driving household cars must have at least one occupant (the driver).
  // An orphan driving car means the occupant list got corrupted.
  const drivingHousehold = snap.cars.filter(c => c.state === 'driving' && c.householdId !== -1 && !c.hidden);
  let failOrphan = 0;
  for (const c of drivingHousehold) {
    if (c.occupantIds.length === 0) failOrphan++;
  }

  // Every person in "traveling" state must reference a car that exists
  const carIds = new Set(snap.cars.map(c => c.id));
  const travelingPersons = snap.persons.filter(p => p.locationType === 'traveling');
  let failOrphanTraveling = 0;
  for (const p of travelingPersons) {
    if (p.locationCarId === undefined || !carIds.has(p.locationCarId)) failOrphanTraveling++;
  }

  // Bidirectional person-car sync: if a person says "I'm in car X",
  // car X must list them. If a car lists person P, that person must
  // have location.type 'car' (unless the car is hidden, in which case
  // the person is set to 'traveling').
  const carPersonSet = new Map<number, Set<number>>();
  for (const c of snap.cars) {
    const all = new Set([...c.occupantIds, ...c.guestOccupantIds]);
    carPersonSet.set(c.id, all);
  }
  let failSync2 = 0;
  // Check: person says car, but car doesn't list them
  for (const p of snap.persons) {
    if (p.locationType === 'car' && p.locationCarId !== undefined) {
      const roster = carPersonSet.get(p.locationCarId);
      if (!roster || !roster.has(p.id)) failSync2++;
    }
  }
  // Check: driving car lists person, but person isn't in 'car' or 'traveling' state.
  // Parked cars are excluded -- their occupants are set to 'building'/'home' while
  // dwelling, which is expected.
  const personLocMap = new Map<number, string>();
  for (const p of snap.persons) {
    personLocMap.set(p.id, p.locationType);
  }
  const drivingCars = snap.cars.filter(c => c.state === 'driving');
  for (const c of drivingCars) {
    for (const pid of c.occupantIds) {
      const loc = personLocMap.get(pid);
      if (loc && loc !== 'car' && loc !== 'traveling') failSync2++;
    }
    for (const pid of c.guestOccupantIds) {
      const loc = personLocMap.get(pid);
      if (loc && loc !== 'car' && loc !== 'traveling') failSync2++;
    }
  }

  // Parked household cars (not on a dropoff leg) must have an activity.
  // Without an activity, applyActivity won't restore any needs during dwell.
  const parkedHousehold = snap.cars.filter(c =>
    c.state === 'parked' && c.householdId !== -1 && !c.isDropoffTrip && !c.hidden
  );
  let failActivity = 0;
  for (const c of parkedHousehold) {
    if (!c.activity) failActivity++;
  }

  // household.carActive must be true IFF there's a car with that householdId.
  // A stale carActive=true prevents new car spawning for that household.
  const activeCarHouseholds = new Set<number>();
  for (const c of snap.cars) {
    if (c.householdId !== -1) activeCarHouseholds.add(c.householdId);
  }
  let failSync = 0;
  for (const h of snap.households) {
    const hasCar = activeCarHouseholds.has(h.id);
    if (h.carActive !== hasCar) failSync++;
  }

  // Car count should never exceed MAX_CARS
  const carCount = snap.cars.length;
  const failCount = carCount > MAX_CARS ? 1 : 0;

  return [
    result('occupant.no-duplicates', 'Occupant Integrity', 'No person in multiple cars',
      failDuplicates > 0 ? 'fail' : 'pass',
      failDuplicates > 0 ? `${failDuplicates} persons in multiple cars` : `${personCar.size} tracked OK`,
      personCar.size, failDuplicates),
    result('occupant.driving-has-driver', 'Occupant Integrity', 'Driving household cars have occupants',
      failOrphan > 0 ? 'fail' : 'pass',
      failOrphan > 0 ? `${failOrphan}/${drivingHousehold.length} orphan cars` : `${drivingHousehold.length} OK`,
      drivingHousehold.length, failOrphan),
    result('occupant.person-car-sync', 'Occupant Integrity', 'Person location matches car roster',
      failSync2 > 0 ? 'fail' : 'pass',
      failSync2 > 0 ? `${failSync2} mismatches` : `${personLocMap.size} OK`,
      personLocMap.size, failSync2),
    result('occupant.parked-has-activity', 'Occupant Integrity', 'Parked household cars have activity',
      failActivity > 0 ? 'fail' : 'pass',
      failActivity > 0 ? `${failActivity}/${parkedHousehold.length} no activity` : `${parkedHousehold.length} OK`,
      parkedHousehold.length, failActivity),
    result('occupant.no-orphan-traveling', 'Occupant Integrity', 'No orphan traveling persons',
      failOrphanTraveling > 0 ? 'fail' : 'pass',
      failOrphanTraveling > 0 ? `${failOrphanTraveling}/${travelingPersons.length} orphaned` : `${travelingPersons.length} traveling OK`,
      travelingPersons.length, failOrphanTraveling),
    result('state.car-active-sync', 'Occupant Integrity', 'carActive flag matches car existence',
      failSync > 0 ? 'fail' : 'pass',
      failSync > 0 ? `${failSync}/${snap.households.length} out of sync` : `${snap.households.length} OK`,
      snap.households.length, failSync),
    result('state.car-count', 'Occupant Integrity', 'Car count <= MAX_CARS',
      failCount > 0 ? 'fail' : 'pass',
      `${carCount}/${MAX_CARS}`,
      1, failCount),
  ];
}

export function runAllTests(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  const results: RuntimeTestResult[] = [];
  const suites = [
    testRouteValidity,
    testNeedScoring,
    testBuildingAssignments,
    testDwellTimes,
    testPickupDropoff,
    testOccupantIntegrity,
  ];
  for (const suite of suites) {
    try {
      results.push(...suite(snap));
    } catch {
      // Never break the simulation
    }
  }
  return results;
}
