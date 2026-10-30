import Box3D from 'box3d.js/inline';
import type { Box3DModule } from 'box3d.js';
import { applyTurbo, buildVehiclePreset, createPresetVehicleDef, vehiclePresets } from 'box3d.js/vehicles';

const b3: Box3DModule = await Box3D();
const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -9.81, 0];
const world = b3.b3CreateWorld(worldDef);

const groundDef = b3.b3DefaultBodyDef();
groundDef.position = [0, -0.5, 0];
b3.b3CreateBoxShape(b3.b3CreateBody(world, groundDef), b3.b3DefaultShapeDef(), 200, 0.5, 200);

/* SNIPPET_START: create */
// The vehicle drives an existing dynamic body. Create the chassis shapes first.
const chassisDef = b3.b3DefaultBodyDef();
chassisDef.type = b3.b3BodyType.b3_dynamicBody;
chassisDef.position = [0, 1, 0];
const chassis = b3.b3CreateBody(world, chassisDef);
b3.b3CreateBoxShape(chassis, b3.b3DefaultShapeDef(), 0.9, 0.3, 2.1);

// The default is a 1300 kg rear wheel drive sedan: +Z forward, +Y up, wheels in the order
// front left, front right, rear left, rear right.
const vehicleDef = b3.b3DefaultVehicleDef();
vehicleDef.chassisId = chassis;
vehicleDef.engine.maxTorque = 420;
vehicleDef.assists.abs = true;

// Make it all wheel drive: 40% of the torque to the front axle, 60% to the rear
vehicleDef.drivetrain.differentials[0] = { leftWheel: 0, rightWheel: 1, torqueRatio: 0.4, leftRightSplit: 0.5, limitedSlipRatio: 1 };
vehicleDef.drivetrain.differentials[1] = { leftWheel: 2, rightWheel: 3, torqueRatio: 0.6, leftRightSplit: 0.5, limitedSlipRatio: 1.3 };
vehicleDef.drivetrain.differentialCount = 2;

const vehicle = b3.b3CreateVehicle(world, vehicleDef);
/* SNIPPET_END: create */

/* SNIPPET_START: drive */
// forward: -1..1 (the automatic gearbox brakes first, then selects reverse), steer: -1 left
// to 1 right, brake and handbrake: 0..1. Input wakes the chassis.
b3.b3Vehicle_SetInput(vehicle, { forward: 1, brake: 0, steer: -0.3, handbrake: 0 });
b3.b3World_Step(world, 1 / 60, 4);
/* SNIPPET_END: drive */

/* SNIPPET_START: read */
// One call per frame packs the vehicle and wheel state into a reusable wasm buffer
const stateBuffer = b3.createVehicleStateBuffer();
const state = b3.createVehicleStateRecord();
const wheel = b3.createVehicleWheelRecord();

b3.getVehicleStateData(stateBuffer, vehicle);
b3.getVehicleStateAt(state, stateBuffer);
console.log(`${(state.speed * 3.6).toFixed(0)} km/h, gear ${state.gear}, ${state.engineRpm.toFixed(0)} rpm`);

for (let i = 0; i < b3.getNumVehicleWheels(stateBuffer); i++) {
    b3.getVehicleWheelAt(wheel, stateBuffer, i);
    // wheel.position / wheel.rotation: world space wheel transform including steering and spin
    // wheel.load, slipRatio, slipAngle, compression, hasContact, contactPoint, ...
}

b3.destroyVehicleStateBuffer(stateBuffer);
/* SNIPPET_END: read */

/* SNIPPET_START: wheels-local */
// Wheel meshes parented to the chassis mesh need only each wheel's pose in chassis space. One call
// fills a Float32Array for every wheel: position (3), rotation x, y, z, w (4), then the raw
// rotationAngle, angularVelocity, steerAngle and suspensionLength.
const stride = b3.B3_VEHICLE_WHEEL_LOCAL_STRIDE; // 11
const wheelData = new Float32Array(b3.B3_MAX_VEHICLE_WHEELS * stride);
const wheelCount = b3.b3Vehicle_GetWheelLocalData(wheelData, vehicle);

const dt = 1 / 60;
const alpha = 0.5; // how far the render frame is between the last two physics steps
const previousAngles = new Float32Array(b3.B3_MAX_VEHICLE_WHEELS);
for (let i = 0; i < wheelCount; i++) {
    const o = i * stride;
    const localPosition = wheelData.subarray(o, o + 3);
    const localRotation = wheelData.subarray(o + 3, o + 7);
    // rotationAngle wraps to [-pi, pi] and a fast wheel turns more than pi in a step, so neither the
    // angles nor the quaternions tell how far it turned. Unwrap the change to the turn nearest
    // angularVelocity * dt, then rebuild the rotation from the interpolated spin and steerAngle.
    const rotationAngle = wheelData[o + 7];
    const angularVelocity = wheelData[o + 8];
    const turn = rotationAngle - previousAngles[i];
    const delta = turn + 2 * Math.PI * Math.round((angularVelocity * dt - turn) / (2 * Math.PI));
    const spin = previousAngles[i] + delta * alpha;
    previousAngles[i] = rotationAngle;
}

// One wheel, as b3Vehicle_GetWheelTransform does in world space
const [wheelPosition, wheelRotation] = b3.b3Vehicle_GetWheelLocalTransform([0, 0, 0], [0, 0, 0, 1], vehicle, 0);
/* SNIPPET_END: wheels-local */

/* SNIPPET_START: tune */
// Every part of the definition can be changed while driving. Changes apply on the next step.
const suspension = b3.b3Vehicle_GetWheel(vehicle, 0);
suspension.suspension.frequency = 2.2;
b3.b3Vehicle_SetWheel(vehicle, 0, suspension);

const assists = b3.b3Vehicle_GetAssists(vehicle);
assists.tractionControl = false;
assists.driftGripScale = 0.5; // the handbrake makes the rear loose
b3.b3Vehicle_SetAssists(vehicle, assists);

// Flip the car back onto its wheels
b3.b3Vehicle_Reset(vehicle, [0, 1.5, 0], [0, 0, 0, 1]);
/* SNIPPET_END: tune */

/* SNIPPET_START: turbo */
// A turbo multiplies the torque curve by 1 + boost. Each stage's shaft spools toward a target set
// by the pedal and the rpm (spoolTime is the lag at full throttle and fullBoostRpm) and spins down
// with the bleed time. Boost dumps when you lift, but a spinning shaft brings it straight back.
const turbo = b3.b3Vehicle_GetTurbo(vehicle);
turbo.stages[0] = { gain: 0.5, spoolRpm: 2500, fullBoostRpm: 4000, spoolTime: 0.8, bleedTime: 1.2 };
b3.b3Vehicle_SetTurbo(vehicle, turbo);

// A sequential twin adds a second, slower stage higher up
turbo.stages[1] = { gain: 0.3, spoolRpm: 4500, fullBoostRpm: 5500, spoolTime: 1.2, bleedTime: 1.8 };
// instantFraction 1 removes the lag (a supercharger), parasiticTorque is its belt drive loss,
// and antiLag holds the boost off throttle and through shifts
turbo.instantFraction = 0;
turbo.antiLag = false;
b3.b3Vehicle_SetTurbo(vehicle, turbo);

b3.b3World_Step(world, 1 / 60, 4);
console.log(`boost +${(b3.b3Vehicle_GetState(vehicle).boost * 100).toFixed(0)}%`);
/* SNIPPET_END: turbo */

/* SNIPPET_START: presets */
// box3d.js/vehicles has ready tuned cars. A preset tunes a b3DefaultVehicleDef() and gives the
// size of the chassis box it was tuned for.
const presetName = 'rally-50-awd'; // <car>-<realism>-<drive>, or 'fwd' | 'rwd' | 'awd' | 'offroad'
const [hx, hy, hz] = vehiclePresets[presetName].halfExtents;

const rallyBodyDef = b3.b3DefaultBodyDef();
rallyBodyDef.type = b3.b3BodyType.b3_dynamicBody;
rallyBodyDef.position = [5, 1, 0];
const rallyChassis = b3.b3CreateBody(world, rallyBodyDef);
b3.b3CreateBoxShape(rallyChassis, b3.b3DefaultShapeDef(), hx, hy, hz);

const rallyDef = createPresetVehicleDef(b3, presetName);
rallyDef.chassisId = rallyChassis;
const rally = b3.b3CreateVehicle(world, rallyDef);

// Or build one from its layers, with an optional turbo type, and change anything before creating it
const superDef = buildVehiclePreset(b3, 'super', 25, 'rwd', 'parallel');
superDef.assists.abs = true;
applyTurbo(superDef, 'supercharger'); // swaps the forced induction, keeping the rated peak torque
/* SNIPPET_END: presets */
