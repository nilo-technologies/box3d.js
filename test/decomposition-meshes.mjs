// Procedural test meshes for convex decomposition. Every mesh is closed and wound
// counter-clockwise seen from outside. Units are meters.

// Boxes on a lattice: xs/ys/zs are the breakpoints along each axis and filled(i, j, k)
// says whether cell (i, j, k) is solid. Only faces between a solid and an empty cell are
// emitted, and lattice vertices are shared, so the result is one closed surface.
export function latticeMesh( xs, ys, zs, filled )
{
	const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
	const solid = ( i, j, k ) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && !!filled( i, j, k );
	const positions = [], indices = [], ids = new Map();
	const vertex = ( i, j, k ) =>
	{
		const key = ( i * ( ny + 1 ) + j ) * ( nz + 1 ) + k;
		let id = ids.get( key );
		if ( id === undefined )
		{
			id = positions.length / 3;
			positions.push( xs[ i ], ys[ j ], zs[ k ] );
			ids.set( key, id );
		}
		return id;
	};
	const quad = ( a, b, c, d ) => indices.push( a, b, c, a, c, d );
	for ( let i = 0; i < nx; i++ ) for ( let j = 0; j < ny; j++ ) for ( let k = 0; k < nz; k++ )
	{
		if ( !solid( i, j, k ) ) continue;
		if ( !solid( i + 1, j, k ) ) quad( vertex( i + 1, j, k ), vertex( i + 1, j + 1, k ), vertex( i + 1, j + 1, k + 1 ), vertex( i + 1, j, k + 1 ) );
		if ( !solid( i - 1, j, k ) ) quad( vertex( i, j, k ), vertex( i, j, k + 1 ), vertex( i, j + 1, k + 1 ), vertex( i, j + 1, k ) );
		if ( !solid( i, j + 1, k ) ) quad( vertex( i, j + 1, k ), vertex( i, j + 1, k + 1 ), vertex( i + 1, j + 1, k + 1 ), vertex( i + 1, j + 1, k ) );
		if ( !solid( i, j - 1, k ) ) quad( vertex( i, j, k ), vertex( i + 1, j, k ), vertex( i + 1, j, k + 1 ), vertex( i, j, k + 1 ) );
		if ( !solid( i, j, k + 1 ) ) quad( vertex( i, j, k + 1 ), vertex( i + 1, j, k + 1 ), vertex( i + 1, j + 1, k + 1 ), vertex( i, j + 1, k + 1 ) );
		if ( !solid( i, j, k - 1 ) ) quad( vertex( i, j, k ), vertex( i, j + 1, k ), vertex( i + 1, j + 1, k ), vertex( i + 1, j, k ) );
	}
	return { positions: new Float32Array( positions ), indices: new Uint32Array( indices ) };
}

// Solid cells from axis-aligned boxes given in meters: [x0, y0, z0, x1, y1, z1], with holes
// carved back out. The lattice breakpoints are every box and hole coordinate.
export function boxesMesh( boxes, holes = [] )
{
	const axis = ( a ) => [ ...new Set( [ ...boxes, ...holes ].flatMap( ( b ) => [ b[ a ], b[ a + 3 ] ] ) ) ].sort( ( p, q ) => p - q );
	const xs = axis( 0 ), ys = axis( 1 ), zs = axis( 2 );
	const within = ( b, x, y, z ) => x > b[ 0 ] && x < b[ 3 ] && y > b[ 1 ] && y < b[ 4 ] && z > b[ 2 ] && z < b[ 5 ];
	return latticeMesh( xs, ys, zs, ( i, j, k ) =>
	{
		const x = 0.5 * ( xs[ i ] + xs[ i + 1 ] ), y = 0.5 * ( ys[ j ] + ys[ j + 1 ] ), z = 0.5 * ( zs[ k ] + zs[ k + 1 ] );
		return boxes.some( ( b ) => within( b, x, y, z ) ) && !holes.some( ( b ) => within( b, x, y, z ) );
	} );
}

// A tube swept around a closed curve: curve( t ) for t in [0, 1) returns [x, y, z]
export function tubeMesh( curve, tube, segments, sides )
{
	const positions = [], indices = [];
	const sub = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
	const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];
	const unit = ( a ) => { const l = Math.hypot( ...a ); return [ a[ 0 ] / l, a[ 1 ] / l, a[ 2 ] / l ]; };
	for ( let i = 0; i < segments; i++ )
	{
		const t = i / segments, h = 1e-4;
		const p = curve( t ), ahead = curve( t + h ), behind = curve( t - h );
		// a frame from the curve's own bending, which a closed curve returns to
		const tangent = unit( sub( ahead, behind ) );
		const bend = sub( sub( ahead, p ), sub( p, behind ) );
		const binormal = unit( cross( tangent, bend ) );
		const normal = cross( binormal, tangent );
		for ( let j = 0; j < sides; j++ )
		{
			const v = ( j / sides ) * Math.PI * 2, c = tube * Math.cos( v ), s = tube * Math.sin( v );
			positions.push( p[ 0 ] + c * normal[ 0 ] + s * binormal[ 0 ], p[ 1 ] + c * normal[ 1 ] + s * binormal[ 1 ], p[ 2 ] + c * normal[ 2 ] + s * binormal[ 2 ] );
		}
	}
	for ( let i = 0; i < segments; i++ ) for ( let j = 0; j < sides; j++ )
	{
		const a = i * sides + j, b = ( ( i + 1 ) % segments ) * sides + j;
		const c = ( ( i + 1 ) % segments ) * sides + ( ( j + 1 ) % sides ), d = i * sides + ( ( j + 1 ) % sides );
		indices.push( a, b, d, b, c, d );
	}
	return { positions: new Float32Array( positions ), indices: new Uint32Array( indices ) };
}

// A profile of [radius, height] points revolved around the y axis. The profile runs
// counter-clockwise in the (radius, height) plane; a point on the axis is one vertex.
export function latheMesh( profile, segments )
{
	const positions = [], indices = [], rings = [];
	for ( const [ r, y ] of profile )
	{
		const start = positions.length / 3;
		if ( r === 0 ) { positions.push( 0, y, 0 ); rings.push( { start, pole: true } ); continue; }
		for ( let s = 0; s < segments; s++ )
		{
			const a = ( s / segments ) * Math.PI * 2;
			positions.push( r * Math.cos( a ), y, r * Math.sin( a ) );
		}
		rings.push( { start, pole: false } );
	}
	const at = ( ring, s ) => ring.pole ? ring.start : ring.start + ( s % segments );
	for ( let i = 0; i < rings.length; i++ )
	{
		const p = rings[ i ], q = rings[ ( i + 1 ) % rings.length ];
		for ( let s = 0; s < segments; s++ )
		{
			const a = at( p, s ), b = at( p, s + 1 ), c = at( q, s + 1 ), d = at( q, s );
			if ( a !== b && d !== c ) indices.push( a, d, b, b, d, c );
			else if ( a === b && d !== c ) indices.push( a, d, c );
			else if ( a !== b && d === c ) indices.push( a, d, b );
		}
	}
	return { positions: new Float32Array( positions ), indices: new Uint32Array( indices ) };
}

const torusKnot = ( p, q, radius ) => ( t ) =>
{
	const u = t * p * Math.PI * 2, quOverP = ( q / p ) * u, cs = Math.cos( quOverP );
	return [ radius * ( 2 + cs ) * 0.5 * Math.cos( u ), radius * ( 2 + cs ) * 0.5 * Math.sin( u ), radius * Math.sin( quOverP ) * 0.5 ];
};

// name -> { mesh, note }. The lattice meshes are level geometry with openings that must stay
// open; the swept and revolved ones are curved props.
export const MESHES = {
	doorway: { note: 'wall 4 x 3 x 0.3 m with a 1 x 2.1 m doorway', mesh: () => boxesMesh( [ [ -2, 0, -0.15, 2, 3, 0.15 ] ], [ [ -0.5, -1, -1, 0.5, 2.1, 1 ] ] ) },
	facade: { note: 'wall 7 x 3 x 0.3 m with a doorway and two windows', mesh: () => boxesMesh( [ [ -3.5, 0, -0.15, 3.5, 3, 0.15 ] ],
		[ [ -0.5, -1, -1, 0.5, 2.1, 1 ], [ -2.7, 0.9, -1, -1.5, 2.1, 1 ], [ 1.5, 0.9, -1, 2.7, 2.1, 1 ] ] ) },
	room: { note: 'room 5 x 2.6 x 4 m: floor, four walls 0.2 m thick, a doorway and a window, no roof', mesh: () => boxesMesh(
		[ [ -2.5, 0, -2, 2.5, 2.6, 2 ] ],
		[ [ -2.3, 0.2, -1.8, 2.3, 3, 1.8 ], [ -0.5, 0.2, 1.5, 0.5, 2.2, 2.5 ], [ -3, 1.0, -0.8, -2, 2.0, 0.8 ] ] ) },
	table: { note: 'table: 1.6 x 0.9 m top on four legs', mesh: () => boxesMesh( [
		[ -0.8, 0.7, -0.45, 0.8, 0.76, 0.45 ],
		[ -0.75, 0, -0.4, -0.67, 0.7, -0.32 ], [ 0.67, 0, -0.4, 0.75, 0.7, -0.32 ],
		[ -0.75, 0, 0.32, -0.67, 0.7, 0.4 ], [ 0.67, 0, 0.32, 0.75, 0.7, 0.4 ] ] ) },
	chair: { note: 'chair: seat, four legs and a back', mesh: () => boxesMesh( [
		[ -0.22, 0.42, -0.22, 0.22, 0.47, 0.22 ],
		[ -0.22, 0, -0.22, -0.17, 0.42, -0.17 ], [ 0.17, 0, -0.22, 0.22, 0.42, -0.17 ],
		[ -0.22, 0, 0.17, -0.17, 0.42, 0.22 ], [ 0.17, 0, 0.17, 0.22, 0.42, 0.22 ],
		[ -0.22, 0.47, -0.22, 0.22, 0.95, -0.17 ] ] ) },
	stairs: { note: 'six steps, 1.2 m wide', mesh: () => boxesMesh(
		[ 0, 1, 2, 3, 4, 5 ].map( ( s ) => [ s * 0.28, 0, -0.6, ( s + 1 ) * 0.28, ( s + 1 ) * 0.18, 0.6 ] ) ) },
	shelf: { note: 'bookcase: frame, back panel and three shelves', mesh: () => boxesMesh(
		[ [ -0.5, 0, -0.15, 0.5, 1.8, 0.15 ] ],
		[ 0, 1, 2, 3 ].map( ( s ) => [ -0.46, 0.04 + s * 0.44, -0.11, 0.46, 0.44 + s * 0.44, 1 ] ) ) },
	trough: { note: 'U channel 3 m long, 0.6 m wide inside', mesh: () => boxesMesh( [ [ -1.5, 0, -0.45, 1.5, 0.6, 0.45 ] ], [ [ -2, 0.12, -0.3, 2, 1, 0.3 ] ] ) },
	torus: { note: 'torus, radius 1.0, tube 0.35', mesh: () => tubeMesh( ( t ) => [ Math.cos( t * Math.PI * 2 ), 0, -Math.sin( t * Math.PI * 2 ) ], 0.35, 48, 16 ) },
	knot: { note: 'trefoil torus knot', mesh: () => tubeMesh( torusKnot( 2, 3, 1.2 ), 0.22, 160, 12 ) },
	mug: { note: 'mug body: 0.5 m radius, 8 cm wall', mesh: () => latheMesh( [ [ 0, 0 ], [ 0.5, 0 ], [ 0.5, 1 ], [ 0.42, 1 ], [ 0.42, 0.1 ], [ 0, 0.1 ] ], 32 ) },
};
