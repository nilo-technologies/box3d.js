// Compares two builds on the physics scenarios in test/bench-physics.mjs and writes a Markdown
// report. Each run is a fresh Node process, and the runs alternate between the builds (base, head,
// head, base, ...) so a machine that speeds up or slows down partway through hits both alike.
//
//   node test/bench-physics-compare.mjs --base <dist dir> --head <dist dir>
//     --runs 5                  runs per build (default 5)
//     --base-label / --head-label   names for the report, such as a commit
//     --markdown <file>         write the report there as well as to stdout
//     --json <file>             write every run's numbers there
//
// A scenario's figures are the mean step time of a run and the time it took to build the scene,
// and the report takes the median of the runs for each.
// A change counts when it is at least 3% and the two builds' run ranges do not overlap.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs( {
	options: {
		base: { type: 'string' },
		head: { type: 'string', default: path.join( import.meta.dirname, '../dist' ) },
		runs: { type: 'string', default: '5' },
		'base-label': { type: 'string', default: 'base' },
		'head-label': { type: 'string', default: 'head' },
		markdown: { type: 'string' },
		json: { type: 'string' },
	},
} );

const runs = Number( args.runs );
if ( !Number.isInteger( runs ) || runs < 1 ) throw new Error( `--runs must be a whole number of at least 1 (got ${args.runs})` );
const script = path.join( import.meta.dirname, 'bench-physics.mjs' );
const sides = args.base ? [ 'base', 'head' ] : [ 'head' ];
const builds = { base: args.base, head: args.head };
const samples = { base: [], head: [] };

function runOnce( side )
{
	const child = spawnSync( process.execPath, [ script, '--dist', builds[ side ], '--json' ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const line = ( child.stdout ?? '' ).trim().split( '\n' ).at( -1 );
	try
	{
		return JSON.parse( line );
	}
	catch
	{
		// the process died before reporting (a crash, or no build at that path)
		return { error: ( child.stderr || child.stdout || child.error?.message || `exit ${child.status}` ).trim() };
	}
}

for ( let i = 0; i < runs; i++ )
{
	for ( const side of i % 2 ? [ ...sides ].reverse() : sides )
	{
		const t0 = performance.now();
		const result = runOnce( side );
		samples[ side ].push( result );
		console.error( `run ${i + 1}/${runs} ${side}: ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s${result.error ? ' (failed)' : ''}` );
	}
}

const median = ( values ) =>
{
	const s = [ ...values ].sort( ( a, b ) => a - b );
	const m = s.length >> 1;
	return s.length % 2 ? s[ m ] : ( s[ m - 1 ] + s[ m ] ) / 2;
};

// Every scenario a run reported, in the head build's order
const names = [ ...new Set( sides.flatMap( ( side ) => samples[ side ].flatMap( ( r ) => Object.keys( r.results ?? {} ) ) ) ) ];

function summarize( side, name )
{
	// Every run must have the scenario: medians over fewer runs than asked for would mislead
	const ok = samples[ side ].map( ( r ) => r.results?.[ name ] );
	const failed = ok.findIndex( ( r ) => !r || r.error );
	if ( failed >= 0 )
	{
		const run = samples[ side ][ failed ];
		const title = samples[ side ].map( ( r ) => r.results?.[ name ]?.title ).find( Boolean ) ?? name;
		return { title, error: `run ${failed + 1}: ${run.results?.[ name ]?.error ?? run.error ?? 'no result'}` };
	}
	const spread = ( key ) =>
	{
		const values = ok.map( ( r ) => r[ key ] );
		return { value: median( values ), lo: Math.min( ...values ), hi: Math.max( ...values ) };
	};
	const last = ok.at( -1 );
	return {
		title: last.title,
		runs: ok.length,
		step: spread( 'mean' ),
		setup: spread( 'setup' ),
		p95: median( ok.map( ( r ) => r.p95 ) ),
		collide: median( ok.map( ( r ) => r.collide ) ),
		solve: median( ok.map( ( r ) => r.solve ) ),
		bodies: last.bodies,
		joints: last.joints,
		contacts: last.contacts,
		steps: last.steps,
		check: last.check,
	};
}

const rows = names.map( ( name ) => ( { name, base: args.base ? summarize( 'base', name ) : null, head: summarize( 'head', name ) } ) );

const ms = ( v ) => v.toFixed( 3 );
const pct = ( v ) => `${v > 0 ? '+' : ''}${( v * 100 ).toFixed( 1 )}%`;

function verdict( base, head, key )
{
	if ( !base || base.error || head.error ) return '';
	const b = base[ key ], h = head[ key ];
	const change = h.value / b.value - 1;
	const separate = h.lo > b.hi || h.hi < b.lo;
	if ( Math.abs( change ) >= 0.03 && separate ) return change > 0 ? `🔴 ${pct( change )} slower` : `🟢 ${pct( change )} faster`;
	return `${pct( change )} (noise)`;
}

const cell = ( s, key, digits = 3 ) =>
{
	if ( !s ) return '';
	if ( s.error ) return 'failed';
	const { value, lo, hi } = s[ key ];
	return `${value.toFixed( digits )} <sub>${lo.toFixed( digits )}-${hi.toFixed( digits )}</sub>`;
};

function table( key, digits )
{
	if ( args.base )
	{
		lines.push( '| Scenario | Base | Head | Change |', '| --- | ---: | ---: | --- |' );
		for ( const { base, head } of rows ) lines.push( `| ${head.title ?? base?.title} | ${cell( base, key, digits )} | ${cell( head, key, digits )} | ${verdict( base, head, key )} |` );
	}
	else
	{
		lines.push( '| Scenario | Head |', '| --- | ---: |' );
		for ( const { head } of rows ) lines.push( `| ${head.title} | ${cell( head, key, digits )} |` );
	}
}

const lines = [];
lines.push( '## Physics performance', '' );
const cpu = os.cpus()[ 0 ]?.model?.trim() ?? 'unknown CPU';
lines.push( args.base
	? `**${args[ 'head-label' ]}** against **${args[ 'base-label' ]}**, ${runs} interleaved runs each, single threaded build, Node ${process.version}, ${cpu}.`
	: `**${args[ 'head-label' ]}**, ${runs} runs, single threaded build, Node ${process.version}, ${cpu}.` );
lines.push( '', '### Step', '', 'Milliseconds per `b3World_Step` (60 Hz, 4 substeps): the median of the runs\' means, with the fastest and slowest run.', '' );
table( 'step', 3 );
lines.push( '', '### Setup', '', 'Milliseconds to build the scene once: the world, its bodies, shapes, joints and vehicles. The median of the runs, with the fastest and slowest.', '' );
table( 'setup', 2 );
lines.push( '', 'A change is flagged when it is at least 3% and the two builds\' run ranges do not overlap.', '' );

lines.push( '<details><summary>Details</summary>', '' );
lines.push( '| Scenario | Build | p95 ms | collide ms | solve ms | bodies | joints | peak contacts | check |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |' );
for ( const { base, head } of rows )
{
	for ( const [ label, s ] of [ [ 'base', base ], [ 'head', head ] ] )
	{
		if ( !s ) continue;
		if ( s.error )
		{
			lines.push( `| ${head.title ?? base?.title ?? ''} | ${label} | | | | | | | failed: ${s.error.split( '\n' )[ 0 ].replaceAll( '|', '\\|' )} |` );
			continue;
		}
		lines.push( `| ${s.title} | ${label} | ${ms( s.p95 )} | ${ms( s.collide )} | ${ms( s.solve )} | ${s.bodies} | ${s.joints} | ${s.contacts} | ${s.check} |` );
	}
}
lines.push( '', 'collide and solve come from `b3World_GetProfile`. The check is how the scene ended up: when it differs between the builds, the simulation changed and so did the work.', '' );
lines.push( '</details>', '' );

// The comparison fails when the head build fails a scenario, or when a run of either build died
// without reporting. A base build that fails a single scenario only shows it as failed: a new
// scenario can need an API that only the head build has.
const crashed = sides.filter( ( side ) => samples[ side ].some( ( r ) => r.error ) );
const headFailed = rows.filter( ( { head } ) => head.error ).map( ( { head } ) => head.title );
const baseFailed = rows.filter( ( { base } ) => base?.error ).map( ( { base } ) => base.title );
if ( crashed.length ) lines.push( `**Failed:** a ${crashed.join( ' and a ' )} run died without reporting (see the workflow log).`, '' );
if ( headFailed.length ) lines.push( `**Failed:** the head build failed ${headFailed.join( ', ' )}.`, '' );
if ( baseFailed.length && !crashed.includes( 'base' ) )
{
	lines.push( `The base build failed ${baseFailed.join( ', ' )}, so ${baseFailed.length > 1 ? 'they have' : 'it has'} nothing to compare against. A scenario that needs an API the base build lacks does this.`, '' );
}

const markdown = lines.join( '\n' );
console.log( markdown );
if ( args.markdown ) writeFileSync( args.markdown, markdown );
if ( args.json ) writeFileSync( args.json, JSON.stringify( { builds, samples }, null, '\t' ) );

process.exit( crashed.length || headFailed.length ? 1 : 0 );
