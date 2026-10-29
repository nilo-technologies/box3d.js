// Measures vehicle presets in Node and checks them against target ranges for their archetype,
// drivetrain and realism level. Runs against the built dist/, like test/smoke.mjs.
//
//   node examples/scripts/vehicle-metrics.mjs --preset rally-50-awd
//   node examples/scripts/vehicle-metrics.mjs --car super            all 15 supercar presets
//   node examples/scripts/vehicle-metrics.mjs --all                  all 45 matrix presets
//   node examples/scripts/vehicle-metrics.mjs --file my-car.mjs      a preset module (see below)
//   add --json for machine readable output, --quick to skip the top speed run, and --perturb
//   to rerun each car with the mass 3% and the tire grip 2% off each way
//
// A --file module exports `preset` ({ title, halfExtents, apply(def) }, the same shape as the
// entries in examples/src/vehicle-presets.js) and `target`
// ({ archetype: 'sports' | 'rally' | 'super' | 'hatch', realism: 100 | 75 | 50 | 25 | 0,
// drive: 'fwd' | 'rwd' | 'awd' }).
//
// Every test runs on flat ground with the default shape friction (0.6, the tire reference).
// Exits with 1 when any check fails.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const { default: Box3D } = await import(new URL('dist/box3d.mjs', root).href);
const presetsModule = await import(
	new URL('examples/src/vehicle-presets.js', root).href
);
const { vehiclePresets, realismLevels } = presetsModule;

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

// Ranges at 100% realism, from published figures for real cars of each class.
// zeroTo100 (s) per drivetrain, topSpeed (km/h), braking 100-0 (m), lateralG (g at 70 km/h).
export const archetypes = {
	sports: {
		title: 'front engine sports coupe (Cayman GTS, M2 class)',
		zeroTo100: { fwd: [5.0, 6.8], rwd: [4.2, 5.4], awd: [3.8, 5.0] },
		topSpeed: [245, 290],
		braking: [32, 40],
		lateralG: [0.95, 1.15],
		stepRoll: [1.4, 4],
	},
	rally: {
		title: 'Rally2 hatch on gravel tires, measured on tarmac',
		zeroTo100: { fwd: [5.0, 7.0], rwd: [4.3, 6.0], awd: [3.8, 5.2] },
		topSpeed: [180, 215],
		braking: [36, 46],
		lateralG: [0.85, 1.05],
		stepRoll: [1.8, 6],
	},
	super: {
		title: 'mid engine supercar (720S, Huracan class)',
		// No mid engine car is front wheel drive. Its FWD range comes from the front axle carrying
		// about 40% of the weight: roughly half the RWD car's traction.
		zeroTo100: { fwd: [5.0, 8.0], rwd: [2.9, 4.0], awd: [2.7, 3.5] },
		topSpeed: [300, 350],
		braking: [28, 35],
		lateralG: [1.1, 1.4],
		stepRoll: [0.7, 3],
	},
	hatch: {
		title: 'hot hatch (Golf GTI, Civic Type R class)',
		zeroTo100: { fwd: [5.6, 7.2], rwd: [5.4, 7.0], awd: [4.8, 6.2] },
		topSpeed: [235, 275],
		braking: [33, 40],
		lateralG: [0.9, 1.08],
		stepRoll: [1.4, 5],
	},
};

// How each realism level moves the targets. Grip scales braking and lateral g; the stability
// rules say what a level must or must not do in the step steer and side tests.
// How each realism level moves the targets. Grip scales braking and lateral g. Roll scales the
// archetype's step steer roll range: a realistic car must roll, an arcade car hardly at all.
// The rest says what a level must or must not do in the step steer and self righting tests.
export const realismTargets = {
	100: { grip: 1.0, roll: [1, 1], maySpin: true, mustRight: false, mustNotRight: true },
	75: { grip: 1.1, roll: [0.6, 0.85], maySpin: true, mustRight: false, mustNotRight: false },
	50: { grip: 1.2, roll: [0, 0.65], maySpin: false, mustRight: true, mustNotRight: false },
	25: { grip: 1.32, roll: [0, 0.45], maySpin: false, mustRight: true, mustNotRight: false },
	0: { grip: 1.45, roll: [0, 0.3], maySpin: false, mustRight: true, mustNotRight: false },
};

// The archetype 0-100 figures are launch control runs. The test is a flat out launch, so a two
// wheel drive car loses time either to wheelspin (no traction control) or to traction control,
// which caps the engine at the tire's peak before the engine's own inertia and friction take
// their share, so the tire runs well under its peak. AWD cars are not traction limited.
const TWO_WHEEL_LAUNCH_SLACK = 0.6;

export function targetRanges({ archetype, realism, drive }) {
	const a = archetypes[archetype];
	const r = realismTargets[realism];
	const arcade = 1 - realism / 100;
	const [z0, z1] = a.zeroTo100[drive];
	return {
		// More grip and traction control can only help the launch
		zeroTo100: [z0 * (1 - 0.2 * arcade), z1 + (drive === 'awd' ? 0 : TWO_WHEEL_LAUNCH_SLACK)],
		// Downforce loads the tires and adds rolling resistance
		topSpeed: [a.topSpeed[0] * (1 - 0.05 * arcade), a.topSpeed[1]],
		braking: [a.braking[0] / r.grip / 1.05, a.braking[1] / r.grip],
		lateralG: [a.lateralG[0] * r.grip, a.lateralG[1] * r.grip * 1.08],
		stepRoll: [a.stepRoll[0] * r.roll[0], a.stepRoll[1] * r.roll[1]],
		handbrakeYaw: [45, 360],
		handbrakeRate: [60, 400],
		rideHeight: [0.3, 1.2],
		...r,
	};
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const b3 = await Box3D();
const dt = 1 / 60;
const kmh = 3.6;
const toDeg = 180 / Math.PI;
const GROUND = 2000;

const pos = [0, 0, 0];
const rot = [0, 0, 0, 1];
const vel = [0, 0, 0];
const ang = [0, 0, 0];
const buf = b3.createVehicleStateBuffer();
const state = b3.createVehicleStateRecord();

function readState(vehicle) {
	b3.getVehicleStateData(buf, vehicle);
	b3.getVehicleStateAt(state, buf);
	return state;
}

function axisAngle(axis, angle) {
	const s = Math.sin(angle / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

function createWorld() {
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [0, -9.81, 0];
	const world = b3.b3CreateWorld(worldDef);
	const groundDef = b3.b3DefaultBodyDef();
	groundDef.position = [0, -1, 0];
	const ground = b3.b3CreateBody(world, groundDef);
	b3.b3CreateBoxShape(ground, b3.b3DefaultShapeDef(), GROUND, 1, GROUND);
	return world;
}

function createCar(world, preset, position, rotation = [0, 0, 0, 1]) {
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = position;
	bodyDef.rotation = rotation;
	const chassis = b3.b3CreateBody(world, bodyDef);
	const [hx, hy, hz] = preset.halfExtents;
	b3.b3CreateBoxShape(chassis, b3.b3DefaultShapeDef(), hx, hy, hz);
	const def = preset.apply(b3.b3DefaultVehicleDef());
	def.chassisId = chassis;
	const vehicle = b3.b3CreateVehicle(world, def);
	return { world, vehicle, chassis, def };
}

// Chassis pose helpers. The car's forward is +z and up is +y in chassis space.
function pose(chassis) {
	b3.b3Body_GetTransform(pos, rot, chassis);
	const [x, y, z, w] = rot;
	const forward = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
	const upY = 1 - 2 * (x * x + z * z);
	const rightY = 2 * (x * y + w * z);
	return {
		position: [...pos],
		yaw: Math.atan2(forward[0], forward[2]),
		forward,
		upright: upY,
		roll: Math.asin(Math.max(-1, Math.min(1, rightY))) * toDeg,
	};
}

function sideslip(chassis) {
	const p = pose(chassis);
	b3.b3Body_GetLinearVelocity(vel, chassis);
	const speed = Math.hypot(vel[0], vel[2]);
	if (speed < 2) return 0;
	const heading = Math.atan2(vel[0], vel[2]);
	let d = heading - p.yaw;
	while (d > Math.PI) d -= 2 * Math.PI;
	while (d < -Math.PI) d += 2 * Math.PI;
	return Math.abs(d) * toDeg;
}

const input = (forward = 0, brake = 0, steer = 0, handbrake = 0) => ({
	forward,
	brake,
	steer,
	handbrake,
});

function step(car, count = 1) {
	for (let i = 0; i < count; i++) {
		b3.b3World_Step(car.world, dt, 4);
		// Wrap the car back along z so long runs stay on the ground box
		b3.b3Body_GetTransform(pos, rot, car.chassis);
		if (pos[2] > GROUND - 200) {
			b3.b3Body_SetTransform(car.chassis, [pos[0], pos[1], pos[2] - 2 * (GROUND - 300)], [...rot]);
		}
	}
}

function spawn(preset, rotation, height = 1.4) {
	const world = createWorld();
	return createCar(world, preset, [0, height, -(GROUND - 300)], rotation);
}

// Settles, then hands the car to the test
function settled(preset) {
	const car = spawn(preset);
	step(car, 120);
	return car;
}

// Throttle toward a target speed, with the brake when well over it
function holdSpeed(car, target, steer = 0) {
	const speed = readState(car.vehicle).speed;
	const error = target - speed;
	const forward = Math.max(0, Math.min(1, error * 0.5 + 0.25));
	const brake = error < -2 ? Math.min(1, -error * 0.2) : 0;
	return input(error < -0.5 ? 0 : forward, brake, steer);
}

function driveTo(car, target, timeout = 30) {
	let t = 0;
	while (readState(car.vehicle).speed < target && t < timeout) {
		b3.b3Vehicle_SetInput(car.vehicle, input(1));
		step(car);
		t += dt;
	}
	return t;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testSettle(preset) {
	const car = settled(preset);
	const s = readState(car.vehicle);
	b3.b3Body_GetLinearVelocity(vel, car.chassis);
	const out = {
		wheelsInContact: s.wheelsInContact,
		rideHeight: pose(car.chassis).position[1],
		settled: Math.abs(vel[1]) < 0.02,
		tractionControl: car.def.assists.tractionControl,
		abs: car.def.assists.abs,
	};
	b3.b3DestroyWorld(car.world);
	return out;
}

// 0-100 km/h, then 100-0 braking, and how far the car wandered off the line on the way
function testLaunchAndBrake(preset) {
	const car = settled(preset);
	const start = pose(car.chassis).position;
	const zeroTo100 = driveTo(car, 100 / kmh, 20);
	const reached = readState(car.vehicle).speed >= 100 / kmh;
	const drift = Math.abs(pose(car.chassis).position[0] - start[0]);
	let braking = Number.NaN;
	let brakeUpright = 1;
	if (reached) {
		// Foot off the throttle for a quarter second before the brake, as a driver does. Lifting
		// at high rpm sends an engine braking pulse into the driven wheels, and landing it on top of
		// full brake pushes them past their peak slip, where ABS cannot recover them.
		for (let i = 0; i < 15; i++) {
			b3.b3Vehicle_SetInput(car.vehicle, input(0));
			step(car);
		}
		const v0 = readState(car.vehicle).speed;
		const from = pose(car.chassis).position;
		let t = 0;
		while (readState(car.vehicle).speed > 0.3 && t < 15) {
			b3.b3Vehicle_SetInput(car.vehicle, input(0, 1));
			step(car);
			brakeUpright = Math.min(brakeUpright, pose(car.chassis).upright);
			t += dt;
		}
		const to = pose(car.chassis).position;
		// Scaled to a stop from exactly 100 km/h
		braking = Math.hypot(to[0] - from[0], to[2] - from[2]) * (100 / kmh / v0) ** 2;
	}
	b3.b3DestroyWorld(car.world);
	return {
		zeroTo100: reached ? zeroTo100 : Number.NaN,
		launchDrift: drift,
		braking,
		brakeUpright,
	};
}

function testTopSpeed(preset) {
	const car = settled(preset);
	let top = 0;
	let t = 0;
	let lastCheck = 0;
	let lastTop = 0;
	while (t < 90) {
		b3.b3Vehicle_SetInput(car.vehicle, input(1));
		step(car);
		t += dt;
		top = Math.max(top, readState(car.vehicle).speed * kmh);
		if (t - lastCheck > 4) {
			if (top - lastTop < 0.5) break;
			lastTop = top;
			lastCheck = t;
		}
	}
	const upright = pose(car.chassis).upright;
	const s = readState(car.vehicle);
	const out = {
		topSpeed: top,
		topSpeedUpright: upright,
		// Tells a drag limited car (top gear, below the limiter) from one stuck in a lower gear
		// or held by the limiter
		topGear: s.gear,
		topRpm: s.engineRpm,
		topGearCount: car.def.transmission.gearCount,
		topMaxRpm: car.def.engine.maxRpm,
	};
	b3.b3DestroyWorld(car.world);
	return out;
}

// Steady speed, steering ramped from straight to half lock over 6 s. Lateral acceleration is
// speed times yaw rate, averaged over 0.5 s, and only counts while the car is not sliding
// sideways.
function testLateral(preset, kmhTarget = 70) {
	const car = settled(preset);
	// Speed sensitive steering would cap the angle below what the tires need at the limit, so
	// this measures the tires with the full steering lock available
	const steering = b3.b3Vehicle_GetSteering(car.vehicle);
	steering.speedReference = 0;
	b3.b3Vehicle_SetSteering(car.vehicle, steering);
	const target = kmhTarget / kmh;
	let t = 0;
	while (readState(car.vehicle).speed < target && t < 20) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target));
		step(car);
		t += dt;
	}
	for (let i = 0; i < 60; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target));
		step(car);
	}
	const window = [];
	let peak = 0;
	const frames = 6 / dt;
	for (let i = 0; i < frames; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target, (0.5 * i) / frames));
		step(car);
		b3.b3Body_GetLinearVelocity(vel, car.chassis);
		b3.b3Body_GetAngularVelocity(ang, car.chassis);
		const g = (Math.hypot(vel[0], vel[2]) * Math.abs(ang[1])) / 9.81;
		window.push(sideslip(car.chassis) < 12 ? g : 0);
		if (window.length > 30) window.shift();
		if (window.length === 30) {
			peak = Math.max(peak, window.reduce((a, b) => a + b, 0) / 30);
		}
	}
	b3.b3DestroyWorld(car.world);
	return { lateralG: peak };
}

// 120 km/h, then the keyboard player's move: full steer with the throttle held for 3 s
function testStepSteer(preset) {
	const car = settled(preset);
	const target = 120 / kmh;
	let t = 0;
	while (readState(car.vehicle).speed < target && t < 25) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target));
		step(car);
		t += dt;
	}
	const reached = readState(car.vehicle).speed >= target * 0.97;
	for (let i = 0; i < 60; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target));
		step(car);
	}
	let roll = 0;
	let slip = 0;
	let minUp = 1;
	const yaw0 = pose(car.chassis).yaw;
	let yaw = 0;
	let prevYaw = yaw0;
	for (let i = 0; i < 180; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, input(1, 0, 1));
		step(car);
		const p = pose(car.chassis);
		roll = Math.max(roll, Math.abs(p.roll));
		minUp = Math.min(minUp, p.upright);
		slip = Math.max(slip, sideslip(car.chassis));
		let d = p.yaw - prevYaw;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		yaw += d;
		prevYaw = p.yaw;
	}
	b3.b3DestroyWorld(car.world);
	return {
		stepReached: reached,
		stepRoll: roll,
		stepSideslip: slip,
		stepYaw: Math.abs(yaw) * toDeg,
		spun: slip > 35,
		flipped: minUp < 0.5,
	};
}

// 60 km/h, full steer and a 0.8 s handbrake pull: the heading change after 1.5 s and the peak
// yaw rate, which is how readily the car rotates
function testHandbrake(preset) {
	const car = settled(preset);
	const target = 60 / kmh;
	let t = 0;
	while (readState(car.vehicle).speed < target && t < 20) {
		b3.b3Vehicle_SetInput(car.vehicle, holdSpeed(car, target));
		step(car);
		t += dt;
	}
	const yaw0 = pose(car.chassis).yaw;
	let prev = yaw0;
	let yaw = 0;
	let minUp = 1;
	let peakRate = 0;
	for (let i = 0; i < 90; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, input(0, 0, 1, i < 48 ? 1 : 0));
		step(car);
		peakRate = Math.max(peakRate, Math.abs(b3.b3Body_GetAngularVelocity(ang, car.chassis)[1]));
		const p = pose(car.chassis);
		let d = p.yaw - prev;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		yaw += d;
		prev = p.yaw;
		minUp = Math.min(minUp, p.upright);
	}
	b3.b3DestroyWorld(car.world);
	return {
		handbrakeYaw: Math.abs(yaw) * toDeg,
		handbrakeRate: peakRate * toDeg,
		handbrakeUpright: minUp,
	};
}

// Dropped on its side, then on its roof, with no input: is it back on its wheels after 6 s?
// The chassis is one box with no cabin, so a car with a low center of mass usually tips back
// off its side by itself. The roof is the real test of the self righting assist.
function testSelfRight(preset) {
	const result = {};
	for (const [key, angle, height] of [
		['side', Math.PI / 2, preset.halfExtents[0] + 0.05],
		// Tilted 6 degrees: a dead level roof leaves the righting direction undecided
		['roof', Math.PI - 0.1, preset.halfExtents[1] + 0.15],
	]) {
		const car = spawn(preset, axisAngle([0, 0, 1], angle), height);
		step(car, 360);
		result[`${key}Upright`] = pose(car.chassis).upright;
		b3.b3DestroyWorld(car.world);
	}
	result.sideRighted = result.sideUpright > 0.8;
	result.roofRighted = result.roofUpright > 0.8;
	return result;
}

// 15 s flat out over rolling bumps (up to 0.35 m) with the steering weaving: the state must stay
// finite, and a car at 50% realism or below must stay on its wheels
function testRough(preset) {
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [0, -9.81, 0];
	const world = b3.b3CreateWorld(worldDef);
	const count = 161;
	const cell = 2;
	const half = ((count - 1) * cell) / 2;
	const heights = [];
	for (let iz = 0; iz < count; iz++) {
		for (let ix = 0; ix < count; ix++) {
			const x = ix * cell;
			const z = iz * cell;
			heights.push(0.2 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 0.15 * Math.sin(z * 0.9 + x * 0.2));
		}
	}
	const field = b3.b3CreateHeightField(heights, count, count, [cell, 1, cell]);
	const groundDef = b3.b3DefaultBodyDef();
	groundDef.position = [-half, 0, -half];
	b3.b3CreateHeightFieldShape(b3.b3CreateBody(world, groundDef), b3.b3DefaultShapeDef(), field);
	const car = createCar(world, preset, [0, 1.6, -half + 30]);
	step(car, 60);
	let minUp = 1;
	let finite = true;
	let maxSpeed = 0;
	for (let i = 0; i < 900; i++) {
		b3.b3Vehicle_SetInput(car.vehicle, input(1, 0, 0.6 * Math.sin(i * 0.02)));
		step(car);
		const p = pose(car.chassis);
		const s = readState(car.vehicle);
		finite &&= [...p.position, p.upright, s.speed, s.engineRpm].every(Number.isFinite);
		minUp = Math.min(minUp, p.upright);
		maxSpeed = Math.max(maxSpeed, s.speed * kmh);
		if (Math.abs(p.position[0]) > half - 20 || Math.abs(p.position[2]) > half - 20) break;
	}
	b3.b3DestroyWorld(world);
	return { roughFinite: finite, roughUpright: minUp, roughSpeed: maxSpeed };
}

export function measure(preset, { quick = false } = {}) {
	return {
		...testSettle(preset),
		...testLaunchAndBrake(preset),
		...(quick ? { topSpeed: Number.NaN, topSpeedUpright: 1 } : testTopSpeed(preset)),
		...testLateral(preset),
		...testStepSteer(preset),
		...testHandbrake(preset),
		...testSelfRight(preset),
		...testRough(preset),
	};
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function check(m, target, { quick = false } = {}) {
	const t = targetRanges(target);
	const checks = [];
	const range = (key, unit, digits = 2) => {
		const [lo, hi] = t[key];
		const v = m[key];
		checks.push({
			name: key,
			pass: Number.isFinite(v) && v >= lo && v <= hi,
			detail: `${Number.isFinite(v) ? v.toFixed(digits) : 'n/a'} ${unit} (want ${lo.toFixed(digits)}-${hi.toFixed(digits)})`,
		});
	};
	const rule = (name, pass, detail) => checks.push({ name, pass, detail });

	rule('settles', m.wheelsInContact === 4 && m.settled, `${m.wheelsInContact} wheels down`);
	range('rideHeight', 'm');
	range('zeroTo100', 's');
	rule('drivesStraight', m.launchDrift < 2, `${m.launchDrift.toFixed(2)} m off line`);
	range('braking', 'm', 1);
	rule('brakesUpright', m.brakeUpright > 0.95, `upright ${m.brakeUpright.toFixed(2)}`);
	if (!quick) {
		range('topSpeed', 'km/h', 0);
		const t = checks[checks.length - 1];
		t.detail += ` in gear ${m.topGear}/${m.topGearCount} at ${m.topRpm.toFixed(0)} rpm (limiter ${m.topMaxRpm})`;
	}
	range('lateralG', 'g');
	rule('stepReached', m.stepReached, 'reaches 120 km/h');
	range('stepRoll', 'deg', 1);
	rule('noFlip', !m.flipped, m.flipped ? 'flipped in the step steer' : 'stays on its wheels');
	if (!t.maySpin) {
		rule('noSpin', !m.spun, `peak sideslip ${m.stepSideslip.toFixed(0)} deg (want < 35)`);
	}
	range('handbrakeYaw', 'deg', 0);
	range('handbrakeRate', 'deg/s', 0);
	rule('handbrakeUpright', m.handbrakeUpright > 0.5, `upright ${m.handbrakeUpright.toFixed(2)}`);
	rule('roughFinite', m.roughFinite, 'state stays finite on rough ground');
	if (!t.maySpin) {
		rule('roughUpright', m.roughUpright > 0.5, `upright ${m.roughUpright.toFixed(2)} at worst on rough ground`);
	}
	if (t.mustRight) {
		rule('rightsFromSide', m.sideRighted, `upright ${m.sideUpright.toFixed(2)} after 6 s on its side`);
		rule('rightsFromRoof', m.roofRighted, `upright ${m.roofUpright.toFixed(2)} after 6 s on its roof`);
	}
	if (t.mustNotRight) {
		rule('staysOnRoof', !m.roofRighted, `upright ${m.roofUpright.toFixed(2)} after 6 s on its roof`);
	}
	return checks;
}

// Within one car and drivetrain, less realism must never cost grip or stability
export function checkOrdering(rows) {
	const out = [];
	const sorted = [...rows].sort((a, b) => b.target.realism - a.target.realism);
	for (let i = 1; i < sorted.length; i++) {
		const a = sorted[i - 1];
		const b = sorted[i];
		const pair = `${a.name} -> ${b.name}`;
		const m0 = a.metrics;
		const m1 = b.metrics;
		out.push({
			name: `lateralG ordering ${pair}`,
			pass: m1.lateralG >= m0.lateralG * 0.98,
			detail: `${m0.lateralG.toFixed(2)} -> ${m1.lateralG.toFixed(2)} g`,
		});
		out.push({
			name: `braking ordering ${pair}`,
			pass: m1.braking <= m0.braking * 1.02,
			detail: `${m0.braking.toFixed(1)} -> ${m1.braking.toFixed(1)} m`,
		});
		out.push({
			name: `handbrake ordering ${pair}`,
			pass: m1.handbrakeRate >= m0.handbrakeRate * 0.95,
			detail: `${m0.handbrakeRate.toFixed(0)} -> ${m1.handbrakeRate.toFixed(0)} deg/s`,
		});
		out.push({
			name: `roll ordering ${pair}`,
			pass: m1.stepRoll <= m0.stepRoll * 1.05 + 0.1,
			detail: `${m0.stepRoll.toFixed(1)} -> ${m1.stepRoll.toFixed(1)} deg`,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = { presets: [], json: false, quick: false, perturb: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--preset') args.presets.push(argv[++i]);
		else if (a === '--car') args.car = argv[++i];
		else if (a === '--all') args.all = true;
		else if (a === '--file') args.file = argv[++i];
		else if (a === '--json') args.json = true;
		else if (a === '--quick') args.quick = true;
		else if (a === '--perturb') args.perturb = true;
		else throw new Error(`unknown argument ${a}`);
	}
	return args;
}

const isMain =
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const jobs = [];
	for (const [name, preset] of Object.entries(vehiclePresets)) {
		if (!preset.matrix) continue;
		const { car, realism, drive } = preset.matrix;
		if (args.all || args.car === car || args.presets.includes(name)) {
			jobs.push({ name, preset, target: { archetype: car, realism, drive } });
		}
	}
	for (const name of args.presets) {
		if (!vehiclePresets[name]?.matrix) throw new Error(`no matrix preset ${name}`);
	}
	if (args.file) {
		const mod = await import(pathToFileURL(path.resolve(args.file)).href);
		const target = mod.target;
		if (!mod.preset || !target || !archetypes[target.archetype] || !(target.realism in realismLevels) || !['fwd', 'rwd', 'awd'].includes(target.drive)) {
			throw new Error('--file needs `preset` and `target` exports, see the header of this script');
		}
		jobs.push({ name: path.basename(args.file), preset: mod.preset, target });
	}
	if (jobs.length === 0) {
		console.error('usage: vehicle-metrics.mjs --preset <name> | --car <sports|rally|super> | --all | --file <module> [--json] [--quick] [--perturb]');
		process.exit(2);
	}

	// --perturb: every job again with the mass 3% off and the tire grip 2% off each way, so a
	// preset that only just passes shows up. ABS lockups and spins are threshold effects.
	if (args.perturb) {
		const frictionKeys = ['longitudinalPeakFriction', 'longitudinalSlideFriction', 'lateralPeakFriction', 'lateralSlideFriction'];
		const variants = [
			['mass-3%', (d) => { d.chassis.mass *= 0.97; }],
			['mass+3%', (d) => { d.chassis.mass *= 1.03; }],
			['grip-2%', (d) => { for (let i = 0; i < d.wheelCount; i++) for (const k of frictionKeys) d.wheels[i].tire[k] *= 0.98; }],
			['grip+2%', (d) => { for (let i = 0; i < d.wheelCount; i++) for (const k of frictionKeys) d.wheels[i].tire[k] *= 1.02; }],
		];
		for (const job of [...jobs]) {
			for (const [label, edit] of variants) {
				jobs.push({
					...job,
					name: `${job.name} ${label}`,
					perturbed: true,
					preset: { ...job.preset, matrix: undefined, apply: (d) => { job.preset.apply(d); edit(d); return d; } },
				});
			}
		}
	}

	const rows = [];
	for (const job of jobs) {
		const metrics = measure(job.preset, args);
		const checks = check(metrics, job.target, args);
		rows.push({ ...job, metrics, checks });
		if (!args.json) {
			const failed = checks.filter((c) => !c.pass);
			const m = metrics;
			console.log(
				`${failed.length ? 'FAIL' : 'pass'} ${job.name.padEnd(24)} 0-100 ${m.zeroTo100.toFixed(2)} s | top ${args.quick ? 'skipped' : `${m.topSpeed.toFixed(0)} (gear ${m.topGear}, ${m.topRpm.toFixed(0)} rpm)`} | brake ${m.braking.toFixed(1)} m | lat ${m.lateralG.toFixed(2)} g | step roll ${m.stepRoll.toFixed(1)} slip ${m.stepSideslip.toFixed(0)} yaw ${m.stepYaw.toFixed(0)}${m.flipped ? ' FLIP' : ''} | hb ${m.handbrakeYaw.toFixed(0)} deg ${m.handbrakeRate.toFixed(0)} deg/s | side ${m.sideRighted ? 'rights' : 'stays'} roof ${m.roofRighted ? 'rights' : 'stays'} | rough ${m.roughUpright.toFixed(2)} | ride ${m.rideHeight.toFixed(2)}`,
			);
			for (const c of failed) console.log(`       x ${c.name}: ${c.detail}`);
		}
	}

	// Realism ordering inside each car and drivetrain group
	const groups = new Map();
	for (const row of rows) {
		if (!row.preset.matrix) continue;
		const key = `${row.target.archetype}-${row.target.drive}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}
	const ordering = [];
	for (const group of groups.values()) {
		if (group.length > 1) ordering.push(...checkOrdering(group));
	}
	const orderingFailed = ordering.filter((c) => !c.pass);
	if (!args.json && ordering.length) {
		console.log(`realism ordering: ${ordering.length - orderingFailed.length}/${ordering.length} pass`);
		for (const c of orderingFailed) console.log(`       x ${c.name}: ${c.detail}`);
	}

	const total = rows.reduce((n, r) => n + r.checks.length, 0) + ordering.length;
	const failed = rows.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0) + orderingFailed.length;
	if (args.json) {
		console.log(
			JSON.stringify(
				{
					passed: total - failed,
					total,
					presets: rows.map((r) => ({
						name: r.name,
						target: r.target,
						metrics: r.metrics,
						checks: r.checks,
					})),
					ordering,
				},
				null,
				2,
			),
		);
	} else {
		console.log(`${total - failed}/${total} checks pass, ${rows.filter((r) => r.checks.every((c) => c.pass)).length}/${rows.length} presets clean`);
	}
	process.exit(failed ? 1 : 0);
}
