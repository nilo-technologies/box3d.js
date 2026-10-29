# Changelog

## Unreleased

Engine features for a Roblox-faithful physics port. `vendor/box3d` moves to `nilo-technologies/box3d` `feat/roblox-physics`, which is box3d's current `main` (mover and pogo joints, broad-phase and solver work, recording format 6) plus the cylindrical joint, shape enable/disable, and distance-joint springs in stiffness units (recording format 7).

**Breaking**, following box3d's API changes:

- `b3CreateCompoundShape` is now `b3CreateBakedCompoundShape` (static bodies only, as before).
- `b3Body_GetLocalCenterOfMass` / `b3Body_GetWorldCenterOfMass` are now `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter`.
- The triangle manifold helpers put the triangle first and their normal now points from the triangle to the other shape: `b3CollideTriangleAndCapsule(v1, v2, v3, capsuleB)`, `b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hullB, enableSpeculative)`, `b3CollideTriangleAndSphere(v1, v2, v3, sphereB)` replace `b3CollideCapsuleAndTriangle`, `b3CollideHullAndTriangle`, `b3CollideSphereAndTriangle`.
- `b3RecPlayer_Destroy` is now `b3DestroyPlayer`. `b3Profile.applyRestitution` is now `restitution`.
- `b3World_RebuildStaticTree` and `b3World_DumpShapeBounds` are gone (box3d removed them).
- New def fields with box3d's defaults: `b3WorldDef.restitutionIterations`, `enableRestitutionPropagation`, `isotropicInertiaTolerance`; `b3BodyDef.safetyFactor`; `b3ShapeDef.enableSpeculativeContact`. `b3PlaneResult` gains `triangleIndex`, `childIndex`, `materialIndex`. `b3JointType` gains `b3_moverJoint` and `b3_pogoJoint`.

New:

- Cylindrical joint: `b3_cylindricalJoint`, `b3DefaultCylindricalJointDef()`, `b3CreateCylindricalJoint(worldId, def)`. Body B rotates about frame A's x-axis and slides along `def.localSlideAxisA` (frame A x by default, which makes the joint coaxial; any other direction in frame A is allowed). The translation has a spring (`enableSpring`, `hertz`, `dampingRatio`, `targetTranslation`), limit (`enableLimit`, `lowerTranslation`, `upperTranslation`), and motor (`enableMotor`, `maxMotorForce`, `motorSpeed`); the rotation has its own (`enableAngularSpring`, `angularHertz`, `angularDampingRatio`, `targetAngle`, `enableAngularLimit`, `lowerAngle`, `upperAngle`, `enableAngularMotor`, `maxMotorTorque`, `angularMotorSpeed`). `b3CylindricalJoint_*` setters and getters, plus `GetTranslation`, `GetSpeed`, `GetAngle`, `GetAngularSpeed`, `GetMotorForce`, and `GetMotorTorque`. Debug draw shows it like the other joints.
- `b3World_SetMixingRules(worldId, frictionRule, restitutionRule)` installs native friction and restitution mixing callbacks (no JS call per contact; safe in the multithreaded builds). Rules are the plain numbers in `b3MixingRule`: `geometric` (box3d's default for friction), `average`, `min`, `max` (box3d's default for restitution), `multiply`, and `robloxWeighted`. `robloxWeighted` reads Roblox `FrictionWeight` / `ElasticityWeight` from each shape's `userMaterialId` (bits 0-31: friction weight × 1000; bits 32-63: elasticity weight × 1000) and mixes `(a·wA + b·wB) / (wA + wB)`, a plain average when both weights are 0. A shape whose `userMaterialId` is `0n` falls back to box3d's default rule for that pair. An unknown rule throws a `RangeError`.
- `getBodyMoveEventsPacked(eventsBuffer)` returns every body move event of the last `getEvents` as one copied `Float64Array`, 11 numbers per event: `index1, world0, generation, px, py, pz, qx, qy, qz, qw, fellAsleep` (0/1). `b3Body_GetTransformsPacked(ids)` takes an `Int32Array` of `index1, world0, generation` triples and returns a copied `Float64Array`, 7 per body (`px, py, pz, qx, qy, qz, qw`), with `NaN` for an invalid id. Both cross the boundary once, for callers that can't read the wasm heap.
- Persistent forces: `b3Body_SetConstantForce(bodyId, force, point | null)`, `b3Body_SetConstantTorque(bodyId, torque)`, `b3Body_ClearConstantForces(bodyId)`. The bindings keep them per world and `b3World_Step` re-applies them (with `wake = false`) before every step. The force and torque are world-space; `point` is body-local, `null` means the center of mass. A new force replaces the previous one. Setting a non-zero value wakes the body once. Entries are dropped when the body is destroyed (or found invalid at step time) and when the world is destroyed.
- Distance-joint springs in stiffness units: `b3DistanceJointDef.springStiffness` and `springDamping` (default 0) and `b3DistanceJoint_SetSpringStiffness(jointId, stiffness, damping)` (`GetSpringStiffness` / `GetSpringDamping`). When either is positive they replace `hertz` / `dampingRatio`, and the spring force is exactly `-stiffness · Δlength - damping · lengthSpeed`, whatever the attached masses.
- `b3Shape_SetHull(shapeId, hull, transform, scale, updateBodyMass)` swaps a shape's geometry for `hull` baked with `transform` and `scale` (the hull is copied; destroy yours when done). It returns `false`, leaving the shape unchanged, if the transformed hull is degenerate. `updateBodyMass` recomputes the body's mass from its shapes.
- `b3Shape_Disable(shapeId)` / `b3Shape_Enable(shapeId)` / `b3Shape_IsEnabled(shapeId)`. A disabled shape leaves the broad-phase: it has no contacts, sensor overlaps, or query hits until it is enabled again. Its mass still counts.
- Natively filtered queries, for callers where a JS callback per candidate is expensive (e.g. across a sandbox): `b3QueryOptions = { ignoreBodies?: Int32Array, ignoreShapes?: Int32Array, excludeSensors?: boolean }` (id triples `index1, world0, generation`). A candidate is skipped inside the query when it or its body is listed, or it is a sensor and `excludeSensors` is set.
  - `b3World_CollideMoverPacked(worldId, origin, mover, filter, options)`: every plane of every non-skipped shape as one `Float64Array`, 14 per plane: shape id (3), body id (3), body type value, plane normal (3), plane offset, point (3, relative to `origin`).
  - `b3World_CastMoverFiltered(worldId, origin, mover, translation, filter, options)`: the `b3World_CastMover` fraction with the skipped shapes filtered out.
  - `b3World_CastRayClosestFiltered(worldId, origin, translation, filter, options)` and `b3World_CastShapeClosestFiltered(worldId, origin, points, radius, translation, filter, options)`: the closest non-skipped hit, an empty `Float64Array` on a miss, else 14 numbers: shape id (3), body id (3), point (3), normal (3), fraction, 0.
- The build normalizes Emscripten's output to LF, so dist files built on Windows match the other hosts.
- `b3Body_ClearConstantForces` / `b3DestroyBody` range-check the world slot of the id before touching the constant-force table.
- The Debug Draw example has a cylindrical joint in its joint row.

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
