// Vehicle presets shared by the vehicle examples and test/smoke.mjs. Plain JS so Node can
// import it without a TypeScript step; types live in vehicle-presets.d.ts.

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
		front: { width: 0.245, brake: 2600, frequency: 2.0 },
		rear: { width: 0.275, brake: 1500, frequency: 2.2 },
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
		wheelRadius: 0.33,
		wheelInertia: 0.9,
		front: { width: 0.21, brake: 2300, frequency: 1.5 },
		rear: { width: 0.21, brake: 1500, frequency: 1.6 },
		handbrake: 4000,
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
		finalDrive: 4.4,
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
 */
export const realismLevels = {
	100: {
		title: '100% realistic',
		tireGrip: 1.0,
		rollInfluence: 0,
		counterSteer: 0,
		driftGripScale: 1,
		driftAssist: 0,
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
		rollInfluence: 0.15,
		counterSteer: 0.15,
		driftGripScale: 0.85,
		driftAssist: 0,
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
		rollInfluence: 0.35,
		counterSteer: 0.3,
		driftGripScale: 0.7,
		driftAssist: 0.4,
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
		rollInfluence: 0.55,
		counterSteer: 0.5,
		driftGripScale: 0.55,
		driftAssist: 0.7,
		downforceScale: 4,
		comDrop: 0.17,
		selfRighting: 6,
		airControl: 2.5,
		airAngularDamping: 2.5,
		maxTiltAngle: 70,
		tractionControl: true,
		abs: true,
	},
	0: {
		title: 'Arcade',
		tireGrip: 1.45,
		rollInfluence: 0.75,
		counterSteer: 0.6,
		driftGripScale: 0.4,
		driftAssist: 1,
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
		const tire = def.wheels[i].tire;
		for (const key of tireFrictionKeys) tire[key] *= level.tireGrip;
	}
	const [x, y, z] = def.chassis.centerOfMassOffset;
	def.chassis.centerOfMassOffset = [x, y - level.comDrop, z];
	const a = def.assists;
	a.rollInfluence = level.rollInfluence;
	a.counterSteer = level.counterSteer;
	a.driftGripScale = level.driftGripScale;
	a.driftAssist = level.driftAssist;
	a.downforce *= level.downforceScale;
	a.selfRighting = level.selfRighting;
	a.airControl = level.airControl;
	a.airAngularDamping = level.airAngularDamping;
	a.maxTiltAngle = deg(level.maxTiltAngle);
	if (level.tractionControl !== null) a.tractionControl = level.tractionControl;
	if (level.abs !== null) a.abs = level.abs;
}

/** Tunes a b3DefaultVehicleDef() in place: car, then drivetrain, then realism */
export function applyVehiclePreset(def, car, realism, drive) {
	applyCar(def, vehicleCars[car]);
	drivetrainLayers[drive].apply(def, vehicleCars[car]);
	applyRealism(def, realismLevels[realism]);
	return def;
}

export function buildVehiclePreset(b3, car, realism, drive) {
	return applyVehiclePreset(b3.b3DefaultVehicleDef(), car, realism, drive);
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
