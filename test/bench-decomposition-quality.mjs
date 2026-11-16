// Convex decomposition quality: V-HACD's own volume merge against box3d's surface merge
// (the `maxConcavity` option, b3MergeConvexPieces), on procedural test meshes.
//
//   node test/bench-decomposition-quality.mjs [options]
//     --dist <module>      build to test (default ../dist/box3d.mjs)
//     --meshes a,b         only these meshes (see test/decomposition-meshes.mjs)
//     --hulls 16,32        hull budgets to compare at (default 16,32)
//     --concavity 0.05     maxConcavity of the surface merge, in meters (default 0.05)
//     --resolution 100000  V-HACD voxel resolution (default 100000)
//     --markdown           print GitHub tables instead of aligned text
//     --dump <dir>         write each decomposition as JSON, for the screenshots
//                          (examples/scripts/decomposition-screenshots.mjs)
//
// Three runs per mesh and budget N:
//   V-HACD N       maxConvexHulls: N. V-HACD merges its pieces down to N by volume.
//   surface N      the same budget with maxConcavity: pieces merge against the surface,
//                  and are forced on to N only if the limit leaves more.
//   surface        maxConcavity alone, no budget: the hull count the limit asks for.
//
// The columns (see test/decomposition-metrics.mjs):
//   hulls      pieces that made a hull
//   ms         wall time of b3ComputeConvexDecomposition, single-threaded
//   sealed     deepest open space a hull closes over, cm: a doorway reads as its width
//   mean       the same averaged over the surface, cm
//   over       hull volume outside the mesh, percent of the mesh volume
//   missing    mesh volume no hull covers, percent of the mesh volume

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MESHES } from './decomposition-meshes.mjs';
import { measure, meshInfo } from './decomposition-metrics.mjs';

const args = process.argv.slice( 2 );
const option = ( name, fallback ) =>
{
	const i = args.indexOf( `--${name}` );
	return i >= 0 && i + 1 < args.length ? args[ i + 1 ] : fallback;
};
const markdown = args.includes( '--markdown' );
const dumpDir = option( 'dump', null );
const meshNames = option( 'meshes', Object.keys( MESHES ).join( ',' ) ).split( ',' );
const budgets = option( 'hulls', '16,32' ).split( ',' ).map( Number );
const concavity = Number( option( 'concavity', '0.05' ) );
const resolution = Number( option( 'resolution', '100000' ) );

const { default: Box3D } = await import( option( 'dist', '../dist/box3d.mjs' ) );
const b3 = await Box3D();

if ( dumpDir ) mkdirSync( resolve( dumpDir ), { recursive: true } );

function run( name, mesh, label, options )
{
	const t0 = performance.now();
	const packed = b3.b3ComputeConvexDecomposition( mesh.positions, mesh.indices, { resolution, ...options } );
	const ms = performance.now() - t0;
	const pieces = b3.b3UnpackConvexDecomposition( packed );
	const row = { label, ms, ...measure( mesh, pieces ) };
	if ( dumpDir )
	{
		const file = `${name}-${label.replace( /[^a-z0-9]+/gi, '-' ).toLowerCase()}.json`;
		writeFileSync( join( resolve( dumpDir ), file ), JSON.stringify( {
			mesh: name, label, options, row,
			positions: Array.from( mesh.positions ), indices: Array.from( mesh.indices ),
			pieces: pieces.map( ( p ) => Array.from( p, ( v ) => Math.round( v * 1e5 ) / 1e5 ) ),
		} ) );
	}
	return row;
}

const cells = ( r ) => [
	r.label, String( r.hulls ), r.ms.toFixed( 0 ), ( r.sealedMax * 100 ).toFixed( 1 ), ( r.sealedMean * 100 ).toFixed( 2 ),
	( r.overshoot * 100 ).toFixed( 1 ), ( r.missing * 100 ).toFixed( 1 ),
];
const HEAD = [ 'run', 'hulls', 'ms', 'sealed cm', 'mean cm', 'over %', 'missing %' ];

function print( title, rows )
{
	if ( markdown )
	{
		console.log( `\n**${title}**\n` );
		console.log( `| ${HEAD.join( ' | ' )} |` );
		console.log( `|${HEAD.map( ( _, i ) => ( i === 0 ? '---' : '---:' ) ).join( '|' )}|` );
		for ( const r of rows ) console.log( `| ${cells( r ).join( ' | ' )} |` );
		return;
	}
	const table = [ HEAD, ...rows.map( cells ) ];
	const widths = HEAD.map( ( _, i ) => Math.max( ...table.map( ( row ) => row[ i ].length ) ) );
	console.log( `\n${title}` );
	for ( const row of table ) console.log( `  ${row.map( ( c, i ) => ( i === 0 ? c.padEnd( widths[ i ] ) : c.padStart( widths[ i ] ) ) ).join( '  ' )}` );
}

const summary = [];
for ( const name of meshNames )
{
	if ( !MESHES[ name ] ) throw new Error( `unknown mesh "${name}" (have: ${Object.keys( MESHES ).join( ', ' )})` );
	const mesh = MESHES[ name ].mesh(), info = meshInfo( mesh );
	const rows = [];
	for ( const n of budgets )
	{
		rows.push( run( name, mesh, `V-HACD ${n}`, { maxConvexHulls: n } ) );
		rows.push( run( name, mesh, `surface ${n}`, { maxConvexHulls: n, maxConcavity: concavity } ) );
	}
	rows.push( run( name, mesh, 'surface', { maxConvexHulls: Infinity, maxConcavity: concavity } ) );
	print( `${name}: ${MESHES[ name ].note} (${info.triangles} triangles)`, rows );
	summary.push( { name, rows } );
}

// How often the surface merge is at least as good as V-HACD at the same budget, per metric
const better = { hulls: 0, sealedMax: 0, overshoot: 0, missing: 0, ms: 0 };
let pairs = 0;
for ( const { rows } of summary )
{
	for ( let i = 0; i + 1 < rows.length - 1; i += 2 )
	{
		const [ v, s ] = [ rows[ i ], rows[ i + 1 ] ];
		pairs++;
		for ( const key of Object.keys( better ) ) if ( s[ key ] <= v[ key ] ) better[ key ]++;
	}
}
console.log( `\n${markdown ? '**' : ''}Surface merge no worse than V-HACD at the same budget, out of ${pairs} pairs${markdown ? '**' : ''}:` +
	` fewer or equal hulls ${better.hulls}, sealed depth ${better.sealedMax}, overshoot ${better.overshoot}, missing volume ${better.missing}, time ${better.ms}` );
