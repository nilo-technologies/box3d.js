// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export interface b3BodyTypeValue<T extends number> {
  value: T;
}
export type b3BodyType = b3BodyTypeValue<0>|b3BodyTypeValue<1>|b3BodyTypeValue<2>;

export interface b3ShapeTypeValue<T extends number> {
  value: T;
}
export type b3ShapeType = b3ShapeTypeValue<0>|b3ShapeTypeValue<1>|b3ShapeTypeValue<2>|b3ShapeTypeValue<3>|b3ShapeTypeValue<4>|b3ShapeTypeValue<5>;

export interface DebugShapeStateValue<T extends number> {
  value: T;
}
export type DebugShapeState = DebugShapeStateValue<0>|DebugShapeStateValue<1>|DebugShapeStateValue<2>|DebugShapeStateValue<3>|DebugShapeStateValue<4>|DebugShapeStateValue<5>|DebugShapeStateValue<6>|DebugShapeStateValue<7>|DebugShapeStateValue<8>|DebugShapeStateValue<9>|DebugShapeStateValue<10>|DebugShapeStateValue<11>|DebugShapeStateValue<12>;

export interface DebugDrawRoleValue<T extends number> {
  value: T;
}
export type DebugDrawRole = DebugDrawRoleValue<0>|DebugDrawRoleValue<1>|DebugDrawRoleValue<2>|DebugDrawRoleValue<3>|DebugDrawRoleValue<4>|DebugDrawRoleValue<5>|DebugDrawRoleValue<6>|DebugDrawRoleValue<7>|DebugDrawRoleValue<8>|DebugDrawRoleValue<9>;

export interface b3JointTypeValue<T extends number> {
  value: T;
}
export type b3JointType = b3JointTypeValue<0>|b3JointTypeValue<1>|b3JointTypeValue<2>|b3JointTypeValue<3>|b3JointTypeValue<4>|b3JointTypeValue<5>|b3JointTypeValue<6>|b3JointTypeValue<7>|b3JointTypeValue<8>|b3JointTypeValue<9>|b3JointTypeValue<10>|b3JointTypeValue<11>|b3JointTypeValue<12>;

export interface b3HullData extends ClassHandle {
}

export interface b3MeshData extends ClassHandle {
}

export interface b3CompoundData extends ClassHandle {
}

export interface b3HeightFieldData extends ClassHandle {
}

export interface b3TOIStateValue<T extends number> {
  value: T;
}
export type b3TOIState = b3TOIStateValue<0>|b3TOIStateValue<1>|b3TOIStateValue<2>|b3TOIStateValue<3>|b3TOIStateValue<4>;

export interface ContactsBufferImpl extends ClassHandle {
  loadFromBody(_0: b3BodyId): void;
  loadFromShape(_0: b3ShapeId): void;
  count(): number;
  contactsPtr(): number;
  manifoldsF32Ptr(): number;
  manifoldsI32Ptr(): number;
  pointsF32Ptr(): number;
  pointsI32Ptr(): number;
}

export interface b3ShapeIdVector extends ClassHandle, Iterable<b3ShapeId> {
  push_back(_0: b3ShapeId): void;
  resize(_0: number, _1: b3ShapeId): void;
  size(): number;
  get(_0: number): b3ShapeId | undefined;
  set(_0: number, _1: b3ShapeId): boolean;
}

export interface b3JointIdVector extends ClassHandle, Iterable<b3JointId> {
  push_back(_0: b3JointId): void;
  resize(_0: number, _1: b3JointId): void;
  size(): number;
  get(_0: number): b3JointId | undefined;
  set(_0: number, _1: b3JointId): boolean;
}

export interface EventsBufferImpl extends ClassHandle {
  loadFrom(_0: b3WorldId): void;
  contactBeginCount(): number;
  contactEndCount(): number;
  contactHitCount(): number;
  bodyMoveCount(): number;
  sensorBeginCount(): number;
  sensorEndCount(): number;
  jointCount(): number;
  contactBeginPtr(): number;
  contactEndPtr(): number;
  contactHitI32Ptr(): number;
  contactHitF64Ptr(): number;
  bodyMoveI32Ptr(): number;
  bodyMoveF64Ptr(): number;
  sensorBeginPtr(): number;
  sensorEndPtr(): number;
  jointPtr(): number;
}

export interface b3DynamicTree extends ClassHandle {
}

export interface DebugDrawBufferImpl extends ClassHandle {
  shapeCount(): number;
  segmentCount(): number;
  pointCount(): number;
  sphereCount(): number;
  capsuleCount(): number;
  boxCount(): number;
  boundsCount(): number;
  transformCount(): number;
  shapeI32Ptr(): number;
  shapeF64Ptr(): number;
  segmentI32Ptr(): number;
  segmentF64Ptr(): number;
  pointI32Ptr(): number;
  pointF32Ptr(): number;
  pointF64Ptr(): number;
  sphereI32Ptr(): number;
  sphereF32Ptr(): number;
  sphereF64Ptr(): number;
  capsuleI32Ptr(): number;
  capsuleF32Ptr(): number;
  capsuleF64Ptr(): number;
  boxI32Ptr(): number;
  boxF32Ptr(): number;
  boxF64Ptr(): number;
  boundsI32Ptr(): number;
  boundsF64Ptr(): number;
  transformI32Ptr(): number;
  transformF64Ptr(): number;
  loadFrom(_0: b3WorldId, _1: any): void;
}

export interface b3VehicleCastTypeValue<T extends number> {
  value: T;
}
export type b3VehicleCastType = b3VehicleCastTypeValue<0>|b3VehicleCastTypeValue<1>|b3VehicleCastTypeValue<2>;

export interface b3VehicleTransmissionModeValue<T extends number> {
  value: T;
}
export type b3VehicleTransmissionMode = b3VehicleTransmissionModeValue<0>|b3VehicleTransmissionModeValue<1>;

export interface VehicleStateBufferImpl extends ClassHandle {
  load(_0: b3VehicleId): void;
  wheelCount(): number;
  i32Ptr(): number;
  f32Ptr(): number;
  f64Ptr(): number;
}

export type b3MotionLocks = {
  linearX: boolean,
  linearY: boolean,
  linearZ: boolean,
  angularX: boolean,
  angularY: boolean,
  angularZ: boolean
};

export type b3WorldId = {
  index1: number,
  generation: number
};

export type Version = {
  major: number,
  minor: number,
  revision: number
};

export type b3BodyId = {
  index1: number,
  world0: number,
  generation: number
};

export type b3ShapeId = {
  index1: number,
  world0: number,
  generation: number
};

export type b3SensorBeginTouchEvent = {
  sensorShapeId: b3ShapeId,
  visitorShapeId: b3ShapeId
};

export type b3SensorEndTouchEvent = {
  sensorShapeId: b3ShapeId,
  visitorShapeId: b3ShapeId
};

export type b3JointId = {
  index1: number,
  world0: number,
  generation: number
};

export type b3JointEvent = {
  jointId: b3JointId
};

export type b3Capacity = {
  staticShapeCount: number,
  dynamicShapeCount: number,
  staticBodyCount: number,
  dynamicBodyCount: number,
  contactCount: number
};

export type b3TreeStats = {
  nodeVisits: number,
  leafVisits: number
};

export type b3VehicleId = {
  index1: number,
  world0: number,
  generation: number
};

export type b3ContactId = {
  index1: number,
  world0: number,
  padding: number,
  generation: number
};

export type b3ContactBeginTouchEvent = {
  shapeIdA: b3ShapeId,
  shapeIdB: b3ShapeId,
  contactId: b3ContactId
};

export type b3ContactEndTouchEvent = {
  shapeIdA: b3ShapeId,
  shapeIdB: b3ShapeId,
  contactId: b3ContactId
};

export type b3Counters = {
  bodyCount: number,
  shapeCount: number,
  contactCount: number,
  jointCount: number,
  islandCount: number,
  stackUsed: number,
  byteCount: bigint,
  taskCount: number,
  awakeContactCount: number,
  treeHeight: number,
  staticTreeHeight: number
};

export type b3Filter = {
  categoryBits: bigint,
  maskBits: bigint,
  groupIndex: number
};

export type b3QueryFilter = {
  categoryBits: bigint,
  maskBits: bigint,
  id: bigint
};

export type b3Vec3 = [ number, number, number ];

export type b3PlaneSolverResult = {
  delta: b3Vec3,
  iterationCount: number
};

export type b3Matrix3 = {
  cx: b3Vec3,
  cy: b3Vec3,
  cz: b3Vec3
};

export type b3Quat = [ number, number, number, number ];

export type b3Transform = {
  position: b3Vec3,
  quaternion: b3Quat
};

export type b3BodyMoveEvent = {
  transform: b3Transform,
  bodyId: b3BodyId,
  fellAsleep: boolean
};

export type b3Sweep = {
  localCenter: b3Vec3,
  c1: b3Vec3,
  c2: b3Vec3,
  q1: b3Quat,
  q2: b3Quat
};

export type b3AABB = [ number, number, number, number, number, number ];

export type b3Plane = {
  normal: b3Vec3,
  offset: number
};

export type b3PlaneResult = {
  plane: b3Plane,
  point: b3Vec3,
  triangleIndex: number,
  childIndex: number,
  materialIndex: number
};

export type b3Sphere = {
  center: b3Vec3,
  radius: number
};

export type b3Capsule = {
  center1: b3Vec3,
  center2: b3Vec3,
  radius: number
};

export type b3SurfaceMaterial = {
  friction: number,
  restitution: number,
  rollingResistance: number,
  tangentVelocity: b3Vec3,
  userMaterialId: bigint,
  customColor: number
};

export type b3WorldDef = {
  gravity: b3Vec3,
  restitutionThreshold: number,
  restitutionIterations: number,
  enableRestitutionPropagation: boolean,
  hitEventThreshold: number,
  contactHertz: number,
  contactDampingRatio: number,
  contactSpeed: number,
  maximumLinearSpeed: number,
  isotropicInertiaTolerance: number,
  enableSleep: boolean,
  enableContinuous: boolean,
  workerCount: number,
  capacity: b3Capacity,
  internalValue: number
};

export type b3BodyDef = {
  type: b3BodyType,
  position: b3Vec3,
  rotation: b3Quat,
  linearVelocity: b3Vec3,
  angularVelocity: b3Vec3,
  linearDamping: number,
  angularDamping: number,
  gravityScale: number,
  sleepThreshold: number,
  safetyFactor: number,
  motionLocks: b3MotionLocks,
  enableSleep: boolean,
  isAwake: boolean,
  isBullet: boolean,
  isEnabled: boolean,
  allowFastRotation: boolean,
  enableContactRecycling: boolean,
  internalValue: number
};

export type b3ShapeDef = {
  baseMaterial: b3SurfaceMaterial,
  density: number,
  explosionScale: number,
  filter: b3Filter,
  enableCustomFiltering: boolean,
  isSensor: boolean,
  enableSensorEvents: boolean,
  enableContactEvents: boolean,
  enableHitEvents: boolean,
  enablePreSolveEvents: boolean,
  invokeContactCreation: boolean,
  updateBodyMass: boolean,
  enableSpeculativeContact: boolean,
  meshRestOffset: number,
  internalValue: number
};

export type b3CollisionPlane = {
  plane: b3Plane,
  pushLimit: number,
  push: number,
  clipVelocity: boolean
};

export type b3DistanceOutput = {
  pointA: b3Vec3,
  pointB: b3Vec3,
  normal: b3Vec3,
  distance: number,
  iterations: number,
  simplexCount: number
};

export type b3TOIOutput = {
  state: b3TOIState,
  point: b3Vec3,
  normal: b3Vec3,
  fraction: number,
  distance: number,
  distanceIterations: number,
  pushBackIterations: number,
  rootIterations: number,
  usedFallback: boolean
};

export type b3Profile = {
  step: number,
  pairs: number,
  collide: number,
  solve: number,
  solverSetup: number,
  constraints: number,
  prepareConstraints: number,
  integrateVelocities: number,
  warmStart: number,
  solveImpulses: number,
  integratePositions: number,
  relaxImpulses: number,
  restitution: number,
  storeImpulses: number,
  splitIslands: number,
  transforms: number,
  sensorHits: number,
  jointEvents: number,
  hitEvents: number,
  refit: number,
  bullets: number,
  sleepIslands: number,
  sensors: number
};

export type b3ExplosionDef = {
  maskBits: bigint,
  position: b3Vec3,
  radius: number,
  falloff: number,
  impulsePerArea: number
};

export type b3BodyCastResult = {
  shapeId: b3ShapeId,
  point: b3Vec3,
  normal: b3Vec3,
  fraction: number,
  triangleIndex: number,
  iterations: number,
  hit: boolean
};

export type b3JointDef = {
  bodyIdA: b3BodyId,
  bodyIdB: b3BodyId,
  localFrameA: b3Transform,
  localFrameB: b3Transform,
  forceThreshold: number,
  torqueThreshold: number,
  constraintHertz: number,
  constraintDampingRatio: number,
  drawScale: number,
  collideConnected: boolean,
  internalValue: number
};

export type b3FilterJointDef = {
  base: b3JointDef
};

export type b3DistanceJointDef = {
  base: b3JointDef,
  length: number,
  enableSpring: boolean,
  lowerSpringForce: number,
  upperSpringForce: number,
  hertz: number,
  dampingRatio: number,
  enableLimit: boolean,
  minLength: number,
  maxLength: number,
  enableMotor: boolean,
  maxMotorForce: number,
  motorSpeed: number,
  springStiffness: number,
  springDamping: number
};

export type b3RevoluteJointDef = {
  base: b3JointDef,
  targetAngle: number,
  enableSpring: boolean,
  hertz: number,
  dampingRatio: number,
  enableLimit: boolean,
  lowerAngle: number,
  upperAngle: number,
  enableMotor: boolean,
  maxMotorTorque: number,
  motorSpeed: number
};

export type b3PrismaticJointDef = {
  base: b3JointDef,
  enableSpring: boolean,
  hertz: number,
  dampingRatio: number,
  targetTranslation: number,
  enableLimit: boolean,
  lowerTranslation: number,
  upperTranslation: number,
  enableMotor: boolean,
  maxMotorForce: number,
  motorSpeed: number
};

export type b3CylindricalJointDef = {
  base: b3JointDef,
  localSlideAxisA: b3Vec3,
  enableSpring: boolean,
  hertz: number,
  dampingRatio: number,
  targetTranslation: number,
  enableLimit: boolean,
  lowerTranslation: number,
  upperTranslation: number,
  enableMotor: boolean,
  maxMotorForce: number,
  motorSpeed: number,
  enableAngularSpring: boolean,
  angularHertz: number,
  angularDampingRatio: number,
  targetAngle: number,
  enableAngularLimit: boolean,
  lowerAngle: number,
  upperAngle: number,
  enableAngularMotor: boolean,
  maxMotorTorque: number,
  angularMotorSpeed: number
};

export type b3MoverJointDef = {
  base: b3JointDef,
  linearVelocity: b3Vec3,
  maxForce: number
};

export type b3PogoJointDef = {
  base: b3JointDef,
  normal: b3Vec3,
  hertz: number,
  dampingRatio: number,
  restLength: number,
  maxTensionForce: number,
  maxCompressionForce: number,
  impulse: number,
  velocity: number
};

export type b3WheelJointDef = {
  base: b3JointDef,
  enableSuspensionSpring: boolean,
  suspensionHertz: number,
  suspensionDampingRatio: number,
  enableSuspensionLimit: boolean,
  lowerSuspensionLimit: number,
  upperSuspensionLimit: number,
  enableSpinMotor: boolean,
  maxSpinTorque: number,
  spinSpeed: number,
  enableSteering: boolean,
  steeringHertz: number,
  steeringDampingRatio: number,
  targetSteeringAngle: number,
  maxSteeringTorque: number,
  enableSteeringLimit: boolean,
  lowerSteeringLimit: number,
  upperSteeringLimit: number
};

export type b3WeldJointDef = {
  base: b3JointDef,
  linearHertz: number,
  angularHertz: number,
  linearDampingRatio: number,
  angularDampingRatio: number
};

export type b3SphericalJointDef = {
  base: b3JointDef,
  enableSpring: boolean,
  hertz: number,
  dampingRatio: number,
  targetRotation: b3Quat,
  enableConeLimit: boolean,
  coneAngle: number,
  enableTwistLimit: boolean,
  lowerTwistAngle: number,
  upperTwistAngle: number,
  enableMotor: boolean,
  maxMotorTorque: number,
  motorVelocity: b3Vec3
};

export type b3MotorJointDef = {
  base: b3JointDef,
  linearVelocity: b3Vec3,
  maxVelocityForce: number,
  angularVelocity: b3Vec3,
  maxVelocityTorque: number,
  linearHertz: number,
  linearDampingRatio: number,
  maxSpringForce: number,
  angularHertz: number,
  angularDampingRatio: number,
  maxSpringTorque: number
};

export type b3ParallelJointDef = {
  base: b3JointDef,
  hertz: number,
  dampingRatio: number,
  maxTorque: number
};

export type b3MassData = {
  mass: number,
  center: b3Vec3,
  inertia: b3Matrix3
};

export type b3RayResult = {
  shapeId: b3ShapeId,
  point: b3Vec3,
  normal: b3Vec3,
  userMaterialId: bigint,
  fraction: number,
  triangleIndex: number,
  childIndex: number,
  nodeVisits: number,
  leafVisits: number,
  hit: boolean
};

export type b3WorldCastOutput = {
  normal: b3Vec3,
  point: b3Vec3,
  fraction: number,
  iterations: number,
  triangleIndex: number,
  childIndex: number,
  materialIndex: number,
  hit: boolean
};

export type b3ContactHitEvent = {
  shapeIdA: b3ShapeId,
  shapeIdB: b3ShapeId,
  contactId: b3ContactId,
  point: b3Vec3,
  normal: b3Vec3,
  approachSpeed: number,
  userMaterialIdA: bigint,
  userMaterialIdB: bigint
};

export type b3VehicleSuspension = {
  minLength: number,
  maxLength: number,
  preload: number,
  frequency: number,
  compressionDamping: number,
  reboundDamping: number,
  enableBumpStop: boolean
};

export type b3VehicleTire = {
  longitudinalPeakSlip: number,
  longitudinalPeakFriction: number,
  longitudinalSlideSlip: number,
  longitudinalSlideFriction: number,
  lateralPeakAngle: number,
  lateralPeakFriction: number,
  lateralSlideAngle: number,
  lateralSlideFriction: number,
  rollingResistance: number
};

export type b3VehicleWheelDef = {
  position: b3Vec3,
  radius: number,
  width: number,
  inertia: number,
  steerFactor: number,
  maxBrakeTorque: number,
  maxHandBrakeTorque: number,
  angularDamping: number,
  castType: b3VehicleCastType,
  suspension: b3VehicleSuspension,
  tire: b3VehicleTire
};

export type b3VehicleWheels = [ b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef, b3VehicleWheelDef ];

export type b3VehicleChassis = {
  mass: number,
  autoCenterOfMass: boolean,
  centerOfMassOffset: b3Vec3,
  forward: b3Vec3,
  up: b3Vec3,
  maxSlopeAngle: number,
  castFilter: b3QueryFilter
};

export type b3VehicleEngine = {
  maxTorque: number,
  peakTorqueRpm: number,
  idleTorqueScale: number,
  maxRpmTorqueScale: number,
  idleRpm: number,
  maxRpm: number,
  inertia: number,
  angularDamping: number
};

export type b3VehicleTurboStage = {
  gain: number,
  spoolRpm: number,
  fullBoostRpm: number,
  spoolTime: number,
  bleedTime: number
};

export type b3VehicleTurboStages = [ b3VehicleTurboStage, b3VehicleTurboStage ];

export type b3VehicleTurbo = {
  stages: b3VehicleTurboStages,
  instantFraction: number,
  parasiticTorque: number,
  antiLag: boolean
};

export type b3VehicleGearRatios = [ number, number, number, number, number, number, number, number ];

export type b3VehicleTransmission = {
  mode: b3VehicleTransmissionMode,
  gearRatios: b3VehicleGearRatios,
  gearCount: number,
  reverseRatio: number,
  finalDrive: number,
  shiftUpRpm: number,
  shiftDownRpm: number,
  shiftTime: number,
  clutchReleaseTime: number,
  shiftLatency: number,
  clutchStrength: number
};

export type b3VehicleDifferential = {
  leftWheel: number,
  rightWheel: number,
  torqueRatio: number,
  leftRightSplit: number,
  limitedSlipRatio: number
};

export type b3VehicleDifferentials = [ b3VehicleDifferential, b3VehicleDifferential, b3VehicleDifferential, b3VehicleDifferential ];

export type b3VehicleDrivetrain = {
  differentials: b3VehicleDifferentials,
  differentialCount: number,
  centerLimitedSlipRatio: number
};

export type b3VehicleAntiRollBar = {
  leftWheel: number,
  rightWheel: number,
  stiffness: number
};

export type b3VehicleAntiRollBars = [ b3VehicleAntiRollBar, b3VehicleAntiRollBar, b3VehicleAntiRollBar, b3VehicleAntiRollBar ];

export type b3VehicleAntiRoll = {
  bars: b3VehicleAntiRollBars,
  barCount: number
};

export type b3VehicleSteering = {
  maxAngle: number,
  speedReference: number,
  steerSpeed: number,
  returnSpeed: number,
  ackermann: number
};

export type b3VehicleAssists = {
  counterSteer: number,
  driftGripScale: number,
  tractionControl: boolean,
  abs: boolean,
  downforce: number,
  drag: number,
  rollInfluence: number,
  airControl: number,
  airAngularDamping: number,
  selfRighting: number,
  maxTiltAngle: number,
  stickyTire: boolean,
  stickySpeed: number,
  stickyTime: number,
  brakeReverse: boolean
};

export type b3VehicleDef = {
  chassisId: b3BodyId,
  chassis: b3VehicleChassis,
  wheels: b3VehicleWheels,
  wheelCount: number,
  engine: b3VehicleEngine,
  turbo: b3VehicleTurbo,
  transmission: b3VehicleTransmission,
  drivetrain: b3VehicleDrivetrain,
  antiRoll: b3VehicleAntiRoll,
  steering: b3VehicleSteering,
  assists: b3VehicleAssists,
  internalValue: number
};

export type b3VehicleInput = {
  forward: number,
  brake: number,
  steer: number,
  handbrake: number
};

export type b3VehicleState = {
  speed: number,
  engineRpm: number,
  boost: number,
  gear: number,
  isShifting: boolean,
  throttle: number,
  brake: number,
  steerAngle: number,
  wheelsInContact: number,
  stuck: boolean
};

export type b3VehicleWheelState = {
  hasContact: boolean,
  contactPoint: b3Vec3,
  contactNormal: b3Vec3,
  groundShapeId: b3ShapeId,
  userMaterialId: bigint,
  suspensionLength: number,
  compression: number,
  load: number,
  longitudinalForce: number,
  lateralForce: number,
  slipRatio: number,
  slipAngle: number,
  angularVelocity: number,
  rotationAngle: number,
  steerAngle: number,
  driveTorque: number,
  brakeTorque: number,
  isSticky: boolean
};

interface EmbindModule {
  b3BodyType: {b3_staticBody: b3BodyTypeValue<0>, b3_kinematicBody: b3BodyTypeValue<1>, b3_dynamicBody: b3BodyTypeValue<2>};
  b3ShapeType: {b3_capsuleShape: b3ShapeTypeValue<0>, b3_compoundShape: b3ShapeTypeValue<1>, b3_heightShape: b3ShapeTypeValue<2>, b3_hullShape: b3ShapeTypeValue<3>, b3_meshShape: b3ShapeTypeValue<4>, b3_sphereShape: b3ShapeTypeValue<5>};
  DebugShapeState: {static: DebugShapeStateValue<0>, kinematic: DebugShapeStateValue<1>, kinematicSleeping: DebugShapeStateValue<2>, awake: DebugShapeStateValue<3>, sleeping: DebugShapeStateValue<4>, sensor: DebugShapeStateValue<5>, disabled: DebugShapeStateValue<6>, fast: DebugShapeStateValue<7>, bullet: DebugShapeStateValue<8>, speedCapped: DebugShapeStateValue<9>, timeOfImpact: DebugShapeStateValue<10>, invalidMass: DebugShapeStateValue<11>, custom: DebugShapeStateValue<12>};
  DebugDrawRole: {bounds: DebugDrawRoleValue<0>, joints: DebugDrawRoleValue<1>, mass: DebugDrawRoleValue<2>, contactPoints: DebugDrawRoleValue<3>, contactNormals: DebugDrawRoleValue<4>, contactForces: DebugDrawRoleValue<5>, frictionForces: DebugDrawRoleValue<6>, contactFeatures: DebugDrawRoleValue<7>, islands: DebugDrawRoleValue<8>, graphColors: DebugDrawRoleValue<9>};
  b3JointType: {b3_parallelJoint: b3JointTypeValue<0>, b3_distanceJoint: b3JointTypeValue<1>, b3_filterJoint: b3JointTypeValue<2>, b3_motorJoint: b3JointTypeValue<3>, b3_prismaticJoint: b3JointTypeValue<4>, b3_revoluteJoint: b3JointTypeValue<5>, b3_sphericalJoint: b3JointTypeValue<6>, b3_weldJoint: b3JointTypeValue<7>, b3_wheelJoint: b3JointTypeValue<8>, b3_moverJoint: b3JointTypeValue<9>, b3_pogoJoint: b3JointTypeValue<10>, b3_vehicleWheelJoint: b3JointTypeValue<11>, b3_cylindricalJoint: b3JointTypeValue<12>};
  b3HullData: {};
  b3MeshData: {};
  b3CompoundData: {};
  b3HeightFieldData: {};
  b3TOIState: {b3_toiStateUnknown: b3TOIStateValue<0>, b3_toiStateFailed: b3TOIStateValue<1>, b3_toiStateOverlapped: b3TOIStateValue<2>, b3_toiStateHit: b3TOIStateValue<3>, b3_toiStateSeparated: b3TOIStateValue<4>};
  ContactsBufferImpl: {
    new(): ContactsBufferImpl;
  };
  b3ShapeIdVector: {
    new(): b3ShapeIdVector;
  };
  b3JointIdVector: {
    new(): b3JointIdVector;
  };
  EventsBufferImpl: {
    new(): EventsBufferImpl;
  };
  b3DynamicTree: {};
  DebugDrawBufferImpl: {
    new(): DebugDrawBufferImpl;
  };
  b3VehicleCastType: {b3_vehicleCastCylinder: b3VehicleCastTypeValue<0>, b3_vehicleCastSphere: b3VehicleCastTypeValue<1>, b3_vehicleCastRay: b3VehicleCastTypeValue<2>};
  b3VehicleTransmissionMode: {b3_vehicleTransmissionAuto: b3VehicleTransmissionModeValue<0>, b3_vehicleTransmissionManual: b3VehicleTransmissionModeValue<1>};
  VehicleStateBufferImpl: {
    new(): VehicleStateBufferImpl;
  };
  b3DestroyHull(hull: b3HullData | null): void;
  b3DestroyMesh(mesh: b3MeshData | null): void;
  b3DestroyCompound(compound: b3CompoundData | null): void;
  b3DestroyHeightField(heightField: b3HeightFieldData | null): void;
  b3DestroyDynamicTree(tree: b3DynamicTree | null): void;
  b3DynamicTree_Validate(tree: b3DynamicTree | null): void;
  b3IsDoublePrecision(): boolean;
  b3HasThreads(): boolean;
  b3DestroyWorld(worldId: b3WorldId): void;
  b3World_IsValid(worldId: b3WorldId): boolean;
  b3World_EnableSleeping(worldId: b3WorldId, flag: boolean): void;
  b3World_IsSleepingEnabled(worldId: b3WorldId): boolean;
  b3World_EnableContinuous(worldId: b3WorldId, flag: boolean): void;
  b3World_IsContinuousEnabled(worldId: b3WorldId): boolean;
  b3World_EnableRestitutionPropagation(worldId: b3WorldId, flag: boolean): void;
  b3World_IsRestitutionPropagationEnabled(worldId: b3WorldId): boolean;
  b3World_EnableWarmStarting(worldId: b3WorldId, flag: boolean): void;
  b3World_IsWarmStartingEnabled(worldId: b3WorldId): boolean;
  b3World_EnableSpeculative(worldId: b3WorldId, flag: boolean): void;
  b3World_StopRecording(worldId: b3WorldId): void;
  b3GetVersion(): Version;
  b3DestroyBody(bodyId: b3BodyId): void;
  b3Body_IsValid(id: b3BodyId): boolean;
  b3Body_GetType(bodyId: b3BodyId): b3BodyType;
  b3Body_SetType(bodyId: b3BodyId, type: b3BodyType): void;
  b3Body_ClearConstantForces(bodyId: b3BodyId): void;
  b3Body_ApplyMassFromShapes(bodyId: b3BodyId): void;
  b3Body_IsAwake(bodyId: b3BodyId): boolean;
  b3Body_SetAwake(bodyId: b3BodyId, awake: boolean): void;
  b3Body_EnableSleep(bodyId: b3BodyId, enableSleep: boolean): void;
  b3Body_IsSleepEnabled(bodyId: b3BodyId): boolean;
  b3Body_IsEnabled(bodyId: b3BodyId): boolean;
  b3Body_Disable(bodyId: b3BodyId): void;
  b3Body_Enable(bodyId: b3BodyId): void;
  b3Body_SetMotionLocks(bodyId: b3BodyId, locks: b3MotionLocks): void;
  b3Body_GetMotionLocks(bodyId: b3BodyId): b3MotionLocks;
  b3Body_SetBullet(bodyId: b3BodyId, flag: boolean): void;
  b3Body_IsBullet(bodyId: b3BodyId): boolean;
  b3Body_EnableContactRecycling(bodyId: b3BodyId, flag: boolean): void;
  b3Body_IsContactRecyclingEnabled(bodyId: b3BodyId): boolean;
  b3Body_EnableHitEvents(bodyId: b3BodyId, enableHitEvents: boolean): void;
  b3Body_AllowFastRotation(bodyId: b3BodyId, flag: boolean): void;
  b3Body_IsFastRotationAllowed(bodyId: b3BodyId): boolean;
  b3Body_GetWorld(bodyId: b3BodyId): b3WorldId;
  b3Body_GetShapes(bodyId: b3BodyId): b3ShapeIdVector;
  b3Body_GetJoints(bodyId: b3BodyId): b3JointIdVector;
  b3Shape_IsValid(id: b3ShapeId): boolean;
  b3Shape_GetType(shapeId: b3ShapeId): b3ShapeType;
  b3Shape_GetBody(shapeId: b3ShapeId): b3BodyId;
  b3Shape_GetWorld(shapeId: b3ShapeId): b3WorldId;
  b3Shape_IsSensor(shapeId: b3ShapeId): boolean;
  b3Shape_EnableSensorEvents(shapeId: b3ShapeId, flag: boolean): void;
  b3Shape_AreSensorEventsEnabled(shapeId: b3ShapeId): boolean;
  b3Shape_EnableContactEvents(shapeId: b3ShapeId, flag: boolean): void;
  b3Shape_AreContactEventsEnabled(shapeId: b3ShapeId): boolean;
  b3Shape_EnablePreSolveEvents(shapeId: b3ShapeId, flag: boolean): void;
  b3Shape_ArePreSolveEventsEnabled(shapeId: b3ShapeId): boolean;
  b3Shape_EnableHitEvents(shapeId: b3ShapeId, flag: boolean): void;
  b3Shape_AreHitEventsEnabled(shapeId: b3ShapeId): boolean;
  b3Shape_SetHull(shapeId: b3ShapeId, hull: b3HullData | null): void;
  b3Shape_Enable(shapeId: b3ShapeId): void;
  b3Shape_Disable(shapeId: b3ShapeId): void;
  b3Shape_IsEnabled(shapeId: b3ShapeId): boolean;
  b3DestroyShape(shapeId: b3ShapeId, updateBodyMass: boolean): void;
  b3DestroyJoint(jointId: b3JointId, wakeAttached: boolean): void;
  b3Joint_IsValid(id: b3JointId): boolean;
  b3Joint_GetType(jointId: b3JointId): b3JointType;
  b3Joint_GetBodyA(jointId: b3JointId): b3BodyId;
  b3Joint_GetBodyB(jointId: b3JointId): b3BodyId;
  b3Joint_GetWorld(jointId: b3JointId): b3WorldId;
  b3Joint_SetCollideConnected(jointId: b3JointId, shouldCollide: boolean): void;
  b3Joint_GetCollideConnected(jointId: b3JointId): boolean;
  b3Joint_WakeBodies(jointId: b3JointId): void;
  b3Joint_IsAwake(jointId: b3JointId): boolean;
  b3DistanceJoint_EnableSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3DistanceJoint_IsSpringEnabled(jointId: b3JointId): boolean;
  b3DistanceJoint_EnableLimit(jointId: b3JointId, enableLimit: boolean): void;
  b3DistanceJoint_IsLimitEnabled(jointId: b3JointId): boolean;
  b3DistanceJoint_EnableMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3DistanceJoint_IsMotorEnabled(jointId: b3JointId): boolean;
  b3PrismaticJoint_EnableSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3PrismaticJoint_IsSpringEnabled(jointId: b3JointId): boolean;
  b3PrismaticJoint_EnableLimit(jointId: b3JointId, enableLimit: boolean): void;
  b3PrismaticJoint_IsLimitEnabled(jointId: b3JointId): boolean;
  b3PrismaticJoint_EnableMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3PrismaticJoint_IsMotorEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3CylindricalJoint_IsSpringEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableLimit(jointId: b3JointId, enableLimit: boolean): void;
  b3CylindricalJoint_IsLimitEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3CylindricalJoint_IsMotorEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableAngularSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3CylindricalJoint_IsAngularSpringEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableAngularLimit(jointId: b3JointId, enableLimit: boolean): void;
  b3CylindricalJoint_IsAngularLimitEnabled(jointId: b3JointId): boolean;
  b3CylindricalJoint_EnableAngularMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3CylindricalJoint_IsAngularMotorEnabled(jointId: b3JointId): boolean;
  b3RevoluteJoint_EnableSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3RevoluteJoint_IsSpringEnabled(jointId: b3JointId): boolean;
  b3RevoluteJoint_EnableLimit(jointId: b3JointId, enableLimit: boolean): void;
  b3RevoluteJoint_IsLimitEnabled(jointId: b3JointId): boolean;
  b3RevoluteJoint_EnableMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3RevoluteJoint_IsMotorEnabled(jointId: b3JointId): boolean;
  b3SphericalJoint_EnableConeLimit(jointId: b3JointId, enableConeLimit: boolean): void;
  b3SphericalJoint_IsConeLimitEnabled(jointId: b3JointId): boolean;
  b3SphericalJoint_EnableTwistLimit(jointId: b3JointId, enableTwistLimit: boolean): void;
  b3SphericalJoint_IsTwistLimitEnabled(jointId: b3JointId): boolean;
  b3SphericalJoint_EnableSpring(jointId: b3JointId, enableSpring: boolean): void;
  b3SphericalJoint_IsSpringEnabled(jointId: b3JointId): boolean;
  b3SphericalJoint_EnableMotor(jointId: b3JointId, enableMotor: boolean): void;
  b3SphericalJoint_IsMotorEnabled(jointId: b3JointId): boolean;
  b3WheelJoint_EnableSuspension(jointId: b3JointId, flag: boolean): void;
  b3WheelJoint_IsSuspensionEnabled(jointId: b3JointId): boolean;
  b3WheelJoint_EnableSuspensionLimit(jointId: b3JointId, flag: boolean): void;
  b3WheelJoint_IsSuspensionLimitEnabled(jointId: b3JointId): boolean;
  b3WheelJoint_EnableSpinMotor(jointId: b3JointId, flag: boolean): void;
  b3WheelJoint_IsSpinMotorEnabled(jointId: b3JointId): boolean;
  b3WheelJoint_EnableSteering(jointId: b3JointId, flag: boolean): void;
  b3WheelJoint_IsSteeringEnabled(jointId: b3JointId): boolean;
  b3WheelJoint_EnableSteeringLimit(jointId: b3JointId, flag: boolean): void;
  b3WheelJoint_IsSteeringLimitEnabled(jointId: b3JointId): boolean;
  b3World_GetMaxCapacity(worldId: b3WorldId): b3Capacity;
  b3World_SetMixingRules(worldId: b3WorldId, frictionRule: number, restitutionRule: number): void;
  b3GetWorldCount(): number;
  b3GetMaxWorldCount(): number;
  b3World_SetRestitutionIterations(worldId: b3WorldId, iterations: number): void;
  b3World_GetRestitutionIterations(worldId: b3WorldId): number;
  b3World_GetAwakeBodyCount(worldId: b3WorldId): number;
  b3World_SetWorkerCount(worldId: b3WorldId, count: number): void;
  b3World_GetWorkerCount(worldId: b3WorldId): number;
  b3Body_GetShapeCount(bodyId: b3BodyId): number;
  b3Body_GetJointCount(bodyId: b3BodyId): number;
  b3CreateDynamicTree(proxyCapacity: number): b3DynamicTree | null;
  b3DynamicTree_DestroyProxy(tree: b3DynamicTree | null, proxyId: number): void;
  b3DynamicTree_Rebuild(tree: b3DynamicTree | null, fullBuild: boolean): number;
  b3DynamicTree_GetHeight(tree: b3DynamicTree | null): number;
  b3DynamicTree_GetProxyCount(tree: b3DynamicTree | null): number;
  b3DynamicTree_GetByteCount(tree: b3DynamicTree | null): number;
  b3DestroyVehicle(vehicleId: b3VehicleId): void;
  b3Vehicle_IsValid(vehicleId: b3VehicleId): boolean;
  b3Vehicle_GetChassisBody(vehicleId: b3VehicleId): b3BodyId;
  b3Vehicle_GetWheelCount(vehicleId: b3VehicleId): number;
  b3Vehicle_SetGear(vehicleId: b3VehicleId, gear: number): void;
  b3World_GetVehicleCount(worldId: b3WorldId): number;
  b3World_GetGravity(out: b3Vec3, worldId: b3WorldId): b3Vec3;
  b3World_GetBounds(out: b3AABB, worldId: b3WorldId): b3AABB;
  b3Body_GetPosition(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetRotation(out: b3Quat, bodyId: b3BodyId): b3Quat;
  b3Body_GetTransform(outPosition: b3Vec3, outRotation: b3Quat, bodyId: b3BodyId): [ b3Vec3, b3Quat ];
  b3Body_GetLinearVelocity(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetAngularVelocity(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetLocalCenter(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetWorldCenter(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetMaxExtent(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_GetMaxExtentOrigin(out: b3Vec3, bodyId: b3BodyId): b3Vec3;
  b3Body_ComputeAABB(out: b3AABB, bodyId: b3BodyId): b3AABB;
  b3Shape_GetAABB(out: b3AABB, shapeId: b3ShapeId): b3AABB;
  b3Joint_GetLocalFrameA(outPosition: b3Vec3, outRotation: b3Quat, jointId: b3JointId): [ b3Vec3, b3Quat ];
  b3Joint_GetLocalFrameB(outPosition: b3Vec3, outRotation: b3Quat, jointId: b3JointId): [ b3Vec3, b3Quat ];
  b3Joint_GetConstraintForce(out: b3Vec3, jointId: b3JointId): b3Vec3;
  b3Joint_GetConstraintTorque(out: b3Vec3, jointId: b3JointId): b3Vec3;
  b3MoverJoint_GetLinearVelocity(out: b3Vec3, jointId: b3JointId): b3Vec3;
  b3PogoJoint_GetNormal(out: b3Vec3, jointId: b3JointId): b3Vec3;
  b3CreateRecording(byteCapacity: number): number;
  b3DestroyRecording(recording: number): void;
  b3World_StartRecording(worldId: b3WorldId, recording: number): void;
  b3Recording_GetSize(recording: number): number;
  b3RecPlayer_CreateFromRecording(recording: number, workerCount: number): number;
  b3DestroyPlayer(player: number): void;
  b3RecPlayer_StepFrame(player: number): boolean;
  b3RecPlayer_SubStepFrame(player: number): void;
  b3RecPlayer_IsAtPreStep(player: number): boolean;
  b3RecPlayer_Restart(player: number): void;
  b3RecPlayer_SeekFrame(player: number, frame: number): void;
  b3RecPlayer_GetWorldId(player: number): b3WorldId;
  b3RecPlayer_GetFrame(player: number): number;
  b3RecPlayer_GetFrameCount(player: number): number;
  b3RecPlayer_IsAtEnd(player: number): boolean;
  b3RecPlayer_GetBodyCount(player: number): number;
  b3RecPlayer_GetBodyId(player: number, index: number): b3BodyId;
  b3RecPlayer_HasDiverged(player: number): boolean;
  b3RecPlayer_GetDivergeFrame(player: number): number;
  b3RecPlayer_SetWorkerCount(player: number, count: number): void;
  b3Vehicle_GetWheelTransform(outPosition: b3Vec3, outRotation: b3Quat, vehicleId: b3VehicleId, wheelIndex: number): [ b3Vec3, b3Quat ];
  b3GetByteCount(): bigint;
  b3World_GetCounters(worldId: b3WorldId): b3Counters;
  b3DefaultFilter(): b3Filter;
  b3Shape_GetFilter(shapeId: b3ShapeId): b3Filter;
  b3Shape_SetFilter(shapeId: b3ShapeId, filter: b3Filter, invokeContacts: boolean): void;
  b3DefaultQueryFilter(): b3QueryFilter;
  b3World_SetGravity(worldId: b3WorldId, gravity: b3Vec3): void;
  b3CreateBoxMesh(center: b3Vec3, extent: b3Vec3, identifyEdges: boolean): b3MeshData | null;
  b3CreateHollowBoxMesh(center: b3Vec3, extent: b3Vec3): b3MeshData | null;
  b3CreateGrid(rowCount: number, columnCount: number, scale: b3Vec3, makeHoles: boolean): b3HeightFieldData | null;
  b3Body_GetLocalPoint(out: b3Vec3, bodyId: b3BodyId, worldPoint: b3Vec3): b3Vec3;
  b3Body_GetWorldPoint(out: b3Vec3, bodyId: b3BodyId, localPoint: b3Vec3): b3Vec3;
  b3Body_GetLocalVector(out: b3Vec3, bodyId: b3BodyId, worldVector: b3Vec3): b3Vec3;
  b3Body_GetWorldVector(out: b3Vec3, bodyId: b3BodyId, localVector: b3Vec3): b3Vec3;
  b3Body_SetLinearVelocity(bodyId: b3BodyId, linearVelocity: b3Vec3): void;
  b3Body_SetAngularVelocity(bodyId: b3BodyId, angularVelocity: b3Vec3): void;
  b3Body_GetLocalPointVelocity(out: b3Vec3, bodyId: b3BodyId, localPoint: b3Vec3): b3Vec3;
  b3Body_GetWorldPointVelocity(out: b3Vec3, bodyId: b3BodyId, worldPoint: b3Vec3): b3Vec3;
  b3Body_ApplyForce(bodyId: b3BodyId, force: b3Vec3, point: b3Vec3, wake: boolean): void;
  b3Body_ApplyForceToCenter(bodyId: b3BodyId, force: b3Vec3, wake: boolean): void;
  b3Body_ApplyTorque(bodyId: b3BodyId, torque: b3Vec3, wake: boolean): void;
  b3Body_ApplyLinearImpulse(bodyId: b3BodyId, impulse: b3Vec3, point: b3Vec3, wake: boolean): void;
  b3Body_ApplyLinearImpulseToCenter(bodyId: b3BodyId, impulse: b3Vec3, wake: boolean): void;
  b3Body_ApplyAngularImpulse(bodyId: b3BodyId, impulse: b3Vec3, wake: boolean): void;
  b3Body_SetConstantTorque(bodyId: b3BodyId, torque: b3Vec3): void;
  b3Shape_GetClosestPoint(out: b3Vec3, shapeId: b3ShapeId, target: b3Vec3): b3Vec3;
  b3MotorJoint_SetLinearVelocity(jointId: b3JointId, velocity: b3Vec3): void;
  b3MotorJoint_GetLinearVelocity(jointId: b3JointId): b3Vec3;
  b3MotorJoint_SetAngularVelocity(jointId: b3JointId, velocity: b3Vec3): void;
  b3MotorJoint_GetAngularVelocity(jointId: b3JointId): b3Vec3;
  b3SphericalJoint_SetMotorVelocity(jointId: b3JointId, velocity: b3Vec3): void;
  b3SphericalJoint_GetMotorVelocity(jointId: b3JointId): b3Vec3;
  b3SphericalJoint_GetMotorTorque(jointId: b3JointId): b3Vec3;
  b3MoverJoint_SetLinearVelocity(jointId: b3JointId, velocity: b3Vec3): void;
  b3PogoJoint_SetNormal(jointId: b3JointId, normal: b3Vec3): void;
  b3Body_GetLocalRotationalInertia(bodyId: b3BodyId): b3Matrix3;
  b3Body_GetWorldInverseRotationalInertia(bodyId: b3BodyId): b3Matrix3;
  b3CloneAndTransformHull(original: b3HullData | null, transform: b3Transform, scale: b3Vec3): b3HullData | null;
  b3Shape_SetBakedHull(shapeId: b3ShapeId, hull: b3HullData | null, transform: b3Transform, scale: b3Vec3, updateBodyMass: boolean): boolean;
  b3Joint_SetLocalFrameA(jointId: b3JointId, localFrame: b3Transform): void;
  b3Joint_SetLocalFrameB(jointId: b3JointId, localFrame: b3Transform): void;
  b3Body_SetTransform(bodyId: b3BodyId, position: b3Vec3, rotation: b3Quat): void;
  b3SphericalJoint_SetTargetRotation(jointId: b3JointId, targetRotation: b3Quat): void;
  b3SphericalJoint_GetTargetRotation(jointId: b3JointId): b3Quat;
  b3Vehicle_Reset(vehicleId: b3VehicleId, position: b3Vec3, rotation: b3Quat): void;
  b3ComputeHullAABB(hull: b3HullData | null, transform: b3Transform): b3AABB;
  b3DynamicTree_CreateProxy(tree: b3DynamicTree | null, aabb: b3AABB, categoryBits: number, userData: number): number;
  b3DynamicTree_MoveProxy(tree: b3DynamicTree | null, proxyId: number, aabb: b3AABB): void;
  b3DynamicTree_EnlargeProxy(tree: b3DynamicTree | null, proxyId: number, aabb: b3AABB): void;
  b3DynamicTree_GetRootBounds(tree: b3DynamicTree | null): b3AABB;
  b3ComputeSphereAABB(sphere: b3Sphere, transform: b3Transform): b3AABB;
  b3Shape_GetSphere(shapeId: b3ShapeId): b3Sphere;
  b3Shape_SetSphere(shapeId: b3ShapeId, sphere: b3Sphere): void;
  b3ComputeCapsuleAABB(capsule: b3Capsule, transform: b3Transform): b3AABB;
  b3Shape_GetCapsule(shapeId: b3ShapeId): b3Capsule;
  b3Shape_SetCapsule(shapeId: b3ShapeId, capsule: b3Capsule): void;
  b3DefaultSurfaceMaterial(): b3SurfaceMaterial;
  b3Shape_SetSurfaceMaterial(shapeId: b3ShapeId, surfaceMaterial: b3SurfaceMaterial): void;
  b3Shape_SetMeshMaterial(shapeId: b3ShapeId, surfaceMaterial: b3SurfaceMaterial, index: number): void;
  b3Shape_GetSurfaceMaterial(shapeId: b3ShapeId): b3SurfaceMaterial;
  b3DefaultWorldDef(): b3WorldDef;
  b3CreateWorld(worldDef: b3WorldDef): b3WorldId;
  b3DefaultBodyDef(): b3BodyDef;
  b3CreateBody(worldId: b3WorldId, bodyDef: b3BodyDef): b3BodyId;
  b3DefaultShapeDef(): b3ShapeDef;
  b3CreateSphereShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, sphere: b3Sphere): b3ShapeId;
  b3CreateCapsuleShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, capsule: b3Capsule): b3ShapeId;
  b3CreateHullShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, hull: b3HullData | null): b3ShapeId;
  b3CreateMeshShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, mesh: b3MeshData | null, scale: b3Vec3): b3ShapeId;
  b3CreateBakedCompoundShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, compound: b3CompoundData | null): b3ShapeId;
  b3CreateHeightFieldShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, heightField: b3HeightFieldData | null): b3ShapeId;
  b3CreateTransformedHullShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, hull: b3HullData | null, transform: b3Transform, scale: b3Vec3): b3ShapeId;
  b3World_Step(worldId: b3WorldId, timeStep: number, subStepCount: number): void;
  b3World_SetRestitutionThreshold(worldId: b3WorldId, value: number): void;
  b3World_GetRestitutionThreshold(worldId: b3WorldId): number;
  b3World_SetHitEventThreshold(worldId: b3WorldId, value: number): void;
  b3World_GetHitEventThreshold(worldId: b3WorldId): number;
  b3World_SetContactTuning(worldId: b3WorldId, hertz: number, dampingRatio: number, contactSpeed: number): void;
  b3World_SetContactRecycleDistance(worldId: b3WorldId, recycleDistance: number): void;
  b3World_GetContactRecycleDistance(worldId: b3WorldId): number;
  b3World_SetMaximumLinearSpeed(worldId: b3WorldId, maximumLinearSpeed: number): void;
  b3World_GetMaximumLinearSpeed(worldId: b3WorldId): number;
  b3World_SetIsotropicInertiaTolerance(worldId: b3WorldId, tolerance: number): void;
  b3World_GetIsotropicInertiaTolerance(worldId: b3WorldId): number;
  b3CreateBoxShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, hx: number, hy: number, hz: number): b3ShapeId;
  b3CreateCylinder(height: number, radius: number, yOffset: number, sides: number): b3HullData | null;
  b3CreateCone(height: number, radius1: number, radius2: number, slices: number): b3HullData | null;
  b3CreateRock(radius: number): b3HullData | null;
  b3CreateGridMesh(xCount: number, zCount: number, cellWidth: number, materialCount: number, identifyEdges: boolean): b3MeshData | null;
  b3CreateWaveMesh(xCount: number, zCount: number, cellWidth: number, amplitude: number, rowFrequency: number, columnFrequency: number): b3MeshData | null;
  b3CreateTorusMesh(radialResolution: number, tubularResolution: number, radius: number, thickness: number): b3MeshData | null;
  b3CreatePlatformMesh(center: b3Vec3, height: number, topWidth: number, bottomWidth: number): b3MeshData | null;
  b3CreateWave(rowCount: number, columnCount: number, scale: b3Vec3, rowFrequency: number, columnFrequency: number, makeHoles: boolean): b3HeightFieldData | null;
  b3World_GetProfile(worldId: b3WorldId): b3Profile;
  b3DefaultExplosionDef(): b3ExplosionDef;
  b3World_Explode(worldId: b3WorldId, explosionDef: b3ExplosionDef): void;
  b3Body_CastRay(bodyId: b3BodyId, origin: b3Vec3, translation: b3Vec3, filter: b3QueryFilter, maxFraction: number, bodyTransform: b3Transform): b3BodyCastResult;
  b3Body_SetTargetTransform(bodyId: b3BodyId, target: b3Transform, timeStep: number, wake: boolean): void;
  b3Body_GetMass(bodyId: b3BodyId): number;
  b3Body_GetInverseMass(bodyId: b3BodyId): number;
  b3Body_SetLinearDamping(bodyId: b3BodyId, linearDamping: number): void;
  b3Body_GetLinearDamping(bodyId: b3BodyId): number;
  b3Body_SetAngularDamping(bodyId: b3BodyId, angularDamping: number): void;
  b3Body_GetAngularDamping(bodyId: b3BodyId): number;
  b3Body_SetGravityScale(bodyId: b3BodyId, gravityScale: number): void;
  b3Body_GetGravityScale(bodyId: b3BodyId): number;
  b3Body_SetSleepThreshold(bodyId: b3BodyId, sleepThreshold: number): void;
  b3Body_GetSleepThreshold(bodyId: b3BodyId): number;
  b3Body_SetSafetyFactor(bodyId: b3BodyId, safetyFactor: number): void;
  b3Body_GetSafetyFactor(bodyId: b3BodyId): number;
  b3Body_GetMinExtent(bodyId: b3BodyId): number;
  b3Shape_SetDensity(shapeId: b3ShapeId, density: number, updateBodyMass: boolean): void;
  b3Shape_GetDensity(shapeId: b3ShapeId): number;
  b3Shape_SetFriction(shapeId: b3ShapeId, friction: number): void;
  b3Shape_GetFriction(shapeId: b3ShapeId): number;
  b3Shape_SetRestitution(shapeId: b3ShapeId, restitution: number): void;
  b3Shape_GetRestitution(shapeId: b3ShapeId): number;
  b3Shape_SetMeshRestOffset(shapeId: b3ShapeId, restOffset: number): void;
  b3Shape_GetMeshRestOffset(shapeId: b3ShapeId): number;
  b3Shape_ApplyWind(shapeId: b3ShapeId, wind: b3Vec3, drag: number, lift: number, maxSpeed: number, wake: boolean): void;
  b3DefaultFilterJointDef(): b3FilterJointDef;
  b3CreateFilterJoint(worldId: b3WorldId, def: b3FilterJointDef): b3JointId;
  b3DefaultDistanceJointDef(): b3DistanceJointDef;
  b3CreateDistanceJoint(worldId: b3WorldId, def: b3DistanceJointDef): b3JointId;
  b3DefaultRevoluteJointDef(): b3RevoluteJointDef;
  b3CreateRevoluteJoint(worldId: b3WorldId, def: b3RevoluteJointDef): b3JointId;
  b3DefaultPrismaticJointDef(): b3PrismaticJointDef;
  b3CreatePrismaticJoint(worldId: b3WorldId, def: b3PrismaticJointDef): b3JointId;
  b3DefaultCylindricalJointDef(): b3CylindricalJointDef;
  b3CreateCylindricalJoint(worldId: b3WorldId, def: b3CylindricalJointDef): b3JointId;
  b3DefaultMoverJointDef(): b3MoverJointDef;
  b3CreateMoverJoint(worldId: b3WorldId, def: b3MoverJointDef): b3JointId;
  b3DefaultPogoJointDef(): b3PogoJointDef;
  b3CreatePogoJoint(worldId: b3WorldId, def: b3PogoJointDef): b3JointId;
  b3DefaultWheelJointDef(): b3WheelJointDef;
  b3CreateWheelJoint(worldId: b3WorldId, def: b3WheelJointDef): b3JointId;
  b3DefaultWeldJointDef(): b3WeldJointDef;
  b3CreateWeldJoint(worldId: b3WorldId, def: b3WeldJointDef): b3JointId;
  b3DefaultSphericalJointDef(): b3SphericalJointDef;
  b3CreateSphericalJoint(worldId: b3WorldId, def: b3SphericalJointDef): b3JointId;
  b3DefaultMotorJointDef(): b3MotorJointDef;
  b3CreateMotorJoint(worldId: b3WorldId, def: b3MotorJointDef): b3JointId;
  b3DefaultParallelJointDef(): b3ParallelJointDef;
  b3CreateParallelJoint(worldId: b3WorldId, def: b3ParallelJointDef): b3JointId;
  b3Joint_GetLinearSeparation(jointId: b3JointId): number;
  b3Joint_GetAngularSeparation(jointId: b3JointId): number;
  b3Joint_SetConstraintTuning(jointId: b3JointId, hertz: number, dampingRatio: number): void;
  b3Joint_SetForceThreshold(jointId: b3JointId, threshold: number): void;
  b3Joint_GetForceThreshold(jointId: b3JointId): number;
  b3Joint_SetTorqueThreshold(jointId: b3JointId, threshold: number): void;
  b3Joint_GetTorqueThreshold(jointId: b3JointId): number;
  b3ParallelJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3ParallelJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3ParallelJoint_GetSpringHertz(jointId: b3JointId): number;
  b3ParallelJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3ParallelJoint_SetMaxTorque(jointId: b3JointId, force: number): void;
  b3ParallelJoint_GetMaxTorque(jointId: b3JointId): number;
  b3DistanceJoint_SetLength(jointId: b3JointId, length: number): void;
  b3DistanceJoint_GetLength(jointId: b3JointId): number;
  b3DistanceJoint_SetSpringForceRange(jointId: b3JointId, lowerForce: number, upperForce: number): void;
  b3DistanceJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3DistanceJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3DistanceJoint_GetSpringHertz(jointId: b3JointId): number;
  b3DistanceJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3DistanceJoint_SetSpringStiffness(jointId: b3JointId, stiffness: number, damping: number): void;
  b3DistanceJoint_GetSpringStiffness(jointId: b3JointId): number;
  b3DistanceJoint_GetSpringDamping(jointId: b3JointId): number;
  b3DistanceJoint_SetLengthRange(jointId: b3JointId, minLength: number, maxLength: number): void;
  b3DistanceJoint_GetMinLength(jointId: b3JointId): number;
  b3DistanceJoint_GetMaxLength(jointId: b3JointId): number;
  b3DistanceJoint_GetCurrentLength(jointId: b3JointId): number;
  b3DistanceJoint_SetMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3DistanceJoint_GetMotorSpeed(jointId: b3JointId): number;
  b3DistanceJoint_SetMaxMotorForce(jointId: b3JointId, force: number): void;
  b3DistanceJoint_GetMaxMotorForce(jointId: b3JointId): number;
  b3DistanceJoint_GetMotorForce(jointId: b3JointId): number;
  b3MotorJoint_SetMaxVelocityForce(jointId: b3JointId, maxForce: number): void;
  b3MotorJoint_GetMaxVelocityForce(jointId: b3JointId): number;
  b3MotorJoint_SetMaxVelocityTorque(jointId: b3JointId, maxTorque: number): void;
  b3MotorJoint_GetMaxVelocityTorque(jointId: b3JointId): number;
  b3MotorJoint_SetLinearHertz(jointId: b3JointId, hertz: number): void;
  b3MotorJoint_GetLinearHertz(jointId: b3JointId): number;
  b3MotorJoint_SetLinearDampingRatio(jointId: b3JointId, damping: number): void;
  b3MotorJoint_GetLinearDampingRatio(jointId: b3JointId): number;
  b3MotorJoint_SetAngularHertz(jointId: b3JointId, hertz: number): void;
  b3MotorJoint_GetAngularHertz(jointId: b3JointId): number;
  b3MotorJoint_SetAngularDampingRatio(jointId: b3JointId, damping: number): void;
  b3MotorJoint_GetAngularDampingRatio(jointId: b3JointId): number;
  b3MotorJoint_SetMaxSpringForce(jointId: b3JointId, maxForce: number): void;
  b3MotorJoint_GetMaxSpringForce(jointId: b3JointId): number;
  b3MotorJoint_SetMaxSpringTorque(jointId: b3JointId, maxTorque: number): void;
  b3MotorJoint_GetMaxSpringTorque(jointId: b3JointId): number;
  b3PrismaticJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3PrismaticJoint_GetSpringHertz(jointId: b3JointId): number;
  b3PrismaticJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3PrismaticJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3PrismaticJoint_SetTargetTranslation(jointId: b3JointId, targetTranslation: number): void;
  b3PrismaticJoint_GetTargetTranslation(jointId: b3JointId): number;
  b3PrismaticJoint_GetLowerLimit(jointId: b3JointId): number;
  b3PrismaticJoint_GetUpperLimit(jointId: b3JointId): number;
  b3PrismaticJoint_SetLimits(jointId: b3JointId, lower: number, upper: number): void;
  b3PrismaticJoint_SetMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3PrismaticJoint_GetMotorSpeed(jointId: b3JointId): number;
  b3PrismaticJoint_SetMaxMotorForce(jointId: b3JointId, force: number): void;
  b3PrismaticJoint_GetMaxMotorForce(jointId: b3JointId): number;
  b3PrismaticJoint_GetMotorForce(jointId: b3JointId): number;
  b3PrismaticJoint_GetTranslation(jointId: b3JointId): number;
  b3PrismaticJoint_GetSpeed(jointId: b3JointId): number;
  b3CylindricalJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3CylindricalJoint_GetSpringHertz(jointId: b3JointId): number;
  b3CylindricalJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3CylindricalJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3CylindricalJoint_SetTargetTranslation(jointId: b3JointId, targetTranslation: number): void;
  b3CylindricalJoint_GetTargetTranslation(jointId: b3JointId): number;
  b3CylindricalJoint_GetLowerLimit(jointId: b3JointId): number;
  b3CylindricalJoint_GetUpperLimit(jointId: b3JointId): number;
  b3CylindricalJoint_SetLimits(jointId: b3JointId, lower: number, upper: number): void;
  b3CylindricalJoint_SetMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3CylindricalJoint_GetMotorSpeed(jointId: b3JointId): number;
  b3CylindricalJoint_SetMaxMotorForce(jointId: b3JointId, force: number): void;
  b3CylindricalJoint_GetMaxMotorForce(jointId: b3JointId): number;
  b3CylindricalJoint_GetMotorForce(jointId: b3JointId): number;
  b3CylindricalJoint_SetAngularSpringHertz(jointId: b3JointId, hertz: number): void;
  b3CylindricalJoint_GetAngularSpringHertz(jointId: b3JointId): number;
  b3CylindricalJoint_SetAngularSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3CylindricalJoint_GetAngularSpringDampingRatio(jointId: b3JointId): number;
  b3CylindricalJoint_SetTargetAngle(jointId: b3JointId, targetAngle: number): void;
  b3CylindricalJoint_GetTargetAngle(jointId: b3JointId): number;
  b3CylindricalJoint_GetLowerAngle(jointId: b3JointId): number;
  b3CylindricalJoint_GetUpperAngle(jointId: b3JointId): number;
  b3CylindricalJoint_SetAngularLimits(jointId: b3JointId, lower: number, upper: number): void;
  b3CylindricalJoint_SetAngularMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3CylindricalJoint_GetAngularMotorSpeed(jointId: b3JointId): number;
  b3CylindricalJoint_SetMaxMotorTorque(jointId: b3JointId, torque: number): void;
  b3CylindricalJoint_GetMaxMotorTorque(jointId: b3JointId): number;
  b3CylindricalJoint_GetMotorTorque(jointId: b3JointId): number;
  b3CylindricalJoint_GetTranslation(jointId: b3JointId): number;
  b3CylindricalJoint_GetSpeed(jointId: b3JointId): number;
  b3CylindricalJoint_GetAngle(jointId: b3JointId): number;
  b3CylindricalJoint_GetAngularSpeed(jointId: b3JointId): number;
  b3RevoluteJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3RevoluteJoint_GetSpringHertz(jointId: b3JointId): number;
  b3RevoluteJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3RevoluteJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3RevoluteJoint_SetTargetAngle(jointId: b3JointId, targetRadians: number): void;
  b3RevoluteJoint_GetTargetAngle(jointId: b3JointId): number;
  b3RevoluteJoint_GetAngle(jointId: b3JointId): number;
  b3RevoluteJoint_GetLowerLimit(jointId: b3JointId): number;
  b3RevoluteJoint_GetUpperLimit(jointId: b3JointId): number;
  b3RevoluteJoint_SetLimits(jointId: b3JointId, lowerLimitRadians: number, upperLimitRadians: number): void;
  b3RevoluteJoint_SetMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3RevoluteJoint_GetMotorSpeed(jointId: b3JointId): number;
  b3RevoluteJoint_GetMotorTorque(jointId: b3JointId): number;
  b3RevoluteJoint_SetMaxMotorTorque(jointId: b3JointId, torque: number): void;
  b3RevoluteJoint_GetMaxMotorTorque(jointId: b3JointId): number;
  b3SphericalJoint_GetConeLimit(jointId: b3JointId): number;
  b3SphericalJoint_SetConeLimit(jointId: b3JointId, coneAngle: number): void;
  b3SphericalJoint_GetConeAngle(jointId: b3JointId): number;
  b3SphericalJoint_GetLowerTwistLimit(jointId: b3JointId): number;
  b3SphericalJoint_GetUpperTwistLimit(jointId: b3JointId): number;
  b3SphericalJoint_SetTwistLimits(jointId: b3JointId, lowerLimitRadians: number, upperLimitRadians: number): void;
  b3SphericalJoint_GetTwistAngle(jointId: b3JointId): number;
  b3SphericalJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3SphericalJoint_GetSpringHertz(jointId: b3JointId): number;
  b3SphericalJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3SphericalJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3SphericalJoint_SetMaxMotorTorque(jointId: b3JointId, torque: number): void;
  b3SphericalJoint_GetMaxMotorTorque(jointId: b3JointId): number;
  b3WeldJoint_SetLinearHertz(jointId: b3JointId, hertz: number): void;
  b3WeldJoint_GetLinearHertz(jointId: b3JointId): number;
  b3WeldJoint_SetLinearDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3WeldJoint_GetLinearDampingRatio(jointId: b3JointId): number;
  b3WeldJoint_SetAngularHertz(jointId: b3JointId, hertz: number): void;
  b3WeldJoint_GetAngularHertz(jointId: b3JointId): number;
  b3WeldJoint_SetAngularDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3WeldJoint_GetAngularDampingRatio(jointId: b3JointId): number;
  b3WheelJoint_SetSuspensionHertz(jointId: b3JointId, hertz: number): void;
  b3WheelJoint_GetSuspensionHertz(jointId: b3JointId): number;
  b3WheelJoint_SetSuspensionDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3WheelJoint_GetSuspensionDampingRatio(jointId: b3JointId): number;
  b3WheelJoint_GetLowerSuspensionLimit(jointId: b3JointId): number;
  b3WheelJoint_GetUpperSuspensionLimit(jointId: b3JointId): number;
  b3WheelJoint_SetSuspensionLimits(jointId: b3JointId, lower: number, upper: number): void;
  b3WheelJoint_SetSpinMotorSpeed(jointId: b3JointId, motorSpeed: number): void;
  b3WheelJoint_GetSpinMotorSpeed(jointId: b3JointId): number;
  b3WheelJoint_SetMaxSpinTorque(jointId: b3JointId, torque: number): void;
  b3WheelJoint_GetMaxSpinTorque(jointId: b3JointId): number;
  b3WheelJoint_GetSpinSpeed(jointId: b3JointId): number;
  b3WheelJoint_GetSpinTorque(jointId: b3JointId): number;
  b3WheelJoint_SetSteeringHertz(jointId: b3JointId, hertz: number): void;
  b3WheelJoint_GetSteeringHertz(jointId: b3JointId): number;
  b3WheelJoint_SetSteeringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3WheelJoint_GetSteeringDampingRatio(jointId: b3JointId): number;
  b3WheelJoint_SetMaxSteeringTorque(jointId: b3JointId, torque: number): void;
  b3WheelJoint_GetMaxSteeringTorque(jointId: b3JointId): number;
  b3WheelJoint_GetLowerSteeringLimit(jointId: b3JointId): number;
  b3WheelJoint_GetUpperSteeringLimit(jointId: b3JointId): number;
  b3WheelJoint_SetSteeringLimits(jointId: b3JointId, lower: number, upper: number): void;
  b3WheelJoint_SetTargetSteeringAngle(jointId: b3JointId, targetAngle: number): void;
  b3WheelJoint_GetTargetSteeringAngle(jointId: b3JointId): number;
  b3WheelJoint_GetSteeringAngle(jointId: b3JointId): number;
  b3WheelJoint_GetSteeringTorque(jointId: b3JointId): number;
  b3MoverJoint_SetMaxVelocityForce(jointId: b3JointId, maxForce: number): void;
  b3MoverJoint_GetMaxVelocityForce(jointId: b3JointId): number;
  b3PogoJoint_SetRestLength(jointId: b3JointId, length: number): void;
  b3PogoJoint_GetRestLength(jointId: b3JointId): number;
  b3PogoJoint_SetSpringHertz(jointId: b3JointId, hertz: number): void;
  b3PogoJoint_GetSpringHertz(jointId: b3JointId): number;
  b3PogoJoint_SetSpringDampingRatio(jointId: b3JointId, dampingRatio: number): void;
  b3PogoJoint_GetSpringDampingRatio(jointId: b3JointId): number;
  b3PogoJoint_SetMaxTensionForce(jointId: b3JointId, force: number): void;
  b3PogoJoint_GetMaxTensionForce(jointId: b3JointId): number;
  b3PogoJoint_SetMaxCompressionForce(jointId: b3JointId, force: number): void;
  b3PogoJoint_GetMaxCompressionForce(jointId: b3JointId): number;
  b3PogoJoint_GetCurrentLength(jointId: b3JointId): number;
  b3PogoJoint_GetCurrentSpeed(jointId: b3JointId): number;
  b3PogoJoint_GetImpulse(jointId: b3JointId): number;
  b3ComputeSphereMass(sphere: b3Sphere, density: number): b3MassData;
  b3ComputeCapsuleMass(capsule: b3Capsule, density: number): b3MassData;
  b3ComputeHullMass(hull: b3HullData | null, density: number): b3MassData;
  b3Body_GetMassData(bodyId: b3BodyId): b3MassData;
  b3Body_SetMassData(bodyId: b3BodyId, massData: b3MassData): void;
  b3Shape_ComputeMassData(shapeId: b3ShapeId): b3MassData;
  b3World_CastRayClosest(worldId: b3WorldId, origin: b3Vec3, translation: b3Vec3, filter: b3QueryFilter): b3RayResult;
  b3Shape_RayCast(shapeId: b3ShapeId, origin: b3Vec3, translation: b3Vec3): b3WorldCastOutput;
  b3DynamicTree_GetAreaRatio(tree: b3DynamicTree | null): number;
  b3DefaultVehicleWheelDef(): b3VehicleWheelDef;
  b3Vehicle_SetWheel(vehicleId: b3VehicleId, wheelIndex: number, wheel: b3VehicleWheelDef): void;
  b3Vehicle_GetWheel(vehicleId: b3VehicleId, wheelIndex: number): b3VehicleWheelDef;
  b3Vehicle_SetChassis(vehicleId: b3VehicleId, chassis: b3VehicleChassis): void;
  b3Vehicle_GetChassis(vehicleId: b3VehicleId): b3VehicleChassis;
  b3Vehicle_SetEngine(vehicleId: b3VehicleId, engine: b3VehicleEngine): void;
  b3Vehicle_GetEngine(vehicleId: b3VehicleId): b3VehicleEngine;
  b3Vehicle_SetTurbo(vehicleId: b3VehicleId, turbo: b3VehicleTurbo): void;
  b3Vehicle_GetTurbo(vehicleId: b3VehicleId): b3VehicleTurbo;
  b3Vehicle_SetTransmission(vehicleId: b3VehicleId, transmission: b3VehicleTransmission): void;
  b3Vehicle_GetTransmission(vehicleId: b3VehicleId): b3VehicleTransmission;
  b3Vehicle_SetDrivetrain(vehicleId: b3VehicleId, drivetrain: b3VehicleDrivetrain): void;
  b3Vehicle_GetDrivetrain(vehicleId: b3VehicleId): b3VehicleDrivetrain;
  b3Vehicle_SetAntiRoll(vehicleId: b3VehicleId, antiRoll: b3VehicleAntiRoll): void;
  b3Vehicle_GetAntiRoll(vehicleId: b3VehicleId): b3VehicleAntiRoll;
  b3Vehicle_SetSteering(vehicleId: b3VehicleId, steering: b3VehicleSteering): void;
  b3Vehicle_GetSteering(vehicleId: b3VehicleId): b3VehicleSteering;
  b3DefaultVehicleDef(): b3VehicleDef;
  b3CreateVehicle(worldId: b3WorldId, vehicleDef: b3VehicleDef): b3VehicleId;
  b3Vehicle_SetAssists(vehicleId: b3VehicleId, assists: b3VehicleAssists): void;
  b3Vehicle_GetAssists(vehicleId: b3VehicleId): b3VehicleAssists;
  b3Vehicle_SetInput(vehicleId: b3VehicleId, input: b3VehicleInput): void;
  b3Vehicle_GetInput(vehicleId: b3VehicleId): b3VehicleInput;
  b3Vehicle_GetState(vehicleId: b3VehicleId): b3VehicleState;
  b3Vehicle_GetWheelState(vehicleId: b3VehicleId, wheelIndex: number): b3VehicleWheelState;
  b3Vehicle_GetSprungMass(vehicleId: b3VehicleId, wheelIndex: number): number;
  b3Body_SetName(bodyId: b3BodyId, name: EmbindString): void;
  b3Body_GetName(bodyId: b3BodyId): string;
  b3Body_GetTransformsPacked(ids: Int32Array): Float64Array;
  b3CreateHull(points: any): b3HullData | null;
  b3GetHullVertices(hull: b3HullData | null): Float32Array;
  b3CreateMesh(positions: any, indices: any): b3MeshData | null;
  b3GetMeshVertices(mesh: b3MeshData | null): Float32Array;
  b3GetMeshIndices(mesh: b3MeshData | null): Uint32Array;
  b3GetMeshMaterialIndices(mesh: b3MeshData | null): Uint8Array;
  b3CreateCompound(spec: any): b3CompoundData | null;
  b3ComputeConvexDecomposition(positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): b3ConvexDecomposition;
  b3CreateConvexDecompositionShapes(bodyId: b3BodyId, shapeDef: b3ShapeDef, positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): b3DecompositionShapes;
  b3CreateConvexDecompositionShapesFromPacked(bodyId: b3BodyId, shapeDef: b3ShapeDef, packed: b3ConvexDecomposition, maxVerticesPerHull?: number): b3DecompositionShapes;
  b3CreateDecompositionCompound(packed: b3ConvexDecomposition, material?: b3SurfaceMaterial): b3DecompositionCompound;
  b3CreateHeightField(heights: any, countX: number, countZ: number, scale: b3Vec3): b3HeightFieldData | null;
  b3World_CastMover(worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, translation: b3Vec3, filter: b3QueryFilter, callback: any): number;
  b3World_CollideMoverPacked(worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, filter: b3QueryFilter, options: b3QueryOptions | null): Float64Array;
  b3World_CastMoverFiltered(worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null): number;
  b3World_CastRayClosestFiltered(worldId: b3WorldId, origin: b3Vec3, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null): Float64Array;
  b3World_CastShapeClosestFiltered(worldId: b3WorldId, origin: b3Vec3, points: Float32Array | number[], radius: number, translation: b3Vec3, filter: b3QueryFilter, options: b3QueryOptions | null): Float64Array;
  b3World_CollideMover(worldId: b3WorldId, origin: b3Vec3, mover: b3Capsule, filter: b3QueryFilter, callback: any): void;
  b3SolvePlanes(targetDelta: b3Vec3, planes: any): b3PlaneSolverResult;
  b3ClipVector(vector: b3Vec3, planes: any): b3Vec3;
  b3World_SetCustomFilterCallback(worldId: b3WorldId, callback: any): void;
  b3World_SetPreSolveCallback(worldId: b3WorldId, callback: any): void;
  b3ShapeDistance(pointsA: any, radiusA: number, pointsB: any, radiusB: number, transformB: b3Transform, useRadii: boolean): b3DistanceOutput;
  b3ShapeCast(pointsA: any, radiusA: number, pointsB: any, radiusB: number, transformB: b3Transform, translationB: b3Vec3, maxFraction: number, canEncroach: boolean): b3WorldCastOutput;
  b3TimeOfImpact(pointsA: any, radiusA: number, pointsB: any, radiusB: number, sweepA: b3Sweep, sweepB: b3Sweep, maxFraction: number): b3TOIOutput;
  b3CollideSpheres(sphereA: b3Sphere, sphereB: b3Sphere, transformB: b3Transform): any;
  b3CollideCapsuleAndSphere(capsuleA: b3Capsule, sphereB: b3Sphere, transformB: b3Transform): any;
  b3CollideHullAndSphere(hullA: b3HullData | null, sphereB: b3Sphere, transformB: b3Transform): any;
  b3CollideCapsules(capsuleA: b3Capsule, capsuleB: b3Capsule, transformB: b3Transform): any;
  b3CollideHullAndCapsule(hullA: b3HullData | null, capsuleB: b3Capsule, transformB: b3Transform): any;
  b3CollideHulls(hullA: b3HullData | null, hullB: b3HullData | null, transformB: b3Transform): any;
  b3CollideTriangleAndCapsule(v1: b3Vec3, v2: b3Vec3, v3: b3Vec3, capsuleB: b3Capsule): any;
  b3CollideTriangleAndHull(v1: b3Vec3, v2: b3Vec3, v3: b3Vec3, triangleFlags: number, hullB: b3HullData | null, enableSpeculative: boolean): any;
  b3CollideTriangleAndSphere(v1: b3Vec3, v2: b3Vec3, v3: b3Vec3, sphereB: b3Sphere): any;
  b3Shape_GetSensorData(shapeId: b3ShapeId): ShapeIdBuffer;
  b3World_OverlapShape(worldId: b3WorldId, origin: b3Vec3, points: any, radius: number, filter: b3QueryFilter, callback: any): void;
  b3World_CastShape(worldId: b3WorldId, origin: b3Vec3, points: any, radius: number, translation: b3Vec3, filter: b3QueryFilter, callback: any): void;
  b3Body_CastShape(bodyId: b3BodyId, origin: b3Vec3, points: any, radius: number, translation: b3Vec3, filter: b3QueryFilter, maxFraction: number, canEncroach: boolean, bodyTransform: b3Transform): b3BodyCastResult;
  b3Body_OverlapShape(bodyId: b3BodyId, origin: b3Vec3, points: any, radius: number, filter: b3QueryFilter, bodyTransform: b3Transform): boolean;
  b3Body_CollideMover(bodyId: b3BodyId, origin: b3Vec3, mover: b3Capsule, filter: b3QueryFilter, bodyTransform: b3Transform): BodyPlaneResultBuffer;
  b3Body_SetConstantForce(bodyId: b3BodyId, force: b3Vec3, point: b3Vec3 | null): void;
  b3Shape_GetHullVertices(shapeId: b3ShapeId): any;
  b3DistanceJoint_GetSpringForceRange(jointId: b3JointId): any;
  b3World_OverlapAABB(worldId: b3WorldId, aabb: b3AABB, filter: b3QueryFilter, callback: any): void;
  b3World_CastRay(worldId: b3WorldId, origin: b3Vec3, translation: b3Vec3, filter: b3QueryFilter, callback: any): void;
  b3DynamicTree_Query(tree: b3DynamicTree | null, aabb: b3AABB, maskBits: number, callback: any): b3TreeStats;
  b3DynamicTree_RayCast(tree: b3DynamicTree | null, origin: b3Vec3, translation: b3Vec3, maxFraction: number, maskBits: number, callback: any): b3TreeStats;
  b3DynamicTree_QueryClosest(tree: b3DynamicTree | null, point: b3Vec3, maskBits: number, callback: any): b3TreeStats;
  b3World_Draw(worldId: b3WorldId, handler: any): void;
  getDebugGeometry(id: number): DebugGeometry | null;
}

export interface ShapeIdBuffer { count: number; data: Int32Array; }
/** Native candidate filter for the *Filtered / *Packed world queries. A shape is skipped when it or
 * its body is listed (Int32Array of index1, world0, generation triples), or when it is a sensor and
 * excludeSensors is set. No JS callback runs per candidate. */
export interface b3QueryOptions { ignoreBodies?: Int32Array; ignoreShapes?: Int32Array; excludeSensors?: boolean; }
export interface ContactBuffer {
  count: number;
  contactsI32: Int32Array;
  manifoldsF32: Float32Array;
  manifoldsI32: Int32Array;
  pointsF32: Float32Array;
  pointsI32: Int32Array;
  readonly contactsBase?: number;
  readonly manifoldsF32Base?: number;
  readonly manifoldsI32Base?: number;
  readonly pointsF32Base?: number;
  readonly pointsI32Base?: number;
}
/** Reusable, wasm-backed contact buffer. Refilling allocates nothing on the JS
 * side; free it with destroyContactsBuffer when done. */
export interface ContactsBuffer extends ContactBuffer {}
/** Reusable, wasm-backed per-step events buffer. Fill with getEvents after each
 * b3World_Step, read with the get*EventAt helpers; free with destroyEventsBuffer. */
export interface EventsBuffer { readonly _brand?: 'EventsBuffer'; }
export interface ContactTouchEvent { shapeIdA: b3ShapeId; shapeIdB: b3ShapeId; contactId: b3ContactId; }
export interface ContactHitEvent {
  shapeIdA: b3ShapeId;
  shapeIdB: b3ShapeId;
  contactId: b3ContactId;
  point: b3Vec3;
  normal: b3Vec3;
  approachSpeed: number;
  userMaterialIdA: bigint;
  userMaterialIdB: bigint;
}
export interface BodyMoveEvent {
  bodyId: b3BodyId;
  position: b3Vec3;
  rotation: b3Quat;
  fellAsleep: boolean;
}
export interface SensorTouchEvent { sensorShapeId: b3ShapeId; visitorShapeId: b3ShapeId; }
export interface JointEvent { jointId: b3JointId; }
/** Packed plane buffer passed to the b3World_CollideMover callback. */
export interface PlaneResultBuffer { count: number; data: Float32Array; }
export interface PlaneResult { plane: { normal: b3Vec3; offset: number }; point: b3Vec3; }
/** Packed planes returned by b3Body_CollideMover: PlaneResultBuffer plus the shape id
 * of each plane (ShapeIdBuffer layout). Read with getBodyPlaneResultAt. */
export interface BodyPlaneResultBuffer extends PlaneResultBuffer { shapeIds: Int32Array; }
export interface BodyPlaneResult { shapeId: b3ShapeId; result: PlaneResult; }
/** Triangle positions/indices plus sphere (xyz, radius) and capsule (c1, c2, radius) parameters.
 * Views alias the wasm heap until the shape is destroyed or changed. Copy them to cache. */
export interface DebugGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  spheres: Float32Array;
  capsules: Float32Array;
}
export interface DebugDrawOptions {
  shapes?: boolean;
  bounds?: boolean;
  joints?: boolean;
  jointExtras?: boolean;
  mass?: boolean;
  contacts?: boolean;
  contactNormals?: boolean;
  contactForces?: boolean;
  frictionForces?: boolean;
  contactFeatures?: boolean;
  islands?: boolean;
  graphColors?: boolean;
  forceScale?: number;
  jointScale?: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ]. Defaults to a huge box so nothing is clipped. */
  drawingBounds?: b3AABB;
  maskBits?: number;
}
export interface DebugDrawBuffer { readonly _brand?: 'DebugDrawBuffer'; }
export interface DebugShapeRecord {
  geometryId: number;
  /** DebugShapeState.*.value */
  state: number;
  /** box3d packed colour; low 24 bits are RGB, the high byte is the debug material. */
  color: number;
  position: b3Vec3;
  rotation: b3Quat;
}
export interface DebugSegment { p1: b3Vec3; p2: b3Vec3; color: number; role: number; }
export interface DebugPoint { position: b3Vec3; size: number; color: number; role: number; }
export interface DebugSpherePrimitive { center: b3Vec3; radius: number; alpha: number; color: number; role: number; }
export interface DebugCapsulePrimitive { p1: b3Vec3; p2: b3Vec3; radius: number; alpha: number; color: number; role: number; }
export interface DebugBoxPrimitive { extents: b3Vec3; position: b3Vec3; rotation: b3Quat; color: number; role: number; }
export interface DebugBoundsPrimitive { aabb: b3AABB; color: number; role: number; }
export interface DebugTransformPrimitive { position: b3Vec3; rotation: b3Quat; role: number; }
export interface Contact {
  shapeIdA: b3ShapeId;
  shapeIdB: b3ShapeId;
  contactId: b3ContactId;
  manifoldCount: number;
}
export interface ManifoldPoint {
  anchorA: b3Vec3;
  anchorB: b3Vec3;
  separation: number;
  baseSeparation: number;
  normalImpulse: number;
  totalNormalImpulse: number;
  normalVelocity: number;
  featureId: number;
  triangleIndex: number;
  persisted: boolean;
}
export interface Manifold {
  normal: b3Vec3;
  twistImpulse: number;
  frictionImpulse: b3Vec3;
  rollingImpulse: b3Vec3;
  pointCount: number;
  points: ManifoldPoint[];
}
/** Packed convex decomposition: xyz points for every piece back to back, and
 * pieceCount + 1 vertex offsets (piece i is vertices offsets[i] .. offsets[i+1]). */
export interface b3ConvexDecomposition { points: Float32Array; offsets: Uint32Array; }
export interface b3ConvexDecompositionOptions {
  /** Maximum number of pieces. Default 32. */
  maxConvexHulls?: number;
  /** Voxel resolution; higher is more accurate and slower. Default 100000. */
  resolution?: number;
  /** Vertex budget per piece, clamped to [4, 255]. Default 32 (box3d hulls are capped at 255 half-edges). */
  maxVerticesPerHull?: number;
  /** Stop splitting once a piece is within this volume error, in percent. Default 1. */
  minVolumePercentError?: number;
  /** Maximum split recursion depth. Default 10. */
  maxRecursionDepth?: number;
  /** Project hull vertices back onto the source mesh. Default true. */
  shrinkWrap?: boolean;
  /** Use V-HACD's worker threads (multithreaded builds only; ignored otherwise). Default false. */
  useThreads?: boolean;
  /** Async variants only: reuse an earlier result for the same mesh + options instead of
   * running V-HACD again. Default true. Arrays passed with the cache on must not be edited
   * in place afterwards (their hash is memoized per array object). */
  cache?: boolean;
  /** Async variants only: identifies the mesh in the cache (e.g. an asset id) instead of
   * hashing its contents. Change it whenever the mesh changes. */
  cacheKey?: string;
}
export interface b3ConvexDecompositionCacheStats { entries: number; hits: number; misses: number; }
/** Shape ids created from a decomposition (ShapeIdBuffer layout, read with getShapeIdAt),
 * plus the number of pieces that could not become a box3d hull. */
export interface b3DecompositionShapes extends ShapeIdBuffer { skipped: number; }
export interface b3DecompositionCompound { compound: b3CompoundData | null; skipped: number; }
/** Reusable, wasm-backed vehicle readout. Fill with getVehicleStateData after each
 * b3World_Step; free with destroyVehicleStateBuffer. */
export interface VehicleStateBuffer { readonly _brand?: 'VehicleStateBuffer'; }
export interface VehicleStateRecord {
  /** Forward speed (m/s) */
  speed: number;
  engineRpm: number;
  /** Summed turbo boost. The engine makes 1 + boost times its torque curve. */
  boost: number;
  /** -1 reverse, 0 neutral, 1 and up forward gears */
  gear: number;
  isShifting: boolean;
  throttle: number;
  brake: number;
  /** Center steer angle, positive left (radians) */
  steerAngle: number;
  wheelsInContact: number;
  stuck: boolean;
}
export interface VehicleWheelRecord {
  /** Wheel center, world space */
  position: b3Vec3;
  /** Wheel orientation including steering and spin */
  rotation: b3Quat;
  hasContact: boolean;
  isSticky: boolean;
  contactPoint: b3Vec3;
  contactNormal: b3Vec3;
  groundShapeId: b3ShapeId;
  userMaterialId: bigint;
  suspensionLength: number;
  /** 0 fully extended, 1 at the bump stop */
  compression: number;
  /** Normal force (N) */
  load: number;
  longitudinalForce: number;
  lateralForce: number;
  slipRatio: number;
  /** Radians */
  slipAngle: number;
  /** Spin (rad/s) */
  angularVelocity: number;
  rotationAngle: number;
  steerAngle: number;
  driveTorque: number;
  brakeTorque: number;
}
export interface Box3DFacade {
  /** Recommended way to give a body a convex decomposition. Decomposes the mesh without
   * blocking the calling thread, then attaches one hull shape per piece in a single call.
   * Single-threaded builds run V-HACD in a Web Worker (Node: synchronously); multithreaded
   * builds on a pthread. Create the body disabled and enable it once this resolves, so it
   * doesn't fall without shapes. Rejects if the body is destroyed first. Results are
   * cached (see options.cache), so further bodies of the same mesh skip V-HACD. */
  b3CreateConvexDecompositionShapesAsync(bodyId: b3BodyId, shapeDef: b3ShapeDef, positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): Promise<b3DecompositionShapes>;
  /** Packed decomposition computed without blocking the calling thread (same threading as
   * b3CreateConvexDecompositionShapesAsync). Use it for static compounds and caching. */
  b3ComputeConvexDecompositionAsync(positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): Promise<b3ConvexDecomposition>;
  /** Cache key the async variants use: options.cacheKey or a 64-bit hash of the mesh
   * (memoized per array pair), plus every option that changes the result. */
  b3ConvexDecompositionCacheKey(positions: ArrayLike<number>, indices: ArrayLike<number>, options?: b3ConvexDecompositionOptions): string;
  /** Drops every cached decomposition and memoized mesh hash, and resets the stats. */
  b3ClearConvexDecompositionCache(): void;
  b3GetConvexDecompositionCacheStats(): b3ConvexDecompositionCacheStats;
  b3PackConvexDecomposition(parts: ArrayLike<number>[]): b3ConvexDecomposition;
  b3UnpackConvexDecomposition(packed: b3ConvexDecomposition): Float32Array[];
  getNumShapeIds(buf: ShapeIdBuffer): number;
  createShapeId(): b3ShapeId;
  getShapeIdAt(out: b3ShapeId, buf: ShapeIdBuffer, i: number): b3ShapeId;
  getNumContacts(buf: ContactBuffer): number;
  createContact(): Contact;
  getContactAt(out: Contact, buf: ContactBuffer, i: number): Contact;
  createPoint(): ManifoldPoint;
  createManifold(): Manifold;
  getManifoldAt(out: Manifold, contact: Contact, m: number): Manifold;
  createContactsBuffer(): ContactsBuffer;
  getShapeContactData(buf: ContactsBuffer, shapeId: b3ShapeId): ContactsBuffer;
  getBodyContactData(buf: ContactsBuffer, bodyId: b3BodyId): ContactsBuffer;
  destroyContactsBuffer(buf: ContactsBuffer): void;
  createEventsBuffer(): EventsBuffer;
  getEvents(eb: EventsBuffer, worldId: b3WorldId): EventsBuffer;
  destroyEventsBuffer(eb: EventsBuffer): void;
  getNumContactBeginEvents(eb: EventsBuffer): number;
  getNumContactEndEvents(eb: EventsBuffer): number;
  getNumContactHitEvents(eb: EventsBuffer): number;
  getNumBodyMoveEvents(eb: EventsBuffer): number;
  getNumSensorBeginEvents(eb: EventsBuffer): number;
  getNumSensorEndEvents(eb: EventsBuffer): number;
  getNumJointEvents(eb: EventsBuffer): number;
  createContactTouchEvent(): ContactTouchEvent;
  getContactBeginEventAt(out: ContactTouchEvent, eb: EventsBuffer, i: number): ContactTouchEvent;
  getContactEndEventAt(out: ContactTouchEvent, eb: EventsBuffer, i: number): ContactTouchEvent;
  createContactHitEvent(): ContactHitEvent;
  getContactHitEventAt(out: ContactHitEvent, eb: EventsBuffer, i: number): ContactHitEvent;
  createBodyMoveEvent(): BodyMoveEvent;
  getBodyMoveEventAt(out: BodyMoveEvent, eb: EventsBuffer, i: number): BodyMoveEvent;
  /** Every body move event of the last getEvents in one copied array, 11 numbers per event:
   * index1, world0, generation, px, py, pz, qx, qy, qz, qw, fellAsleep (0/1). */
  getBodyMoveEventsPacked(eb: EventsBuffer): Float64Array;
  /** Rule ids for b3World_SetMixingRules. 'weighted' mixes (a*wA + b*wB) / (wA + wB) with per-shape
   * weights packed into each shape's userMaterialId, so while it is active that field holds the weights
   * and can't double as a material tag: bits 0-31 friction weight * 1000, bits 32-62 restitution
   * weight * 1000, bit 63 set = weights present. A shape without bit 63 uses box3d's default rule. */
  readonly b3MixingRule: {
    readonly geometric: 0;
    readonly average: 1;
    readonly min: 2;
    readonly max: 3;
    readonly multiply: 4;
    readonly weighted: 5;
  };
  createSensorTouchEvent(): SensorTouchEvent;
  getSensorBeginEventAt(out: SensorTouchEvent, eb: EventsBuffer, i: number): SensorTouchEvent;
  getSensorEndEventAt(out: SensorTouchEvent, eb: EventsBuffer, i: number): SensorTouchEvent;
  createJointEvent(): JointEvent;
  getJointEventAt(out: JointEvent, eb: EventsBuffer, i: number): JointEvent;
  getNumPlaneResults(buf: PlaneResultBuffer): number;
  createPlaneResult(): PlaneResult;
  getPlaneResultAt(out: PlaneResult, buf: PlaneResultBuffer, i: number): PlaneResult;
  getNumBodyPlaneResults(buf: BodyPlaneResultBuffer): number;
  createBodyPlaneResult(): BodyPlaneResult;
  getBodyPlaneResultAt(out: BodyPlaneResult, buf: BodyPlaneResultBuffer, i: number): BodyPlaneResult;
  /** Reusable wasm buffer filled by getDebugDraw. Free it with destroyDebugDrawBuffer. */
  createDebugDrawBuffer(): DebugDrawBuffer;
  /** One b3World_Draw pass per enabled role. Refreshes the heap views; allocates nothing. */
  getDebugDraw(buf: DebugDrawBuffer, worldId: b3WorldId, options?: DebugDrawOptions): DebugDrawBuffer;
  destroyDebugDrawBuffer(buf: DebugDrawBuffer): void;
  getNumDebugShapes(buf: DebugDrawBuffer): number;
  getNumDebugSegments(buf: DebugDrawBuffer): number;
  getNumDebugPoints(buf: DebugDrawBuffer): number;
  getNumDebugSpheres(buf: DebugDrawBuffer): number;
  getNumDebugCapsules(buf: DebugDrawBuffer): number;
  getNumDebugBoxes(buf: DebugDrawBuffer): number;
  getNumDebugBounds(buf: DebugDrawBuffer): number;
  getNumDebugTransforms(buf: DebugDrawBuffer): number;
  createDebugShapeRecord(): DebugShapeRecord;
  getDebugShapeAt(out: DebugShapeRecord, buf: DebugDrawBuffer, i: number): DebugShapeRecord;
  createDebugSegment(): DebugSegment;
  getDebugSegmentAt(out: DebugSegment, buf: DebugDrawBuffer, i: number): DebugSegment;
  createDebugPoint(): DebugPoint;
  getDebugPointAt(out: DebugPoint, buf: DebugDrawBuffer, i: number): DebugPoint;
  createDebugSpherePrimitive(): DebugSpherePrimitive;
  getDebugSphereAt(out: DebugSpherePrimitive, buf: DebugDrawBuffer, i: number): DebugSpherePrimitive;
  createDebugCapsulePrimitive(): DebugCapsulePrimitive;
  getDebugCapsuleAt(out: DebugCapsulePrimitive, buf: DebugDrawBuffer, i: number): DebugCapsulePrimitive;
  createDebugBoxPrimitive(): DebugBoxPrimitive;
  getDebugBoxAt(out: DebugBoxPrimitive, buf: DebugDrawBuffer, i: number): DebugBoxPrimitive;
  createDebugBoundsPrimitive(): DebugBoundsPrimitive;
  getDebugBoundsAt(out: DebugBoundsPrimitive, buf: DebugDrawBuffer, i: number): DebugBoundsPrimitive;
  createDebugTransformPrimitive(): DebugTransformPrimitive;
  getDebugTransformAt(out: DebugTransformPrimitive, buf: DebugDrawBuffer, i: number): DebugTransformPrimitive;
  createVehicleStateBuffer(): VehicleStateBuffer;
  /** Packs the vehicle state and every wheel's state and transform in one call. */
  getVehicleStateData(buf: VehicleStateBuffer, vehicleId: b3VehicleId): VehicleStateBuffer;
  destroyVehicleStateBuffer(buf: VehicleStateBuffer): void;
  getNumVehicleWheels(buf: VehicleStateBuffer): number;
  createVehicleStateRecord(): VehicleStateRecord;
  getVehicleStateAt(out: VehicleStateRecord, buf: VehicleStateBuffer): VehicleStateRecord;
  createVehicleWheelRecord(): VehicleWheelRecord;
  getVehicleWheelAt(out: VehicleWheelRecord, buf: VehicleStateBuffer, i: number): VehicleWheelRecord;
}
export type Box3DModule = WasmModule & EmbindModule & Box3DFacade;
export default function Box3DFactory (options?: unknown): Promise<Box3DModule>;
