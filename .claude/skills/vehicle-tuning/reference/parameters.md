# b3VehicleDef parameters

Each field, its default from `b3DefaultVehicleDef()`, and what the engine actually does with it (from `vendor/box3d/src/vehicle.c` and `vehicle_wheel_joint.c`). Units are SI; angles are radians. Conventions: +z forward, +y up, left is +x; wheels 0-3 are front left, front right, rear left, rear right.

## chassis

| Field | Default | Notes |
| --- | --- | --- |
| `mass` | 1300 | Overrides the body's mass. The yaw, pitch and roll inertia are the chassis shapes' inertia scaled to this mass, so the collision box size (`halfExtents`) sets how lazily the car rotates. |
| `autoCenterOfMass` | true | Puts the center of mass at the average resting axle height, which is lower than a real car's (about 0.15 m lower). Keep it on and raise the car with `centerOfMassOffset` y for realism. It only moves the height: front to back, the center stays at the shapes' centroid, which for one box is the body origin (z = 0). |
| `centerOfMassOffset` | [0,0,0] | Added after the auto placement. y: height (a real road car ≈ +0.1 to +0.16 over auto). z: weight distribution, + forward. Moving z by 0.15 m on a 2.55 m wheelbase moves about 6% of the weight. Moving the center of mass does not change the inertia. |
| `maxSlopeAngle` | 80° | Wheels ignore steeper ground. |
| `castFilter` | default | Filter for the wheel casts. |

## wheels[i]

| Field | Default | Notes |
| --- | --- | --- |
| `position` | ±0.78, -0.05, ±1.3 | Suspension attachment in chassis space. Track and wheelbase come from here. |
| `radius`, `width` | 0.34, 0.22 | Width only matters for the cylinder cast and visuals. |
| `inertia` | 1.1 | Wheel and brake disc spin inertia. |
| `steerFactor` | 1 front, 0 rear | Negative for rear steering. |
| `maxBrakeTorque` | 2000 front, 1200 rear | See the ABS notes below. |
| `maxHandBrakeTorque` | 0 front, 3000 rear | Must exceed the rear tire's peak torque or the handbrake cannot lock the wheel. `driftGripScale` only applies to wheels with a handbrake. |
| `angularDamping` | 0.2 | Spin friction; costs a little top speed. |
| `castType` | cylinder | Cylinder (does not fall into cracks), sphere or ray. |
| `suspension.minLength`, `maxLength` | 0.2, 0.4 | Travel. Length is attachment to wheel center along the chassis down axis. |
| `suspension.frequency` | 1.8 front, 2.0 rear | Ride frequency in Hz against the wheel's sprung mass. The spring rate follows the mass, so changing `mass` keeps the ride. Road 1.8-2.2, sports 2.0-2.5, race 2.5-3, rally 1.4-1.7. |
| `suspension.compressionDamping`, `reboundDamping` | 0.5, 0.8 | Damping ratios. |
| `suspension.preload` | 0 | Raises the car without stiffening. |
| `suspension.enableBumpStop` | true | |
| `tire.longitudinalPeakSlip`, `longitudinalPeakFriction` | 0.1, 1.2 | Peak of the traction curve. |
| `tire.longitudinalSlideSlip`, `longitudinalSlideFriction` | 0.4, 0.96 | Fully sliding. Wheelspin and locked wheels sit here. |
| `tire.lateralPeakAngle`, `lateralPeakFriction` | 7°, 1.15 | Road 6-8°, gravel 10-12°. |
| `tire.lateralSlideAngle`, `lateralSlideFriction` | 20°, 0.92 | |
| `tire.rollingResistance` | 0.015 | Torque = coefficient × load × radius. Downforce raises the load, so it also raises rolling resistance. |
| `tire.longitudinalRelaxationLength` | 0.3 m | Distance the tire rolls for its slip ratio to build up. Near rest a small wheelspin no longer reads as a huge slip at once; at speed it settles within a step. Below 1 m/s it settles as if at 1 m/s. 0 is the old instant slip. |

Tire friction is multiplied by ground friction ÷ 0.6 (`B3_VEHICLE_REFERENCE_FRICTION`), so default shapes scale grip by 1. Longitudinal and lateral forces share a friction ellipse: a locked or spinning wheel has little side grip left.

## engine

| Field | Default | Notes |
| --- | --- | --- |
| `maxTorque`, `peakTorqueRpm` | 380, 4500 | The curve is linear from idle to the peak and from the peak to `maxRpm`. |
| `idleTorqueScale`, `maxRpmTorqueScale` | 0.6, 0.75 | Torque fraction at idle and at the limiter. |
| `idleRpm`, `maxRpm` | 900, 6800 | `maxRpm` is the limiter. |
| `inertia` | 0.3 | Engine and flywheel. Lower is quicker revving. With traction control on, spinning up this inertia in first gear eats into the torque the tire gets (see findings). |
| `angularDamping` | 0.08 | Engine braking. |

## turbo

Forced induction, all zero (naturally aspirated) by default. The torque curve is multiplied by 1 + boost. Each stage has a shaft spool and a delivered pressure, both 0 to 1 of its `gain`, updated once per step before the engine solve. The pressure is the spool capped by what the pedal asks for: it fills at once and dumps through the blow-off valve with a 0.1 s time constant when the pedal closes, while the shaft spins down with `bleedTime`.

The pedal is a torque request: `min(pedal × (1 + gains), 1 + boost)` times the curve, where `gains` is the sum of `stages[i].gain`. The first `1 / (1 + gains)` of the pedal needs no boost; past it the boost target rises to 1 at full pedal. Without a turbo this is the old `pedal × curve`. `src/vehicles.js` (`box3d.js/vehicles`) has nine ready types in `turboTypes`, plus `none`; `applyTurbo(def, type)` fits one and lowers `engine.maxTorque` so the fully boosted peak stays at the car's rated torque, and `vehicle-metrics.mjs --turbo <type>` measures a preset with it.

| Field | Default | Notes |
| --- | --- | --- |
| `stages[i].gain` | 0 | Torque added at full boost as a fraction of the curve. 0 turns the stage off. |
| `stages[i].spoolRpm`, `fullBoostRpm` | 0, 0 | The boost target eases in (smoothstep) between them, times the throttle. |
| `stages[i].spoolTime` | 0 | Lag: shaft time constant at full load, `fullBoostRpm` and half spool. The real constant is `spoolTime / clamp(load × rpm / fullBoostRpm × (0.5 + spool), 0.2, 3)`, so lag is long near the threshold or at part load, short high in the revs, and the spool up gathers pace as it builds. |
| `stages[i].bleedTime` | 0 | Shaft spin-down time constant off throttle. Shifts cut the throttle: the boost dumps, but with 0.8-1.8 s here most of the spool survives a 0.1 s shift and the boost returns as the clutch engages. Short values (under 0.3 s) make the car respool after every shift. |
| `instantFraction` | 0 | Share of the spool that skips the lag: 1 is a supercharger, between 0 and 1 an electric-assisted turbo. |
| `parasiticTorque` | 0 | Subtracted at full boost, scaled by boost ÷ total gain. For superchargers. |
| `antiLag` | false | The shaft and the pressure ignore the pedal (still follow the rpm), so boost holds off throttle and through shifts, at full strength. |

Traction control and the clutch launch floor both see the boosted torque. With the rated torque kept the same, a turbo never makes a car quicker: below the spool rpm it has less torque than the NA engine. A big laggy turbo (`big`) fails the sports and rally 100% realistic 0-100 targets for that reason (6.2 s and 5.2 s); every other type passes on `sports-100-rwd`, `rally-100-awd`, `super-100-rwd` and `sports-50-fwd`.

## transmission

| Field | Default | Notes |
| --- | --- | --- |
| `mode` | auto | `b3_vehicleTransmissionAuto` or `b3_vehicleTransmissionManual`. In manual mode `b3Vehicle_SetGear` selects the gear. |
| `gearRatios[0..7]`, `gearCount` | 6 gears 3.3…0.78 | |
| `reverseRatio`, `finalDrive` | 3.2, 3.9 | |
| `shiftUpRpm`, `shiftDownRpm` | 6000, 2600 | The automatic shifts on the lower of engine rpm and road rpm (wheel speed through the gearing). At full load the clutch slips a few hundred rpm, so road rpm never reaches the limiter: set `shiftUpRpm` about 0.9 × `maxRpm` minus that slip (about 270 rpm on a 400 N·m car, 490 on a 720 N·m one) so the engine shifts at 90% of the limiter, the racing game convention the metrics check. How close to the limiter a setting still fires depends on the load and the clutch slip: at 8200 of 8500 rpm the supercar sat on the limiter, while the sports car at 6900 of 7200 shifted at 99% (findings #6, #24). Upshifts are also blocked while a driven wheel spins past twice its peak slip or is in the air. A downshift only happens if the lower gear lands under 90% of `shiftUpRpm`. |
| `shiftTime`, `clutchReleaseTime`, `shiftLatency` | 0.15, 0.2, 0.5 | Throttle is cut during `shiftTime`. |
| `clutchStrength` | 10 | Coupling, N·m·s/rad. |

## drivetrain

| Field | Notes |
| --- | --- |
| `differentials[i]` | `{ leftWheel, rightWheel, torqueRatio, leftRightSplit, limitedSlipRatio }`. `torqueRatio` is the share of engine torque for this axle; shares should add to 1. `limitedSlipRatio` is the largest wheel speed ratio before torque moves to the slower wheel: 1 or less is open, 1.3-1.6 is a typical LSD. |
| `differentialCount` | Up to 4. |
| `centerLimitedSlipRatio` | Same idea between axles (AWD), against the slowest axle. |

## antiRoll

`bars[i] = { leftWheel, rightWheel, stiffness }` in N/m on the compression difference. A stiffer bar at one end moves the grip balance away from that end: stiffer rear = more oversteer. For a 1400 kg car on 2 Hz springs, bars around 16000/13000 give about 1.7° of roll per g; 30000/26000 on 2.5-2.7 Hz gives a supercar's 1°/g.

## steering

| Field | Default | Notes |
| --- | --- | --- |
| `maxAngle` | 35° | At rest. |
| `speedReference` | 10 | The limit is `maxAngle / (1 + (speed / speedReference)²)`. At 70 km/h and 11 m/s this is a quarter of the lock, which is less than the tires need at the limit, so a lateral grip test must turn it off. 0 disables. |
| `steerSpeed`, `returnSpeed` | 4, 6 | rad/s. |
| `ackermann` | 0.7 | |

## assists

| Field | Default | Notes |
| --- | --- | --- |
| `counterSteer` | 0.2 | Adds this fraction of the rear slide angle to the steering target, clamped to `maxAngle` (not the speed reduced angle). It has no dead band, so it also takes lock away in every normal corner, where the rears run at 3-5° of slip angle: at 0.6 the arcade cars used half their grip at full lock and 120 km/h. Above about 0.6 it catches handbrake slides and the car rotates less. |
| `driftGripScale` | 1 | Lateral grip multiplier on wheels with a handbrake, at full handbrake. |
| `tractionControl` | true | Caps the engine so no driven wheel gets more than its peak torque. Behind the center of mass it also leaves room for the cornering force (never less than 30%). It is conservative on a launch: see findings. |
| `launchControl` | true | From a standstill, a slip controller on the driven wheels: each wheel's torque cap follows its slip toward 0.9 of the peak slip (at most 1.1x the tire's peak torque at the wheel, 2x at the engine). Works with `tractionControl` off. Ends when the driver lifts or the engine has not been held back for 0.3 s; the gearbox's shift cut does not end it. `b3VehicleState.isLaunching` reads it. |
| `abs` | false | Caps the service brake at the tire's peak torque, times the room the cornering force leaves on the friction ellipse (from the slip angle against the lateral peak angle, never below 30%), so braking in a turn keeps the wheels rolling. A wheel past its peak slip is released to half its sliding torque until it grips again. Engine braking on a driven wheel shares the cap, as engine drag torque control does. Before this, ABS used the straight line peak and could not release a locked wheel, so braking at full lock locked the fronts (findings #7, #30, #34). |
| `downforce` | 1.5 | Force = downforce × forward speed², applied at the center of mass (no aero balance). Real cars: 0.1-0.3 road, 0.5-1 supercar. |
| `drag` | 0.6 | Force = drag × speed². Real cars: ½ρ·Cd·A ≈ 0.35-0.45. |
| `rollInfluence` | 0.25 | Raises the point where lateral tire forces act toward the center of mass height. 0 is physical, 1 removes cornering roll. It does not add grip, and it takes load off the outside wheels, which under braking in a turn lets the outside rear lock and spins the car (0.35 and up on the sports car, findings #30). |
| `airControl`, `airAngularDamping` | 1, 2 | Rotation from input and damping while all wheels are in the air. |
| `selfRighting` | 3 | Roll-only righting while partly grounded and rolled past 0.3 rad, or 3x as strong once stuck (on the side or roof and slow for 0.5 s). 0 disables. |
| `maxTiltAngle` | 0 | Stops angular velocity that tilts the car past this angle. 0 disables. |
| `stickyTire`, `stickySpeed`, `stickyTime` | true, 0.25, 0 | Holds the car still at very low speed with no throttle; needed to park on slopes. |
