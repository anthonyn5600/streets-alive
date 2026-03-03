# Architecture

## Overview

Three.js 3D map renderer + React/Vite UI. Loads OpenFreeMap vector tiles (PBF format) at zoom
level 14, decodes geometry in a Web Worker pool, renders via unified GPU buffers. A life-simulation
layer drives households of people with needs, trip planning, and Dijkstra-routed cars.

---

## Application Structure

```
React UI
  App.tsx
    MapCanvas.tsx             canvas + MapEngine lifecycle
    AppSidebar.tsx            left sidebar (w-80)
      SearchSection           city search + presets
      LayersSection           building/road/label toggles + height slider
      DriversSection          car list with occupants + need bars
      HouseholdsSection       household list with members
      TestsSection            runtime test results (collapsible)
    StatusPill.tsx            bottom-right compact status (tile count, sim time)
    RoutePanel.tsx            top-right floating route card for selected cars
    RuntimeTestPanel.tsx      full test panel, toggled via Ctrl+Shift+T
```

The UI is purely reactive — it reads state via periodic callbacks (`onUpdate`, `onSimUpdate`) and
never mutates engine state directly. All mutations go through `MapEngine`'s public API.

---

## MapEngine — Orchestrator

`src/map/engine.ts`

Owns the Three.js scene, render loop, and all subsystem lifecycles. Public API surface used by
React components:

- `flyTo(lat, lng)` / `flyToScenePos(x, z)` — camera navigation
- `setLayer(name, visible)` — toggle render layers
- `selectCar(id)` / `deselectCar(id?)` — car selection state
- `setSimEnabled(bool)` — start/stop simulation
- `getSimCarInfos()` / `getHouseholdInfos()` — data snapshots for UI

On each animation frame: `TileManager.update()` → `CarManager.update()` → render.

---

## Tile Pipeline

### 1. TileManager — What Tiles to Load

`src/map/tiles/manager.ts`

On every frame, `getVisibleBBox()` returns the camera's ground footprint in lat/lng. TileManager
converts this to a set of z=14 tile coordinates (`bboxToTiles`), compares against currently loaded
tiles, and queues loads/unloads. Max 128 tiles in memory at once.

```
camera bbox → bboxToTiles(z14) → diff(loaded, visible) → {toLoad, toUnload}
```

Tiles are identified by key strings: `"14/{x}/{y}"`. The load queue is ordered by distance from
camera center. Failed fetches are retried with exponential backoff.

### 2. Vector Tile Fetch — PBF Cache

`src/map/tiles/vector-tiles.ts`

For each tile to load, checks a two-level cache:

1. **Memory LRU** (in-process, keyed by tile string) — fastest, survives navigation
2. **IndexedDB** (persists across page reloads) — avoids re-fetching on refresh

On miss: fetches PBF from `https://tiles.openfreemap.org/planet/{z}/{x}/{y}`.
Tile data is parsed as a `VectorTile` (Mapbox Vector Tile spec) and stored raw.

### 3. Geometry Worker — Decode + Triangulate + Ribbon

`src/map/tiles/geometry.worker.ts`

Each tile is processed in a Web Worker (via `WorkerPool`, N workers in parallel) so the main
thread never blocks. The worker runs three sequential stages:

**A. PBF Decode** `src/map/tiles/decode.ts`

Reads three PBF layers from the tile:
- `building` (polygon type=3) → `BuildingData[]` with polygon ring + height + minHeight
- `transportation` (linestring type=2) → `RoadData[]` with points, road type, lane count, oneway flag
- `transportation_name` → road name strings, overlaid onto `RoadData` via `applyRoadNames()`

`applyRoadNames()` builds a spatial index over all coordinate points across all roads, then
for each name feature scans its coordinate points looking for any match. This handles the
`transportation_name` layer having its own independent geometry (often with reversed direction
or different starting point relative to the `transportation` layer).

MultiPolygon and MultiLineString features are exploded into individual entries.

**B. Building Triangulation** `src/map/buildings.ts`

Earcut triangulation of each polygon ring, then extruded by height to produce flat arrays:
`{ positions, normals, colors, indices }` for the buildings GPU layer.
All buildings in a tile are merged into one geometry before transfer.

**C. Road Ribbon Build** `src/map/roads/renderer.ts` + `src/map/roads/miter.ts`

Each road linestring becomes a ribbon quad strip. `miter.ts` computes per-vertex miter join
normals so ribbons turn sharp corners without gaps or overlaps.

Major roads (motorway, trunk, primary) get divided-lane geometry — two separate ribbons with
a gap between, representing opposite carriageways.

Road type determines fill width, casing width, Y-offset, and color from `src/map/roads/style.ts`.
Elevation of highway tiers is computed in `src/map/roads/elevation.ts` — motorways float above
ground; on-ramps interpolate smoothly between ground and the elevated tier.

Canvas atlas text labels are built in `src/map/roads/labels.ts`.

### 4. Geometry Cache — Skip Re-work

`src/map/tiles/geometry-cache.ts`

After the worker produces geometry arrays, they are stored in a second LRU + IndexedDB cache
keyed by tile. On subsequent loads of the same tile (e.g., returning to a previously viewed
area), the cached arrays are used directly, skipping the worker entirely.

### 5. GlobalMeshManager — Unified GPU Buffers

`src/map/global-mesh-manager.ts`

All tiles share a small, fixed set of `THREE.BufferGeometry` objects — one per layer type.
Per-tile data occupies pre-allocated slots within these shared buffers. When a tile unloads,
its slot is cleared in-place (zeroed), avoiding full buffer replacement.

This keeps draw call count constant regardless of how many tiles are loaded:

| Layer ID | Initial size | Content |
|----------|-------------|---------|
| `buildings` | 150K verts | extruded building polygons |
| `localCasing` | 30K verts | local road casing |
| `localFill` | 30K verts | local road fill |
| `localCenterLine` | 10K verts | local road centerlines |
| `hwMask` | 15K verts | stencil mask for highway areas |
| `hwShadow` | 15K verts | highway shadow |
| `hwCasing` | 15K verts | highway casing |
| `hwFill` | 15K verts | highway fill |
| `hwCenterLine` | 10K verts | highway centerlines |

### 6. MaterialPool — Stencil + Shaders

`src/map/materials.ts`

Local road materials use `NotEqualStencilFunc` (stencilRef=1): they skip any fragment where
the stencil buffer is already 1, which is where the highway mask layer wrote. This prevents
local roads from rendering inside highway footprints.

Building material uses a custom flatten shader with uniforms `uFocusXZ`, `uFlattenStart=500m`,
`uFlattenEnd=1500m`. Buildings beyond 500m from the camera focus point are progressively
flattened to ground level, improving depth cues at distance.

Road materials are keyed by color hex string so identical colors share one material object,
enabling vertex-color batching.

### Y-Layer Stack

```
  Y
  ^
  |   Buildings (variable height, flatten shader at distance)
  |
0.50  Road labels (canvas atlas text)
0.45  Route lines (car paths for selected cars)
0.40  Highway center lines
0.35  Highway fill
0.30  Highway casing
0.25  Highway shadow
0.20  Highway mask (stencil write, ref=1)
0.15  Local road fill
0.05  Local road casing
0.00  Ground plane
```

---

## How Tile Events Affect the Simulation

This is the critical coupling between the tile system and the life simulation.

### Tile Load — Graph Rebuild

When a new tile's geometry arrives, `engine.ts` calls `CarManager.onRoadsUpdated(allRoadData)`.
This triggers a full graph rebuild (not incremental, to maintain correctness):

1. **`RoadGraph.buildFromRoads(allRoads)`** — All road segments across all currently-loaded tiles
   are re-indexed into a directed graph. Nodes are road endpoints; edges are road segments
   weighted by Euclidean length. Oneway roads produce one directed edge; bidirectional produce
   two. An AbortController cancels any in-flight prior rebuild.

2. **`buildBuildingIndex(roleBuildings)`** — Each building in the population's role set is
   snapped to the nearest road edge within `ROAD_TOLERANCE=15m`. The stored building record
   includes: snapped scene position, edge ID, and road name from the edge.

3. **`restoreMissingRoleBuildings(roleIds)`** in `cars.ts` — After the rebuild, any role building
   that failed to snap (its road is no longer in a loaded tile) is re-inserted from
   `savedRoleParkings`, a Map of last-known good `IndexedBuilding` records. If the building
   did snap but its road is unnamed, `restoreBuilding()` patches in the saved road name.

4. **Car route invalidation** — Any driving car whose waypoints reference graph nodes that no
   longer exist will fail its next interpolation step and be re-routed or reset to idle.

### Tile Load — Population Expansion

`PopulationManager.expandRoles(newBuildings)` is called with buildings decoded from the new tile.
Commercial buildings with recognized OSM tags are classified and added to the appropriate sets:
`mallBuildingIds`, `restaurantBuildingIds`, `supermarketBuildingIds`. Existing households can
now route to these new destinations. Home and work buildings are fixed at population init and
never expanded by tile events.

### Tile Unload — Building Index Eviction

When a tile unloads:

1. `GlobalMeshManager.clearTile(tileKey)` — zeroes the tile's vertex slots in all GPU layers.
2. `CarManager.onTileUnloaded(tileKey)` — scans parked cars whose home building falls inside
   the tile bbox. Those cars receive a `HIDDEN_TIMEOUT=30s` grace timer. If the tile does not
   reload within that time, the car is hidden (mesh removed from scene, occupants set to
   `'traveling'` state).

Role buildings in the unloaded tile remain in `buildingRoleIds` but drop out of
`indexedBuildingIds` until the tile reloads and the graph rebuilds. During this window:
- `building.home-valid` / `building.work-valid` runtime tests produce `warn`
- `route.origin-indexed` / `route.dest-indexed` tests produce `warn`
- The `savedRoleParkings` fallback keeps UI road-name labels from showing "Unknown street"

### Tile Reload — Name and Position Recovery

When a previously-unloaded tile reloads, `restoreBuilding(buildingId, saved)` is called for
each role building that was in `savedRoleParkings`:

- If the new graph snapped the building to a named road → new name wins
- If the new graph snapped it to an unnamed road (service roads, alleys) → saved name is
  patched in via `if (!existing.roadName && saved.roadName) existing.roadName = saved.roadName`
- Scene position comes from the new index (more geometrically accurate)

---

## Life Simulation

### SimClock

`src/map/simulation/clock.ts`

`SIM_SECONDS_PER_REAL_SECOND = 120` means 2 sim-minutes pass per real second, or one sim-hour
every 30 real seconds. All needs decay rates and activity scheduling are expressed in sim-time.
`SimClock.update(realDt)` returns `true` when an in-game hour boundary is crossed, allowing
callers to trigger hourly events.

### PopulationManager

`src/map/simulation/population.ts`

Initialized once when sufficient buildings are indexed. Creates 50–60 households, each with 1–4
people. Each person carries:

| Field | Type | Purpose |
|-------|------|---------|
| `needs` | `Record<NeedType, number>` | 5 needs (energy, hunger, social, fun, health), 0–100 |
| `wallet` | `number` | currency; earned at work, spent at destinations |
| `personality` | `PersonalityType` | affects trip scoring and speed |
| `job` | `JobType` | determines work building type and shift schedule |

Building roles assigned at init and expanded on tile load:

| Role | Population | Purpose |
|------|-----------|---------|
| `home` | 1 per household | residence; energy/social restore |
| `work` | 1 per working person | money/health restore during shift |
| `mall` | 10 buildings | fun + money spend |
| `restaurant` | 40 buildings | hunger restore |
| `supermarket` | 20 buildings | restocks household `foodSupply` |

`updateNeeds(dt)` decays all needs every frame at their individual rates.
`applyActivity(personId, activity, dt)` restores the relevant need while a person dwells at a
destination. Work also increments `wallet`; meals decrement it; supermarket restocks `foodSupply`.

### TripPlanner

`src/map/simulation/trip-planner.ts`

`scoreActions(occupantIds, population, driverPersonId, lastActivity)` returns a ranked
`ActionOption[]`. Core scoring formula: `deficit² where deficit = 100 - need.value`.
Higher deficit = more urgent. Composite score aggregates across all occupants.

Modifiers applied on top of raw urgency:

| Condition | Effect |
|-----------|--------|
| Wallet below threshold | Work score boosted; mall/restaurant disabled |
| Last activity repeated | Score penalized to avoid back-to-back identical trips |
| `cautious` personality | Mall score reduced |
| Broke + hungry (scavenge mode) | 40% chance of random boost to work or hunger activity |

`pickNextTrip()` wraps `scoreActions()` and returns the top-scoring `{ activity, buildingId }`.

### CarManager

`src/map/cars.ts`

`MAX_CARS = 50`. Each car is a state machine driven by `update(dt)`:

```
[idle household] → TripPlanner.pickNextTrip()
                 → RoadGraph.dijkstra(origin, dest)
                 → spawn car, set waypoints

[driving car]    → interpolate along waypoints
                 → on arrival: transition to parked

[parked car]     → PopulationManager.applyActivity() each frame
                 → dwell timer counts down (activity-specific duration)
                 → on complete: plan next trip or sleep until need is urgent
```

Social trips involve guest pickup: car first routes to guests' home buildings before
heading to the social destination. Dropoff trips reverse this — `pendingDropoffs` counter
decrements as each guest is dropped home.

Route markers (origin "A" badge, destination "B" badge) bob above their buildings at
`MARKER_Y=35m` with a sinusoidal animation.

### RuntimeTestRunner

`src/map/simulation/runtime-test-runner.ts`

Collects a `RuntimeTestSnapshot` every 2 real seconds, runs `runAllTests(snap)` from
`runtime-tests.ts`, and POSTs results to `/__test-results` (Vite dev server middleware
writes `runtime-test-results.json`).

30 tests across 5 categories run without ever throwing into the simulation loop:

| Category | Tests | What it validates |
|----------|-------|------------------|
| Route Validity | 9 | Waypoints, progress index, destination, role, speed, road names, graph membership |
| Need Scoring | 3 | Bounds [0,100], no NaN, wallet non-negative |
| Building Assignments | 8 | Home/work indexed, role building counts, household membership |
| Pickup/Dropoff | 2 | Dropoff flag correctness, no self-household guests |
| Occupant Integrity | 8 | No duplicates, driver present, person-car sync, hidden car state, car count |

---

## Coordinate System

```
LatLng (WGS84)               Scene Space (meters)
lat: 34.0522      project()       x: East  (+)
lng: -118.2437  ------------>     z: South (+, i.e. negated Mercator Y)
                <------------     y: Up    (+)
                 unproject()

Projection center: Los Angeles (34.0522, -118.2437)
All scene coordinates are offsets in meters from this center.
```

`src/map/projection.ts` — `setCenter(lat, lng)`, `project(latlng): Point2D`, `unproject(pt): LatLng`

---

## Car State Machine

```
     [household needs a trip]
               |
               v
        +----------+
        |   Idle   | <-- waits until TripPlanner finds an urgent need
        +----------+
               |  Dijkstra route computed
               v
        +----------+     route lost / invalid
        | Driving  | ------------------> [Idle]
        +----------+
               |  arrived at destination
               v
        +----------+
        | Parked   |  applyActivity() runs each frame
        |          |  dwell timer counts down
        +----------+
               |  dwell complete
               |    home: sleep until next need becomes urgent
               |    other: plan return home or next trip
               v
        +----------+
        | Driving  |
        +----------+
```

Hidden state: a parked car whose home tile unloads gets a 30s grace timer. On expiry it is
removed from the scene and its occupants enter `'traveling'` state until the tile reloads.

---

## Full Data Flow

```
Camera viewport changes
        |
        v
TileManager.update()
        |
        +-- bboxToTiles(z14) → diff vs loaded set
        |
        +-- [tile to load] ─────────────────────────────────────────────────+
        |                                                                    |
        |   vector-tiles.ts: check LRU cache → check IndexedDB → fetch PBF  |
        |                                                                    |
        |   WorkerPool → geometry.worker.ts                                  |
        |     decode.ts:     PBF → BuildingData[] + RoadData[]               |
        |     buildings.ts:  earcut + extrude → position/normal/color arrays |
        |     renderer.ts:   ribbon + miter joins → road geometry arrays     |
        |     labels.ts:     canvas atlas → label geometry                   |
        |                                                                    |
        |   geometry-cache.ts: store result in LRU + IndexedDB               |
        |                                                                    |
        |   GlobalMeshManager.writeTile() → update GPU buffer slots          |
        |                                                                    |
        |   CarManager.onRoadsUpdated(allRoadData)                           |
        |     RoadGraph.buildFromRoads()   ← atomic, aborts prior rebuild    |
        |     buildBuildingIndex()                                            |
        |     restoreMissingRoleBuildings()                                   |
        |                                                                    |
        |   PopulationManager.expandRoles(newBuildings)                      |
        |     → classify commercial buildings → add to role sets             |
        |                                                                    |
        +-- [tile to unload] ───────────────────────────────────────────────+
        |                                                                    |
        |   GlobalMeshManager.clearTile()  → zero GPU buffer slots           |
        |   CarManager.onTileUnloaded()    → start hidden timers             |
        |                                                                    |
        +--------------------------------------------------------------------+

Each animation frame (~60fps):
        TileManager.update()         queue management, retry backoff
        CarManager.update(dt)
          SimClock.update(dt)        advance sim time, detect hour boundaries
          updateNeeds(dt)            decay all person needs
          spawnCars()                TripPlanner → Dijkstra → new car
          animateDriving(dt)         interpolate along waypoints
          processDwelling(dt)        applyActivity(), check dwell timers
          RuntimeTestRunner [2s]     snapshot → runAllTests() → POST results
        THREE.WebGLRenderer.render()
```
