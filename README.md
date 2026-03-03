# Streets Alive

A 3D city map engine with a life simulation layer. Built with Three.js, React, and Vite.

Loads [OpenFreeMap](https://openfreemap.org/) vector tiles (PBF) at zoom 14, decodes buildings and roads in a Web Worker pool, and renders extruded buildings with ribbon-geometry roads in real time. A simulation layer generates households with people who have needs, make decisions through a trip planner, and drive A*-routed cars across the road network.

## Features

- **3D Buildings** — Earcut-triangulated and extruded from vector tile polygons, with a distance-based flatten shader
- **Road Network** — 16 road types with fill, casing, and center lines; divided lanes for major roads; highway elevation tiers with smooth ramps
- **Life Simulation** — Households with people who have needs (energy, hunger, social, fun, health) that decay over time; a trip planner scores activities by urgency (deficit²) and picks destinations
- **Car Traffic** — Cars spawn from households, follow A*-routed paths, animate along roads with a driving/parked state machine, and support multi-select
- **Route Markers** — Floating A/B badges bob above origin and destination buildings for selected cars
- **Runtime Test Panel** — 36 invariant checks across 6 categories run every 2s; toggle with Ctrl+Shift+T
- **Performance** — Unified GPU buffers per layer to minimize draw calls, LRU + IndexedDB geometry caching, async yielding to keep the main thread responsive, and a parallel worker pool for tile decoding

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check and build for production |
| `npm run test` | Run test suite (Vitest) |
| `npm run preview` | Preview production build |

## Architecture

```
PBF tile -> WorkerPool (decode + triangulate + ribbon build)
  -> GeometryCache (LRU + IndexedDB)
  -> GlobalMeshManager (unified per-layer BufferGeometries)
  -> MaterialPool (shared materials with custom shaders)
  -> THREE.Scene
```

```
SimClock (120 sim-sec per real-sec, hour detection)
  -> PopulationManager (households, people, needs, decay)
  -> TripPlanner (score activities by need urgency, deficit²)
  -> CarManager (A* routes, animation, state machine)
  -> RuntimeTestRunner (36 invariant checks every 2s)
```

## Tech Stack

- **Rendering:** Three.js
- **Frontend:** React, TypeScript, Vite
- **UI:** Radix UI, shadcn/ui, Tailwind CSS
- **Tiles:** OpenFreeMap (Mapbox Vector Tiles / PBF)
- **Geometry:** Earcut triangulation, custom ribbon builder with miter joins
- **Testing:** Vitest
