/**
 * Side by side pictures of convex decompositions, for comparing V-HACD's volume merge
 * with box3d's surface merge (the `maxConcavity` option).
 *
 * Reads the JSON files written by `node test/bench-decomposition-quality.mjs --dump <dir>`
 * and draws, for each mesh, one panel per run: every hull in its own color over the wire
 * frame of the source mesh, with the hull count and the measured quality underneath.
 *
 * Usage (from the repository root):
 *   node test/bench-decomposition-quality.mjs --hulls 16 --dump build/decomposition
 *   node examples/scripts/decomposition-screenshots.mjs build/decomposition docs/images/decomposition
 *
 * A third argument picks the runs to draw, by label: "V-HACD 16,surface 16,surface".
 * Set CHROMIUM_PATH to use a Chromium other than the one Playwright downloads.
 */

import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const threeDir = resolve( examplesDir, 'node_modules/three' );
const [ dumpArg, outArg, runsArg ] = process.argv.slice( 2 );
if ( !dumpArg || !outArg ) throw new Error( 'usage: decomposition-screenshots.mjs <dump dir> <output dir> [labels]' );
const wanted = runsArg ? runsArg.split( ',' ) : null;
const dumpDir = resolve( dumpArg ), outDir = resolve( outArg );
mkdirSync( outDir, { recursive: true } );

// one picture per mesh, its runs in the order the benchmark made them
const byMesh = new Map();
for ( const file of readdirSync( dumpDir ).filter( ( f ) => f.endsWith( '.json' ) ).sort() )
{
	const run = JSON.parse( readFileSync( join( dumpDir, file ), 'utf8' ) );
	if ( wanted && !wanted.includes( run.label ) ) continue;
	if ( !byMesh.has( run.mesh ) ) byMesh.set( run.mesh, [] );
	byMesh.get( run.mesh ).push( run );
}
// V-HACD first, then the surface merge under the same budget, then the surface merge alone
const order = ( label ) => ( wanted ? wanted.indexOf( label ) : label.startsWith( 'V-HACD' ) ? 0 : /\d/.test( label ) ? 1 : 2 );
for ( const runs of byMesh.values() ) runs.sort( ( a, b ) => order( a.label ) - order( b.label ) );

const PANEL = 420;
const page = /* html */ `<!doctype html>
<meta charset="utf-8">
<style>
	body { margin: 0; background: #14161a; font: 15px/1.35 system-ui, sans-serif; color: #e6e8eb; }
	#row { display: flex; }
	.panel { width: ${PANEL}px; }
	canvas { display: block; }
	.caption { padding: 8px 14px 14px; }
	.caption b { font-size: 17px; }
	.caption span { color: #9aa3ad; }
</style>
<div id="row"></div>
<script type="importmap">{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// evenly spread hues, shuffled so neighbors in the list differ
const color = ( i, n ) => new THREE.Color().setHSL( ( ( i * 0.61803398875 ) % 1 ), 0.62, 0.56 );

// what the last picture allocated: freed before the next one is drawn
let disposables = [];
const keep = ( resource ) => { disposables.push( resource ); return resource; };

window.draw = ( runs ) =>
{
	for ( const resource of disposables )
	{
		resource.dispose();
		resource.forceContextLoss?.();
	}
	disposables = [];
	const row = document.getElementById( 'row' );
	row.replaceChildren();
	for ( const run of runs )
	{
		const panel = document.createElement( 'div' );
		panel.className = 'panel';
		const renderer = keep( new THREE.WebGLRenderer( { antialias: true, preserveDrawingBuffer: true } ) );
		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( ${PANEL}, ${PANEL} );
		renderer.setClearColor( 0x14161a );
		panel.append( renderer.domElement );

		const scene = new THREE.Scene();
		scene.add( new THREE.HemisphereLight( 0xffffff, 0x30343c, 1.5 ) );
		const sun = new THREE.DirectionalLight( 0xffffff, 2.2 );
		sun.position.set( 3, 5, 4 );
		scene.add( sun );

		const source = keep( new THREE.BufferGeometry() );
		source.setAttribute( 'position', new THREE.Float32BufferAttribute( run.positions, 3 ) );
		source.setIndex( run.indices );
		source.computeBoundingSphere();
		const { center, radius } = source.boundingSphere;

		run.pieces.forEach( ( points, i ) =>
		{
			const vertices = [];
			for ( let p = 0; p < points.length; p += 3 ) vertices.push( new THREE.Vector3( points[ p ], points[ p + 1 ], points[ p + 2 ] ) );
			let geometry;
			try { geometry = keep( new ConvexGeometry( vertices ) ); }
			catch { return; }
			const c = color( i, run.pieces.length );
			scene.add( new THREE.Mesh( geometry, keep( new THREE.MeshStandardMaterial( { color: c, roughness: 0.7, flatShading: true, transparent: true, opacity: 0.9 } ) ) ) );
			scene.add( new THREE.LineSegments( keep( new THREE.EdgesGeometry( geometry, 20 ) ), keep( new THREE.LineBasicMaterial( { color: c.clone().multiplyScalar( 0.45 ) } ) ) ) );
		} );
		// the source mesh on top, so what the hulls cover beyond it shows
		scene.add( new THREE.LineSegments( keep( new THREE.EdgesGeometry( source, 20 ) ),
			keep( new THREE.LineBasicMaterial( { color: 0xffffff, depthTest: false, transparent: true, opacity: 0.55 } ) ) ) );

		const camera = new THREE.PerspectiveCamera( 32, 1, radius * 0.05, radius * 20 );
		camera.position.copy( center ).add( new THREE.Vector3( 0.55, 0.5, 1 ).normalize().multiplyScalar( radius * 4.3 ) );
		camera.lookAt( center );
		renderer.render( scene, camera );

		const r = run.row;
		const caption = document.createElement( 'div' );
		caption.className = 'caption';
		caption.innerHTML = '<b>' + run.label + '</b> · ' + r.hulls + ' hulls · ' + r.ms.toFixed( 0 ) + ' ms<br><span>sealed '
			+ ( r.sealedMax * 100 ).toFixed( 1 ) + ' cm · over ' + ( r.overshoot * 100 ).toFixed( 1 ) + '% · missing ' + ( r.missing * 100 ).toFixed( 1 ) + '%</span>';
		panel.append( caption );
		row.append( panel );
	}
	return row.getBoundingClientRect().height;
};
window.ready = true;
</script>`;

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer( ( req, res ) =>
{
	const path = decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname );
	if ( path === '/' ) { res.writeHead( 200, { 'content-type': 'text/html' } ); res.end( page ); return; }
	const file = path.startsWith( '/three/' ) ? resolve( threeDir, `.${path.slice( '/three'.length )}` ) : null;
	if ( !file || !file.startsWith( threeDir ) || !existsSync( file ) ) { res.writeHead( 404 ); res.end(); return; }
	res.writeHead( 200, { 'content-type': TYPES[ extname( file ) ] ?? 'application/octet-stream' } );
	createReadStream( file ).pipe( res );
} );
await new Promise( ( done ) => server.listen( 0, '127.0.0.1', done ) );

// CHROMIUM_PATH points at a Chromium to use when Playwright's own download is not installed
const browser = await chromium.launch( {
	executablePath: process.env.CHROMIUM_PATH || undefined,
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
} );
try
{
	const tab = await browser.newPage( { viewport: { width: PANEL * 3, height: PANEL + 80 }, deviceScaleFactor: 2 } );
	tab.on( 'pageerror', ( err ) => console.error( `[page error] ${err.message}` ) );
	await tab.goto( `http://127.0.0.1:${server.address().port}/` );
	await tab.waitForFunction( () => window.ready === true );
	for ( const [ mesh, runs ] of byMesh )
	{
		await tab.setViewportSize( { width: PANEL * runs.length, height: PANEL + 80 } );
		const height = await tab.evaluate( ( r ) => window.draw( r ), runs );
		const out = join( outDir, `${mesh}.png` );
		await tab.screenshot( { path: out, clip: { x: 0, y: 0, width: PANEL * runs.length, height: Math.ceil( height ) } } );
		console.log( `saved ${out}` );
	}
}
finally
{
	await browser.close();
	server.close();
}
