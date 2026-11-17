// Measures how a preset feels to drive on the mountain pass: a keyboard driver runs it downhill
// and uphill at several paces, and the script reports how the car moves around, how hard it
// pulls and how often it goes wrong. Runs against dist/, with the presets from
// src/wheeled-vehicles.js so a tuning edit needs no rebuild.
//
//   node examples/scripts/vehicle-feel.mjs --preset sports-50-rwd
//   node examples/scripts/vehicle-feel.mjs --set engine.maxTorque=486 --set finalDrive=3.9
//   add --pace 0.85 (repeatable) for the paces, --track downhill (repeatable), --autopilot to
//   drive with the autopilot instead of keys, --json for machine readable output
//
// --set changes a field of the preset's car layer (wheeledVehicleCars) for this run only, so a
// candidate can be tried without editing the presets: a dotted path and a number or JSON value.
//
// The driver is vehicle-laps.mjs's keyboard driver: full lock, full throttle or full brake,
// through createSteeringLimiter. Pace is the share of the tire grip it plans each corner at, so
// 0.85 is a tidy run, 0.95 is pushing and 1.05 arrives too fast at every corner (the default is
// 0.85 to 1.05 in steps of 0.05). One row per
// run, then the mean over the runs:
//
//   time     the run, start line to finish line (s)
//   pull     mean forward acceleration at full throttle between 40 and 110 km/h (m/s²): how
//            hard the car pulls out of the corners. Uphill reads lower than downhill.
//   wot%     share of the run at full throttle
//   grip%    share of the full throttle time with a driven tire over 85% of its peak drive
//            force: the engine has about as much as the tires can use
//   revs%    share of the run above 75% of the limiter
//   shifts   gear changes per km
//   slip5%   share of the run with over 5° of sideslip: how much the car moves around
//   p95, peak  sideslip (°)
//   slides   times the sideslip passed 12° and came back under 5° (a slide the car recovered)
//   spins    times it passed 60°
//   rear/front  how hard the rear tires work against the fronts in the corners, each as its slip
//            angle over its peak angle. Under 0.8 the car pushes its nose; over 1.1 the tail leads.
//   off%     share of the run with the car's centre off the asphalt
//   hits     sudden stops: over 1.5 m/s lost in one step (a guardrail)
//
// Single runs are chaotic (a key held one frame longer takes another line), so compare the mean
// rows, and treat a few tenths of a second or a point of share as noise.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const { wheeledVehiclePresets, wheeledVehicleCars } = await import(
	new URL('src/wheeled-vehicles.js', root).href
);
const { raceTracks } = await import(new URL('examples/src/vehicle-tracks.js', root).href);
const { driveLap } = await import(new URL('examples/scripts/vehicle-laps.mjs', root).href);

const deg = 180 / Math.PI;

function setPath(target, dotted, value) {
	const keys = dotted.split('.');
	let node = target;
	for (const key of keys.slice(0, -1)) {
		node[key] ??= {};
		node = node[key];
	}
	node[keys[keys.length - 1]] = value;
}

/** One run with the feel readouts. `options` are driveLap's (pace, keys). */
export function driveFeel(trackName, preset, options = {}) {
	const halfWidth = raceTracks[trackName].width / 2;
	const vel = [0, 0, 0];
	const spin = [0, 0, 0];
	const forward = [0, 0, 0];
	const left = [0, 0, 0];
	let setup = null;
	let steps = 0;
	let throttleSteps = 0;
	let pullSum = 0;
	let pullSteps = 0;
	let gripSteps = 0;
	let revSteps = 0;
	let shifts = 0;
	let slipSteps = 0;
	let movingSteps = 0;
	let slides = 0;
	let spins = 0;
	let offSteps = 0;
	let hits = 0;
	let frontUse = 0;
	let rearUse = 0;
	let cornerSteps = 0;
	let peakSlip = 0;
	let sliding = false;
	let spinning = false;
	let lastGear = 0;
	let lastForward = 0;
	let lastSpeed = 0;
	let distance = 0;
	const slips = [];
	const dt = 1 / 60;

	const run = driveLap(trackName, preset, {
		keys: true,
		...options,
		onStep({ api, vehicle, chassis, off, speed }) {
			if (!setup) {
				// The def the car was built from: peak angles, peak slip and the driven wheels
				const def = preset.apply(api.b3DefaultWheeledVehicleDef());
				setup = {
					maxRpm: def.engine.maxRpm,
					frontPeak: def.wheels[0].tire.lateralPeakAngle,
					rearPeak: def.wheels[2].tire.lateralPeakAngle,
					driven: def.drivetrain.differentials
						.slice(0, def.drivetrain.differentialCount)
						.flatMap((d) => [d.leftWheel, d.rightWheel])
						.map((i) => ({ i, grip: def.wheels[i].tire.longitudinalPeakFriction })),
				};
			}
			steps++;
			const state = api.b3WheeledVehicle_GetState(vehicle);
			api.b3Body_GetLinearVelocity(vel, chassis);
			api.b3Body_GetAngularVelocity(spin, chassis);
			api.b3Body_GetWorldVector(forward, chassis, [0, 0, 1]);
			api.b3Body_GetWorldVector(left, chassis, [1, 0, 0]);
			const vForward = vel[0] * forward[0] + vel[1] * forward[1] + vel[2] * forward[2];
			const vLeft = vel[0] * left[0] + vel[1] * left[1] + vel[2] * left[2];
			const kmh = speed;
			const wheels = [0, 1, 2, 3].map((i) => api.b3WheeledVehicle_GetWheelState(vehicle, i));

			if (state.engineRpm > 0.75 * setup.maxRpm) revSteps++;
			if (state.gear !== lastGear && state.gear > 0 && lastGear > 0) shifts++;
			lastGear = state.gear;

			if (state.throttle > 0.9) {
				throttleSteps++;
				if (
					setup.driven.some(
						({ i, grip }) =>
							wheels[i].hasContact &&
							wheels[i].longitudinalForce > 0.85 * grip * wheels[i].load,
					)
				) {
					gripSteps++;
				}
				if (kmh > 40 && kmh < 110 && !state.isShifting && steps > 1) {
					pullSum += (vForward - lastForward) / dt;
					pullSteps++;
				}
			}
			lastForward = vForward;

			if (kmh / 3.6 - lastSpeed < -1.5 && steps > 1) hits++;
			lastSpeed = kmh / 3.6;
			distance += lastSpeed * dt;
			if (off > halfWidth) offSteps++;

			if (kmh > 25) {
				movingSteps++;
				const slip = Math.abs(Math.atan2(vLeft, Math.abs(vForward))) * deg;
				slips.push(slip);
				peakSlip = Math.max(peakSlip, slip);
				if (slip > 5) slipSteps++;
				if (slip > 12) sliding = true;
				if (slip > 60 && !spinning) {
					spinning = true;
					sliding = false;
					spins++;
				}
				if (slip < 5) {
					if (sliding) slides++;
					sliding = false;
					spinning = false;
				}
				// In a corner: over 0.5 g of lateral acceleration
				if (Math.abs(spin[1]) * (kmh / 3.6) > 0.5 * 9.81) {
					cornerSteps++;
					frontUse +=
						(Math.abs(wheels[0].slipAngle) + Math.abs(wheels[1].slipAngle)) /
						(2 * setup.frontPeak);
					rearUse +=
						(Math.abs(wheels[2].slipAngle) + Math.abs(wheels[3].slipAngle)) /
						(2 * setup.rearPeak);
				}
			}
		},
	});
	slips.sort((a, b) => a - b);
	const km = distance / 1000;
	return {
		...run,
		pull: pullSteps ? pullSum / pullSteps : 0,
		gripShare: throttleSteps ? gripSteps / throttleSteps : 0,
		throttleShare: steps ? throttleSteps / steps : 0,
		revShare: steps ? revSteps / steps : 0,
		shiftsPerKm: km > 0 ? shifts / km : 0,
		slipShare: movingSteps ? slipSteps / movingSteps : 0,
		slipP95: slips.length ? slips[Math.floor(slips.length * 0.95)] : 0,
		slipPeak: peakSlip,
		slides,
		spins,
		balance: frontUse > 0 ? rearUse / frontUse : 0,
		offShare: steps ? offSteps / steps : 0,
		hits,
	};
}

const columns = [
	['time', (r) => (r.completed ? r.lapTime.toFixed(1) : `${Math.round(r.progress * 100)}%`)],
	['pull', (r) => r.pull.toFixed(2)],
	['wot%', (r) => (r.throttleShare * 100).toFixed(0)],
	['grip%', (r) => (r.gripShare * 100).toFixed(0)],
	['revs%', (r) => (r.revShare * 100).toFixed(0)],
	['shifts', (r) => r.shiftsPerKm.toFixed(1)],
	['slip5%', (r) => (r.slipShare * 100).toFixed(1)],
	['p95', (r) => r.slipP95.toFixed(1)],
	['peak', (r) => r.slipPeak.toFixed(0)],
	['slides', (r) => r.slides.toFixed(r.mean ? 1 : 0)],
	['spins', (r) => r.spins.toFixed(r.mean ? 1 : 0)],
	['rear/front', (r) => r.balance.toFixed(2)],
	['off%', (r) => (r.offShare * 100).toFixed(1)],
	['hits', (r) => r.hits.toFixed(r.mean ? 1 : 0)],
];

function meanRow(rows) {
	const mean = { mean: true, completed: rows.every((r) => r.completed) };
	for (const key of Object.keys(rows[0])) {
		if (typeof rows[0][key] === 'number') {
			mean[key] = rows.reduce((sum, r) => sum + r[key], 0) / rows.length;
		}
	}
	return mean;
}

const isMain =
	process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
	const args = { presets: [], tracks: [], paces: [], sets: [], keys: true, json: false };
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--preset') args.presets.push(argv[++i]);
		else if (a === '--track') args.tracks.push(argv[++i]);
		else if (a === '--pace') args.paces.push(Number(argv[++i]));
		else if (a === '--set') args.sets.push(argv[++i]);
		else if (a === '--autopilot') args.keys = false;
		else if (a === '--json') args.json = true;
		else throw new Error(`unknown argument ${a}`);
	}
	const names = args.presets.length ? args.presets : ['sports-50-rwd'];
	const trackNames = args.tracks.length ? args.tracks : ['downhill', 'uphill'];
	const paces = args.paces.length ? args.paces : [0.85, 0.9, 0.95, 1, 1.05];
	for (const name of names) {
		if (!wheeledVehiclePresets[name]) throw new Error(`no preset ${name}`);
		if (args.sets.length && !wheeledVehiclePresets[name].matrix) {
			throw new Error(`--set needs a matrix preset, ${name} has no car layer`);
		}
	}
	for (const trackName of trackNames) {
		if (!raceTracks[trackName]) throw new Error(`no track ${trackName}`);
	}
	for (const pace of paces) {
		if (!(pace > 0)) throw new Error('--pace needs a number above 0');
	}

	const out = [];
	for (const name of names) {
		const preset = wheeledVehiclePresets[name];
		for (const set of args.sets) {
			const at = set.indexOf('=');
			if (at < 1) throw new Error(`--set needs path=value, got ${set}`);
			setPath(wheeledVehicleCars[preset.matrix.car], set.slice(0, at), JSON.parse(set.slice(at + 1)));
		}
		const rows = [];
		if (!args.json) {
			console.log(`${name}${args.sets.length ? ` with ${args.sets.join(', ')}` : ''}`);
			console.log(
				`  ${'run'.padEnd(14)}${columns.map(([title]) => title.padStart(title.length + 2)).join('')}`,
			);
		}
		const print = (label, row) =>
			console.log(
				`  ${label.padEnd(14)}${columns.map(([title, format]) => format(row).padStart(title.length + 2)).join('')}`,
			);
		for (const trackName of trackNames) {
			for (const pace of paces) {
				const row = driveFeel(trackName, preset, { pace, keys: args.keys });
				rows.push({ track: trackName, pace, ...row });
				if (!args.json) print(`${trackName} ${pace}`, row);
			}
		}
		const mean = meanRow(rows);
		if (!args.json) print('mean', mean);
		out.push({ preset: name, sets: args.sets, runs: rows, mean });
	}
	if (args.json) console.log(JSON.stringify(out, null, 2));
}
