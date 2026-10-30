// Smoke test: base API + a real "falling box" simulation, run against both
// build variants (separate-wasm and inlined single-file).

import assert from 'node:assert/strict';
import { DynamicMover } from '../dist/character.mjs';

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

// Natively filtered queries: ignored bodies, ignored shapes and sensors are skipped inside the
// query, and the results match the callback versions filtering the same candidates in JS.
function filteredQueries( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, 0, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const staticAt = ( y ) =>
	{
		const def = b3.b3DefaultBodyDef();
		def.position = [ 0, y, 0 ];
		return b3.b3CreateBody( world, def );
	};
	// From the top: a sensor slab (y 3), a shelf (y 2), the ground (top at y 0.5)
	const sensorBody = staticAt( 3 );
	const sensorDef = b3.b3DefaultShapeDef();
	sensorDef.isSensor = true;
	const sensorShape = b3.b3CreateBoxShape( sensorBody, sensorDef, 1, 0.1, 1 );
	const shelf = staticAt( 2 );
	const shelfShape = b3.b3CreateBoxShape( shelf, b3.b3DefaultShapeDef(), 1, 0.1, 1 );
	const ground = staticAt( 0 );
	const groundShape = b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 5, 0.5, 5 );
	b3.b3World_Step( world, 1 / 60, 4 );

	const triples = ( ...ids ) => new Int32Array( ids.flatMap( ( id ) => [ id.index1, id.world0, id.generation ] ) );
	const same = ( a, index1, world0, generation ) => a.index1 === index1 && a.world0 === world0 && a.generation === generation;
	const filter = b3.b3DefaultQueryFilter();
	// JS reference for the same skip rule, fed to the callback APIs
	const skips = ( options, shapeId ) =>
	{
		const listed = ( arr, id ) => arr !== undefined && [ ...Array( arr.length / 3 ).keys() ].some( ( i ) => same( id, arr[ 3 * i ], arr[ 3 * i + 1 ], arr[ 3 * i + 2 ] ) );
		return listed( options?.ignoreShapes, shapeId ) || listed( options?.ignoreBodies, b3.b3Shape_GetBody( shapeId ) ) ||
			( options?.excludeSensors === true && b3.b3Shape_IsSensor( shapeId ) );
	};
	const cases = [
		{ name: 'no options', options: null },
		{ name: 'excludeSensors', options: { excludeSensors: true } },
		{ name: 'ignored body', options: { ignoreBodies: triples( shelf ), excludeSensors: true } },
		{ name: 'ignored shape', options: { ignoreShapes: triples( shelfShape, sensorShape ) } },
		{ name: 'everything ignored', options: { ignoreShapes: triples( shelfShape, groundShape ), excludeSensors: true } },
	];
	const expected = { 'excludeSensors': shelfShape, 'ignored body': groundShape, 'ignored shape': groundShape, 'everything ignored': null };

	const origin = [ 0, 5, 0 ];
	const down = [ 0, -10, 0 ];
	const points = new Float32Array( [ 0, 0, 0 ] );
	for ( const { name, options } of cases )
	{
		// Ray and shape casts: closest non-skipped hit, same as a clipping JS callback
		for ( const [ label, filtered, reference ] of [
			[ 'ray', () => b3.b3World_CastRayClosestFiltered( world, origin, down, filter, options ),
				( cb ) => b3.b3World_CastRay( world, origin, down, filter, cb ) ],
			[ 'shape', () => b3.b3World_CastShapeClosestFiltered( world, origin, points, 0.2, down, filter, options ),
				( cb ) => b3.b3World_CastShape( world, origin, points, 0.2, down, filter, cb ) ],
		] )
		{
			let best = null;
			reference( ( shapeId, point, normal, fraction ) =>
			{
				if ( skips( options, shapeId ) ) return -1;
				best = { shapeId, point, normal, fraction };
				return fraction;
			} );
			const hit = filtered();
			assert.ok( hit instanceof Float64Array, `${label} (${name}): returns a Float64Array` );
			if ( best === null )
			{
				assert.equal( hit.length, 0, `${label} (${name}): no hit is an empty array` );
				continue;
			}
			assert.equal( hit.length, 14, `${label} (${name}): 14 numbers per hit` );
			assert.ok( same( best.shapeId, hit[ 0 ], hit[ 1 ], hit[ 2 ] ), `${label} (${name}): same shape as the callback cast` );
			assert.ok( same( b3.b3Shape_GetBody( best.shapeId ), hit[ 3 ], hit[ 4 ], hit[ 5 ] ), `${label} (${name}): body id` );
			near( hit[ 7 ], best.point[ 1 ], 1e-5, `${label} (${name}): point` );
			near( hit[ 10 ], best.normal[ 1 ], 1e-5, `${label} (${name}): normal` );
			near( hit[ 12 ], best.fraction, 1e-6, `${label} (${name}): fraction` );
			assert.equal( hit[ 13 ], 0, `${label} (${name}): spare slot` );
			if ( name in expected ) assert.ok( same( expected[ name ], hit[ 0 ], hit[ 1 ], hit[ 2 ] ), `${label} (${name}): expected shape` );
		}
		if ( name in expected && expected[ name ] === null )
		{
			assert.equal( b3.b3World_CastRayClosestFiltered( world, origin, down, filter, options ).length, 0, `${name}: ray misses` );
		}

		// Mover cast: same fraction as the callback filter
		const mover = { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.35 };
		const fraction = b3.b3World_CastMoverFiltered( world, origin, mover, down, filter, options );
		const referenceFraction = b3.b3World_CastMover( world, origin, mover, down, filter, ( shapeId ) => !skips( options, shapeId ) );
		assert.equal( fraction, referenceFraction, `CastMoverFiltered (${name}) matches the callback filter` );

		// Mover planes: a capsule overlapping the shelf and the sensor
		const moverOrigin = [ 0, 2.3, 0 ];
		let referencePlanes = 0;
		b3.b3World_CollideMover( world, moverOrigin, mover, filter, ( shapeId, buf ) =>
		{
			if ( !skips( options, shapeId ) ) referencePlanes += b3.getNumPlaneResults( buf );
			return true;
		} );
		const planes = b3.b3World_CollideMoverPacked( world, moverOrigin, mover, filter, options );
		assert.ok( planes instanceof Float64Array && planes.length % 14 === 0, `CollideMoverPacked (${name}): stride 14` );
		assert.equal( planes.length / 14, referencePlanes, `CollideMoverPacked (${name}): same plane count as the callback` );
		for ( let o = 0; o < planes.length; o += 14 )
		{
			const shapeId = { index1: planes[ o ], world0: planes[ o + 1 ], generation: planes[ o + 2 ] };
			assert.ok( !skips( options, shapeId ), `CollideMoverPacked (${name}): skipped shape not reported` );
			assert.ok( same( b3.b3Shape_GetBody( shapeId ), planes[ o + 3 ], planes[ o + 4 ], planes[ o + 5 ] ), `CollideMoverPacked (${name}): body id` );
			assert.equal( planes[ o + 6 ], b3.b3BodyType.b3_staticBody.value, `CollideMoverPacked (${name}): body type` );
			near( Math.hypot( planes[ o + 7 ], planes[ o + 8 ], planes[ o + 9 ] ), 1, 1e-3, `CollideMoverPacked (${name}): unit normal` );
		}
		if ( name === 'ignored body' ) assert.equal( planes.length, 0, 'CollideMoverPacked: ignored shelf body gives no planes' );
		if ( name === 'no options' ) assert.ok( planes.length >= 14, 'CollideMoverPacked: the shelf gives planes' );
	}

	b3.b3DestroyWorld( world );
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

const IDENTITY_FRAME = () => ( { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] } );

function zeroGravityWorld( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, 0, 0 ];
	return b3.b3CreateWorld( worldDef );
}

function staticBody( b3, world, position = [ 0, 0, 0 ] )
{
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_staticBody;
	def.position = position;
	return b3.b3CreateBody( world, def );
}

function dynamicBox( b3, world, position, halfExtent = 0.5, shapeDef = b3.b3DefaultShapeDef() )
{
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = position;
	const body = b3.b3CreateBody( world, def );
	const shape = b3.b3CreateBoxShape( body, shapeDef, halfExtent, halfExtent, halfExtent );
	return { body, shape };
}

function near( actual, expected, tolerance, label )
{
	assert.ok( Math.abs( actual - expected ) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}` );
}

// Cylindrical joint: body B slides along and spins about frame A's x-axis, with
// both the linear and the angular motor driving into their limits.
function cylindricalJoint( b3 )
{
	const world = zeroGravityWorld( b3 );
	const ground = staticBody( b3, world );
	// density 1 kg/m^3: 1 kg boxes, so modest motor limits accelerate them quickly
	const lightDef = b3.b3DefaultShapeDef();
	lightDef.density = 1;
	const { body } = dynamicBox( b3, world, [ 0, 4, 0 ], 0.5, lightDef );

	const def = b3.b3DefaultCylindricalJointDef();
	assert.deepEqual( Array.from( def.localSlideAxisA ), [ 1, 0, 0 ], 'default slide axis is frame A x' );
	def.base.bodyIdA = ground;
	def.base.bodyIdB = body;
	def.base.localFrameA = { position: [ 0, 4, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	def.base.localFrameB = IDENTITY_FRAME();
	def.enableMotor = true;
	def.motorSpeed = 1;
	def.maxMotorForce = 50;
	def.enableAngularMotor = true;
	def.angularMotorSpeed = 2;
	def.maxMotorTorque = 5;
	const joint = b3.b3CreateCylindricalJoint( world, def );
	assert.equal( b3.b3Joint_GetType( joint ).value, b3.b3JointType.b3_cylindricalJoint.value, 'joint type is cylindrical' );

	// Free: both motors run at speed, coaxially
	for ( let i = 0; i < 15; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3CylindricalJoint_GetSpeed( joint ), 1, 0.02, 'linear motor speed' );
	near( b3.b3CylindricalJoint_GetAngularSpeed( joint ), 2, 0.02, 'angular motor speed' );
	const [ p, q ] = b3.b3Body_GetTransform( [ 0, 0, 0 ], [ 0, 0, 0, 1 ], body );
	near( p[ 1 ], 4, 1e-3, 'stays on the axis (y)' );
	near( p[ 2 ], 0, 1e-3, 'stays on the axis (z)' );
	near( q[ 1 ], 0, 1e-3, 'rotates only about x (qy)' );
	near( q[ 2 ], 0, 1e-3, 'rotates only about x (qz)' );
	near( p[ 0 ], b3.b3CylindricalJoint_GetTranslation( joint ), 1e-4, 'translation reads the slide' );
	near( 2 * Math.atan2( q[ 0 ], q[ 3 ] ), b3.b3CylindricalJoint_GetAngle( joint ), 1e-4, 'angle reads the spin' );

	// Limits stop both motors
	b3.b3CylindricalJoint_EnableLimit( joint, true );
	b3.b3CylindricalJoint_SetLimits( joint, -0.25, 0.5 );
	b3.b3CylindricalJoint_EnableAngularLimit( joint, true );
	b3.b3CylindricalJoint_SetAngularLimits( joint, -0.5, 1.0 );
	for ( let i = 0; i < 120; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3CylindricalJoint_GetTranslation( joint ), 0.5, 0.02, 'linear limit holds' );
	near( b3.b3CylindricalJoint_GetAngle( joint ), 1.0, 0.02, 'angular limit holds' );
	near( b3.b3CylindricalJoint_GetMotorForce( joint ), 50, 0.05, 'linear motor saturates against the limit' );
	near( b3.b3CylindricalJoint_GetMotorTorque( joint ), 5, 0.05, 'angular motor saturates against the limit' );

	// Springs replace the motors. Joint setters don't wake the bodies, which may be
	// asleep resting against the limits.
	b3.b3Joint_WakeBodies( joint );
	b3.b3CylindricalJoint_EnableMotor( joint, false );
	b3.b3CylindricalJoint_EnableAngularMotor( joint, false );
	b3.b3CylindricalJoint_EnableSpring( joint, true );
	b3.b3CylindricalJoint_SetSpringHertz( joint, 2 );
	b3.b3CylindricalJoint_SetSpringDampingRatio( joint, 1 );
	b3.b3CylindricalJoint_SetTargetTranslation( joint, 0.1 );
	b3.b3CylindricalJoint_EnableAngularSpring( joint, true );
	b3.b3CylindricalJoint_SetAngularSpringHertz( joint, 2 );
	b3.b3CylindricalJoint_SetAngularSpringDampingRatio( joint, 1 );
	b3.b3CylindricalJoint_SetTargetAngle( joint, -0.3 );
	for ( let i = 0; i < 300; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3CylindricalJoint_GetTranslation( joint ), 0.1, 0.01, 'linear spring settles at the target' );
	near( b3.b3CylindricalJoint_GetAngle( joint ), -0.3, 0.01, 'angular spring settles at the target' );

	// A slide axis off the rotation axis: slides along frame A y, still spins about x
	const { body: slider } = dynamicBox( b3, world, [ 5, 4, 0 ], 0.5, lightDef );
	const tilted = b3.b3DefaultCylindricalJointDef();
	tilted.base.bodyIdA = ground;
	tilted.base.bodyIdB = slider;
	tilted.base.localFrameA = { position: [ 5, 4, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	tilted.base.localFrameB = IDENTITY_FRAME();
	tilted.localSlideAxisA = [ 0, 2, 0 ];
	tilted.enableMotor = true;
	tilted.motorSpeed = 1;
	tilted.maxMotorForce = 100;
	tilted.enableAngularMotor = true;
	tilted.angularMotorSpeed = 1;
	tilted.maxMotorTorque = 100;
	const tiltedJoint = b3.b3CreateCylindricalJoint( world, tilted );
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const [ tp, tq ] = b3.b3Body_GetTransform( [ 0, 0, 0 ], [ 0, 0, 0, 1 ], slider );
	near( tp[ 0 ], 5, 1e-3, 'tilted: no motion along x' );
	near( tp[ 1 ] - 4, b3.b3CylindricalJoint_GetTranslation( tiltedJoint ), 1e-4, 'tilted: translation is along y' );
	near( tp[ 1 ] - 4, 0.5, 0.02, 'tilted: slid along y at the motor speed' );
	near( tq[ 1 ], 0, 1e-3, 'tilted: rotates only about x (qy)' );
	near( tq[ 2 ], 0, 1e-3, 'tilted: rotates only about x (qz)' );
	near( b3.b3CylindricalJoint_GetAngle( tiltedJoint ), 0.5, 0.02, 'tilted: spun about x' );

	b3.b3DestroyWorld( world );
}

// Measure the friction coefficient of a box sliding over the ground: mu = deceleration / g.
function slidingFriction( b3, rules, groundFriction, groundMaterialId, boxFriction, boxMaterialId )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	if ( rules ) b3.b3World_SetMixingRules( world, rules[ 0 ], rules[ 1 ] );

	const groundShapeDef = b3.b3DefaultShapeDef();
	groundShapeDef.baseMaterial.friction = groundFriction;
	groundShapeDef.baseMaterial.userMaterialId = groundMaterialId;
	b3.b3CreateBoxShape( staticBody( b3, world ), groundShapeDef, 50, 0.5, 50 );

	const boxShapeDef = b3.b3DefaultShapeDef();
	boxShapeDef.baseMaterial.friction = boxFriction;
	boxShapeDef.baseMaterial.userMaterialId = boxMaterialId;
	const { body } = dynamicBox( b3, world, [ 0, 1, 0 ], 0.5, boxShapeDef );

	// settle onto the ground, then launch
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	b3.b3Body_SetLinearVelocity( body, [ 10, 0, 0 ] );
	const v = [ 0, 0, 0 ];
	b3.b3World_Step( world, 1 / 60, 4 );
	const v0 = b3.b3Body_GetLinearVelocity( v, body )[ 0 ];
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const v1 = b3.b3Body_GetLinearVelocity( v, body )[ 0 ];
	b3.b3DestroyWorld( world );
	return ( v0 - v1 ) / ( 10 * 30 / 60 );
}

// Packed weights: bits 0-31 friction weight * 1000, bits 32-62 restitution weight * 1000, bit 63 = present
const packWeights = ( friction, restitution ) =>
	( 1n << 63n ) | BigInt( Math.round( friction * 1000 ) ) | ( BigInt( Math.round( restitution * 1000 ) ) << 32n );

// Bounce a sphere off the ground with no gravity: rebound speed / impact speed = mixed restitution.
function bounceRestitution( b3, rule, groundRestitution, groundMaterialId, ballRestitution, ballMaterialId )
{
	const world = zeroGravityWorld( b3 );
	b3.b3World_SetMixingRules( world, b3.b3MixingRule.geometric, rule );
	const groundShapeDef = b3.b3DefaultShapeDef();
	groundShapeDef.baseMaterial.restitution = groundRestitution;
	groundShapeDef.baseMaterial.userMaterialId = groundMaterialId;
	b3.b3CreateBoxShape( staticBody( b3, world ), groundShapeDef, 5, 0.5, 5 );
	const ballDef = b3.b3DefaultBodyDef();
	ballDef.type = b3.b3BodyType.b3_dynamicBody;
	ballDef.position = [ 0, 1.5, 0 ];
	ballDef.linearVelocity = [ 0, -5, 0 ];
	const ball = b3.b3CreateBody( world, ballDef );
	const ballShapeDef = b3.b3DefaultShapeDef();
	ballShapeDef.baseMaterial.restitution = ballRestitution;
	ballShapeDef.baseMaterial.userMaterialId = ballMaterialId;
	b3.b3CreateSphereShape( ball, ballShapeDef, { center: [ 0, 0, 0 ], radius: 0.5 } );
	const v = [ 0, 0, 0 ];
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const rebound = b3.b3Body_GetLinearVelocity( v, ball )[ 1 ];
	b3.b3DestroyWorld( world );
	return rebound / 5;
}

function mixingRules( b3 )
{
	const R = b3.b3MixingRule;
	assert.deepEqual( { ...R }, { geometric: 0, average: 1, min: 2, max: 3, multiply: 4, weighted: 5 }, 'b3MixingRule values' );

	const weighted = [ R.weighted, R.weighted ];
	// (0.2 * 1 + 1.0 * 3) / (1 + 3) = 0.8
	near( slidingFriction( b3, weighted, 0.2, packWeights( 1, 1 ), 1.0, packWeights( 3, 1 ) ), 0.8, 0.03, 'weighted friction' );
	// zero friction weights on both shapes: a plain average
	near( slidingFriction( b3, weighted, 0.2, packWeights( 0, 1 ), 1.0, packWeights( 0, 1 ) ), 0.6, 0.03, 'zero weights average' );
	// all-zero weights still carry the presence bit, so they average instead of falling back
	near( slidingFriction( b3, weighted, 0.2, packWeights( 0, 0 ), 1.0, packWeights( 0, 0 ) ), 0.6, 0.03, 'all-zero weights average' );
	// a shape without the presence bit uses box3d's default geometric mean, even with other bits set
	near( slidingFriction( b3, weighted, 0.2, 0n, 1.0, packWeights( 3, 1 ) ), Math.sqrt( 0.2 ), 0.03, 'unweighted shape falls back' );
	near( slidingFriction( b3, weighted, 0.2, 3000n, 1.0, packWeights( 3, 1 ) ), Math.sqrt( 0.2 ), 0.03, 'no presence bit falls back' );
	near( slidingFriction( b3, null, 0.2, 0n, 1.0, 0n ), Math.sqrt( 0.2 ), 0.03, 'default rule is geometric' );
	near( slidingFriction( b3, [ R.min, R.max ], 0.2, 0n, 1.0, 0n ), 0.2, 0.03, 'min rule' );
	near( slidingFriction( b3, [ R.average, R.max ], 0.2, 0n, 1.0, 0n ), 0.6, 0.03, 'average rule' );

	// Restitution reads its weight from bits 32-62: (0.2 * 3 + 0.8 * 1) / 4 = 0.35
	near( bounceRestitution( b3, R.weighted, 0.2, packWeights( 0, 3 ), 0.8, packWeights( 0, 1 ) ), 0.35, 0.03, 'weighted restitution' );
	near( bounceRestitution( b3, R.weighted, 0.2, 0n, 0.8, packWeights( 0, 1 ) ), 0.8, 0.03, 'unweighted restitution falls back to max' );

	const world = zeroGravityWorld( b3 );
	assert.throws( () => b3.b3World_SetMixingRules( world, 6, 0 ), RangeError, 'unknown rule throws' );
	b3.b3DestroyWorld( world );
}

// Packed body move events and packed transforms match the per-item readers.
function packedReads( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const bodies = [];
	for ( let i = 0; i < 5; i++ )
	{
		const { body } = dynamicBox( b3, world, [ i * 2, 5 + i, 0 ] );
		b3.b3Body_SetAngularVelocity( body, [ 0.3 * i, 1, 0 ] );
		bodies.push( body );
	}
	const eb = b3.createEventsBuffer();
	for ( let i = 0; i < 3; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	b3.getEvents( eb, world );

	const n = b3.getNumBodyMoveEvents( eb );
	assert.equal( n, bodies.length, 'every falling body moved' );
	const packed = b3.getBodyMoveEventsPacked( eb );
	assert.ok( packed instanceof Float64Array && packed.length === n * 11, 'packed events: 11 per event' );
	const ev = b3.createBodyMoveEvent();
	for ( let i = 0; i < n; i++ )
	{
		b3.getBodyMoveEventAt( ev, eb, i );
		const o = i * 11;
		const expected = [ ev.bodyId.index1, ev.bodyId.world0, ev.bodyId.generation, ...ev.position, ...ev.rotation, ev.fellAsleep ? 1 : 0 ];
		assert.deepEqual( Array.from( packed.subarray( o, o + 11 ) ), expected, `packed event ${i} matches getBodyMoveEventAt` );
	}
	b3.destroyEventsBuffer( eb );

	// Packed transforms, with a destroyed body reading as NaN
	const gone = bodies.pop();
	b3.b3DestroyBody( gone );
	const ids = new Int32Array( [ ...bodies, gone ].flatMap( ( id ) => [ id.index1, id.world0, id.generation ] ) );
	const transforms = b3.b3Body_GetTransformsPacked( ids );
	assert.ok( transforms instanceof Float64Array && transforms.length === ( bodies.length + 1 ) * 7, 'packed transforms: 7 per body' );
	bodies.forEach( ( body, i ) =>
	{
		const [ p, q ] = b3.b3Body_GetTransform( [ 0, 0, 0 ], [ 0, 0, 0, 1 ], body );
		assert.deepEqual( Array.from( transforms.subarray( i * 7, i * 7 + 7 ) ), [ ...p, ...q ], `packed transform ${i} matches b3Body_GetTransform` );
	} );
	assert.ok( transforms.subarray( bodies.length * 7 ).every( Number.isNaN ), 'invalid id reads as NaN' );

	b3.b3DestroyWorld( world );
}

// A constant force balancing gravity holds a body still across steps; torques persist too.
function constantForces( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const { body } = dynamicBox( b3, world, [ 0, 5, 0 ] );
	const m = b3.b3Body_GetMass( body );

	b3.b3Body_SetConstantForce( body, [ 0, 10 * m, 0 ], null );
	const p = [ 0, 0, 0 ];
	for ( let i = 0; i < 120; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3Body_GetPosition( p, body )[ 1 ], 5, 1e-4, 'balanced body holds still' );

	// Off-center force at a body-local point also spins the body
	b3.b3Body_SetConstantForce( body, [ 0, 10 * m, 0 ], [ 0.5, 0, 0 ] );
	for ( let i = 0; i < 10; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	assert.ok( b3.b3Body_GetAngularVelocity( p, body )[ 2 ] > 0.1, 'off-center force applies a torque' );
	b3.b3Body_SetConstantForce( body, [ 0, 10 * m, 0 ], null );
	b3.b3Body_SetAngularVelocity( body, [ 0, 0, 0 ] );

	b3.b3Body_SetConstantTorque( body, [ 0, m, 0 ] );
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	assert.ok( b3.b3Body_GetAngularVelocity( p, body )[ 1 ] > 0.5, 'constant torque spins the body' );

	b3.b3Body_ClearConstantForces( body );
	const y0 = b3.b3Body_GetPosition( p, body )[ 1 ];
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	assert.ok( b3.b3Body_GetPosition( p, body )[ 1 ] < y0 - 1, 'cleared forces: the body falls' );

	// Setting a force wakes a sleeping body once
	b3.b3Body_SetAwake( body, false );
	b3.b3Body_SetConstantForce( body, [ 0, 20 * m, 0 ], null );
	assert.ok( b3.b3Body_IsAwake( body ), 'non-zero constant force wakes the body' );

	// Destroying the body drops its entry; stepping must not touch the stale id
	b3.b3DestroyBody( body );
	b3.b3World_Step( world, 1 / 60, 4 );
	assert.throws( () => b3.b3Body_SetConstantForce( body, [ 0, 1, 0 ], null ), /body is not valid/, 'stale id is rejected' );
	// Clearing tolerates any id, including a world slot past the table
	b3.b3Body_ClearConstantForces( body );
	b3.b3Body_ClearConstantForces( { index1: 1, world0: 60000, generation: 1 } );
	b3.b3DestroyWorld( world );
}

// A distance-joint spring in stiffness units stretches by m*g/k whatever the mass.
function stiffnessSpring( b3, density )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const anchor = staticBody( b3, world, [ 0, 10, 0 ] );
	const shapeDef = b3.b3DefaultShapeDef();
	shapeDef.density = density;
	const { body } = dynamicBox( b3, world, [ 0, 8, 0 ], 0.25, shapeDef );
	const m = b3.b3Body_GetMass( body );

	const k = 400;
	const def = b3.b3DefaultDistanceJointDef();
	assert.equal( def.springStiffness, 0, 'stiffness defaults to 0' );
	assert.equal( def.springDamping, 0, 'damping defaults to 0' );
	def.base.bodyIdA = anchor;
	def.base.bodyIdB = body;
	def.length = 2;
	def.enableSpring = true;
	def.springStiffness = k;
	def.springDamping = 0.5 * 2 * Math.sqrt( k * m );
	const joint = b3.b3CreateDistanceJoint( world, def );
	for ( let i = 0; i < 600; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const extension = b3.b3DistanceJoint_GetCurrentLength( joint ) - 2;

	b3.b3DistanceJoint_SetSpringStiffness( joint, 2 * k, def.springDamping );
	b3.b3Joint_WakeBodies( joint ); // the settled body may be asleep
	assert.equal( b3.b3DistanceJoint_GetSpringStiffness( joint ), 2 * k, 'stiffness setter' );
	for ( let i = 0; i < 600; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	const stifferExtension = b3.b3DistanceJoint_GetCurrentLength( joint ) - 2;
	b3.b3DestroyWorld( world );
	return { m, k, extension, stifferExtension };
}

function distanceStiffness( b3 )
{
	for ( const density of [ 100, 800 ] )
	{
		const { m, k, extension, stifferExtension } = stiffnessSpring( b3, density );
		near( extension, m * 10 / k, 0.01 * m * 10 / k + 1e-4, `spring settles at mg/k (m=${m})` );
		near( stifferExtension, m * 10 / ( 2 * k ), 0.01 * m * 10 / ( 2 * k ) + 1e-4, `setter: mg/2k (m=${m})` );
	}
}

// b3Shape_SetBakedHull / b3Shape_SetHull resize a shape in place; b3Shape_Disable takes it out of contacts and queries.
function shapeEditing( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	const ground = staticBody( b3, world );
	const groundShape = b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );
	const { body, shape } = dynamicBox( b3, world, [ 0, 2, 0 ], 0.5 );
	const mass = b3.b3Body_GetMass( body );

	const unitCube = b3.b3CreateHull( [ -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
		-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5 ] );
	assert.ok( b3.b3Shape_SetBakedHull( shape, unitCube, { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] }, [ 2, 3, 4 ], true ), 'SetBakedHull succeeds' );
	b3.b3DestroyHull( unitCube );
	const aabb = b3.b3Shape_GetAABB( [ 0, 0, 0, 0, 0, 0 ], shape );
	near( aabb[ 3 ] - aabb[ 0 ], 2, 0.05, 'resized x extent' );
	near( aabb[ 4 ] - aabb[ 1 ], 3, 0.05, 'resized y extent' );
	near( aabb[ 5 ] - aabb[ 2 ], 4, 0.05, 'resized z extent' );
	near( b3.b3Body_GetMass( body ), mass * 24, mass * 0.01, 'updateBodyMass recomputes the mass' );

	// 1:1 b3Shape_SetHull: swaps in a copy of the hull as is and leaves the mass alone
	const { body: probeBody, shape: probe } = dynamicBox( b3, world, [ 20, 5, 0 ], 0.5 );
	const probeMass = b3.b3Body_GetMass( probeBody );
	const smallCube = b3.b3CreateHull( [ -0.25, -0.25, -0.25, 0.25, -0.25, -0.25, 0.25, 0.25, -0.25, -0.25, 0.25, -0.25,
		-0.25, -0.25, 0.25, 0.25, -0.25, 0.25, 0.25, 0.25, 0.25, -0.25, 0.25, 0.25 ] );
	b3.b3Shape_SetHull( probe, smallCube );
	b3.b3DestroyHull( smallCube );
	const probeBox = b3.b3Shape_GetAABB( [ 0, 0, 0, 0, 0, 0 ], probe );
	near( probeBox[ 3 ] - probeBox[ 0 ], 0.5, 0.05, 'SetHull swaps the geometry' );
	assert.equal( b3.b3Body_GetMass( probeBody ), probeMass, 'SetHull leaves the mass alone' );
	b3.b3DestroyBody( probeBody );

	// Rest on the ground, then disable the ground: no contact, no ray hit, the body falls
	const p = [ 0, 0, 0 ];
	for ( let i = 0; i < 90; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3Body_GetPosition( p, body )[ 1 ], 0.5 + 1.5, 0.05, 'box rests on the ground' );
	const down = () => b3.b3World_CastRayClosest( world, [ 10, 5, 10 ], [ 0, -10, 0 ], b3.b3DefaultQueryFilter() );
	assert.ok( down().hit, 'ground is hit by a ray' );

	assert.ok( b3.b3Shape_IsEnabled( groundShape ), 'shapes start enabled' );
	b3.b3Shape_Disable( groundShape );
	assert.equal( b3.b3Shape_IsEnabled( groundShape ), false, 'IsEnabled reports disabled' );
	assert.equal( down().hit, false, 'disabled shape is skipped by queries' );
	for ( let i = 0; i < 30; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	assert.ok( b3.b3Body_GetPosition( p, body )[ 1 ] < 1, 'body falls through the disabled ground' );

	// Enable restores contacts and queries
	b3.b3Body_SetTransform( body, [ 0, 3, 0 ], [ 0, 0, 0, 1 ] );
	b3.b3Body_SetLinearVelocity( body, [ 0, 0, 0 ] );
	b3.b3Shape_Enable( groundShape );
	assert.ok( down().hit, 'enabled shape is hit again' );
	for ( let i = 0; i < 90; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
	near( b3.b3Body_GetPosition( p, body )[ 1 ], 0.5 + 1.5, 0.05, 'box lands on the re-enabled ground' );

	b3.b3DestroyWorld( world );
}

// b3ShapeDef.meshRestOffset: a box rests flush on a mesh with offset 0, and B3_MESH_REST_OFFSET (5 mm) above it by default.
function meshRestOffset( b3 )
{
	const mesh = b3.b3CreateMesh(
		new Float32Array( [ -10, 0, -10,  -10, 0, 10,  10, 0, 10,  10, 0, -10 ] ),
		new Uint32Array( [ 0, 1, 2,  0, 2, 3 ] ),
	);
	const restHeight = ( offset ) =>
	{
		const worldDef = b3.b3DefaultWorldDef();
		worldDef.gravity = [ 0, -10, 0 ];
		const world = b3.b3CreateWorld( worldDef );
		const sd = b3.b3DefaultShapeDef();
		if ( offset !== undefined ) sd.meshRestOffset = offset;
		const floor = b3.b3CreateMeshShape( staticBody( b3, world ), sd, mesh, [ 1, 1, 1 ] );
		const reported = b3.b3Shape_GetMeshRestOffset( floor );
		const { body } = dynamicBox( b3, world, [ 0, 0.5, 0 ], 0.5 );
		for ( let i = 0; i < 120; i++ ) b3.b3World_Step( world, 1 / 60, 4 );
		const y = b3.b3Body_GetPosition( [ 0, 0, 0 ], body )[ 1 ];
		b3.b3Shape_SetMeshRestOffset( floor, 0.001 );
		near( b3.b3Shape_GetMeshRestOffset( floor ), 0.001, 1e-7, 'SetMeshRestOffset round-trips' );
		b3.b3DestroyWorld( world );
		return { y, reported };
	};

	near( b3.b3DefaultShapeDef().meshRestOffset, 0.005, 1e-7, 'default mesh rest offset' );
	const lifted = restHeight( undefined );
	const flush = restHeight( 0 );
	near( lifted.reported, 0.005, 1e-7, 'default offset reported' );
	assert.equal( flush.reported, 0, 'zero offset reported' );
	near( flush.y, 0.5, 0.00125, 'box rests flush on a zero offset mesh' );
	near( lifted.y - flush.y, 0.005, 0.00125, 'default offset lifts the box by the rest offset' );
	b3.b3DestroyMesh( mesh );
}

// Vehicle controller: ride height, acceleration, braking, turning, slope hold,
// determinism, live setters, the example presets (the four originals and the 45 car matrix),
// the preset layers, and a 50 car perf check.
async function vehicleScenarios( b3 )
{
	const { vehiclePresets, createPresetVehicleDef, realismLevels, vehicleCars, drivetrainLayers, buildVehiclePreset } =
		await import( '../examples/src/vehicle-presets.js' );
	const dt = 1 / 60;

	function axisAngle( axis, angle )
	{
		const s = Math.sin( angle / 2 );
		return [ axis[ 0 ] * s, axis[ 1 ] * s, axis[ 2 ] * s, Math.cos( angle / 2 ) ];
	}

	function createWorld( groundRotation = [ 0, 0, 0, 1 ] )
	{
		const worldDef = b3.b3DefaultWorldDef();
		worldDef.gravity = [ 0, -9.81, 0 ];
		const world = b3.b3CreateWorld( worldDef );
		const groundDef = b3.b3DefaultBodyDef();
		groundDef.position = [ 0, -1, 0 ];
		groundDef.rotation = groundRotation;
		const ground = b3.b3CreateBody( world, groundDef );
		b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 2000, 1, 2000 );
		return world;
	}

	function createCar( world, { position = [ 0, 1, 0 ], rotation = [ 0, 0, 0, 1 ], def = b3.b3DefaultVehicleDef(), halfExtents = [ 0.9, 0.3, 2.1 ] } = {} )
	{
		const bodyDef = b3.b3DefaultBodyDef();
		bodyDef.type = b3.b3BodyType.b3_dynamicBody;
		bodyDef.position = position;
		bodyDef.rotation = rotation;
		const chassis = b3.b3CreateBody( world, bodyDef );
		b3.b3CreateBoxShape( chassis, b3.b3DefaultShapeDef(), halfExtents[ 0 ], halfExtents[ 1 ], halfExtents[ 2 ] );
		def.chassisId = chassis;
		const vehicle = b3.b3CreateVehicle( world, def );
		assert.ok( b3.b3Vehicle_IsValid( vehicle ), 'vehicle is valid' );
		return { vehicle, chassis };
	}

	const input = ( forward = 0, brake = 0, steer = 0, handbrake = 0 ) => ( { forward, brake, steer, handbrake } );
	const step = ( world, count ) =>
	{
		for ( let i = 0; i < count; i++ ) b3.b3World_Step( world, dt, 4 );
	};
	const pos = [ 0, 0, 0 ];
	const rot = [ 0, 0, 0, 1 ];
	const position = ( body ) => [ ...b3.b3Body_GetPosition( pos, body ) ];
	const uprightness = ( body ) =>
	{
		const [ x, , z ] = b3.b3Body_GetRotation( rot, body );
		return 1 - 2 * ( x * x + z * z ); // world y of the chassis up axis
	};

	const buf = b3.createVehicleStateBuffer();
	const state = b3.createVehicleStateRecord();
	const wheel = b3.createVehicleWheelRecord();
	function readState( vehicle )
	{
		b3.getVehicleStateData( buf, vehicle );
		b3.getVehicleStateAt( state, buf );
		const wheels = [];
		for ( let i = 0; i < b3.getNumVehicleWheels( buf ); i++ )
		{
			b3.getVehicleWheelAt( wheel, buf, i );
			// The record is reused, so copy its nested arrays and id rather than aliasing them
			wheels.push( {
				...wheel,
				position: [ ...wheel.position ], rotation: [ ...wheel.rotation ],
				contactPoint: [ ...wheel.contactPoint ], contactNormal: [ ...wheel.contactNormal ],
				groundShapeId: { ...wheel.groundShapeId },
			} );
		}
		return { ...state, wheels };
	}
	function assertFinite( vehicle, chassis, label )
	{
		const s = readState( vehicle );
		const values = [ ...position( chassis ), s.speed, s.engineRpm ];
		for ( const w of s.wheels ) values.push( ...w.position, ...w.rotation, w.load, w.angularVelocity, w.slipRatio );
		assert.ok( values.every( Number.isFinite ), `${label}: vehicle state is finite` );
	}

	const results = {};

	// Ride height: rests on four loaded wheels, sprung masses add up to the chassis mass
	{
		const world = createWorld();
		const { vehicle, chassis } = createCar( world );
		step( world, 120 );
		const s = readState( vehicle );
		assert.ok( s.wheels[ 0 ].position[ 0 ] > 0 && s.wheels[ 1 ].position[ 0 ] < 0, 'each stored wheel keeps its own position' );
		const sprung = [ 0, 1, 2, 3 ].reduce( ( sum, i ) => sum + b3.b3Vehicle_GetSprungMass( vehicle, i ), 0 );
		assert.ok( Math.abs( sprung - 1300 ) < 1, `sprung masses sum to the chassis mass (${sprung.toFixed( 1 )})` );
		assert.equal( s.wheelsInContact, 4, 'all four wheels touch the ground' );
		const load = s.wheels.reduce( ( sum, w ) => sum + w.load, 0 );
		assert.ok( Math.abs( load - 1300 * 9.81 ) < 1300 * 9.81 * 0.05, `wheel loads carry the weight (${load.toFixed( 0 )} N)` );
		results.rideHeight = position( chassis )[ 1 ];
		assert.ok( results.rideHeight > 0.6 && results.rideHeight < 0.8, `ride height ${results.rideHeight.toFixed( 3 )} m` );
		assert.ok( Math.abs( b3.b3Body_GetLinearVelocity( pos, chassis )[ 1 ] ) < 0.01, 'suspension settled' );

		// Acceleration and shifting
		b3.b3Vehicle_SetInput( vehicle, input( 1 ) );
		let t = 0;
		while ( readState( vehicle ).speed < 100 / 3.6 && t < 15 )
		{
			step( world, 1 );
			t += dt;
		}
		results.zeroTo100 = t;
		const afterLaunch = readState( vehicle );
		assert.ok( t > 4 && t < 10, `0-100 km/h in ${t.toFixed( 2 )} s` );
		assert.ok( afterLaunch.gear >= 2, `the automatic gearbox upshifted (gear ${afterLaunch.gear})` );

		// Braking from 100 km/h
		const start = position( chassis );
		b3.b3Vehicle_SetInput( vehicle, input( 0, 1 ) );
		let brakeTime = 0;
		while ( readState( vehicle ).speed > 0.05 && brakeTime < 10 )
		{
			step( world, 1 );
			brakeTime += dt;
		}
		const end = position( chassis );
		results.braking = Math.hypot( end[ 0 ] - start[ 0 ], end[ 2 ] - start[ 2 ] );
		assert.ok( results.braking > 25 && results.braking < 50, `braking distance ${results.braking.toFixed( 1 )} m` );

		// Live setters take effect on the next step
		const chassisSettings = b3.b3Vehicle_GetChassis( vehicle );
		chassisSettings.mass = 2000;
		b3.b3Vehicle_SetChassis( vehicle, chassisSettings );
		step( world, 1 );
		const heavier = [ 0, 1, 2, 3 ].reduce( ( sum, i ) => sum + b3.b3Vehicle_GetSprungMass( vehicle, i ), 0 );
		assert.ok( Math.abs( heavier - 2000 ) < 1, `live chassis mass reaches the suspension (${heavier.toFixed( 1 )})` );

		const steering = b3.b3Vehicle_GetSteering( vehicle );
		steering.maxAngle = 0;
		b3.b3Vehicle_SetSteering( vehicle, steering );
		b3.b3Vehicle_SetInput( vehicle, input( 0, 0, 1 ) );
		step( world, 30 );
		assert.ok( Math.abs( readState( vehicle ).steerAngle ) < 1e-4, 'live steering limit applies' );

		const engine = b3.b3Vehicle_GetEngine( vehicle );
		engine.maxTorque = 0;
		b3.b3Vehicle_SetEngine( vehicle, engine );
		b3.b3Vehicle_SetInput( vehicle, input( 1 ) );
		step( world, 120 );
		assert.ok( Math.abs( readState( vehicle ).speed ) < 0.5, 'live engine torque applies' );
		assert.equal( b3.b3Vehicle_GetEngine( vehicle ).maxTorque, 0, 'engine settings round-trip' );

		const wheelDef = b3.b3Vehicle_GetWheel( vehicle, 0 );
		assert.ok( Math.abs( wheelDef.radius - 0.34 ) < 1e-6, 'wheel settings round-trip' );
		assert.equal( b3.b3Vehicle_GetDrivetrain( vehicle ).differentials[ 0 ].leftWheel, 2, 'fixed arrays round-trip' );

		const [ wheelPos, wheelRot ] = b3.b3Vehicle_GetWheelTransform( [ 0, 0, 0 ], [ 0, 0, 0, 1 ], vehicle, 0 );
		assert.ok( Math.abs( Math.hypot( ...wheelRot ) - 1 ) < 1e-3 && wheelPos.every( Number.isFinite ), 'wheel transform reads' );
		assertFinite( vehicle, chassis, 'default car' );

		b3.b3Body_SetLinearVelocity( chassis, [ 0, 0, 0 ] );
		b3.b3Vehicle_Reset( vehicle, [ 0, 1, 0 ], [ 0, 0, 0, 1 ] );
		assert.ok( Math.abs( position( chassis )[ 1 ] - 1 ) < 1e-5, 'reset teleports the chassis' );

		b3.b3DestroyVehicle( vehicle );
		assert.ok( !b3.b3Vehicle_IsValid( vehicle ), 'destroyed vehicle is invalid' );
		assert.equal( b3.b3World_GetVehicleCount( world ), 0, 'world has no vehicles left' );
		b3.b3DestroyWorld( world );
	}

	// Turbo: naturally aspirated by default, live settings round-trip, boost builds with lag and
	// shows in both readouts. Every turbo type keeps the car's rated torque.
	{
		const { turboTypes, turboGain, buildVehiclePreset } = await import( '../examples/src/vehicle-presets.js' );
		const world = createWorld();
		const { vehicle, chassis } = createCar( world );
		const na = b3.b3Vehicle_GetTurbo( vehicle );
		assert.equal( na.stages.length, 2, 'turbo stages are a fixed array' );
		assert.ok( na.stages.every( ( s ) => s.gain === 0 ) && !na.antiLag, 'default car is naturally aspirated' );
		b3.b3Vehicle_SetTurbo( vehicle, { ...na, stages: [ { gain: 0.5, spoolRpm: 2000, fullBoostRpm: 3500, spoolTime: 0.8, bleedTime: 0.15 }, na.stages[ 1 ] ] } );
		assert.equal( b3.b3Vehicle_GetTurbo( vehicle ).stages[ 0 ].fullBoostRpm, 3500, 'turbo settings round-trip' );
		step( world, 60 );
		b3.b3Vehicle_SetInput( vehicle, input( 1 ) );
		step( world, 15 );
		const early = readState( vehicle ).boost;
		step( world, 240 );
		const late = readState( vehicle ).boost;
		assert.ok( early < late && late > 0.3 && late <= 0.5 + 1e-4, `boost builds with lag (${early.toFixed( 2 )} then ${late.toFixed( 2 )})` );
		assert.ok( Math.abs( b3.b3Vehicle_GetState( vehicle ).boost - late ) < 1e-6, 'packed and plain readouts agree on boost' );
		assertFinite( vehicle, chassis, 'turbo car' );
		b3.b3DestroyWorld( world );

		const base = buildVehiclePreset( b3, 'sports', 100, 'rwd' );
		for ( const type of Object.keys( turboTypes ) )
		{
			const def = buildVehiclePreset( b3, 'sports', 100, 'rwd', type );
			const rated = def.engine.maxTorque * ( 1 + turboGain( def.turbo ) );
			assert.ok( Math.abs( rated - base.engine.maxTorque ) < 1e-3, `${type}: keeps the rated torque` );
			const w = createWorld();
			const car = createCar( w, { def, halfExtents: vehiclePresets[ 'sports-100-rwd' ].halfExtents } );
			step( w, 60 );
			b3.b3Vehicle_SetInput( car.vehicle, input( 1 ) );
			step( w, 300 );
			assert.ok( readState( car.vehicle ).speed > 15, `${type}: drives` );
			assertFinite( car.vehicle, car.chassis, `${type} turbo` );
			b3.b3DestroyWorld( w );
		}
	}

	// Turning at walking pace with full lock gives a tight circle
	{
		const world = createWorld();
		const { vehicle, chassis } = createCar( world );
		step( world, 60 );
		let minX = Infinity, maxX = -Infinity;
		for ( let i = 0; i < 900; i++ )
		{
			const speed = readState( vehicle ).speed;
			b3.b3Vehicle_SetInput( vehicle, input( Math.min( Math.max( ( 5 - speed ) * 0.5, 0 ), 1 ), 0, -1 ) );
			step( world, 1 );
			if ( i > 300 )
			{
				const p = position( chassis );
				minX = Math.min( minX, p[ 0 ] );
				maxX = Math.max( maxX, p[ 0 ] );
			}
		}
		results.turnRadius = ( maxX - minX ) / 2;
		assert.ok( results.turnRadius > 3 && results.turnRadius < 9, `full lock turn radius ${results.turnRadius.toFixed( 2 )} m` );
		assert.ok( uprightness( chassis ) > 0.95, 'stays upright while turning' );
		b3.b3DestroyWorld( world );
	}

	// Holds still on a 20 degree slope with the handbrake or after stopping with the brake, and on
	// 10 degrees with no input at all
	for ( const [ degrees, handbrake, brake ] of [ [ 20, 1, 0 ], [ 20, 0, 1 ], [ 10, 0, 0 ] ] )
	{
		const q = axisAngle( [ 1, 0, 0 ], degrees * Math.PI / 180 );
		const world = createWorld( q );
		const { vehicle, chassis } = createCar( world, { position: [ 0, 0.7, 0 ], rotation: q } );
		b3.b3Vehicle_SetInput( vehicle, input( 0, brake, 0, handbrake ) );
		step( world, 60 );
		b3.b3Vehicle_SetInput( vehicle, input( 0, 0, 0, handbrake ) );
		step( world, 60 );
		const start = position( chassis );
		step( world, 300 );
		const end = position( chassis );
		const drift = Math.hypot( end[ 0 ] - start[ 0 ], end[ 1 ] - start[ 1 ], end[ 2 ] - start[ 2 ] );
		assert.ok( drift < 0.05, `${degrees} degree slope drift ${drift.toFixed( 4 )} m` );
		b3.b3DestroyWorld( world );
	}

	// Determinism: the same inputs give bit-identical results
	function drive()
	{
		const world = createWorld();
		const { vehicle, chassis } = createCar( world );
		for ( let i = 0; i < 400; i++ )
		{
			b3.b3Vehicle_SetInput( vehicle, input( 1, 0, Math.sin( i * 0.05 ), i > 300 ? 1 : 0 ) );
			step( world, 1 );
		}
		const out = [ ...position( chassis ), ...b3.b3Body_GetRotation( rot, chassis ), readState( vehicle ).engineRpm ];
		b3.b3DestroyWorld( world );
		return out;
	}
	assert.deepEqual( drive(), drive(), 'vehicle simulation is deterministic' );

	// Each example preset settles and drives 200 m without blowing up or flipping
	results.presets = {};
	for ( const name of Object.keys( vehiclePresets ) )
	{
		const world = createWorld();
		const { vehicle, chassis } = createCar( world, {
			def: createPresetVehicleDef( b3, name ),
			halfExtents: vehiclePresets[ name ].halfExtents,
			position: [ 0, 1.3, 0 ],
		} );
		step( world, 120 );
		assert.equal( readState( vehicle ).wheelsInContact, 4, `${name}: settles on four wheels` );
		assert.ok( Math.abs( b3.b3Body_GetLinearVelocity( pos, chassis )[ 1 ] ) < 0.02, `${name}: suspension settled` );
		b3.b3Vehicle_SetInput( vehicle, input( 1 ) );
		let t = 0;
		while ( position( chassis )[ 2 ] < 200 && t < 30 )
		{
			step( world, 1 );
			t += dt;
		}
		assertFinite( vehicle, chassis, name );
		assert.ok( t < 30, `${name}: drives 200 m (reached z=${position( chassis )[ 2 ].toFixed( 1 )})` );
		assert.ok( uprightness( chassis ) > 0.95, `${name}: stays upright` );
		assert.ok( Math.abs( position( chassis )[ 0 ] ) < 5, `${name}: drives straight` );
		results.presets[ name ] = t;
		b3.b3DestroyWorld( world );
	}

	// Preset layers: the realism tables only ever move toward arcade, torque shares add up, and
	// each layer changes what it says it changes
	{
		const order = [ 100, 75, 50, 25, 0 ];
		const rising = [ 'tireGrip', 'rollInfluence', 'counterSteer', 'downforceScale', 'comDrop', 'selfRighting', 'airControl' ];
		for ( let i = 1; i < order.length; i++ )
		{
			const a = realismLevels[ order[ i - 1 ] ];
			const b = realismLevels[ order[ i ] ];
			for ( const key of rising ) assert.ok( b[ key ] >= a[ key ], `realism ${order[ i ]}: ${key} does not fall` );
			assert.ok( b.driftGripScale <= a.driftGripScale, `realism ${order[ i ]}: drift grip does not rise` );
		}
		assert.equal( Object.keys( vehiclePresets ).length, 4 + 45, '4 original presets and 45 matrix presets' );
		for ( const car of Object.keys( vehicleCars ) )
		{
			for ( const drive of Object.keys( drivetrainLayers ) )
			{
				const real = buildVehiclePreset( b3, car, 100, drive );
				const arcade = buildVehiclePreset( b3, car, 0, drive );
				const shares = real.drivetrain.differentials.slice( 0, real.drivetrain.differentialCount );
				const sum = shares.reduce( ( total, d ) => total + d.torqueRatio, 0 );
				assert.ok( Math.abs( sum - 1 ) < 1e-6, `${car} ${drive}: torque shares add to 1` );
				const driven = new Set( shares.flatMap( ( d ) => [ d.leftWheel, d.rightWheel ] ) );
				const expected = { fwd: [ 0, 1 ], rwd: [ 2, 3 ], awd: [ 0, 1, 2, 3 ] }[ drive ];
				assert.deepEqual( [ ...driven ].sort(), expected, `${car} ${drive}: drives the right wheels` );
				assert.equal( real.chassis.mass, vehicleCars[ car ].mass, `${car} ${drive}: car mass` );
				const ratio = arcade.wheels[ 0 ].tire.lateralPeakFriction / real.wheels[ 0 ].tire.lateralPeakFriction;
				assert.ok( Math.abs( ratio - realismLevels[ 0 ].tireGrip ) < 1e-5, `${car} ${drive}: arcade grip scale` );
				assert.ok( arcade.chassis.centerOfMassOffset[ 1 ] < real.chassis.centerOfMassOffset[ 1 ], `${car} ${drive}: arcade center of mass is lower` );
				// A preset is a pure function of its name
				assert.deepEqual( JSON.stringify( real, ( _, v ) => typeof v === 'bigint' ? String( v ) : v ),
					JSON.stringify( createPresetVehicleDef( b3, `${car}-100-${drive}` ), ( _, v ) => typeof v === 'bigint' ? String( v ) : v ),
					`${car} ${drive}: presets are reproducible` );
			}
		}
	}

	// Race tracks: a closed loop with real climbs and descents, a bump section with bumps of
	// different sizes, drivable ground beside the road, and a lap with no flip on each
	{
		const { buildRaceTrack } = await import( '../examples/src/vehicle-tracks.js' );
		const { driveLap } = await import( '../examples/scripts/vehicle-laps.mjs' );
		results.laps = {};
		for ( const [ name, presetName ] of [ [ 'circuit', 'sports-50-rwd' ], [ 'stage', 'rally-50-awd' ] ] )
		{
			const track = buildRaceTrack( name );
			const line = track.centerline;
			const n = line.length;
			assert.ok( Math.hypot( line[ 0 ].x - line[ n - 1 ].x, line[ 0 ].z - line[ n - 1 ].z ) < 2, `${name}: the track is a closed loop` );
			const ys = line.map( ( c ) => c.y );
			assert.ok( Math.max( ...ys ) - Math.min( ...ys ) >= 15, `${name}: at least 15 m of elevation change` );
			const grades = line.map( ( c, i ) => ( line[ ( i + 10 ) % n ].y - c.y ) / 10 );
			assert.ok( Math.max( ...grades ) >= 0.05 && Math.min( ...grades ) <= -0.05, `${name}: has uphill and downhill sections of 5% or more` );
			const heights = track.bumps.map( ( b ) => b.height );
			const lengths = track.bumps.map( ( b ) => b.length );
			assert.ok( new Set( track.bumps.map( ( b ) => b.label ) ).size >= 5, `${name}: at least five kinds of bump` );
			assert.ok( Math.max( ...heights ) >= 3 * Math.min( ...heights ) && Math.max( ...lengths ) >= 5 * Math.min( ...lengths ), `${name}: small and big, short and long bumps` );
			for ( let i = 0; i < n; i += 4 )
			{
				for ( let k = i + 60; k < n - Math.max( 0, 60 - i ); k += 4 )
				{
					const d = Math.hypot( line[ i ].x - line[ k ].x, line[ i ].z - line[ k ].z );
					assert.ok( d > 40, `${name}: separate parts of the track stay 40 m apart (s=${i} and s=${k} are ${d.toFixed( 0 )} m)` );
				}
			}
			const { heights: field, countX, cell, origin } = track.field;
			const h = ( x, z ) =>
			{
				const fx = ( x - origin[ 0 ] ) / cell, fz = ( z - origin[ 1 ] ) / cell;
				const ix = Math.floor( fx ), iz = Math.floor( fz ), tx = fx - ix, tz = fz - iz;
				const g = ( a, b ) => field[ ( iz + b ) * countX + ix + a ];
				return ( g( 0, 0 ) * ( 1 - tx ) + g( 1, 0 ) * tx ) * ( 1 - tz ) + ( g( 0, 1 ) * ( 1 - tx ) + g( 1, 1 ) * tx ) * tz;
			};
			let steepest = 0;
			for ( const c of line )
			{
				for ( const side of [ -1, 1 ] )
				{
					for ( let off = track.width / 2; off < track.width / 2 + 15; off += 2 )
					{
						const x = c.x + side * c.tz * off, z = c.z - side * c.tx * off;
						steepest = Math.max( steepest, Math.abs( h( x + side * c.tz * 2, z - side * c.tx * 2 ) - h( x, z ) ) / 2 );
					}
				}
			}
			assert.ok( steepest < 0.4, `${name}: ground within 15 m of the road is drivable (steepest ${( steepest * 100 ).toFixed( 0 )}%)` );
			const lap = driveLap( name, vehiclePresets[ presetName ], { b3 } );
			assert.ok( lap.completed, `${name}: ${presetName} completes a lap` );
			assert.ok( lap.minUp > 0.3, `${name}: ${presetName} does not flip (upright ${lap.minUp.toFixed( 2 )})` );
			results.laps[ name ] = lap.lapTime;
		}
	}

	// 50 cars driving in circles cost under 1 ms per step
	{
		const world = createWorld();
		const cars = [];
		for ( let i = 0; i < 50; i++ )
		{
			const car = createCar( world, { position: [ ( i % 10 ) * 20, 1, Math.floor( i / 10 ) * 20 ] } );
			b3.b3Vehicle_SetInput( car.vehicle, input( 0.6, 0, 0.5 ) );
			cars.push( car );
		}
		step( world, 120 );
		const steps = 300;
		const t0 = performance.now();
		for ( let i = 0; i < steps; i++ )
		{
			b3.b3World_Step( world, dt, 4 );
			for ( const car of cars ) b3.getVehicleStateData( buf, car.vehicle );
		}
		results.perf = ( performance.now() - t0 ) / steps;
		// Wall-clock time depends on the machine and the build (the multithreaded one pays for its workers), so
		// this only catches a gross regression. Typical is about 0.5 ms on a desktop.
		assert.ok( results.perf < 10, `50 vehicles step in ${results.perf.toFixed( 3 )} ms` );
		assert.equal( b3.b3World_GetVehicleCount( world ), 50, 'world counts its vehicles' );
		b3.b3DestroyWorld( world );
	}

	// Reading an invalid vehicle packs no wheels, and the wheel reader refuses indices that were not packed
	{
		const world = createWorld();
		const { vehicle } = createCar( world );
		b3.getVehicleStateData( buf, vehicle );
		assert.equal( b3.getNumVehicleWheels( buf ), 4, 'valid vehicle packs its wheels' );
		b3.b3DestroyVehicle( vehicle );
		b3.getVehicleStateData( buf, vehicle );
		assert.equal( b3.getNumVehicleWheels( buf ), 0, 'destroyed vehicle packs no wheels' );
		b3.getVehicleStateAt( state, buf );
		assert.equal( state.wheelsInContact, 0, 'destroyed vehicle reads as empty' );
		assert.throws( () => b3.getVehicleWheelAt( wheel, buf, 0 ), RangeError, 'no wheel to read after destroy' );
		b3.getVehicleStateData( buf, createCar( world ).vehicle );
		assert.throws( () => b3.getVehicleWheelAt( wheel, buf, 4 ), RangeError, 'wheel index past the count is refused' );
		assert.throws( () => b3.getVehicleWheelAt( wheel, buf, -1 ), RangeError, 'negative wheel index is refused' );
		assert.throws( () => b3.getVehicleWheelAt( wheel, buf, 1.5 ), RangeError, 'fractional wheel index is refused' );
		b3.b3DestroyWorld( world );

		const spare = b3.createVehicleStateBuffer();
		b3.destroyVehicleStateBuffer( spare );
		b3.destroyVehicleStateBuffer( spare );
		assert.throws( () => b3.getVehicleStateData( spare, vehicle ), /destroyed/, 'a destroyed buffer cannot be refilled' );
	}

	b3.destroyVehicleStateBuffer( buf );
	return results;
}

// Triangle first collide functions: the manifold normal points from the triangle to the other shape,
// and a triangle only collides from its front (counter clockwise) side.
function triangleCollision( b3 )
{
	const tri = [ [ -2, 0, -2 ], [ -2, 0, 2 ], [ 2, 0, 0 ] ];
	const sphere = { center: [ 0, 0.3, 0 ], radius: 0.5 };
	const hit = b3.b3CollideTriangleAndSphere( ...tri, sphere );
	assert.equal( hit.points.length, 1, 'sphere touches the triangle' );
	assert.deepEqual( hit.normal, [ 0, 1, 0 ], 'normal points from the triangle to the sphere' );
	assert.ok( hit.points[ 0 ].separation < 0, 'sphere penetrates' );
	assert.equal( b3.b3CollideTriangleAndSphere( tri[ 0 ], tri[ 2 ], tri[ 1 ], sphere ).points.length, 0, 'back face does not collide' );
	assert.equal( b3.b3CollideTriangleAndSphere( ...tri, { center: [ 0, 5, 0 ], radius: 0.5 } ).points.length, 0, 'distant sphere misses' );

	const capsule = b3.b3CollideTriangleAndCapsule( ...tri, { center1: [ -0.2, 0.3, 0 ], center2: [ 0.2, 0.3, 0 ], radius: 0.5 } );
	assert.equal( capsule.points.length, 2, 'capsule lying on the triangle gives two points' );
	assert.deepEqual( capsule.normal, [ 0, 1, 0 ], 'normal points from the triangle to the capsule' );
}

// box3d.js/character: stand, walk, climb a step, jump, and ride a tagged kinematic platform.
function dynamicMover( b3 )
{
	const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );
	const staticBox = ( x, y, z, hx, hy, hz ) =>
	{
		const def = b3.b3DefaultBodyDef();
		def.position = [ x, y, z ];
		b3.b3CreateBoxShape( b3.b3CreateBody( world, def ), b3.b3DefaultShapeDef(), hx, hy, hz );
	};
	staticBox( 0, -0.5, 0, 30, 0.5, 30 ); // ground, top at y = 0
	staticBox( 14, 0.15, 0, 6, 0.15, 2 ); // 0.3 high step at x = 8..20

	const PLATFORM = 7n;
	const platformDef = b3.b3DefaultBodyDef();
	platformDef.type = b3.b3BodyType.b3_kinematicBody;
	platformDef.position = [ -10, 0.25, 0 ];
	const platform = b3.b3CreateBody( world, platformDef );
	const platformShape = b3.b3DefaultShapeDef();
	platformShape.baseMaterial.userMaterialId = PLATFORM;
	b3.b3CreateBoxShape( platform, platformShape, 2, 0.25, 2 );

	const dt = 1 / 60;
	const forward = [ 1, 0, 0 ];
	const right = [ 0, 0, 1 ];
	const pos = [ 0, 0, 0 ];
	const vel = [ 0, 0, 0 ];
	const run = ( mover, frames, throttle ) =>
	{
		for ( let i = 0; i < frames; i++ )
		{
			mover.update( dt, forward, right, throttle );
			b3.b3World_Step( world, dt, 4 );
		}
		return b3.b3Body_GetPosition( pos, mover.bodyId );
	};

	const mover = new DynamicMover( b3, world, { position: [ 0, 1.5, 0 ] } );
	run( mover, 120, [ 0, 0 ] );
	const standY = pos[ 1 ];
	assert.ok( mover.onGround && mover.walkable, 'mover stands on the ground' );
	assert.ok( standY > 1 && standY < 1.6, `pogo holds the capsule above the ground (y=${standY.toFixed( 2 )})` );
	assert.ok( Math.abs( pos[ 0 ] ) < 1e-3 && Math.abs( pos[ 2 ] ) < 1e-3, 'mover stays put without input' );

	run( mover, 60, [ 1, 0 ] );
	b3.b3Body_GetLinearVelocity( vel, mover.bodyId );
	assert.ok( vel[ 0 ] > 0.9 * mover.maxSpeed, `mover reaches max speed (vx=${vel[ 0 ].toFixed( 2 )})` );

	run( mover, 60, [ 1, 0 ] );
	assert.ok( pos[ 0 ] > 9 && pos[ 0 ] < 18, `mover walked onto the step (x=${pos[ 0 ].toFixed( 2 )})` );
	const stepY = run( mover, 10, [ 0, 0 ] )[ 1 ];
	assert.ok( stepY > standY + 0.2, `mover climbed the 0.3 step (y=${stepY.toFixed( 2 )})` );

	assert.equal( mover.jump(), true, 'jump from the ground' );
	run( mover, 5, [ 0, 0 ] );
	b3.b3Body_GetLinearVelocity( vel, mover.bodyId );
	assert.ok( vel[ 1 ] > 3 && mover.jumping, `mover rises after jumping (vy=${vel[ 1 ].toFixed( 2 )})` );
	assert.equal( mover.jump(), false, 'no jump while airborne' );
	run( mover, 120, [ 0, 0 ] );
	assert.ok( mover.onGround && !mover.jumping, 'mover lands' );

	const bodyId = { ...mover.bodyId };
	mover.destroy();
	assert.equal( b3.b3Body_IsValid( bodyId ), false, 'destroy removes the mover body' );
	mover.update( dt, forward, right, [ 1, 0 ] );
	assert.equal( mover.jump(), false, 'update and jump do nothing after destroy' );

	// Platform: the mover joint attaches to a kinematic body tagged with platformMaterialId.
	// A number id is converted to bigint, so it still matches the ray's userMaterialId.
	const rider = new DynamicMover( b3, world, { position: [ -10, 2, 0 ] } );
	rider.platformMaterialId = Number( PLATFORM );
	assert.equal( rider.platformMaterialId, PLATFORM, 'platformMaterialId converts numbers to bigint' );
	run( rider, 90, [ 0, 0 ] );
	const bodyA = b3.b3Joint_GetBodyA( rider.moverJointId );
	assert.deepEqual( bodyA, platform, 'mover joint attaches to the tagged platform' );
	assert.equal( rider.castResult.userMaterialId, PLATFORM, 'ray cast reports the user material id' );
	let shapeCastMaterial = null;
	b3.b3World_CastShape( world, [ -11.5, 3, 1.5 ], [ 0, 0, 0 ], 0.2, [ 0, -5, 0 ], b3.b3DefaultQueryFilter(),
		( _shapeId, _point, _normal, fraction, userMaterialId ) =>
		{
			shapeCastMaterial = userMaterialId;
			return fraction;
		} );
	assert.equal( shapeCastMaterial, PLATFORM, 'shape cast reports the user material id' );
	b3.b3Body_SetLinearVelocity( platform, [ 0, 0, 1 ] );
	const startZ = run( rider, 1, [ 0, 0 ] )[ 2 ];
	const endZ = run( rider, 60, [ 0, 0 ] )[ 2 ];
	assert.ok( endZ - startZ > 0.8, `mover rides the moving platform (dz=${( endZ - startZ ).toFixed( 2 )})` );
	rider.destroy();

	b3.b3DestroyWorld( world );
	return { standY, stepY, rideZ: endZ - startZ };
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
	filteredQueries( b3 );

	cylindricalJoint( b3 );
	mixingRules( b3 );
	packedReads( b3 );
	constantForces( b3 );
	distanceStiffness( b3 );
	shapeEditing( b3 );
	meshRestOffset( b3 );

	const { pieces, restY } = await convexDecomposition( b3, decompositionOptions );

	debugDraw( b3 );

	triangleCollision( b3 );

	const vehicle = await vehicleScenarios( b3 );
	const runs = Object.entries( vehicle.presets );
	const matrix = runs.filter( ( [ name ] ) => name.includes( '-' ) ).map( ( [ , t ] ) => t );
	const presets = runs.filter( ( [ name ] ) => !name.includes( '-' ) ).map( ( [ name, t ] ) => `${name} ${t.toFixed( 1 )}s` ).join( ', ' ) +
		`, ${matrix.length} matrix presets ${Math.min( ...matrix ).toFixed( 1 )}-${Math.max( ...matrix ).toFixed( 1 )}s, ` +
		`laps: circuit ${vehicle.laps.circuit.toFixed( 1 )}s, stage ${vehicle.laps.stage.toFixed( 1 )}s`;
	console.log( `  ${label}: vehicle rode at ${vehicle.rideHeight.toFixed( 3 )} m, 0-100 km/h in ${vehicle.zeroTo100.toFixed( 2 )} s, ` +
		`braked in ${vehicle.braking.toFixed( 1 )} m, turned at ${vehicle.turnRadius.toFixed( 2 )} m radius, ` +
		`200 m runs ${presets}, 50 cars ${vehicle.perf.toFixed( 3 )} ms/step` );

	const mover = dynamicMover( b3 );

	console.log( `  ${label}: box3d v${v.major}.${v.minor}.${v.revision} — ` +
		`sphere fell ${startY.toFixed( 2 )} -> ${endY.toFixed( 2 )} and settled; ` +
		`read ${n} contact(s)/${totalPoints} point(s), a sensor touch, and ${planeCount} mover plane(s) from the buffers; ` +
		`torus decomposed into ${pieces} hulls and rested at y=${restY.toFixed( 2 )}; ` +
		`dynamic mover stood at y=${mover.standY.toFixed( 2 )}, climbed to y=${mover.stepY.toFixed( 2 )}, rode ${mover.rideZ.toFixed( 2 )} m on a platform` );
}

console.log( 'box3d.js smoke test' );
await check( 'separate-wasm', '../dist/box3d.mjs' );
await check( 'inline       ', '../dist/box3d.inline.mjs' );
await check( 'mt (threads) ', '../dist/box3d.mt.mjs', { useThreads: true } );
console.log( 'OK' );
process.exit( 0 ); // the MT build's pthread pool keeps Node alive
