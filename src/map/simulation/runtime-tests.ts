import type { RuntimeTestResult, RuntimeTestSnapshot, TestStatus } from '../types';

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
      skipResult('route.origin-named', 'Route Validity', 'Origin buildings have named roads'),
      skipResult('route.dest-named', 'Route Validity', 'Destination buildings have named roads'),
      skipResult('route.origin-indexed', 'Route Validity', 'Origin buildings in graph index'),
      skipResult('route.dest-indexed', 'Route Validity', 'Destination buildings in graph index'),
      skipResult('route.segment-progress', 'Route Validity', 'Segment progress in [0, 1)'),
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

  // Dest building must have a role -- if not,
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

  // Per-segment interpolation must stay in [0, 1). A value >= 1 means the animation
  // loop failed to advance waypointIndex when it should have.
  let failSegProgress = 0;
  for (const c of driving) {
    if (c.segmentProgress < 0 || c.segmentProgress >= 1) failSegProgress++;
  }

  // Household car buildings must resolve a road name -- null means either the building
  // fell out of the graph index or its road has no name, both shown as "Unknown street" in the UI
  let failOriginNamed = 0;
  let failDestNamed = 0;
  for (const c of allHousehold) {
    if (c.originBuildingId !== null && c.originRoadName === null) failOriginNamed++;
    if (c.destinationBuildingId !== null && c.destinationRoadName === null) failDestNamed++;
  }

  // Origin/dest buildings must be in the graph index -- if not, routing to/from that
  // building is broken even if the road name is recovered via savedRoleParkings fallback
  let failOriginIdx = 0;
  let failDestIdx = 0;
  for (const c of allHousehold) {
    if (c.originBuildingId !== null && !snap.indexedBuildingIds.has(c.originBuildingId)) failOriginIdx++;
    if (c.destinationBuildingId !== null && !snap.indexedBuildingIds.has(c.destinationBuildingId)) failDestIdx++;
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
    result('route.segment-progress', 'Route Validity', 'Segment progress in [0, 1)',
      failSegProgress > 0 ? 'fail' : 'pass',
      failSegProgress > 0 ? `${failSegProgress}/${driving.length} out of bounds` : `${driving.length} OK`,
      driving.length, failSegProgress),
    result('route.origin-named', 'Route Validity', 'Origin buildings have named roads',
      failOriginNamed > 0 ? 'fail' : 'pass',
      failOriginNamed > 0 ? `${failOriginNamed}/${allHousehold.length} showing "Unknown street"` : `${allHousehold.length} OK`,
      allHousehold.length, failOriginNamed),
    result('route.dest-named', 'Route Validity', 'Destination buildings have named roads',
      failDestNamed > 0 ? 'fail' : 'pass',
      failDestNamed > 0 ? `${failDestNamed}/${allHousehold.length} showing "Unknown street"` : `${allHousehold.length} OK`,
      allHousehold.length, failDestNamed),
    result('route.origin-indexed', 'Route Validity', 'Origin buildings in graph index',
      failOriginIdx > 0 ? 'warn' : 'pass',
      failOriginIdx > 0 ? `${failOriginIdx}/${allHousehold.length} not indexed` : `${allHousehold.length} OK`,
      allHousehold.length, failOriginIdx),
    result('route.dest-indexed', 'Route Validity', 'Destination buildings in graph index',
      failDestIdx > 0 ? 'warn' : 'pass',
      failDestIdx > 0 ? `${failDestIdx}/${allHousehold.length} not indexed` : `${allHousehold.length} OK`,
      allHousehold.length, failDestIdx),
  ];
}

// B. Need Scoring
function testNeedScoring(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('needs.bounded', 'Need Scoring', 'All needs in [0, 100]'),
      skipResult('needs.no-nan', 'Need Scoring', 'No NaN need values'),
      skipResult('needs.wallet-valid', 'Need Scoring', 'Person wallets non-negative'),
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

  // Negative or NaN wallet corrupts the trip planner's work-opportunity scoring
  let failWallet = 0;
  for (const p of allPersons) {
    if (Number.isNaN(p.wallet) || p.wallet < 0) failWallet++;
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
    result('needs.wallet-valid', 'Need Scoring', 'Person wallets non-negative',
      failWallet > 0 ? 'fail' : 'pass',
      failWallet > 0 ? `${failWallet}/${allPersons.length} invalid wallet` : `${allPersons.length} OK`,
      allPersons.length, failWallet),
  ];
}

// C. Building Assignments
function testBuildingAssignments(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  if (!snap.populationInitialized) {
    return [
      skipResult('building.home-valid', 'Building Assignments', 'Home buildings indexed'),
      skipResult('building.work-valid', 'Building Assignments', 'Work buildings indexed'),
      skipResult('building.mall-exists', 'Building Assignments', 'Mall buildings exist'),
      skipResult('building.restaurant-exists', 'Building Assignments', 'Restaurant buildings exist'),
      skipResult('building.supermarket-exists', 'Building Assignments', 'Supermarket buildings exist'),
      skipResult('building.roles-indexed', 'Building Assignments', 'Role buildings stay indexed'),
      skipResult('building.household-not-empty', 'Building Assignments', 'All households have members'),
      skipResult('building.person-unique-household', 'Building Assignments', 'No person in multiple households'),
      skipResult('building.orphan-building', 'Building Assignments', 'Dwelling persons have indexed buildings'),
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

  // Persons dwelling at a non-home building (locationType 'building') must have a
  // defined, indexed buildingId. An undefined or unindexed ID means the tile
  // containing that building unloaded while the person was still dwelling there.
  const buildingPersons = snap.persons.filter(p => p.locationType === 'building');
  let failOrphanBuilding = 0;
  for (const p of buildingPersons) {
    if (p.locationBuildingId === undefined || !snap.indexedBuildingIds.has(p.locationBuildingId)) {
      failOrphanBuilding++;
    }
  }

  let failRoleIndexed = 0;
  for (const roleId of snap.buildingRoleIds) {
    if (!snap.indexedBuildingIds.has(roleId)) failRoleIndexed++;
  }

  // Every household must have >= 1 member
  let failHousehold = 0;
  const personHouseholdCount = new Map<number, number>();
  for (const h of snap.households) {
    if (h.members.length === 0) failHousehold++;
    for (const m of h.members) {
      personHouseholdCount.set(m.id, (personHouseholdCount.get(m.id) ?? 0) + 1);
    }
  }

  // Every person must appear in exactly one household
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
    result('building.mall-exists', 'Building Assignments', 'Mall buildings exist',
      snap.mallBuildingCount > 0 ? 'pass' : 'fail',
      `${snap.mallBuildingCount} mall buildings`,
      1, snap.mallBuildingCount > 0 ? 0 : 1),
    result('building.restaurant-exists', 'Building Assignments', 'Restaurant buildings exist',
      snap.restaurantBuildingCount > 0 ? 'pass' : 'fail',
      `${snap.restaurantBuildingCount} restaurant buildings`,
      1, snap.restaurantBuildingCount > 0 ? 0 : 1),
    result('building.supermarket-exists', 'Building Assignments', 'Supermarket buildings exist',
      snap.supermarketBuildingCount > 0 ? 'pass' : 'fail',
      `${snap.supermarketBuildingCount} supermarket buildings`,
      1, snap.supermarketBuildingCount > 0 ? 0 : 1),
    result('building.roles-indexed', 'Building Assignments', 'Role buildings stay indexed',
      failRoleIndexed > 0 ? 'warn' : 'pass',
      failRoleIndexed > 0
        ? `${failRoleIndexed}/${snap.buildingRoleIds.size} role buildings not indexed`
        : `${snap.buildingRoleIds.size} OK`,
      snap.buildingRoleIds.size, failRoleIndexed),
    result('building.household-not-empty', 'Building Assignments', 'All households have members',
      failHousehold > 0 ? 'fail' : 'pass',
      failHousehold > 0
        ? `${failHousehold}/${snap.households.length} empty households`
        : `${snap.households.length} households OK`,
      snap.households.length, failHousehold),
    result('building.person-unique-household', 'Building Assignments', 'No person in multiple households',
      failMultiHousehold > 0 ? 'fail' : 'pass',
      failMultiHousehold > 0
        ? `${failMultiHousehold} persons in multiple households`
        : `${personHouseholdCount.size} persons OK`,
      personHouseholdCount.size, failMultiHousehold),
    result('building.orphan-building', 'Building Assignments', 'Dwelling persons have indexed buildings',
      failOrphanBuilding > 0 ? 'warn' : 'pass',
      failOrphanBuilding > 0
        ? `${failOrphanBuilding}/${buildingPersons.length} at unindexed buildings`
        : `${buildingPersons.length} OK`,
      buildingPersons.length, failOrphanBuilding),
  ];
}

// D. Pickup/Dropoff
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

// E. Occupant & State Integrity
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
      skipResult('state.hidden-cars-no-occupants', 'Occupant Integrity', 'Hidden cars have no occupants'),
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

  // Hidden cars are placeholders between visible tiles -- they must have no occupants
  // because the person's location state is set to 'traveling', not 'car'
  const hiddenCars = snap.cars.filter(c => c.hidden);
  let failHiddenOccupants = 0;
  for (const c of hiddenCars) {
    if (c.occupantIds.length > 0 || c.guestOccupantIds.length > 0) failHiddenOccupants++;
  }

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
    result('state.hidden-cars-no-occupants', 'Occupant Integrity', 'Hidden cars have no occupants',
      failHiddenOccupants > 0 ? 'fail' : 'pass',
      failHiddenOccupants > 0
        ? `${failHiddenOccupants}/${hiddenCars.length} hidden cars with occupants`
        : `${hiddenCars.length} hidden OK`,
      hiddenCars.length, failHiddenOccupants),
  ];
}

// F. Street Name Diagnostics
// Classifies "Unknown street" failures by root cause so the specific bug can be identified.
// RC-A: building not in graph index AND not in savedRoleParkings (tile unloaded, no fallback).
// RC-B: building not in graph index BUT has savedRoleParkings entry (fallback roadName also falsy).
// RC-C: building IS in graph index but road name is falsy (unnamed road in tile data).
function testStreetNameDiagnostics(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  const CAT = 'Street Name Diagnostics';
  if (!snap.populationInitialized) {
    return [
      skipResult('street.origin-rc-a', CAT, 'Origin: not indexed, no saved parking'),
      skipResult('street.origin-rc-b', CAT, 'Origin: not indexed, saved parking roadName null'),
      skipResult('street.origin-rc-c', CAT, 'Origin: indexed but road unnamed'),
      skipResult('street.dest-rc-a', CAT, 'Dest: not indexed, no saved parking'),
      skipResult('street.dest-rc-b', CAT, 'Dest: not indexed, saved parking roadName null'),
      skipResult('street.dest-rc-c', CAT, 'Dest: indexed but road unnamed'),
    ];
  }

  const allHousehold = snap.cars.filter(c => c.householdId !== -1);
  const unknownOrigin = allHousehold.filter(c => c.originBuildingId !== null && !c.originRoadName);
  const unknownDest   = allHousehold.filter(c => c.destinationBuildingId !== null && !c.destinationRoadName);

  let originA = 0, originB = 0, originC = 0;
  for (const c of unknownOrigin) {
    const indexed = snap.indexedBuildingIds.has(c.originBuildingId!);
    if (indexed) { originC++; continue; }
    snap.savedRoleParkingIds.has(c.originBuildingId!) ? originB++ : originA++;
  }

  let destA = 0, destB = 0, destC = 0;
  for (const c of unknownDest) {
    const indexed = snap.indexedBuildingIds.has(c.destinationBuildingId!);
    if (indexed) { destC++; continue; }
    snap.savedRoleParkingIds.has(c.destinationBuildingId!) ? destB++ : destA++;
  }

  const total = allHousehold.length;
  return [
    result('street.origin-rc-a', CAT, 'Origin: not indexed, no saved parking',
      originA > 0 ? 'fail' : 'pass',
      originA > 0 ? `${originA}/${total} tile unloaded, no fallback` : `${total} OK`,
      total, originA),
    result('street.origin-rc-b', CAT, 'Origin: not indexed, saved parking roadName null',
      originB > 0 ? 'warn' : 'pass',
      originB > 0 ? `${originB}/${total} saved parking has no road name` : `${total} OK`,
      total, originB),
    result('street.origin-rc-c', CAT, 'Origin: indexed but road unnamed',
      originC > 0 ? 'warn' : 'pass',
      originC > 0 ? `${originC}/${total} road has no name in tile data` : `${total} OK`,
      total, originC),
    result('street.dest-rc-a', CAT, 'Dest: not indexed, no saved parking',
      destA > 0 ? 'fail' : 'pass',
      destA > 0 ? `${destA}/${total} tile unloaded, no fallback` : `${total} OK`,
      total, destA),
    result('street.dest-rc-b', CAT, 'Dest: not indexed, saved parking roadName null',
      destB > 0 ? 'warn' : 'pass',
      destB > 0 ? `${destB}/${total} saved parking has no road name` : `${total} OK`,
      total, destB),
    result('street.dest-rc-c', CAT, 'Dest: indexed but road unnamed',
      destC > 0 ? 'warn' : 'pass',
      destC > 0 ? `${destC}/${total} road has no name in tile data` : `${total} OK`,
      total, destC),
  ];
}

export function runAllTests(snap: RuntimeTestSnapshot): RuntimeTestResult[] {
  const results: RuntimeTestResult[] = [];
  const suites = [
    testRouteValidity,
    testNeedScoring,
    testBuildingAssignments,
    testPickupDropoff,
    testOccupantIntegrity,
    testStreetNameDiagnostics,
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
