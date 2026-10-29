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
			[0.74, -0.05, 1.25],
			[-0.74, -0.05, 1.25],
			[0.74, -0.05, -1.2],
			[-0.74, -0.05, -1.2],
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
			[0.8, -0.02, 1.35],
			[-0.8, -0.02, 1.35],
			[0.8, -0.02, -1.3],
			[-0.8, -0.02, -1.3],
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
	def.transmission.shiftUpRpm = 6800;
	def.transmission.shiftDownRpm = 3000;
	setDifferentials(def, [axle(2, 3, 1, 1.4)]);
	setAntiRoll(def, 20000, 26000);
	def.assists.driftGripScale = 0.5;
	def.assists.counterSteer = 0.3;
	def.assists.tractionControl = false;
	def.assists.abs = false;
	return def;
}

function awd(def) {
	def.chassis.mass = 1500;
	setWheels(
		def,
		[
			[0.8, -0.05, 1.32],
			[-0.8, -0.05, 1.32],
			[0.8, -0.05, -1.3],
			[-0.8, -0.05, -1.3],
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
			[0.88, -0.1, 1.45],
			[-0.88, -0.1, 1.45],
			[0.88, -0.1, -1.4],
			[-0.88, -0.1, -1.4],
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

export const vehiclePresets = {
	fwd: { title: 'FWD hatchback', halfExtents: [0.72, 0.32, 1.95], apply: fwd },
	rwd: { title: 'RWD sports car', halfExtents: [0.82, 0.28, 2.15], apply: rwd },
	awd: { title: 'AWD road car', halfExtents: [0.82, 0.32, 2.15], apply: awd },
	offroad: {
		title: 'AWD off-roader',
		halfExtents: [0.9, 0.45, 2.3],
		apply: offroad,
	},
};

export function createPresetVehicleDef(b3, name) {
	return vehiclePresets[name].apply(b3.b3DefaultVehicleDef());
}
