// Physics performance scenarios. Each one builds a world, steps it at 60 Hz with 4 substeps, and
// times the build (the bodies, shapes, joints and vehicles) and b3World_Step on their own: vehicle
// input and the checks stay outside the timers.
//
//   node test/bench-physics.mjs                         every scenario against dist/
//   node test/bench-physics.mjs --dist <dir>            another build: a dist/ folder with box3d.mjs and wheeled-vehicles.mjs
//   node test/bench-physics.mjs --scenario vehicles     one scenario (repeat the flag for more)
//   node test/bench-physics.mjs --json                  one JSON object on stdout, for test/bench-physics-compare.mjs
//
// The query scenarios (ray casts, overlaps, shape casts and character movers) time a frame's batch
// of world queries instead of a step, in a still scene.
//
// The scenarios are deterministic, so two builds that simulate the same way do the same work. Each
// one also reports a check (how many boxes still stand, how far the cars got) so a change that
// alters the simulation shows up next to its timing.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values: args } = parseArgs( {
	options: {
		dist: { type: 'string', default: path.join( import.meta.dirname, '../dist' ) },
		scenario: { type: 'string', multiple: true },
		json: { type: 'boolean', default: false },
	},
} );

const dist = path.resolve( args.dist );
const { default: Box3D } = await import( pathToFileURL( path.join( dist, 'box3d.mjs' ) ).href );
const b3 = await Box3D();

const dt = 1 / 60;
const subSteps = 4;
const ID = [ 0, 0, 0, 1 ];

function axisAngle( axis, angle )
{
	const s = Math.sin( angle / 2 );
	return [ axis[ 0 ] * s, axis[ 1 ] * s, axis[ 2 ] * s, Math.cos( angle / 2 ) ];
}

// The worlds the running scenario created, destroyed once it ends however it ends
const worlds = [];

function createWorld( { enableSleep = true, gravity = [ 0, -9.81, 0 ] } = {} )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = gravity;
	worldDef.enableSleep = enableSleep;
	const world = b3.b3CreateWorld( worldDef );
	worlds.push( world );
	return world;
}

function staticBody( world, position = [ 0, 0, 0 ], rotation = ID )
{
	const def = b3.b3DefaultBodyDef();
	def.position = position;
	def.rotation = rotation;
	return b3.b3CreateBody( world, def );
}

function dynamicBody( world, position, rotation = ID )
{
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = position;
	def.rotation = rotation;
	return b3.b3CreateBody( world, def );
}

function groundBox( world, halfExtent )
{
	b3.b3CreateBoxShape( staticBody( world, [ 0, -1, 0 ] ), b3.b3DefaultShapeDef(), halfExtent, 1, halfExtent );
}

// A scene for the query scenarios: a 48 m height field with a triangle mesh slab on it, walls,
// and 2000 spheres, capsules, boxes and hulls in a 20 x 5 x 20 lattice, half on static bodies and
// half on dynamic ones. Gravity is off and no two shapes touch, so stepping moves nothing: the
// warmup steps only settle the broadphase trees, and every build queries the same scene.
const queryHalf = 24;
function queryScene()
{
	const world = createWorld( { gravity: [ 0, 0, 0 ] } );
	const n = 65, cell = ( 2 * queryHalf ) / ( n - 1 );
	const heights = [];
	for ( let z = 0; z < n; z++ )
	{
		for ( let x = 0; x < n; x++ ) heights.push( 0.6 * Math.sin( x * 0.3 ) * Math.cos( z * 0.25 ) );
	}
	const field = b3.b3CreateHeightField( heights, n, n, [ cell, 1, cell ] );
	b3.b3CreateHeightFieldShape( staticBody( world, [ -queryHalf, 0, -queryHalf ] ), b3.b3DefaultShapeDef(), field );

	// a 16 x 16 m slab of 32 x 32 quads, rippled, floating over one corner
	const m = 33, positions = [], indices = [];
	for ( let z = 0; z < m; z++ )
	{
		for ( let x = 0; x < m; x++ ) positions.push( x * 0.5 - 8, 0.3 * Math.sin( x * 0.7 + z * 0.4 ), z * 0.5 - 8 );
	}
	for ( let z = 0; z < m - 1; z++ )
	{
		for ( let x = 0; x < m - 1; x++ )
		{
			const i = z * m + x;
			indices.push( i, i + m, i + 1, i + 1, i + m, i + m + 1 );
		}
	}
	const mesh = b3.b3CreateMesh( positions, indices );
	b3.b3CreateMeshShape( staticBody( world, [ 12, 11, 12 ] ), b3.b3DefaultShapeDef(), mesh, [ 1, 1, 1 ] );

	const wallDef = b3.b3DefaultShapeDef();
	for ( const [ x, z, hx, hz ] of [ [ queryHalf, 0, 0.5, queryHalf ], [ -queryHalf, 0, 0.5, queryHalf ], [ 0, queryHalf, queryHalf, 0.5 ], [ 0, -queryHalf, queryHalf, 0.5 ] ] )
	{
		b3.b3CreateBoxShape( staticBody( world, [ x, 4, z ] ), wallDef, hx, 5, hz );
	}

	const hull = b3.b3CreateCylinder( 0.8, 0.4, -0.4, 8 );
	const shapeDef = b3.b3DefaultShapeDef();
	let i = 0;
	for ( let ix = 0; ix < 20; ix++ )
	{
		for ( let iy = 0; iy < 5; iy++ )
		{
			for ( let iz = 0; iz < 20; iz++, i++ )
			{
				const position = [ ( ix - 9.5 ) * 2.2, 2 + iy * 2, ( iz - 9.5 ) * 2.2 ];
				const rotation = axisAngle( [ 0.6, 0, 0.8 ], i * 0.7 );
				const body = i % 2 ? dynamicBody( world, position, rotation ) : staticBody( world, position, rotation );
				switch ( i % 4 )
				{
					case 0: b3.b3CreateSphereShape( body, shapeDef, { center: [ 0, 0, 0 ], radius: 0.4 } ); break;
					case 1: b3.b3CreateCapsuleShape( body, shapeDef, { center1: [ 0, -0.35, 0 ], center2: [ 0, 0.35, 0 ], radius: 0.3 } ); break;
					case 2: b3.b3CreateBoxShape( body, shapeDef, 0.4, 0.3, 0.5 ); break;
					case 3: b3.b3CreateHullShape( body, shapeDef, hull ); break;
				}
			}
		}
	}
	return {
		world,
		filter: b3.b3DefaultQueryFilter(),
		release()
		{
			b3.b3DestroyWorld( world );
			b3.b3DestroyHeightField( field );
			b3.b3DestroyMesh( mesh );
			b3.b3DestroyHull( hull );
		},
	};
}

// A deterministic spread of numbers in [0, 1), so the queries cover the scene without Math.random
const spread = ( k ) =>
{
	const s = Math.sin( k * 12.9898 + 78.233 ) * 43758.5453;
	return s - Math.floor( s );
};

// Shape proxies for the overlap and cast queries: a point cloud and a radius
const proxies = {
	sphere: { points: [ 0, 0, 0 ], radius: 0.5 },
	capsule: { points: [ 0, -0.5, 0, 0, 0.5, 0 ], radius: 0.3 },
	box: {
		points: [ -0.4, -0.4, -0.4, 0.4, -0.4, -0.4, -0.4, 0.4, -0.4, 0.4, 0.4, -0.4, -0.4, -0.4, 0.4, 0.4, -0.4, 0.4, -0.4, 0.4, 0.4, 0.4, 0.4, 0.4 ],
		radius: 0,
	},
};
const proxyList = Object.values( proxies );

const pos = [ 0, 0, 0 ];
const rot = [ 0, 0, 0, 1 ];
const upright = ( body ) =>
{
	const [ x, , z ] = b3.b3Body_GetRotation( rot, body );
	return 1 - 2 * ( x * x + z * z ); // world y of the body's up axis
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
// setup( loaded ) returns { world, warmup, steps, beforeStep?( i ), check(), release?() }. It is
// timed too: creating the world, its bodies, shapes, joints and vehicles. load() runs before it,
// untimed, for what is not physics (importing a module). The first `warmup` steps run untimed, then
// `steps` are timed. beforeStep runs untimed before every step.
//
// A query scenario (kind: 'query') also returns query( i ): the timer measures that call, one
// frame's batch of queries, in place of the step, and the world is not stepped past the warmup.
// The first `queryWarmup` frames of queries run untimed. The check counts every frame.

const scenarios = {
	// Solver bound: one tall stack where every box leans on the ones below. Sleep is off so it keeps
	// solving after it settles.
	pyramid: {
		title: 'Pyramid, 820 boxes',
		setup()
		{
			const world = createWorld( { enableSleep: false } );
			groundBox( world, 60 );
			const base = 40, h = 0.5, shapeDef = b3.b3DefaultShapeDef();
			let top;
			for ( let row = 0; row < base; row++ )
			{
				for ( let i = 0; i < base - row; i++ )
				{
					const x = ( i - ( base - row - 1 ) / 2 ) * 2 * h;
					top = dynamicBody( world, [ x, h + row * 2 * h, 0 ] );
					b3.b3CreateBoxShape( top, shapeDef, h, h, h );
				}
			}
			const topStart = ( base - 0.5 ) * 2 * h;
			return {
				world, warmup: 30, steps: 300,
				check: () => `top box dropped ${( topStart - b3.b3Body_GetPosition( pos, top )[ 1 ] ).toFixed( 2 )} m`,
			};
		},
	},

	// Collision bound: a mix of spheres, capsules, boxes and hulls rains into a walled bin over a
	// height field, so broadphase pairs, every narrowphase pairing and island sleep all show up.
	pile: {
		title: 'Pile, 1000 mixed shapes on a height field',
		setup()
		{
			const world = createWorld();
			const n = 64, cell = 0.75, half = ( ( n - 1 ) * cell ) / 2;
			const heights = [];
			for ( let z = 0; z < n; z++ )
			{
				for ( let x = 0; x < n; x++ ) heights.push( 0.4 * Math.sin( x * 0.35 ) * Math.cos( z * 0.3 ) );
			}
			const field = b3.b3CreateHeightField( heights, n, n, [ cell, 1, cell ] );
			b3.b3CreateHeightFieldShape( staticBody( world, [ -half, 0, -half ] ), b3.b3DefaultShapeDef(), field );

			const wall = 12, wallDef = b3.b3DefaultShapeDef();
			for ( const [ x, z, hx, hz ] of [ [ wall, 0, 0.5, wall ], [ -wall, 0, 0.5, wall ], [ 0, wall, wall, 0.5 ], [ 0, -wall, wall, 0.5 ] ] )
			{
				b3.b3CreateBoxShape( staticBody( world, [ x, 4, z ] ), wallDef, hx, 5, hz );
			}

			const hull = b3.b3CreateCylinder( 0.8, 0.4, -0.4, 8 );
			const shapeDef = b3.b3DefaultShapeDef();
			const bodies = [];
			const side = 10, spacing = 1.8;
			for ( let i = 0; i < 1000; i++ )
			{
				const layer = Math.floor( i / ( side * side ) ), r = i % ( side * side );
				const x = ( ( r % side ) - ( side - 1 ) / 2 ) * spacing + ( layer % 2 ) * 0.3;
				const z = ( Math.floor( r / side ) - ( side - 1 ) / 2 ) * spacing;
				const body = dynamicBody( world, [ x, 3 + layer * spacing, z ], axisAngle( [ 0.6, 0, 0.8 ], i * 0.7 ) );
				switch ( i % 4 )
				{
					case 0: b3.b3CreateSphereShape( body, shapeDef, { center: [ 0, 0, 0 ], radius: 0.4 } ); break;
					case 1: b3.b3CreateCapsuleShape( body, shapeDef, { center1: [ 0, -0.35, 0 ], center2: [ 0, 0.35, 0 ], radius: 0.3 } ); break;
					case 2: b3.b3CreateBoxShape( body, shapeDef, 0.4, 0.3, 0.5 ); break;
					case 3: b3.b3CreateHullShape( body, shapeDef, hull ); break;
				}
				bodies.push( body );
			}
			return {
				world, warmup: 0, steps: 600,
				check()
				{
					const inBin = bodies.filter( ( body ) =>
					{
						const [ x, y, z ] = b3.b3Body_GetPosition( pos, body );
						return Math.abs( x ) < wall && Math.abs( z ) < wall && y > -1;
					} ).length;
					return `${inBin}/${bodies.length} in the bin, ${b3.b3World_GetAwakeBodyCount( world )} awake`;
				},
				release()
				{
					b3.b3DestroyWorld( world );
					b3.b3DestroyHeightField( field );
					b3.b3DestroyHull( hull );
				},
			};
		},
	},

	// Joint bound: 32 capsule chains hang straight out from a ring of anchors and swing down through
	// each other, so spherical joints and capsule contacts share the solver.
	chains: {
		title: 'Chains, 32 x 24 links on spherical joints',
		setup()
		{
			const world = createWorld();
			const chains = 32, links = 24, half = 0.25, radius = 0.1, ring = 1.5, y = 20;
			const shapeDef = b3.b3DefaultShapeDef();
			const ends = [];
			for ( let c = 0; c < chains; c++ )
			{
				const angle = ( c / chains ) * Math.PI * 2;
				const dir = [ Math.cos( angle ), 0, Math.sin( angle ) ];
				const rotation = axisAngle( [ 0, 1, 0 ], -angle ); // chassis +x along dir
				let prev = staticBody( world, [ dir[ 0 ] * ring, y, dir[ 2 ] * ring ] );
				let prevFrame = { position: [ 0, 0, 0 ], quaternion: ID };
				for ( let i = 0; i < links; i++ )
				{
					const d = ring + half + i * 2 * half;
					const link = dynamicBody( world, [ dir[ 0 ] * d, y, dir[ 2 ] * d ], rotation );
					b3.b3CreateCapsuleShape( link, shapeDef, { center1: [ -half, 0, 0 ], center2: [ half, 0, 0 ], radius } );
					const jd = b3.b3DefaultSphericalJointDef();
					jd.base.bodyIdA = prev;
					jd.base.bodyIdB = link;
					jd.base.localFrameA = prevFrame;
					jd.base.localFrameB = { position: [ -half, 0, 0 ], quaternion: ID };
					b3.b3CreateSphericalJoint( world, jd );
					prev = link;
					prevFrame = { position: [ half, 0, 0 ], quaternion: ID };
				}
				ends.push( prev );
			}
			const length = links * 2 * half;
			return {
				world, warmup: 0, steps: 600,
				check()
				{
					// a chain that held together ends no further than its length below the anchor
					const lowest = Math.min( ...ends.map( ( body ) => b3.b3Body_GetPosition( pos, body )[ 1 ] ) );
					return `lowest end ${( y - lowest ).toFixed( 2 )} m below the anchors (chain ${length.toFixed( 1 )} m)`;
				},
			};
		},
	},

	// 64 preset cars in 16 lanes and 4 rows hold 72 km/h on a straight road crossed by five speed
	// bumps. The lanes cycle through four presets so different tire and drivetrain settings run.
	vehicles: {
		title: 'WheeledVehicles, 64 cars driving straight over 5 bumps',
		load: () => import( pathToFileURL( path.join( dist, 'wheeled-vehicles.mjs' ) ).href ),
		setup( { wheeledVehiclePresets, createPresetWheeledVehicleDef } )
		{
			const presets = [ 'sports-50-rwd', 'rally-75-awd', 'super-25-rwd', 'sports-100-fwd' ];
			const world = createWorld();
			groundBox( world, 1000 );

			const lanes = 16, rows = 4, laneWidth = 5, rowGap = 20;
			const roadHalf = ( lanes * laneWidth ) / 2 + 5;
			const bumps = [ 40, 80, 120, 160, 200 ];
			for ( const z of bumps )
			{
				// a 4 m radius bar sunk to stand 0.1 m proud of the road: a 1.8 m long hump. A sharp
				// bar of the same height launches the low presets at this speed and flips them.
				b3.b3CreateCapsuleShape( staticBody( world, [ 0, 0.1 - 4, z ] ), b3.b3DefaultShapeDef(), {
					center1: [ -roadHalf, 0, 0 ], center2: [ roadHalf, 0, 0 ], radius: 4,
				} );
			}

			const cars = [];
			for ( let row = 0; row < rows; row++ )
			{
				for ( let lane = 0; lane < lanes; lane++ )
				{
					const name = presets[ lane % presets.length ];
					const [ hx, hy, hz ] = wheeledVehiclePresets[ name ].halfExtents;
					const start = [ ( lane - ( lanes - 1 ) / 2 ) * laneWidth, 1.4, -row * rowGap ];
					const chassis = dynamicBody( world, start );
					b3.b3CreateBoxShape( chassis, b3.b3DefaultShapeDef(), hx, hy, hz );
					const def = createPresetWheeledVehicleDef( b3, name );
					def.chassisId = chassis;
					cars.push( { vehicle: b3.b3CreateWheeledVehicle( world, def ), chassis, startZ: start[ 2 ] } );
				}
			}

			const buf = b3.createWheeledVehicleStateBuffer();
			const state = b3.createWheeledVehicleStateRecord();
			const target = 20; // m/s
			const warmup = 60;
			const idle = { forward: 0, brake: 0, steer: 0, handbrake: 0 };
			return {
				world, warmup, steps: 900,
				beforeStep( i )
				{
					for ( const car of cars )
					{
						if ( i < warmup )
						{
							b3.b3WheeledVehicle_SetInput( car.vehicle, idle );
							continue;
						}
						b3.getWheeledVehicleStateData( buf, car.vehicle );
						b3.getWheeledVehicleStateAt( state, buf );
						const error = target - state.speed;
						b3.b3WheeledVehicle_SetInput( car.vehicle, {
							forward: error < -0.5 ? 0 : Math.max( 0, Math.min( 1, error * 0.5 + 0.25 ) ),
							brake: error < -2 ? Math.min( 1, -error * 0.2 ) : 0,
							steer: 0,
							handbrake: 0,
						} );
					}
				},
				check()
				{
					let up = 0, distance = 0, crossed = 0;
					for ( const car of cars )
					{
						if ( upright( car.chassis ) > 0.7 ) up++;
						const z = b3.b3Body_GetPosition( pos, car.chassis )[ 2 ];
						distance += z - car.startZ;
						crossed += bumps.filter( ( b ) => z > b ).length;
					}
					return `${up}/${cars.length} upright, ${( distance / cars.length ).toFixed( 0 )} m on average, ${crossed} bump crossings`;
				},
				release()
				{
					b3.b3DestroyWorld( world );
					b3.destroyWheeledVehicleStateBuffer?.( buf );
				},
			};
		},
	},

	// The query scenarios share queryScene(), and each frame's queries land in new places.

	// 1000 closest hit rays a frame from above down into the lattice and the ground, and 100 rays
	// across the whole scene that report every shape they pass through.
	raycasts: {
		title: 'Ray casts, 1000 closest and 100 all hits a frame',
		kind: 'query',
		setup()
		{
			const scene = queryScene();
			const { world, filter } = scene;
			let closest = 0, fractions = 0, all = 0;
			const countAll = () =>
			{
				all++;
				return 1; // keep going: every hit along the ray
			};
			return {
				world, warmup: 10, queryWarmup: 30, steps: 300,
				query( i )
				{
					for ( let j = 0; j < 1000; j++ )
					{
						const k = i * 1000 + j;
						const origin = [ ( spread( k ) - 0.5 ) * 40, 14, ( spread( k + 0.5 ) - 0.5 ) * 40 ];
						const target = [ ( spread( k + 0.25 ) - 0.5 ) * 40, -1, ( spread( k + 0.75 ) - 0.5 ) * 40 ];
						const hit = b3.b3World_CastRayClosest( world, origin, [ target[ 0 ] - origin[ 0 ], target[ 1 ] - origin[ 1 ], target[ 2 ] - origin[ 2 ] ], filter );
						if ( hit.hit )
						{
							closest++;
							fractions += hit.fraction;
						}
					}
					for ( let j = 0; j < 100; j++ )
					{
						const k = i * 100 + j + 0.125;
						b3.b3World_CastRay( world, [ -23, 1 + spread( k ) * 10, ( spread( k + 0.5 ) - 0.5 ) * 44 ], [ 46, 0, 0 ], filter, countAll );
					}
				},
				check: () => `${closest} closest hits at ${( fractions / closest ).toFixed( 4 )} of the ray on average, ${all} hits on the all hits rays`,
				release: scene.release,
			};
		},
	},

	// 200 axis aligned boxes and 200 sphere, capsule and box shapes a frame, scattered through the
	// lattice, each collecting every shape it overlaps.
	overlaps: {
		title: 'Overlaps, 200 AABB and 200 shape queries a frame',
		kind: 'query',
		setup()
		{
			const scene = queryScene();
			const { world, filter } = scene;
			let boxes = 0, shapes = 0;
			const countBox = () =>
			{
				boxes++;
				return true;
			};
			const countShape = () =>
			{
				shapes++;
				return true;
			};
			const at = ( k ) => [ ( spread( k ) - 0.5 ) * 44, 1 + spread( k + 0.5 ) * 10, ( spread( k + 0.25 ) - 0.5 ) * 44 ];
			return {
				world, warmup: 10, queryWarmup: 30, steps: 300,
				query( i )
				{
					for ( let j = 0; j < 200; j++ )
					{
						const [ x, y, z ] = at( i * 200 + j );
						b3.b3World_OverlapAABB( world, [ x - 1.5, y - 1.5, z - 1.5, x + 1.5, y + 1.5, z + 1.5 ], filter, countBox );
					}
					for ( let j = 0; j < 200; j++ )
					{
						const proxy = proxyList[ j % proxyList.length ];
						b3.b3World_OverlapShape( world, at( i * 200 + j + 0.375 ), proxy.points, proxy.radius, filter, countShape );
					}
				},
				check: () => `${boxes} AABB overlaps, ${shapes} shape overlaps`,
				release: scene.release,
			};
		},
	},

	// 200 sphere, capsule and box casts a frame from above down into the lattice and the ground,
	// each clipped to its closest hit.
	shapecasts: {
		title: 'Shape casts, 200 sphere, capsule and box casts a frame',
		kind: 'query',
		setup()
		{
			const scene = queryScene();
			const { world, filter } = scene;
			let casts = 0, hits = 0, fractions = 0, nearest = 1;
			const clip = ( shapeId, point, normal, fraction ) =>
			{
				nearest = Math.min( nearest, fraction );
				return fraction; // clip the cast: the closest hit
			};
			return {
				world, warmup: 10, queryWarmup: 30, steps: 300,
				query( i )
				{
					for ( let j = 0; j < 200; j++ )
					{
						const k = i * 200 + j + 0.625;
						const origin = [ ( spread( k ) - 0.5 ) * 40, 14, ( spread( k + 0.5 ) - 0.5 ) * 40 ];
						const target = [ ( spread( k + 0.25 ) - 0.5 ) * 40, -1, ( spread( k + 0.75 ) - 0.5 ) * 40 ];
						const proxy = proxyList[ j % proxyList.length ];
						nearest = 1;
						casts++;
						b3.b3World_CastShape( world, origin, proxy.points, proxy.radius, [ target[ 0 ] - origin[ 0 ], target[ 1 ] - origin[ 1 ], target[ 2 ] - origin[ 2 ] ], filter, clip );
						if ( nearest < 1 )
						{
							hits++;
							fractions += nearest;
						}
					}
				},
				check: () => `${hits}/${casts} casts hit, at ${( fractions / hits ).toFixed( 4 )} of the cast on average`,
				release: scene.release,
			};
		},
	},

	// 100 character capsules a frame, scattered through the lattice: each one casts 2 m sideways
	// (b3World_CastMover) and collects the planes it touches (b3World_CollideMover), the two
	// queries a character controller makes every frame.
	movers: {
		title: 'Character movers, 100 casts and 100 collides a frame',
		kind: 'query',
		setup()
		{
			const scene = queryScene();
			const { world, filter } = scene;
			const mover = { center1: [ 0, 0.4, 0 ], center2: [ 0, 1.4, 0 ], radius: 0.4 };
			let casts = 0, blocked = 0, touched = 0;
			const candidate = () => true;
			const collect = () =>
			{
				touched++;
				return true;
			};
			return {
				world, warmup: 10, queryWarmup: 30, steps: 300,
				query( i )
				{
					for ( let j = 0; j < 100; j++ )
					{
						const k = i * 100 + j + 0.875;
						const origin = [ ( spread( k ) - 0.5 ) * 44, spread( k + 0.5 ) * 9, ( spread( k + 0.25 ) - 0.5 ) * 44 ];
						const angle = spread( k + 0.75 ) * Math.PI * 2;
						casts++;
						if ( b3.b3World_CastMover( world, origin, mover, [ 2 * Math.cos( angle ), 0, 2 * Math.sin( angle ) ], filter, candidate ) < 1 ) blocked++;
						b3.b3World_CollideMover( world, origin, mover, filter, collect );
					}
				},
				check: () => `${blocked}/${casts} casts blocked, ${touched} shapes touched`,
				release: scene.release,
			};
		},
	},
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function stats( times )
{
	const sorted = Float64Array.from( times ).sort();
	const at = ( q ) => sorted[ Math.min( sorted.length - 1, Math.floor( q * sorted.length ) ) ];
	let sum = 0;
	for ( const t of times ) sum += t;
	return { mean: sum / times.length, median: at( 0.5 ), p95: at( 0.95 ), max: sorted[ sorted.length - 1 ] };
}

async function run( name )
{
	const scenario = scenarios[ name ];
	const loaded = await scenario.load?.();
	worlds.length = 0;
	let s;
	try
	{
		const t0 = performance.now();
		s = scenario.setup( loaded );
		const setup = performance.now() - t0;
		const counters = b3.b3World_GetCounters( s.world );
		const kind = scenario.kind ?? 'step';
		const result = { title: scenario.title, kind, setup, bodies: counters.bodyCount, joints: counters.jointCount, steps: s.steps };

		for ( let i = 0; i < s.warmup; i++ )
		{
			s.beforeStep?.( i );
			b3.b3World_Step( s.world, dt, subSteps );
		}

		const times = new Float64Array( s.steps );
		if ( kind === 'query' )
		{
			const warmup = s.queryWarmup ?? 0;
			for ( let i = 0; i < warmup; i++ ) s.query( i );
			for ( let i = 0; i < s.steps; i++ )
			{
				const t0 = performance.now();
				s.query( warmup + i );
				times[ i ] = performance.now() - t0;
			}
			return Object.assign( result, stats( times ), { check: s.check() } );
		}

		// The engine's own profile, summed over the timed steps (ms)
		const phases = { collide: 0, solve: 0 };
		let contacts = 0;
		for ( let i = 0; i < s.steps; i++ )
		{
			s.beforeStep?.( s.warmup + i );
			const t0 = performance.now();
			b3.b3World_Step( s.world, dt, subSteps );
			times[ i ] = performance.now() - t0;
			const profile = b3.b3World_GetProfile( s.world );
			phases.collide += profile.collide;
			phases.solve += profile.solve;
			contacts = Math.max( contacts, b3.b3World_GetCounters( s.world ).contactCount );
		}

		return Object.assign( result, stats( times ), {
			collide: phases.collide / s.steps,
			solve: phases.solve / s.steps,
			contacts,
			check: s.check(),
		} );
	}
	finally
	{
		// Also when the scenario throws, so a failed scenario leaves nothing behind for the next one
		try
		{
			s?.release?.();
		}
		finally
		{
			for ( const world of worlds ) if ( b3.b3World_IsValid( world ) ) b3.b3DestroyWorld( world );
		}
	}
}

const names = args.scenario ?? Object.keys( scenarios );
for ( const name of names )
{
	if ( !scenarios[ name ] ) throw new Error( `unknown scenario ${name} (have ${Object.keys( scenarios ).join( ', ' )})` );
}

const results = {};
for ( const name of names )
{
	try
	{
		results[ name ] = await run( name );
	}
	catch ( error )
	{
		// a scenario can need an API an older build lacks; report it and keep going
		results[ name ] = { title: scenarios[ name ].title, kind: scenarios[ name ].kind ?? 'step', error: String( error?.stack ?? error ) };
	}
}

if ( args.json )
{
	process.stdout.write( JSON.stringify( { dist, node: process.version, results } ) + '\n' );
}
else
{
	const ms = ( v ) => v?.toFixed( 3 ) ?? '';
	console.log( `physics benchmark: ${dist}, Node ${process.version}, ${dt * 1000 | 0} ms steps with ${subSteps} substeps` );
	console.table( Object.fromEntries( Object.entries( results ).map( ( [ name, r ] ) => [ name, r.error ? { error: r.error.split( '\n' )[ 0 ] } : {
		bodies: r.bodies,
		'setup ms': ms( r.setup ),
		steps: r.steps,
		'mean ms': ms( r.mean ),
		'median ms': ms( r.median ),
		'p95 ms': ms( r.p95 ),
		'max ms': ms( r.max ),
		'collide ms': ms( r.collide ),
		'solve ms': ms( r.solve ),
		check: r.check,
	} ] ) ) );
}
process.exit( Object.values( results ).some( ( r ) => r.error ) ? 1 : 0 );
