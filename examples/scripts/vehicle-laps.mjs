// Drives vehicle presets around the race tracks (examples/src/vehicle-tracks.js) with an
// autopilot and checks that each lap is completed without flipping. Runs against dist/.
//
//   node examples/scripts/vehicle-laps.mjs --track circuit --preset sports-50-rwd
//   node examples/scripts/vehicle-laps.mjs --track stage --car rally
//   node examples/scripts/vehicle-laps.mjs --all            every matrix preset on both tracks
//   add --json for machine readable output
//
// The autopilot steers at a point ahead on the centreline and plans its speed from the corners
// ahead: as fast as the tires grip and the speed sensitive steering can turn, allowing for the
// braking distance. It eases off the throttle when the driven wheels spin, as a player would
// without traction control. Each track has an advisory speed for its bump section: the circuit's
// bumps are taken flat out, the stage's whoops and jump at 60 km/h.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const { default: Box3D } = await import(new URL('dist/box3d.mjs', root).href);
const { vehiclePresets } = await import(
	new URL('src/vehicles.js', root).href
);
const { buildRaceTrack, createRaceTrackBodies } = await import(
	new URL('examples/src/vehicle-tracks.js', root).href
);

export const bumpSpeeds = { circuit: Number.POSITIVE_INFINITY, stage: 60 };

const b3 = await Box3D();
const dt = 1 / 60;
const tracks = {};

export function driveLap(trackName, preset, options = {}) {
	const {
		pace = 0.85,
		bumpKmh = bumpSpeeds[trackName],
		timeout = 400,
		// Called every step with the car's progress and pose, for debugging
		onStep,
	} = options;
	// The box3d module to drive with, so a test can run the lap on the build it is testing
	const api = options.b3 ?? b3;
	tracks[trackName] ??= buildRaceTrack(trackName);
	const track = tracks[trackName];
	const worldDef = api.b3DefaultWorldDef();
	worldDef.gravity = [0, -9.81, 0];
	const world = api.b3CreateWorld(worldDef);
	const { field } = createRaceTrackBodies(api, world, track);
	const bodyDef = api.b3DefaultBodyDef();
	bodyDef.type = api.b3BodyType.b3_dynamicBody;
	const start = track.start;
	bodyDef.position = [start.position[0], start.position[1] + 1.5, start.position[2]];
	bodyDef.rotation = [0, Math.sin(start.yaw / 2), 0, Math.cos(start.yaw / 2)];
	const chassis = api.b3CreateBody(world, bodyDef);
	api.b3CreateBoxShape(chassis, api.b3DefaultShapeDef(), ...preset.halfExtents);
	const def = preset.apply(api.b3DefaultVehicleDef());
	def.chassisId = chassis;
	const vehicle = api.b3CreateVehicle(world, def);

	const grip = def.wheels[0].tire.lateralPeakFriction;
	const wheelbase = def.wheels[0].position[2] - def.wheels[2].position[2];
	const maxAngle = def.steering.maxAngle;
	const speedReference = def.steering.speedReference;
	const driven = def.drivetrain.differentials
		.slice(0, def.drivetrain.differentialCount)
		.flatMap((d) => [d.leftWheel, d.rightWheel]);
	const line = track.centerline;
	const n = line.length;

	// Corner speed at each sample: the tire grip limit, and the speed at which the steering can
	// still reach the angle the corner needs (wheelbase / radius plus a margin for slip)
	const cornerSpeed = line.map((_, i) => {
		const a = line[(i - 6 + n) % n];
		const b = line[(i + 6) % n];
		const turn = Math.abs(
			Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz),
		);
		const radius = 12 / Math.max(turn, 1e-6);
		const need = (1.4 * wheelbase) / radius;
		const steer =
			need >= maxAngle
				? 3
				: speedReference > 0
					? speedReference * Math.sqrt(maxAngle / need - 1)
					: Number.POSITIVE_INFINITY;
		return Math.min(Math.sqrt(pace * grip * 9.81 * radius), steer);
	});
	for (let i = track.bumpSection.from; i <= track.bumpSection.to; i++) {
		cornerSpeed[i % n] = Math.min(cornerSpeed[i % n], bumpKmh / 3.6);
	}

	const pos = [0, 0, 0];
	const rot = [0, 0, 0, 1];
	const vel = [0, 0, 0];
	let index = Math.round(start.s) % n;
	let progress = 0;
	let t = 0;
	let minUp = 1;
	let maxOff = 0;
	let airtime = 0;
	let bumpPeakG = 0;
	let prevVy = 0;
	let topSpeed = 0;
	let stopped = 0;
	let worstAt = index;
	api.b3World_Step(world, dt, 4);
	for (; t < timeout; t += dt) {
		api.b3Body_GetTransform(pos, rot, chassis);
		api.b3Body_GetLinearVelocity(vel, chassis);
		let best = index;
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = -5; k < 40; k++) {
			const p = line[(index + k + n) % n];
			const d = (p.x - pos[0]) ** 2 + (p.z - pos[2]) ** 2;
			if (d < bestD) {
				bestD = d;
				best = index + k;
			}
		}
		progress += best - index;
		index = ((best % n) + n) % n;
		if (progress >= n) break;
		const speed = Math.hypot(vel[0], vel[2]);
		topSpeed = Math.max(topSpeed, speed * 3.6);
		maxOff = Math.max(maxOff, Math.sqrt(bestD));
		const [x, y, z, w] = rot;
		const up = 1 - 2 * (x * x + z * z);
		if (up < minUp) {
			minUp = up;
			worstAt = index;
		}
		const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));

		// Far off the road, slow down and head back to it, as a player would
		const lost = Math.sqrt(bestD) > 12;
		const aim = line[(index + Math.round(lost ? 10 : Math.max(8, speed * 0.7))) % n];
		let err = Math.atan2(aim.x - pos[0], aim.z - pos[2]) - yaw;
		err = Math.atan2(Math.sin(err), Math.cos(err));
		// Braking distance to each corner ahead, with less deceleration downhill
		let target = Number.POSITIVE_INFINITY;
		const grade = (line[(index + 20) % n].y - line[index].y) / 20;
		const decel = Math.max(2, 9.81 * (0.8 * pace * grip + Math.min(grade, 0)));
		for (let k = 0; k < 150; k += 3) {
			const v = cornerSpeed[(index + k) % n];
			target = Math.min(target, Math.sqrt(v * v + 2 * decel * k));
		}
		if (lost) target = Math.min(target, 30 / 3.6);
		const e = target - speed;
		let throttle = e > 0 ? Math.min(1, e * 0.5 + 0.2) : 0;
		const spin = Math.max(
			...driven.map((i) =>
				Math.abs(api.b3Vehicle_GetWheelState(vehicle, i).slipRatio),
			),
		);
		if (spin > 0.25) throttle *= 0.4;
		api.b3Vehicle_SetInput(vehicle, {
			forward: throttle,
			brake: e < -1 ? Math.min(1, -e * 0.3) : 0,
			steer: Math.max(-1, Math.min(1, -err * 2.5)),
			handbrake: 0,
		});
		api.b3World_Step(world, dt, 4);

		if (api.b3Vehicle_GetState(vehicle).wheelsInContact === 0 && t > 1) {
			airtime += dt;
		}
		const ay = (vel[1] - prevVy) / dt;
		prevVy = vel[1];
		if (index >= track.bumpSection.from && index <= track.bumpSection.to) {
			bumpPeakG = Math.max(bumpPeakG, Math.abs(ay) / 9.81);
		}
		onStep?.({
			t,
			s: index,
			speed: speed * 3.6,
			up: 1 - 2 * (x * x + z * z),
			off: Math.sqrt(bestD),
			contacts: api.b3Vehicle_GetState(vehicle).wheelsInContact,
			height: pos[1] - line[index].y,
		});
		stopped = speed < 0.5 ? stopped + dt : 0;
		if (stopped > 5) break;
	}
	api.b3DestroyWorld(world);
	api.b3DestroyHeightField(field);
	return {
		completed: progress >= n,
		lapTime: t,
		topSpeed,
		minUp,
		maxOffCenter: maxOff,
		airtime,
		bumpPeakG,
		progress: Math.min(progress / n, 1),
		/** Where the car was least upright, and where it stopped if it did (m along the track) */
		worstAt,
		stoppedAt: progress >= n ? null : index,
	};
}

const isMain =
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
	const args = { tracks: [], presets: [], cars: [], json: false };
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--track') args.tracks.push(argv[++i]);
		else if (a === '--preset') args.presets.push(argv[++i]);
		else if (a === '--car') args.cars.push(argv[++i]);
		else if (a === '--all') args.all = true;
		else if (a === '--json') args.json = true;
		else if (a === '--pace') {
			args.pace = Number(argv[++i]);
			// A fraction of the grip limit: 0 or less would never move the car
			if (!(args.pace > 0)) throw new Error(`--pace needs a number above 0, got ${argv[i]}`);
		}
		else throw new Error(`unknown argument ${a}`);
	}
	const trackNames = args.tracks.length ? args.tracks : ['circuit', 'stage'];
	const names = Object.keys(vehiclePresets).filter((name) => {
		const m = vehiclePresets[name].matrix;
		return (
			args.presets.includes(name) ||
			(m && (args.all || args.cars.includes(m.car)))
		);
	});
	if (names.length === 0) {
		console.error(
			'usage: vehicle-laps.mjs [--track circuit|stage] --preset <name> | --car <sports|rally|super> | --all [--pace 0.85] [--json]',
		);
		process.exit(2);
	}
	const rows = [];
	for (const trackName of trackNames) {
		for (const name of names) {
			const r = driveLap(
				trackName,
				vehiclePresets[name],
				args.pace === undefined ? {} : { pace: args.pace },
			);
			const pass = r.completed && r.minUp > 0.3;
			rows.push({ track: trackName, preset: name, pass, ...r });
			if (!args.json) {
				console.log(
					`${pass ? 'pass' : 'FAIL'} ${trackName.padEnd(8)} ${name.padEnd(16)} lap ${r.completed ? `${r.lapTime.toFixed(1)} s` : `${Math.round(r.progress * 100)}% done`} | top ${r.topSpeed.toFixed(0)} km/h | upright ${r.minUp.toFixed(2)} | ${r.maxOffCenter.toFixed(1)} m off centre | ${r.airtime.toFixed(1)} s airborne | bumps ${r.bumpPeakG.toFixed(1)} g${pass ? '' : ` | worst at ${r.worstAt} m${r.stoppedAt !== null ? `, stopped at ${r.stoppedAt} m` : ''}`}`,
				);
			}
		}
	}
	const failed = rows.filter((r) => !r.pass).length;
	if (args.json) console.log(JSON.stringify(rows, null, 2));
	else console.log(`${rows.length - failed}/${rows.length} laps pass`);
	process.exit(failed ? 1 : 0);
}
