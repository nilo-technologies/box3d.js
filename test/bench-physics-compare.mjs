// Compares two builds on the physics scenarios in test/bench-physics.mjs and writes a Markdown
// report. Each run is a fresh Node process, and the runs alternate between the builds (base, head,
// head, base, ...) so a machine that speeds up or slows down partway through hits both alike.
//
//   node test/bench-physics-compare.mjs --base <dist dir> --head <dist dir>
//     --runs 5                  runs per build (default 5)
//     --base-label / --head-label   names for the report, such as a commit
//     --reference <dist dir>    a third build to show for reference, such as upstream box3d.js
//     --reference-label         its name for the report
//     --markdown <file>         write the report there as well as to stdout
//     --json <file>             write every run's numbers there
//
// A scenario's figures are the mean step time of a run and the time it took to build the scene,
// and the report takes the median of the runs for each.
// A change counts when it is at least 3% and the two builds' run ranges do not overlap.
//
// The reference build runs interleaved with the others and gets columns of its own, the head build
// against it. It never fails the comparison: a scenario it cannot run (one that needs an API it
// lacks, such as the wheeled vehicles) shows as n/a.

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
		reference: { type: 'string' },
		'reference-label': { type: 'string', default: 'reference' },
		markdown: { type: 'string' },
		json: { type: 'string' },
	},
} );

const runs = Number( args.runs );
if ( !Number.isInteger( runs ) || runs < 1 ) throw new Error( `--runs must be a whole number of at least 1 (got ${args.runs})` );
const script = path.join( import.meta.dirname, 'bench-physics.mjs' );
const sides = [ args.reference && 'reference', args.base && 'base', 'head' ].filter( Boolean );
const builds = { reference: args.reference, base: args.base, head: args.head };
const samples = { reference: [], base: [], head: [] };

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
const names = [ ...new Set( [ ...sides ].reverse().flatMap( ( side ) => samples[ side ].flatMap( ( r ) => Object.keys( r.results ?? {} ) ) ) ) ];

function summarize( side, name )
{
	// Every run must have the scenario: medians over fewer runs than asked for would mislead
	const ok = samples[ side ].map( ( r ) => r.results?.[ name ] );
	const failed = ok.findIndex( ( r ) => !r || r.error );
	if ( failed >= 0 )
	{
		const run = samples[ side ][ failed ];
		const title = samples[ side ].map( ( r ) => r.results?.[ name ]?.title ).find( Boolean ) ?? name;
		return { title, kind: samples[ side ].map( ( r ) => r.results?.[ name ]?.kind ).find( Boolean ), error: `run ${failed + 1}: ${run.results?.[ name ]?.error ?? run.error ?? 'no result'}` };
	}
	const spread = ( key ) =>
	{
		const values = ok.map( ( r ) => r[ key ] );
		return { value: median( values ), lo: Math.min( ...values ), hi: Math.max( ...values ) };
	};
	const last = ok.at( -1 );
	return {
		title: last.title,
		kind: last.kind ?? 'step',
		runs: ok.length,
		step: spread( 'mean' ),
		setup: spread( 'setup' ),
		p95: median( ok.map( ( r ) => r.p95 ) ),
		// a query scenario has no step profile
		collide: last.collide === undefined ? undefined : median( ok.map( ( r ) => r.collide ) ),
		solve: last.solve === undefined ? undefined : median( ok.map( ( r ) => r.solve ) ),
		bodies: last.bodies,
		joints: last.joints,
		contacts: last.contacts,
		steps: last.steps,
		check: last.check,
	};
}

const rows = names.map( ( name ) => ( {
	name,
	reference: args.reference ? summarize( 'reference', name ) : null,
	base: args.base ? summarize( 'base', name ) : null,
	head: summarize( 'head', name ),
} ) );
const kindOf = ( row ) => row.head.kind ?? row.base?.kind ?? row.reference?.kind ?? 'step';
const titleOf = ( row ) => row.head.title ?? row.base?.title ?? row.reference?.title ?? row.name;

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

const cell = ( s, key, digits = 3, failed = 'failed' ) =>
{
	if ( !s ) return '';
	if ( s.error ) return failed;
	const { value, lo, hi } = s[ key ];
	return `${value.toFixed( digits )} <sub>${lo.toFixed( digits )}-${hi.toFixed( digits )}</sub>`;
};

// The rows of one kind of scenario ('step' or 'query'), or of every scenario
function table( key, digits, kind )
{
	const header = [ 'Scenario' ], align = [ '---' ];
	if ( args.base ) header.push( 'Base' ), align.push( '---:' );
	header.push( 'Head' ), align.push( '---:' );
	if ( args.base ) header.push( 'Change' ), align.push( '---' );
	if ( args.reference ) header.push( 'Reference', 'Head vs reference' ), align.push( '---:', '---' );
	lines.push( `| ${header.join( ' | ' )} |`, `| ${align.join( ' | ' )} |` );
	for ( const row of rows )
	{
		if ( kind && kindOf( row ) !== kind ) continue;
		const { reference, base, head } = row;
		const cells = [ titleOf( row ) ];
		if ( args.base ) cells.push( cell( base, key, digits ) );
		cells.push( cell( head, key, digits ) );
		if ( args.base ) cells.push( verdict( base, head, key ) );
		if ( args.reference ) cells.push( cell( reference, key, digits, 'n/a' ), verdict( reference, head, key ) );
		lines.push( `| ${cells.join( ' | ' )} |` );
	}
}

const lines = [];
lines.push( '## Physics performance', '' );
const cpu = os.cpus()[ 0 ]?.model?.trim() ?? 'unknown CPU';
const withReference = args.reference ? `, with **${args[ 'reference-label' ]}** for reference` : '';
lines.push( sides.length > 1
	? `**${args[ 'head-label' ]}**${args.base ? ` against **${args[ 'base-label' ]}**` : ''}${withReference}, ${runs} interleaved runs each, single threaded build, Node ${process.version}, ${cpu}.`
	: `**${args[ 'head-label' ]}**, ${runs} runs, single threaded build, Node ${process.version}, ${cpu}.` );
if ( rows.some( ( row ) => kindOf( row ) === 'step' ) )
{
	lines.push( '', '### Step', '', 'Milliseconds per `b3World_Step` (60 Hz, 4 substeps): the median of the runs\' means, with the fastest and slowest run.', '' );
	table( 'step', 3, 'step' );
}
if ( rows.some( ( row ) => kindOf( row ) === 'query' ) )
{
	lines.push( '', '### Queries', '', 'Milliseconds per frame of world queries, in a still scene of 2000 shapes over a height field and a triangle mesh: the median of the runs\' means, with the fastest and slowest run.', '' );
	table( 'step', 3, 'query' );
}
lines.push( '', '### Setup', '', 'Milliseconds to build the scene once: the world, its bodies, shapes, joints and vehicles. The median of the runs, with the fastest and slowest.', '' );
table( 'setup', 2 );
lines.push( '', `A change is flagged when it is at least 3% and the two builds' run ranges do not overlap${args.reference ? ', against the base and against the reference alike' : ''}.`, '' );

const opt = ( v ) => ( v === undefined ? '' : ms( v ) );
lines.push( '<details><summary>Details</summary>', '' );
lines.push( '| Scenario | Build | p95 ms | collide ms | solve ms | bodies | joints | peak contacts | check |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |' );
for ( const row of rows )
{
	for ( const [ label, s ] of [ [ 'reference', row.reference ], [ 'base', row.base ], [ 'head', row.head ] ] )
	{
		if ( !s ) continue;
		if ( s.error )
		{
			lines.push( `| ${titleOf( row )} | ${label} | | | | | | | failed: ${s.error.split( '\n' )[ 0 ].replaceAll( '|', '\\|' )} |` );
			continue;
		}
		lines.push( `| ${s.title} | ${label} | ${ms( s.p95 )} | ${opt( s.collide )} | ${opt( s.solve )} | ${s.bodies} | ${s.joints} | ${s.contacts ?? ''} | ${s.check} |` );
	}
}
lines.push( '', 'p95 is of the steps, or of the query frames. collide and solve come from `b3World_GetProfile`. The check is how the scene ended up, or what the queries found: when it differs between the builds, the simulation changed and so did the work.', '' );
lines.push( '</details>', '' );

// The comparison fails when the head build fails a scenario, or when a run of the base or head
// build died without reporting. A base build that fails a single scenario only shows it as failed:
// a new scenario can need an API that only the head build has. The reference never fails it.
const crashed = sides.filter( ( side ) => samples[ side ].some( ( r ) => r.error ) );
const fatal = crashed.filter( ( side ) => side !== 'reference' );
const headFailed = rows.filter( ( { head } ) => head.error ).map( ( { head } ) => head.title );
const baseFailed = rows.filter( ( { base } ) => base?.error ).map( ( { base } ) => base.title );
const referenceFailed = rows.filter( ( { reference } ) => reference?.error ).map( ( { reference } ) => reference.title );
if ( fatal.length ) lines.push( `**Failed:** a ${fatal.join( ' and a ' )} run died without reporting (see the workflow log).`, '' );
if ( headFailed.length ) lines.push( `**Failed:** the head build failed ${headFailed.join( ', ' )}.`, '' );
if ( baseFailed.length && !crashed.includes( 'base' ) )
{
	lines.push( `The base build failed ${baseFailed.join( ', ' )}, so ${baseFailed.length > 1 ? 'they have' : 'it has'} nothing to compare against. A scenario that needs an API the base build lacks does this.`, '' );
}
if ( crashed.includes( 'reference' ) )
{
	lines.push( 'A reference run died without reporting (see the workflow log), so the reference has no figures.', '' );
}
else if ( referenceFailed.length )
{
	lines.push( `The reference build cannot run ${referenceFailed.join( ', ' )} (n/a): ${referenceFailed.length > 1 ? 'they need' : 'it needs'} an API only this fork has.`, '' );
}

const markdown = lines.join( '\n' );
console.log( markdown );
if ( args.markdown ) writeFileSync( args.markdown, markdown );
if ( args.json ) writeFileSync( args.json, JSON.stringify( { builds, samples }, null, '\t' ) );

process.exit( fatal.length || headFailed.length ? 1 : 0 );
