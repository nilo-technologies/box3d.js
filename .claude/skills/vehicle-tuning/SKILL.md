---
name: vehicle-tuning
description: Build or tune a box3d.js vehicle (b3VehicleDef) to a brief such as "75% realistic FWD hot hatch" or "arcade RWD supercar", and prove it with the vehicle metrics script. Use when adding or changing a car preset in src/vehicles.js (box3d.js/vehicles), when a car drives wrong (spins, flips, understeers, won't shift, brakes long), or when asked how realistic or arcade a car feels.
---

# Vehicle tuning

A car is a `b3VehicleDef` built in three layers on top of `b3.b3DefaultVehicleDef()`:

1. **Car**: the body, wheels, suspension, real tires, engine, gearbox, brakes and aero, as the car would be with no driving aids beyond its own. Pick numbers from the archetype in [reference/archetypes.md](reference/archetypes.md).
2. **Drivetrain**: which wheels are driven, the differentials, and the weight and anti-roll changes that go with the layout. See [reference/drivetrains.md](reference/drivetrains.md).
3. **Realism level**: grip multiplier, arcade assists and stability aids, from 100% realistic to arcade. Use the table in [reference/realism.md](reference/realism.md) as is; it is shared by every car.

Every field and what the engine really does with it is in [reference/parameters.md](reference/parameters.md). Lessons from tuning the 45 car matrix, including engine quirks that will bite you, are in [reference/findings.md](reference/findings.md). Read findings.md before you start.

## Workflow

1. **Pin the brief.** Archetype (sports, rally, super, hatch, or the closest), realism level (100, 75, 50, 25, 0) and drivetrain (fwd, rwd, awd). If the brief is between levels, pick the nearer one and say so.
2. **Write the car layer** from the archetype ranges: mass, center of mass, wheel layout, tires, engine, gears, brakes, bars, steering, aero. Any field the archetype does not list stays at its `b3DefaultVehicleDef()` default; that is intended. Check the derived numbers before you run anything (see "Sanity math" below).
3. **Apply the drivetrain layer**, then **the realism row**, exactly as the reference tables say, in that order. The realism row comes last because it multiplies or offsets values the earlier layers set (tire friction, rear brakes, steering falloff, downforce, center of mass height). Front brake and handbrake torques are not scaled by the realism row; the rear brake is, by the tire grip, so size it in the car layer for 100% grip. For a single preset, size the front brake in the car layer for the grip of the level you are building (see "Sanity math"). In the matrix one car layer serves all five levels, so size them once and check every level with `--car`.
4. **Measure.** Save the car as a preset module (template below) and run
   `node examples/scripts/vehicle-metrics.mjs --file path/to/car.mjs`
   from the repo root. It needs the built `dist/` (already committed). One car takes about a second.
5. **Fix one symptom at a time** with the cheat sheet below. Change one knob, re-run, keep a note of what moved. Never widen a target range to make a car pass. If you believe a target is wrong, say so separately.
6. **Drive it with the keyboard**: `node examples/scripts/vehicle-wasd.mjs --preset <name>` or `--car <name>` (about 3 s a preset). A WASD driver laps a flat course through `createSteeringLimiter`, as a keyboard player does in the examples, sweeping the pace in g, and reports the highest clean pace (mean over three driver styles) and how the car fails above it (slide, plough or spin). Compare clean paces before and after a change; differences under 0.1 g are noise. Arcade levels should fail by sliding, not ploughing; see "Keyboard driving" below.
7. **Check robustness**: run again with `--perturb`, which repeats every test with the mass 3% off and the grip 2% off each way. A car that only passes at its exact values will flip on the next small change.
8. **Done** when every check passes, perturbed runs included. For a set of cars (one car at several realism levels), also run them together so the realism ordering checks run: `--car <name>` for matrix cars, or check by hand that grip and braking improve and roll falls as realism drops.

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
- Fixed size arrays stay fixed size: `wheels` has 8 slots, `transmission.gearRatios` 8, `drivetrain.differentials` 4 and `antiRoll.bars` 4. Unused gear slots are 0. Set `def.transmission.gearRatios[i]` and `gearCount`, `def.drivetrain.differentials[i]` and `differentialCount`, `def.antiRoll.bars[i]` and `barCount`. Fill unused differentials with `{ leftWheel: -1, rightWheel: -1, torqueRatio: 0, leftRightSplit: 0.5, limitedSlipRatio: 1 }` and unused bars with `{ leftWheel: -1, rightWheel: -1, stiffness: 0 }`.
- Replace vector fields whole: `def.chassis.centerOfMassOffset = [0, -0.1, 0.05]`, not `[1] = ...`.
- Angles are radians.
- Plain object writes only: no imports from the repo and no globals, so the module runs anywhere.

## What the metrics measure

All on flat ground with the default shape friction (0.6, the tire reference, so grip is scaled by 1). The exact ranges for each realism level, and the fixed ranges below, are in [reference/realism.md](reference/realism.md) under "How the targets scale". `--json` prints every check with its range. A car gets 26 checks at 50% realism and below and 17 at 75% and 100% (the spin and righting rules differ); `--quick` drops the top speed check.

| Metric | Test | Realistic means |
| --- | --- | --- |
| `zeroTo100` | flat out from rest, launch control on | archetype range |
| `topSpeed` | flat out for up to 90 s | archetype range |
| `braking` | lift 0.25 s, full brake from 100 km/h | archetype range ÷ realism grip |
| `lateralG` | 70 km/h, steering ramped to half lock with the speed falloff off | archetype range × realism grip |
| `stepRoll`, `spun`, `flipped` | 120 km/h then full steer with the throttle held for 3 s | realistic cars roll and may spin; arcade cars barely roll and must not spin |
| `turnsAtSpeed` | the same step steer: lateral g averaged over 0.5-2.5 s | from 75% down, full lock must use a share of the level's grip (0.75-0.9 of the lateral g floor) |
| `forgiving brakeTurn`, `trailBrake`, `liftOff`, `slalom`, `flick` | keyboard moves through `createSteeringLimiter` (as a keyboard player drives): full brake and lock at 110 km/h, braking mid corner, lifting mid corner, lock to lock, opposite lock and let go | at 50% and below the peak sideslip stays under 25° |
| `shiftShare` | flat out through the gears | the engine upshifts at 87-93% of the limiter (median), as racing games do |
| `handbrakeYaw`, `handbrakeRate` | 60 km/h, full steer and a 0.8 s handbrake pull | at least 45° and 60°/s; less realism rotates faster |
| `sideRighted`, `roofRighted` | dropped on the side and on the roof, 6 s | 100% stays on its roof; 50% and below get back on their wheels |
| `rough*` | 15 s flat out over bumps, weaving | finite state always; 50% and below stay upright |
| `rideHeight`, `drivesStraight`, `brakesUpright` | settle, launch, braking | 0.3-1.2 m chassis height, under 2 m off line, no tipping |

## Keyboard driving

Most players use WASD: full lock, full throttle or full brake, nothing in between. The examples pass the steer input through `createSteeringLimiter` (shipped in `box3d.js/vehicles`), which caps the steer angle at 1.5 times the front tires' peak slip angle from the direction the front axle travels, and at the peak itself while braking. The presets are tuned for it. What the WASD sweep taught (findings #36-38):

- The front to rear tire balance decides whether a keyboard car turns, ploughs or spins. Without a limiter, full lock at speed takes the fronts far past their peak, and that understeer is what keeps the car from spinning. A limiter that holds the fronts near their best grip removes that safety, so the rear tires need about 5% more side grip than the fronts (`rear.tire` in the car layer; wide rear tires on a real car do the same).
- A cap right at the peak (1.0) makes every corner taken too fast plough wide; 1.5 lets the car turn in and slide when overdone. Braking with extra lock spins the car, so the cap returns to the peak under the brake (`brakingPeakScale`).
- More steering at speed (`speedReference`) and lateral slide friction close to the peak raise the clean pace the most. Anti-roll bars, spring rates, the center of mass, steering rates, engine torque and the final drive barely move it (under 0.1 g): tire grip is linear in load in this engine, so load transfer does not shift the balance.
- With a keyboard throttle, a car without traction control steps out on every corner exit. Modern road cars have TC; give it to them.
- The same recipe fitted the rally car and the supercar: a rear tire bias, slide friction near the peak, `speedReference` 15, a rear brake near the ideal split. Check the rear differential too: a strongly locking one (1.6 on the rally car) spins the car on power (findings #39).
- Arcade levels must still slide when overdone. `rearGrip` just under 1 (0.975 at arcade) turns the RWD car's overspeed failure from a plough into a slide; FWD and AWD cars still run wide, as front driven cars do.

## Symptom to knob cheat sheet

| Symptom | First knob | Then |
| --- | --- | --- |
| 0-100 too slow, wheels spinning (rpm at the limiter, slip ≫ peak) | more weight on the driven axle (`centerOfMassOffset` z), limited slip on the driven diff | shorter first gear does not help: it is traction limited. Check `launchControl` is on: it holds the tires at their peak from rest, TC alone does not (findings #8, #28) |
| 0-100 too slow, no wheelspin | `engine.maxTorque`, `finalDrive`, lower `engine.inertia` | `peakTorqueRpm` closer to the launch rpm |
| shift point off (the `shiftShare` check) | `shiftUpRpm` ≈ 0.9 × `maxRpm` minus the clutch slip (about 270 rpm, 490 on a 720 N·m car) | the gearbox reads road rpm, which trails the engine, so the engine shifts higher than the setting |
| top speed low, and the output shows a gear below the top one at the limiter | `shiftUpRpm` lower | as above: road rpm never reaches a setting near the limiter |
| tops out a gear below the top one, below the limiter | fine if it passes: the road rpm in that gear sits just under `shiftUpRpm`. To use the top gear, lower `shiftUpRpm` a little | |
| top speed low, top gear, below the limiter (drag limited) | `assists.drag`, more power (`maxTorque`, a higher `peakTorqueRpm`) | a top gear that puts the engine nearer its power peak at top speed |
| top speed low, top gear, at the limiter (gearing limited) | taller top gear or `finalDrive`, or a higher `maxRpm` | |
| top speed high, below the limiter (drag limited) | `assists.drag` up | less power |
| top speed high, at the limiter in the top gear (gearing limited) | shorter top gear or `finalDrive`, or a lower `maxRpm` | |
| braking long with ABS on | front `maxBrakeTorque` down toward 1.15-1.25x the front peak torque at this level's grip (see "Sanity math"); far above it the fronts lock and ABS cannot recover them | tire friction |
| braking long without ABS | tire `longitudinalSlideFriction` (locked wheels slide), brake balance: rear brake lower so the rears lock last | `abs: true` if the level allows it |
| lateral g low | `lateralPeakFriction` and `lateralSlideFriction` | lower `rollInfluence` does not add grip; downforce only helps at speed |
| understeer (front slides first, FWD) | stiffer rear bar, softer front bar | front `lateralPeakFriction`, front weight (z) |
| snap oversteer, spins in the step steer | softer rear bar or stiffer front, rear LSD lower | rear tire `lateralSlideFriction` closer to the peak, less steering at speed (`speedReference` down). More `counterSteer` costs turning in every corner (findings #31), and a rear only grip bias costs drifts (findings #33) |
| spins braking in a turn (`forgiving brakeTurn`, `trailBrake`) | rear `maxBrakeTorque` down toward the ideal split (about 25-30% of the braking on a 50/50 car), rear tire side grip up (`rear.tire`) | lower `rollInfluence`, less `speedReference`. With the steering limiter, keep `brakingPeakScale` at 1 (findings #30, #37) |
| keyboard driver ploughs wide in corners (`vehicle-wasd.mjs`: low clean pace, fails by plough) | `speedReference` up, `latSlide` toward `latPeak` | the limiter's `peakScale` (1.5); never fix it with anti-roll or springs, they do not move the balance (findings #38) |
| keyboard driver spins on corner exit or lift (fails by spin) | `tractionControl` on, rear tire side grip up | `rearGrip` in the realism row |
| arcade car ploughs when overdone, should slide | `rearGrip` just under 1 at that level | keep the keyboard moves under 25° in `--perturb` |
| full lock at speed turns too little (`turnsAtSpeed`) | `steering.speedReference` up | lower `counterSteer`: it takes lock away in every corner (findings #31) |
| too much body roll | anti-roll bars, then spring `frequency`, lower `centerOfMassOffset` y | `rollInfluence` (an assist: realism 50 and below) |
| too little body roll at 100% or 75% | softer bars, `rollInfluence` 0 | the FWD layer adds bar stiffness overall (×0.8 front, ×1.6 rear), so an FWD car rolls less than the archetype's RWD figure |
| flips in corners | lower center of mass, `rollInfluence` up, `maxTiltAngle` | never on a realistic car on flat ground: fix the geometry first |
| handbrake does nothing | `maxHandBrakeTorque` above the rear peak torque at 100% grip, `driftGripScale` < 1 | test with full steer, not a little. At the arcade levels the handbrake need not lock the rears: `driftGripScale` already cuts their side grip |
| handbrake rotates less on the arcade level | `counterSteer` too high: it catches the slide | keep `counterSteer` ≤ 0.6 with `driftGripScale` ≤ 0.4 |
| stays on its roof at an arcade level | `selfRighting` up (taller bodies need more: 4 at 50%) | |
| rights itself from the roof at 100% | `selfRighting` must be 0 | |
| bounces or floats | `compressionDamping`/`reboundDamping` toward 0.5/0.8, spring `frequency` up | |
| bottoms out on bumps | `maxLength - minLength` (travel), `frequency` up | |

## Sanity math before running

- **Axle load** ≈ mass × 9.81 × axle share ÷ 2 per wheel. The share comes from `centerOfMassOffset` z: 0.15 m on a 2.55 m wheelbase moves about 6%.
- **Tire peak torque** per wheel ≈ load × μ × radius, where μ is the longitudinal peak friction × the level's tire grip.
- **Brakes**: the risk is a front wheel locking at the brake step, before the weight has moved forward; with ABS on it then stays locked (findings #7). So size the front brake against the static front peak torque at the grip of the level you build: start at 1.15-1.25x for a single level car. Then measure. If braking is long, look at the front slip: if the fronts did not lock, a stronger brake shortens the stop (a soft, tall rally car stopped 2 m shorter at 1.7x); if they locked, go back down. The archetype brake values are the committed cars', which serve every level from 100% to arcade with one brake size, so they read high (about 1.6x) against 100% grip. Without ABS, a stronger brake just locks the wheels and braking is set by the sliding friction. Size the rear brake near the ideal split at full braking: rear share ≈ static rear share - (center of mass height ÷ wheelbase) × deceleration in g, about 25-30% of the braking on a 50/50 road car (the sports car runs 2600/900 N·m). More rear brake locks the inside rear when braking in a turn, and ABS does not catch it (findings #30); the realism row then scales the rear with the grip. A rear heavy mid engine car runs a larger rear share, but less than its static one: the supercar runs 2400/1500 (about 38%); 2200 (48%) spun it braking into a turn.
- **Handbrake**: about the rear peak torque at 100% grip or more, so it can lock the rears. Slightly under is fine: weight comes off the rear under braking, and below 100% realism `driftGripScale` cuts the rear side grip anyway.
- **Launch**: wheel force in first gear = `maxTorque` × gear × `finalDrive` ÷ radius. If this is several times the driven axle's grip (load × μ), the launch is traction limited and gearing will not help.
- **Speed at the limiter** in gear n = `maxRpm` ÷ (gear n × `finalDrive`) × 2π ÷ 60 × radius.
- **Top speed**: decide which limits it, then read the gear and rpm the metrics print next to the top speed. Drag limited (sports, super, hatch): the top gear's limiter speed sits above the target and v ≈ (0.58 × P ÷ `drag`)^(1/3), with P the engine power in watts at the rpm the top gear gives at that speed (P = torque at that rpm × rpm × 2π ÷ 60). Only about 58% of the engine power reaches the drag; rolling resistance (raised by downforce), wheel and engine damping and clutch slip take the rest. The engine runs about 300-400 rpm above the road speed rpm because of the clutch slip. Gearing limited (rally): with 400 N·m and drag 0.45 the drag limit is far above 215 km/h, so put the top gear's limiter speed in the target range instead.
- **AWD shares** (`torqueRatio`) must add up to 1.

## Writing back

When a tuning session teaches something new (a knob that did not do what the cheat sheet says, an engine quirk), add it to [reference/findings.md](reference/findings.md) with the measurement that showed it, and fix the cheat sheet if it was wrong.
