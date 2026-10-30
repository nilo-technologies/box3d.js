import type {
	Box3DModule,
	b3Vec3,
	b3VehicleDef,
	b3VehicleTurbo,
} from 'box3d.js';

export type VehicleCarName = 'sports' | 'rally' | 'super';
export type VehicleRealism = 100 | 75 | 50 | 25 | 0;
export type VehicleDrive = 'fwd' | 'rwd' | 'awd';
export type VehicleMatrixPresetName =
	`${VehicleCarName}-${VehicleRealism}-${VehicleDrive}`;
export type VehiclePresetName =
	| 'fwd'
	| 'rwd'
	| 'awd'
	| 'offroad'
	| VehicleMatrixPresetName;

export interface VehiclePreset {
	title: string;
	/** Half extents of the chassis collision box (m) */
	halfExtents: b3Vec3;
	/** Where a matrix preset sits in the matrix. Absent on the four original presets. */
	matrix?: {
		car: VehicleCarName;
		realism: VehicleRealism;
		drive: VehicleDrive;
	};
	/** Tunes a b3DefaultVehicleDef() in place and returns it */
	apply(def: b3VehicleDef): b3VehicleDef;
}

export interface VehicleTire {
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

export interface VehicleAxle {
	width: number;
	/** Brake torque at full brake (N·m) */
	brake: number;
	/** Ride frequency (Hz) */
	frequency: number;
}

/** A car at 100% realism, the first preset layer */
export interface VehicleCar {
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
	front: VehicleAxle;
	rear: VehicleAxle;
	handbrake: number;
	suspension: {
		minLength: number;
		maxLength: number;
		compressionDamping: number;
		reboundDamping: number;
	};
	tire: VehicleTire;
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
	};
}

/** The second preset layer */
export interface VehicleDrivetrainLayer {
	title: string;
	apply(def: b3VehicleDef, car: VehicleCar): void;
}

/** The third preset layer */
export interface VehicleRealismLevel {
	title: string;
	/** Multiplies every tire friction coefficient, and the rear brake torque */
	tireGrip: number;
	rollInfluence: number;
	counterSteer: number;
	/** Multiplies the car's steering speedReference */
	speedReferenceScale: number;
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

export type VehicleTurboName =
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
export interface VehicleTurboStageType {
	gain: number;
	spool: number;
	full: number;
	/** Seconds */
	spoolTime: number;
	/** Seconds */
	bleedTime: number;
}

/** The optional fourth preset layer */
export interface VehicleTurboType {
	title: string;
	blurb: string;
	stages: VehicleTurboStageType[];
	instantFraction?: number;
	/** Fraction of the rated torque spent driving the compressor at full boost */
	parasitic?: number;
	antiLag?: boolean;
}

export const vehicleCars: Record<VehicleCarName, VehicleCar>;
export const drivetrainLayers: Record<VehicleDrive, VehicleDrivetrainLayer>;
export const realismLevels: Record<VehicleRealism, VehicleRealismLevel>;
export const turboTypes: Record<VehicleTurboName, VehicleTurboType>;
export const vehiclePresets: Record<VehiclePresetName, VehiclePreset>;

export function vehiclePresetName(
	car: VehicleCarName,
	realism: VehicleRealism,
	drive: VehicleDrive,
): VehicleMatrixPresetName;

/** Summed stage gain: the engine makes 1 + this times its torque curve at full boost */
export function turboGain(turbo: b3VehicleTurbo): number;

/** A b3VehicleTurbo for an engine with this max rpm and rated (fully boosted) peak torque */
export function makeVehicleTurbo(
	type: VehicleTurboName,
	maxRpm: number,
	ratedTorque: number,
): b3VehicleTurbo;

/**
 * The type in turboTypes this turbo was fitted from, for an engine with this max rpm and base
 * peak torque, or null for a custom turbo
 */
export function findTurboType(
	turbo: b3VehicleTurbo,
	maxRpm: number,
	maxTorque: number,
): VehicleTurboName | null;

/** Swaps the forced induction, keeping the engine's rated peak torque */
export function applyTurbo(
	def: b3VehicleDef,
	type: VehicleTurboName,
): b3VehicleDef;

/** Tunes a b3DefaultVehicleDef() in place: car, then drivetrain, then realism, then turbo */
export function applyVehiclePreset(
	def: b3VehicleDef,
	car: VehicleCarName,
	realism: VehicleRealism,
	drive: VehicleDrive,
	turbo?: VehicleTurboName,
): b3VehicleDef;

export function buildVehiclePreset(
	b3: Box3DModule,
	car: VehicleCarName,
	realism: VehicleRealism,
	drive: VehicleDrive,
	turbo?: VehicleTurboName,
): b3VehicleDef;

export function createPresetVehicleDef(
	b3: Box3DModule,
	name: VehiclePresetName,
): b3VehicleDef;
