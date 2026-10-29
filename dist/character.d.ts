import type { Box3DModule, b3BodyId, b3Capsule, b3Filter, b3JointId, b3Vec3, b3WorldId } from 'box3d.js';

export const SKIRT_COUNT: 8;

/** Construction options, mirroring DynamicMoverDef in box3d's samples/dynamic_mover.h. */
export interface DynamicMoverDef {
	/** Center of the capsule. Default [0, 0, 0]. */
	position?: b3Vec3;
	/** Default center1 [0, -0.5, 0], center2 [0, 0.5, 0], radius 0.3. */
	capsule?: b3Capsule;
	/** Default 200. */
	density?: number;
	/** Collision filter for the capsule and the pogo rays. Default b3DefaultFilter(). */
	filter?: b3Filter;
	/** Default 7. */
	jumpSpeed?: number;
	/** Default 6. */
	maxSpeed?: number;
	/** Default 0.1. */
	minSpeed?: number;
	/** Default 3. */
	stopSpeed?: number;
	/** Default 20. */
	accelerate?: number;
	/** Fraction of the ground acceleration available in the air. Default 0.25. */
	airSteer?: number;
	/** Ground friction in units of 1/time. Default 8. */
	friction?: number;
	/** Default 1.5. */
	gravityScale?: number;
	/** Default 6000. */
	maxGroundForce?: number;
	/** Default 1500. */
	maxAirForce?: number;
	/** Default 0.9. */
	pogoRestLength?: number;
	/** Default 3. */
	pogoHertz?: number;
	/** Default 0.8. */
	pogoDampingRatio?: number;
	/** Pogo compression force limit as a multiple of the mover weight. Default 100. */
	pogoCompressionScale?: number;
	/** Pogo tension force limit as a multiple of the mover weight. Default 100. */
	pogoTensionScale?: number;
	/** Kinematic bodies whose shapes use this user material id carry the mover. 0 disables. Default 0. */
	platformMaterialId?: bigint | number;
	/** Default true. */
	enableSkirtPogo?: boolean;
	/** Default false. */
	enablePreSolveEvents?: boolean;
	/** Default false. */
	enableSensorEvents?: boolean;
}

export const DYNAMIC_MOVER_DEFAULTS: Readonly<Required<Omit<DynamicMoverDef, 'filter' | 'platformMaterialId'>> & { platformMaterialId: bigint }>;

export interface DynamicMoverCastResult {
	point: b3Vec3;
	normal: b3Vec3;
	bodyId: b3BodyId;
	userMaterialId: bigint;
	fraction: number;
	hit: boolean;
}

export interface DynamicMoverProbe {
	origin: b3Vec3;
	translation: b3Vec3;
	fraction: number;
	hit: boolean;
}

/**
 * Dynamic character mover, ported from box3d's samples/dynamic_mover.cpp. The capsule is a
 * rigid body with locked rotation; a mover joint drives it to the target velocity and a pogo
 * joint holds it above the ground. Tuning fields are public and read on every update.
 */
export class DynamicMover {
	constructor(b3: Box3DModule, worldId: b3WorldId, def?: DynamicMoverDef);

	jumpSpeed: number;
	maxSpeed: number;
	minSpeed: number;
	stopSpeed: number;
	accelerate: number;
	airSteer: number;
	friction: number;
	/** Change with setGravityScale. */
	readonly gravityScale: number;
	maxGroundForce: number;
	maxAirForce: number;
	pogoRestLength: number;
	pogoHertz: number;
	pogoDampingRatio: number;
	pogoCompressionScale: number;
	pogoTensionScale: number;
	enableSkirtPogo: boolean;
	platformMaterialId: bigint;
	/** Surfaces steeper than this are not ground. Default 0.7. */
	minGroundNormalY: number;
	/** Seconds the ground force takes to fade on a surface too steep to walk. Default 0.2. */
	slideDuration: number;

	readonly capsule: b3Capsule;
	readonly filter: b3Filter;
	readonly worldId: b3WorldId;
	/** The mover's dynamic body. */
	readonly bodyId: b3BodyId;
	/** Static anchor body the mover joint attaches to when not on a platform. */
	readonly groundId: b3BodyId;
	readonly surfaceBodyId: b3BodyId;
	readonly moverJointId: b3JointId;
	readonly pogoJointId: b3JointId;

	/** The ground hit used this update. */
	readonly castResult: DynamicMoverCastResult;
	/** Target velocity relative to the base body, as sent to the mover joint. */
	readonly velocity: b3Vec3;
	readonly timeSliding: number;
	readonly onGround: boolean;
	readonly walkable: boolean;
	readonly jumping: boolean;
	readonly jumpTicks: number;
	readonly pogoImpulse: number;
	readonly pogoVelocity: number;
	readonly pogoLength: number;

	/** Pogo rays from the last update: probes[0] is the central ray, then the skirt. */
	readonly probes: readonly DynamicMoverProbe[];
	readonly probeCount: number;
	/** Index of the probe the pogo used. */
	readonly selectedProbe: number;

	/** Call once per step, before b3World_Step. throttle is [forward, right], each on [-1, 1]. */
	update(timeStep: number, forward: b3Vec3, right: b3Vec3, throttle: readonly [number, number], speedScale?: number): void;
	/** Jump if grounded. Returns false when airborne. */
	jump(): boolean;
	/** Release the ground so an external impulse can carry the mover into the air. */
	launch(): void;
	/** Gravity scale also sizes the pogo forces, so change it here. */
	setGravityScale(gravityScale: number): void;
	/** Destroys the mover body and its anchor. Joints go with them. */
	destroy(): void;
}
