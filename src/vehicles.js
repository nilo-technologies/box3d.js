// Vehicle presets for box3d.js: the four original cars and a 45 car matrix (sports, rally,
// super x realism 100/75/50/25/0 x fwd/rwd/awd), built in layers: car, then drivetrain, then
// realism level, then an optional turbo. Each preset tunes a b3DefaultVehicleDef() in place.
//
//   import { createPresetVehicleDef, vehiclePresets } from 'box3d.js/vehicles';
//   const [hx, hy, hz] = vehiclePresets['rally-50-awd'].halfExtents; // chassis box
//   const def = createPresetVehicleDef(b3, 'rally-50-awd');
//   def.chassisId = chassis;
//   const vehicle = b3.b3CreateVehicle(worldId, def);
//
// Plain JS so Node can import it without a TypeScript step; types live in vehicles.d.ts.
// Shipped as dist/vehicles.mjs, and used by the examples, test/smoke.mjs and the vehicle scripts.

const deg = (degrees) => (degrees * Math.PI) / 180;

function setWheels(def, positions, edit) {
	def.wheelCount = positions.length;
	for (let i = 0; i < positions.length; i++) {
		const wheel = def.wheels[i];
		wheel.position = positions[i];
		edit(wheel, i < 2, i);
	}
}

function setGears(def, ratios) {
	for (let i = 0; i < def.transmission.gearRatios.length; i++) {
		def.transmission.gearRatios[i] = ratios[i] ?? 0;
	}
	def.transmission.gearCount = ratios.length;
}

function setDifferentials(def, differentials) {
	for (let i = 0; i < def.drivetrain.differentials.length; i++) {
		def.drivetrain.differentials[i] = differentials[i] ?? {
			leftWheel: -1,
			rightWheel: -1,
			torqueRatio: 0,
			leftRightSplit: 0.5,
			limitedSlipRatio: 1,
		};
	}
	def.drivetrain.differentialCount = differentials.length;
}

function setAntiRoll(def, front, rear) {
	const bars = def.antiRoll.bars;
	bars[0] = { leftWheel: 0, rightWheel: 1, stiffness: front };
	bars[1] = { leftWheel: 2, rightWheel: 3, stiffness: rear };
	for (let i = 2; i < bars.length; i++) {
		bars[i] = { leftWheel: -1, rightWheel: -1, stiffness: 0 };
	}
	def.antiRoll.barCount = 2;
}

const axle = (left, right, torqueRatio, limitedSlipRatio) => ({
	leftWheel: left,
	rightWheel: right,
	torqueRatio,
	leftRightSplit: 0.5,
	limitedSlipRatio,
});

function fwd(def) {
	def.chassis.mass = 1150;
	setWheels(
		def,
		[
			[0.78, -0.05, 1.25],
			[-0.78, -0.05, 1.25],
			[0.78, -0.05, -1.2],
			[-0.78, -0.05, -1.2],
		],
		(wheel, front) => {
			wheel.radius = 0.31;
			wheel.width = 0.2;
			wheel.inertia = 0.9;
			wheel.maxBrakeTorque = front ? 2200 : 900;
			wheel.maxHandBrakeTorque = front ? 0 : 2500;
			wheel.suspension.frequency = front ? 1.9 : 2.1;
		},
	);
	def.engine.maxTorque = 270;
	def.engine.peakTorqueRpm = 4200;
	def.engine.maxRpm = 6600;
	setGears(def, [3.5, 2.05, 1.45, 1.1, 0.88]);
	def.transmission.finalDrive = 4.1;
	def.transmission.shiftUpRpm = 6000;
	setDifferentials(def, [axle(0, 1, 1, 1)]);
	setAntiRoll(def, 24000, 10000);
	def.steering.maxAngle = deg(36);
	def.assists.tractionControl = true;
	def.assists.abs = true;
	return def;
}

function rwd(def) {
	def.chassis.mass = 1350;
	setWheels(
		def,
		[
			[0.84, -0.02, 1.35],
			[-0.84, -0.02, 1.35],
			[0.84, -0.02, -1.3],
			[-0.84, -0.02, -1.3],
		],
		(wheel, front) => {
			wheel.radius = 0.33;
			wheel.width = front ? 0.23 : 0.26;
			wheel.maxBrakeTorque = front ? 2400 : 1300;
			wheel.maxHandBrakeTorque = front ? 0 : 3500;
			wheel.suspension.minLength = 0.17;
			wheel.suspension.maxLength = 0.32;
			wheel.suspension.frequency = front ? 2.2 : 2.4;
		},
	);
	def.engine.maxTorque = 420;
	def.engine.peakTorqueRpm = 5200;
	def.engine.maxRpm = 7200;
	def.transmission.shiftUpRpm = 6200;
	def.transmission.shiftDownRpm = 3000;
	setDifferentials(def, [axle(2, 3, 1, 1.4)]);
	setAntiRoll(def, 20000, 26000);
	def.assists.driftGripScale = 0.5;
	def.assists.counterSteer = 0.4;
	def.assists.tractionControl = true;
	def.assists.abs = false;
	return def;
}

function awd(def) {
	def.chassis.mass = 1500;
	setWheels(
		def,
		[
			[0.84, -0.05, 1.32],
			[-0.84, -0.05, 1.32],
			[0.84, -0.05, -1.3],
			[-0.84, -0.05, -1.3],
		],
		(wheel, front) => {
			wheel.radius = 0.34;
			wheel.width = 0.24;
			wheel.maxBrakeTorque = front ? 2500 : 1500;
			wheel.maxHandBrakeTorque = front ? 0 : 3000;
		},
	);
	def.engine.maxTorque = 450;
	def.engine.peakTorqueRpm = 4800;
	setDifferentials(def, [axle(0, 1, 0.4, 1), axle(2, 3, 0.6, 1.2)]);
	def.drivetrain.centerLimitedSlipRatio = 1.3;
	setAntiRoll(def, 24000, 18000);
	def.assists.tractionControl = true;
	def.assists.abs = true;
	return def;
}

function offroad(def) {
	def.chassis.mass = 1900;
	setWheels(
		def,
		[
			[0.95, -0.1, 1.45],
			[-0.95, -0.1, 1.45],
			[0.95, -0.1, -1.4],
			[-0.95, -0.1, -1.4],
		],
		(wheel, front) => {
			wheel.radius = 0.42;
			wheel.width = 0.3;
			wheel.inertia = 2.2;
			wheel.maxBrakeTorque = front ? 3000 : 2000;
			wheel.maxHandBrakeTorque = front ? 0 : 3500;
			wheel.suspension.minLength = 0.15;
			wheel.suspension.maxLength = 0.5;
			wheel.suspension.frequency = 1.2;
			wheel.suspension.compressionDamping = 0.45;
			wheel.suspension.reboundDamping = 0.7;
			wheel.tire.longitudinalPeakSlip = 0.2;
			wheel.tire.longitudinalPeakFriction = 1.15;
			wheel.tire.longitudinalSlideSlip = 0.6;
			wheel.tire.longitudinalSlideFriction = 1.0;
			wheel.tire.lateralPeakAngle = deg(12);
			wheel.tire.lateralPeakFriction = 1.1;
			wheel.tire.lateralSlideAngle = deg(30);
			wheel.tire.lateralSlideFriction = 0.95;
			wheel.tire.rollingResistance = 0.025;
		},
	);
	def.engine.maxTorque = 550;
	def.engine.peakTorqueRpm = 3000;
	def.engine.idleRpm = 800;
	def.engine.maxRpm = 5000;
	def.engine.inertia = 0.45;
	setGears(def, [4.0, 2.4, 1.6, 1.15, 0.8]);
	def.transmission.reverseRatio = 3.8;
	def.transmission.finalDrive = 4.3;
	def.transmission.shiftUpRpm = 4500;
	def.transmission.shiftDownRpm = 2000;
	setDifferentials(def, [axle(0, 1, 0.5, 1.3), axle(2, 3, 0.5, 1.3)]);
	def.drivetrain.centerLimitedSlipRatio = 1.3;
	setAntiRoll(def, 10000, 5000);
	def.steering.maxAngle = deg(34);
	def.assists.rollInfluence = 0.35;
	def.assists.selfRighting = 4;
	def.assists.airControl = 1.5;
	def.assists.downforce = 0.5;
	return def;
}

// ---------------------------------------------------------------------------
// Preset matrix: 3 cars x 5 realism levels x 3 drivetrains.
//
// A preset is built in three layers on top of b3DefaultVehicleDef():
//   1. the car: body, wheels, suspension, real tires, engine, gearbox, brakes, aero. This is
//      the car as it would be at 100% realism, with no driving assists beyond its own.
//   2. the drivetrain layer: which wheels are driven, the differentials, and the anti-roll
//      balance that suits the layout.
//   3. the realism level: grip multipliers, arcade assists and stability aids. Every level is
//      an explicit table, so a value can be read straight off without interpolating.
// The tire coefficients are relative to the default shape friction of 0.6, which is the
// engine's tire reference (B3_VEHICLE_REFERENCE_FRICTION), so default ground scales them by 1.
// ---------------------------------------------------------------------------

function setTire(wheel, tire) {
	wheel.tire.longitudinalPeakSlip = tire.peakSlip;
	wheel.tire.longitudinalPeakFriction = tire.longPeak;
	wheel.tire.longitudinalSlideSlip = tire.slideSlip;
	wheel.tire.longitudinalSlideFriction = tire.longSlide;
	wheel.tire.lateralPeakAngle = deg(tire.latPeakAngle);
	wheel.tire.lateralPeakFriction = tire.latPeak;
	wheel.tire.lateralSlideAngle = deg(tire.latSlideAngle);
	wheel.tire.lateralSlideFriction = tire.latSlide;
	wheel.tire.rollingResistance = tire.rolling;
}

// Shared by every car: geometry, suspension and tire per axle, then the rest of the car
function applyCar(def, car) {
	def.chassis.mass = car.mass;
	def.chassis.autoCenterOfMass = true;
	def.chassis.centerOfMassOffset = [0, car.comHeight, car.comForward];
	const [halfTrack, wheelY, frontZ, rearZ] = car.layout;
	setWheels(
		def,
		[
			[halfTrack, wheelY, frontZ],
			[-halfTrack, wheelY, frontZ],
			[halfTrack, wheelY, rearZ],
			[-halfTrack, wheelY, rearZ],
		],
		(wheel, front) => {
			const axleSettings = front ? car.front : car.rear;
			wheel.radius = car.wheelRadius;
			wheel.width = axleSettings.width;
			wheel.inertia = car.wheelInertia;
			wheel.steerFactor = front ? 1 : 0;
			wheel.maxBrakeTorque = axleSettings.brake;
			wheel.maxHandBrakeTorque = front ? 0 : car.handbrake;
			wheel.suspension.minLength = car.suspension.minLength;
			wheel.suspension.maxLength = car.suspension.maxLength;
			wheel.suspension.frequency = axleSettings.frequency;
			wheel.suspension.compressionDamping = car.suspension.compressionDamping;
			wheel.suspension.reboundDamping = car.suspension.reboundDamping;
			setTire(wheel, car.tire);
		},
	);
	Object.assign(def.engine, car.engine);
	setGears(def, car.gears);
	def.transmission.finalDrive = car.finalDrive;
	def.transmission.shiftUpRpm = car.shiftUpRpm;
	def.transmission.shiftDownRpm = car.shiftDownRpm;
	def.transmission.shiftTime = car.shiftTime;
	setAntiRoll(def, car.antiRoll[0], car.antiRoll[1]);
	def.steering.maxAngle = deg(car.steering.maxAngle);
	def.steering.speedReference = car.steering.speedReference;
	def.steering.steerSpeed = car.steering.steerSpeed;
	def.steering.returnSpeed = car.steering.returnSpeed;
	def.assists.downforce = car.downforce;
	def.assists.drag = car.drag;
	def.assists.tractionControl = car.tractionControl;
	def.assists.abs = car.abs;
	return def;
}

/**
 * The three cars, as they would be at 100% realism. `drive` holds the per car numbers the
 * drivetrain layers read: limited slip ratios and the AWD front torque share.
 */
export const vehicleCars = {
	sports: {
		title: 'Sports car',
		blurb: 'Front engine coupe: 1400 kg, 420 N·m, road tires, six gears.',
		color: 0xff6b6b,
		halfExtents: [0.72, 0.28, 2.15],
		mass: 1400,
		comHeight: 0.12,
		comForward: 0.05,
		layout: [0.8, -0.02, 1.3, -1.25],
		wheelRadius: 0.33,
		wheelInertia: 1.0,
		// About 26% of the braking on the rear, near the ideal split at full braking. More rear brake
		// locks the inside rear when braking in a turn, and ABS does not catch it while cornering.
		front: { width: 0.245, brake: 2600, frequency: 2.0 },
		rear: { width: 0.275, brake: 900, frequency: 2.2 },
		handbrake: 2500,
		suspension: {
			minLength: 0.17,
			maxLength: 0.33,
			// Low compression damping against the rebound lets sharp bumps pass through the
			// spring instead of kicking the body, as real dampers do
			compressionDamping: 0.3,
			reboundDamping: 0.75,
		},
		tire: {
			peakSlip: 0.1,
			longPeak: 1.15,
			slideSlip: 0.4,
			longSlide: 0.95,
			latPeakAngle: 7,
			latPeak: 1.1,
			latSlideAngle: 18,
			latSlide: 0.94,
			rolling: 0.013,
		},
		engine: {
			maxTorque: 420,
			peakTorqueRpm: 5000,
			idleRpm: 850,
			maxRpm: 7200,
			inertia: 0.2,
		},
		gears: [3.6, 2.2, 1.55, 1.2, 0.98, 0.82],
		finalDrive: 3.6,
		// The engine shifts at 90% of the limiter, where racing games shift. The gearbox reads the
		// road speed, which trails the engine by the clutch slip (about 270 rpm here), so the
		// setting sits that far below 90%.
		shiftUpRpm: 6200,
		shiftDownRpm: 3200,
		shiftTime: 0.12,
		antiRoll: [16000, 13000],
		steering: {
			maxAngle: 34,
			speedReference: 11,
			steerSpeed: 4,
			returnSpeed: 6,
		},
		downforce: 0.25,
		drag: 0.4,
		tractionControl: false,
		abs: true,
		// Open at the front: a limited slip front axle pulls the car aside under wheelspin
		drive: { frontLsd: 1.0, rearLsd: 1.5, centerLsd: 1.3, awdFront: 0.4 },
	},
	rally: {
		title: 'Rally car',
		blurb:
			'Gravel spec hatch: 1230 kg, long travel, loose surface tires, hydraulic handbrake, no TC or ABS.',
		color: 0x4d96ff,
		halfExtents: [0.74, 0.34, 2.0],
		mass: 1230,
		comHeight: 0.16,
		comForward: 0.08,
		layout: [0.8, -0.05, 1.25, -1.25],
		// Tall gravel tires. The final drive, brakes and wheel inertia scale with the radius
		// (0.33 m before), so the gearing and stopping force stay the same.
		wheelRadius: 0.37,
		wheelInertia: 1.13,
		front: { width: 0.235, brake: 2580, frequency: 1.5 },
		rear: { width: 0.235, brake: 1680, frequency: 1.6 },
		handbrake: 4480,
		suspension: {
			minLength: 0.12,
			maxLength: 0.45,
			compressionDamping: 0.3,
			reboundDamping: 0.7,
		},
		tire: {
			peakSlip: 0.18,
			longPeak: 1.05,
			slideSlip: 0.6,
			longSlide: 0.92,
			latPeakAngle: 11,
			latPeak: 1.0,
			latSlideAngle: 28,
			latSlide: 0.9,
			rolling: 0.018,
		},
		engine: {
			maxTorque: 400,
			peakTorqueRpm: 4000,
			idleRpm: 1000,
			maxRpm: 7500,
			inertia: 0.12,
		},
		gears: [3.3, 2.3, 1.75, 1.4, 1.15, 0.98],
		finalDrive: 4.93,
		shiftUpRpm: 6500,
		shiftDownRpm: 3600,
		shiftTime: 0.08,
		antiRoll: [16000, 12000],
		steering: {
			maxAngle: 38,
			speedReference: 12,
			steerSpeed: 5,
			returnSpeed: 7,
		},
		downforce: 0.15,
		drag: 0.45,
		tractionControl: false,
		abs: false,
		drive: { frontLsd: 1.3, rearLsd: 1.6, centerLsd: 1.4, awdFront: 0.5 },
	},
	super: {
		title: 'Supercar',
		blurb:
			'Mid engine: 1550 kg, 720 N·m, sticky tires, seven gears and real downforce.',
		color: 0xffc94d,
		halfExtents: [0.84, 0.24, 2.3],
		mass: 1550,
		comHeight: 0.06,
		comForward: -0.25,
		layout: [0.86, 0, 1.4, -1.3],
		wheelRadius: 0.35,
		wheelInertia: 1.2,
		// About 1.15x what the front tires carry at peak grip. A much stronger brake overshoots the
		// peak slip on a full brake step, and ABS cannot release a wheel once it is past the peak.
		front: { width: 0.255, brake: 2400, frequency: 2.5 },
		rear: { width: 0.325, brake: 2200, frequency: 2.7 },
		handbrake: 2000,
		suspension: {
			minLength: 0.18,
			maxLength: 0.3,
			// Low compression damping against the rebound lets sharp bumps pass through the
			// spring instead of kicking the body, as real dampers do
			compressionDamping: 0.35,
			reboundDamping: 0.8,
		},
		tire: {
			peakSlip: 0.09,
			longPeak: 1.3,
			slideSlip: 0.35,
			longSlide: 1.0,
			latPeakAngle: 6.5,
			latPeak: 1.25,
			latSlideAngle: 16,
			latSlide: 1.0,
			rolling: 0.012,
		},
		engine: {
			maxTorque: 720,
			peakTorqueRpm: 6000,
			idleRpm: 1000,
			maxRpm: 8500,
			inertia: 0.15,
		},
		gears: [3.2, 2.3, 1.75, 1.4, 1.15, 0.95, 0.78],
		finalDrive: 3.4,
		// The engine shifts at 90% of the limiter; the clutch slips about 490 rpm here, so the
		// setting is that much lower. Near the limiter an upshift would never fire at all.
		shiftUpRpm: 7150,
		shiftDownRpm: 4200,
		shiftTime: 0.08,
		antiRoll: [30000, 26000],
		steering: {
			maxAngle: 32,
			speedReference: 13,
			steerSpeed: 4,
			returnSpeed: 6,
		},
		downforce: 0.6,
		drag: 0.38,
		tractionControl: true,
		abs: true,
		drive: { frontLsd: 1.1, rearLsd: 1.4, centerLsd: 1.25, awdFront: 0.3 },
	},
};

/**
 * Drivetrain layers. Each picks the driven wheels and differentials from the car's `drive`
 * numbers and rebalances the anti-roll bars for the layout.
 */
export const drivetrainLayers = {
	fwd: {
		title: 'FWD',
		apply(def, car) {
			setDifferentials(def, [axle(0, 1, 1, car.drive.frontLsd)]);
			// A transverse engine sits over the front axle, which also puts weight on the driven wheels
			const [x, y, z] = def.chassis.centerOfMassOffset;
			def.chassis.centerOfMassOffset = [x, y, z + 0.15];
			// A stiffer rear bar lets the rear rotate, which offsets the front drive understeer
			setAntiRoll(def, car.antiRoll[0] * 0.8, car.antiRoll[1] * 1.6);
		},
	},
	rwd: {
		title: 'RWD',
		apply(def, car) {
			setDifferentials(def, [axle(2, 3, 1, car.drive.rearLsd)]);
		},
	},
	awd: {
		title: 'AWD',
		apply(def, car) {
			const front = car.drive.awdFront;
			setDifferentials(def, [
				axle(0, 1, front, car.drive.frontLsd),
				axle(2, 3, 1 - front, car.drive.rearLsd),
			]);
			def.drivetrain.centerLimitedSlipRatio = car.drive.centerLsd;
			setAntiRoll(def, car.antiRoll[0] * 0.9, car.antiRoll[1] * 1.1);
		},
	},
};

/**
 * Realism levels, from a car as it would really drive (100) to a full arcade car (0).
 * `tireGrip` and `downforceScale` multiply the car's values; `comDrop` lowers the center of
 * mass below the car's own (m). `tractionControl` and `abs` of null keep the car's own setting.
 * The rear brakes scale with `tireGrip` too, so the brake balance stays the same share of the
 * grip at every level.
 *
 * The steering fields make the less realistic levels forgiving for a keyboard player, who only
 * ever uses full lock, full brake and full throttle. `rearGrip` and `rearPeakAngle` multiply the
 * rear tires' side grip and the slip angle where it peaks, so the rear holds on after the front
 * lets go: too much lock runs the car wide instead of spinning it. With that stability from the
 * tires, `counterSteer` can stay low (it acts in every corner, not only in slides, so a high value
 * takes lock away and the car turns less), and `speedReferenceScale` gives back the steering at
 * speed that the extra grip can use. `rollInfluence` stays low: lifting the cornering forces toward
 * the center of mass takes load off the outside rear wheel, which then locks under braking in a
 * turn and spins the car.
 */
export const realismLevels = {
	100: {
		title: '100% realistic',
		tireGrip: 1.0,
		rollInfluence: 0,
		counterSteer: 0,
		rearGrip: 1,
		rearPeakAngle: 1,
		speedReferenceScale: 1,
		driftGripScale: 1,
		downforceScale: 1,
		comDrop: 0,
		selfRighting: 0,
		airControl: 0,
		airAngularDamping: 0,
		maxTiltAngle: 0,
		tractionControl: null,
		abs: null,
	},
	75: {
		title: '75% realistic',
		tireGrip: 1.1,
		rollInfluence: 0.1,
		counterSteer: 0.15,
		rearGrip: 1.1,
		rearPeakAngle: 0.9,
		speedReferenceScale: 1.1,
		driftGripScale: 0.85,
		downforceScale: 1.5,
		comDrop: 0.05,
		selfRighting: 1,
		airControl: 0.5,
		airAngularDamping: 0.5,
		maxTiltAngle: 0,
		tractionControl: null,
		abs: null,
	},
	50: {
		title: '50% realistic',
		tireGrip: 1.2,
		rollInfluence: 0.15,
		counterSteer: 0.2,
		rearGrip: 1.15,
		rearPeakAngle: 0.8,
		speedReferenceScale: 1.3,
		driftGripScale: 0.7,
		downforceScale: 2.5,
		comDrop: 0.1,
		selfRighting: 4,
		airControl: 1.5,
		airAngularDamping: 1.5,
		maxTiltAngle: 0,
		tractionControl: true,
		abs: true,
	},
	25: {
		title: '25% realistic',
		tireGrip: 1.32,
		rollInfluence: 0.2,
		counterSteer: 0.2,
		rearGrip: 1.18,
		rearPeakAngle: 0.78,
		speedReferenceScale: 1.35,
		driftGripScale: 0.55,
		downforceScale: 4,
		comDrop: 0.17,
		selfRighting: 8,
		airControl: 2.5,
		airAngularDamping: 2.5,
		maxTiltAngle: 70,
		tractionControl: true,
		abs: true,
	},
	0: {
		title: 'Arcade',
		tireGrip: 1.45,
		rollInfluence: 0.25,
		counterSteer: 0.2,
		rearGrip: 1.2,
		rearPeakAngle: 0.75,
		speedReferenceScale: 1.4,
		driftGripScale: 0.4,
		downforceScale: 6,
		comDrop: 0.25,
		selfRighting: 10,
		airControl: 3.5,
		airAngularDamping: 3.5,
		maxTiltAngle: 55,
		tractionControl: true,
		abs: true,
	},
};

const tireFrictionKeys = [
	'longitudinalPeakFriction',
	'longitudinalSlideFriction',
	'lateralPeakFriction',
	'lateralSlideFriction',
];

function applyRealism(def, level) {
	for (let i = 0; i < def.wheelCount; i++) {
		const wheel = def.wheels[i];
		for (const key of tireFrictionKeys) wheel.tire[key] *= level.tireGrip;
		if (wheel.steerFactor === 0) {
			// Front brakes are capped by ABS at the tires' peak anyway; the rears set the balance
			wheel.maxBrakeTorque *= level.tireGrip;
			wheel.tire.lateralPeakFriction *= level.rearGrip;
			wheel.tire.lateralSlideFriction *= level.rearGrip;
			wheel.tire.lateralPeakAngle *= level.rearPeakAngle;
		}
	}
	def.steering.speedReference *= level.speedReferenceScale;
	const [x, y, z] = def.chassis.centerOfMassOffset;
	def.chassis.centerOfMassOffset = [x, y - level.comDrop, z];
	const a = def.assists;
	a.rollInfluence = level.rollInfluence;
	a.counterSteer = level.counterSteer;
	a.driftGripScale = level.driftGripScale;
	a.downforce *= level.downforceScale;
	a.selfRighting = level.selfRighting;
	a.airControl = level.airControl;
	a.airAngularDamping = level.airAngularDamping;
	a.maxTiltAngle = deg(level.maxTiltAngle);
	if (level.tractionControl !== null) a.tractionControl = level.tractionControl;
	if (level.abs !== null) a.abs = level.abs;
}

/**
 * Forced induction, an optional fourth layer. Rpm points are fractions of the engine's max rpm,
 * so a type fits any car. applyTurbo lowers the engine torque so the fully boosted peak matches
 * the car's rated torque: a turbo changes how the torque arrives, not how much there is.
 * `parasitic` is a fraction of the rated torque. `spoolTime` is the lag at full load and the full
 * boost rpm; `bleedTime` is how long the shaft takes to spin down, so a longer one keeps more
 * boost through shifts and short lifts (bigger, heavier turbos keep spinning longer).
 */
export const turboTypes = {
	none: {
		title: 'Naturally aspirated',
		blurb: 'No boost: the torque curve as it is.',
		stages: [],
	},
	small: {
		title: 'Small single turbo',
		blurb: 'Spools early with little lag, but adds the least torque.',
		stages: [
			{ gain: 0.35, spool: 0.25, full: 0.42, spoolTime: 0.35, bleedTime: 0.8 },
		],
	},
	big: {
		title: 'Big single turbo',
		blurb: 'Weak low down, a long lag, then a hard surge in the top half.',
		stages: [
			{ gain: 0.8, spool: 0.45, full: 0.68, spoolTime: 1.2, bleedTime: 1.8 },
		],
	},
	twinScroll: {
		title: 'Twin-scroll turbo',
		blurb:
			'Split exhaust pulses spool it sooner than a single turbo of the same size.',
		stages: [
			{ gain: 0.5, spool: 0.22, full: 0.4, spoolTime: 0.45, bleedTime: 1.0 },
		],
	},
	parallel: {
		title: 'Parallel twin turbo',
		blurb:
			'Two small turbos, one per bank: quick response and a strong top end.',
		stages: [
			{ gain: 0.55, spool: 0.28, full: 0.45, spoolTime: 0.4, bleedTime: 1.0 },
		],
	},
	sequential: {
		title: 'Sequential twin turbo',
		blurb:
			'A small turbo low down, then a big one takes over: two steps of boost.',
		stages: [
			{ gain: 0.3, spool: 0.18, full: 0.32, spoolTime: 0.3, bleedTime: 0.8 },
			{ gain: 0.3, spool: 0.5, full: 0.62, spoolTime: 0.8, bleedTime: 1.5 },
		],
	},
	vgt: {
		title: 'Variable geometry turbo',
		blurb: 'Vanes keep it quick down low and strong up top: one smooth climb.',
		stages: [
			{ gain: 0.3, spool: 0.15, full: 0.3, spoolTime: 0.3, bleedTime: 0.8 },
			{ gain: 0.3, spool: 0.3, full: 0.5, spoolTime: 0.7, bleedTime: 1.0 },
		],
	},
	electric: {
		title: 'Electric-assisted turbo',
		blurb: 'A big turbo with a motor that fills most of the lag.',
		stages: [
			{ gain: 0.6, spool: 0.3, full: 0.5, spoolTime: 1.0, bleedTime: 1.5 },
		],
		instantFraction: 0.6,
	},
	supercharger: {
		title: 'Supercharger',
		blurb:
			'Belt driven: no lag, boost rises with the rpm, and it costs a little torque to drive.',
		stages: [{ gain: 0.4, spool: 0.1, full: 0.6, spoolTime: 0, bleedTime: 0 }],
		instantFraction: 1,
		parasitic: 0.05,
	},
	antiLag: {
		title: 'Rally turbo with anti-lag',
		blurb: 'Keeps the boost up off throttle and through shifts.',
		stages: [
			{ gain: 0.6, spool: 0.35, full: 0.55, spoolTime: 0.8, bleedTime: 1.5 },
		],
		antiLag: true,
	},
};

const turboStage = (stage, maxRpm) =>
	stage
		? {
				gain: stage.gain,
				spoolRpm: stage.spool * maxRpm,
				fullBoostRpm: stage.full * maxRpm,
				spoolTime: stage.spoolTime,
				bleedTime: stage.bleedTime,
			}
		: { gain: 0, spoolRpm: 0, fullBoostRpm: 0, spoolTime: 0, bleedTime: 0 };

/** Summed stage gain: the engine makes 1 + this times its torque curve at full boost */
export const turboGain = (turbo) =>
	turbo.stages.reduce((sum, stage) => sum + stage.gain, 0);

/** A b3VehicleTurbo for an engine with this max rpm and rated (fully boosted) peak torque */
export function makeVehicleTurbo(type, maxRpm, ratedTorque) {
	const t = turboTypes[type];
	return {
		stages: [turboStage(t.stages[0], maxRpm), turboStage(t.stages[1], maxRpm)],
		instantFraction: t.instantFraction ?? 0,
		parasiticTorque: (t.parasitic ?? 0) * ratedTorque,
		antiLag: t.antiLag ?? false,
	};
}

const close = (a, b) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));

/**
 * The type in turboTypes this turbo was fitted from, for an engine with this max rpm and base
 * peak torque, or null for a custom turbo
 */
export function findTurboType(turbo, maxRpm, maxTorque) {
	const rated = maxTorque * (1 + turboGain(turbo));
	for (const type of Object.keys(turboTypes)) {
		const t = makeVehicleTurbo(type, maxRpm, rated);
		const same =
			turbo.stages.every((stage, i) =>
				Object.keys(stage).every((key) => close(stage[key], t.stages[i][key])),
			) &&
			close(turbo.instantFraction, t.instantFraction) &&
			close(turbo.parasiticTorque, t.parasiticTorque) &&
			turbo.antiLag === t.antiLag;
		if (same) return type;
	}
	return null;
}

/** Swaps the forced induction, keeping the engine's rated peak torque */
export function applyTurbo(def, type) {
	const rated = def.engine.maxTorque * (1 + turboGain(def.turbo));
	def.turbo = makeVehicleTurbo(type, def.engine.maxRpm, rated);
	def.engine.maxTorque = rated / (1 + turboGain(def.turbo));
	return def;
}

/** Tunes a b3DefaultVehicleDef() in place: car, then drivetrain, then realism, then turbo */
export function applyVehiclePreset(def, car, realism, drive, turbo = 'none') {
	applyCar(def, vehicleCars[car]);
	drivetrainLayers[drive].apply(def, vehicleCars[car]);
	applyRealism(def, realismLevels[realism]);
	if (turbo !== 'none') applyTurbo(def, turbo);
	return def;
}

export function buildVehiclePreset(b3, car, realism, drive, turbo = 'none') {
	return applyVehiclePreset(
		b3.b3DefaultVehicleDef(),
		car,
		realism,
		drive,
		turbo,
	);
}

export const vehiclePresetName = (car, realism, drive) =>
	`${car}-${realism}-${drive}`;

const matrixPresets = {};
for (const car of Object.keys(vehicleCars)) {
	for (const realism of Object.keys(realismLevels)) {
		for (const drive of Object.keys(drivetrainLayers)) {
			matrixPresets[vehiclePresetName(car, realism, drive)] = {
				title: `${vehicleCars[car].title}, ${drivetrainLayers[drive].title}, ${realismLevels[realism].title}`,
				halfExtents: vehicleCars[car].halfExtents,
				matrix: { car, realism: Number(realism), drive },
				apply: (def) => applyVehiclePreset(def, car, realism, drive),
			};
		}
	}
}

export const vehiclePresets = {
	fwd: { title: 'FWD hatchback', halfExtents: [0.66, 0.32, 1.95], apply: fwd },
	rwd: { title: 'RWD sports car', halfExtents: [0.7, 0.28, 2.15], apply: rwd },
	awd: { title: 'AWD road car', halfExtents: [0.7, 0.32, 2.15], apply: awd },
	offroad: {
		title: 'AWD off-roader',
		halfExtents: [0.78, 0.45, 2.3],
		apply: offroad,
	},
	...matrixPresets,
};

export function createPresetVehicleDef(b3, name) {
	return vehiclePresets[name].apply(b3.b3DefaultVehicleDef());
}
