// box3d.js facade — hand-written ergonomic readers over the flat, wasm-backed
// buffers for contacts, per-step events, sensor overlaps, and CollideMover planes.
//
// This file is appended into the Emscripten MODULARIZE factory via --post-js, so
// everything here attaches to the SAME module object as the embind bindings:
//
//   const b3 = await Box3D();
//   const cb = b3.createContactsBuffer();                 // reusable, allocate once
//   const contact = b3.createContact();                   // reusable, allocate once
//   const manifold = b3.createManifold();                 // reusable, allocate once
//   b3.getShapeContactData( cb, shapeId );                // fills wasm storage, grows if needed
//   for ( let i = 0, n = b3.getNumContacts( cb ); i < n; i++ )
//   {
//     b3.getContactAt( contact, cb, i );                  // out-arg first, fills in place
//     for ( let m = 0; m < contact.manifoldCount; m++ )
//     {
//       b3.getManifoldAt( manifold, contact, m );
//       manifold.normal[0]; manifold.points[0].separation; // plain reads: no alloc, no crossings
//     }
//   }
//
// createX() allocates reusable out-objects; the getXAt() calls fill them in place,
// reading a pure-JS loop over the wasm heap, so scanning allocates nothing and
// crosses the wasm/JS boundary only for the fill.
//
// The packed-record tier STRIDES below come from bindings.cpp (namespace layout, via
// _layoutMeta()) — a single source of truth, so they can't drift. The per-field READ
// order in each reader still has to match the C++ packing order by hand.
//
// This file is a TEMPLATE, not linked directly. scripts/build.mjs reads bindings.cpp's
// compiled _layoutMeta()/_outMeta() getters off a probe module and substitutes the two
// placeholder tokens below (the LAYOUT stride table and the OUT-META reader list) with
// literals, emitting build/facade.generated.js — which is what gets linked. So the
// metadata still originates in bindings.cpp, but the shipped runtime never decodes those
// strings. (Keep the raw tokens out of comments — the build substitutes them by name.)

// Tier strides, published by src/bindings.cpp's layout namespace (injected at build).
const LAYOUT = __B3_LAYOUT__;

// --- shape id overlaps (sensors) -------------------------------------------
// buffer: { count, data: Int32Array }, 3 int32 per id: index1, world0, generation

function getNumShapeIds( buf ) { return buf.count; }

function createShapeId() { return { index1: 0, world0: 0, generation: 0 }; }

function getShapeIdAt( out, buf, i )
{
	const d = buf.data;
	const s = i * LAYOUT.shapeId;
	out.index1 = d[ s ];
	out.world0 = d[ s + 1 ];
	out.generation = d[ s + 2 ];
	return out;
}

// --- contacts (contacts -> manifolds -> points) ----------------------------

const CONTACT_STRIDE = LAYOUT.contact; // idA(3) idB(3) contactId(4) manifoldStart manifoldCount
const MANIFOLD_STRIDE_F = LAYOUT.manifoldF32; // normal(3) twistImpulse frictionImpulse(3) rollingImpulse(3)
const MANIFOLD_STRIDE_I = LAYOUT.manifoldI32; // pointStart pointCount
const POINT_STRIDE_F = LAYOUT.pointF32; // anchorA(3) anchorB(3) separation baseSeparation normalImpulse totalNormalImpulse normalVelocity
const POINT_STRIDE_I = LAYOUT.pointI32; // featureId triangleIndex persisted

function getNumContacts( buf ) { return buf.count; }

function createContact()
{
	return {
		shapeIdA: { index1: 0, world0: 0, generation: 0 },
		shapeIdB: { index1: 0, world0: 0, generation: 0 },
		contactId: { index1: 0, world0: 0, padding: 0, generation: 0 },
		manifoldCount: 0,
		// internal cursor state used by getManifoldAt; do not read.
		_buf: null,
		_manifoldStart: 0,
	};
}

function getContactAt( out, buf, i )
{
	const a = buf.contactsI32;
	// Mode-1 buffers have no base fields (contacts start at index 0); the reusable
	// wasm-backed buffer sets a base so we can index into the live module HEAP.
	const s = ( buf.contactsBase | 0 ) + i * CONTACT_STRIDE;
	const A = out.shapeIdA;
	A.index1 = a[ s ]; A.world0 = a[ s + 1 ]; A.generation = a[ s + 2 ];
	const B = out.shapeIdB;
	B.index1 = a[ s + 3 ]; B.world0 = a[ s + 4 ]; B.generation = a[ s + 5 ];
	const C = out.contactId;
	C.index1 = a[ s + 6 ]; C.world0 = a[ s + 7 ]; C.padding = a[ s + 8 ]; C.generation = a[ s + 9 ] >>> 0;
	out._manifoldStart = a[ s + 10 ];
	out.manifoldCount = a[ s + 11 ];
	out._buf = buf;
	return out;
}

function createPoint()
{
	return {
		anchorA: [ 0, 0, 0 ],
		anchorB: [ 0, 0, 0 ],
		separation: 0,
		baseSeparation: 0,
		normalImpulse: 0,
		totalNormalImpulse: 0,
		normalVelocity: 0,
		featureId: 0,
		triangleIndex: 0,
		persisted: false,
	};
}

// Manifolds hold at most B3_MAX_MANIFOLD_POINTS (4) points, so the point
// sub-objects are pre-allocated once here; getManifoldAt fills points[0..pointCount).
function createManifold()
{
	return {
		normal: [ 0, 0, 0 ],
		twistImpulse: 0,
		frictionImpulse: [ 0, 0, 0 ],
		rollingImpulse: [ 0, 0, 0 ],
		pointCount: 0,
		points: [ createPoint(), createPoint(), createPoint(), createPoint() ],
	};
}

function getManifoldAt( out, contact, m )
{
	const buf = contact._buf;
	const gm = contact._manifoldStart + m;
	const mf = buf.manifoldsF32;
	const mi = buf.manifoldsI32;
	const fs = ( buf.manifoldsF32Base | 0 ) + gm * MANIFOLD_STRIDE_F;
	const n = out.normal;
	n[ 0 ] = mf[ fs ]; n[ 1 ] = mf[ fs + 1 ]; n[ 2 ] = mf[ fs + 2 ];
	out.twistImpulse = mf[ fs + 3 ];
	const fr = out.frictionImpulse;
	fr[ 0 ] = mf[ fs + 4 ]; fr[ 1 ] = mf[ fs + 5 ]; fr[ 2 ] = mf[ fs + 6 ];
	const rl = out.rollingImpulse;
	rl[ 0 ] = mf[ fs + 7 ]; rl[ 1 ] = mf[ fs + 8 ]; rl[ 2 ] = mf[ fs + 9 ];

	const is = ( buf.manifoldsI32Base | 0 ) + gm * MANIFOLD_STRIDE_I;
	const pointStart = mi[ is ];
	const pointCount = mi[ is + 1 ];
	out.pointCount = pointCount;

	const pf = buf.pointsF32;
	const pi = buf.pointsI32;
	const pfBase = buf.pointsF32Base | 0;
	const piBase = buf.pointsI32Base | 0;
	for ( let p = 0; p < pointCount; p++ )
	{
		const P = out.points[ p ];
		const g = pointStart + p;
		const ps = pfBase + g * POINT_STRIDE_F;
		const pis = piBase + g * POINT_STRIDE_I;
		const aA = P.anchorA;
		aA[ 0 ] = pf[ ps ]; aA[ 1 ] = pf[ ps + 1 ]; aA[ 2 ] = pf[ ps + 2 ];
		const aB = P.anchorB;
		aB[ 0 ] = pf[ ps + 3 ]; aB[ 1 ] = pf[ ps + 4 ]; aB[ 2 ] = pf[ ps + 5 ];
		P.separation = pf[ ps + 6 ];
		P.baseSeparation = pf[ ps + 7 ];
		P.normalImpulse = pf[ ps + 8 ];
		P.totalNormalImpulse = pf[ ps + 9 ];
		P.normalVelocity = pf[ ps + 10 ];
		P.featureId = pi[ pis ] >>> 0;
		P.triangleIndex = pi[ pis + 1 ];
		P.persisted = pi[ pis + 2 ] !== 0;
	}
	return out;
}

// --- reusable, wasm-backed contact buffer (per-frame path, zero JS alloc) ----
//
//   const cb = b3.createContactsBuffer();          // allocate once
//   // each frame, after stepping:
//   b3.getShapeContactData( cb, shapeId );          // fills wasm storage, grows if needed
//   for ( let i = 0, n = b3.getNumContacts( cb ); i < n; i++ ) { ... same readers ... }
//   // when done:
//   b3.destroyContactsBuffer( cb );                 // frees the wasm storage
//
// Refilling this buffer copies nothing to JS and allocates no typed arrays: the
// data stays in the wasm heap and the readers index the live module HEAP views in
// place. Read the buffer before the next step or other allocation —
// getShapeContactData/getBodyContactData re-grab the views, so calling one each
// frame (after stepping) is always safe.

function createContactsBuffer()
{
	return {
		_impl: new Module.ContactsBufferImpl(),
		count: 0,
		// tier views point at the live module HEAP; bases are element offsets into it
		contactsI32: null, contactsBase: 0,
		manifoldsF32: null, manifoldsF32Base: 0,
		manifoldsI32: null, manifoldsI32Base: 0,
		pointsF32: null, pointsF32Base: 0,
		pointsI32: null, pointsI32Base: 0,
	};
}

// Re-point the buffer's tier views/bases at the current wasm heap. HEAP32/HEAPF32
// are module-scope views that Emscripten swaps out when memory grows, so we grab
// them fresh (a reference copy, no allocation) and recompute the byte->element
// offsets after every fill, when a growing std::vector may have moved too.
function refreshContactsBuffer( buf )
{
	const impl = buf._impl;
	buf.count = impl.count();
	buf.contactsI32 = HEAP32; buf.contactsBase = impl.contactsPtr() >> 2;
	buf.manifoldsF32 = HEAPF32; buf.manifoldsF32Base = impl.manifoldsF32Ptr() >> 2;
	buf.manifoldsI32 = HEAP32; buf.manifoldsI32Base = impl.manifoldsI32Ptr() >> 2;
	buf.pointsF32 = HEAPF32; buf.pointsF32Base = impl.pointsF32Ptr() >> 2;
	buf.pointsI32 = HEAP32; buf.pointsI32Base = impl.pointsI32Ptr() >> 2;
}

function getShapeContactData( buf, shapeId )
{
	buf._impl.loadFromShape( shapeId );
	refreshContactsBuffer( buf );
	return buf;
}

function getBodyContactData( buf, bodyId )
{
	buf._impl.loadFromBody( bodyId );
	refreshContactsBuffer( buf );
	return buf;
}

function destroyContactsBuffer( buf )
{
	buf._impl.delete();
	buf._impl = null;
}

// --- per-step events (reusable, wasm-backed; zero JS alloc per step) ---------
//
//   const eb = b3.createEventsBuffer();          // allocate once
//   const hit = b3.createContactHitEvent();       // reusable scratch, once
//   // each frame, after stepping:
//   b3.getEvents( eb, world );                     // pulls all event groups into wasm storage
//   for ( let i = 0, n = b3.getNumContactHitEvents( eb ); i < n; i++ )
//   {
//     b3.getContactHitEventAt( hit, eb, i );       // fills `hit` in place (out-arg first)
//     hit.shapeIdA; hit.point; hit.normal; hit.approachSpeed;
//   }
//   b3.destroyEventsBuffer( eb );                   // free the wasm storage
//
// Tier strides come from bindings.cpp (namespace layout, via LAYOUT above); the
// field READ order below must match the EventsBuffer packing order in src/bindings.cpp.

const CONTACT_TOUCH_STRIDE = LAYOUT.contactTouch; // shapeIdA(3) shapeIdB(3) contactId(4)
const CONTACT_HIT_STRIDE_I = LAYOUT.contactHitI32; // shapeIdA(3) shapeIdB(3) contactId(4) matA(lo,hi) matB(lo,hi)
const CONTACT_HIT_STRIDE_F = LAYOUT.contactHitF64; //  point(3) normal(3) approachSpeed
const BODY_MOVE_STRIDE_I = LAYOUT.bodyMoveI32; //    bodyId(3) fellAsleep
const BODY_MOVE_STRIDE_F = LAYOUT.bodyMoveF64; //    position(3) rotation(x,y,z,w)
const SENSOR_TOUCH_STRIDE = LAYOUT.sensorTouch; //   sensorShapeId(3) visitorShapeId(3)
const JOINT_STRIDE = LAYOUT.joint; //          jointId(3)

function readShapeId( dst, a, o )
{
	dst.index1 = a[ o ]; dst.world0 = a[ o + 1 ]; dst.generation = a[ o + 2 ];
}
function readContactId( dst, a, o )
{
	dst.index1 = a[ o ]; dst.world0 = a[ o + 1 ]; dst.padding = a[ o + 2 ]; dst.generation = a[ o + 3 ] >>> 0;
}
function readU64( a, o )
{
	return BigInt( a[ o ] >>> 0 ) | ( BigInt( a[ o + 1 ] >>> 0 ) << 32n );
}

function createEventsBuffer()
{
	return {
		_impl: new Module.EventsBufferImpl(),
		i32: null, f64: null, // live module HEAP views, refreshed on each getEvents
		contactBeginCount: 0, contactBeginBase: 0,
		contactEndCount: 0, contactEndBase: 0,
		contactHitCount: 0, contactHitI32Base: 0, contactHitF64Base: 0,
		bodyMoveCount: 0, bodyMoveI32Base: 0, bodyMoveF64Base: 0,
		sensorBeginCount: 0, sensorBeginBase: 0,
		sensorEndCount: 0, sensorEndBase: 0,
		jointCount: 0, jointBase: 0,
	};
}

function getEvents( eb, worldId )
{
	const impl = eb._impl;
	impl.loadFrom( worldId );
	// Re-grab HEAP views + byte->element bases (memory may have grown, vectors moved).
	eb.i32 = HEAP32;
	eb.f64 = HEAPF64;
	eb.contactBeginCount = impl.contactBeginCount(); eb.contactBeginBase = impl.contactBeginPtr() >> 2;
	eb.contactEndCount = impl.contactEndCount(); eb.contactEndBase = impl.contactEndPtr() >> 2;
	eb.contactHitCount = impl.contactHitCount();
	eb.contactHitI32Base = impl.contactHitI32Ptr() >> 2; eb.contactHitF64Base = impl.contactHitF64Ptr() >> 3;
	eb.bodyMoveCount = impl.bodyMoveCount();
	eb.bodyMoveI32Base = impl.bodyMoveI32Ptr() >> 2; eb.bodyMoveF64Base = impl.bodyMoveF64Ptr() >> 3;
	eb.sensorBeginCount = impl.sensorBeginCount(); eb.sensorBeginBase = impl.sensorBeginPtr() >> 2;
	eb.sensorEndCount = impl.sensorEndCount(); eb.sensorEndBase = impl.sensorEndPtr() >> 2;
	eb.jointCount = impl.jointCount(); eb.jointBase = impl.jointPtr() >> 2;
	return eb;
}

function destroyEventsBuffer( eb )
{
	eb._impl.delete();
	eb._impl = null;
}

function getNumContactBeginEvents( eb ) { return eb.contactBeginCount; }
function getNumContactEndEvents( eb ) { return eb.contactEndCount; }
function getNumContactHitEvents( eb ) { return eb.contactHitCount; }
function getNumBodyMoveEvents( eb ) { return eb.bodyMoveCount; }
function getNumSensorBeginEvents( eb ) { return eb.sensorBeginCount; }
function getNumSensorEndEvents( eb ) { return eb.sensorEndCount; }
function getNumJointEvents( eb ) { return eb.jointCount; }

// contact begin/end touch events: { shapeIdA, shapeIdB, contactId }
function createContactTouchEvent()
{
	return {
		shapeIdA: { index1: 0, world0: 0, generation: 0 },
		shapeIdB: { index1: 0, world0: 0, generation: 0 },
		contactId: { index1: 0, world0: 0, padding: 0, generation: 0 },
	};
}
function readContactTouch( out, eb, i, base )
{
	const a = eb.i32;
	const s = base + i * CONTACT_TOUCH_STRIDE;
	readShapeId( out.shapeIdA, a, s );
	readShapeId( out.shapeIdB, a, s + 3 );
	readContactId( out.contactId, a, s + 6 );
	return out;
}
function getContactBeginEventAt( out, eb, i ) { return readContactTouch( out, eb, i, eb.contactBeginBase ); }
function getContactEndEventAt( out, eb, i ) { return readContactTouch( out, eb, i, eb.contactEndBase ); }

// contact hit events
function createContactHitEvent()
{
	return {
		shapeIdA: { index1: 0, world0: 0, generation: 0 },
		shapeIdB: { index1: 0, world0: 0, generation: 0 },
		contactId: { index1: 0, world0: 0, padding: 0, generation: 0 },
		point: [ 0, 0, 0 ],
		normal: [ 0, 0, 0 ],
		approachSpeed: 0,
		userMaterialIdA: 0n,
		userMaterialIdB: 0n,
	};
}
function getContactHitEventAt( out, eb, i )
{
	const a = eb.i32;
	const s = eb.contactHitI32Base + i * CONTACT_HIT_STRIDE_I;
	readShapeId( out.shapeIdA, a, s );
	readShapeId( out.shapeIdB, a, s + 3 );
	readContactId( out.contactId, a, s + 6 );
	out.userMaterialIdA = readU64( a, s + 10 );
	out.userMaterialIdB = readU64( a, s + 12 );
	const f = eb.f64;
	const fs = eb.contactHitF64Base + i * CONTACT_HIT_STRIDE_F;
	out.point[ 0 ] = f[ fs ]; out.point[ 1 ] = f[ fs + 1 ]; out.point[ 2 ] = f[ fs + 2 ];
	out.normal[ 0 ] = f[ fs + 3 ]; out.normal[ 1 ] = f[ fs + 4 ]; out.normal[ 2 ] = f[ fs + 5 ];
	out.approachSpeed = f[ fs + 6 ];
	return out;
}

// body move events
function createBodyMoveEvent()
{
	return {
		bodyId: { index1: 0, world0: 0, generation: 0 },
		position: [ 0, 0, 0 ],
		rotation: [ 0, 0, 0, 1 ],
		fellAsleep: false,
	};
}
function getBodyMoveEventAt( out, eb, i )
{
	const a = eb.i32;
	const s = eb.bodyMoveI32Base + i * BODY_MOVE_STRIDE_I;
	out.bodyId.index1 = a[ s ]; out.bodyId.world0 = a[ s + 1 ]; out.bodyId.generation = a[ s + 2 ];
	out.fellAsleep = a[ s + 3 ] !== 0;
	const f = eb.f64;
	const fs = eb.bodyMoveF64Base + i * BODY_MOVE_STRIDE_F;
	out.position[ 0 ] = f[ fs ]; out.position[ 1 ] = f[ fs + 1 ]; out.position[ 2 ] = f[ fs + 2 ];
	out.rotation[ 0 ] = f[ fs + 3 ]; out.rotation[ 1 ] = f[ fs + 4 ]; out.rotation[ 2 ] = f[ fs + 5 ]; out.rotation[ 3 ] = f[ fs + 6 ];
	return out;
}

// sensor begin/end touch events: { sensorShapeId, visitorShapeId }
function createSensorTouchEvent()
{
	return {
		sensorShapeId: { index1: 0, world0: 0, generation: 0 },
		visitorShapeId: { index1: 0, world0: 0, generation: 0 },
	};
}
function readSensorTouch( out, eb, i, base )
{
	const a = eb.i32;
	const s = base + i * SENSOR_TOUCH_STRIDE;
	readShapeId( out.sensorShapeId, a, s );
	readShapeId( out.visitorShapeId, a, s + 3 );
	return out;
}
function getSensorBeginEventAt( out, eb, i ) { return readSensorTouch( out, eb, i, eb.sensorBeginBase ); }
function getSensorEndEventAt( out, eb, i ) { return readSensorTouch( out, eb, i, eb.sensorEndBase ); }

// joint events: { jointId }
function createJointEvent() { return { jointId: { index1: 0, world0: 0, generation: 0 } }; }
function getJointEventAt( out, eb, i )
{
	const a = eb.i32;
	const s = eb.jointBase + i * JOINT_STRIDE;
	out.jointId.index1 = a[ s ]; out.jointId.world0 = a[ s + 1 ]; out.jointId.generation = a[ s + 2 ];
	return out;
}

// --- b3World_CollideMover plane results ---------------------------------------
// The CollideMover callback receives a packed buffer { count, data: Float32Array }
// (LAYOUT.plane floats per plane); read it with these instead of a JS array of objects.

function getNumPlaneResults( buf ) { return buf.count; }
function createPlaneResult()
{
	return { plane: { normal: [ 0, 0, 0 ], offset: 0 }, point: [ 0, 0, 0 ] };
}
function getPlaneResultAt( out, buf, i )
{
	const d = buf.data;
	const s = i * LAYOUT.plane;
	const nrm = out.plane.normal;
	nrm[ 0 ] = d[ s ]; nrm[ 1 ] = d[ s + 1 ]; nrm[ 2 ] = d[ s + 2 ];
	out.plane.offset = d[ s + 3 ];
	out.point[ 0 ] = d[ s + 4 ]; out.point[ 1 ] = d[ s + 5 ]; out.point[ 2 ] = d[ s + 6 ];
	return out;
}

// --- convex decomposition (V-HACD) -------------------------------------------
//
//   const res = b3.b3CreateConvexDecompositionShapes( body, shapeDef, positions, indices, { maxConvexHulls: 16 } );
//   const id = b3.createShapeId();
//   for ( let i = 0; i < b3.getNumShapeIds( res ); i++ ) b3.getShapeIdAt( id, res, i );
//
// The blocking bindings live in src/bindings.cpp. The Promise variants below keep
// the calling thread free while V-HACD runs:
//
// * MT builds: a background pthread (ConvexDecompositionJobImpl), polled from the
//   event loop.
// * ST builds in a browser: a module Web Worker running its own single-threaded
//   instance of this module, created on first use from this factory's own source
//   (`Box3D.toString()`), so no extra file has to be served or bundled. The worker
//   returns the packed decomposition (transferred, not copied) and the main thread
//   attaches it in one call. If the worker can't start (e.g. a CSP that blocks blob:
//   workers), the jobs run synchronously instead.
// * ST builds in Node: synchronously.

const DECOMPOSITION_POLL_MS = 4;

let decompositionWorker = null; // { worker, pending: Map<id, job>, nextId, failed }

function canUseDecompositionWorker()
{
	return !ENVIRONMENT_IS_NODE && typeof Worker === 'function' && typeof Blob === 'function'
		&& typeof URL.createObjectURL === 'function';
}

function computeDecompositionNow( job )
{
	try { job.resolve( Module.b3ComputeConvexDecomposition( job.positions, job.indices, job.options ) ); }
	catch ( err ) { job.reject( err ); }
}

function failDecompositionWorker( w, reason )
{
	if ( w.failed ) return;
	w.failed = true;
	w.worker.terminate();
	console.warn( `box3d.js: convex decomposition worker unavailable (${reason}); decomposing on the main thread` );
	for ( const job of w.pending.values() ) computeDecompositionNow( job );
	w.pending.clear();
}

function startDecompositionWorker()
{
	// separate-wasm builds locate the .wasm by URL; inline builds embed it in the factory source
	const wasm = findWasmBinary();
	const moduleArg = typeof wasm === 'string'
		? `{ locateFile: () => ${JSON.stringify( new URL( wasm, globalThis.location?.href ).href )} }`
		: '{}';
	const src = `const factory = (${Box3D.toString()});
const ready = factory(${moduleArg});
ready.then(() => self.postMessage({ type: 'ready' }),
	(err) => self.postMessage({ type: 'init-error', message: String(err?.message ?? err) }));
self.onmessage = async ({ data }) => {
	const b3 = await ready;
	let packed;
	try { packed = b3.b3ComputeConvexDecomposition(data.positions, data.indices, data.options); }
	catch (err) { self.postMessage({ type: 'error', id: data.id, message: String(err?.message ?? err) }); return; }
	self.postMessage({ type: 'result', id: data.id, packed }, [packed.points.buffer, packed.offsets.buffer]);
};`;
	const url = URL.createObjectURL( new Blob( [ src ], { type: 'text/javascript' } ) );
	const w = { worker: null, pending: new Map(), nextId: 1, failed: false };
	try
	{
		w.worker = new Worker( url, { type: 'module', name: 'box3d.js convex decomposition' } );
	}
	catch ( err )
	{
		URL.revokeObjectURL( url );
		w.failed = true;
		console.warn( `box3d.js: convex decomposition worker unavailable (${err?.message ?? err}); decomposing on the main thread` );
		return w;
	}
	w.worker.onmessage = ( { data } ) =>
	{
		if ( data.type === 'ready' ) { URL.revokeObjectURL( url ); return; }
		if ( data.type === 'init-error' ) { URL.revokeObjectURL( url ); failDecompositionWorker( w, data.message ); return; }
		const job = w.pending.get( data.id );
		if ( !job ) return;
		w.pending.delete( data.id );
		if ( data.type === 'result' ) job.resolve( data.packed );
		else job.reject( new Error( data.message ) );
	};
	w.worker.onerror = ( event ) =>
	{
		event.preventDefault?.();
		URL.revokeObjectURL( url );
		failDecompositionWorker( w, event.message || 'worker error' );
	};
	return w;
}

// Promise of the packed decomposition, computed off the calling thread in ST browsers.
function decomposeOffThread( positions, indices, options )
{
	return new Promise( ( resolve, reject ) =>
	{
		const job = { resolve, reject, positions, indices, options };
		if ( !canUseDecompositionWorker() ) { computeDecompositionNow( job ); return; }
		decompositionWorker ??= startDecompositionWorker();
		const w = decompositionWorker;
		if ( w.failed ) { computeDecompositionNow( job ); return; }
		const id = w.nextId++;
		w.pending.set( id, job );
		try
		{
			w.worker.postMessage( { id, positions, indices, options } );
		}
		catch ( err )
		{
			w.pending.delete( id );
			reject( err );
		}
	} );
}

function runDecompositionJob( positions, indices, options, finish )
{
	return new Promise( ( resolve, reject ) =>
	{
		const job = new Module.ConvexDecompositionJobImpl();
		try
		{
			job.start( positions, indices, options );
		}
		catch ( err )
		{
			job.delete();
			reject( err );
			return;
		}
		const poll = () =>
		{
			if ( !job.isReady() )
			{
				setTimeout( poll, DECOMPOSITION_POLL_MS );
				return;
			}
			try { resolve( finish( job ) ); }
			catch ( err ) { reject( err ); }
			finally { job.delete(); }
		};
		setTimeout( poll, DECOMPOSITION_POLL_MS );
	} );
}

function decomposeAsync( positions, indices, options )
{
	if ( !Module.ConvexDecompositionJobImpl ) return decomposeOffThread( positions, indices, options );
	return runDecompositionJob( positions, indices, options, ( job ) => job.takeResult() );
}

// --- convex decomposition cache ------------------------------------------------
// The async variants keep finished (and in-flight) decompositions in an LRU keyed by
// b3ConvexDecompositionCacheKey, so the same mesh + options runs V-HACD once; later
// requests reuse the packed result and only build hull shapes. Failed decompositions
// are not kept. The mesh part of the key is a 64-bit hash of exactly what V-HACD
// reads (positions as float32 bits, indices as uint32), memoized per (positions,
// indices) array pair — so arrays handed to the cache must not be edited in place
// afterwards (pass `cache: false`, or call b3ClearConvexDecompositionCache). An
// `options.cacheKey` (e.g. an asset id) replaces the mesh hash entirely.

const DECOMPOSITION_CACHE_LIMIT = 512;
const DECOMPOSITION_KEY_VERSION = 'b3cd1';

let decompositionCache = new Map(); // key -> Promise<packed>; Map order = LRU order
let decompositionMeshHashes = new WeakMap(); // positions -> WeakMap<indices, { hash, positionsLength, indicesLength }>
const decompositionCacheStats = { hits: 0, misses: 0 };

const HASH_CHUNK = 4096;
const hashScratchF32 = new Float32Array( HASH_CHUNK );
const hashScratchU32 = new Uint32Array( hashScratchF32.buffer );
let hashA = 0;
let hashB = 0;

// Two MurmurHash3-style 32-bit lanes with independent constants. Per-word rotations
// matter: without them a pair of sign-bit flips (e.g. mirrored vertices) cancels out.
function hashWords( words, count )
{
	let h1 = hashA, h2 = hashB;
	for ( let i = 0; i < count; i++ )
	{
		const w = words[ i ];
		let k1 = Math.imul( w, 0xcc9e2d51 );
		k1 = ( k1 << 15 ) | ( k1 >>> 17 );
		h1 ^= Math.imul( k1, 0x1b873593 );
		h1 = ( h1 << 13 ) | ( h1 >>> 19 );
		h1 = ( Math.imul( h1, 5 ) + 0xe6546b64 ) | 0;
		let k2 = Math.imul( w, 0x85ebca6b );
		k2 = ( k2 << 17 ) | ( k2 >>> 15 );
		h2 ^= Math.imul( k2, 0xc2b2ae35 );
		h2 = ( h2 << 11 ) | ( h2 >>> 21 );
		h2 = ( Math.imul( h2, 9 ) + 0x561ccd1b ) | 0;
	}
	hashA = h1;
	hashB = h2;
}

function fmix32( h )
{
	h ^= h >>> 16;
	h = Math.imul( h, 0x85ebca6b );
	h ^= h >>> 13;
	h = Math.imul( h, 0xc2b2ae35 );
	return h ^ ( h >>> 16 );
}

function hashDecompositionMesh( positions, indices )
{
	hashA = 0x9747b28c ^ positions.length;
	hashB = 0x2f4a7c15 ^ indices.length;
	if ( positions instanceof Float32Array )
	{
		hashWords( new Uint32Array( positions.buffer, positions.byteOffset, positions.length ), positions.length );
	}
	else
	{
		// number[] / Float64Array: hash the float32 rounding V-HACD will actually see
		for ( let start = 0; start < positions.length; start += HASH_CHUNK )
		{
			const n = Math.min( HASH_CHUNK, positions.length - start );
			for ( let i = 0; i < n; i++ ) hashScratchF32[ i ] = positions[ start + i ];
			hashWords( hashScratchU32, n );
		}
	}
	hashWords( indices, indices.length );
	let h1 = fmix32( hashA ^ positions.length );
	let h2 = fmix32( hashB ^ indices.length );
	h1 = ( h1 + h2 ) | 0;
	h2 = ( h2 + h1 ) | 0;
	return ( h1 >>> 0 ).toString( 16 ).padStart( 8, '0' ) + ( h2 >>> 0 ).toString( 16 ).padStart( 8, '0' );
}

function decompositionMeshHash( positions, indices )
{
	if ( typeof positions !== 'object' || positions === null || typeof indices !== 'object' || indices === null )
	{
		return hashDecompositionMesh( positions, indices );
	}
	let byIndices = decompositionMeshHashes.get( positions );
	const memo = byIndices?.get( indices );
	if ( memo && memo.positionsLength === positions.length && memo.indicesLength === indices.length ) return memo.hash;
	const hash = hashDecompositionMesh( positions, indices );
	if ( !byIndices ) decompositionMeshHashes.set( positions, byIndices = new WeakMap() );
	byIndices.set( indices, { hash, positionsLength: positions.length, indicesLength: indices.length } );
	return hash;
}

// Mirrors readDecompositionOptions in src/bindings.cpp (defaults, clamps, integer
// truncation), so equivalent option objects share an entry. useThreads is left out:
// threaded and unthreaded runs produce identical results.
function b3ConvexDecompositionCacheKey( positions, indices, options )
{
	const o = options ?? {};
	const num = ( v, fallback ) => ( v === undefined ? fallback : Number( v ) );
	const mesh = o.cacheKey !== undefined && o.cacheKey !== null
		? `id:${o.cacheKey}`
		: `mesh:${decompositionMeshHash( positions, indices )}`;
	return [
		DECOMPOSITION_KEY_VERSION,
		mesh,
		Math.trunc( Math.max( 1, num( o.maxConvexHulls, 32 ) ) ),
		Math.trunc( Math.max( 1000, num( o.resolution, 100000 ) ) ),
		Math.trunc( Math.min( 255, Math.max( 4, num( o.maxVerticesPerHull, 32 ) ) ) ),
		num( o.minVolumePercentError, 1 ),
		Math.trunc( Math.max( 1, num( o.maxRecursionDepth, 10 ) ) ),
		o.shrinkWrap === undefined || o.shrinkWrap ? 1 : 0,
	].join( '|' );
}

function cachedDecomposition( positions, indices, options )
{
	if ( options?.cache === false ) return decomposeAsync( positions, indices, options );
	let key;
	try { key = b3ConvexDecompositionCacheKey( positions, indices, options ); }
	catch { return decomposeAsync( positions, indices, options ); } // malformed input: let the binding report it
	let entry = decompositionCache.get( key );
	if ( entry )
	{
		decompositionCacheStats.hits++;
		decompositionCache.delete( key );
		decompositionCache.set( key, entry );
		return entry;
	}
	decompositionCacheStats.misses++;
	entry = decomposeAsync( positions, indices, options );
	decompositionCache.set( key, entry );
	entry.catch( () => { if ( decompositionCache.get( key ) === entry ) decompositionCache.delete( key ); } );
	if ( decompositionCache.size > DECOMPOSITION_CACHE_LIMIT ) decompositionCache.delete( decompositionCache.keys().next().value );
	return entry;
}

function b3ClearConvexDecompositionCache()
{
	decompositionCache = new Map();
	decompositionMeshHashes = new WeakMap();
	decompositionCacheStats.hits = 0;
	decompositionCacheStats.misses = 0;
}

function b3GetConvexDecompositionCacheStats()
{
	return { entries: decompositionCache.size, hits: decompositionCacheStats.hits, misses: decompositionCacheStats.misses };
}

function b3ComputeConvexDecompositionAsync( positions, indices, options )
{
	if ( options?.cache === false ) return decomposeAsync( positions, indices, options );
	// callers get their own copy, so editing the result can't corrupt the cache
	return cachedDecomposition( positions, indices, options ).then( ( packed ) =>
		( { points: packed.points.slice(), offsets: packed.offsets.slice() } ) );
}

function assertBodyStillValid( bodyId )
{
	if ( !Module.b3Body_IsValid( bodyId ) )
	{
		throw new Error( 'box3d.js: body was destroyed before the convex decomposition finished' );
	}
}

function b3CreateConvexDecompositionShapesAsync( bodyId, shapeDef, positions, indices, options )
{
	if ( !Module.b3Body_IsValid( bodyId ) ) return Promise.reject( new Error( 'box3d.js: body is not valid' ) );
	return cachedDecomposition( positions, indices, options ).then( ( packed ) =>
	{
		assertBodyStillValid( bodyId );
		return Module.b3CreateConvexDecompositionShapesFromPacked( bodyId, shapeDef, packed, options?.maxVerticesPerHull );
	} );
}

function b3PackConvexDecomposition( parts )
{
	let total = 0;
	for ( const part of parts )
	{
		if ( part.length % 3 !== 0 ) throw new Error( 'box3d.js: each piece must have a multiple of 3 floats' );
		total += part.length;
	}
	const points = new Float32Array( total );
	const offsets = new Uint32Array( parts.length + 1 );
	let o = 0;
	for ( let i = 0; i < parts.length; i++ )
	{
		points.set( parts[ i ], o );
		o += parts[ i ].length;
		offsets[ i + 1 ] = o / 3;
	}
	return { points, offsets };
}

function b3UnpackConvexDecomposition( packed )
{
	const { points, offsets } = packed;
	const parts = [];
	for ( let i = 0; i + 1 < offsets.length; i++ ) parts.push( points.subarray( offsets[ i ] * 3, offsets[ i + 1 ] * 3 ) );
	return parts;
}

// --- debug draw (reusable, wasm-backed; zero JS alloc per fill) ---------------
//
//   const dd = b3.createDebugDrawBuffer();
//   const shape = b3.createDebugShapeRecord();
//   b3.getDebugDraw( dd, world, { shapes: true, contacts: true } );
//   for ( let i = 0, n = b3.getNumDebugShapes( dd ); i < n; i++ )
//   {
//     b3.getDebugShapeAt( shape, dd, i );
//     const geo = b3.getDebugGeometry( shape.geometryId ); // wasm views; copy to cache
//   }
//   b3.destroyDebugDrawBuffer( dd );
//
// Strides come from bindings.cpp (LAYOUT). Field order matches DebugDrawBuffer packing.
// getDebugGeometry is the embind function: views onto the geometry cache, or null.

const DEBUG_SHAPE_I32 = LAYOUT.debugShapeI32;
const DEBUG_SHAPE_F64 = LAYOUT.debugShapeF64;
const DEBUG_SEGMENT_F64 = LAYOUT.debugSegmentF64;
const DEBUG_SEGMENT_I32 = LAYOUT.debugSegmentI32;
const DEBUG_POINT_F64 = LAYOUT.debugPointF64;
const DEBUG_POINT_F32 = LAYOUT.debugPointF32;
const DEBUG_POINT_I32 = LAYOUT.debugPointI32;
const DEBUG_SPHERE_F64 = LAYOUT.debugSphereF64;
const DEBUG_SPHERE_F32 = LAYOUT.debugSphereF32;
const DEBUG_SPHERE_I32 = LAYOUT.debugSphereI32;
const DEBUG_CAPSULE_F64 = LAYOUT.debugCapsuleF64;
const DEBUG_CAPSULE_F32 = LAYOUT.debugCapsuleF32;
const DEBUG_CAPSULE_I32 = LAYOUT.debugCapsuleI32;
const DEBUG_BOX_F32 = LAYOUT.debugBoxF32;
const DEBUG_BOX_F64 = LAYOUT.debugBoxF64;
const DEBUG_BOX_I32 = LAYOUT.debugBoxI32;
const DEBUG_BOUNDS_F64 = LAYOUT.debugBoundsF64;
const DEBUG_BOUNDS_I32 = LAYOUT.debugBoundsI32;
const DEBUG_TRANSFORM_F64 = LAYOUT.debugTransformF64;
const DEBUG_TRANSFORM_I32 = LAYOUT.debugTransformI32;

function createDebugDrawBuffer()
{
	return {
		_impl: new Module.DebugDrawBufferImpl(),
		i32: null, f32: null, f64: null,
		shapeCount: 0, shapeI32Base: 0, shapeF64Base: 0,
		segmentCount: 0, segmentI32Base: 0, segmentF64Base: 0,
		pointCount: 0, pointI32Base: 0, pointF32Base: 0, pointF64Base: 0,
		sphereCount: 0, sphereI32Base: 0, sphereF32Base: 0, sphereF64Base: 0,
		capsuleCount: 0, capsuleI32Base: 0, capsuleF32Base: 0, capsuleF64Base: 0,
		boxCount: 0, boxI32Base: 0, boxF32Base: 0, boxF64Base: 0,
		boundsCount: 0, boundsI32Base: 0, boundsF64Base: 0,
		transformCount: 0, transformI32Base: 0, transformF64Base: 0,
	};
}

function getDebugDraw( buf, worldId, options )
{
	const impl = buf._impl;
	impl.loadFrom( worldId, options === undefined ? {} : options );
	buf.i32 = HEAP32;
	buf.f32 = HEAPF32;
	buf.f64 = HEAPF64;
	buf.shapeCount = impl.shapeCount();
	buf.shapeI32Base = impl.shapeI32Ptr() >> 2;
	buf.shapeF64Base = impl.shapeF64Ptr() >> 3;
	buf.segmentCount = impl.segmentCount();
	buf.segmentI32Base = impl.segmentI32Ptr() >> 2;
	buf.segmentF64Base = impl.segmentF64Ptr() >> 3;
	buf.pointCount = impl.pointCount();
	buf.pointI32Base = impl.pointI32Ptr() >> 2;
	buf.pointF32Base = impl.pointF32Ptr() >> 2;
	buf.pointF64Base = impl.pointF64Ptr() >> 3;
	buf.sphereCount = impl.sphereCount();
	buf.sphereI32Base = impl.sphereI32Ptr() >> 2;
	buf.sphereF32Base = impl.sphereF32Ptr() >> 2;
	buf.sphereF64Base = impl.sphereF64Ptr() >> 3;
	buf.capsuleCount = impl.capsuleCount();
	buf.capsuleI32Base = impl.capsuleI32Ptr() >> 2;
	buf.capsuleF32Base = impl.capsuleF32Ptr() >> 2;
	buf.capsuleF64Base = impl.capsuleF64Ptr() >> 3;
	buf.boxCount = impl.boxCount();
	buf.boxI32Base = impl.boxI32Ptr() >> 2;
	buf.boxF32Base = impl.boxF32Ptr() >> 2;
	buf.boxF64Base = impl.boxF64Ptr() >> 3;
	buf.boundsCount = impl.boundsCount();
	buf.boundsI32Base = impl.boundsI32Ptr() >> 2;
	buf.boundsF64Base = impl.boundsF64Ptr() >> 3;
	buf.transformCount = impl.transformCount();
	buf.transformI32Base = impl.transformI32Ptr() >> 2;
	buf.transformF64Base = impl.transformF64Ptr() >> 3;
	return buf;
}

function destroyDebugDrawBuffer( buf )
{
	buf._impl.delete();
	buf._impl = null;
}

function getNumDebugShapes( buf ) { return buf.shapeCount; }
function getNumDebugSegments( buf ) { return buf.segmentCount; }
function getNumDebugPoints( buf ) { return buf.pointCount; }
function getNumDebugSpheres( buf ) { return buf.sphereCount; }
function getNumDebugCapsules( buf ) { return buf.capsuleCount; }
function getNumDebugBoxes( buf ) { return buf.boxCount; }
function getNumDebugBounds( buf ) { return buf.boundsCount; }
function getNumDebugTransforms( buf ) { return buf.transformCount; }

function createDebugShapeRecord()
{
	return { geometryId: 0, state: 0, color: 0, position: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ] };
}
function getDebugShapeAt( out, buf, i )
{
	const a = buf.i32;
	const s = buf.shapeI32Base + i * DEBUG_SHAPE_I32;
	out.geometryId = a[ s ] >>> 0;
	out.state = a[ s + 1 ];
	out.color = a[ s + 2 ] >>> 0;
	const f = buf.f64;
	const fs = buf.shapeF64Base + i * DEBUG_SHAPE_F64;
	out.position[ 0 ] = f[ fs ]; out.position[ 1 ] = f[ fs + 1 ]; out.position[ 2 ] = f[ fs + 2 ];
	out.rotation[ 0 ] = f[ fs + 3 ]; out.rotation[ 1 ] = f[ fs + 4 ]; out.rotation[ 2 ] = f[ fs + 5 ]; out.rotation[ 3 ] = f[ fs + 6 ];
	return out;
}

function createDebugSegment()
{
	return { p1: [ 0, 0, 0 ], p2: [ 0, 0, 0 ], color: 0, role: 0 };
}
function getDebugSegmentAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.segmentF64Base + i * DEBUG_SEGMENT_F64;
	out.p1[ 0 ] = f[ fs ]; out.p1[ 1 ] = f[ fs + 1 ]; out.p1[ 2 ] = f[ fs + 2 ];
	out.p2[ 0 ] = f[ fs + 3 ]; out.p2[ 1 ] = f[ fs + 4 ]; out.p2[ 2 ] = f[ fs + 5 ];
	const a = buf.i32;
	const s = buf.segmentI32Base + i * DEBUG_SEGMENT_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugPoint()
{
	return { position: [ 0, 0, 0 ], size: 0, color: 0, role: 0 };
}
function getDebugPointAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.pointF64Base + i * DEBUG_POINT_F64;
	out.position[ 0 ] = f[ fs ]; out.position[ 1 ] = f[ fs + 1 ]; out.position[ 2 ] = f[ fs + 2 ];
	out.size = buf.f32[ buf.pointF32Base + i * DEBUG_POINT_F32 ];
	const a = buf.i32;
	const s = buf.pointI32Base + i * DEBUG_POINT_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugSpherePrimitive()
{
	return { center: [ 0, 0, 0 ], radius: 0, alpha: 0, color: 0, role: 0 };
}
function getDebugSphereAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.sphereF64Base + i * DEBUG_SPHERE_F64;
	out.center[ 0 ] = f[ fs ]; out.center[ 1 ] = f[ fs + 1 ]; out.center[ 2 ] = f[ fs + 2 ];
	const p = buf.f32;
	const ps = buf.sphereF32Base + i * DEBUG_SPHERE_F32;
	out.radius = p[ ps ]; out.alpha = p[ ps + 1 ];
	const a = buf.i32;
	const s = buf.sphereI32Base + i * DEBUG_SPHERE_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugCapsulePrimitive()
{
	return { p1: [ 0, 0, 0 ], p2: [ 0, 0, 0 ], radius: 0, alpha: 0, color: 0, role: 0 };
}
function getDebugCapsuleAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.capsuleF64Base + i * DEBUG_CAPSULE_F64;
	out.p1[ 0 ] = f[ fs ]; out.p1[ 1 ] = f[ fs + 1 ]; out.p1[ 2 ] = f[ fs + 2 ];
	out.p2[ 0 ] = f[ fs + 3 ]; out.p2[ 1 ] = f[ fs + 4 ]; out.p2[ 2 ] = f[ fs + 5 ];
	const p = buf.f32;
	const ps = buf.capsuleF32Base + i * DEBUG_CAPSULE_F32;
	out.radius = p[ ps ]; out.alpha = p[ ps + 1 ];
	const a = buf.i32;
	const s = buf.capsuleI32Base + i * DEBUG_CAPSULE_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugBoxPrimitive()
{
	return { extents: [ 0, 0, 0 ], position: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], color: 0, role: 0 };
}
function getDebugBoxAt( out, buf, i )
{
	const p = buf.f32;
	const ps = buf.boxF32Base + i * DEBUG_BOX_F32;
	out.extents[ 0 ] = p[ ps ]; out.extents[ 1 ] = p[ ps + 1 ]; out.extents[ 2 ] = p[ ps + 2 ];
	const f = buf.f64;
	const fs = buf.boxF64Base + i * DEBUG_BOX_F64;
	out.position[ 0 ] = f[ fs ]; out.position[ 1 ] = f[ fs + 1 ]; out.position[ 2 ] = f[ fs + 2 ];
	out.rotation[ 0 ] = f[ fs + 3 ]; out.rotation[ 1 ] = f[ fs + 4 ]; out.rotation[ 2 ] = f[ fs + 5 ]; out.rotation[ 3 ] = f[ fs + 6 ];
	const a = buf.i32;
	const s = buf.boxI32Base + i * DEBUG_BOX_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugBoundsPrimitive()
{
	return { aabb: [ 0, 0, 0, 0, 0, 0 ], color: 0, role: 0 };
}
function getDebugBoundsAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.boundsF64Base + i * DEBUG_BOUNDS_F64;
	for ( let k = 0; k < 6; k++ ) out.aabb[ k ] = f[ fs + k ];
	const a = buf.i32;
	const s = buf.boundsI32Base + i * DEBUG_BOUNDS_I32;
	out.color = a[ s ] >>> 0;
	out.role = a[ s + 1 ];
	return out;
}

function createDebugTransformPrimitive()
{
	return { position: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], role: 0 };
}
function getDebugTransformAt( out, buf, i )
{
	const f = buf.f64;
	const fs = buf.transformF64Base + i * DEBUG_TRANSFORM_F64;
	out.position[ 0 ] = f[ fs ]; out.position[ 1 ] = f[ fs + 1 ]; out.position[ 2 ] = f[ fs + 2 ];
	out.rotation[ 0 ] = f[ fs + 3 ]; out.rotation[ 1 ] = f[ fs + 4 ]; out.rotation[ 2 ] = f[ fs + 5 ]; out.rotation[ 3 ] = f[ fs + 6 ];
	out.role = buf.i32[ buf.transformI32Base + i * DEBUG_TRANSFORM_I32 ];
	return out;
}

// --- out-param math reads (conventions documented in src/bindings.cpp header) ---
// Each raw `b3X_GetYInto(out, ...)` writes floats to a static wasm scratch; the
// public `b3X_GetY(out, ...) -> out` copies scratch -> the caller's mathcat array.
//
// The readers are GENERATED from the binding-site metadata (_outMeta(), injected at
// build time as the OUT-META list below), so this file carries no per-method list: add
// an out getter in bindings.cpp and it is installed automatically. Each generated reader is monomorphic + fixed-arity with
// an unrolled copy (no arguments/slice/spread on the hot path) and does one wasm
// crossing per read. The static scratch address is stable, so its element offsets
// are baked in as literals; HEAPF32 is re-read each call via getF32() so the reader
// stays correct across memory growth (which can swap the heap view).

// Everything below touches the embind API on Module (b3_getMathScratch, the raw *Into
// writers) and installs the public reader surface. In MT (pthread) builds this same
// post-js ALSO runs inside each worker, where those embind fns are not attached to the
// worker's Module — and workers run box3d's scheduler tasks, never the facade API. So
// configure the public surface on the main thread only; on a pthread worker, bail.
// (ENVIRONMENT_IS_PTHREAD is undefined in single-threaded builds — hence the typeof.)
if ( typeof ENVIRONMENT_IS_PTHREAD === 'undefined' || !ENVIRONMENT_IS_PTHREAD )
{
	// Resolve the static scratch once — the address is stable — and strip the getter
	// from the public module (it's internal plumbing). --post-js runs after embind has
	// registered, so the raw fns are already on Module here.
	const SCRATCH = Module.b3_getMathScratch(); // byte pointer to the static float scratch
	const SCRATCH_F32 = SCRATCH >>> 2; //          element base into HEAPF32
	delete Module.b3_getMathScratch;

	// Live-heap accessor in factory scope: HEAPF32 is a module-scope var that memory
	// growth may reassign, so the generated readers call this each time rather than
	// closing over a stale view. (The readers are built with `new Function`, whose body
	// runs in global scope and so cannot see the bare `HEAPF32` directly.)
	const getF32 = () => HEAPF32;

	// Build a reader from one _outMeta entry. `sizes` is the float count of each out
	// slot; `trailing` the number of forwarded input args. Returns the single out for a
	// one-out getter, or [out0, out1, ...] for a multi-out one (a transform reads as
	// position + rotation). The copy is codegen'd unrolled per slot with literal scratch
	// offsets — no per-call allocation or branching.
	const makeOutParamReader = ( rawInto, sizes, trailing ) =>
	{
		const outs = sizes.map( ( _, i ) => `out${i}` );
		const trail = Array.from( { length: trailing }, ( _, i ) => `a${i}` );
		const params = [ ...outs, ...trail ].join( ', ' );

		// scratch byte pointer per out slot (slots are laid out contiguously)
		let byteOff = 0;
		const slotPtrs = sizes.map( ( n ) => { const p = SCRATCH + byteOff; byteOff += n * 4; return p; } );
		const intoArgs = [ ...slotPtrs, ...trail ].join( ', ' );

		let elemOff = 0;
		const copy = sizes.map( ( n, i ) =>
		{
			const base = SCRATCH_F32 + elemOff; elemOff += n;
			let body = '';
			for ( let k = 0; k < n; k++ ) body += `out${i}[${k}]=h[${base + k}];`;
			return body;
		} ).join( '' );

		const ret = outs.length === 1 ? outs[ 0 ] : `[ ${outs.join( ', ' )} ]`;
		return new Function( 'raw', 'getF32',
			`return function(${params}){raw(${intoArgs});const h=getF32();${copy}return ${ret};};` )( rawInto, getF32 );
	};

	// Install a public reader per binding-site entry; capture + strip the raw `*Into`.
	for ( const entry of __B3_OUT_META__ )
	{
		const rawName = entry.method + 'Into';
		const raw = Module[ rawName ];
		if ( !raw ) { console.warn( `box3d.js: _outMeta lists ${rawName}, but it is not on the module — skipping` ); continue; }
		delete Module[ rawName ]; // strip the raw writer from the public surface
		Module[ entry.method ] = makeOutParamReader( raw, entry.sizes, entry.trailing );
	}

	// embind checks argument counts exactly; these wrappers let the trailing
	// options / maxVerticesPerHull / material argument be omitted.
	const rawCompute = Module.b3ComputeConvexDecomposition;
	const rawShapes = Module.b3CreateConvexDecompositionShapes;
	const rawShapesFromPacked = Module.b3CreateConvexDecompositionShapesFromPacked;
	const rawCompound = Module.b3CreateDecompositionCompound;
	Module.b3ComputeConvexDecomposition = ( positions, indices, options ) => rawCompute( positions, indices, options );
	Module.b3CreateConvexDecompositionShapes = ( bodyId, shapeDef, positions, indices, options ) =>
		rawShapes( bodyId, shapeDef, positions, indices, options );
	Module.b3CreateConvexDecompositionShapesFromPacked = ( bodyId, shapeDef, packed, maxVerticesPerHull ) =>
		rawShapesFromPacked( bodyId, shapeDef, packed, maxVerticesPerHull );
	Module.b3CreateDecompositionCompound = ( packed, material ) => rawCompound( packed, material );

	// Attach onto the Emscripten module object (in scope here as `Module`).
	Object.assign( Module, {
		getNumShapeIds, createShapeId, getShapeIdAt,
		getNumContacts, createContact, getContactAt,
		createPoint, createManifold, getManifoldAt,
		createContactsBuffer, getShapeContactData, getBodyContactData, destroyContactsBuffer,
		createEventsBuffer, getEvents, destroyEventsBuffer,
		getNumContactBeginEvents, getNumContactEndEvents, getNumContactHitEvents,
		getNumBodyMoveEvents, getNumSensorBeginEvents, getNumSensorEndEvents, getNumJointEvents,
		createContactTouchEvent, getContactBeginEventAt, getContactEndEventAt,
		createContactHitEvent, getContactHitEventAt,
		createBodyMoveEvent, getBodyMoveEventAt,
		createSensorTouchEvent, getSensorBeginEventAt, getSensorEndEventAt,
		createJointEvent, getJointEventAt,
		getNumPlaneResults, createPlaneResult, getPlaneResultAt,
		createDebugDrawBuffer, getDebugDraw, destroyDebugDrawBuffer,
		getNumDebugShapes, getNumDebugSegments, getNumDebugPoints, getNumDebugSpheres,
		getNumDebugCapsules, getNumDebugBoxes, getNumDebugBounds, getNumDebugTransforms,
		createDebugShapeRecord, getDebugShapeAt,
		createDebugSegment, getDebugSegmentAt,
		createDebugPoint, getDebugPointAt,
		createDebugSpherePrimitive, getDebugSphereAt,
		createDebugCapsulePrimitive, getDebugCapsuleAt,
		createDebugBoxPrimitive, getDebugBoxAt,
		createDebugBoundsPrimitive, getDebugBoundsAt,
		createDebugTransformPrimitive, getDebugTransformAt,
		b3ComputeConvexDecompositionAsync, b3CreateConvexDecompositionShapesAsync,
		b3PackConvexDecomposition, b3UnpackConvexDecomposition,
		b3ConvexDecompositionCacheKey, b3ClearConvexDecompositionCache, b3GetConvexDecompositionCacheStats,
	} );
}
