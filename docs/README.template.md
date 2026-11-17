# box3d.js

WebAssembly bindings for [box3d](https://github.com/erincatto/box3d) - Erin Catto's 3D rigid body physics engine - compiled with Emscripten and exposed as an ES module with full TypeScript definitions.

The API mirrors the box3d C API 1:1 (`b3CreateWorld`, `b3World_Step`, …) so the upstream docs and samples translate relatively directly.

```bash
npm install box3d.js
```

**Builds**

| Import | Use case |
|--------|----------|
| `box3d.js/inline` | Browser - single-file, no separate `.wasm` to serve |
| `box3d.js` | Node.js or bundlers that can serve `.wasm` |
| `box3d.js/mt-inline` | Browser + multithreading (requires cross-origin isolation) |
| `box3d.js/mt` | Node.js + multithreading |

**Examples**

<Examples />

## Table of Contents

<TOC />

## Quick Start

Initialize the WASM module once with `await Box3D()`, then call the physics API through the returned module object.

<Snippet source="./quick-start.ts" />

## What Is box3d?

box3d is Erin Catto's 3D rigid body engine — the 3D sibling of Box2D, from the author of Box2D itself.

## Physics World

### Creating a World

<Snippet source="./world.ts" select="create-world" />

`b3DefaultWorldDef()` returns a world definition with sensible defaults. Common fields to override:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gravity` | `b3Vec3` | `[0, 0, 0]` | World gravity vector |
| `workerCount` | `number` | `0` | Thread count for the MT build (see [Multithreading](#multithreading)) |
| `maximumLinearSpeed` | `number` | `500` | Speed cap - raise this for CCD bullet bodies |

### Stepping the Simulation

<Snippet source="./world.ts" select="step" />

Call `b3World_Step` in your game loop. `subStepCount` controls solver accuracy - 4 is a good default.

<Snippet source="./world.ts" select="game-loop" />

### Destroying a World

<Snippet source="./world.ts" select="destroy" />

### Memory Management

box3d.js wraps a WASM module, so some objects are allocated on the WASM heap and must be freed explicitly.

**Hull data is copied** into the world's internal database on shape creation, so `b3HullData` handles can be destroyed immediately after - or reused across multiple shapes before being destroyed.

**Mesh, compound, and heightfield data are not copied** - the world stores a raw pointer. `b3MeshData`, `b3CompoundData`, and `b3HeightFieldData` must be kept alive for as long as the shape (or world) exists, and destroyed only after.

<Snippet source="./memory.ts" select="geometry-lifetime" />

**Destroying a world** frees all bodies, shapes, and joints inside it automatically - no need to clean them up individually first.

<Snippet source="./memory.ts" select="world-cleanup" />

**Removing objects during simulation** - use the individual destroy functions. Destroying a body also removes all its shapes and any joints attached to it.

<Snippet source="./memory.ts" select="runtime-removal" />

### Units and Scale

box3d uses SI units and a right-handed coordinate system (+Y up by default):

- **Length**: metres (m)
- **Mass**: kilograms (kg) - note: default shape density is **1000 kg/m³**
- **Time**: seconds (s)
- **Triangle winding**: counter-clockwise (CCW) is the front face

## Rigid Bodies

### Body Types

<Snippet source="./bodies.ts" select="body-types" />

| Type | Moves | Affected by forces | Collides with |
|------|-------|-------------------|---------------|
| `b3_staticBody` | Never | No | Dynamic only |
| `b3_dynamicBody` | Simulated | Yes | All types |
| `b3_kinematicBody` | Scripted | No | Dynamic only |

<ExamplesTable ids="example-shapes,example-cube-heap" />

### Position and Rotation

Math types are plain arrays: `b3Vec3` is `[x, y, z]` and `b3Quat` is `[x, y, z, w]` (the identity rotation is `[0, 0, 0, 1]`) — pass and receive them straight from gl-matrix/mathcat-style libraries. Value getters are out-param-first and zero-allocation: pass a scratch array to fill instead of receiving a freshly allocated object.

<Snippet source="./bodies.ts" select="transform" />

### Velocity

<Snippet source="./bodies.ts" select="velocity" />

### Forces and Impulses

Forces accumulate until the next `b3World_Step` call, then clear. Impulses apply an instant velocity change.

**Important:** box3d's default shape density is 1000 kg/m³, making bodies much heavier than in most engines. Scale your impulse magnitudes by the body's mass to get predictable results.

<Snippet source="./bodies.ts" select="forces" />

<ExamplesTable ids="example-add-impulse-at-position,example-explosion" />

### Constant Forces

`b3Body_ApplyForce` lasts one step. A constant force or torque is kept by the bindings and re-applied by every `b3World_Step` (without waking the body) until it is changed, cleared, or the body is destroyed.

<Snippet source="./bodies.ts" select="constant-forces" />

### Damping

<Snippet source="./bodies.ts" select="damping" />

<ExamplesTable ids="example-linear-damping,example-angular-damping" />

### Gravity Scale

<Snippet source="./bodies.ts" select="gravity-scale" />

<ExamplesTable ids="example-gravity-factor" />

### Sleeping

Bodies at rest are put to sleep automatically to save CPU. You can also control sleep manually.

<Snippet source="./bodies.ts" select="sleeping" />

### Continuous Collision Detection

Enable CCD for fast-moving objects (bullets, projectiles) to prevent tunneling through thin walls.

<Snippet source="./bodies.ts" select="ccd" />

<ExamplesTable ids="example-ccd" />

### Changing Body Type

<Snippet source="./bodies.ts" select="change-type" />

### Kinematic Bodies

Use `b3Body_SetTargetTransform` to move kinematic bodies each frame. box3d computes the velocities needed to reach the target, so dynamic bodies are pushed physically rather than teleported through.

<Snippet source="./bodies.ts" select="kinematic-move" />

### Material Properties

Friction and restitution can be set per shape at creation, or updated at runtime via `b3Shape_SetSurfaceMaterial`.

<Snippet source="./bodies.ts" select="material" />

Mixing defaults to `sqrt(frictionA * frictionB)` and `max(restitutionA, restitutionB)`. `b3World_SetMixingRules` picks another rule per world, including a weighted average with per-shape weights. The weighted rule reads the weights from `userMaterialId`, so while it is active that field can't double as a material tag.

<Snippet source="./bodies.ts" select="mixing-rules" />

<ExamplesTable ids="example-friction,example-restitution" />

### Collision Filtering

box3d filters collisions with `bigint` category and mask bits. A contact fires when `(categoryA & maskB) != 0n AND (categoryB & maskA) != 0n`.

<Snippet source="./bodies.ts" select="collision-filter" />

<ExamplesTable ids="example-collision-filtering" />

### Sensors

Sensor shapes detect overlaps without generating contact forces. Both the sensor and each visitor shape must opt in to sensor events.

<Snippet source="./bodies.ts" select="sensor" />

<ExamplesTable ids="example-sensor" />

## Shapes

box3d shapes attach to a body and define its collision geometry. A body can have multiple shapes.

### Box

<Snippet source="./shapes.ts" select="box" />

### Sphere

<Snippet source="./shapes.ts" select="sphere" />

### Capsule

<Snippet source="./shapes.ts" select="capsule" />

### Convex Hull

<Snippet source="./shapes.ts" select="hull" />

### Cylinder and Cone

<Snippet source="./shapes.ts" select="cylinder-cone" />

### Triangle Mesh

Triangle meshes are best suited for static terrain and level geometry. box3d performs internal preprocessing (active edges, BVH) on mesh creation.

<Snippet source="./shapes.ts" select="mesh" />

<ExamplesTable ids="example-triangle-mesh" />

### Compound Shapes (Static Only)

Compound shapes combine multiple child shapes on a single body. **In box3d, compound shapes are static-only** - `b3_dynamicBody` and `b3_kinematicBody` will reject compound shapes.

<Snippet source="./shapes.ts" select="compound" />

<ExamplesTable ids="example-static-compound" />

### Convex Decomposition (V-HACD)

Triangle meshes are meant for static geometry, so for a concave object that has to move, box3d.js bundles [V-HACD](https://github.com/kmammou/v-hacd) to split them into convex pieces. On a dynamic or kinematic body, each piece becomes its own hull shape on the same body: the pieces move as one rigid object and never collide with each other. On a static body, put the pieces into one compound shape instead.

<Snippet source="./shapes.ts" select="decomposition-dynamic" />

The result follows the same `{ count, data }` layout as the other shape id buffers, plus a `skipped` count. A piece is skipped only when box3d can't build a hull from it, even after retrying with smaller vertex budgets (box3d hulls are capped at 255 vertices, faces and half-edges).

<Snippet source="./shapes.ts" select="decomposition-async" />

In the multithreaded builds, the Promise variants run V-HACD on a thread of their own, and `useThreads: true` also runs its internal stages on 8 more threads. The Promise variants' threads start on demand when the pool has none idle. The blocking call needs all 8 idle in the pool (`pthreadPoolSize`) and runs without them otherwise; it also spin-waits on the browser main thread, so prefer the Promise variant (or a Web Worker) there.

<Snippet source="./shapes.ts" select="decomposition-static" />

<Snippet source="./shapes.ts" select="decomposition-cache" />

#### Keeping openings open: the surface merge

V-HACD cuts the mesh into many small pieces and then merges them down to `maxConvexHulls` by volume. An opening is cheap in volume, so that merge can close a doorway or a window, and it stops as soon as the budget is met, however many pieces could still merge for free. With a `surfaceMerge` option, V-HACD hands over all its pieces and box3d merges them against the mesh surface instead (`b3MergeConvexPieces` in the engine). Neighboring pieces merge cheapest first, the way [HACD](https://kmamou.blogspot.com/2011/10/hacd-hierarchical-approximate-convex.html) collapses the edges of its dual graph. The cost of a merge is the depth of open space the merged hull would seal, measured as Roblox describes in [A Search for Better Convex Decomposition](https://medium.com/@val.v.gorbunov/a-search-for-better-convex-decomposition-671ea647cec): points are sampled on the mesh triangles, a ray is cast outward from each, and the run of the ray inside the hull is what the hull seals there. Merging stops when the next merge would seal more than a limit, and by default the merge finds that limit itself, with a sweep (next section).

<Snippet source="./shapes.ts" select="decomposition-merge" />

- The limit is a length in mesh units. A doorway reads as its width, so a limit of 5 cm aims to keep every opening wider than 5 cm, while a sliver of hull lying against a wall reads as its thickness. Two things can seal more: merges forced by `maxConvexHulls`, and an opening thin enough to fall between the sample points (`concavitySamples`).
- To give the limit yourself, pass `maxConcavity` with `sweep: false`. A `maxConcavity` alone also turns the merge on, and then caps the sweep: no step merges to a looser limit.
- The hull count follows from the shape: at a limit of 5 cm a wall with a doorway needs 6 hulls where V-HACD spends the 16 it was given. `maxConvexHulls` stays a hard cap. When the limit leaves more hulls than that, merging goes on past it, still shallowest first, and `maxConcavity` on the result reports what that sealed.
- The result carries `concavities` (one per piece) and `maxConcavity`, the depth each hull seals.
- The merge can only be as tight as V-HACD's pieces, which overshoot the surface by about a voxel. Raise `resolution` for a closer fit.
- The mesh should be closed, since the outward side of each triangle comes from the mesh's signed volume. Either winding works.
- The whole call takes about as long as before. Merged to one limit of 5 cm it took 9% less over the test meshes in total, from 21% less to 15% more on a single mesh, and the sweep adds little to that. V-HACD skips its own merge, which compares every pair of pieces, and the surface merge only looks at neighbors.
- It trades volume for depth. Where it merges further than V-HACD it can cover more volume outside the mesh, a few centimeters deep over a wide area: at a limit of 5 cm a table top and its legs become 5 hulls that cover 14% more than the table, where V-HACD's 16 cover 3%. A tighter limit fits closer.

![A wall with a doorway: V-HACD with 16 hulls, the surface merge to 5 cm under the same budget, and the surface merge to 5 cm alone](./docs/images/decomposition/doorway.png)

`pnpm bench:decomposition:quality` compares the two merges on a set of test meshes, the surface merge at a limit of 5 cm: hull count, time, the deepest open space sealed, and the volume the hulls cover outside the mesh or miss inside it.

#### How many hulls: the sweep

How many hulls a mesh needs depends on the limit, and the right limit is rarely known up front. So by default the surface merge sweeps it: V-HACD's pieces are merged at a series of loosening limits, and the step with the best trade between few hulls and little sealed is kept. Each limit carries on from the hulls the one before left, so the whole sweep takes about as long as a single merge, and the hull count never rises along it. `b3SweepConvexDecomposition` is the same decomposition, returned with what the sweep saw.

<Snippet source="./shapes.ts" select="decomposition-sweep" />

- By default the sweep runs 9 limits from 0.5% to 8% of the diagonal of the mesh's bounding box, each 1.41 times the one before. On a wall 4 m wide and 3 m tall that is 2.5 cm to 40 cm. `minConcavity`, `maxConcavity` and `sweepSteps` change the range and the count.
- The step kept: hull count and sealed depth are each scaled by their largest value in the sweep, and the step nearest to no hulls and nothing sealed wins. `hullWeight` leans it: above 1 toward fewer hulls, below 1 toward a closer fit.
- From `b3SweepConvexDecomposition`, `steps[i]` has the limit (`maxConcavity`), the `hullCount` and the `sealedDepth` its hulls really seal, `best` is the index of the step kept, and `decomposition` has its hulls. It takes a decomposition's options and gives the hulls `b3ComputeConvexDecomposition` gives with `surfaceMerge`.
- On blocky meshes the first steps often share one `sealedDepth`: V-HACD's own pieces already seal that much, and no limit below it changes what the hulls seal, only how many there are. The step kept usually lands at the end of that run, the fewest hulls that seal no more than the pieces did.
- The step kept is a heuristic over this sweep, and it moves with the range swept. It is not a proof of the fewest hulls possible: the merge is greedy and can only join the pieces V-HACD cut.
- `maxConvexHulls` is a budget every step meets. It is 32 by default, as for any decomposition, so a mesh that wants more hulls at the tight end of the sweep needs it raised.
- A decomposition with `surfaceMerge` goes through the Promise variants and their cache like any other. `b3SweepConvexDecompositionAsync` is not cached. It keeps the work off the calling thread where it can: on a thread of its own in the multithreaded builds, in a Web Worker in the single-threaded builds in a browser. In single-threaded Node it runs on the calling thread, and the Promise resolves once it is done.

`pnpm bench:decomposition:quality --sweep` prints the sweep of each test mesh and the step kept.

#### Experimental: tighter pieces, or none

Three options of the surface merge are experimental. They are off by default and may change or go: they are being measured against each other.

- `splitPieces: true` fits each V-HACD piece to the mesh before merging, so it stops reaching past the surface by a voxel, and cuts the pieces that seal more than the tightest limit. The merge is then no longer held to what V-HACD's pieces sealed as they came.
- `sampleSpacing` spaces the sample points by a multiple of the tightest limit, so their number follows from the area of the mesh instead of `concavitySamples`.
- `seedTriangles: true` starts the merge from the triangles of the mesh instead of V-HACD's pieces, as [HACD](https://kmamou.blogspot.com/2011/10/hacd-hierarchical-approximate-convex.html) and the Roblox article do. V-HACD does not run, so nothing snaps to a voxel grid and a mesh of a few thousand triangles takes a fraction of a second. The hulls follow the surface, though, so the inside of a thick solid can stay uncovered, and the time grows with the triangle count where V-HACD's does not.

`pnpm bench:decomposition:quality --versions` sets them against the merge as it is.

<ExamplesTable ids="example-convex-decomposition" />

### Resizing and Disabling Shapes

<Snippet source="./shapes.ts" select="resize-disable" />

## Joints

Joints constrain the relative motion between two bodies. All joint defs share a `bodyIdA` / `bodyIdB` pair. Joint frames (`frameA`, `frameB`) are local-space transforms that define where and how the joint attaches.

**Axis conventions:**
- Revolute: rotates about the joint frame's local **Z**-axis
- Prismatic: slides along the joint frame's local **X**-axis
- Cylindrical: rotates about frame A's local **X**-axis and slides along `localSlideAxisA` (also **X** by default)
- Spherical: cone centered on frame **Z**

<ExamplesTable ids="example-constraints,example-hinge-motor" />

### Revolute (Hinge)

<Snippet source="./joints.ts" select="revolute" />

### Revolute Motor

<Snippet source="./joints.ts" select="revolute-motor" />

### Weld (Fixed)

<Snippet source="./joints.ts" select="weld" />

### Distance

<Snippet source="./joints.ts" select="distance" />

Springs can also be given in physical units (stiffness and damping), which keeps the force independent of the body masses:

<Snippet source="./joints.ts" select="distance-stiffness" />

### Spherical (Ball and Socket)

<Snippet source="./joints.ts" select="spherical" />

### Prismatic (Slider)

<Snippet source="./joints.ts" select="prismatic" />

### Cylindrical (Slide and Spin)

<Snippet source="./joints.ts" select="cylindrical" />

### Wheel (Suspension)

<Snippet source="./joints.ts" select="wheel" />

## WheeledVehicles

`b3CreateWheeledVehicle` turns a dynamic body into a drivable car. Each wheel casts against the world once per step (a rounded cylinder by default; set the wheel's `castType` to `b3_wheeledVehicleCastSphere` or `b3_wheeledVehicleCastRay` for a sphere or a ray), and is solved as a soft suspension plus a tire with a slip curve in every substep. The engine, clutch, gearbox and differentials are solved together once per step, so wheelspin, engine braking and limited slip fall out of the same model. Driving assists (traction control, launch control, ABS, a sticky tire that holds the car on slopes, counter steer, air control, self righting) are on top and can each be turned off. WheeledVehicles are not supported in recorded worlds.

<Snippet source="./wheeled-vehicle.ts" select="create" />

### Driving

<Snippet source="./wheeled-vehicle.ts" select="drive" />

### Reading the Vehicle State

<Snippet source="./wheeled-vehicle.ts" select="read" />

To place wheel meshes under the chassis mesh, read the wheels in chassis space instead. `b3WheeledVehicle_GetWheelLocalData(out, wheeledVehicleId)` fills a `Float32Array` with every wheel in one call and returns the wheel count. Each wheel takes `B3_WHEELED_VEHICLE_WHEEL_LOCAL_STRIDE` (11) floats: the position (the attachment point lowered along the chassis up axis by the suspension length), the rotation (steer about the chassis up axis, then spin about the axle), then the raw `rotationAngle`, `angularVelocity`, `steerAngle` and `suspensionLength`. Multiplying this pose by the chassis transform reproduces `b3WheeledVehicle_GetWheelTransform`, for any chassis axes, so a wheel mesh parented to the chassis mesh can take it as is. To draw the wheels between physics steps, keep the previous step's readout, unwrap each wheel's spin with `angularVelocity`, and blend, as below. `b3WheeledVehicle_GetWheelLocalTransform(outPosition, outRotation, wheeledVehicleId, wheelIndex)` reads one wheel.

<Snippet source="./wheeled-vehicle.ts" select="wheels-local" />

### Live Tuning

<Snippet source="./wheeled-vehicle.ts" select="tune" />

### Turbos and Superchargers

`b3WheeledVehicleTurbo` (in the definition as `turbo`, live through `b3WheeledVehicle_SetTurbo`) adds forced induction to the engine: up to two compressor stages, each with a gain, an rpm range where its boost builds, a lag that shortens with rpm and load, and a shaft that keeps spinning through shifts and short lifts while the boost itself dumps. The pedal asks for a share of the fully boosted torque, so boost builds near full pedal. That covers a single turbo, a sequential twin, a supercharger (no lag, plus a parasitic drive loss) and rally anti-lag. The default is naturally aspirated. `state.boost` reads the current boost, in both `b3WheeledVehicle_GetState` and the packed readout.

<Snippet source="./wheeled-vehicle.ts" select="turbo" />

### Presets

`box3d.js/wheeled-vehicles` exports ready tuned cars: the four original presets (`fwd` hatchback, `rwd` sports car, `awd` road car, `offroad`) and 45 matrix presets: a sports car, a rally car and a supercar, each at five realism levels (100, 75, 50, 25 and 0 for arcade) and each as FWD, RWD or AWD, named `<car>-<realism>-<drive>`, for example `rally-50-awd`. They are built in layers: the car (`wheeledVehicleCars`), then the drivetrain (`drivetrainLayers`), then a realism table shared by every car (`realismLevels`), then an optional turbo type (`turboTypes`). It is plain JavaScript with no imports, so it also runs in Node. The presets are tuned for keyboard players driving through `createSteeringLimiter`, a driver aid applied to the steer input that caps the steer angle near the front tires' grip limit (tighter while braking); without it, full lock at speed can spin the less realistic cars.

<Snippet source="./wheeled-vehicle.ts" select="presets" />

The vehicle example has a tuning panel, `examples/src/vehicle-settings.ts`, which live-edits the chassis mass and center of mass, suspension, wheels, tires, anti-roll bars, engine, turbo, transmission, drivetrain, steering and assists of any vehicle. Wheel positions, the chassis axes and the cast filter are not in the panel; change them with the `b3WheeledVehicle_Set*` setters. The presets it drives come from `box3d.js/wheeled-vehicles`.

The example, a preset showcase, swaps between 45 presets while you drive: a sports car, a rally car and a supercar, each at five realism levels from 100% realistic to arcade, and each as FWD, RWD or AWD. They are built in layers (the car, then the drivetrain, then a realism table shared by every car), and `examples/scripts/vehicle-metrics.mjs` measures any preset (0-100, top speed, braking, lateral g, a step steer, a handbrake turn, self righting and rough ground) against targets taken from real cars of each class. Its terrain menu also has two race tracks, a paved circuit and an off-road stage, each with corners, climbs and descents, a section of bumps of different sizes and a lap timer; `examples/scripts/vehicle-laps.mjs` drives every preset around both. The circuit's road is a triangle mesh over the height field, with edges that ease down to the ground. Every setting changed in the panel goes into the URL, so a tuned car can be shared as a link.

<ExamplesTable ids="example-vehicle-showcase" />

## Queries

Queries ask questions about the physics world without advancing the simulation.

### Cast Ray (Closest)

<Snippet source="./queries.ts" select="cast-ray" />

<ExamplesTable ids="example-cast-ray" />

### Cast Ray (All Hits)

<Snippet source="./queries.ts" select="cast-ray-all" />

### Cast Shape (Shapecast)

Sweep a sphere proxy through the world and find the closest hit.

<Snippet source="./queries.ts" select="cast-shape" />

<ExamplesTable ids="example-cast-shape" />

### Overlap AABB

<Snippet source="./queries.ts" select="overlap-aabb" />

### Overlap Shape

<Snippet source="./queries.ts" select="overlap-shape" />

### Query Filter

<Snippet source="./queries.ts" select="query-filter" />

### Filtered Queries

The callback queries call into JS once per candidate shape. When the only reason for the callback is to skip some bodies, shapes or sensors, the `*Filtered` / `*Packed` variants take a `b3QueryOptions` and do the skipping natively. `b3World_CollideMoverPacked` and the closest-hit variants return one copied `Float64Array`; `b3World_CastMoverFiltered` returns the sweep fraction, like `b3World_CastMover`.

<Snippet source="./queries.ts" select="filtered-queries" />

## Events

box3d surfaces physics events (contacts, sensors, body moves, joints) each `b3World_Step`. Events are opt-in per shape. Rather than allocating a JS object per event every step — which does not scale — box3d.js reads them through a **reusable, wasm-backed events buffer**: allocate the buffer (and small reader scratch objects) once, refill it each step with `getEvents`, and read it back with zero allocation. Free it with `destroyEventsBuffer` when done.

### Contact Events

<Snippet source="./events.ts" select="contact-events" />

<ExamplesTable ids="example-events" />

### Reading Contacts Every Frame

Events fire when contacts begin, end, or hit. To instead inspect **every current contact manifold** each frame — for debug drawing, gameplay logic, or custom response — use a reusable, wasm-backed contacts buffer. This is the recommended fast path: its storage lives in the wasm heap and grows on its own, so refilling it each frame copies nothing across the wasm/JS boundary and allocates no typed arrays. You allocate the buffer (and small reader scratch objects) once, fill it in place each frame, and free it when done.

<Snippet source="./events.ts" select="contacts-buffer" />

<ExamplesTable ids="example-contacts" />

### Sensor Events

<Snippet source="./events.ts" select="sensor-events" />

<ExamplesTable ids="example-sensor" />

### Packed Reads

Callers that can't read the wasm heap directly (a sandbox, a worker membrane) can take body move events and body poses as one copied typed array each.

<Snippet source="./events.ts" select="packed-reads" />

### Pre-Solve Callback

The pre-solve callback fires for each contact before the constraint solver runs. Return `false` to suppress the contact response entirely (useful for one-way platforms).

<Snippet source="./events.ts" select="pre-solve" />

## Debug Draw

box3d can draw the world it is simulating: shape outlines, contacts, joints, mass axes, bounds, and islands. `getDebugDraw` runs one `b3World_Draw` pass per enabled role into a reusable wasm buffer, the same pattern as contacts and events. Readers (`getDebugShapeAt`, and one per other tier) fill a scratch object in place.

Shape triangles are built once, the first time that shape is drawn, and freed when the shape or the world is destroyed. `getDebugGeometry` returns views of that cache (or `null`). Copy them out; they alias the wasm heap. Hulls, meshes, and height fields come back as triangles. Spheres and capsules come back as parameters. A compound is one triangle list plus a parameter list for its sphere and capsule children.

`box3d.js/three` turns the buffer into Three.js objects. It does not import `three`. Pass the same `THREE` namespace the rest of the page uses, so `three` and `three/webgpu` both work. `null` in `colors` keeps box3d's own colour. Mass has no box3d colour, so `colors.mass: null` is white.

Set `settings.camera` to cull to that camera. Each `update` draws inside the AABB of the camera's frustum, cut down to `drawingBounds` when that is set too. box3d's broadphase skips every shape outside that box, along with those bodies' joints, contacts and mass markers. The box is coarser than the frustum, so some shapes and overlays just outside the view are still drawn, and it grows with the far plane, so set `cullDistance` to cap it. Three's own frustum culling then skips shape meshes and edge lines that are out of view. The shared lines and points (joints, contacts, bounds, mass) are drawn for everything inside the box. Shapes that leave the view stay cached, hidden, for `shapeCacheFrames` updates (300 by default), so panning back does not rebuild them.

<Snippet source="./debug-draw.ts" select="debug-draw" />

<ExamplesTable ids="example-debug-draw" />

## Character Controller

`box3d.js/character` exports `DynamicMover`, a port of the dynamic character mover from box3d's samples (`samples/dynamic_mover.cpp`). The capsule is a dynamic body with locked rotation, so it pushes and is pushed by the rest of the world. A mover joint drives it toward the target velocity, and a pogo joint holds it above the ground, so it climbs steps without the capsule touching them. When the central pogo ray misses or hits a slope too steep to walk, a skirt of 8 rays around the capsule lets it stand on ledges and rails. A kinematic body whose shapes use `platformMaterialId` as their `userMaterialId` carries the mover with it. As in upstream, only the platform's linear velocity is matched, so translating platforms carry the character and spinning ones don't.

It is plain JavaScript on top of the bindings, not part of the wasm. Upstream intends this controller to be changed for each game, so every tuning value is a public field, and the class is small enough to subclass or copy.

<Snippet source="./character.ts" select="dynamic-mover" />

<ExamplesTable ids="example-dynamic-mover" />

## Multithreading

box3d's internal solver can spread work across OS threads via Emscripten pthreads. This requires `SharedArrayBuffer`, which in turn requires [cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).

**Required HTTP headers:**
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Initialization

<Snippet source="./multithreading.ts" select="mt-init" />

### World Setup

<Snippet source="./multithreading.ts" select="mt-world" />

### Stepping

<Snippet source="./multithreading.ts" select="mt-step" />

The simulation API is identical to the single-threaded build - only the import path and `workerCount` differ.

### Threads

The threaded build starts a pool of threads as it loads, each a Web Worker running its own instance of the module: 4 by default, or `pthreadPoolSize` in the factory's options. A world (and a recording player) takes one thread per worker past the calling thread, synchronously, and joins them when destroyed. A thread made on demand starts only once the calling thread returns to its event loop, so a world takes only idle pool threads: one asking for more workers steps on the idle threads plus the calling one. box3d steps a world to the same bits at any worker count, so this changes only its speed. `b3World_GetWorkerCount` reads what the world got.

<ExamplesTable ids="example-multithreading" />

## Building from Source

### Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - `emcmake` and `em++` must be on `PATH`. The published builds are produced with **emsdk 6.0.2** (emcc/clang 6.0.2); other recent versions should work.
- [CMake](https://cmake.org/) ≥ 3.22
- Node.js ≥ 18
- pnpm

```bash
# Install the pinned Emscripten version and activate the environment
cd /path/to/emsdk
./emsdk install 6.0.2
./emsdk activate 6.0.2
source ./emsdk_env.sh
```

### Build

```bash
git clone --recurse-submodules <repo-url>
pnpm install
pnpm build
```

Outputs to `dist/`:

| File | Description |
|------|-------------|
| `box3d.mjs` + `box3d.wasm` | Single-threaded, separate WASM |
| `box3d.inline.mjs` | Single-threaded, inlined WASM |
| `box3d.mt.mjs` + `box3d.mt.wasm` | Multithreaded, separate WASM |
| `box3d.mt.inline.mjs` | Multithreaded, inlined WASM |
| `box3d.d.ts` | TypeScript definitions (shared by all builds) |

```bash
# Debug build
pnpm build:debug

# Smoke test (simulation, buffers and convex decomposition on the ST and MT builds)
pnpm test
```

### Docs

```bash
# Regenerate README.md from docs/README.template.md
pnpm docs:build

# Typecheck all code snippets in docs/
pnpm docs:check
```
