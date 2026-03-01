# Architecture

## System Overview

```
+----------------------------------------------------------------------+
|  UI Layer (React)                                                    |
|                                                                      |
|  +----------+   +-------------+   +------------+   +--------------+  |
|  | App.tsx  |-->| MapCanvas   |   | StatusPill |   | TestPanel    |  |
|  +----------+   +------+------+   +------------+   +--------------+  |
|       |                |                                             |
|       v                |         +----------------------------------+|
|  +-----------+         |         | Sidebar Sections                 ||
|  | AppSidebar|-------->|         |  Search | Layers | Drivers | HH  ||
|  +-----------+         |         +----------------------------------+|
+------------------------|---------------------------------------------+
                         |
                         v
+----------------------------------------------------------------------+
|  MapEngine (Orchestrator)                engine.ts                    |
|                                                                      |
|  +--------------------+   +---------------+   +----------------+     |
|  | MapCameraController|   | projection.ts |   | materialPool   |     |
|  | (OrbitControls,    |   | (Mercator,    |   | (stencils,     |     |
|  |  flyTo, bbox)      |   |  LA center)   |   |  shaders)      |     |
|  +--------+-----------+   +---------------+   +----------------+     |
|           |                                                          |
+-----------|----------------------------------------------------------+
            |  viewport changed
            v
+----------------------------------------------------------------------+
|  Tile Pipeline                                                       |
|                                                                      |
|  +-------------+    fetch PBF     +------------------+               |
|  | TileManager |---------------->| vector-tiles.ts  |               |
|  | (load/unload|    +----------->| (LRU + IndexedDB)|               |
|  |  by bbox,   |    |            +--------+---------+               |
|  |  max 128)   |    |                     |                          |
|  +------+------+    |                     v                          |
|         |           |            +------------------+                |
|         |           |            | OpenFreeMap      |                |
|         |           |            | (PBF tiles, z14) |                |
|         |           |            +------------------+                |
|         v           |                                                |
|  +-------------+    |     +--------------------+                     |
|  | WorkerPool  |--->+---->| geometry.worker.ts |                     |
|  | (parallel)  |          | (decode PBF +      |                     |
|  +-------------+          |  earcut triangulate |                     |
|         |                 |  + ribbon build)    |                     |
|         |                 +---------+----------+                     |
|         v                           |                                |
|  +-------------------+              |                                |
|  | GeometryCache     |<-------------+                                |
|  | (LRU + IndexedDB) |                                               |
|  +-------------------+                                               |
+---------|------------------------------------------------------------+
          | geometry arrays
          v
+----------------------------------------------------------------------+
|  Rendering Layer                                                     |
|                                                                      |
|  +---------------------+        +-----------------+                  |
|  | GlobalMeshManager   |------->| THREE.Scene     |                  |
|  | (unified vertex     |        |                 |                  |
|  |  buffers per layer) |        | ground          |                  |
|  +---------------------+        | buildings       |                  |
|                                 | road casings    |                  |
|  +----------------+             | road fills      |                  |
|  | buildings.ts   |             | highway layers  |                  |
|  | (earcut +      |------------>| route lines     |                  |
|  |  extrude)      |             | labels          |                  |
|  +----------------+             | cars            |                  |
|                                 | progress bars   |                  |
|  +----------------+             +-----------------+                  |
|  | roads/         |                   ^                              |
|  |  renderer.ts   |-------------------+                              |
|  |  style.ts      |  16 road types, ribbon geometry,                 |
|  |  elevation.ts  |  miter joins, highway tiers                      |
|  |  labels.ts     |  canvas atlas text labels                        |
|  +----------------+                                                  |
+----------------------------------------------------------------------+
          |  road data
          v
+----------------------------------------------------------------------+
|  Life Simulation                                                     |
|                                                                      |
|  +-------------------+      +----------------+      +-------------+  |
|  | PopulationManager |----->| TripPlanner    |----->| CarManager  |  |
|  | (households,      |      | (score actions |      | (Dijkstra   |  |
|  |  people, needs    |      |  by need       |      |  routes,    |  |
|  |  with decay)      |      |  urgency)      |      |  animation) |  |
|  +-------------------+      +----------------+      +------+------+  |
|           ^                                                |         |
|           |                 +----------------+             |         |
|           +-----------------|RuntimeTestRunner|            |         |
|                             | (validate sim  |<-----------+         |
|  +----------------+        |  invariants    |                       |
|  | ProgressBar    |<-------+  every 2s)     |  +-----------------+  |
|  | Manager        |        +----------------+  | roads/graph.ts  |  |
|  | (activity bars |                            | (graph build +  |  |
|  |  above cars)   |                            |  Dijkstra +     |  |
|  +----------------+                            |  building index)|  |
|                                                +-----------------+  |
+----------------------------------------------------------------------+
```

## Data Flow

```
Camera viewport changes
        |
        v
+--- TileManager: bboxToTiles(z14) ---+
|                                      |
|   Is geometry cached (IndexedDB)?    |
|       |              |               |
|      YES             NO              |
|       |              |               |
|       v              v               |
|   GeometryCache   OpenFreeMap        |
|   returns arrays   fetch PBF        |
|       |              |               |
|       |              v               |
|       |          WorkerPool          |
|       |          decode + build      |
|       |              |               |
|       |              v               |
|       |          Cache result        |
|       |          in IndexedDB        |
|       |              |               |
|       +------+-------+              |
|              |                       |
|              v                       |
|     Create meshes                    |
|     (buildings, roads, labels)       |
|              |                       |
+--------------|-----+-----------------+
               |     |
               v     v
         THREE.Scene   road data updated
                           |
                           v
                    +-- CarManager --+
                    |                |
                    v                v
              rebuild graph    PopulationManager
              (Dijkstra)       init households
                    |                |
                    |                v
                    |          needs decay
                    |          over time
                    |                |
                    |                v
                    |          TripPlanner
                    |          scores activities
                    |                |
                    +-------+--------+
                            |
                            v
                       spawn car
                       animate along route
                       show progress bar
```

## Render Layer Stack

```
  Y
  ^
  |
  |   Buildings (variable height, flatten shader at distance)
  |
0.50  Road labels (canvas atlas text)
0.45  Route lines (car paths)
  |
0.40  Highway center lines
0.35  Highway fill
0.30  Highway casing
0.25  Highway shadow
0.20  Highway mask (stencil)
  |
0.15  Local road fills
0.05  Local road casings
0.00  Ground plane
  +------------------------------------------------------->
```

## Car State Machine

```
                 spawn
                   |
                   v
              +---------+
              |  Idle   |
              +---------+
                   |
                   | trip planned (Dijkstra route)
                   v
              +---------+    route invalid    +---------+
              | Driving |-------------------->|  Idle   |
              +---------+                     +---------+
                   |
                   | arrived at destination
                   v
              +---------+
              | Parked  |  show progress bar
              |         |  satisfy needs over duration
              +---------+
                   |
                   | activity complete (return home or new trip)
                   v
              +---------+
              | Driving |
              +---------+
```

## Coordinate System

```
  LatLng (WGS84)              Scene Space (meters)
  lat: 34.0522        project()        x: East
  lng: -118.2437   ------------->      z: South (negated Mercator Y)
                   <-------------      y: Height (up)
                    unproject()

  Projection center: Los Angeles (34.0522, -118.2437)
  All coordinates relative to center
```
