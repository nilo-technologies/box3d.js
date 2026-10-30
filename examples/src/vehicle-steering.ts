// Steering limit for the vehicle examples: a driver aid, applied to the input before it reaches
// the vehicle. A keyboard gives only full lock or nothing, and the speed falloff in
// b3VehicleSteering is one curve for every speed and grip, so full lock at speed turns the front
// wheels well past the angle where their tires grip best. The fronts then plough, the rears
// follow, and the car slides or spins. This caps the steer angle at the tire's peak slip angle
// from the direction the front axle is travelling, so full lock corners at the grip limit. It
// only ever takes steering away, never adds or reverses it; catching a slide is still the
// driver's (or the counterSteer assist's) job.

import type {
	Box3DModule,
	b3BodyId,
	b3Vec3,
	b3VehicleSteering,
	b3VehicleWheelDef,
} from 'box3d.js';

/** Below this forward speed (m/s) the limit is off, so parking and tight turns keep full lock */
const MIN_SPEED = 3;

// The examples' cars all face +z with +x to their left
const FORWARD: b3Vec3 = [0, 0, 1];
const LEFT: b3Vec3 = [1, 0, 0];

export function createSteeringLimiter(b3: Box3DModule) {
	const center: b3Vec3 = [0, 0, 0];
	const point: b3Vec3 = [0, 0, 0];
	const velocity: b3Vec3 = [0, 0, 0];
	const forward: b3Vec3 = [0, 0, 0];
	const left: b3Vec3 = [0, 0, 0];
	const dot = (a: b3Vec3, b: b3Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

	/** Returns the steer input (1 is full right, -1 full left) with the grip limit applied */
	return function limitSteer(
		chassis: b3BodyId,
		steering: b3VehicleSteering,
		wheels: b3VehicleWheelDef[],
		steer: number,
	): number {
		if (steer === 0) return 0;

		// The front axle center and the smallest peak slip angle among the steered wheels
		let count = 0;
		let peakAngle = Number.POSITIVE_INFINITY;
		center[0] = center[1] = center[2] = 0;
		for (const wheel of wheels) {
			if (wheel.steerFactor === 0) continue;
			center[0] += wheel.position[0];
			center[1] += wheel.position[1];
			center[2] += wheel.position[2];
			peakAngle = Math.min(peakAngle, wheel.tire.lateralPeakAngle);
			count++;
		}
		if (count === 0) return steer;
		center[0] /= count;
		center[1] /= count;
		center[2] /= count;

		b3.b3Body_GetWorldPoint(point, chassis, center);
		b3.b3Body_GetWorldPointVelocity(velocity, chassis, point);
		b3.b3Body_GetWorldVector(forward, chassis, FORWARD);
		b3.b3Body_GetWorldVector(left, chassis, LEFT);
		const vForward = dot(velocity, forward);
		if (vForward < MIN_SPEED) return steer;

		// The steer angle the vehicle would aim for (positive is left), with its speed falloff
		const x =
			steering.speedReference > 0 ? vForward / steering.speedReference : 0;
		const maxAngle = steering.maxAngle / (1 + x * x);
		if (maxAngle <= 0) return steer;
		let angle = -steer * maxAngle;

		// The direction the front axle travels, measured as the vehicle measures slip angle:
		// atan2(lateral, |forward| + 1 m/s). The tire's peak angle is defined on that measure, so
		// dropping the 1 m/s here would make the limit a different angle from the tire's peak.
		const travel = Math.atan2(dot(velocity, left), vForward + 1);
		if (angle > 0) angle = Math.min(angle, Math.max(travel + peakAngle, 0));
		else angle = Math.max(angle, Math.min(travel - peakAngle, 0));
		return -angle / maxAngle;
	};
}
