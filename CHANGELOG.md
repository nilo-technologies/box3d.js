# Changelog

## Unreleased

- `b3Body_CollideMover(bodyId, origin, mover, filter, bodyTransform)` collides a character mover with one body at a caller-given transform, for example to move a character against dynamic bodies at their predicted pose. It returns a packed buffer (`{ count, data, shapeIds }`, read with `getBodyPlaneResultAt`, which fills `{ shapeId, result }`). The `data` part has the same layout as `b3World_CollideMover` planes, so `getPlaneResultAt` reads it too. box3d reports at most one plane per shape, so the buffer is sized from the body's shape count and needs no capacity argument.
- `vendor/box3d` moves from box3d v0.1.0 to `nilo-technologies/box3d` main (3362633, upstream "Dynamic Mover (#202)"), which brings box3d's dynamic character mover joints.
- Mover joint: `b3DefaultMoverJointDef`, `b3CreateMoverJoint`, `b3MoverJoint_Set/GetLinearVelocity`, `b3MoverJoint_Set/GetMaxVelocityForce`. It drives a body to a target linear velocity within a force budget.
- Pogo joint: `b3DefaultPogoJointDef`, `b3CreatePogoJoint`, and `b3PogoJoint_*` for rest length, spring hertz and damping ratio, tension and compression force limits, normal, current length and speed, and impulse. It holds a body above a surface along a normal with a spring.
- `b3JointType` gains `b3_moverJoint` and `b3_pogoJoint`. New `b3Joint_IsAwake`.
- New def fields: `b3WorldDef.restitutionIterations`, `enableRestitutionPropagation` and `isotropicInertiaTolerance`, `b3BodyDef.safetyFactor`, `b3ShapeDef.enableSpeculativeContact`. Matching runtime accessors: `b3World_Set/GetRestitutionIterations`, `b3World_EnableRestitutionPropagation` / `IsRestitutionPropagationEnabled`, `b3World_Set/GetIsotropicInertiaTolerance`, `b3Body_Set/GetSafetyFactor`, `b3Body_AllowFastRotation` / `IsFastRotationAllowed`.
- `b3PlaneResult` gains `triangleIndex`, `childIndex` and `materialIndex`. The `b3World_CollideMover` and `b3Body_CollideMover` buffers carry them in a parallel `indices` Int32Array, and `getPlaneResultAt` fills them.

### Breaking

These follow box3d's renames and removals.

- `b3CreateCompoundShape` is now `b3CreateBakedCompoundShape`.
- `b3Body_GetLocalCenterOfMass` and `b3Body_GetWorldCenterOfMass` are now `b3Body_GetLocalCenter` and `b3Body_GetWorldCenter`.
- `b3CollideCapsuleAndTriangle`, `b3CollideHullAndTriangle` and `b3CollideSphereAndTriangle` are now `b3CollideTriangleAndCapsule(v1, v2, v3, capsuleB)`, `b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hullB, enableSpeculative)` and `b3CollideTriangleAndSphere(v1, v2, v3, sphereB)`. The triangle comes first, and the manifold normal now points from the triangle to the shape.
- `b3RecPlayer_Destroy` is now `b3DestroyPlayer`.
- `b3World_RebuildStaticTree` is removed. `b3World_DumpShapeBounds` is removed too: box3d still declares it but no longer defines it.
- `b3Profile.applyRestitution` is now `b3Profile.restitution`.
- The hull and compound binary versions changed, so hull and compound data baked with v0.3.0 has to be rebuilt.

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
