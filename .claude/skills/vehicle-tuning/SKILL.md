---
name: vehicle-tuning
description: Build or tune a box3d.js vehicle (b3VehicleDef) to a brief such as "75% realistic FWD hot hatch" or "arcade RWD supercar", and prove it with the vehicle metrics script. Use when adding or changing a car preset in examples/src/vehicle-presets.js, when a car drives wrong (spins, flips, understeers, won't shift, brakes long), or when asked how realistic or arcade a car feels.
---

# Vehicle tuning

A car is a `b3VehicleDef` built in three layers on top of `b3.b3DefaultVehicleDef()`:

1. **Car**: the body, wheels, suspension, real tires, engine, gearbox, brakes and aero, as the car would be with no driving aids beyond its own. Pick numbers from the archetype in [reference/archetypes.md](reference/archetypes.md).
2. **Drivetrain**: which wheels are driven, the differentials, and the weight and anti-roll changes that go with the layout. See [reference/drivetrains.md](reference/drivetrains.md).
3. **Realism level**: grip multiplier, arcade assists and stability aids, from 100% realistic to arcade. Use the table in [reference/realism.md](reference/realism.md) as is; it is shared by every car.

Every field and what the engine really does with it is in [reference/parameters.md](reference/parameters.md). Lessons from tuning the 45 car matrix, including engine quirks that will bite you, are in [reference/findings.md](reference/findings.md). Read findings.md before you start.

## Workflow

1. **Pin the brief.** Archetype (sports, rally, super, hatch, or the closest), realism level (100, 75, 50, 25, 0) and drivetrain (fwd, rwd, awd). If the brief is between levels, pick the nearer one and say so.
2. **Write the car layer** from the archetype ranges: mass, center of mass, wheel layout, tires, engine, gears, brakes, bars, steering, aero. Check the derived numbers before you run anything (see "Sanity math" below).
3. **Apply the drivetrain layer**, then **the realism row**, exactly as the reference tables say.
4. **Measure.** Save the car as a preset module (template below) and run
   `node examples/scripts/vehicle-metrics.mjs --file path/to/car.mjs`
   from the repo root. It needs the built `dist/` (already committed). One car takes about a second.
5. **Fix one symptom at a time** with the cheat sheet below. Change one knob, re-run, keep a note of what moved. Never widen a target range to make a car pass. If you believe a target is wrong, say so separately.
6. **Done** when every check passes. For a set of cars (one car at several realism levels), also run them together so the realism ordering checks run: `--car <name>` for matrix cars, or check by hand that grip and braking improve and roll falls as realism drops.

To work on the committed matrix instead, use `--preset rally-50-awd`, `--car rally` (all 15 rally presets) or `--all` (45 presets, about 15 s). Add `--json` for machine readable output and `--quick` to skip the top speed run while iterating.

## Preset module for `--file`

```js
// my-car.mjs
const deg = (d) => (d * Math.PI) / 180;

export const target = { archetype: 'hatch', realism: 75, drive: 'fwd' };

export const preset = {
	title: 'Hot hatch, FWD, 75% realistic',
	halfExtents: [0.7, 0.32, 2.0], // chassis collision box (m), also sets the yaw inertia
	apply(def) {
		def.chassis.mass = 1350;
		// ... car layer, drivetrain layer, realism row ...
		return def;
	},
};
```

Rules for `apply(def)`:

- `def` comes from `b3DefaultVehicleDef()`: 4 wheels in the order front left, front right, rear left, rear right, +z forward, +y up, left is +x.
- Fixed size arrays stay fixed size. Set `def.transmission.gearRatios[i]` and `gearCount`, `def.drivetrain.differentials[i]` and `differentialCount`, `def.antiRoll.bars[i]` and `barCount`. Fill unused differentials with `{ leftWheel: -1, rightWheel: -1, torqueRatio: 0, leftRightSplit: 0.5, limitedSlipRatio: 1 }` and unused bars with `{ leftWheel: -1, rightWheel: -1, stiffness: 0 }`.
- Replace vector fields whole: `def.chassis.centerOfMassOffset = [0, -0.1, 0.05]`, not `[1] = ...`.
- Angles are radians.
- Plain object writes only: no imports from the repo and no globals, so the module runs anywhere.

## What the metrics measure

All on flat ground with the default shape friction (0.6, the tire reference, so grip is scaled by 1).

| Metric | Test | Realistic means |
| --- | --- | --- |
| `zeroTo100` | flat out from rest | archetype range; two wheel drive gets 0.6 s slack (no launch control) |
| `topSpeed` | flat out for up to 90 s | archetype range |
| `braking` | lift 0.25 s, full brake from 100 km/h | archetype range ÷ realism grip |
| `lateralG` | 70 km/h, steering ramped to half lock with the speed falloff off | archetype range × realism grip |
| `stepRoll`, `spun`, `flipped` | 120 km/h then full steer with the throttle held for 3 s | realistic cars roll and may spin; arcade cars barely roll and must not spin |
| `handbrakeYaw`, `handbrakeRate` | 60 km/h, full steer and a 0.8 s handbrake pull | must rotate; less realism rotates faster |
| `sideRighted`, `roofRighted` | dropped on the side and on the roof, 6 s | 100% stays on its roof; 50% and below get back on their wheels |
| `rough*` | 15 s flat out over bumps, weaving | finite state always; 50% and below stay upright |

## Symptom to knob cheat sheet

| Symptom | First knob | Then |
| --- | --- | --- |
| 0-100 too slow, wheels spinning (rpm at the limiter, slip ≫ peak) | more weight on the driven axle (`centerOfMassOffset` z), limited slip on the driven diff | shorter first gear does not help: it is traction limited. TC on a two wheel drive car costs time too, see findings |
| 0-100 too slow, no wheelspin | `engine.maxTorque`, `finalDrive`, lower `engine.inertia` | `peakTorqueRpm` closer to the launch rpm |
| top speed low, gear stuck below the top gear | `shiftUpRpm` at least 5% under `maxRpm` | see findings: the shift uses road rpm, which trails the engine |
| top speed low in the top gear | `assists.drag`, top gear × `finalDrive` | rolling resistance, wheel `angularDamping` |
| top speed high | `assists.drag` up, or a taller limiter: `maxRpm` with the top gear | |
| braking long | tire friction, `abs: true` | brake torque near 1.1-1.6x the tire's peak torque (load × μ × radius); far above it locks wheels under ABS |
| braking long only on driven wheels / FWD / AWD | see the ABS finding; lower front `maxBrakeTorque` toward 1.15x the peak | |
| lateral g low | `lateralPeakFriction` and `lateralSlideFriction` | lower `rollInfluence` does not add grip; downforce only helps at speed |
| understeer (front slides first, FWD) | stiffer rear bar, softer front bar | front `lateralPeakFriction`, front weight (z) |
| snap oversteer, spins in the step steer | softer rear bar or stiffer front, rear LSD lower, `counterSteer` (arcade only) | rear tire `lateralSlideFriction` closer to the peak |
| too much body roll | anti-roll bars, then spring `frequency`, lower `comHeight` | `rollInfluence` (an assist: realism 50 and below) |
| no body roll at 100% realism | softer bars, `rollInfluence` 0 | |
| flips in corners | lower center of mass, `rollInfluence` up, `maxTiltAngle` | never on a realistic car on flat ground: fix the geometry first |
| handbrake does nothing | `maxHandBrakeTorque` above the rear peak torque, `driftGripScale` < 1 | test with full steer, not a little |
| handbrake rotates less on the arcade level | `counterSteer` too high: it catches the slide | keep `counterSteer` ≤ 0.6 with `driftGripScale` ≤ 0.4 |
| stays on its roof at an arcade level | `selfRighting` up (taller bodies need more: 4 at 50%) | |
| rights itself from the roof at 100% | `selfRighting` must be 0 | |
| bounces or floats | `compressionDamping`/`reboundDamping` toward 0.5/0.8, spring `frequency` up | |
| bottoms out on bumps | `maxLength - minLength` (travel), `frequency` up | |

## Sanity math before running

- Tire peak torque per wheel ≈ load × μ × radius, with load ≈ mass × 9.81 × axle share ÷ 2. Brakes should exceed this (or they never reach the peak) but not by more than about 1.6x (front, with ABS).
- Wheel force in first gear = `maxTorque` × gear × `finalDrive` ÷ radius. If this is several times the driven axle's grip (load × μ), the launch is traction limited.
- Speed at the limiter in gear n = `maxRpm` ÷ (gear n × `finalDrive`) × 2π ÷ 60 × radius. The top gear should limit above the target top speed, so drag sets the top speed.
- Drag limited top speed v ≈ (P ÷ `drag`)^(1/3), with P the power near the top of the rev range in watts.
- AWD shares (`torqueRatio`) must add up to 1.

## Writing back

When a tuning session teaches something new (a knob that did not do what the cheat sheet says, an engine quirk), add it to [reference/findings.md](reference/findings.md) with the measurement that showed it, and fix the cheat sheet if it was wrong.
