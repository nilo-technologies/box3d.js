// Quality metrics for a convex decomposition against its source mesh. Independent of how the
// decomposition was made: the inputs are the mesh and the points of each convex piece.
//
//   sealed depth  how deep the open space is that the hulls close over. Measured along outward
//                 rays from points on the mesh: the run of the ray inside a hull, capped at twice
//                 the farthest it gets from the surface on the way. A doorway reads as its
//                 width, a sliver of hull lying against a wall as its thickness.
//   overshoot     volume the hulls cover outside the mesh, as a share of the mesh volume
//   missing       mesh volume no hull covers, as a share of the mesh volume

function mulberry32( seed )
{
	return () =>
	{
		seed = ( seed + 0x6D2B79F5 ) | 0;
		let t = Math.imul( seed ^ ( seed >>> 15 ), 1 | seed );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

// Face planes [nx, ny, nz, offset] of the convex hull of a small point set, by trying every
// triple. Fine for the few dozen points of a collision hull.
export function hullPlanes( points )
{
	const n = points.length / 3, planes = [];
	let size = 0;
	for ( let i = 0; i < points.length; i++ ) size = Math.max( size, Math.abs( points[ i ] - points[ i % 3 ] ) );
	const eps = 1e-5 * ( size || 1 );
	for ( let a = 0; a < n; a++ ) for ( let b = a + 1; b < n; b++ ) for ( let c = b + 1; c < n; c++ )
	{
		const ax = points[ 3 * a ], ay = points[ 3 * a + 1 ], az = points[ 3 * a + 2 ];
		const ux = points[ 3 * b ] - ax, uy = points[ 3 * b + 1 ] - ay, uz = points[ 3 * b + 2 ] - az;
		const vx = points[ 3 * c ] - ax, vy = points[ 3 * c + 1 ] - ay, vz = points[ 3 * c + 2 ] - az;
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const len = Math.hypot( nx, ny, nz );
		if ( len < 1e-12 ) continue;
		nx /= len; ny /= len; nz /= len;
		const offset = nx * ax + ny * ay + nz * az;
		let above = 0, below = 0;
		for ( let p = 0; p < n && ( above === 0 || below === 0 ); p++ )
		{
			const d = nx * points[ 3 * p ] + ny * points[ 3 * p + 1 ] + nz * points[ 3 * p + 2 ] - offset;
			if ( d > eps ) above++; else if ( d < -eps ) below++;
		}
		if ( above > 0 && below > 0 ) continue;
		if ( above === 0 && below === 0 ) continue; // flat piece
		const s = above > 0 ? -1 : 1;
		const plane = [ s * nx, s * ny, s * nz, s * offset ];
		if ( !planes.some( ( q ) => q[ 0 ] * plane[ 0 ] + q[ 1 ] * plane[ 1 ] + q[ 2 ] * plane[ 2 ] > 0.99999 && Math.abs( q[ 3 ] - plane[ 3 ] ) < 10 * eps ) ) planes.push( plane );
	}
	return planes;
}

function prepareHulls( pieces )
{
	return pieces.map( ( points ) =>
	{
		const lo = [ Infinity, Infinity, Infinity ], hi = [ -Infinity, -Infinity, -Infinity ];
		for ( let i = 0; i < points.length; i++ ) { lo[ i % 3 ] = Math.min( lo[ i % 3 ], points[ i ] ); hi[ i % 3 ] = Math.max( hi[ i % 3 ], points[ i ] ); }
		return { planes: hullPlanes( points ), lo, hi };
	} ).filter( ( h ) => h.planes.length >= 4 );
}

// The mesh as triangle records plus a (y, z) grid for +x ray parity tests
function prepareMesh( mesh )
{
	const { positions, indices } = mesh;
	const lo = [ Infinity, Infinity, Infinity ], hi = [ -Infinity, -Infinity, -Infinity ];
	for ( let i = 0; i < positions.length; i++ ) { lo[ i % 3 ] = Math.min( lo[ i % 3 ], positions[ i ] ); hi[ i % 3 ] = Math.max( hi[ i % 3 ], positions[ i ] ); }
	const tris = [];
	let signedVolume = 0, area = 0;
	for ( let t = 0; t < indices.length; t += 3 )
	{
		const a = indices[ t ] * 3, b = indices[ t + 1 ] * 3, c = indices[ t + 2 ] * 3;
		const tri = [ positions[ a ], positions[ a + 1 ], positions[ a + 2 ], positions[ b ], positions[ b + 1 ], positions[ b + 2 ], positions[ c ], positions[ c + 1 ], positions[ c + 2 ] ];
		const ux = tri[ 3 ] - tri[ 0 ], uy = tri[ 4 ] - tri[ 1 ], uz = tri[ 5 ] - tri[ 2 ], vx = tri[ 6 ] - tri[ 0 ], vy = tri[ 7 ] - tri[ 1 ], vz = tri[ 8 ] - tri[ 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot( nx, ny, nz );
		if ( len < 1e-14 ) continue;
		signedVolume += ( tri[ 0 ] * nx + tri[ 1 ] * ny + tri[ 2 ] * nz ) / 6;
		area += 0.5 * len;
		tris.push( {
			p: tri, n: [ nx / len, ny / len, nz / len ], area: 0.5 * len,
			lo: [ Math.min( tri[ 0 ], tri[ 3 ], tri[ 6 ] ), Math.min( tri[ 1 ], tri[ 4 ], tri[ 7 ] ), Math.min( tri[ 2 ], tri[ 5 ], tri[ 8 ] ) ],
			hi: [ Math.max( tri[ 0 ], tri[ 3 ], tri[ 6 ] ), Math.max( tri[ 1 ], tri[ 4 ], tri[ 7 ] ), Math.max( tri[ 2 ], tri[ 5 ], tri[ 8 ] ) ],
		} );
	}
	const flip = signedVolume < 0 ? -1 : 1;
	for ( const tri of tris ) tri.n = tri.n.map( ( v ) => v * flip );
	const G = 48, cells = Array.from( { length: G * G }, () => [] );
	const cy = ( y ) => Math.min( G - 1, Math.max( 0, Math.floor( ( ( y - lo[ 1 ] ) / ( hi[ 1 ] - lo[ 1 ] || 1 ) ) * G ) ) );
	const cz = ( z ) => Math.min( G - 1, Math.max( 0, Math.floor( ( ( z - lo[ 2 ] ) / ( hi[ 2 ] - lo[ 2 ] || 1 ) ) * G ) ) );
	for ( const tri of tris )
	{
		const p = tri.p;
		const y0 = cy( Math.min( p[ 1 ], p[ 4 ], p[ 7 ] ) ), y1 = cy( Math.max( p[ 1 ], p[ 4 ], p[ 7 ] ) );
		const z0 = cz( Math.min( p[ 2 ], p[ 5 ], p[ 8 ] ) ), z1 = cz( Math.max( p[ 2 ], p[ 5 ], p[ 8 ] ) );
		for ( let y = y0; y <= y1; y++ ) for ( let z = z0; z <= z1; z++ ) cells[ y * G + z ].push( tri );
	}
	return { tris, lo, hi, area, volume: Math.abs( signedVolume ), cells, cy, cz, G };
}

function insideMesh( m, x, y, z )
{
	let crossings = 0;
	for ( const { p } of m.cells[ m.cy( y ) * m.G + m.cz( z ) ] )
	{
		// 2D point in triangle in the (y, z) plane, then the x where the ray meets it
		const d1 = ( p[ 4 ] - p[ 1 ] ) * ( z - p[ 2 ] ) - ( p[ 5 ] - p[ 2 ] ) * ( y - p[ 1 ] );
		const d2 = ( p[ 7 ] - p[ 4 ] ) * ( z - p[ 5 ] ) - ( p[ 8 ] - p[ 5 ] ) * ( y - p[ 4 ] );
		const d3 = ( p[ 1 ] - p[ 7 ] ) * ( z - p[ 8 ] ) - ( p[ 2 ] - p[ 8 ] ) * ( y - p[ 7 ] );
		if ( !( ( d1 >= 0 && d2 >= 0 && d3 >= 0 ) || ( d1 <= 0 && d2 <= 0 && d3 <= 0 ) ) ) continue;
		const total = d1 + d2 + d3;
		if ( total === 0 ) continue;
		const hitX = ( d2 * p[ 0 ] + d3 * p[ 3 ] + d1 * p[ 6 ] ) / total;
		if ( hitX > x ) crossings++;
	}
	return ( crossings & 1 ) === 1;
}

// Distance along a ray to the nearest triangle, either side (Moller-Trumbore)
function rayMesh( m, ox, oy, oz, dx, dy, dz )
{
	let best = Infinity;
	for ( const { p } of m.tris )
	{
		const e1x = p[ 3 ] - p[ 0 ], e1y = p[ 4 ] - p[ 1 ], e1z = p[ 5 ] - p[ 2 ], e2x = p[ 6 ] - p[ 0 ], e2y = p[ 7 ] - p[ 1 ], e2z = p[ 8 ] - p[ 2 ];
		const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
		const det = e1x * px + e1y * py + e1z * pz;
		if ( Math.abs( det ) < 1e-12 ) continue;
		const inv = 1 / det, tx = ox - p[ 0 ], ty = oy - p[ 1 ], tz = oz - p[ 2 ];
		const u = ( tx * px + ty * py + tz * pz ) * inv;
		if ( u < 0 || u > 1 ) continue;
		const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
		const v = ( dx * qx + dy * qy + dz * qz ) * inv;
		if ( v < 0 || u + v > 1 ) continue;
		const t = ( e2x * qx + e2y * qy + e2z * qz ) * inv;
		if ( t > 0 && t < best ) best = t;
	}
	return best;
}

// Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection 5.1.5)
function pointTriangleSqr( p, x, y, z )
{
	const abx = p[ 3 ] - p[ 0 ], aby = p[ 4 ] - p[ 1 ], abz = p[ 5 ] - p[ 2 ], acx = p[ 6 ] - p[ 0 ], acy = p[ 7 ] - p[ 1 ], acz = p[ 8 ] - p[ 2 ];
	const apx = x - p[ 0 ], apy = y - p[ 1 ], apz = z - p[ 2 ];
	const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
	let cx, cy, cz;
	if ( d1 <= 0 && d2 <= 0 ) { cx = p[ 0 ]; cy = p[ 1 ]; cz = p[ 2 ]; }
	else
	{
		const bpx = x - p[ 3 ], bpy = y - p[ 4 ], bpz = z - p[ 5 ];
		const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
		if ( d3 >= 0 && d4 <= d3 ) { cx = p[ 3 ]; cy = p[ 4 ]; cz = p[ 5 ]; }
		else
		{
			const vc = d1 * d4 - d3 * d2;
			if ( vc <= 0 && d1 >= 0 && d3 <= 0 ) { const v = d1 / ( d1 - d3 ); cx = p[ 0 ] + v * abx; cy = p[ 1 ] + v * aby; cz = p[ 2 ] + v * abz; }
			else
			{
				const cpx = x - p[ 6 ], cpy = y - p[ 7 ], cpz = z - p[ 8 ];
				const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
				if ( d6 >= 0 && d5 <= d6 ) { cx = p[ 6 ]; cy = p[ 7 ]; cz = p[ 8 ]; }
				else
				{
					const vb = d5 * d2 - d1 * d6;
					if ( vb <= 0 && d2 >= 0 && d6 <= 0 ) { const w = d2 / ( d2 - d6 ); cx = p[ 0 ] + w * acx; cy = p[ 1 ] + w * acy; cz = p[ 2 ] + w * acz; }
					else
					{
						const va = d3 * d6 - d5 * d4;
						if ( va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0 )
						{
							const w = ( d4 - d3 ) / ( d4 - d3 + d5 - d6 );
							cx = p[ 3 ] + w * ( p[ 6 ] - p[ 3 ] ); cy = p[ 4 ] + w * ( p[ 7 ] - p[ 4 ] ); cz = p[ 5 ] + w * ( p[ 8 ] - p[ 5 ] );
						}
						else
						{
							const denom = 1 / ( va + vb + vc ), v = vb * denom, w = vc * denom;
							cx = p[ 0 ] + abx * v + acx * w; cy = p[ 1 ] + aby * v + acy * w; cz = p[ 2 ] + abz * v + acz * w;
						}
					}
				}
			}
		}
	}
	return ( x - cx ) ** 2 + ( y - cy ) ** 2 + ( z - cz ) ** 2;
}

// Distance from a point to the mesh, known to be at most `bound`
function meshDistance( m, x, y, z, bound )
{
	let best = bound * bound;
	for ( const { p, lo, hi } of m.tris )
	{
		const dx = Math.max( lo[ 0 ] - x, 0, x - hi[ 0 ] ), dy = Math.max( lo[ 1 ] - y, 0, y - hi[ 1 ] ), dz = Math.max( lo[ 2 ] - z, 0, z - hi[ 2 ] );
		if ( dx * dx + dy * dy + dz * dz >= best ) continue;
		best = Math.min( best, pointTriangleSqr( p, x, y, z ) );
	}
	return Math.sqrt( best );
}

export function meshInfo( mesh )
{
	const m = prepareMesh( mesh );
	return { triangles: m.tris.length, volume: m.volume, area: m.area, size: [ m.hi[ 0 ] - m.lo[ 0 ], m.hi[ 1 ] - m.lo[ 1 ], m.hi[ 2 ] - m.lo[ 2 ] ] };
}

// pieces: array of flat xyz arrays, one per convex piece
export function measure( mesh, pieces, { surfaceSamples = 3000, volumeSamples = 120000, clearanceSteps = 24, seed = 12345 } = {} )
{
	const m = prepareMesh( mesh ), hulls = prepareHulls( pieces ), random = mulberry32( seed );
	const diagonal = Math.hypot( m.hi[ 0 ] - m.lo[ 0 ], m.hi[ 1 ] - m.lo[ 1 ], m.hi[ 2 ] - m.lo[ 2 ] ), tol = 1e-4 * diagonal;

	// sealed depth
	let maxDepth = 0, sumDepth = 0, count = 0;
	const depths = [];
	for ( let s = 0; s < surfaceSamples; s++ )
	{
		let pick = random() * m.area, tri = m.tris[ m.tris.length - 1 ];
		for ( const t of m.tris ) { pick -= t.area; if ( pick <= 0 ) { tri = t; break; } }
		let u = random(), v = random();
		if ( u + v > 1 ) { u = 1 - u; v = 1 - v; }
		const p = tri.p, n = tri.n;
		const x = p[ 0 ] + u * ( p[ 3 ] - p[ 0 ] ) + v * ( p[ 6 ] - p[ 0 ] ), y = p[ 1 ] + u * ( p[ 4 ] - p[ 1 ] ) + v * ( p[ 7 ] - p[ 1 ] ), z = p[ 2 ] + u * ( p[ 5 ] - p[ 2 ] ) + v * ( p[ 8 ] - p[ 2 ] );
		const free = 4 * tol + rayMesh( m, x + 4 * tol * n[ 0 ], y + 4 * tol * n[ 1 ], z + 4 * tol * n[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ] );
		let run = 0;
		for ( const h of hulls )
		{
			if ( x < h.lo[ 0 ] - tol || x > h.hi[ 0 ] + tol || y < h.lo[ 1 ] - tol || y > h.hi[ 1 ] + tol || z < h.lo[ 2 ] - tol || z > h.hi[ 2 ] + tol ) continue;
			let exit = free, inside = true;
			for ( const q of h.planes )
			{
				const sep = q[ 0 ] * x + q[ 1 ] * y + q[ 2 ] * z - q[ 3 ];
				if ( sep > tol ) { inside = false; break; }
				const approach = q[ 0 ] * n[ 0 ] + q[ 1 ] * n[ 1 ] + q[ 2 ] * n[ 2 ];
				if ( approach > 1e-6 ) exit = Math.min( exit, -sep / approach );
			}
			if ( inside && exit > run ) run = exit;
		}
		// The run counts in full only where the ray gets clear of the surface: a ray sliding along a
		// wall inside a thin sliver of hull is charged the sliver's thickness, not its length.
		let depth = 0;
		if ( run > tol )
		{
			let clearance = 0;
			for ( let k = 1; k <= clearanceSteps; k++ )
			{
				const d = ( run * k ) / clearanceSteps;
				clearance = Math.max( clearance, meshDistance( m, x + d * n[ 0 ], y + d * n[ 1 ], z + d * n[ 2 ], d ) );
			}
			depth = Math.min( run, 2 * clearance );
		}
		maxDepth = Math.max( maxDepth, depth );
		sumDepth += depth;
		depths.push( depth );
		count++;
	}
	depths.sort( ( a, b ) => a - b );

	// volume
	let inMesh = 0, over = 0, missing = 0, overlap = 0;
	const pad = 0.05 * diagonal;
	for ( let s = 0; s < volumeSamples; s++ )
	{
		const x = m.lo[ 0 ] - pad + random() * ( m.hi[ 0 ] - m.lo[ 0 ] + 2 * pad );
		const y = m.lo[ 1 ] - pad + random() * ( m.hi[ 1 ] - m.lo[ 1 ] + 2 * pad );
		const z = m.lo[ 2 ] - pad + random() * ( m.hi[ 2 ] - m.lo[ 2 ] + 2 * pad );
		const solid = insideMesh( m, x, y, z );
		// Every hull that holds the point: the hulls can overlap, and a body that takes its mass
		// from them counts the overlap twice
		let holders = 0;
		for ( const h of hulls )
		{
			if ( x < h.lo[ 0 ] || x > h.hi[ 0 ] || y < h.lo[ 1 ] || y > h.hi[ 1 ] || z < h.lo[ 2 ] || z > h.hi[ 2 ] ) continue;
			let inside = true;
			for ( const q of h.planes ) if ( q[ 0 ] * x + q[ 1 ] * y + q[ 2 ] * z - q[ 3 ] > 0 ) { inside = false; break; }
			if ( inside ) holders++;
		}
		const covered = holders > 0;
		if ( holders > 1 ) overlap += holders - 1;
		if ( solid ) inMesh++;
		if ( solid && !covered ) missing++;
		if ( !solid && covered ) over++;
	}
	return {
		hulls: hulls.length,
		sealedMax: maxDepth,
		sealedP95: depths[ Math.floor( 0.95 * ( depths.length - 1 ) ) ],
		sealedMean: sumDepth / count,
		overshoot: over / Math.max( inMesh, 1 ),
		missing: missing / Math.max( inMesh, 1 ),
		overlap: overlap / Math.max( inMesh, 1 ),
	};
}
