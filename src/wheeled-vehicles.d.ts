import type {
	Box3DModule,
	b3BodyId,
	b3Vec3,
	b3WheeledVehicleDef,
	b3WheeledVehicleSteering,
	b3WheeledVehicleTurbo,
	b3WheeledVehicleWheelDef,
} from 'box3d.js';

export type WheeledVehicleCarName = 'sports' | 'rally' | 'super';
export type WheeledVehicleRealism = 100 | 75 | 50 | 25 | 0;
export type WheeledVehicleDrive = 'fwd' | 'rwd' | 'awd';
export type WheeledVehicleMatrixPresetName =
	`${WheeledVehicleCarName}-${WheeledVehicleRealism}-${WheeledVehicleDrive}`;
export type WheeledVehiclePresetName =
	| 'fwd'
	| 'rwd'
	| 'awd'
	| 'offroad'
	| WheeledVehicleMatrixPresetName;

export interface WheeledVehiclePreset {
	title: string;
	/** Half extents of the chassis collision box (m) */
	halfExtents: b3Vec3;
	/** Where a matrix preset sits in the matrix. Absent on the four original presets. */
	matrix?: {
		car: WheeledVehicleCarName;
		realism: WheeledVehicleRealism;
		drive: WheeledVehicleDrive;
	};
	/** Tunes a b3DefaultWheeledVehicleDef() in place and returns it */
	apply(def: b3WheeledVehicleDef): b3WheeledVehicleDef;
}

export interface WheeledVehicleTire {
	peakSlip: number;
	longPeak: number;
	slideSlip: number;
	longSlide: number;
	/** Degrees */
	latPeakAngle: number;
	latPeak: number;
	/** Degrees */
	latSlideAngle: number;
	latSlide: number;
	rolling: number;
}

export interface WheeledVehicleAxle {
	width: number;
	/** Brake torque at full brake (N·m) */
	brake: number;
	/** Ride frequency (Hz) */
	frequency: number;
	/** Tire values for this axle that differ from the car's `tire` */
	tire?: Partial<WheeledVehicleTire>;
}

/** A car at 100% realism, the first preset layer */
export interface WheeledVehicleCar {
	title: string;
	blurb: string;
	/** Body paint for the examples */
	color: number;
	halfExtents: b3Vec3;
	mass: number;
	/** Added to the automatic center of mass height (m) */
	comHeight: number;
	/** Center of mass offset along forward (m), negative toward the rear */
	comForward: number;
	/** Half track, wheel attachment height, front axle z, rear axle z (m) */
	layout: [number, number, number, number];
	wheelRadius: number;
	wheelInertia: number;
	front: WheeledVehicleAxle;
	rear: WheeledVehicleAxle;
	handbrake: number;
	suspension: {
		minLength: number;
		maxLength: number;
		compressionDamping: number;
		reboundDamping: number;
		/** Extra spring length past `maxLength` (m, default 0): carries a soft spring's sag without a longer droop */
		preload?: number;
	};
	tire: WheeledVehicleTire;
	engine: {
		maxTorque: number;
		peakTorqueRpm: number;
		idleRpm: number;
		maxRpm: number;
		inertia: number;
	};
	gears: number[];
	finalDrive: number;
	shiftUpRpm: number;
	shiftDownRpm: number;
	shiftTime: number;
	/** Front and rear anti-roll bar stiffness (N/m) */
	antiRoll: [number, number];
	steering: {
		/** Degrees */
		maxAngle: number;
		speedReference: number;
		steerSpeed: number;
		returnSpeed: number;
	};
	downforce: number;
	drag: number;
	tractionControl: boolean;
	abs: boolean;
	/** Read by the drivetrain layers */
	drive: {
		frontLsd: number;
		rearLsd: number;
		centerLsd: number;
		/** Share of the torque sent to the front axle in AWD */
		awdFront: number;
		/** Multiplies the rear tires' side grip in AWD (default 1) */
		awdRearGrip?: number;
	};
}

/** The second preset layer */
export interface WheeledVehicleDrivetrainLayer {
	title: string;
	apply(def: b3WheeledVehicleDef, car: WheeledVehicleCar): void;
}

/** The third preset layer */
export interface WheeledVehicleRealismLevel {
	title: string;
	/** Multiplies every tire friction coefficient, and the rear brake torque */
	tireGrip: number;
	rollInfluence: number;
	counterSteer: number;
	/** Multiplies the rear tires' lateral friction on top of tireGrip */
	rearGrip: number;
	driftGripScale: number;
	/** Multiplies the car's downforce */
	downforceScale: number;
	/** Lowers the center of mass (m) */
	comDrop: number;
	selfRighting: number;
	airControl: number;
	airAngularDamping: number;
	/** Degrees, 0 disables */
	maxTiltAngle: number;
	/** null keeps the car's own setting */
	tractionControl: boolean | null;
	abs: boolean | null;
}

export type WheeledVehicleTurboName =
	| 'none'
	| 'small'
	| 'big'
	| 'twinScroll'
	| 'parallel'
	| 'sequential'
	| 'vgt'
	| 'electric'
	| 'supercharger'
	| 'antiLag';

/** One compressor stage. Rpm points are fractions of the engine's max rpm. */
export interface WheeledVehicleTurboStageType {
	gain: number;
	spool: number;
	full: number;
	/** Seconds */
	spoolTime: number;
	/** Seconds */
	bleedTime: number;
}

/** The optional fourth preset layer */
export interface WheeledVehicleTurboType {
	title: string;
	blurb: string;
	stages: WheeledVehicleTurboStageType[];
	instantFraction?: number;
	/** Fraction of the rated torque spent driving the compressor at full boost */
	parasitic?: number;
	antiLag?: boolean;
}

export const wheeledVehicleCars: Record<WheeledVehicleCarName, WheeledVehicleCar>;
export const drivetrainLayers: Record<WheeledVehicleDrive, WheeledVehicleDrivetrainLayer>;
export const realismLevels: Record<WheeledVehicleRealism, WheeledVehicleRealismLevel>;
export const turboTypes: Record<WheeledVehicleTurboName, WheeledVehicleTurboType>;
export const wheeledVehiclePresets: Record<WheeledVehiclePresetName, WheeledVehiclePreset>;

export function wheeledVehiclePresetName(
	car: WheeledVehicleCarName,
	realism: WheeledVehicleRealism,
	drive: WheeledVehicleDrive,
): WheeledVehicleMatrixPresetName;

/** Summed stage gain: the engine makes 1 + this times its torque curve at full boost */
export function turboGain(turbo: b3WheeledVehicleTurbo): number;

/** A b3WheeledVehicleTurbo for an engine with this max rpm and rated (fully boosted) peak torque */
export function makeWheeledVehicleTurbo(
	type: WheeledVehicleTurboName,
	maxRpm: number,
	ratedTorque: number,
): b3WheeledVehicleTurbo;

/**
 * The type in turboTypes this turbo was fitted from, for an engine with this max rpm and base
 * peak torque, or null for a custom turbo
 */
export function findTurboType(
	turbo: b3WheeledVehicleTurbo,
	maxRpm: number,
	maxTorque: number,
): WheeledVehicleTurboName | null;

/** Swaps the forced induction, keeping the engine's rated peak torque */
export function applyTurbo(
	def: b3WheeledVehicleDef,
	type: WheeledVehicleTurboName,
): b3WheeledVehicleDef;

/** Tunes a b3DefaultWheeledVehicleDef() in place: car, then drivetrain, then realism, then turbo */
export function applyWheeledVehiclePreset(
	def: b3WheeledVehicleDef,
	car: WheeledVehicleCarName,
	realism: WheeledVehicleRealism,
	drive: WheeledVehicleDrive,
	turbo?: WheeledVehicleTurboName,
): b3WheeledVehicleDef;

export function buildWheeledVehiclePreset(
	b3: Box3DModule,
	car: WheeledVehicleCarName,
	realism: WheeledVehicleRealism,
	drive: WheeledVehicleDrive,
	turbo?: WheeledVehicleTurboName,
): b3WheeledVehicleDef;

export function createPresetWheeledVehicleDef(
	b3: Box3DModule,
	name: WheeledVehiclePresetName,
): b3WheeledVehicleDef;

/** Grip limited steer input for a keyboard or other full lock input. Returns the limited steer. */
export type WheeledVehicleSteeringLimiter = (
	chassis: b3BodyId,
	steering: b3WheeledVehicleSteering,
	wheels: b3WheeledVehicleWheelDef[],
	steer: number,
	/** Brake input, 0 to 1. While braking the cap moves to brakingPeakScale. */
	braking?: number,
) => number;

/**
 * A driver aid applied to the input before b3WheeledVehicle_SetInput: caps the steer angle at
 * `peakScale` (default 1.5) times the front tires' peak slip angle from the direction the front
 * axle travels, and at `brakingPeakScale` (default 1) while braking. The presets are tuned to be
 * driven with it.
 */
export function createSteeringLimiter(
	b3: Box3DModule,
	options?: { peakScale?: number; brakingPeakScale?: number },
): WheeledVehicleSteeringLimiter;
