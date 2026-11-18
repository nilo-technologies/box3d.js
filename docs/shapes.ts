import Box3D from 'box3d.js/inline';
import type { Box3DModule, b3Quat, b3Vec3 } from 'box3d.js';

const b3: Box3DModule = await Box3D();
const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());
const bodyDef = b3.b3DefaultBodyDef();
bodyDef.type = b3.b3BodyType.b3_dynamicBody;
const body = b3.b3CreateBody(world, bodyDef);
const sd = b3.b3DefaultShapeDef();

/* SNIPPET_START: box */
// Box: defined by half-extents (hx, hy, hz) from the body origin
b3.b3CreateBoxShape(body, sd, 0.5, 0.5, 0.5);  // 1x1x1 cube
b3.b3CreateBoxShape(body, sd, 2.0, 0.1, 2.0);  // flat platform
/* SNIPPET_END: box */

/* SNIPPET_START: sphere */
// center is a b3Vec3: [x, y, z]
b3.b3CreateSphereShape(body, sd, { center: [0, 0, 0], radius: 0.5 });
/* SNIPPET_END: sphere */

/* SNIPPET_START: capsule */
// Capsule: a cylinder with hemispherical caps, defined by two center points + radius
b3.b3CreateCapsuleShape(body, sd, {
    center1: [0, -0.5, 0],
    center2: [0,  0.5, 0],
    radius: 0.3,
});
/* SNIPPET_END: capsule */

/* SNIPPET_START: hull */
// Convex hull: the tightest convex shape enclosing a set of points.
// Pass a flat [x,y,z, x,y,z, ...] array -- box3d computes the hull internally.
const positions = [
    -0.5, 0, -0.5,
     0.5, 0, -0.5,
     0.5, 0,  0.5,
    -0.5, 0,  0.5,
     0,   1,  0,   // apex
];
const hullData = b3.b3CreateHull(positions)!;
b3.b3CreateHullShape(body, sd, hullData);
hullData.delete(); // free the C++ handle when done
/* SNIPPET_END: hull */

/* SNIPPET_START: cylinder-cone */
// Cylinder and cone are built-in hull makers.
// b3CreateCylinder(halfHeight, radius, convexRadius, segments)
const cylData = b3.b3CreateCylinder(0.5, 0.4, 0.0, 16)!;
b3.b3CreateHullShape(body, sd, cylData);
cylData.delete();

// b3CreateCone(height, radius, convexRadius, segments)
const coneData = b3.b3CreateCone(1.0, 0.5, 0.0, 16)!;
b3.b3CreateHullShape(body, sd, coneData);
coneData.delete();
/* SNIPPET_END: cylinder-cone */

/* SNIPPET_START: mesh */
// Triangle mesh: for complex static terrain and level geometry.
// Positions: flat Float32Array [x,y,z, ...]; indices: Uint32Array.
// Winding: counter-clockwise (CCW) is the front face.
const meshPositions = new Float32Array([
    -10, 0, -10,
     10, 0, -10,
     10, 0,  10,
    -10, 0,  10,
]);
const meshIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);

const meshData = b3.b3CreateMesh(meshPositions, meshIndices)!;

const staticBodyDef = b3.b3DefaultBodyDef();
const staticBody = b3.b3CreateBody(world, staticBodyDef);
const scale: b3Vec3 = [1, 1, 1];
const meshShape = b3.b3CreateMeshShape(staticBody, b3.b3DefaultShapeDef(), meshData, scale);
// Mesh contacts hold other shapes meshRestOffset (default B3_MESH_REST_OFFSET, 5 mm)
// off the surface. For a floor that shapes must rest flush on, set
// b3ShapeDef.meshRestOffset = 0 before creating the shape, or call:
b3.b3Shape_SetMeshRestOffset(meshShape, 0);
meshData.delete();
/* SNIPPET_END: mesh */

/* SNIPPET_START: compound */
// Compound shapes combine multiple child shapes on a single body.
// In box3d, compounds are static-only -- the body type must be b3_staticBody.
const compoundBodyDef = b3.b3DefaultBodyDef();
compoundBodyDef.type = b3.b3BodyType.b3_staticBody;
const compoundBody = b3.b3CreateBody(world, compoundBodyDef);

const IDENTITY_QUAT: b3Quat = [0, 0, 0, 1];

// Each child is a convex hull plus the transform placing it on the body.
// (position is a b3Vec3, quaternion a b3Quat.) Build box hulls from their corners:
function boxHull(hx: number, hy: number, hz: number) {
    return b3.b3CreateHull([
        -hx, -hy, -hz,  hx, -hy, -hz,  hx, -hy, hz,  -hx, -hy, hz,
        -hx,  hy, -hz,  hx,  hy, -hz,  hx,  hy, hz,  -hx,  hy, hz,
    ])!;
}

const spec = {
    hulls: [
        { hull: boxHull(0.5, 2, 0.5), transform: { position: [-2, 0, 0], quaternion: IDENTITY_QUAT } }, // left wall
        { hull: boxHull(0.5, 2, 0.5), transform: { position: [ 2, 0, 0], quaternion: IDENTITY_QUAT } }, // right wall
        { hull: boxHull(2.5, 0.5, 0.5), transform: { position: [0, -1, 0], quaternion: IDENTITY_QUAT } }, // floor
    ],
};

// Compound data is NOT copied into the world -- keep it (and its hulls) alive for
// as long as the shape exists, then free it after the body/world is destroyed.
const compoundData = b3.b3CreateCompound(spec)!;
b3.b3CreateBakedCompoundShape(compoundBody, b3.b3DefaultShapeDef(), compoundData);
/* SNIPPET_END: compound */

// a concave mesh to decompose: a hollow open box (floor + four walls)
const concave = b3.b3CreateHollowBoxMesh([0, 0, 0], [1, 1, 1])!;
const concavePositions = b3.b3GetMeshVertices(concave);
const concaveIndices = b3.b3GetMeshIndices(concave);
b3.b3DestroyMesh(concave);

/* SNIPPET_START: decomposition-dynamic */
// One call: V-HACD splits the mesh into convex pieces, and each piece becomes a
// hull shape on the body, all inside wasm. Works on dynamic and kinematic bodies.
const decompBodyDef = b3.b3DefaultBodyDef();
decompBodyDef.type = b3.b3BodyType.b3_dynamicBody;
const decompBody = b3.b3CreateBody(world, decompBodyDef);

const shapes = b3.b3CreateConvexDecompositionShapes(decompBody, sd, concavePositions, concaveIndices, {
    maxConvexHulls: 16,     // keep this modest for dynamic bodies: one shape per piece
    maxVerticesPerHull: 32, // box3d hulls are capped at 255 half-edges
});
console.log(`${shapes.count} hull shapes, ${shapes.skipped} pieces skipped`);

// shape ids come back packed; read them with the shape id reader
const shapeId = b3.createShapeId();
for (let i = 0; i < b3.getNumShapeIds(shapes); i++) {
    b3.getShapeIdAt(shapeId, shapes, i);
}
/* SNIPPET_END: decomposition-dynamic */

/* SNIPPET_START: decomposition-async */
// Promise variant (the recommended path): V-HACD runs off the main thread, so the page
// keeps rendering. Multithreaded builds use a background thread, single-threaded browser
// builds a Web Worker; Node runs it synchronously. Create the body disabled so it can't
// fall before its shapes exist, then enable it once the Promise resolves.
const asyncBodyDef = b3.b3DefaultBodyDef();
asyncBodyDef.type = b3.b3BodyType.b3_dynamicBody;
asyncBodyDef.isEnabled = false;
const asyncBody = b3.b3CreateBody(world, asyncBodyDef);

const asyncShapes = await b3.b3CreateConvexDecompositionShapesAsync(
    asyncBody, sd, concavePositions, concaveIndices, { useThreads: true },
);
b3.b3Body_Enable(asyncBody);
/* SNIPPET_END: decomposition-async */

/* SNIPPET_START: decomposition-static */
// Static bodies: put every piece into one compound shape instead.
const decomposition = await b3.b3ComputeConvexDecompositionAsync(concavePositions, concaveIndices, { maxConvexHulls: 32 });
const { compound } = b3.b3CreateDecompositionCompound(decomposition, { ...b3.b3DefaultSurfaceMaterial(), friction: 0.8 });

const levelBodyDef = b3.b3DefaultBodyDef();
levelBodyDef.type = b3.b3BodyType.b3_staticBody;
const levelBody = b3.b3CreateBody(world, levelBodyDef);
b3.b3CreateBakedCompoundShape(levelBody, b3.b3DefaultShapeDef(), compound!);
// the shape references the compound: b3DestroyCompound(compound) after the body/world is gone
/* SNIPPET_END: decomposition-static */

/* SNIPPET_START: decomposition-cache */
// Decomposition is slow (it voxelizes the mesh), so precompute it for shipped assets.
// The packed form is two typed arrays: store them, then rebuild shapes without V-HACD.
const packed = b3.b3ComputeConvexDecomposition(concavePositions, concaveIndices);
const saved = { points: packed.points.buffer, offsets: packed.offsets.buffer }; // e.g. write to disk

const loaded = { points: new Float32Array(saved.points), offsets: new Uint32Array(saved.offsets) };
const cachedBody = b3.b3CreateBody(world, decompBodyDef);
b3.b3CreateConvexDecompositionShapesFromPacked(cachedBody, sd, loaded);

// one Float32Array of xyz points per piece, and back
const pieces = b3.b3UnpackConvexDecomposition(loaded);
const repacked = b3.b3PackConvexDecomposition(pieces);
/* SNIPPET_END: decomposition-cache */

/* SNIPPET_START: decomposition-merge */
// Decompose with the surface merge. It starts from the triangles of the mesh, finds how much
// open space a hull may seal by itself, with a sweep, and the hull count follows from the
// shape. maxConvexHulls is a cap that is only met by force; 0 is none.
const merged = b3.b3ComputeConvexDecomposition(concavePositions, concaveIndices, {
    surfaceMerge: true,
    maxConvexHulls: 32,
});
console.log(`${merged.offsets.length - 1} hulls, sealing at most ${merged.maxConcavity} m`);

// Or give the limit yourself: with the mesh in meters, an opening wider than 5 cm stays
// open here.
const mergedToLimit = b3.b3ComputeConvexDecomposition(concavePositions, concaveIndices, {
    maxConcavity: 0.05,
    sweep: false,
});
/* SNIPPET_END: decomposition-merge */

/* SNIPPET_START: decomposition-pieces */
// Start from V-HACD's pieces instead of the triangles: they fill the inside of the solid,
// and V-HACD's time hardly grows with the triangle count.
const fromPieces = b3.b3ComputeConvexDecomposition(concavePositions, concaveIndices, {
    surfaceMerge: true,
    seedTriangles: false,
    resolution: 100000, // V-HACD's voxel count: its pieces reach past the surface by about a voxel
});

// The merge also runs on its own, over a decomposition from anywhere: V-HACD output with
// a generous hull budget, or a stored asset.
const remerged = b3.b3MergeConvexDecomposition(concavePositions, concaveIndices, packed, {
    maxConvexHulls: 16, // optional budget: merging goes on past the limit to meet it
});
const remergedBody = b3.b3CreateBody(world, decompBodyDef);
b3.b3CreateConvexDecompositionShapesFromPacked(remergedBody, sd, remerged);
/* SNIPPET_END: decomposition-pieces */

/* SNIPPET_START: decomposition-sweep */
// What did the merge's sweep see? b3SweepConvexDecomposition is a decomposition with the
// surface merge on, returned with every limit tried and the step kept.
const sweep = b3.b3SweepConvexDecomposition(concavePositions, concaveIndices);
for (const step of sweep.steps) {
    console.log(`limit ${step.maxConcavity} m: ${step.hullCount} hulls sealing ${step.sealedDepth} m`);
}
const keptStep = sweep.steps[sweep.best];
console.log(`kept ${keptStep.hullCount} hulls, merged to a limit of ${keptStep.maxConcavity} m`);

// its hulls are a decomposition like any other
const sweptBody = b3.b3CreateBody(world, decompBodyDef);
b3.b3CreateConvexDecompositionShapesFromPacked(sweptBody, sd, sweep.decomposition);

// The sweep's options, with their defaults. They are the same wherever the surface merge
// runs: a decomposition, b3MergeConvexDecomposition and b3SweepConvexDecomposition.
const tuned = await b3.b3ComputeConvexDecompositionAsync(concavePositions, concaveIndices, {
    surfaceMerge: true,
    sweep: true,            // false merges once, to maxConcavity
    // minConcavity: 0.5% of the bounding box diagonal, the tightest limit tried
    // maxConcavity: 8% of the bounding box diagonal, the loosest limit tried
    sweepSteps: 9,          // limits, spread geometrically between the two
    hullWeight: 1,          // above 1 keeps fewer hulls, below 1 a closer fit
    sweepStep: -1,          // the step to keep, or -1 to let the sweep choose
    concavitySamples: 8192, // points sampled on the mesh surface
    seedTriangles: true,    // false starts from V-HACD's pieces
});

// To choose by a rule of your own, read the steps and decompose again with sweepStep set to
// the one you settle on: here the loosest whose hulls seal under 10 cm.
const underTen = sweep.steps.reduce((found, step, i) => (step.sealedDepth < 0.1 ? i : found), 0);
const mergedUnderTen = b3.b3ComputeConvexDecomposition(concavePositions, concaveIndices, {
    surfaceMerge: true,
    sweepStep: underTen,
});
/* SNIPPET_END: decomposition-sweep */

/* SNIPPET_START: resize-disable */
// Resize or reshape a hull shape in place: the hull is baked with a transform and a
// (non-uniform) scale, then copied into the shape. Pass updateBodyMass = false to
// batch several changes and call b3Body_ApplyMassFromShapes once.
const crate = b3.b3CreateBoxShape(body, sd, 0.5, 0.5, 0.5);
const unitCube = b3.b3CreateHull([
    -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, 0.5, -0.5,  -0.5, 0.5, -0.5,
    -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5, 0.5,  0.5,  -0.5, 0.5,  0.5,
])!;
const resized = b3.b3Shape_SetBakedHull(crate, unitCube, { position: [0, 0.5, 0], quaternion: [0, 0, 0, 1] }, [2, 1, 4], true);
if (!resized) console.warn('degenerate hull; the shape is unchanged');
b3.b3DestroyHull(unitCube);

// Take a shape out of the simulation without destroying it: no contacts, sensor
// overlaps or query hits while disabled (its mass still counts).
b3.b3Shape_Disable(crate);
b3.b3Shape_IsEnabled(crate); // false
b3.b3Shape_Enable(crate);
/* SNIPPET_END: resize-disable */

b3.b3DestroyWorld(world);
