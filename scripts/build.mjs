// Build box3d.js: compile box3d (static lib) with the Emscripten toolchain,
// then link our embind bindings into ES-module outputs.
//
// Single-threaded (default):
//   dist/box3d.mjs + dist/box3d.wasm   (separate wasm)
//   dist/box3d.inline.mjs              (inlined SINGLE_FILE)
//   dist/box3d.d.ts                    (emitted TypeScript defs, shared by all)
//
// Multithreaded (pthreads, opt-in — box3d's internal scheduler runs on the
// Emscripten pthread pool when worldDef.workerCount > 1):
//   dist/box3d.mt.mjs + dist/box3d.mt.wasm   (separate wasm)
//   dist/box3d.mt.inline.mjs                 (inlined SINGLE_FILE)
//
// Requires the Emscripten SDK on PATH (emcmake / em++). Source emsdk_env first.
// MT builds need cross-origin isolation (COOP: same-origin, COEP: require-corp)
// in the browser for SharedArrayBuffer.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const debug = process.argv.includes( '--debug' );

// box3d clamps workerCount to [1, B3_MAX_WORKERS] (=32). The Emscripten pthread
// pool must be >= the max threads the scheduler can spawn or it deadlocks
// (the well-documented JoltPhysics.js gotcha), so size the pool to 32.
const PTHREAD_POOL_SIZE = 32;
const MAXIMUM_MEMORY = 2147483648; // 2 GiB — required with growth + shared memory

// Pin the Emscripten toolchain. The ESM post-processing in validateESModule()
// pattern-matches emscripten's generated output, so an unexpected emcc version
// can silently change that output and break the rewrites. Assert it up front.
// Bump this (and re-verify the build) intentionally when upgrading emsdk.
const REQUIRED_EMSDK = '6.0.2';

function run( cmd, args )
{
	console.log( `\n$ ${cmd} ${args.join( ' ' )}\n` );
	execFileSync( cmd, args, { stdio: 'inherit', cwd: root } );
}

// Fail fast unless the emcc/em++ on PATH matches REQUIRED_EMSDK, so the build
// output the ESM rewrites depend on can't drift out from under us unnoticed.
function assertEmscriptenVersion()
{
	let out;
	try
	{
		out = execFileSync( 'em++', [ '--version' ], { cwd: root, encoding: 'utf8' } );
	}
	catch ( err )
	{
		throw new Error( 'em++ not found on PATH — source the emsdk env first (emsdk_env). ' + err.message );
	}
	// e.g. "emcc (Emscripten ...) 6.0.2 (7a2d97d...)"
	const m = out.match( /\b(\d+\.\d+\.\d+)\b/ );
	if ( !m ) throw new Error( `could not parse emcc version from:\n${out}` );
	if ( m[ 1 ] !== REQUIRED_EMSDK )
	{
		throw new Error(
			`emsdk ${m[ 1 ]} detected but this build is pinned to ${REQUIRED_EMSDK}. ` +
			`Install it via \`emsdk install ${REQUIRED_EMSDK} && emsdk activate ${REQUIRED_EMSDK}\`, ` +
			`or update REQUIRED_EMSDK in scripts/build.mjs after re-verifying the build.`,
		);
	}
	console.log( `emsdk ${m[ 1 ]} OK` );
}

// Post-process an emitted module into clean, valid ESM:
//
// 1. Emscripten's Node support code (-sENVIRONMENT=...,node) loads node
//    builtins with require() via a createRequire shim. That's valid ESM at
//    runtime, but bundlers flag the require() calls when the file is consumed
//    as an ES module. The calls all sit at the top level of the async
//    MODULARIZE factory, so rewrite them to await import (node builtins expose
//    everything as named exports, so namespace access keeps working) and drop
//    the dead shim.
//
// 2. SINGLE_FILE builds (*.inline.mjs) embed the wasm, so emscripten's file
//    readers (readAsync / readBinary, the node:fs / node:path / node:url
//    imports) are dead code. Strip them so the inline builds carry no node builtin
//    references and bundle with no config.
//
// -sSOURCE_PHASE_IMPORTS would obsolete most of this post-processing: the wasm
// loads via a static `import source` instead of fetch/fs, leaving only the MT
// worker_threads import to rewrite. Adopt it once browsers, bundlers, and
// emscripten's optimizer all support the syntax.
function validateESModule( file )
{
	const path = join( root, file );
	// Emscripten writes CRLF on Windows; keep the committed outputs LF on every host.
	let src = readFileSync( path, 'utf8' ).replaceAll( '\r\n', '\n' );

	// require() -> await import
	src = src.replaceAll( /\brequire\(\s*["']([^"']+)["']\s*\)/g, '(await import("$1"))' );
	// node: scheme on every builtin import (emscripten emits some itself, bare)
	// so bundlers unambiguously treat them as Node builtins.
	src = src.replaceAll( /\bimport\(\s*["'](?:node:)?(fs|path|url|util|module|crypto|worker_threads)["']\s*\)/g, 'import("node:$1")' );
	src = src.replace( /const\s*{\s*createRequire\s*}\s*=\s*await import\(\s*["'](?:node:)?module["']\s*\);?\s*(?:\/\*\*[^]*?\*\/\s*)?var require\s*=\s*createRequire\(\s*import\.meta\.url\s*\);?/, '' );
	if ( /\brequire\s*\(\s*["']/.test( src ) || src.includes( 'createRequire(import.meta.url)' ) )
	{
		throw new Error( `${file}: require() still present after rewrite — did emscripten's output change?` );
	}

	// The facade's single-threaded convex decomposition worker is built from
	// `Box3D.toString()` and asks findWasmBinary() where the wasm is, so the whole
	// ST module must stay one self-contained factory function.
	const singleThreaded = !file.includes( '.mt.' );
	if ( singleThreaded && ( !src.startsWith( 'async function Box3D(' ) || !/export default Box3D;\s*$/.test( src )
		|| !src.includes( 'function findWasmBinary(' ) ) )
	{
		throw new Error( `${file}: expected a self-contained \`async function Box3D\` factory with findWasmBinary — did emscripten's output change?` );
	}

	// dead file readers (SINGLE_FILE builds only)
	if ( file.includes( '.inline.' ) )
	{
		// arrow function with at most one nested brace level, which covers all
		// of emscripten's reader closures
		const arrow = /(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*=>\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/.source;
		src = src.replaceAll( new RegExp( `\\b(?:readAsync|readBinary)=${arrow};?`, 'g' ), '' );
		src = src.replace( 'var readAsync,readBinary;', '' );
		src = src.replace( /var fs=\(await import\("node:fs"\)\);?/, '' );
		// Node-only scriptDirectory computation, the sole user of node:path/node:url
		src = src.replace( /if\(_scriptName\.startsWith\("file:"\)\)\{scriptDirectory=[^{}]*\}/, '' );
		for ( const leftover of [ 'readAsync', 'readBinary', 'readFileSync', 'node:fs', 'node:path', 'node:url' ] )
		{
			if ( src.includes( leftover ) )
			{
				throw new Error( `${file}: ${leftover} still present after strip — did emscripten's output change?` );
			}
		}
	}

	writeFileSync( path, src );
}

function findFile( dir, name )
{
	for ( const e of readdirSync( dir, { withFileTypes: true } ) )
	{
		const p = join( dir, e.name );
		if ( e.isDirectory() )
		{
			const r = findFile( p, name );
			if ( r ) return r;
		}
		else if ( e.name === name )
		{
			return p;
		}
	}
	return null;
}

// Configure + build box3d as a static lib in its own build dir. `cflags` adds
// compile flags (used to compile box3d itself with -pthread for the MT lib).
function buildBox3dLib( buildDir, cflags )
{
	const args = [ 'cmake',
		'-S', 'vendor/box3d',
		'-B', buildDir,
		'-DCMAKE_BUILD_TYPE=' + ( debug ? 'Debug' : 'Release' ),
		'-DBOX3D_SAMPLES=OFF',
		'-DBOX3D_UNIT_TESTS=OFF',
		'-DBOX3D_BENCHMARKS=OFF',
		'-DBOX3D_DOCS=OFF',
		'-DBOX3D_VALIDATE=OFF',
	];
	if ( cflags ) args.push( '-DCMAKE_C_FLAGS=' + cflags );
	run( 'emcmake', args );
	run( 'cmake', [ '--build', buildDir, '--target', 'box3d', '-j', '8' ] );
	const lib = findFile( join( root, buildDir ), 'libbox3d.a' );
	if ( !lib ) throw new Error( `libbox3d.a not found under ${buildDir}` );
	return lib;
}

// V-HACD hardcodes an 8-thread worker pool. Stage a copy of its header with the
// pool size as a macro so the build controls it (the pthread pool is shared with
// box3d's own workers).
const VHACD_THREADS = 8;
function stageVhacdHeader()
{
	const src = readFileSync( join( root, 'vendor', 'v-hacd', 'include', 'VHACD.h' ), 'utf8' );
	const needle = 'new ThreadPool(8)';
	if ( src.split( needle ).length !== 2 ) throw new Error( `VHACD.h: expected exactly one \`${needle}\` — did the vendored V-HACD change?` );
	mkdirSync( join( root, 'build', 'vhacd' ), { recursive: true } );
	writeFileSync( join( root, 'build', 'vhacd', 'VHACD.h' ), src.replace( needle, 'new ThreadPool(B3_VHACD_THREADS)' ) );
}

function wasmSizes()
{
	const sizes = {};
	for ( const f of [ 'box3d.wasm', 'box3d.mt.wasm' ] )
	{
		try { sizes[ f ] = statSync( join( root, 'dist', f ) ).size; }
		catch { sizes[ f ] = null; }
	}
	return sizes;
}

assertEmscriptenVersion();

mkdirSync( join( root, 'dist' ), { recursive: true } );
// Hand-written Three.js helper. It does not go through emscripten.
copyFileSync( join( root, 'src', 'three.js' ), join( root, 'dist', 'three.mjs' ) );
copyFileSync( join( root, 'src', 'three.d.ts' ), join( root, 'dist', 'three.d.ts' ) );
// Hand-written DynamicMover port (box3d's samples/dynamic_mover.cpp).
copyFileSync( join( root, 'src', 'character.js' ), join( root, 'dist', 'character.mjs' ) );
copyFileSync( join( root, 'src', 'character.d.ts' ), join( root, 'dist', 'character.d.ts' ) );
// Hand-written vehicle presets (b3VehicleDef tunings).
copyFileSync( join( root, 'src', 'vehicles.js' ), join( root, 'dist', 'vehicles.mjs' ) );
copyFileSync( join( root, 'src', 'vehicles.d.ts' ), join( root, 'dist', 'vehicles.d.ts' ) );
const sizesBefore = wasmSizes();
stageVhacdHeader();

// box3d static libs: single-threaded, and a threaded one (box3d compiled with
// -pthread -sSHARED_MEMORY so its scheduler uses real threads).
const stLib = buildBox3dLib( 'build/box3d', null );
const mtLib = buildBox3dLib( 'build/box3d-mt', '-pthread -sSHARED_MEMORY' );
console.log( 'box3d ST lib:', stLib );
console.log( 'box3d MT lib:', mtLib );

// Flags common to every link (bindings source + engine lib are prepended per build).
const commonFlags = [
	'-I', 'vendor/box3d/include',
	'-I', 'build/vhacd',
	`-DB3_VHACD_THREADS=${VHACD_THREADS}`,
	'-std=c++17',
	'-lembind',
	// NB: the facade post-js (build/facade.generated.js) is NOT here — it is codegen'd
	// from the probe below and appended per shipped build. The probe itself links
	// without it (it only needs the raw _layoutMeta()/_outMeta() getters).
	'-msimd128',
	'-sMODULARIZE=1',
	'-sEXPORT_ES6=1',
	'-sEXPORT_NAME=Box3D',
	'-sALLOW_MEMORY_GROWTH=1',
	'-sWASM_BIGINT=1',
	'-sFILESYSTEM=0',
	'-sENVIRONMENT=web,worker,node',
	// NDEBUG in release matches how libbox3d.a is built, so box3d's asserting
	// inline header functions (e.g. b3MakeQuatFromAxisAngle) don't pull in the
	// b3InternalAssert symbol the release lib omits.
	...( debug ? [ '-O0', '-g', '-sASSERTIONS=2' ] : [ '-O3', '-DNDEBUG' ] ),
];

// Multithreaded delta (from the JoltPhysics.js MT build).
const mtFlags = [
	'-pthread',
	'-sSHARED_MEMORY',
	`-sPTHREAD_POOL_SIZE=${PTHREAD_POOL_SIZE}`,
	`-sMAXIMUM_MEMORY=${MAXIMUM_MEMORY}`,
];

// --- probe build ---
// Separate-wasm build WITHOUT the facade post-js, used only to (a) emit the shared
// TypeScript defs and (b) be loaded here to read the binding-site metadata. It is
// overwritten below by the real, facade-carrying dist/box3d.mjs.
run( 'em++', [ 'src/bindings.cpp', stLib, ...commonFlags, '--emit-tsd', 'box3d.d.ts', '-o', 'dist/box3d.mjs' ] );
validateESModule( 'dist/box3d.mjs' );

// Read the binding-site metadata straight off the probe: _layoutMeta() (packed-buffer
// tier strides), _outMeta() (out-param value types + reader shapes) and _retMeta()
// (val-returning function return types). These are the single source of truth — for the
// TS types below AND for the generated facade further down — so nothing is hardcoded.
const { default: Box3DProbe } = await import( pathToFileURL( join( root, 'dist', 'box3d.mjs' ) ).href );
const probe = await Box3DProbe();
// These getters return plain JS values (embind val), so no JSON.parse — the probe
// hands back native objects/arrays directly.
const layoutMeta = probe._layoutMeta();
const outMeta = probe._outMeta();
const retMeta = probe._retMeta();

// emscripten hardcodes MainModule / MainModuleFactory in --emit-tsd output.
// Rename them to friendlier box3d names.
// Also fix the Get*Events return types: the lambdas return val::object() which
// --emit-tsd can only see as `any`, but the runtime shape is well-defined.
// Types for the packed query buffers and the src/facade.js reader helpers,
// intersected into Box3DModule below so `b3.getContactAt(...)` etc. are typed.
const facadeTypes = `export interface ShapeIdBuffer { count: number; data: Int32Array; }
/** Native candidate filter for the *Filtered / *Packed world queries. A shape is skipped when it or
 * its body is listed (Int32Array of index1, world0, generation triples), or when it is a sensor and
 * excludeSensors is set. No JS callback runs per candidate. */
export interface b3QueryOptions { ignoreBodies?: Int32Array; ignoreShapes?: Int32Array; excludeSensors?: boolean; }
export interface ContactBuffer {
  count: number;
  contactsI32: Int32Array;
  manifoldsF32: Float32Array;
  manifoldsI32: Int32Array;
  pointsF32: Float32Array;
  pointsI32: Int32Array;
  readonly contactsBase?: number;
  readonly manifoldsF32Base?: number;
  readonly manifoldsI32Base?: number;
  readonly pointsF32Base?: number;
  readonly pointsI32Base?: number;
}
/** Reusable, wasm-backed contact buffer. Refilling allocates nothing on the JS
 * side; free it with destroyContactsBuffer when done. */
export interface ContactsBuffer extends ContactBuffer {}
/** Reusable, wasm-backed per-step events buffer. Fill with getEvents after each
 * b3World_Step, read with the get*EventAt helpers; free with destroyEventsBuffer. */
export interface EventsBuffer { readonly _brand?: 'EventsBuffer'; }
export interface ContactTouchEvent { shapeIdA: b3ShapeId; shapeIdB: b3ShapeId; contactId: b3ContactId; }
export interface ContactHitEvent {
  shapeIdA: b3ShapeId;
  shapeIdB: b3ShapeId;
  contactId: b3ContactId;
  point: b3Vec3;
  normal: b3Vec3;
  approachSpeed: number;
  userMaterialIdA: bigint;
  userMaterialIdB: bigint;
}
export interface BodyMoveEvent {
  bodyId: b3BodyId;
  position: b3Vec3;
  rotation: b3Quat;
  fellAsleep: boolean;
}
export interface SensorTouchEvent { sensorShapeId: b3ShapeId; visitorShapeId: b3ShapeId; }
export interface JointEvent { jointId: b3JointId; }
/** Packed plane buffer passed to the b3World_CollideMover callback. */
export interface PlaneResultBuffer { count: number; data: Float32Array; }
export interface PlaneResult { plane: { normal: b3Vec3; offset: number }; point: b3Vec3; }
/** Packed planes returned by b3Body_CollideMover: PlaneResultBuffer plus the shape id
 * of each plane (ShapeIdBuffer layout). Read with getBodyPlaneResultAt. */
export interface BodyPlaneResultBuffer extends PlaneResultBuffer { shapeIds: Int32Array; }
export interface BodyPlaneResult { shapeId: b3ShapeId; result: PlaneResult; }
/** Triangle positions/indices plus sphere (xyz, radius) and capsule (c1, c2, radius) parameters.
 * Views alias the wasm heap until the shape is destroyed or changed. Copy them to cache. */
export interface DebugGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  spheres: Float32Array;
  capsules: Float32Array;
}
export interface DebugDrawOptions {
  shapes?: boolean;
  bounds?: boolean;
  joints?: boolean;
  jointExtras?: boolean;
  mass?: boolean;
  contacts?: boolean;
  contactNormals?: boolean;
  contactForces?: boolean;
  frictionForces?: boolean;
  contactFeatures?: boolean;
  islands?: boolean;
  graphColors?: boolean;
  forceScale?: number;
  jointScale?: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ]. Defaults to a huge box so nothing is clipped. */
  drawingBounds?: b3AABB;
  maskBits?: number;
}
export interface DebugDrawBuffer { readonly _brand?: 'DebugDrawBuffer'; }
export interface DebugShapeRecord {
  geometryId: number;
  /** DebugShapeState.*.value */
  state: number;
  /** box3d packed colour; low 24 bits are RGB, the high byte is the debug material. */
  color: number;
  position: b3Vec3;
  rotation: b3Quat;
}
export interface DebugSegment { p1: b3Vec3; p2: b3Vec3; color: number; role: number; }
export interface DebugPoint { position: b3Vec3; size: number; color: number; role: number; }
export interface DebugSpherePrimitive { center: b3Vec3; radius: number; alpha: number; color: number; role: number; }
export interface DebugCapsulePrimitive { p1: b3Vec3; p2: b3Vec3; radius: number; alpha: number; color: number; role: number; }
export interface DebugBoxPrimitive { extents: b3Vec3; position: b3Vec3; rotation: b3Quat; color: number; role: number; }
export interface DebugBoundsPrimitive { aabb: b3AABB; color: number; role: number; }
export interface DebugTransformPrimitive { position: b3Vec3; rotation: b3Quat; role: number; }
export interface Contact {
  shapeIdA: b3ShapeId;
  shapeIdB: b3ShapeId;
  contactId: b3ContactId;
  manifoldCount: number;
}
export interface ManifoldPoint {
  anchorA: b3Vec3;
  anchorB: b3Vec3;
  separation: number;
  baseSeparation: number;
  normalImpulse: number;
  totalNormalImpulse: number;
  normalVelocity: number;
  featureId: number;
  triangleIndex: number;
  persisted: boolean;
}
export interface Manifold {
  normal: b3Vec3;
  twistImpulse: number;
  frictionImpulse: b3Vec3;
  rollingImpulse: b3Vec3;
  pointCount: number;
  points: ManifoldPoint[];
}
/** Packed convex decomposition: xyz points for every piece back to back, and
 * pieceCount + 1 vertex offsets (piece i is vertices offsets[i] .. offsets[i+1]). */
export interface b3ConvexDecomposition { points: Float32Array; offsets: Uint32Array; }
export interface b3ConvexDecompositionOptions {
  /** Maximum number of pieces. Default 32. */
  maxConvexHulls?: number;
  /** Voxel resolution; higher is more accurate and slower. Default 100000. */
  resolution?: number;
  /** Vertex budget per piece, clamped to [4, 255]. Default 32 (box3d hulls are capped at 255 half-edges). */
  maxVerticesPerHull?: number;
  /** Stop splitting once a piece is within this volume error, in percent. Default 1. */
  minVolumePercentError?: number;
  /** Maximum split recursion depth. Default 10. */
  maxRecursionDepth?: number;
  /** Project hull vertices back onto the source mesh. Default true. */
  shrinkWrap?: boolean;
  /** Use V-HACD's worker threads (multithreaded builds only; ignored otherwise). Default false. */
  useThreads?: boolean;
  /** Async variants only: reuse an earlier result for the same mesh + options instead of
   * running V-HACD again. Default true. Arrays passed with the cache on must not be edited
   * in place afterwards (their hash is memoized per array object). */
  cache?: boolean;
  /** Async variants only: identifies the mesh in the cache (e.g. an asset id) instead of
   * hashing its contents. Change it whenever the mesh changes. */
  cacheKey?: string;
}
export interface b3ConvexDecompositionCacheStats { entries: number; hits: number; misses: number; }
/** Shape ids created from a decomposition (ShapeIdBuffer layout, read with getShapeIdAt),
 * plus the number of pieces that could not become a box3d hull. */
export interface b3DecompositionShapes extends ShapeIdBuffer { skipped: number; }
export interface b3DecompositionCompound { compound: b3CompoundData | null; skipped: number; }
/** Reusable, wasm-backed vehicle readout. Fill with getVehicleStateData after each
 * b3World_Step; free with destroyVehicleStateBuffer. */
export interface VehicleStateBuffer { readonly _brand?: 'VehicleStateBuffer'; }
export interface VehicleStateRecord {
  /** Forward speed (m/s) */
  speed: number;
  engineRpm: number;
  /** Summed turbo boost. The engine makes 1 + boost times its torque curve. */
  boost: number;
  /** -1 reverse, 0 neutral, 1 and up forward gears */
  gear: number;
  isShifting: boolean;
  throttle: number;
  brake: number;
  /** Center steer angle, positive left (radians) */
  steerAngle: number;
  wheelsInContact: number;
  stuck: boolean;
  /** Launch control is managing the drive torque */
  isLaunching: boolean;
}
export interface VehicleWheelRecord {
  /** Wheel center, world space */
  position: b3Vec3;
  /** Wheel orientation including steering and spin */
  rotation: b3Quat;
  hasContact: boolean;
  isSticky: boolean;
  contactPoint: b3Vec3;
  contactNormal: b3Vec3;
  groundShapeId: b3ShapeId;
  userMaterialId: bigint;
  suspensionLength: number;
  /** 0 fully extended, 1 at the bump stop */
  compression: number;
  /** Normal force (N) */
  load: number;
  longitudinalForce: number;
  lateralForce: number;
  slipRatio: number;
  /** Radians */
  slipAngle: number;
  /** Spin (rad/s) */
  angularVelocity: number;
  rotationAngle: number;
  steerAngle: number;
  driveTorque: number;
  brakeTorque: number;
}
export interface Box3DFacade {
  /** Recommended way to give a body a convex decomposition. Decomposes the mesh without
   * blocking the calling thread, then attaches one hull shape per piece in a single call.
   * Single-threaded builds run V-HACD in a Web Worker (Node: synchronously); multithreaded
   * builds on a pthread. Create the body disabled and enable it once this resolves, so it
   * doesn't fall without shapes. Rejects if the body is destroyed first. Results are
   * cached (see options.cache), so further bodies of the same mesh skip V-HACD. */
  b3CreateConvexDecompositionShapesAsync(bodyId: b3BodyId, shapeDef: b3ShapeDef, positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): Promise<b3DecompositionShapes>;
  /** Packed decomposition computed without blocking the calling thread (same threading as
   * b3CreateConvexDecompositionShapesAsync). Use it for static compounds and caching. */
  b3ComputeConvexDecompositionAsync(positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): Promise<b3ConvexDecomposition>;
  /** Cache key the async variants use: options.cacheKey or a 64-bit hash of the mesh
   * (memoized per array pair), plus every option that changes the result. */
  b3ConvexDecompositionCacheKey(positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): string;
  /** Drops every cached decomposition and memoized mesh hash, and resets the stats. */
  b3ClearConvexDecompositionCache(): void;
  b3GetConvexDecompositionCacheStats(): b3ConvexDecompositionCacheStats;
  b3PackConvexDecomposition(parts: ArrayLike<number>[]): b3ConvexDecomposition;
  b3UnpackConvexDecomposition(packed: b3ConvexDecomposition): Float32Array[];
  getNumShapeIds(buf: ShapeIdBuffer): number;
  createShapeId(): b3ShapeId;
  getShapeIdAt(out: b3ShapeId, buf: ShapeIdBuffer, i: number): b3ShapeId;
  getNumContacts(buf: ContactBuffer): number;
  createContact(): Contact;
  getContactAt(out: Contact, buf: ContactBuffer, i: number): Contact;
  createPoint(): ManifoldPoint;
  createManifold(): Manifold;
  getManifoldAt(out: Manifold, contact: Contact, m: number): Manifold;
  createContactsBuffer(): ContactsBuffer;
  getShapeContactData(buf: ContactsBuffer, shapeId: b3ShapeId): ContactsBuffer;
  getBodyContactData(buf: ContactsBuffer, bodyId: b3BodyId): ContactsBuffer;
  destroyContactsBuffer(buf: ContactsBuffer): void;
  createEventsBuffer(): EventsBuffer;
  getEvents(eb: EventsBuffer, worldId: b3WorldId): EventsBuffer;
  destroyEventsBuffer(eb: EventsBuffer): void;
  getNumContactBeginEvents(eb: EventsBuffer): number;
  getNumContactEndEvents(eb: EventsBuffer): number;
  getNumContactHitEvents(eb: EventsBuffer): number;
  getNumBodyMoveEvents(eb: EventsBuffer): number;
  getNumSensorBeginEvents(eb: EventsBuffer): number;
  getNumSensorEndEvents(eb: EventsBuffer): number;
  getNumJointEvents(eb: EventsBuffer): number;
  createContactTouchEvent(): ContactTouchEvent;
  getContactBeginEventAt(out: ContactTouchEvent, eb: EventsBuffer, i: number): ContactTouchEvent;
  getContactEndEventAt(out: ContactTouchEvent, eb: EventsBuffer, i: number): ContactTouchEvent;
  createContactHitEvent(): ContactHitEvent;
  getContactHitEventAt(out: ContactHitEvent, eb: EventsBuffer, i: number): ContactHitEvent;
  createBodyMoveEvent(): BodyMoveEvent;
  getBodyMoveEventAt(out: BodyMoveEvent, eb: EventsBuffer, i: number): BodyMoveEvent;
  /** Every body move event of the last getEvents in one copied array, 11 numbers per event:
   * index1, world0, generation, px, py, pz, qx, qy, qz, qw, fellAsleep (0/1). */
  getBodyMoveEventsPacked(eb: EventsBuffer): Float64Array;
  /** Rule ids for b3World_SetMixingRules. 'weighted' mixes (a*wA + b*wB) / (wA + wB) with per-shape
   * weights packed into each shape's userMaterialId, so while it is active that field holds the weights
   * and can't double as a material tag: bits 0-31 friction weight * 1000, bits 32-62 restitution
   * weight * 1000, bit 63 set = weights present. A shape without bit 63 uses box3d's default rule. */
  readonly b3MixingRule: {
    readonly geometric: 0;
    readonly average: 1;
    readonly min: 2;
    readonly max: 3;
    readonly multiply: 4;
    readonly weighted: 5;
  };
  createSensorTouchEvent(): SensorTouchEvent;
  getSensorBeginEventAt(out: SensorTouchEvent, eb: EventsBuffer, i: number): SensorTouchEvent;
  getSensorEndEventAt(out: SensorTouchEvent, eb: EventsBuffer, i: number): SensorTouchEvent;
  createJointEvent(): JointEvent;
  getJointEventAt(out: JointEvent, eb: EventsBuffer, i: number): JointEvent;
  getNumPlaneResults(buf: PlaneResultBuffer): number;
  createPlaneResult(): PlaneResult;
  getPlaneResultAt(out: PlaneResult, buf: PlaneResultBuffer, i: number): PlaneResult;
  getNumBodyPlaneResults(buf: BodyPlaneResultBuffer): number;
  createBodyPlaneResult(): BodyPlaneResult;
  getBodyPlaneResultAt(out: BodyPlaneResult, buf: BodyPlaneResultBuffer, i: number): BodyPlaneResult;
  /** Reusable wasm buffer filled by getDebugDraw. Free it with destroyDebugDrawBuffer. */
  createDebugDrawBuffer(): DebugDrawBuffer;
  /** One b3World_Draw pass per enabled role. Refreshes the heap views; allocates nothing. */
  getDebugDraw(buf: DebugDrawBuffer, worldId: b3WorldId, options?: DebugDrawOptions): DebugDrawBuffer;
  destroyDebugDrawBuffer(buf: DebugDrawBuffer): void;
  getNumDebugShapes(buf: DebugDrawBuffer): number;
  getNumDebugSegments(buf: DebugDrawBuffer): number;
  getNumDebugPoints(buf: DebugDrawBuffer): number;
  getNumDebugSpheres(buf: DebugDrawBuffer): number;
  getNumDebugCapsules(buf: DebugDrawBuffer): number;
  getNumDebugBoxes(buf: DebugDrawBuffer): number;
  getNumDebugBounds(buf: DebugDrawBuffer): number;
  getNumDebugTransforms(buf: DebugDrawBuffer): number;
  createDebugShapeRecord(): DebugShapeRecord;
  getDebugShapeAt(out: DebugShapeRecord, buf: DebugDrawBuffer, i: number): DebugShapeRecord;
  createDebugSegment(): DebugSegment;
  getDebugSegmentAt(out: DebugSegment, buf: DebugDrawBuffer, i: number): DebugSegment;
  createDebugPoint(): DebugPoint;
  getDebugPointAt(out: DebugPoint, buf: DebugDrawBuffer, i: number): DebugPoint;
  createDebugSpherePrimitive(): DebugSpherePrimitive;
  getDebugSphereAt(out: DebugSpherePrimitive, buf: DebugDrawBuffer, i: number): DebugSpherePrimitive;
  createDebugCapsulePrimitive(): DebugCapsulePrimitive;
  getDebugCapsuleAt(out: DebugCapsulePrimitive, buf: DebugDrawBuffer, i: number): DebugCapsulePrimitive;
  createDebugBoxPrimitive(): DebugBoxPrimitive;
  getDebugBoxAt(out: DebugBoxPrimitive, buf: DebugDrawBuffer, i: number): DebugBoxPrimitive;
  createDebugBoundsPrimitive(): DebugBoundsPrimitive;
  getDebugBoundsAt(out: DebugBoundsPrimitive, buf: DebugDrawBuffer, i: number): DebugBoundsPrimitive;
  createDebugTransformPrimitive(): DebugTransformPrimitive;
  getDebugTransformAt(out: DebugTransformPrimitive, buf: DebugDrawBuffer, i: number): DebugTransformPrimitive;
  createVehicleStateBuffer(): VehicleStateBuffer;
  /** Packs the vehicle state and every wheel's state and transform in one call. */
  getVehicleStateData(buf: VehicleStateBuffer, vehicleId: b3VehicleId): VehicleStateBuffer;
  destroyVehicleStateBuffer(buf: VehicleStateBuffer): void;
  getNumVehicleWheels(buf: VehicleStateBuffer): number;
  createVehicleStateRecord(): VehicleStateRecord;
  getVehicleStateAt(out: VehicleStateRecord, buf: VehicleStateBuffer): VehicleStateRecord;
  createVehicleWheelRecord(): VehicleWheelRecord;
  getVehicleWheelAt(out: VehicleWheelRecord, buf: VehicleStateBuffer, i: number): VehicleWheelRecord;
  /** Most wheels a vehicle can have. */
  readonly B3_MAX_VEHICLE_WHEELS: number;
  /** Floats per wheel written by b3Vehicle_GetWheelLocalData (11). */
  readonly B3_VEHICLE_WHEEL_LOCAL_STRIDE: number;
  /** Every wheel's chassis-space pose and raw spin in one call, for placing wheel meshes under
   * the chassis and interpolating them between physics steps. Writes
   * B3_VEHICLE_WHEEL_LOCAL_STRIDE (11) floats per wheel, wheels in definition order, at
   * out[i * 11]:
   *
   * - [0..2] position: wheel center in chassis space, the attachment point lowered along the
   *   chassis up axis by suspensionLength
   * - [3..6] rotation as x, y, z, w: steer about chassis up, then spin about the axle
   *   (up x forward), so b3Vehicle_GetWheelTransform is the chassis transform times this pose
   * - [7] rotationAngle: spin angle (radians), wrapped to [-pi, pi]
   * - [8] angularVelocity: spin rate (rad/s). A fast wheel turns more than pi per step, so unwrap
   *   the spin with it before interpolating; the quaternion alone cannot be unwrapped.
   * - [9] steerAngle (radians)
   * - [10] suspensionLength: attachment point to wheel center (m)
   *
   * Returns the wheel count, 0 for an invalid vehicle. Throws a RangeError when out is shorter
   * than count * 11; a B3_MAX_VEHICLE_WHEELS * B3_VEHICLE_WHEEL_LOCAL_STRIDE array fits any vehicle. */
  b3Vehicle_GetWheelLocalData(out: Float32Array | number[], vehicleId: b3VehicleId): number;
}`;

const tsdPath = join( root, 'dist', 'box3d.d.ts' );
let tsd = readFileSync( tsdPath, 'utf8' )
	.replaceAll( '\r\n', '\n' ) // emit-tsd writes CRLF on Windows
	.replaceAll( 'MainModuleFactory', 'Box3DFactory' )
	.replaceAll( 'MainModule', 'Box3DModule' )
	.replace(
		'export type Box3DModule = WasmModule & EmbindModule;',
		`${facadeTypes}\nexport type Box3DModule = WasmModule & EmbindModule & Box3DFacade;`,
	);
if ( !tsd.includes( '& Box3DFacade' ) ) throw new Error( 'tsd: Box3DModule alias not found — did --emit-tsd output change?' );

// val-returning functions emit as `... : any;`; retype the return from _retMeta
// (declared at the binding site via the ret_function ": T" DSL). Keeps the params
// emit-tsd inferred, only replacing the `any` return.
for ( const { method, tsType } of retMeta )
{
	const re = new RegExp( `^(\\s*)${method}\\(([^)]*)\\): any;`, 'm' );
	if ( !re.test( tsd ) ) throw new Error( `tsd: no \`${method}(...): any;\` line to retype — binding renamed/removed or return type changed?` );
	tsd = tsd.replace( re, `$1${method}($2): ${tsType};` );
}

// val params also emit as `any`. The convex decomposition bindings take JS arrays and
// option bags, and the facade wraps them so the trailing argument may be omitted.
const valParamSigs = {
	b3ComputeConvexDecomposition: 'positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions',
	b3CreateConvexDecompositionShapes: 'bodyId: b3BodyId, shapeDef: b3ShapeDef, positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions',
	b3CreateConvexDecompositionShapesFromPacked: 'bodyId: b3BodyId, shapeDef: b3ShapeDef, packed: b3ConvexDecomposition, maxVerticesPerHull?: number',
	b3CreateDecompositionCompound: 'packed: b3ConvexDecomposition, material?: b3SurfaceMaterial',
	b3Body_SetConstantForce: 'bodyId: b3BodyId, force: b3Vec3, point: b3Vec3 | null',
	b3Body_GetTransformsPacked: 'ids: Int32Array',
	b3World_CollideMoverPacked: 'worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, filter: b3QueryFilter, options: b3QueryOptions | null',
	b3World_CastMoverFiltered: 'worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null',
	b3World_CastRayClosestFiltered: 'worldId: b3WorldId, origin: b3Vec3, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null',
	b3World_CastShapeClosestFiltered: 'worldId: b3WorldId, origin: b3Vec3, points: Float32Array | number[], radius: number, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null',
};
for ( const [ method, params ] of Object.entries( valParamSigs ) )
{
	const re = new RegExp( `^(\\s*)${method}\\([^)]*\\):`, 'm' );
	if ( !re.test( tsd ) ) throw new Error( `tsd: no \`${method}(...)\` line to retype — binding renamed/removed?` );
	tsd = tsd.replace( re, `$1${method}(${params}):` );
}

// out-param math reads: rewrite each raw `MethodInto(out: number, ...): void;` embind
// method to its public reader `Method(out: T, ...): T;`, driven entirely by the
// binding-site metadata (outMeta above). The out value types live once in
// bindings.cpp's out_function DSL; nothing is duplicated here. A multi-out getter
// (e.g. a transform read as position + rotation) returns a tuple of its out types.
if ( !outMeta.length ) throw new Error( 'tsd: _outMeta() returned no entries — did the out_function DSL change?' );
for ( const { method, tsTypes } of outMeta )
{
	const nOuts = tsTypes.length;
	const re = new RegExp( `^(\\s*)${method}Into\\(([^)]*)\\): void;`, 'm' );
	if ( !re.test( tsd ) ) throw new Error( `tsd: no \`${method}Into(...): void;\` line to retype — binding renamed/removed?` );
	tsd = tsd.replace( re, ( _, indent, params ) =>
	{
		// first nOuts params are the `outX: number` slots — retype them; keep the rest.
		const parts = params.split( ', ' );
		for ( let k = 0; k < nOuts; k++ ) parts[ k ] = parts[ k ].replace( /: .+$/, `: ${tsTypes[ k ]}` );
		const ret = nOuts === 1 ? tsTypes[ 0 ] : `[ ${tsTypes.join( ', ' )} ]`;
		return `${indent}${method}(${parts.join( ', ' )}): ${ret};`;
	} );
}

// Internal plumbing — strip from the public types. b3_getMathScratch: scratch
// pointer (facade captures it); _outMeta/_retMeta/_layoutMeta: the binding-site
// metadata getters read above (out-param types, val-return types, buffer strides).
// The three meta getters return embind val, which --emit-tsd renders as `: any;`.
tsd = tsd.replace( /^\s*b3_getMathScratch\(\): number;\r?\n/m, '' );
tsd = tsd.replace( /^\s*_outMeta\(\): any;\r?\n/m, '' );
tsd = tsd.replace( /^\s*_retMeta\(\): any;\r?\n/m, '' );
tsd = tsd.replace( /^\s*_layoutMeta\(\): any;\r?\n/m, '' );
// The raw writer + scratch pointer behind the facade's b3Vehicle_GetWheelLocalData.
for ( const re of [ /^\s*b3_getVehicleWheelLocalScratch\(\): number;\r?\n/m, /^\s*b3Vehicle_GetWheelLocalDataInto\([^)]*\): number;\r?\n/m ] )
{
	if ( !re.test( tsd ) ) throw new Error( `tsd: no ${re} line to strip — binding renamed/removed?` );
	tsd = tsd.replace( re, '' );
}

writeFileSync( tsdPath, tsd );

// Codegen the facade post-js. src/facade.js is a template: substitute the metadata
// literals read off the probe above for its __B3_LAYOUT__ / __B3_OUT_META__ tokens, so
// the shipped runtime uses baked-in constants instead of calling _layoutMeta()/_outMeta()
// (which return JSON strings that TextDecoder rejects over growable wasm memory in the
// browser). bindings.cpp stays the source of truth — these values come from it, via the
// probe, on every build. Emitted to build/ (not dist/) so it is not published.
const facadeSrc = readFileSync( join( root, 'src', 'facade.js' ), 'utf8' );
if ( !facadeSrc.includes( '__B3_LAYOUT__' ) || !facadeSrc.includes( '__B3_OUT_META__' ) )
	throw new Error( 'facade codegen: __B3_LAYOUT__/__B3_OUT_META__ token missing from src/facade.js' );
const facadeGen = facadeSrc
	.replaceAll( '__B3_LAYOUT__', JSON.stringify( layoutMeta ) )
	.replaceAll( '__B3_OUT_META__', JSON.stringify( outMeta ) );
const facadePost = 'build/facade.generated.js';
writeFileSync( join( root, facadePost ), facadeGen );
const post = [ '--post-js', facadePost ];

// --- single-threaded ---
// Real separate-wasm build (with the facade), overwriting the probe above.
run( 'em++', [ 'src/bindings.cpp', stLib, ...commonFlags, ...post, '-o', 'dist/box3d.mjs' ] );
validateESModule( 'dist/box3d.mjs' );
// Inlined single-file build (wasm base64-embedded).
run( 'em++', [ 'src/bindings.cpp', stLib, ...commonFlags, ...post, '-sSINGLE_FILE=1', '-o', 'dist/box3d.inline.mjs' ] );
validateESModule( 'dist/box3d.inline.mjs' );

// --- multithreaded (pthreads) ---
run( 'em++', [ 'src/bindings.cpp', mtLib, ...commonFlags, ...mtFlags, ...post, '-o', 'dist/box3d.mt.mjs' ] );
validateESModule( 'dist/box3d.mt.mjs' );
// Single-file MT build: base64-embedding the wasm sidesteps the SharedArrayBuffer
// + separate-wasm-fetch friction (as JoltPhysics.js does).
run( 'em++', [ 'src/bindings.cpp', mtLib, ...commonFlags, ...mtFlags, ...post, '-sSINGLE_FILE=1', '-o', 'dist/box3d.mt.inline.mjs' ] );
validateESModule( 'dist/box3d.mt.inline.mjs' );

const sizesAfter = wasmSizes();
console.log( '\nwasm size (before -> after this build):' );
for ( const f of Object.keys( sizesAfter ) )
{
	const kb = ( n ) => ( n == null ? 'missing' : `${( n / 1024 ).toFixed( 1 )} KiB` );
	console.log( `  ${f.padEnd( 16 )} ${kb( sizesBefore[ f ] )} -> ${kb( sizesAfter[ f ] )}` );
}

console.log( '\nBuild artifacts:' );
for ( const f of [
	'box3d.mjs', 'box3d.wasm', 'box3d.inline.mjs', 'box3d.d.ts',
	'box3d.mt.mjs', 'box3d.mt.wasm', 'box3d.mt.inline.mjs',
] )
{
	try
	{
		const kb = ( statSync( join( root, 'dist', f ) ).size / 1024 ).toFixed( 1 );
		console.log( `  dist/${f.padEnd( 20 )} ${kb} KiB` );
	}
	catch
	{
		console.log( `  dist/${f.padEnd( 20 )} (missing)` );
	}
}
