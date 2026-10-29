// Smoke test: base API + a real "falling box" simulation, run against both
// build variants (separate-wasm and inlined single-file).

import assert from 'node:assert/strict';

function fallingBox( b3 )
{
	// world with downward gravity
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	assert.ok( b3.b3World_IsValid( world ), 'world is valid' );

	// static ground: a wide, thin box centered at the origin
	const groundBodyDef = b3.b3DefaultBodyDef();
	groundBodyDef.type = b3.b3BodyType.b3_staticBody;
	groundBodyDef.position = [ 0, 0, 0 ];
	const ground = b3.b3CreateBody( world, groundBodyDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	// dynamic body: a sphere dropped from y = 10
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = [ 0, 10, 0 ];
	const body = b3.b3CreateBody( world, bodyDef );
	const shapeDef = b3.b3DefaultShapeDef();
	b3.b3CreateSphereShape( body, shapeDef, { center: [ 0, 0, 0 ], radius: 0.5 } );

	// out-param reader: fill a caller-owned [x,y,z], read component 1 (y)
	const pos = [ 0, 0, 0 ];
	const startY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// simulate ~2.5 s at 60 Hz
	for ( let i = 0; i < 150; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
	}

	const endY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// multi-out reader: a transform reads as two out params (position + rotation),
	// and returns them as a [position, rotation] tuple.
	const tp = [ 0, 0, 0 ], tq = [ 0, 0, 0, 1 ];
	const [ tPos, tRot ] = b3.b3Body_GetTransform( tp, tq, body );
	assert.ok( tPos === tp && tRot === tq, 'GetTransform fills the caller arrays and returns them' );
	assert.ok( Math.abs( tPos[ 1 ] - endY ) < 1e-6, 'transform position matches GetPosition' );
	assert.ok( Math.abs( Math.hypot( tRot[ 0 ], tRot[ 1 ], tRot[ 2 ], tRot[ 3 ] ) - 1 ) < 1e-3, 'transform rotation is a unit quaternion' );

	b3.b3DestroyWorld( world );
	return { startY, endY };
}

// Drop a box onto the ground, let it settle, then read the resulting contact via
// the packed buffer + facade readers (createContact/getContactAt/getManifoldAt).
function contactRead( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );

	const groundDef = b3.b3DefaultBodyDef();
	groundDef.type = b3.b3BodyType.b3_staticBody;
	const ground = b3.b3CreateBody( world, groundDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	const boxDef = b3.b3DefaultBodyDef();
	boxDef.type = b3.b3BodyType.b3_dynamicBody;
	boxDef.position = [ 0, 5, 0 ];
	const box = b3.b3CreateBody( world, boxDef );
	const boxShape = b3.b3CreateBoxShape( box, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5 );

	// events buffer: one step while the box is falling reliably produces a body
	// move event — read it back through the reusable, wasm-backed events buffer.
	const eb = b3.createEventsBuffer();
	const move = b3.createBodyMoveEvent();
	b3.b3World_Step( world, 1 / 60, 4 );
	b3.getEvents( eb, world );
	const moveCount = b3.getNumBodyMoveEvents( eb );
	assert.ok( moveCount >= 1, `body move events reported while falling (got ${moveCount})` );
	b3.getBodyMoveEventAt( move, eb, 0 );
	assert.ok( Number.isFinite( move.position[ 1 ] ), 'body move event decodes a finite position' );
	const q = move.rotation;
	assert.ok( Math.abs( Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ) - 1 ) < 1e-3, 'move event rotation is a unit quaternion' );

	for ( let i = 0; i < 150; i++ ) b3.b3World_Step( world, 1 / 60, 4 );

	// reusable contacts buffer: fill it, read it, then refill after another step to
	// exercise reuse + the growth-safe view refresh.
	const cb = b3.createContactsBuffer();
	const contact = b3.createContact();
	const manifold = b3.createManifold();

	function summarize()
	{
		b3.getShapeContactData( cb, boxShape );
		const n = b3.getNumContacts( cb );
		let totalPoints = 0;
		let worstNormalErr = 0;
		for ( let i = 0; i < n; i++ )
		{
			b3.getContactAt( contact, cb, i );
			// the queried shape is one side of the contact (box3d picks the A/B order)
			assert.ok(
				contact.shapeIdA.index1 === boxShape.index1 || contact.shapeIdB.index1 === boxShape.index1,
				'queried shape id round-trips as one side of the contact',
			);
			for ( let m = 0; m < contact.manifoldCount; m++ )
			{
				b3.getManifoldAt( manifold, contact, m );
				const nrm = manifold.normal;
				worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
				totalPoints += manifold.pointCount;
			}
		}
		return { n, totalPoints, worstNormalErr };
	}

	const first = summarize();
	b3.b3World_Step( world, 1 / 60, 4 );
	const second = summarize(); // still valid after a refill following a step

	assert.ok( first.n >= 1, `resting box reports a contact (got ${first.n})` );
	assert.ok( first.totalPoints >= 1, `contact has at least one manifold point (got ${first.totalPoints})` );
	assert.ok( first.worstNormalErr < 1e-3, `manifold normal is unit-length (err ${first.worstNormalErr.toExponential( 1 )})` );
	assert.ok( second.n >= 1, 'reusable buffer still valid after a refill following a step' );

	b3.destroyContactsBuffer( cb );
	b3.destroyEventsBuffer( eb );
	b3.b3DestroyWorld( world );
	return { n: first.n, totalPoints: first.totalPoints, worstNormalErr: first.worstNormalErr };
}

// Exercise the sensor-touch, and CollideMover plane-result readers — the
// browser-facing buffer paths the examples use but the contact scene doesn't hit.
function eventsAndPlanes( b3 )
{
	const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );

	// sensor box at the origin with a dynamic visitor overlapping it
	const sensorBody = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );
	const sensorShapeDef = b3.b3DefaultShapeDef();
	sensorShapeDef.isSensor = true;
	sensorShapeDef.enableSensorEvents = true;
	b3.b3CreateBoxShape( sensorBody, sensorShapeDef, 2, 2, 2 );

	const visitorDef = b3.b3DefaultBodyDef();
	visitorDef.type = b3.b3BodyType.b3_dynamicBody;
	visitorDef.position = [ 0, 0, 0 ];
	const visitorBody = b3.b3CreateBody( world, visitorDef );
	const visitorShapeDef = b3.b3DefaultShapeDef();
	visitorShapeDef.enableSensorEvents = true;
	const visitorShape = b3.b3CreateBoxShape( visitorBody, visitorShapeDef, 0.5, 0.5, 0.5 );

	const eb = b3.createEventsBuffer();
	const touch = b3.createSensorTouchEvent();
	let sawSensor = false;
	for ( let i = 0; i < 10 && !sawSensor; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
		b3.getEvents( eb, world );
		for ( let k = 0, n = b3.getNumSensorBeginEvents( eb ); k < n; k++ )
		{
			b3.getSensorBeginEventAt( touch, eb, k );
			if ( touch.visitorShapeId.index1 === visitorShape.index1 ) sawSensor = true;
		}
	}
	b3.destroyEventsBuffer( eb );
	assert.ok( sawSensor, 'sensor begin-touch event decoded via the events buffer' );

	// CollideMover: a mover capsule overlapping a static sphere yields collision
	// planes (placed clear of the sensor bodies above).
	const obstacleDef = b3.b3DefaultBodyDef();
	obstacleDef.position = [ 10, 1, 0 ];
	const obstacle = b3.b3CreateBody( world, obstacleDef );
	b3.b3CreateSphereShape( obstacle, b3.b3DefaultShapeDef(), { center: [ 0, 0, 0 ], radius: 0.6 } );
	b3.b3World_Step( world, 1 / 60, 4 ); // put the new shape into the broadphase
	const capsule = { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.35 };
	const planeResult = b3.createPlaneResult();
	let planeCount = 0;
	let worstNormalErr = 0;
	b3.b3World_CollideMover( world, [ 10, 1, 0 ], capsule, b3.b3DefaultQueryFilter(), ( _s, buf ) =>
	{
		for ( let i = 0, n = b3.getNumPlaneResults( buf ); i < n; i++ )
		{
			b3.getPlaneResultAt( planeResult, buf, i );
			const nrm = planeResult.plane.normal;
			worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
			planeCount++;
		}
		return true;
	} );
	assert.ok( planeCount >= 1, `CollideMover reported plane results via the buffer (got ${planeCount})` );
	assert.ok( worstNormalErr < 1e-3, 'plane-result normal is unit-length' );

	// Body CollideMover: the same mover against a dynamic body at a caller-given
	// transform. The body sits far away; its transform is overridden to the mover.
	const dynDef = b3.b3DefaultBodyDef();
	dynDef.type = b3.b3BodyType.b3_dynamicBody;
	dynDef.position = [ -50, 0, 0 ];
	dynDef.gravityScale = 0;
	const dynBody = b3.b3CreateBody( world, dynDef );
	const dynShape = b3.b3CreateSphereShape( dynBody, b3.b3DefaultShapeDef(), { center: [ 0, 0, 0 ], radius: 0.6 } );
	b3.b3CreateSphereShape( dynBody, b3.b3DefaultShapeDef(), { center: [ 0, 5, 0 ], radius: 0.1 } ); // out of reach
	const bodyPlanes = b3.b3Body_CollideMover( dynBody, [ 0, 0, 0 ], capsule, b3.b3DefaultQueryFilter(),
		{ position: [ 0.5, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] } );
	assert.equal( b3.getNumBodyPlaneResults( bodyPlanes ), 1, 'body CollideMover reports one plane for the touching shape' );
	const bodyPlane = b3.getBodyPlaneResultAt( b3.createBodyPlaneResult(), bodyPlanes, 0 );
	assert.deepEqual( bodyPlane.shapeId, { index1: dynShape.index1, world0: dynShape.world0, generation: dynShape.generation },
		'body plane result carries the touching shape id' );
	assert.ok( bodyPlane.result.plane.normal[ 0 ] < -0.9, `body plane normal points from the shape to the mover (got ${bodyPlane.result.plane.normal})` );
	const missed = b3.b3Body_CollideMover( dynBody, [ 0, 0, 0 ], capsule, b3.b3DefaultQueryFilter(),
		{ position: [ 0, -50, 0 ], quaternion: [ 0, 0, 0, 1 ] } );
	assert.equal( b3.getNumBodyPlaneResults( missed ), 0, 'body CollideMover reports nothing when out of reach' );

	b3.b3DestroyWorld( world );
	return { sawSensor, planeCount };
}

// Dynamic character: a rotation-locked capsule that a pogo joint holds above the
// ground and a mover joint drives sideways, as in box3d's DynamicMover sample.
function moverAndPogoJoints( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const ground = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	const capsule = { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.3 };
	const moverDef = b3.b3DefaultBodyDef();
	moverDef.type = b3.b3BodyType.b3_dynamicBody;
	moverDef.position = [ 0, 2, 0 ];
	moverDef.motionLocks = { linearX: false, linearY: false, linearZ: false, angularX: true, angularY: true, angularZ: true };
	moverDef.enableSleep = false;
	moverDef.safetyFactor = 0.25;
	const mover = b3.b3CreateBody( world, moverDef );
	assert.equal( b3.b3Body_GetSafetyFactor( mover ), 0.25, 'body def safetyFactor survives the JS round trip' );
	const shapeDef = b3.b3DefaultShapeDef();
	shapeDef.density = 200;
	shapeDef.baseMaterial.friction = 0;
	b3.b3CreateCapsuleShape( mover, shapeDef, capsule );

	const moverJointDef = b3.b3DefaultMoverJointDef();
	moverJointDef.base.bodyIdA = ground;
	moverJointDef.base.bodyIdB = mover;
	moverJointDef.base.collideConnected = true;
	moverJointDef.maxForce = 6000;
	const moverJoint = b3.b3CreateMoverJoint( world, moverJointDef );
	assert.ok( b3.b3Joint_GetType( moverJoint ) === b3.b3JointType.b3_moverJoint, 'mover joint has the mover type' );

	const weight = 10 * b3.b3Body_GetMass( mover );
	const restLength = 0.9;
	const pogoDef = b3.b3DefaultPogoJointDef();
	pogoDef.base.bodyIdA = ground;
	pogoDef.base.bodyIdB = mover;
	pogoDef.base.collideConnected = true;
	pogoDef.base.localFrameA = { position: [ 0, 0.5, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	pogoDef.base.localFrameB = { position: capsule.center1, quaternion: [ 0, 0, 0, 1 ] };
	pogoDef.normal = [ 0, 1, 0 ];
	pogoDef.restLength = restLength;
	pogoDef.hertz = 3;
	pogoDef.dampingRatio = 0.8;
	pogoDef.maxCompressionForce = 100 * weight;
	pogoDef.maxTensionForce = 100 * weight;
	const pogo = b3.b3CreatePogoJoint( world, pogoDef );
	assert.ok( b3.b3Joint_GetType( pogo ) === b3.b3JointType.b3_pogoJoint, 'pogo joint has the pogo type' );
	assert.ok( Math.abs( b3.b3PogoJoint_GetRestLength( pogo ) - restLength ) < 1e-6, 'pogo def restLength is applied' );

	for ( let i = 0; i < 120; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const p = [ 0, 0, 0 ];
	b3.b3Body_GetPosition( p, mover );
	const pogoLength = b3.b3PogoJoint_GetCurrentLength( pogo );
	// The ground top is y = 0.5 and the capsule bottom sits 0.8 below the body origin.
	assert.ok( p[ 1 ] - 0.8 > 0.5, `pogo holds the capsule clear of the ground (y=${p[ 1 ].toFixed( 3 )})` );
	assert.ok( Math.abs( pogoLength - restLength ) < 0.1, `pogo settles near its rest length (got ${pogoLength.toFixed( 3 )})` );

	b3.b3MoverJoint_SetLinearVelocity( moverJoint, [ 2, 0, 0 ] );
	for ( let i = 0; i < 60; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const v = [ 0, 0, 0 ];
	b3.b3Body_GetLinearVelocity( v, mover );
	assert.ok( Math.abs( v[ 0 ] - 2 ) < 0.1, `mover joint drives the target velocity (vx=${v[ 0 ].toFixed( 3 )})` );

	b3.b3DestroyWorld( world );
	return { height: p[ 1 ], speed: v[ 0 ] };
}

// Indexed torus around the y axis: concave, so V-HACD has to split it.
function torusMesh( radius = 1, tube = 0.35, radial = 24, tubular = 12 )
{
	const positions = [];
	const indices = [];
	for ( let i = 0; i < radial; i++ )
	{
		const u = ( i / radial ) * Math.PI * 2;
		for ( let j = 0; j < tubular; j++ )
		{
			const v = ( j / tubular ) * Math.PI * 2;
			const r = radius + tube * Math.cos( v );
			positions.push( r * Math.cos( u ), tube * Math.sin( v ), r * Math.sin( u ) );
		}
	}
	for ( let i = 0; i < radial; i++ )
	{
		for ( let j = 0; j < tubular; j++ )
		{
			const a = i * tubular + j;
			const b = ( ( i + 1 ) % radial ) * tubular + j;
			const c = ( ( i + 1 ) % radial ) * tubular + ( ( j + 1 ) % tubular );
			const d = i * tubular + ( ( j + 1 ) % tubular );
			indices.push( a, d, b, b, d, c );
		}
	}
	return { positions: new Float32Array( positions ), indices: new Uint32Array( indices ) };
}

function groundedWorld( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const groundDef = b3.b3DefaultBodyDef();
	groundDef.type = b3.b3BodyType.b3_staticBody;
	b3.b3CreateBoxShape( b3.b3CreateBody( world, groundDef ), b3.b3DefaultShapeDef(), 25, 0.5, 25 );
	return world;
}

function dynamicBody( b3, world, y )
{
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = [ 0, y, 0 ];
	return b3.b3CreateBody( world, def );
}

function assertShapesValid( b3, res, body, label )
{
	assert.equal( b3.getNumShapeIds( res ), res.count, `${label}: getNumShapeIds reads the count` );
	assert.equal( b3.b3Body_GetShapeCount( body ), res.count, `${label}: every returned id is a shape on the body` );
	const id = b3.createShapeId();
	for ( let i = 0; i < res.count; i++ )
	{
		b3.getShapeIdAt( id, res, i );
		assert.ok( b3.b3Shape_IsValid( id ), `${label}: shape ${i} is valid` );
		assert.equal( b3.b3Shape_GetType( id ), b3.b3ShapeType.b3_hullShape, `${label}: shape ${i} is a hull` );
	}
}

const DECOMPOSITION_OPTIONS = { maxConvexHulls: 12, resolution: 50000 };

// Convex decomposition: single-call shape creation, the packed format, the static
// compound route, and the Promise variants.
async function convexDecomposition( b3, extraOptions = {} )
{
	const { positions, indices } = torusMesh();
	const options = { ...DECOMPOSITION_OPTIONS, ...extraOptions };

	// single call: decompose and attach hull shapes to a dynamic body, then drop it
	const world = groundedWorld( b3 );
	const body = dynamicBody( b3, world, 5 );
	const sd = b3.b3DefaultShapeDef();
	const res = b3.b3CreateConvexDecompositionShapes( body, sd, positions, indices, options );
	assert.ok( res.count > 1, `torus decomposes into several pieces (got ${res.count})` );
	assert.equal( res.skipped, 0, 'no piece skipped with the default vertex budget' );
	assertShapesValid( b3, res, body, 'single call' );

	const pos = [ 0, 0, 0 ];
	for ( let i = 0; i < 240; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const restY = b3.b3Body_GetPosition( pos, body )[ 1 ];
	assert.ok( restY < 1.5 && restY > 0.5, `decomposed torus fell and rests on the ground (y=${restY.toFixed( 2 )})` );
	assert.ok( !b3.b3Body_IsAwake( body ) || Math.abs( b3.b3Body_GetLinearVelocity( pos, body )[ 1 ] ) < 0.1, 'torus came to rest' );

	// packed format: compute, round-trip, and build the same shapes from it
	const packed = b3.b3ComputeConvexDecomposition( positions, indices, options );
	assert.ok( packed.points instanceof Float32Array && packed.offsets instanceof Uint32Array, 'packed format is typed arrays' );
	assert.equal( packed.offsets.length - 1, res.count, 'packed piece count matches the single call' );
	const parts = b3.b3UnpackConvexDecomposition( packed );
	const repacked = b3.b3PackConvexDecomposition( parts );
	assert.deepEqual( Array.from( repacked.points ), Array.from( packed.points ), 'pack/unpack round-trips points' );
	assert.deepEqual( Array.from( repacked.offsets ), Array.from( packed.offsets ), 'pack/unpack round-trips offsets' );

	const body2 = dynamicBody( b3, world, 10 );
	const res2 = b3.b3CreateConvexDecompositionShapesFromPacked( body2, sd, packed );
	assert.equal( res2.count, res.count, 'FromPacked creates the same number of shapes' );
	assertShapesValid( b3, res2, body2, 'from packed' );

	// static route: one compound shape on a static body
	const { compound, skipped } = b3.b3CreateDecompositionCompound( packed, { ...b3.b3DefaultSurfaceMaterial(), friction: 0.8 } );
	assert.ok( compound, 'compound created' );
	assert.equal( skipped, 0, 'no compound piece skipped' );
	const staticDef = b3.b3DefaultBodyDef();
	staticDef.type = b3.b3BodyType.b3_staticBody;
	staticDef.position = [ 5, 1, 0 ];
	const compoundShape = b3.b3CreateBakedCompoundShape( b3.b3CreateBody( world, staticDef ), b3.b3DefaultShapeDef(), compound );
	assert.ok( b3.b3Shape_IsValid( compoundShape ), 'compound shape is valid' );
	assert.equal( b3.b3Shape_GetType( compoundShape ), b3.b3ShapeType.b3_compoundShape, 'shape is a compound' );
	b3.b3World_Step( world, 1 / 60, 4 );

	// Promise variants agree with the blocking call
	const asyncPacked = await b3.b3ComputeConvexDecompositionAsync( positions, indices, options );
	assert.equal( asyncPacked.offsets.length - 1, res.count, 'async compute yields the same piece count' );
	// the recommended pattern: create the body disabled, attach shapes async, then enable it
	const asyncDef = b3.b3DefaultBodyDef();
	asyncDef.type = b3.b3BodyType.b3_dynamicBody;
	asyncDef.isEnabled = false;
	asyncDef.position = [ -6, 5, 0 ];
	const body3 = b3.b3CreateBody( world, asyncDef );
	const res3 = await b3.b3CreateConvexDecompositionShapesAsync( body3, sd, positions, indices, options );
	assert.equal( res3.count, res.count, 'async shapes yields the same count' );
	assertShapesValid( b3, res3, body3, 'async' );
	b3.b3Body_Enable( body3 );
	for ( let i = 0; i < 240; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const asyncRestY = b3.b3Body_GetPosition( pos, body3 )[ 1 ];
	assert.ok( asyncRestY < 1.5 && asyncRestY > 0.5, `body enabled after async shapes falls and rests (y=${asyncRestY.toFixed( 2 )})` );

	// a body destroyed while the job runs rejects (MT); in ST the call completes before
	// the destroy, so only check the rejection where decomposition is truly async
	if ( b3.b3HasThreads() )
	{
		const doomed = dynamicBody( b3, world, 20 );
		const pending = b3.b3CreateConvexDecompositionShapesAsync( doomed, sd, positions, indices, { ...options, cache: false } );
		b3.b3DestroyBody( doomed );
		await assert.rejects( pending, /destroyed/, 'async shapes rejects when the body is destroyed first' );
	}

	await decompositionCache( b3, world, options );

	assert.throws( () => b3.b3CreateConvexDecompositionShapes( body, sd, positions, new Uint32Array( [ 0, 1, 9999, 0, 1, 2, 0, 2, 3, 1, 2, 3 ] ) ),
		/out of range/, 'bad triangle index throws' );

	b3.b3DestroyWorld( world );
	b3.b3DestroyCompound( compound );
	return { pieces: res.count, restY };
}

// The async variants' cache: hits, in-flight sharing, key normalization, asset ids,
// hash sensitivity, copy-on-return, and that failures are not cached.
async function decompositionCache( b3, world, options )
{
	const { positions, indices } = torusMesh( 1.2, 0.3 );
	const sd = b3.b3DefaultShapeDef();
	const key = ( p, i, o ) => b3.b3ConvexDecompositionCacheKey( p, i, o );
	b3.b3ClearConvexDecompositionCache();
	assert.deepEqual( b3.b3GetConvexDecompositionCacheStats(), { entries: 0, hits: 0, misses: 0 }, 'clear resets the cache' );

	// concurrent requests for the same mesh share one decomposition; a later one hits
	const [ a, b ] = await Promise.all( [
		b3.b3CreateConvexDecompositionShapesAsync( dynamicBody( b3, world, 30 ), sd, positions, indices, options ),
		b3.b3CreateConvexDecompositionShapesAsync( dynamicBody( b3, world, 35 ), sd, positions, indices, options ),
	] );
	assert.equal( a.count, b.count, 'shared in-flight result builds the same shapes' );
	const c = await b3.b3CreateConvexDecompositionShapesAsync( dynamicBody( b3, world, 40 ), sd, positions, indices, options );
	assert.equal( c.count, a.count, 'cache hit builds the same shapes' );
	assert.deepEqual( b3.b3GetConvexDecompositionCacheStats(), { entries: 1, hits: 2, misses: 1 }, 'one decomposition served three bodies' );

	// equivalent inputs and options map to one key; useThreads does not change the result
	assert.equal( key( Array.from( positions ), Array.from( indices ), options ), key( positions, indices, options ), 'number[] and typed arrays share a key' );
	assert.equal( key( positions, indices, {} ), key( positions, indices, { maxConvexHulls: 32, resolution: 100000, shrinkWrap: true } ), 'defaults are normalized' );
	assert.equal( key( positions, indices, { maxVerticesPerHull: 999 } ), key( positions, indices, { maxVerticesPerHull: 255 } ), 'clamps are normalized' );
	assert.equal( key( positions, indices, { useThreads: true } ), key( positions, indices, {} ), 'useThreads is not part of the key' );
	assert.notEqual( key( positions, indices, { maxConvexHulls: 8 } ), key( positions, indices, {} ), 'options that change the result change the key' );

	// the mesh hash sees single-bit changes, including paired sign flips (mirroring)
	const mirrored = positions.slice();
	mirrored[ 0 ] = -mirrored[ 0 ];
	mirrored[ 3 ] = -mirrored[ 3 ];
	assert.notEqual( key( mirrored, indices ), key( positions, indices ), 'paired sign flips change the key' );
	const swapped = indices.slice();
	[ swapped[ 0 ], swapped[ 1 ] ] = [ swapped[ 1 ], swapped[ 0 ] ];
	assert.notEqual( key( positions, swapped ), key( positions, indices ), 'index order changes the key' );

	// asset ids replace the mesh hash, but options still split entries
	assert.equal( key( positions, indices, { cacheKey: 'torus' } ), key( mirrored, swapped, { cacheKey: 'torus' } ), 'cacheKey replaces the mesh hash' );
	assert.notEqual( key( positions, indices, { cacheKey: 'torus', maxConvexHulls: 4 } ), key( positions, indices, { cacheKey: 'torus' } ), 'cacheKey keeps options in the key' );

	// the compute variant hands out copies, so editing one can't corrupt the cache
	const first = await b3.b3ComputeConvexDecompositionAsync( positions, indices, options );
	const original = first.points[ 0 ];
	first.points[ 0 ] = 1e6;
	const second = await b3.b3ComputeConvexDecompositionAsync( positions, indices, options );
	assert.equal( second.points[ 0 ], original, 'cached result is not shared with callers' );

	// cache: false bypasses it; a failed decomposition is not kept
	const before = b3.b3GetConvexDecompositionCacheStats();
	await b3.b3ComputeConvexDecompositionAsync( positions, indices, { ...options, cache: false } );
	assert.deepEqual( b3.b3GetConvexDecompositionCacheStats(), before, 'cache: false neither reads nor writes' );
	const bad = new Uint32Array( [ 0, 1, 9999, 0, 1, 2, 0, 2, 3, 1, 2, 3 ] );
	await assert.rejects( b3.b3ComputeConvexDecompositionAsync( positions, bad, options ), /out of range/, 'async compute rejects a bad mesh' );
	assert.equal( b3.b3GetConvexDecompositionCacheStats().entries, before.entries, 'failures are not cached' );
	b3.b3ClearConvexDecompositionCache();
}

// Ground plus a resting dynamic box (sleep off, so the box stays awake and still
// emits contacts), a distance joint, and one shape of each geometry kind.
function debugDraw( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	worldDef.enableSleep = false;
	const world = b3.b3CreateWorld( worldDef );

	const groundDef = b3.b3DefaultBodyDef();
	groundDef.type = b3.b3BodyType.b3_staticBody;
	const ground = b3.b3CreateBody( world, groundDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	const boxDef = b3.b3DefaultBodyDef();
	boxDef.type = b3.b3BodyType.b3_dynamicBody;
	boxDef.position = [ 0, 2, 0 ];
	boxDef.enableSleep = false;
	const box = b3.b3CreateBody( world, boxDef );
	b3.b3Body_EnableSleep( box, false );
	b3.b3CreateBoxShape( box, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5 );

	function dynamicAt( x, y, z )
	{
		const def = b3.b3DefaultBodyDef();
		def.type = b3.b3BodyType.b3_dynamicBody;
		def.position = [ x, y, z ];
		def.enableSleep = false;
		const body = b3.b3CreateBody( world, def );
		b3.b3Body_EnableSleep( body, false );
		b3.b3CreateBoxShape( body, b3.b3DefaultShapeDef(), 0.4, 0.4, 0.4 );
		return body;
	}
	const jointA = dynamicAt( -4, 4, 0 );
	const jointB = dynamicAt( -4, 2, 0 );
	const jd = b3.b3DefaultDistanceJointDef();
	jd.base.bodyIdA = jointA;
	jd.base.bodyIdB = jointB;
	jd.base.localFrameA = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	jd.base.localFrameB = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	jd.length = 2;
	b3.b3CreateDistanceJoint( world, jd );

	for ( let i = 0; i < 120; i++ ) b3.b3World_Step( world, 1 / 60, 4 );

	const dd = b3.createDebugDrawBuffer();
	const shape = b3.createDebugShapeRecord();
	const segment = b3.createDebugSegment();
	const point = b3.createDebugPoint();
	const bounds = b3.createDebugBoundsPrimitive();
	const transform = b3.createDebugTransformPrimitive();

	const state = b3.DebugShapeState;
	const role = b3.DebugDrawRole;
	const STATIC = state[ 'static' ].value;
	const AWAKE = state.awake.value;

	function fill( options )
	{
		b3.getDebugDraw( dd, world, options );
	}
	function zeros()
	{
		return b3.getNumDebugShapes( dd ) === 0 && b3.getNumDebugSegments( dd ) === 0
			&& b3.getNumDebugPoints( dd ) === 0 && b3.getNumDebugSpheres( dd ) === 0
			&& b3.getNumDebugCapsules( dd ) === 0 && b3.getNumDebugBoxes( dd ) === 0
			&& b3.getNumDebugBounds( dd ) === 0 && b3.getNumDebugTransforms( dd ) === 0;
	}

	fill( {} );
	assert.ok( zeros(), 'no role flags means an empty debug buffer' );

	fill( { shapes: true } );
	const shapeCount = b3.getNumDebugShapes( dd );
	assert.ok( shapeCount >= 2, `shapes pass reports the ground and the box (got ${shapeCount})` );
	let sawStatic = false;
	let sawAwake = false;
	for ( let i = 0; i < shapeCount; i++ )
	{
		b3.getDebugShapeAt( shape, dd, i );
		if ( shape.state === STATIC ) sawStatic = true;
		if ( shape.state === AWAKE ) sawAwake = true;
		assert.ok( shape.geometryId > 0, 'shape carries a geometry id' );
		const q = shape.rotation;
		assert.ok( Math.abs( Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ) - 1 ) < 1e-3, 'shape rotation is a unit quaternion' );
	}
	assert.ok( sawStatic, 'ground is reported as static' );
	assert.ok( sawAwake, 'resting dynamic box stays awake when sleep is disabled' );
	assert.equal( b3.getNumDebugSegments( dd ), 0, 'shapes pass does not emit segments' );

	function assertRoles( count, read, roleValue, label )
	{
		assert.ok( count > 0, `${label} count is non-zero (got ${count})` );
		for ( let i = 0; i < count; i++ )
		{
			const rec = read( i );
			assert.equal( rec.role, roleValue, `${label} primitives are tagged with that role` );
		}
	}

	fill( { bounds: true } );
	assertRoles( b3.getNumDebugBounds( dd ), ( i ) => b3.getDebugBoundsAt( bounds, dd, i ), role.bounds.value, 'bounds' );

	fill( { joints: true } );
	const jointSegments = b3.getNumDebugSegments( dd );
	assert.ok( jointSegments >= 1, `joints pass draws the distance joint (got ${jointSegments} segments)` );
	for ( let i = 0; i < jointSegments; i++ )
	{
		b3.getDebugSegmentAt( segment, dd, i );
		assert.equal( segment.role, role.joints.value, 'joint segments are tagged joints' );
		assert.notEqual( segment.color & 0xffffff, 0xF0FFFF, 'joints alone do not include the azure extra' );
	}

	fill( { joints: true, jointExtras: true } );
	const extraSegments = b3.getNumDebugSegments( dd );
	assert.ok( extraSegments > jointSegments, `jointExtras adds a segment (${jointSegments} -> ${extraSegments})` );
	let azure = 0;
	for ( let i = 0; i < extraSegments; i++ )
	{
		b3.getDebugSegmentAt( segment, dd, i );
		assert.equal( segment.role, role.joints.value, 'joint extras stay on the joints role' );
		if ( ( segment.color & 0xffffff ) === 0xF0FFFF ) azure++;
	}
	assert.ok( azure >= 1, 'jointExtras draws the azure constraint-force segment' );

	fill( { mass: true } );
	assertRoles( b3.getNumDebugTransforms( dd ), ( i ) => b3.getDebugTransformAt( transform, dd, i ), role.mass.value, 'mass' );

	fill( { contacts: true } );
	assertRoles( b3.getNumDebugPoints( dd ), ( i ) => b3.getDebugPointAt( point, dd, i ), role.contactPoints.value, 'contact points' );
	assert.equal( b3.getNumDebugSegments( dd ), 0, 'contact points pass does not keep the other contact primitives' );

	fill( { contactNormals: true } );
	assertRoles( b3.getNumDebugSegments( dd ), ( i ) => b3.getDebugSegmentAt( segment, dd, i ), role.contactNormals.value, 'contact normals' );

	fill( { contactForces: true } );
	const forceSegments = b3.getNumDebugSegments( dd );
	assertRoles( forceSegments, ( i ) => b3.getDebugSegmentAt( segment, dd, i ), role.contactForces.value, 'contact forces' );
	for ( let i = 0; i < forceSegments; i++ )
	{
		b3.getDebugSegmentAt( segment, dd, i );
		assert.notEqual( segment.color & 0xffffff, 0xFFFF00, 'contact-forces pass drops the yellow friction lines' );
	}

	fill( { frictionForces: true } );
	const frictionSegments = b3.getNumDebugSegments( dd );
	assertRoles( frictionSegments, ( i ) => b3.getDebugSegmentAt( segment, dd, i ), role.frictionForces.value, 'friction forces' );
	for ( let i = 0; i < frictionSegments; i++ )
	{
		b3.getDebugSegmentAt( segment, dd, i );
		assert.equal( segment.color & 0xffffff, 0xFFFF00, 'friction pass keeps only the yellow segments' );
	}
	assert.notEqual( frictionSegments, forceSegments, 'friction and normal-force segments are different sets' );

	fill( { contactFeatures: true } );
	assertRoles( b3.getNumDebugPoints( dd ), ( i ) => b3.getDebugPointAt( point, dd, i ), role.contactFeatures.value, 'contact features' );

	fill( { islands: true } );
	assertRoles( b3.getNumDebugBounds( dd ), ( i ) => b3.getDebugBoundsAt( bounds, dd, i ), role.islands.value, 'islands' );

	fill( { graphColors: true } );
	assertRoles( b3.getNumDebugPoints( dd ), ( i ) => b3.getDebugPointAt( point, dd, i ), role.graphColors.value, 'graph colours' );
	assert.equal( b3.getNumDebugSegments( dd ), 0, 'graph-colours pass records points only' );

	b3.destroyDebugDrawBuffer( dd );
	b3.b3DestroyWorld( world );

	function expectGeometry( label, create, check )
	{
		const wdef = b3.b3DefaultWorldDef();
		const w = b3.b3CreateWorld( wdef );
		const bdef = b3.b3DefaultBodyDef();
		bdef.type = b3.b3BodyType.b3_staticBody;
		const body = b3.b3CreateBody( w, bdef );
		const made = create( body );
		const buf = b3.createDebugDrawBuffer();
		const rec = b3.createDebugShapeRecord();
		b3.getDebugDraw( buf, w, { shapes: true } );
		assert.equal( b3.getNumDebugShapes( buf ), 1, `${label}: one shape drawn` );
		b3.getDebugShapeAt( rec, buf, 0 );
		const geo = b3.getDebugGeometry( rec.geometryId );
		assert.ok( geo, `${label}: geometry is cached` );
		check( geo, label );
		const id = rec.geometryId;
		b3.b3DestroyShape( made.shape, true );
		assert.equal( b3.getDebugGeometry( id ), null, `${label}: destroying the shape frees its geometry` );
		b3.getDebugDraw( buf, w, { shapes: true } );
		assert.equal( b3.getNumDebugShapes( buf ), 0, `${label}: the next draw omits the destroyed shape` );
		if ( made.release ) made.release();
		b3.destroyDebugDrawBuffer( buf );
		b3.b3DestroyWorld( w );
	}

	expectGeometry( 'hull', ( body ) =>
	{
		const hull = b3.b3CreateHull( [
			-0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5, 0.5,  -0.5, -0.5, 0.5,
			-0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5, 0.5,  -0.5,  0.5, 0.5,
		] );
		const shape = b3.b3CreateHullShape( body, b3.b3DefaultShapeDef(), hull );
		return { shape, release: () => b3.b3DestroyHull( hull ) };
	}, ( geo, label ) =>
	{
		assert.ok( geo.indices.length >= 3, `${label}: triangulated faces` );
		assert.equal( geo.spheres.length, 0, `${label}: no sphere parameters` );
		assert.equal( geo.capsules.length, 0, `${label}: no capsule parameters` );
	} );

	expectGeometry( 'mesh', ( body ) =>
	{
		const mesh = b3.b3CreateMesh(
			new Float32Array( [ 0, 0, 0,  1, 0, 0,  0, 0, 1 ] ),
			new Uint32Array( [ 0, 1, 2 ] ),
		);
		const shape = b3.b3CreateMeshShape( body, b3.b3DefaultShapeDef(), mesh, [ 1, 1, 1 ] );
		return { shape, release: () => b3.b3DestroyMesh( mesh ) };
	}, ( geo, label ) =>
	{
		assert.ok( geo.indices.length >= 3, `${label}: triangles` );
		assert.ok( geo.positions.length >= 9, `${label}: vertices` );
	} );

	expectGeometry( 'height field', ( body ) =>
	{
		const hf = b3.b3CreateHeightField( [ 0, 0.2, 0.1, 0.4 ], 2, 2, [ 1, 1, 1 ] );
		const shape = b3.b3CreateHeightFieldShape( body, b3.b3DefaultShapeDef(), hf );
		return { shape, release: () => b3.b3DestroyHeightField( hf ) };
	}, ( geo, label ) =>
	{
		assert.ok( geo.indices.length >= 6, `${label}: both cell triangles` );
		assert.ok( geo.positions.length >= 12, `${label}: four grid points` );
	} );

	expectGeometry( 'compound', ( body ) =>
	{
		const hull = b3.b3CreateHull( [
			-0.4, -0.2, -0.4,  0.4, -0.2, -0.4,  0.4, -0.2, 0.4,  -0.4, -0.2, 0.4,
			-0.4,  0.2, -0.4,  0.4,  0.2, -0.4,  0.4,  0.2, 0.4,  -0.4,  0.2, 0.4,
		] );
		const compound = b3.b3CreateCompound( {
			hulls: [ { hull, transform: { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] } } ],
			spheres: [ { sphere: { center: [ 0, 0.8, 0 ], radius: 0.3 } } ],
		} );
		const shape = b3.b3CreateBakedCompoundShape( body, b3.b3DefaultShapeDef(), compound );
		return {
			shape,
			release: () =>
			{
				b3.b3DestroyCompound( compound );
				b3.b3DestroyHull( hull );
			},
		};
	}, ( geo, label ) =>
	{
		assert.ok( geo.indices.length >= 3, `${label}: hull child triangles` );
		assert.equal( geo.spheres.length, 4, `${label}: sphere child is parameters (xyz, radius)` );
	} );

	expectGeometry( 'sphere', ( body ) =>
	{
		const shape = b3.b3CreateSphereShape( body, b3.b3DefaultShapeDef(), { center: [ 0.2, -0.1, 0.3 ], radius: 0.7 } );
		return { shape };
	}, ( geo, label ) =>
	{
		assert.equal( geo.indices.length, 0, `${label}: not tessellated` );
		assert.equal( geo.spheres.length, 4, `${label}: center and radius` );
		assert.ok( Math.abs( geo.spheres[ 3 ] - 0.7 ) < 1e-5, `${label}: radius round-trips` );
	} );

	expectGeometry( 'capsule', ( body ) =>
	{
		const shape = b3.b3CreateCapsuleShape( body, b3.b3DefaultShapeDef(), {
			center1: [ 0, -0.4, 0 ], center2: [ 0, 0.4, 0 ], radius: 0.25,
		} );
		return { shape };
	}, ( geo, label ) =>
	{
		assert.equal( geo.indices.length, 0, `${label}: not tessellated` );
		assert.equal( geo.capsules.length, 7, `${label}: both centers and the radius` );
		assert.ok( Math.abs( geo.capsules[ 6 ] - 0.25 ) < 1e-5, `${label}: radius round-trips` );
	} );
}

async function check( label, importPath, decompositionOptions )
{
	const { default: Box3D } = await import( importPath );
	const b3 = await Box3D();

	const v = b3.b3GetVersion();
	const { startY, endY } = fallingBox( b3 );

	assert.ok( endY < startY - 5, `body fell (start=${startY.toFixed( 2 )} end=${endY.toFixed( 2 )})` );
	assert.ok( endY > 0.5, `body rests above the ground, not through it (end=${endY.toFixed( 2 )})` );

	const { n, totalPoints, worstNormalErr } = contactRead( b3 );
	assert.ok( n >= 1, `resting box reports a contact (got ${n})` );
	assert.ok( totalPoints >= 1, `contact has at least one manifold point (got ${totalPoints})` );
	assert.ok( worstNormalErr < 1e-3, `manifold normal is unit-length (err ${worstNormalErr.toExponential( 1 )})` );

	const { planeCount } = eventsAndPlanes( b3 );

	const { height, speed } = moverAndPogoJoints( b3 );

	const { pieces, restY } = await convexDecomposition( b3, decompositionOptions );

	debugDraw( b3 );

	console.log( `  ${label}: box3d v${v.major}.${v.minor}.${v.revision} — ` +
		`sphere fell ${startY.toFixed( 2 )} -> ${endY.toFixed( 2 )} and settled; ` +
		`read ${n} contact(s)/${totalPoints} point(s), a sensor touch, and ${planeCount} mover plane(s) from the buffers; ` +
		`pogo held a mover at y=${height.toFixed( 2 )} while its joint drove vx=${speed.toFixed( 2 )}; ` +
		`torus decomposed into ${pieces} hulls and rested at y=${restY.toFixed( 2 )}` );
}

console.log( 'box3d.js smoke test' );
await check( 'separate-wasm', '../dist/box3d.mjs' );
await check( 'inline       ', '../dist/box3d.inline.mjs' );
await check( 'mt (threads) ', '../dist/box3d.mt.mjs', { useThreads: true } );
console.log( 'OK' );
process.exit( 0 ); // the MT build's pthread pool keeps Node alive
