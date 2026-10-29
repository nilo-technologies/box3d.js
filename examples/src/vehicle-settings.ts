// Reusable lil-gui panel for any b3Vehicle. It reads the live settings from the vehicle and
// writes every change back through the b3Vehicle_Set* setters, which apply on the next step.
// Wheels are edited per axle (consecutive wheel pairs) and angles are shown in degrees.

import type {
	Box3DModule,
	b3VehicleAntiRoll,
	b3VehicleAssists,
	b3VehicleChassis,
	b3VehicleDef,
	b3VehicleDrivetrain,
	b3VehicleEngine,
	b3VehicleId,
	b3VehicleSteering,
	b3VehicleTransmission,
	b3VehicleWheelDef,
	VehicleStateBuffer,
	VehicleStateRecord,
	VehicleWheelRecord,
} from 'box3d.js';
import type GUI from 'lil-gui';

export type VehicleSettings = {
	/** Refresh the telemetry readout. Call after stepping. */
	update(): void;
	/** Restore the defaults passed to createVehicleSettings */
	reset(): void;
	/** Re-read the live settings after changing them outside the panel */
	sync(): void;
};

const toDeg = 180 / Math.PI;

// lil-gui edits plain number properties, so angles go through a degree proxy
function degreeProxy<T extends object>(target: T, keys: (keyof T)[]) {
	const proxy: Record<string, number> = {};
	for (const key of keys) {
		Object.defineProperty(proxy, key, {
			get: () => (target[key] as number) * toDeg,
			set: (value: number) => {
				(target as Record<keyof T, number>)[key] = value / toDeg;
			},
			enumerable: true,
		});
	}
	return proxy;
}

// Hover text for the panel, keyed by top level folder and then by the controller's property.
// The wording follows the field docs in box3d's include/box3d/vehicle.h.
const folderTips: Record<string, string> = {
	Chassis: 'Mass and balance of the car body',
	Suspension:
		'Springs, dampers and wheel settings, per axle. A change applies to both wheels of the axle.',
	Tires:
		'Tire grip curves, per axle. Grip rises with slip to a peak, then falls to a lower value once the tire slides.',
	'Anti-roll':
		'Bars that link the left and right wheels of an axle to reduce body roll',
	Engine:
		'Torque curve and inertia. Torque rises linearly from idle to the peak rpm, then falls to the max rpm.',
	Transmission: 'Gearbox and clutch',
	Drivetrain:
		'Differentials: how engine torque is split between the driven wheels',
	Steering: 'Steering lock, speed and geometry',
	Assists: 'Driving aids and arcade shortcuts. Each one can be turned off.',
	Telemetry:
		'Live readout per wheel: load (kN), slip ratio, slip angle and suspension compression (0 extended, 1 at the bump stop). S marks a wheel the sticky tire is holding.',
};

const controllerTips: Record<string, Record<string, string>> = {
	Chassis: {
		mass: 'Chassis mass. The suspension keeps its ride frequency, so the springs stiffen with the mass each wheel carries.',
		autoCenterOfMass:
			'Puts the center of mass at the resting axle height. A lower center of mass is the most effective way to stop the car from flipping.',
		y: 'Moves the center of mass up (+) or down (-), in chassis space',
		z: 'Moves the center of mass forward (+) or back (-), in chassis space. Forward puts more weight on the front wheels.',
		maxSlopeAngle:
			'The wheels ignore ground steeper than this, so the car cannot drive up walls',
	},
	Suspension: {
		frequency:
			'Ride frequency of the spring against the mass on this wheel. Higher is stiffer: less roll and dive, a harsher ride.',
		compressionDamping:
			'Damping ratio while the spring compresses. Higher resists bumps and landings more.',
		reboundDamping:
			'Damping ratio while the spring extends. Higher stops the car bouncing after a bump.',
		minLength:
			'Length at full compression, where the bump stop engages. Measured from the attachment point to the wheel center.',
		maxLength:
			'Length at full extension. The difference from the min length is the suspension travel.',
		preload:
			'Extra spring length that lifts the car without changing the stiffness',
		enableBumpStop:
			'Hard stop at the min length, so hard landings cannot push the wheel through the chassis',
		radius:
			'Wheel radius. A larger wheel turns the same torque into less force at the ground.',
		width: 'Wheel width, used by the cylinder ground probe',
		inertia:
			'Spin inertia of the wheel and brake disc. Lower spins up and locks more easily.',
		steerFactor:
			'Multiplier on the steer angle: 1 steers fully, 0 is fixed, negative steers the other way (rear steering)',
		maxBrakeTorque:
			'Brake torque at full brake. The front to rear balance is the brake bias.',
		maxHandBrakeTorque:
			'Brake torque at full handbrake. Usually rear wheels only.',
		angularDamping: 'Spin damping, a drag that slows a freely spinning wheel',
		castType:
			'How the wheel probes the ground. Cylinder matches the tire and does not fall into cracks, sphere uses the wheel radius, ray is a single ray through the wheel center and is the cheapest.',
	},
	Tires: {
		longitudinalPeakSlip:
			'Slip ratio where grip under throttle and braking peaks. Slip ratio is how much faster or slower the tire spins than the ground passes under it.',
		longitudinalPeakFriction:
			'Friction coefficient at peak grip under throttle and braking, scaled by the ground friction',
		longitudinalSlideSlip:
			'Slip ratio where the tire is fully spinning or locked',
		longitudinalSlideFriction:
			'Friction coefficient once the tire is fully spinning or locked. Lower than the peak, so wheelspin and locked brakes lose grip.',
		lateralPeakAngle:
			'Slip angle where cornering grip peaks. Slip angle is the angle between where the tire points and where it travels.',
		lateralPeakFriction: 'Friction coefficient at peak cornering grip',
		lateralSlideAngle: 'Slip angle where the tire is fully sliding sideways',
		lateralSlideFriction:
			'Cornering friction coefficient once fully sliding. Lower makes slides harder to catch.',
		rollingResistance:
			'Rolling resistance coefficient: a torque of coefficient x load x radius that slows the wheel',
	},
	'Anti-roll': {
		stiffness:
			'Pushes back when one wheel of the axle compresses more than the other, which reduces body roll. A stiffer front bar adds understeer, a stiffer rear bar adds oversteer.',
	},
	Engine: {
		maxTorque: 'Peak engine torque, before the gearbox multiplies it',
		peakTorqueRpm: 'Rpm where the engine makes its peak torque',
		idleTorqueScale: 'Fraction of the peak torque available at idle',
		maxRpmTorqueScale: 'Fraction of the peak torque available at the max rpm',
		idleRpm: 'Idle rpm. The engine never drops below it.',
		maxRpm: 'Rev limiter',
		inertia: 'Engine and flywheel inertia. Lower revs up and down faster.',
		angularDamping:
			'Internal engine friction. It is what slows the car when you lift off the throttle.',
	},
	Transmission: {
		automatic:
			'On: shifts by rpm, and holding reverse while stopped selects reverse. Off: shift with Q and E.',
		gearCount: 'Number of forward gears in use',
		finalDrive:
			'Ratio applied on top of every gear. Higher accelerates harder but reaches the rev limit at a lower speed.',
		reverseRatio: 'Reverse gear ratio',
		shiftUpRpm: 'Rpm where the automatic gearbox shifts up',
		shiftDownRpm: 'Rpm where the automatic gearbox shifts down',
		shiftTime:
			'Time the clutch stays open and the throttle is cut during a shift',
		clutchReleaseTime: 'Time for the clutch to engage again after a shift',
		shiftLatency:
			'Minimum time between automatic shifts, so the gearbox does not hunt between gears',
		clutchStrength:
			'How strongly the clutch couples the engine to the wheels. Lower lets the clutch slip more.',
		ratio:
			'Ratio of this forward gear. Higher multiplies torque more but reaches the rev limit at a lower speed.',
	},
	Drivetrain: {
		torqueRatio:
			'Share of the engine torque this differential receives. The shares of all differentials should add up to 1.',
		leftRightSplit:
			"Share of this differential's torque sent to the left wheel. 0.5 is even.",
		limitedSlipRatio:
			'Wheel speed ratio this differential allows before torque moves to the slower wheel. 1 or less is an open differential.',
		centerLimitedSlipRatio:
			'Limited slip between the differentials, for example front and rear. 1 or less is open.',
	},
	Steering: {
		maxAngle: 'Steer angle at full lock, when stopped',
		speedReference:
			'Speed where the steer angle is halved. It falls off with speed squared. 0 keeps full lock at any speed.',
		steerSpeed: 'How fast the wheels turn toward a larger angle (rad/s)',
		returnSpeed: 'How fast the wheels turn back to center (rad/s)',
		ackermann:
			'0 turns both front wheels by the same angle. 1 is full Ackermann geometry, where the inside wheel turns more to follow a tighter circle.',
	},
	Assists: {
		tractionControl:
			'Limits the throttle so no driven wheel gets more torque than its tire can transmit. On rear wheels it also leaves grip for cornering, so full throttle mid corner does not spin the car.',
		abs: 'Caps the brake torque at what the tire can transmit, so the wheels do not lock and the car still steers while braking',
		stickyTire:
			'Holds the car still at low speed with no throttle, for example when parked on a slope',
		counterSteer:
			'Steers into a rear slide automatically, as a fraction of the slide angle',
		driftGripScale:
			'Sideways grip of handbraked wheels at full handbrake. Below 1 makes handbrake drifts easy.',
		rollInfluence:
			'Moves where cornering forces act toward the center of mass height. 0 is physical, 1 removes all body roll from cornering.',
		downforce:
			'Downforce coefficient: force = downforce x speed squared. Adds grip at speed.',
		drag: 'Air drag coefficient: force = drag x speed squared. Limits the top speed.',
		airControl:
			'Rotation from driver input while all wheels are in the air (rad/s squared)',
		airAngularDamping: 'Damps spinning while all wheels are in the air (1/s)',
		selfRighting:
			'Roll only torque that turns the car back onto its wheels while partly grounded, or when stuck on its side or roof',
		maxTiltAngle:
			'Stops the car tilting further than this from upright. 0 turns it off.',
		stickySpeed: 'Speed below which the sticky tire engages (m/s)',
		stickyTime:
			'How long the car must stay below the sticky speed before the sticky tire engages (s)',
	},
};

const rootTips: Record<string, string> = {
	reset: 'Restores every setting to the preset the example started with',
};

// Sets the browser tooltip (the title attribute) on every folder and controller that has one
function applyTips(root: GUI): void {
	for (const folder of root.foldersRecursive()) {
		const text = folderTips[folder._title];
		if (text) folder.$title.title = text;
	}
	for (const c of root.controllersRecursive()) {
		let top = c.parent;
		while (top !== root && top.parent !== root) top = top.parent;
		const text =
			top === root
				? rootTips[c.property]
				: controllerTips[top._title]?.[c.property];
		if (text) c.domElement.title = text;
	}
}

export function createVehicleSettings(
	gui: GUI,
	b3: Box3DModule,
	vehicle: b3VehicleId,
	defaults: b3VehicleDef,
	stateBuffer: VehicleStateBuffer,
): VehicleSettings {
	const root = gui.addFolder('Vehicle');
	const wheelCount = b3.b3Vehicle_GetWheelCount(vehicle);

	const chassis: b3VehicleChassis = b3.b3Vehicle_GetChassis(vehicle);
	const engine: b3VehicleEngine = b3.b3Vehicle_GetEngine(vehicle);
	const transmission: b3VehicleTransmission =
		b3.b3Vehicle_GetTransmission(vehicle);
	const drivetrain: b3VehicleDrivetrain = b3.b3Vehicle_GetDrivetrain(vehicle);
	const antiRoll: b3VehicleAntiRoll = b3.b3Vehicle_GetAntiRoll(vehicle);
	const steering: b3VehicleSteering = b3.b3Vehicle_GetSteering(vehicle);
	const assists: b3VehicleAssists = b3.b3Vehicle_GetAssists(vehicle);
	const wheels: b3VehicleWheelDef[] = [];
	for (let i = 0; i < wheelCount; i++)
		wheels.push(b3.b3Vehicle_GetWheel(vehicle, i));

	const applyChassis = () => b3.b3Vehicle_SetChassis(vehicle, chassis);
	const applyEngine = () => b3.b3Vehicle_SetEngine(vehicle, engine);
	const applyTransmission = () =>
		b3.b3Vehicle_SetTransmission(vehicle, transmission);
	const applyDrivetrain = () => b3.b3Vehicle_SetDrivetrain(vehicle, drivetrain);
	const applyAntiRoll = () => b3.b3Vehicle_SetAntiRoll(vehicle, antiRoll);
	const applySteering = () => b3.b3Vehicle_SetSteering(vehicle, steering);
	const applyAssists = () => b3.b3Vehicle_SetAssists(vehicle, assists);

	// Axle proxies: editing one value writes it to both wheels of the axle. Each proxy reads
	// from the axle's first wheel so it stays in sync after a reset.
	type AxleField = {
		get(w: b3VehicleWheelDef): number | boolean;
		set(w: b3VehicleWheelDef, v: never): void;
	};
	function axleProxy(
		first: number,
		count: number,
		fields: Record<string, AxleField>,
	) {
		const proxy: Record<string, number | boolean> = {};
		for (const [name, field] of Object.entries(fields)) {
			Object.defineProperty(proxy, name, {
				get: () => field.get(wheels[first]),
				set: (value: never) => {
					for (let i = first; i < first + count; i++) {
						field.set(wheels[i], value);
						b3.b3Vehicle_SetWheel(vehicle, i, wheels[i]);
					}
				},
				enumerable: true,
			});
		}
		return proxy;
	}
	const wheelField = (key: keyof b3VehicleWheelDef): AxleField => ({
		get: (w) => w[key] as number,
		set: (w, v) => {
			(w as Record<string, unknown>)[key] = v;
		},
	});
	const suspensionField = (
		key: keyof b3VehicleWheelDef['suspension'],
		scale = 1,
	): AxleField => ({
		get: (w) =>
			typeof w.suspension[key] === 'boolean'
				? w.suspension[key]
				: (w.suspension[key] as number) * scale,
		set: (w, v: number | boolean) => {
			(w.suspension as Record<string, unknown>)[key] =
				typeof v === 'boolean' ? v : v / scale;
		},
	});
	const tireField = (
		key: keyof b3VehicleWheelDef['tire'],
		scale = 1,
	): AxleField => ({
		get: (w) => w.tire[key] * scale,
		set: (w, v: number) => {
			w.tire[key] = v / scale;
		},
	});

	const axles: { name: string; first: number; count: number }[] = [];
	for (let i = 0; i < wheelCount; i += 2) {
		const count = Math.min(2, wheelCount - i);
		const name =
			wheelCount === 4 ? (i === 0 ? 'front' : 'rear') : `axle ${i / 2 + 1}`;
		axles.push({ name, first: i, count });
	}

	// ---- Chassis
	const chassisFolder = root.addFolder('Chassis').close();
	chassisFolder
		.add(chassis, 'mass', 300, 5000, 10)
		.name('mass (kg)')
		.onChange(applyChassis);
	chassisFolder
		.add(chassis, 'autoCenterOfMass')
		.name('auto center of mass')
		.onChange(applyChassis);
	const com = {
		get y() {
			return chassis.centerOfMassOffset[1];
		},
		set y(v: number) {
			chassis.centerOfMassOffset[1] = v;
		},
		get z() {
			return chassis.centerOfMassOffset[2];
		},
		set z(v: number) {
			chassis.centerOfMassOffset[2] = v;
		},
	};
	chassisFolder
		.add(com, 'y', -1, 1, 0.01)
		.name('com offset y')
		.onChange(applyChassis);
	chassisFolder
		.add(com, 'z', -1.5, 1.5, 0.01)
		.name('com offset z')
		.onChange(applyChassis);
	const chassisDeg = degreeProxy(chassis, ['maxSlopeAngle']);
	chassisFolder
		.add(chassisDeg, 'maxSlopeAngle', 10, 90, 1)
		.name('max slope (°)')
		.onChange(applyChassis);

	// ---- Suspension and wheels, per axle
	const suspensionFolder = root.addFolder('Suspension').close();
	const tiresFolder = root.addFolder('Tires').close();
	const castTypes = {
		cylinder: b3.b3VehicleCastType.b3_vehicleCastCylinder.value,
		sphere: b3.b3VehicleCastType.b3_vehicleCastSphere.value,
		ray: b3.b3VehicleCastType.b3_vehicleCastRay.value,
	};
	const castTypeByValue = [
		b3.b3VehicleCastType.b3_vehicleCastCylinder,
		b3.b3VehicleCastType.b3_vehicleCastSphere,
		b3.b3VehicleCastType.b3_vehicleCastRay,
	];
	for (const { name, first, count } of axles) {
		const s = suspensionFolder.addFolder(name);
		const p = axleProxy(first, count, {
			frequency: suspensionField('frequency'),
			compressionDamping: suspensionField('compressionDamping'),
			reboundDamping: suspensionField('reboundDamping'),
			minLength: suspensionField('minLength'),
			maxLength: suspensionField('maxLength'),
			preload: suspensionField('preload'),
			enableBumpStop: suspensionField('enableBumpStop'),
			radius: wheelField('radius'),
			width: wheelField('width'),
			inertia: wheelField('inertia'),
			steerFactor: wheelField('steerFactor'),
			maxBrakeTorque: wheelField('maxBrakeTorque'),
			maxHandBrakeTorque: wheelField('maxHandBrakeTorque'),
			angularDamping: wheelField('angularDamping'),
			castType: {
				get: (w) => w.castType.value,
				set: (w, v: number) => {
					w.castType = castTypeByValue[v];
				},
			},
		});
		s.add(p, 'frequency', 0.5, 4, 0.05).name('frequency (Hz)');
		s.add(p, 'compressionDamping', 0, 2, 0.01).name('bump damping');
		s.add(p, 'reboundDamping', 0, 2, 0.01).name('rebound damping');
		s.add(p, 'minLength', 0, 1, 0.01).name('min length (m)');
		s.add(p, 'maxLength', 0.05, 1.2, 0.01).name('max length (m)');
		s.add(p, 'preload', 0, 0.3, 0.005).name('preload (m)');
		s.add(p, 'enableBumpStop').name('bump stop');
		s.add(p, 'radius', 0.15, 0.8, 0.01).name('wheel radius (m)');
		s.add(p, 'width', 0.05, 0.6, 0.01).name('wheel width (m)');
		s.add(p, 'inertia', 0.1, 10, 0.1).name('wheel inertia');
		s.add(p, 'steerFactor', -1, 1, 0.05).name('steer factor');
		s.add(p, 'maxBrakeTorque', 0, 6000, 50).name('brake (N·m)');
		s.add(p, 'maxHandBrakeTorque', 0, 8000, 50).name('handbrake (N·m)');
		s.add(p, 'angularDamping', 0, 5, 0.05).name('spin damping');
		s.add(p, 'castType', castTypes).name('ground probe');

		const t = tiresFolder.addFolder(name);
		const q = axleProxy(first, count, {
			longitudinalPeakSlip: tireField('longitudinalPeakSlip'),
			longitudinalPeakFriction: tireField('longitudinalPeakFriction'),
			longitudinalSlideSlip: tireField('longitudinalSlideSlip'),
			longitudinalSlideFriction: tireField('longitudinalSlideFriction'),
			lateralPeakAngle: tireField('lateralPeakAngle', toDeg),
			lateralPeakFriction: tireField('lateralPeakFriction'),
			lateralSlideAngle: tireField('lateralSlideAngle', toDeg),
			lateralSlideFriction: tireField('lateralSlideFriction'),
			rollingResistance: tireField('rollingResistance'),
		});
		t.add(q, 'longitudinalPeakSlip', 0.02, 0.5, 0.01).name('long. peak slip');
		t.add(q, 'longitudinalPeakFriction', 0.1, 3, 0.01).name('long. peak μ');
		t.add(q, 'longitudinalSlideSlip', 0.05, 2, 0.01).name('long. slide slip');
		t.add(q, 'longitudinalSlideFriction', 0.1, 3, 0.01).name('long. slide μ');
		t.add(q, 'lateralPeakAngle', 1, 30, 0.5).name('lat. peak angle (°)');
		t.add(q, 'lateralPeakFriction', 0.1, 3, 0.01).name('lat. peak μ');
		t.add(q, 'lateralSlideAngle', 2, 60, 0.5).name('lat. slide angle (°)');
		t.add(q, 'lateralSlideFriction', 0.1, 3, 0.01).name('lat. slide μ');
		t.add(q, 'rollingResistance', 0, 0.1, 0.001).name('rolling resistance');
	}

	// ---- Anti-roll bars
	const antiRollFolder = root.addFolder('Anti-roll').close();
	for (let i = 0; i < antiRoll.barCount; i++) {
		const bar = {
			get stiffness() {
				return antiRoll.bars[i].stiffness;
			},
			set stiffness(v: number) {
				antiRoll.bars[i].stiffness = v;
			},
		};
		const label =
			antiRoll.barCount === 2 ? (i === 0 ? 'front' : 'rear') : `bar ${i + 1}`;
		antiRollFolder
			.add(bar, 'stiffness', 0, 80000, 500)
			.name(`${label} (N/m)`)
			.onChange(applyAntiRoll);
	}

	// ---- Engine
	const engineFolder = root.addFolder('Engine').close();
	engineFolder
		.add(engine, 'maxTorque', 0, 1500, 5)
		.name('peak torque (N·m)')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'peakTorqueRpm', 1000, 9000, 50)
		.name('peak torque rpm')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'idleTorqueScale', 0, 1, 0.01)
		.name('idle torque scale')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'maxRpmTorqueScale', 0, 1, 0.01)
		.name('redline torque scale')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'idleRpm', 300, 2000, 10)
		.name('idle rpm')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'maxRpm', 2000, 12000, 50)
		.name('max rpm')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'inertia', 0.05, 2, 0.01)
		.name('inertia')
		.onChange(applyEngine);
	engineFolder
		.add(engine, 'angularDamping', 0, 1, 0.01)
		.name('engine braking')
		.onChange(applyEngine);

	// ---- Transmission
	const transmissionFolder = root.addFolder('Transmission').close();
	const mode = {
		get automatic() {
			return (
				transmission.mode.value ===
				b3.b3VehicleTransmissionMode.b3_vehicleTransmissionAuto.value
			);
		},
		set automatic(v: boolean) {
			transmission.mode = v
				? b3.b3VehicleTransmissionMode.b3_vehicleTransmissionAuto
				: b3.b3VehicleTransmissionMode.b3_vehicleTransmissionManual;
		},
	};
	transmissionFolder.add(mode, 'automatic').onChange(applyTransmission);
	// The presets leave the ratios of unused gears at 0, and a gear with no ratio transmits no
	// torque. Give every newly enabled gear a ratio a little shorter than the one below it.
	const ratioControllers: { updateDisplay(): unknown }[] = [];
	const fillGearRatios = () => {
		const ratios = transmission.gearRatios;
		for (let i = 1; i < transmission.gearCount; i++) {
			if (ratios[i] <= 0) ratios[i] = Math.max(ratios[i - 1] * 0.8, 0.3);
		}
		for (const c of ratioControllers) c.updateDisplay();
	};
	transmissionFolder
		.add(transmission, 'gearCount', 1, 8, 1)
		.name('gears')
		.onChange(() => {
			fillGearRatios();
			applyTransmission();
		});
	transmissionFolder
		.add(transmission, 'finalDrive', 1, 8, 0.05)
		.name('final drive')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'reverseRatio', 0.5, 6, 0.05)
		.name('reverse ratio')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'shiftUpRpm', 1000, 12000, 50)
		.name('upshift rpm')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'shiftDownRpm', 500, 8000, 50)
		.name('downshift rpm')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'shiftTime', 0, 1, 0.01)
		.name('shift time (s)')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'clutchReleaseTime', 0, 1, 0.01)
		.name('clutch release (s)')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'shiftLatency', 0, 2, 0.05)
		.name('shift latency (s)')
		.onChange(applyTransmission);
	transmissionFolder
		.add(transmission, 'clutchStrength', 1, 50, 0.5)
		.name('clutch strength')
		.onChange(applyTransmission);
	const ratiosFolder = transmissionFolder.addFolder('Gear ratios').close();
	for (let i = 0; i < transmission.gearRatios.length; i++) {
		const gear = {
			get ratio() {
				return transmission.gearRatios[i];
			},
			set ratio(v: number) {
				transmission.gearRatios[i] = v;
			},
		};
		ratioControllers.push(
			ratiosFolder
				.add(gear, 'ratio', 0.3, 6, 0.01)
				.name(`gear ${i + 1}`)
				.onChange(applyTransmission),
		);
	}

	// ---- Drivetrain
	const drivetrainFolder = root.addFolder('Drivetrain').close();
	const wheelNames =
		wheelCount === 4 ? ['FL', 'FR', 'RL', 'RR'] : wheels.map((_, i) => `W${i}`);
	for (let i = 0; i < drivetrain.differentialCount; i++) {
		const d = drivetrain.differentials[i];
		const diff = {
			get torqueRatio() {
				return drivetrain.differentials[i].torqueRatio;
			},
			set torqueRatio(v: number) {
				drivetrain.differentials[i].torqueRatio = v;
			},
			get leftRightSplit() {
				return drivetrain.differentials[i].leftRightSplit;
			},
			set leftRightSplit(v: number) {
				drivetrain.differentials[i].leftRightSplit = v;
			},
			get limitedSlipRatio() {
				return drivetrain.differentials[i].limitedSlipRatio;
			},
			set limitedSlipRatio(v: number) {
				drivetrain.differentials[i].limitedSlipRatio = v;
			},
		};
		const f = drivetrainFolder.addFolder(
			`diff ${wheelNames[d.leftWheel] ?? '-'}/${wheelNames[d.rightWheel] ?? '-'}`,
		);
		f.add(diff, 'torqueRatio', 0, 1, 0.01)
			.name('torque share')
			.onChange(applyDrivetrain);
		f.add(diff, 'leftRightSplit', 0, 1, 0.01)
			.name('left/right split')
			.onChange(applyDrivetrain);
		f.add(diff, 'limitedSlipRatio', 1, 4, 0.05)
			.name('limited slip')
			.onChange(applyDrivetrain);
	}
	if (drivetrain.differentialCount > 1) {
		drivetrainFolder
			.add(drivetrain, 'centerLimitedSlipRatio', 1, 4, 0.05)
			.name('center limited slip')
			.onChange(applyDrivetrain);
	}

	// ---- Steering
	const steeringFolder = root.addFolder('Steering').close();
	const steeringDeg = degreeProxy(steering, ['maxAngle']);
	steeringFolder
		.add(steeringDeg, 'maxAngle', 5, 60, 0.5)
		.name('max angle (°)')
		.onChange(applySteering);
	steeringFolder
		.add(steering, 'speedReference', 0, 60, 0.5)
		.name('speed falloff (m/s)')
		.onChange(applySteering);
	steeringFolder
		.add(steering, 'steerSpeed', 0.5, 20, 0.1)
		.name('steer speed')
		.onChange(applySteering);
	steeringFolder
		.add(steering, 'returnSpeed', 0.5, 20, 0.1)
		.name('return speed')
		.onChange(applySteering);
	steeringFolder.add(steering, 'ackermann', 0, 1, 0.01).onChange(applySteering);

	// ---- Assists
	const assistsFolder = root.addFolder('Assists').close();
	assistsFolder
		.add(assists, 'tractionControl')
		.name('traction control')
		.onChange(applyAssists);
	assistsFolder.add(assists, 'abs').name('ABS').onChange(applyAssists);
	assistsFolder
		.add(assists, 'stickyTire')
		.name('sticky tire')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'counterSteer', 0, 1, 0.01)
		.name('counter steer')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'driftGripScale', 0.1, 1, 0.01)
		.name('handbrake grip')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'rollInfluence', 0, 1, 0.01)
		.name('roll influence')
		.onChange(applyAssists);
	assistsFolder.add(assists, 'downforce', 0, 10, 0.1).onChange(applyAssists);
	assistsFolder.add(assists, 'drag', 0, 5, 0.05).onChange(applyAssists);
	assistsFolder
		.add(assists, 'airControl', 0, 10, 0.1)
		.name('air control')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'airAngularDamping', 0, 10, 0.1)
		.name('air damping')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'selfRighting', 0, 20, 0.1)
		.name('self righting')
		.onChange(applyAssists);
	const assistsDeg = degreeProxy(assists, ['maxTiltAngle']);
	assistsFolder
		.add(assistsDeg, 'maxTiltAngle', 0, 90, 1)
		.name('max tilt (°, 0 off)')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'stickySpeed', 0, 2, 0.01)
		.name('sticky speed')
		.onChange(applyAssists);
	assistsFolder
		.add(assists, 'stickyTime', 0, 1, 0.01)
		.name('sticky time')
		.onChange(applyAssists);

	// ---- Telemetry
	const telemetryFolder = root.addFolder('Telemetry');
	const readout = document.createElement('pre');
	readout.style.cssText =
		'margin:0;padding:6px 8px;font:11px/1.45 ui-monospace,monospace;color:#ddd;white-space:pre;';
	telemetryFolder.$children.appendChild(readout);

	root.add({ reset }, 'reset').name('reset to defaults');

	const state: VehicleStateRecord = b3.createVehicleStateRecord();
	const wheel: VehicleWheelRecord = b3.createVehicleWheelRecord();
	const pad = (v: number, digits: number, width: number) =>
		v.toFixed(digits).padStart(width);

	function update(): void {
		b3.getVehicleStateAt(state, stateBuffer);
		const gear =
			state.gear < 0 ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
		let text = `${pad(state.speed * 3.6, 0, 4)} km/h  ${pad(state.engineRpm, 0, 5)} rpm  gear ${gear}${state.isShifting ? '*' : ''}\n`;
		text += `thr ${pad(state.throttle, 2, 4)} brk ${pad(state.brake, 2, 4)} steer ${pad(state.steerAngle * toDeg, 1, 5)}°\n`;
		text += '      load   slip  angle  comp\n';
		const count = b3.getNumVehicleWheels(stateBuffer);
		for (let i = 0; i < count; i++) {
			b3.getVehicleWheelAt(wheel, stateBuffer, i);
			const name = (wheelNames[i] ?? `W${i}`).padEnd(3);
			if (!wheel.hasContact) {
				text += `${name}     airborne\n`;
				continue;
			}
			text +=
				`${name} ${pad(wheel.load / 1000, 1, 5)}k ${pad(wheel.slipRatio, 2, 6)} ` +
				`${pad(wheel.slipAngle * toDeg, 1, 5)}° ${pad(wheel.compression, 2, 5)}${wheel.isSticky ? ' S' : ''}\n`;
		}
		readout.textContent = text;
	}

	// Copies into the existing objects so every controller and proxy stays bound. Embind enum
	// values are shared objects and are assigned by reference.
	function copyInto(
		target: Record<string, unknown>,
		source: Record<string, unknown>,
	): void {
		for (const key of Object.keys(source)) {
			const value = source[key];
			const current = target[key];
			if (Array.isArray(value) && Array.isArray(current)) {
				value.forEach((item, i) => {
					if (
						item !== null &&
						typeof item === 'object' &&
						!Array.isArray(item)
					) {
						copyInto(
							current[i] as Record<string, unknown>,
							item as Record<string, unknown>,
						);
					} else {
						current[i] = item;
					}
				});
			} else if (
				value !== null &&
				typeof value === 'object' &&
				!('value' in value) &&
				current
			) {
				copyInto(
					current as Record<string, unknown>,
					value as Record<string, unknown>,
				);
			} else {
				target[key] = value;
			}
		}
	}

	function copyAll(
		source: Pick<
			b3VehicleDef,
			| 'chassis'
			| 'engine'
			| 'transmission'
			| 'drivetrain'
			| 'antiRoll'
			| 'steering'
			| 'assists'
		>,
	): void {
		const pairs: [object, object][] = [
			[chassis, source.chassis],
			[engine, source.engine],
			[transmission, source.transmission],
			[drivetrain, source.drivetrain],
			[antiRoll, source.antiRoll],
			[steering, source.steering],
			[assists, source.assists],
		];
		for (const [target, from] of pairs) {
			copyInto(
				target as Record<string, unknown>,
				from as Record<string, unknown>,
			);
		}
	}

	function sync(): void {
		copyAll({
			chassis: b3.b3Vehicle_GetChassis(vehicle),
			engine: b3.b3Vehicle_GetEngine(vehicle),
			transmission: b3.b3Vehicle_GetTransmission(vehicle),
			drivetrain: b3.b3Vehicle_GetDrivetrain(vehicle),
			antiRoll: b3.b3Vehicle_GetAntiRoll(vehicle),
			steering: b3.b3Vehicle_GetSteering(vehicle),
			assists: b3.b3Vehicle_GetAssists(vehicle),
		});
		for (let i = 0; i < wheelCount; i++) {
			copyInto(
				wheels[i] as unknown as Record<string, unknown>,
				b3.b3Vehicle_GetWheel(vehicle, i) as unknown as Record<string, unknown>,
			);
		}
		for (const c of root.controllersRecursive()) c.updateDisplay();
	}

	function reset(): void {
		copyAll(defaults);
		for (let i = 0; i < wheelCount; i++) {
			copyInto(
				wheels[i] as unknown as Record<string, unknown>,
				defaults.wheels[i] as unknown as Record<string, unknown>,
			);
			b3.b3Vehicle_SetWheel(vehicle, i, wheels[i]);
		}
		applyChassis();
		applyEngine();
		applyTransmission();
		applyDrivetrain();
		applyAntiRoll();
		applySteering();
		applyAssists();
		for (const c of root.controllersRecursive()) c.updateDisplay();
	}

	applyTips(root);

	return { update, reset, sync };
}
