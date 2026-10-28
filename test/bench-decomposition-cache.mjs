// Convex decomposition cache benchmark: what the cache key costs, and what a body
// costs once its decomposition is cached.
//
//   node test/bench-decomposition-cache.mjs [../dist/box3d.mjs]

const importPath = process.argv[ 2 ] ?? '../dist/box3d.mjs';
const { default: Box3D } = await import( importPath );
const b3 = await Box3D();

function torusMesh( radial, tubular, radius = 1, tube = 0.35 )
{
	const positions = new Float32Array( radial * tubular * 3 );
	const indices = new Uint32Array( radial * tubular * 6 );
	let p = 0, t = 0;
	for ( let i = 0; i < radial; i++ )
	{
		for ( let j = 0; j < tubular; j++ )
		{
			const u = ( i / radial ) * Math.PI * 2, v = ( j / tubular ) * Math.PI * 2, r = radius + tube * Math.cos( v );
			positions[ p++ ] = r * Math.cos( u );
			positions[ p++ ] = tube * Math.sin( v );
			positions[ p++ ] = r * Math.sin( u );
			const a = i * tubular + j, b = ( ( i + 1 ) % radial ) * tubular + j;
			const c = ( ( i + 1 ) % radial ) * tubular + ( ( j + 1 ) % tubular ), d = i * tubular + ( ( j + 1 ) % tubular );
			indices.set( [ a, d, b, b, d, c ], t );
			t += 6;
		}
	}
	return { positions, indices };
}

function time( fn, reps )
{
	fn();
	const t0 = performance.now();
	for ( let i = 0; i < reps; i++ ) fn();
	return ( performance.now() - t0 ) / reps;
}

const ms = ( v ) => ( v < 0.01 ? `${( v * 1000 ).toFixed( 2 )} us` : `${v.toFixed( 2 )} ms` );

// --- key cost -----------------------------------------------------------------
console.log( 'cache key cost (64-bit mesh hash + options)' );
const keyRows = [];
for ( const [ radial, tubular ] of [ [ 25, 20 ], [ 100, 50 ], [ 400, 125 ], [ 1000, 500 ] ] )
{
	const { positions, indices } = torusMesh( radial, tubular );
	const asArrays = { positions: Array.from( positions ), indices: Array.from( indices ) };
	const reps = positions.length > 1e6 ? 5 : positions.length > 1e5 ? 20 : 200;
	const opts = { maxConvexHulls: 12 };
	keyRows.push( {
		vertices: positions.length / 3,
		MB: +( ( positions.byteLength + indices.byteLength ) / 1048576 ).toFixed( 2 ),
		'typed, first call': ms( time( () => { b3.b3ClearConvexDecompositionCache(); b3.b3ConvexDecompositionCacheKey( positions, indices, opts ); }, reps ) ),
		'number[], first call': ms( time( () => { b3.b3ClearConvexDecompositionCache(); b3.b3ConvexDecompositionCacheKey( asArrays.positions, asArrays.indices, opts ); }, reps ) ),
		'memoized (same arrays)': ms( time( () => b3.b3ConvexDecompositionCacheKey( positions, indices, opts ), 10000 ) ),
		'cacheKey (asset id)': ms( time( () => b3.b3ConvexDecompositionCacheKey( positions, indices, { ...opts, cacheKey: 'torus' } ), 10000 ) ),
	} );
}
console.table( keyRows );

// --- per-body cost ------------------------------------------------------------
console.log( 'per-body cost, 48x24 torus' );
const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );
const bodyDef = b3.b3DefaultBodyDef();
bodyDef.type = b3.b3BodyType.b3_dynamicBody;
bodyDef.isEnabled = false;
const shapeDef = b3.b3DefaultShapeDef();
const { positions, indices } = torusMesh( 48, 24 );
let spawned = 0;
const nextBody = () =>
{
	bodyDef.position = [ ( spawned % 30 ) * 4, 2, Math.floor( spawned / 30 ) * 4 ];
	spawned++;
	return b3.b3CreateBody( world, bodyDef );
};

const bodyRows = [];
for ( const maxConvexHulls of [ 12, 32 ] )
{
	const options = { maxConvexHulls, resolution: 50000 };
	b3.b3ClearConvexDecompositionCache();

	let t0 = performance.now();
	const first = await b3.b3CreateConvexDecompositionShapesAsync( nextBody(), shapeDef, positions, indices, options );
	const missMs = performance.now() - t0;

	const N = 300;
	t0 = performance.now();
	for ( let i = 0; i < N; i++ ) await b3.b3CreateConvexDecompositionShapesAsync( nextBody(), shapeDef, positions, indices, options );
	const hitMs = ( performance.now() - t0 ) / N;

	// an asset id is its own entry, so warm it before timing hits
	const byId = { ...options, cacheKey: 'torus' };
	await b3.b3CreateConvexDecompositionShapesAsync( nextBody(), shapeDef, positions, indices, byId );
	t0 = performance.now();
	for ( let i = 0; i < N; i++ ) await b3.b3CreateConvexDecompositionShapesAsync( nextBody(), shapeDef, positions, indices, byId );
	const hitIdMs = ( performance.now() - t0 ) / N;

	const packed = b3.b3ComputeConvexDecomposition( positions, indices, options );
	t0 = performance.now();
	for ( let i = 0; i < N; i++ ) b3.b3CreateConvexDecompositionShapesFromPacked( nextBody(), shapeDef, packed );
	const fromPackedMs = ( performance.now() - t0 ) / N;

	t0 = performance.now();
	for ( let i = 0; i < 3; i++ ) await b3.b3CreateConvexDecompositionShapesAsync( nextBody(), shapeDef, positions, indices, { ...options, cache: false } );
	const noCacheMs = ( performance.now() - t0 ) / 3;

	const stats = b3.b3GetConvexDecompositionCacheStats();
	bodyRows.push( {
		pieces: first.count,
		'no cache (V-HACD every body)': ms( noCacheMs ),
		'first body (miss)': ms( missMs ),
		'cache hit (mesh hash)': ms( hitMs ),
		'cache hit (cacheKey)': ms( hitIdMs ),
		'FromPacked (no cache layer)': ms( fromPackedMs ),
		speedup: `${Math.round( noCacheMs / hitMs )}x`,
		'hits/misses': `${stats.hits}/${stats.misses}`,
	} );
}
console.table( bodyRows );
b3.b3DestroyWorld( world );
process.exit( 0 );
