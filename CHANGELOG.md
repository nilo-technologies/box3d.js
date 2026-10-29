# Changelog

## Unreleased

- The README example gallery and tables now link to this repo's examples at `nilo-technologies.github.io/box3d.js` instead of the original fork's.
- `import { DynamicMover } from 'box3d.js/character'` is a JavaScript port of box3d's dynamic character mover (`samples/dynamic_mover.cpp`). A capsule body with locked rotation is driven by a mover joint and held above the ground by a pogo joint, with a skirt of rays for ledges and steep slopes, and it rides kinematic platforms tagged with `platformMaterialId`. Call `update(timeStep, forward, right, throttle, speedScale?)` before each `b3World_Step`; `jump()`, `launch()`, `setGravityScale()` and `destroy()` match the sample, and every tuning value is a public field. It is not compiled into the wasm.
- The `b3World_CastRay` and `b3World_CastShape` callbacks receive the hit shape's `userMaterialId` (a `bigint`) as a fifth argument. The README's ray-cast snippet now names the callback arguments correctly.
- New example: Dynamic Mover, an obstacle course for the capsule character (stair flights, ramps, a bridge, stepping posts, props, a seesaw, a sweeper arm, and a slider, an elevator and a ferry to ride).
- `b3Body_CollideMover(bodyId, origin, mover, filter, bodyTransform)` collides a character mover with one body at a caller-given transform, for example to move a character against dynamic bodies at their predicted pose. It returns a packed buffer (`{ count, data, shapeIds }`, read with `getBodyPlaneResultAt`, which fills `{ shapeId, result }`). The `data` part has the same layout as `b3World_CollideMover` planes, so `getPlaneResultAt` reads it too. box3d reports at most one plane per shape, so the buffer is sized from the body's shape count and needs no capacity argument.

Wheeled vehicles. The [nilo-technologies/box3d](https://github.com/nilo-technologies/box3d) fork adds a vehicle controller to box3d, and box3d.js binds all of it.

- `b3CreateVehicle(worldId, def)` drives an existing dynamic chassis body. `b3DefaultVehicleDef()` is a 1300 kg rear wheel drive sedan.
  - Up to 8 wheels, each with a suspension (frequency, bump and rebound damping, travel, preload, bump stop), a tire (longitudinal and lateral slip curves, rolling resistance), brakes, a handbrake, steering and a ground probe (rounded cylinder, sphere or ray).
  - Engine torque curve, an automatic or manual gearbox with up to 8 gears and a clutch, up to 4 differentials with limited slip, a center limited slip, and anti-roll bars.
  - Steering with speed falloff and Ackermann geometry.
  - Assists: traction control, ABS, a sticky tire that holds the car on slopes, counter steer, handbrake drift grip, downforce, drag, roll influence, air control, self righting and a tilt limit.
  - The car rides on moving and dynamic ground, and pushes back on what it drives over.
- `b3Vehicle_SetInput` takes `{ forward, brake, steer, handbrake }`. `b3Vehicle_SetGear`, `b3Vehicle_Reset`, and `b3Vehicle_Set*`/`Get*` for the chassis, each wheel, the engine, transmission, drivetrain, anti-roll, steering and assists change any setting while driving.
- `createVehicleStateBuffer` / `getVehicleStateData` read the vehicle and all wheels in one call. Decode with `getVehicleStateAt` and `getVehicleWheelAt` into reusable records. `b3Vehicle_GetWheelTransform(outPosition, outRotation, vehicleId, i)` returns one wheel's transform. `b3Vehicle_GetState`, `b3Vehicle_GetWheelState` and `b3Vehicle_GetSprungMass` are also bound.
  - `getVehicleWheelAt` throws a `RangeError` for an index past the packed wheel count (none after the vehicle is destroyed) instead of reading unrelated memory. `destroyVehicleStateBuffer` can be called twice, and a destroyed buffer throws when refilled.
- 50 cars step in about 0.55 ms in Node.
- New examples: Vehicle FWD hatchback, RWD sports car, AWD road car and AWD off-roader, with a shared settings panel and telemetry.

box3d now comes from the [nilo-technologies/box3d](https://github.com/nilo-technologies/box3d) fork, updated to upstream `main` (`3362633`, "Dynamic Mover").

Breaking renames that follow upstream:

- `b3CreateCompoundShape` is now `b3CreateBakedCompoundShape`.
- `b3Body_GetLocalCenterOfMass` / `b3Body_GetWorldCenterOfMass` are now `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter`.
- `b3RecPlayer_Destroy` is now `b3DestroyPlayer`.
- `b3CollideCapsuleAndTriangle(capsuleA, v1, v2, v3)`, `b3CollideHullAndTriangle(hullA, v1, v2, v3, flags)` and `b3CollideSphereAndTriangle(sphereA, v1, v2, v3)` are replaced by `b3CollideTriangleAndCapsule(v1, v2, v3, capsuleB)`, `b3CollideTriangleAndHull(v1, v2, v3, flags, hullB, enableSpeculative)` and `b3CollideTriangleAndSphere(v1, v2, v3, sphereB)`. The triangle comes first, and the manifold normal points from the triangle to the other shape.
- The `b3Profile` field `applyRestitution` is now `restitution`.
- `b3World_RebuildStaticTree` and `b3World_DumpShapeBounds` are gone. Upstream removed the first and no longer implements the second.

New upstream API:

- World:
  - `b3World_SetRestitutionIterations` / `b3World_GetRestitutionIterations`
  - `b3World_EnableRestitutionPropagation` / `b3World_IsRestitutionPropagationEnabled`
  - `b3World_SetIsotropicInertiaTolerance` / `b3World_GetIsotropicInertiaTolerance`
  - The matching `b3WorldDef` fields.
- Body:
  - `b3Body_SetSafetyFactor` / `b3Body_GetSafetyFactor`
  - `b3Body_AllowFastRotation` / `b3Body_IsFastRotationAllowed`
  - `b3Body_GetMinExtent`, `b3Body_GetMaxExtent`, `b3Body_GetMaxExtentOrigin`
  - `b3BodyDef.safetyFactor`.
- Shape: `b3Shape_SetMeshMaterial` and `b3ShapeDef.enableSpeculativeContact`.
- Joints:
  - `b3Joint_IsAwake`.
  - Mover and pogo joints: `b3CreateMoverJoint`, `b3CreatePogoJoint`, their default defs and accessors. These are what upstream uses for dynamic character movers.
- Replay: `b3RecPlayer_SubStepFrame` and `b3RecPlayer_IsAtPreStep`.

## v0.3.0

Debug drawing. `getDebugDraw` runs one `b3World_Draw` pass per role into a reusable wasm buffer, and `box3d.js/three` draws that buffer into a caller-supplied Three.js object.

- `createDebugDrawBuffer` / `getDebugDraw` / `destroyDebugDrawBuffer` collect shapes, segments, points, spheres, capsules, boxes, bounds, and transforms. Role flags: `shapes`, `bounds`, `joints`, `jointExtras`, `mass`, `contacts`, `contactNormals`, `contactForces`, `frictionForces`, `contactFeatures`, `islands`, `graphColors`. Also `forceScale`, `jointScale`, `drawingBounds`, and `maskBits`.
- Each shape is tagged with a `DebugShapeState` (`static`, `kinematic`, `kinematicSleeping`, `awake`, `sleeping`, `sensor`, `disabled`, `fast`, `bullet`, `speedCapped`, `timeOfImpact`, `invalidMass`, `custom`) taken from box3d's packed debug colour.
- `getDebugGeometry(id)` returns the cached triangles, plus sphere and capsule parameters, or `null` once the shape is destroyed. The views alias the wasm heap; copy them to keep them.
- `import { createDebugRenderer } from 'box3d.js/three'` draws the buffer. Pass the page's own `THREE` (`three` or `three/webgpu`) and a parent `Object3D`. `update()` reads `settings` live. `normalScale` stretches contact-normal segments; box3d draws those at 0.3 length units. An update with no segments or points (the default is shapes only) leaves those batches empty instead of throwing.
- New example: Debug Draw. It includes every shape type and every joint type, a sliding contact, and the body states box3d colours, so each debug toggle and the mask and bounds filters change the overlay. World-space labels name each shape, joint, and body state. A decomposed pipe drops onto its own pad and bounces vertically forever at restitution 1; if it leaves the pad it is put back at the drop pose. A `timeScale` slider above the Debug folder speeds or freezes that clock.

## v0.2.0

Convex decomposition: [V-HACD](https://github.com/kmammou/v-hacd) v4.1.0 is compiled into every build, so concave meshes can become collision shapes on dynamic bodies.

- `b3CreateConvexDecompositionShapes(bodyId, shapeDef, positions, indices, options?)` decomposes a mesh and attaches one hull shape per piece to the body in a single wasm call. The shape ids come back packed (`{ count, data, skipped }`, read with `getShapeIdAt`).
- `b3CreateConvexDecompositionShapesAsync(...)` is the Promise variant, and the recommended way to create these shapes. In the multithreaded builds V-HACD runs on a background thread. In browsers, the single-threaded builds run it in a Web Worker started from the module's own source, so no extra file is served; it needs `blob:` workers allowed by the page's CSP, and falls back to the main thread if they're blocked. Node runs it synchronously. The Promise rejects if the body is destroyed before the decomposition finishes.
- The async variants cache their results. An LRU of 512 entries is keyed by a 64-bit hash of the mesh, memoized per array pair, or by `options.cacheKey` (for example an asset id), plus every option that changes the output. Further bodies of the same mesh skip V-HACD: about 0.2 ms per body instead of 1.5 s for a 12-piece torus. Concurrent requests share one decomposition, and failures are not kept. Opt out with `cache: false`; inspect or reset with `b3GetConvexDecompositionCacheStats` / `b3ClearConvexDecompositionCache`; get the key itself with `b3ConvexDecompositionCacheKey`.
- `b3ComputeConvexDecomposition` / `b3ComputeConvexDecompositionAsync` return a packed decomposition (`{ points: Float32Array, offsets: Uint32Array }`) for precomputing assets offline. Rebuild shapes from it with `b3CreateConvexDecompositionShapesFromPacked`, and convert to and from one array per piece with `b3PackConvexDecomposition` / `b3UnpackConvexDecomposition`.
- `b3CreateDecompositionCompound(packed, material?)` builds a compound for static bodies.
- Pieces that box3d can't turn into a hull (hulls are capped at 255 vertices, faces and half-edges) are retried with smaller vertex budgets, and reported in `skipped` if they still fail.
- Options: `maxConvexHulls`, `resolution`, `maxVerticesPerHull`, `minVolumePercentError`, `maxRecursionDepth`, `shrinkWrap`, and `useThreads` (multithreaded builds: V-HACD's 8-thread worker pool). The integer options are clamped to the uint32 range, so `Infinity` or `NaN` can't produce an out-of-range conversion.
- `b3HasThreads()` reports whether the loaded build is multithreaded.
- The wasm grows by about 100 KiB (single-threaded) and 122 KiB (multithreaded).
- New example: Convex Decomposition. V-HACD's license is included as `LICENSE-vhacd`.

## v0.1.1

- Documentation updates to reflect the new API surface and usage patterns, included in the npm package README.md

## v0.1.0

Rework of embind API surface so that box3d.js interops with gl-matrix-style libraries and reads values without allocating JavaScript objects.

- **Breaking:** math types are now plain arrays, matching gl-matrix/mathcat — `b3Vec3` is `[x, y, z]`, `b3Quat` is `[x, y, z, w]`, `b3AABB` is `[minX, minY, minZ, maxX, maxY, maxZ]`. Pass and receive them straight from your existing math library, no wrapper objects or conversion.
- **Breaking:** value reads are out-param-first and zero-allocation. Getters fill a caller-supplied array and return it, e.g. `b3Body_GetPosition(out, bodyId)`; the allocating form that returned a fresh object is gone. Reuse a scratch array per frame to keep the hot path free of GC pressure.
- Removed the pure math-op bindings (`b3Cross`, `b3MakeQuatFromAxisAngle`, `b3AABB_Union`, …). Do vector/quaternion math in JS with gl-matrix/mathcat rather than crossing the wasm boundary for each operation.
- The emitted modules are now validated and post-processed into clean ESM: Emscripten's `require()` calls are rewritten to `await import`, Node builtins are given the `node:` scheme, and the single-file (`*.inline.mjs`) builds have their dead Node file-reader code stripped. The outputs now bundle with no bundler config.

## v0.0.2

- Added `repository`, `homepage`, `bugs`, and `author` fields to `package.json`

## v0.0.1

- Initial release
