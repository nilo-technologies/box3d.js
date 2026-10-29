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
b3.b3CreateMeshShape(staticBody, b3.b3DefaultShapeDef(), meshData, scale);
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

b3.b3DestroyWorld(world);
