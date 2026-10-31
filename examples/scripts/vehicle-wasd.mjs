// Drives vehicle presets with a keyboard (WASD) driver on a flat test course and reports how fast
// a keyboard player can corner before the car leaves the road, and how it fails above that pace.
// Runs against dist/, with the presets from src/vehicles.js so a tuning edit needs no rebuild.
//
//   node examples/scripts/vehicle-wasd.mjs --preset sports-50-rwd
//   node examples/scripts/vehicle-wasd.mjs --car sports           all 15 sports car presets
//   node examples/scripts/vehicle-wasd.mjs --all                  all 45 matrix presets
//   add --nolimit to drive without createSteeringLimiter, --pace 1.2 for one lap at one pace
//   (with the driver's view every half second), --json for machine readable output
//
// The driver only presses keys, as a keyboard player does: A or D (full lock) while the heading
// to a point ahead on the line is off by more than a deadband, W below the speed it wants and S
// (full brake) above it, nothing in between. The steer input goes through createSteeringLimiter
// with S as the braking input, as in the examples. The speed it wants comes from a pace in g: each
// corner at sqrt(pace * g * radius), braking for it at 0.8 g. A lap is clean when the car never
// leaves the road (6 m either side of the line) and never spins (sideslip over 60 degrees).
//
// For each preset it sweeps the pace from 0.8 g up in 0.1 g steps with three driver styles (how
// far ahead they look and how big an error they let go before steering) and reports the mean of
// the highest clean pace, and the first failure for each style: a spin, a slide (peak sideslip
// over 15 degrees) or a plough (the car runs wide with the tires barely sliding). Higher clean
// paces mean corners are easier to take; above them an arcade car should slide, not plough.
// Single laps are chaotic, a key held one frame longer takes another line, so compare the means
// and treat differences under 0.1 g as noise.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const { default: Box3D } = await import(new URL('dist/box3d.mjs', root).href);
const { vehiclePresets, createSteeringLimiter } = await import(
	new URL('src/vehicles.js', root).href
);

const b3 = await Box3D();
const dt = 1 / 60;
const ROAD = 6;

// The course: straights and arcs (radius m, degrees, positive turns left), sampled every metre.
// A fast right, a hairpin, a long sweeper, a chicane, a medium right, a fast left and a tight
// right, with straights long enough to brake from high speed.
const course = [
	['straight', 250], ['arc', 25, -90], ['straight', 120], ['arc', 15, 180], ['straight', 200],
	['arc', 60, -60], ['straight', 60], ['arc', 30, 70], ['arc', 30, -70], ['straight', 150],
	['arc', 40, -90], ['straight', 80], ['arc', 100, 45], ['straight', 200], ['arc', 20, -120],
	['straight', 100],
];

function buildLine() {
	const line = [];
	let x = 0;
	let z = 0;
	let heading = 0; // 0 is +z, positive turns toward +x (left)
	line.push({ x, z, k: 0 });
	for (const [kind, a, b] of course) {
		const length = kind === 'straight' ? a : (Math.abs(b) * Math.PI * a) / 180;
		const k = kind === 'straight' ? 0 : Math.sign(b) / a;
		for (let i = 0; i < length; i++) {
			heading += k;
			x += Math.sin(heading);
			z += Math.cos(heading);
			line.push({ x, z, k });
		}
	}
	return line;
}
const line = buildLine();
const n = line.length;

export const driverStyles = [
	{ look: 0.4, deadband: 1.5 },
	{ look: 0.5, deadband: 2 },
	{ look: 0.6, deadband: 3 },
];

/** One lap at a pace (g) with a driver style; returns how it went */
export function driveLap(preset, pace, style = driverStyles[1], options = {}) {
	const { limit = true, log } = options;
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [0, -9.81, 0];
	const world = b3.b3CreateWorld(worldDef);
	const groundDef = b3.b3DefaultBodyDef();
	groundDef.position = [0, -1, 0];
	b3.b3CreateBoxShape(b3.b3CreateBody(world, groundDef), b3.b3DefaultShapeDef(), 3000, 1, 3000);
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = [0, 1.2, 0];
	const chassis = b3.b3CreateBody(world, bodyDef);
	b3.b3CreateBoxShape(chassis, b3.b3DefaultShapeDef(), ...preset.halfExtents);
	const def = preset.apply(b3.b3DefaultVehicleDef());
	def.chassisId = chassis;
	const vehicle = b3.b3CreateVehicle(world, def);
	const limitSteer = createSteeringLimiter(b3);
	const steering = b3.b3Vehicle_GetSteering(vehicle);
	const wheels = def.wheels.slice(0, def.wheelCount);

	const cornerSpeed = line.map((p) => (p.k === 0 ? Number.POSITIVE_INFINITY : Math.sqrt((pace * 9.81) / Math.abs(p.k))));
	const pos = [0, 0, 0];
	const rot = [0, 0, 0, 1];
	const vel = [0, 0, 0];
	let index = 0;
	let offRoad = 0;
	let maxOff = 0;
	let maxSlip = 0;
	let spins = 0;
	let spinning = false;
	let minUp = 1;
	let t = 0;
	for (let i = 0; i < 120; i++) b3.b3World_Step(world, dt, 4);
	for (; t < 200; t += dt) {
		b3.b3Body_GetTransform(pos, rot, chassis);
		b3.b3Body_GetLinearVelocity(vel, chassis);
		let best = index;
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = -5; k < 40; k++) {
			const j = Math.min(Math.max(index + k, 0), n - 1);
			const d = (line[j].x - pos[0]) ** 2 + (line[j].z - pos[2]) ** 2;
			if (d < bestD) {
				bestD = d;
				best = j;
			}
		}
		index = best;
		if (index >= n - 2) break;
		const off = Math.sqrt(bestD);
		maxOff = Math.max(maxOff, off);
		if (off > ROAD) offRoad += dt;
		const speed = Math.hypot(vel[0], vel[2]);
		const [x, y, z, w] = rot;
		const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
		minUp = Math.min(minUp, 1 - 2 * (x * x + z * z));
		if (speed > 3) {
			let slip = Math.atan2(vel[0], vel[2]) - yaw;
			slip = Math.abs(Math.atan2(Math.sin(slip), Math.cos(slip))) * (180 / Math.PI);
			maxSlip = Math.max(maxSlip, slip);
			if (slip > 60 && !spinning) spins++;
			spinning = slip > 60 || (spinning && slip > 20);
		}

		// A or D while the heading to a point ahead is off by more than the deadband
		const ahead = line[Math.min(index + Math.round(Math.max(6, speed * style.look)), n - 1)];
		let error = Math.atan2(ahead.x - pos[0], ahead.z - pos[2]) - yaw;
		error = Math.atan2(Math.sin(error), Math.cos(error));
		const steer = Math.abs(error) > (style.deadband * Math.PI) / 180 ? -Math.sign(error) : 0;
		// W below the speed it wants, S above it, allowing for braking at 0.8 g to the corners ahead
		let want = Number.POSITIVE_INFINITY;
		for (let k = 0; k < 160; k += 2) {
			const v = cornerSpeed[Math.min(index + k, n - 1)];
			want = Math.min(want, Math.sqrt(v * v + 2 * 0.8 * 9.81 * k));
		}
		const throttle = speed < want - 0.5 ? 1 : 0;
		const brake = speed > want + 1.5 ? 1 : 0;
		b3.b3Vehicle_SetInput(vehicle, {
			forward: throttle - brake,
			brake: 0,
			steer: limit ? limitSteer(chassis, steering, wheels, steer, brake) : steer,
			handbrake: 0,
		});
		b3.b3World_Step(world, dt, 4);
		if (log && Math.round(t / dt) % 30 === 0) {
			log(`  ${t.toFixed(1)} s at ${index} m: ${(speed * 3.6).toFixed(0)} km/h (wants ${(want * 3.6).toFixed(0)}), ${off.toFixed(1)} m off the line, keys ${throttle ? 'W' : ''}${brake ? 'S' : ''}${steer < 0 ? 'A' : steer > 0 ? 'D' : ''}`);
		}
	}
	b3.b3DestroyWorld(world);
	const completed = index >= n - 3;
	return {
		completed,
		lapTime: t,
		clean: completed && offRoad === 0 && spins === 0 && minUp > 0.5,
		offRoad,
		maxOff,
		maxSlip,
		spins,
	};
}

const failureMode = (r) => (r.spins > 0 || !r.completed ? 'spin' : r.maxSlip > 15 ? 'slide' : 'plough');

/** The highest clean pace for each driver style, and how each fails above it */
export function sweep(preset, options = {}) {
	const styles = driverStyles.map((style) => {
		let clean = 0.7;
		let failure = null;
		for (let tenths = 8; tenths <= 24 && !failure; tenths++) {
			const r = driveLap(preset, tenths / 10, style, options);
			if (r.clean) clean = tenths / 10;
			else failure = { pace: tenths / 10, mode: failureMode(r), maxSlip: r.maxSlip, offRoad: r.offRoad };
		}
		return { clean, failure };
	});
	const meanClean = styles.reduce((sum, s) => sum + s.clean, 0) / styles.length;
	return { meanClean, styles };
}

const isMain =
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
	const args = { presets: [], cars: [], json: false, limit: true };
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--preset') args.presets.push(argv[++i]);
		else if (a === '--car') args.cars.push(argv[++i]);
		else if (a === '--all') args.all = true;
		else if (a === '--nolimit') args.limit = false;
		else if (a === '--json') args.json = true;
		else if (a === '--pace') {
			args.pace = Number(argv[++i]);
			if (!(args.pace > 0)) throw new Error(`--pace needs a number above 0, got ${argv[i]}`);
		} else throw new Error(`unknown argument ${a}`);
	}
	const names = Object.keys(vehiclePresets).filter((name) => {
		const m = vehiclePresets[name].matrix;
		return args.presets.includes(name) || (m && (args.all || args.cars.includes(m.car)));
	});
	if (names.length === 0) {
		console.error('usage: vehicle-wasd.mjs --preset <name> | --car <sports|rally|super> | --all [--nolimit] [--pace <g>] [--json]');
		process.exit(2);
	}
	const rows = [];
	for (const name of names) {
		const preset = vehiclePresets[name];
		if (args.pace) {
			const r = driveLap(preset, args.pace, driverStyles[1], { limit: args.limit, log: args.json ? undefined : console.log });
			rows.push({ preset: name, pace: args.pace, ...r });
			if (!args.json) {
				console.log(`${name.padEnd(16)} ${args.pace} g: ${r.completed ? `lap ${r.lapTime.toFixed(1)} s` : 'did not finish'}, ${r.offRoad.toFixed(1)} s off the road, ${r.maxOff.toFixed(1)} m off the line at most, peak sideslip ${r.maxSlip.toFixed(0)} deg${r.spins ? `, ${r.spins} spins` : ''}`);
			}
			continue;
		}
		const r = sweep(preset, { limit: args.limit });
		rows.push({ preset: name, ...r });
		if (!args.json) {
			const failures = r.styles.map((s) => (s.failure ? `${s.failure.mode} ${s.failure.maxSlip.toFixed(0)} deg` : 'none')).join(', ');
			console.log(`${name.padEnd(16)} clean to ${r.meanClean.toFixed(2)} g [${r.styles.map((s) => s.clean.toFixed(1)).join(' ')}] | above it: ${failures}`);
		}
	}
	if (args.json) console.log(JSON.stringify(rows, null, 2));
	else if (!args.pace) console.log(`sum of clean paces ${rows.reduce((sum, r) => sum + r.meanClean, 0).toFixed(2)} over ${rows.length} presets`);
}
