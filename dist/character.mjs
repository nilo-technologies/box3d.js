// Dynamic character mover for box3d.js, ported from box3d's samples/dynamic_mover.cpp
// (box3d 3362633, "Dynamic Mover"). The capsule is a rigid body with locked rotation,
// so it collides and is pushed like everything else in the world. A mover joint drives
// it to the target velocity and a pogo joint holds it above the ground so it can climb
// steps without touching the capsule.
//
// Upstream intends this to be vendored and altered for each game. Every tuning value
// is a public field, so change them live, subclass the class, or copy this file.
//
//   import { DynamicMover } from 'box3d.js/character';
//   const mover = new DynamicMover(b3, worldId, { position: [0, 1.5, 0] });
//   // every step, before b3World_Step:
//   if (jumpPressed) mover.jump();
//   mover.update(timeStep, forward, right, [throttleForward, throttleRight]);
//   mover.destroy();
//
// Movement follows the Quake ground and air model:
// https://github.com/id-Software/Quake/blob/master/QW/client/pmove.c#L390
// Inspired by Tom Waterson's presentation: https://www.youtube.com/watch?v=_jRLlTDqoGI

export const SKIRT_COUNT = 8;
const PROBE_CAPACITY = SKIRT_COUNT + 1;

const FLT_EPSILON = 1.1920929e-7;
const FLT_MIN = 1.17549435e-38;
const DODGER_BLUE = 0x1e90ff;

/** Defaults matching DynamicMoverDef in box3d's samples/dynamic_mover.h. */
export const DYNAMIC_MOVER_DEFAULTS = Object.freeze( {
	position: Object.freeze( [ 0, 0, 0 ] ),
	capsule: Object.freeze( { center1: Object.freeze( [ 0, -0.5, 0 ] ), center2: Object.freeze( [ 0, 0.5, 0 ] ), radius: 0.3 } ),
	density: 200,
	jumpSpeed: 7,
	maxSpeed: 6,
	minSpeed: 0.1,
	stopSpeed: 3,
	accelerate: 20,
	airSteer: 0.25,
	friction: 8,
	gravityScale: 1.5,
	maxGroundForce: 6000,
	maxAirForce: 1500,
	pogoRestLength: 0.9,
	pogoHertz: 3,
	pogoDampingRatio: 0.8,
	pogoCompressionScale: 100,
	pogoTensionScale: 100,
	platformMaterialId: 0n,
	enableSkirtPogo: true,
	enablePreSolveEvents: false,
	enableSensorEvents: false,
} );

const nullId = () => ( { index1: 0, world0: 0, generation: 0 } );
const isNonNull = ( id ) => id.index1 !== 0;
const idEquals = ( a, b ) => a.index1 === b.index1 && a.world0 === b.world0 && a.generation === b.generation;
const copyId = ( out, id ) =>
{
	out.index1 = id.index1; out.world0 = id.world0; out.generation = id.generation;
	return out;
};
const copy3 = ( out, v ) =>
{
	out[ 0 ] = v[ 0 ]; out[ 1 ] = v[ 1 ]; out[ 2 ] = v[ 2 ];
	return out;
};

const createCastResult = () => ( {
	point: [ 0, 0, 0 ],
	normal: [ 0, 0, 0 ],
	bodyId: nullId(),
	userMaterialId: 0n,
	fraction: 0,
	hit: false,
} );
const resetCastResult = ( r ) =>
{
	r.point.fill( 0 ); r.normal.fill( 0 ); copyId( r.bodyId, NULL_ID );
	r.userMaterialId = 0n; r.fraction = 0; r.hit = false;
	return r;
};
const copyCastResult = ( out, r ) =>
{
	copy3( out.point, r.point ); copy3( out.normal, r.normal ); copyId( out.bodyId, r.bodyId );
	out.userMaterialId = r.userMaterialId; out.fraction = r.fraction; out.hit = r.hit;
	return out;
};
const NULL_ID = Object.freeze( nullId() );

export class DynamicMover
{
	/**
	 * Creates the mover body, its capsule, a static anchor body and the mover joint.
	 * @param b3 the loaded box3d.js module
	 * @param worldId world to create the mover in
	 * @param def overrides for DYNAMIC_MOVER_DEFAULTS
	 */
	constructor( b3, worldId, def = {} )
	{
		const d = { ...DYNAMIC_MOVER_DEFAULTS, ...def };
		this.b3 = b3;

		this.jumpSpeed = d.jumpSpeed;
		this.maxSpeed = d.maxSpeed;
		this.minSpeed = d.minSpeed;
		this.stopSpeed = d.stopSpeed;
		this.accelerate = d.accelerate;
		// Fraction of the ground acceleration available in the air.
		this.airSteer = d.airSteer;
		// Ground friction in units of 1/time.
		this.friction = d.friction;
		// A character usually wants to fall faster than the rest of the world. Change it
		// with setGravityScale, since it also sizes the pogo forces.
		this.gravityScale = d.gravityScale;
		// Force budget the mover joint has for reaching the target velocity. The air value
		// is small so the character keeps its momentum while jumping.
		this.maxGroundForce = d.maxGroundForce;
		this.maxAirForce = d.maxAirForce;
		this.pogoRestLength = d.pogoRestLength;
		this.pogoHertz = d.pogoHertz;
		this.pogoDampingRatio = d.pogoDampingRatio;
		// Pogo force limits as a multiple of the mover weight.
		this.pogoCompressionScale = d.pogoCompressionScale;
		this.pogoTensionScale = d.pogoTensionScale;
		// Casts an octagon skirt of rays around the capsule when the central ray misses or
		// lands on a surface too steep to walk, so the mover can stand on a ledge or a thin
		// rail, or step off the foot of a steep slope.
		this.enableSkirtPogo = d.enableSkirtPogo;
		// Kinematic bodies whose shapes use this user material id carry the mover along.
		this.platformMaterialId = BigInt( d.platformMaterialId );
		// Surfaces steeper than this are not ground.
		this.minGroundNormalY = 0.7;
		this.slideDuration = 0.2;

		this.capsule = {
			center1: [ ...d.capsule.center1 ],
			center2: [ ...d.capsule.center2 ],
			radius: d.capsule.radius,
		};
		this.filter = d.filter ? { ...d.filter } : b3.b3DefaultFilter();

		this.worldId = worldId;
		this.groundId = nullId();
		this.bodyId = nullId();
		this.surfaceBodyId = nullId();
		this.moverJointId = nullId();
		this.pogoJointId = nullId();

		this.castResult = createCastResult();

		this.velocity = [ 0, 0, 0 ];
		this.timeSliding = 0;
		this.onGround = false;
		this.walkable = false;
		this.jumping = false;
		this.jumpTicks = 0;

		// Pogo joint state, carried across the joint being recreated each update.
		this.pogoImpulse = 0;
		this.pogoVelocity = 0;
		this.pogoLength = 0;

		// Pogo ray cast results for drawing: probes[0] is the central ray, the rest the skirt.
		this.probes = Array.from( { length: PROBE_CAPACITY }, () => ( {
			origin: [ 0, 0, 0 ],
			translation: [ 0, 0, 0 ],
			fraction: 1,
			hit: false,
		} ) );
		this.probeCount = 0;
		this.selectedProbe = 0;

		// Scratch, reused every update.
		this._cast = createCastResult();
		this._skirtCast = createCastResult();
		this._castCallback = ( shapeId, point, normal, fraction, userMaterialId ) =>
		{
			const bodyId = b3.b3Shape_GetBody( shapeId );

			// The probes start inside or on the capsule. Sensors can't hold up the mover.
			if ( idEquals( bodyId, this.bodyId ) || b3.b3Shape_IsSensor( shapeId ) ) return -1;

			const r = this._cast;
			copy3( r.point, point );
			copy3( r.normal, normal );
			copyId( r.bodyId, bodyId );
			r.userMaterialId = userMaterialId ?? 0n;
			r.fraction = fraction;
			r.hit = true;
			return fraction;
		};
		this._queryFilter = { categoryBits: this.filter.categoryBits, maskBits: this.filter.maskBits, id: 0n };
		this._position = [ 0, 0, 0 ];
		this._origin = [ 0, 0, 0 ];
		this._skirtOrigin = [ 0, 0, 0 ];
		this._translation = [ 0, 0, 0 ];
		this._pogoOffset = [ 0, 0, 0 ];
		this._moverVelocity = [ 0, 0, 0 ];
		this._baseVelocity = [ 0, 0, 0 ];
		this._gravity = [ 0, 0, 0 ];
		this._localPoint = [ 0, 0, 0 ];
		this._frameA = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] };
		this._frameB = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] };

		const bodyDef = b3.b3DefaultBodyDef();
		this.groundId = b3.b3CreateBody( worldId, bodyDef );

		// Position is the center of the capsule.
		bodyDef.type = b3.b3BodyType.b3_dynamicBody;
		bodyDef.position = [ ...d.position ];
		bodyDef.gravityScale = this.gravityScale;
		bodyDef.motionLocks.angularX = true;
		bodyDef.motionLocks.angularY = true;
		bodyDef.motionLocks.angularZ = true;
		bodyDef.enableSleep = false;

		this.bodyId = b3.b3CreateBody( worldId, bodyDef );
		b3.b3Body_SetName( this.bodyId, 'mover' );

		const shapeDef = b3.b3DefaultShapeDef();
		shapeDef.density = d.density;

		// The mover joint and the pogo joint handle all the movement, surface friction would
		// fight them.
		shapeDef.baseMaterial.friction = 0;
		shapeDef.baseMaterial.restitution = 0;
		shapeDef.baseMaterial.customColor = DODGER_BLUE;
		shapeDef.filter = { ...this.filter };
		shapeDef.enablePreSolveEvents = d.enablePreSolveEvents;
		shapeDef.enableSensorEvents = d.enableSensorEvents;

		b3.b3CreateCapsuleShape( this.bodyId, shapeDef, this.capsule );

		this._createMoverJoint( this.groundId );
	}

	_createMoverJoint( baseId )
	{
		const b3 = this.b3;
		const moverDef = b3.b3DefaultMoverJointDef();
		moverDef.linearVelocity = [ ...this.velocity ];
		moverDef.maxForce = this.maxGroundForce;
		moverDef.base.bodyIdA = baseId;
		moverDef.base.bodyIdB = this.bodyId;
		moverDef.base.collideConnected = true;

		this.moverJointId = b3.b3CreateMoverJoint( this.worldId, moverDef );
	}

	/** Destroys the mover body and its anchor. Joints go with them. */
	destroy()
	{
		const b3 = this.b3;
		if ( isNonNull( this.bodyId ) ) b3.b3DestroyBody( this.bodyId );
		if ( isNonNull( this.groundId ) ) b3.b3DestroyBody( this.groundId );

		this.groundId = nullId();
		this.bodyId = nullId();

		// Joints are implicitly destroyed.
		this.moverJointId = nullId();
		this.pogoJointId = nullId();
	}

	/** Gravity scale is used to size the pogo forces, so change it here. */
	setGravityScale( gravityScale )
	{
		this.gravityScale = gravityScale;
		if ( isNonNull( this.bodyId ) ) this.b3.b3Body_SetGravityScale( this.bodyId, gravityScale );
	}

	/** Jump if grounded. Returns false when airborne. */
	jump()
	{
		if ( this.onGround === false || this.walkable === false ) return false;

		const b3 = this.b3;
		let surfaceVelocity = 0;
		if ( b3.b3Body_IsValid( this.castResult.bodyId ) )
		{
			surfaceVelocity = b3.b3Body_GetWorldPointVelocity( this._baseVelocity, this.castResult.bodyId, this.castResult.point )[ 1 ];
		}

		const mass = b3.b3Body_GetMass( this.bodyId );
		const vy = b3.b3Body_GetLinearVelocity( this._moverVelocity, this.bodyId )[ 1 ];

		// Remove the pogo constraint velocity but add the surface velocity.
		const dv = Math.max( 0, this.jumpSpeed - vy ) + surfaceVelocity;
		b3.b3Body_ApplyLinearImpulseToCenter( this.bodyId, [ 0, mass * dv, 0 ], true );

		this.launch();
		return true;
	}

	/** Release the ground so an external impulse can carry the mover into the air.
	 * Otherwise the pogo pulls it back down. */
	launch()
	{
		// This removes the pogo step down on the next update.
		this.onGround = false;
		this.walkable = false;
		this.jumping = true;
		this.jumpTicks = 0;
	}

	// onGround - controls friction, mover max force, and pogo step-down extension
	// walkable - controls air steer
	// jumping - blocks the pogo from pulling down

	/**
	 * Advance the mover. Call once per step, before b3World_Step.
	 * @param timeStep step length in seconds
	 * @param forward horizontal forward direction
	 * @param right horizontal right direction
	 * @param throttle input along forward and right, each on [-1, 1]
	 * @param speedScale multiplies maxSpeed (e.g. 0.25 to walk, 1.5 to sprint)
	 */
	update( timeStep, forward, right, throttle, speedScale = 1 )
	{
		const b3 = this.b3;
		const capsule = this.capsule;

		// Reach further while grounded so the spring can find the ground over a step
		const stepDownLength = this.pogoRestLength;
		const rayLength = this.onGround ? this.pogoRestLength + stepDownLength : this.pogoRestLength;
		const translation = this._translation;
		translation[ 0 ] = 0; translation[ 1 ] = -rayLength; translation[ 2 ] = 0;

		const position = b3.b3Body_GetPosition( this._position, this.bodyId );
		const origin = this._origin;
		origin[ 0 ] = position[ 0 ] + capsule.center1[ 0 ];
		origin[ 1 ] = position[ 1 ] + capsule.center1[ 1 ];
		origin[ 2 ] = position[ 2 ] + capsule.center1[ 2 ];

		const queryFilter = this._queryFilter;
		queryFilter.categoryBits = this.filter.categoryBits;
		queryFilter.maskBits = this.filter.maskBits;

		const castResult = this.castResult;
		resetCastResult( this._cast );
		b3.b3World_CastRay( this.worldId, origin, translation, queryFilter, this._castCallback );
		copyCastResult( castResult, this._cast );

		this._setProbe( 0, origin, translation, castResult );
		this.probeCount = 1;
		this.selectedProbe = 0;

		const pogoOffset = this._pogoOffset;
		pogoOffset.fill( 0 );

		const centerWalkable = castResult.hit && castResult.normal[ 1 ] >= this.minGroundNormalY;
		if ( centerWalkable === false && this.enableSkirtPogo )
		{
			// The skirt turns with the direction of travel so ties go to the leading probe
			const moverVelocity = b3.b3Body_GetLinearVelocity( this._moverVelocity, this.bodyId );
			let hx = moverVelocity[ 0 ];
			let hz = moverVelocity[ 2 ];
			if ( hx * hx + hz * hz < FLT_EPSILON )
			{
				hx = 1; hz = 0;
			}

			const headingLength = Math.hypot( hx, hz );
			hx /= headingLength; hz /= headingLength;
			const sx = -hz;
			const sz = hx;

			let bestDisplacement = Infinity;
			for ( let i = 0; i < SKIRT_COUNT; ++i )
			{
				const angle = ( 2 * Math.PI * i ) / SKIRT_COUNT;
				const c = Math.cos( angle );
				const s = Math.sin( angle );
				const ox = capsule.radius * ( c * hx + s * sx );
				const oz = capsule.radius * ( c * hz + s * sz );

				const skirtOrigin = this._skirtOrigin;
				skirtOrigin[ 0 ] = origin[ 0 ] + ox;
				skirtOrigin[ 1 ] = origin[ 1 ];
				skirtOrigin[ 2 ] = origin[ 2 ] + oz;

				resetCastResult( this._cast );
				b3.b3World_CastRay( this.worldId, skirtOrigin, translation, queryFilter, this._castCallback );
				const result = copyCastResult( this._skirtCast, this._cast );

				this._setProbe( this.probeCount, skirtOrigin, translation, result );

				// Use the walkable result that causes the least movement. With none the mover keeps
				// the central hit and slides off the steep surface.
				if ( result.hit && result.normal[ 1 ] >= this.minGroundNormalY )
				{
					const displacement = Math.abs( result.fraction * rayLength - this.pogoRestLength );
					if ( displacement < bestDisplacement )
					{
						bestDisplacement = displacement;
						copyCastResult( castResult, result );
						this.selectedProbe = this.probeCount;
						pogoOffset[ 0 ] = ox; pogoOffset[ 1 ] = 0; pogoOffset[ 2 ] = oz;
					}
				}

				this.probeCount += 1;
			}
		}

		// Should jumping end?
		if ( this.jumping )
		{
			this.jumpTicks += 1;

			// Jump ticks allow time for the jump to leave the ground. Otherwise jumping ends
			// when the character approaches the current ground.
			const v = this.velocity;
			const n = castResult.normal;
			if ( this.jumpTicks > 2 && castResult.hit && v[ 0 ] * n[ 0 ] + v[ 1 ] * n[ 1 ] + v[ 2 ] * n[ 2 ] <= 0 )
			{
				this.jumping = false;
			}
		}

		if ( castResult.hit )
		{
			// Is the ground too steep to walk?
			this.walkable = castResult.normal[ 1 ] >= this.minGroundNormalY;

			// The cast can still hit while jumping.
			this.onGround = this.jumping === false;

			if ( this.onGround )
			{
				if ( this.walkable ) this.timeSliding = Math.max( this.timeSliding - timeStep, 0 );
				else this.timeSliding = Math.min( this.timeSliding + timeStep, this.slideDuration );
			}
		}
		else
		{
			this.onGround = false;
			this.walkable = false;
			this.timeSliding = Math.max( this.timeSliding - timeStep, 0 );
		}

		// Connect the mover joint to platform. Acts like friction.
		let baseId = this.groundId;
		if ( castResult.hit && this.platformMaterialId !== 0n &&
			castResult.userMaterialId === this.platformMaterialId &&
			b3.b3Body_GetType( castResult.bodyId ).value === b3.b3BodyType.b3_kinematicBody.value )
		{
			baseId = castResult.bodyId;
		}

		// The mover joint can be destroyed if attached to a platform that gets destroyed.
		const moverJointValid = b3.b3Joint_IsValid( this.moverJointId );

		if ( moverJointValid === false || idEquals( b3.b3Joint_GetBodyA( this.moverJointId ), baseId ) === false )
		{
			if ( moverJointValid ) b3.b3DestroyJoint( this.moverJointId, false );
			this._createMoverJoint( baseId );
		}

		const velocity = this.velocity;
		b3.b3Body_GetLinearVelocity( velocity, this.bodyId );
		const baseVelocity = b3.b3Body_GetLinearVelocity( this._baseVelocity, baseId );
		velocity[ 0 ] -= baseVelocity[ 0 ];
		velocity[ 1 ] -= baseVelocity[ 1 ];
		velocity[ 2 ] -= baseVelocity[ 2 ];

		// Friction acts in the horizontal plane. The pogo owns the vertical motion.
		if ( this.onGround )
		{
			const speed = Math.sqrt( velocity[ 0 ] * velocity[ 0 ] + velocity[ 2 ] * velocity[ 2 ] );
			if ( speed < this.minSpeed )
			{
				velocity[ 0 ] = 0;
				velocity[ 2 ] = 0;
			}
			else
			{
				// Linear damping above stopSpeed and fixed reduction below stopSpeed
				const control = speed < this.stopSpeed ? this.stopSpeed : speed;

				// friction has units of 1/time
				const drop = control * this.friction * timeStep;
				const newSpeed = Math.max( 0, speed - drop );
				const ratio = newSpeed / speed;
				velocity[ 0 ] *= ratio;
				velocity[ 2 ] *= ratio;
			}
		}

		// Mover force
		let maxForce;
		if ( this.onGround )
		{
			if ( this.slideDuration > 0 )
			{
				const scale = Math.min( Math.max( 1 - this.timeSliding / this.slideDuration, 0 ), 1 );
				maxForce = scale * this.maxGroundForce;
			}
			else
			{
				maxForce = this.walkable ? this.maxGroundForce : 0;
			}
		}
		else
		{
			maxForce = this.maxAirForce;
		}

		b3.b3MoverJoint_SetMaxVelocityForce( this.moverJointId, maxForce );

		const maxSpeed = speedScale * this.maxSpeed;
		const dx = maxSpeed * throttle[ 0 ] * forward[ 0 ] + maxSpeed * throttle[ 1 ] * right[ 0 ];
		const dz = maxSpeed * throttle[ 0 ] * forward[ 2 ] + maxSpeed * throttle[ 1 ] * right[ 2 ];

		// b3GetLengthAndNormalize
		let desiredSpeed = 0;
		let dirX = 0;
		let dirZ = 0;
		const lengthSquared = dx * dx + dz * dz;
		if ( lengthSquared > 1000 * FLT_MIN )
		{
			desiredSpeed = Math.sqrt( lengthSquared );
			dirX = dx / desiredSpeed;
			dirZ = dz / desiredSpeed;
		}

		if ( desiredSpeed > maxSpeed ) desiredSpeed = maxSpeed;

		// Accelerate
		const currentSpeed = velocity[ 0 ] * dirX + velocity[ 2 ] * dirZ;
		const addSpeed = desiredSpeed - currentSpeed;
		if ( addSpeed > 0 )
		{
			const steer = this.walkable ? 1 : this.airSteer;
			let accelSpeed = steer * this.accelerate * maxSpeed * timeStep;
			if ( accelSpeed > addSpeed ) accelSpeed = addSpeed;

			velocity[ 0 ] += accelSpeed * dirX;
			velocity[ 2 ] += accelSpeed * dirZ;
		}

		const n = castResult.normal;
		const isNormalized = Math.abs( 1 - ( n[ 0 ] * n[ 0 ] + n[ 1 ] * n[ 1 ] + n[ 2 ] * n[ 2 ] ) ) < 100 * FLT_EPSILON;
		if ( castResult.hit === true && isNormalized )
		{
			this.pogoLength = castResult.fraction * rayLength;

			const moverMass = b3.b3Body_GetMass( this.bodyId );
			const gravity = b3.b3World_GetGravity( this._gravity, this.worldId );
			const moverWeight = this.gravityScale * Math.hypot( gravity[ 0 ], gravity[ 1 ], gravity[ 2 ] ) * moverMass;

			const pogoJointValid = b3.b3Joint_IsValid( this.pogoJointId );
			const localPoint = b3.b3Body_GetLocalPoint( this._localPoint, castResult.bodyId, castResult.point );

			// Create or recreate the pogo joint as needed.
			if ( idEquals( castResult.bodyId, this.surfaceBodyId ) === false || pogoJointValid === false )
			{
				if ( pogoJointValid )
				{
					this.pogoImpulse = b3.b3PogoJoint_GetImpulse( this.pogoJointId );
					this.pogoVelocity = b3.b3PogoJoint_GetCurrentSpeed( this.pogoJointId );

					b3.b3DestroyJoint( this.pogoJointId, false );
					this.pogoJointId = nullId();
				}

				copyId( this.surfaceBodyId, castResult.bodyId );

				const pogoDef = b3.b3DefaultPogoJointDef();
				pogoDef.base.localFrameA.position = [ ...localPoint ];
				pogoDef.base.localFrameB.position = [
					capsule.center1[ 0 ] + pogoOffset[ 0 ],
					capsule.center1[ 1 ] + pogoOffset[ 1 ],
					capsule.center1[ 2 ] + pogoOffset[ 2 ],
				];
				pogoDef.normal = [ ...n ];
				pogoDef.base.bodyIdA = this.surfaceBodyId;
				pogoDef.base.bodyIdB = this.bodyId;
				pogoDef.base.collideConnected = true;
				pogoDef.restLength = this.pogoRestLength;
				pogoDef.hertz = this.pogoHertz;
				pogoDef.dampingRatio = this.pogoDampingRatio;
				pogoDef.maxCompressionForce = this.pogoCompressionScale * moverWeight;

				// Warm start from the joint that was just destroyed
				pogoDef.impulse = this.pogoImpulse;
				pogoDef.velocity = this.pogoVelocity;

				// Don't allow the pogo to pull down while jumping. Otherwise it can pull down
				// at a multiple of the gravity force.
				pogoDef.maxTensionForce = this.jumping ? 0 : this.pogoTensionScale * moverWeight;

				this.pogoJointId = b3.b3CreatePogoJoint( this.worldId, pogoDef );
			}
			else
			{
				// Preserve the joint, improving performance.
				copy3( this._frameA.position, localPoint );
				b3.b3Joint_SetLocalFrameA( this.pogoJointId, this._frameA );

				const frameB = this._frameB.position;
				frameB[ 0 ] = capsule.center1[ 0 ] + pogoOffset[ 0 ];
				frameB[ 1 ] = capsule.center1[ 1 ] + pogoOffset[ 1 ];
				frameB[ 2 ] = capsule.center1[ 2 ] + pogoOffset[ 2 ];
				b3.b3Joint_SetLocalFrameB( this.pogoJointId, this._frameB );

				b3.b3PogoJoint_SetNormal( this.pogoJointId, n );
				b3.b3PogoJoint_SetMaxTensionForce( this.pogoJointId, this.jumping ? 0 : this.pogoTensionScale * moverWeight );
				b3.b3PogoJoint_SetMaxCompressionForce( this.pogoJointId, this.pogoCompressionScale * moverWeight );
				b3.b3PogoJoint_SetSpringHertz( this.pogoJointId, this.pogoHertz );
				b3.b3PogoJoint_SetSpringDampingRatio( this.pogoJointId, this.pogoDampingRatio );
			}
		}
		else
		{
			if ( b3.b3Joint_IsValid( this.pogoJointId ) )
			{
				b3.b3DestroyJoint( this.pogoJointId, false );
				this.pogoJointId = nullId();
			}

			this.surfaceBodyId = nullId();
			this.pogoImpulse = 0;
			this.pogoVelocity = 0;
			this.pogoLength = 0;
		}

		b3.b3MoverJoint_SetLinearVelocity( this.moverJointId, velocity );
	}

	_setProbe( i, origin, translation, result )
	{
		const probe = this.probes[ i ];
		copy3( probe.origin, origin );
		copy3( probe.translation, translation );
		probe.fraction = result.hit ? result.fraction : 1;
		probe.hit = result.hit;
	}
}
