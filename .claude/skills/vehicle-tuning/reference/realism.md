# Realism levels

One table, shared by every car. Apply the row for the brief's level after the car and drivetrain layers. Do not tune these per car: when a car fails a realism check, fix the car layer. The exception is a failure the findings trace to the engine, such as the ABS lockup in [findings.md](findings.md) #7 and #20: no car or realism setting fixes it, so leave the preset alone and report it.

| Field | 100 | 75 | 50 | 25 | 0 (arcade) | How to apply |
| --- | --- | --- | --- | --- | --- | --- |
| tire grip | 1.0 | 1.1 | 1.2 | 1.32 | 1.45 | multiply all four friction values (`longitudinalPeakFriction`, `longitudinalSlideFriction`, `lateralPeakFriction`, `lateralSlideFriction`) on every wheel |
| `rollInfluence` | 0 | 0.15 | 0.35 | 0.55 | 0.75 | set |
| `counterSteer` | 0 | 0.15 | 0.3 | 0.5 | 0.6 | set |
| `driftGripScale` | 1 | 0.85 | 0.7 | 0.55 | 0.4 | set |
| downforce | ×1 | ×1.5 | ×2.5 | ×4 | ×6 | multiply the car's `downforce` |
| center of mass drop | 0 | 0.05 | 0.1 | 0.17 | 0.25 | subtract from `centerOfMassOffset` y (m) |
| `selfRighting` | 0 | 1 | 4 | 6 | 10 | set |
| `airControl` | 0 | 0.5 | 1.5 | 2.5 | 3.5 | set |
| `airAngularDamping` | 0 | 0.5 | 1.5 | 2.5 | 3.5 | set |
| `maxTiltAngle` | off | off | off | 70° | 55° | set (radians; 0 is off) |
| `tractionControl` | car's own | car's own | on | on | on | |
| `abs` | car's own | car's own | on | on | on | |

"Car's own" means the real car's setting: modern road and supercars have ABS (and supercars TC); a rally car has neither.

## What each level must do (the metrics check these)

| | 100 | 75 | 50 | 25 | 0 |
| --- | --- | --- | --- | --- | --- |
| step steer roll, × the archetype range | 1.0 to 1.0 | 0.6 to 0.85 | up to 0.65 | up to 0.45 | up to 0.3 |
| may spin in the 120 km/h step steer | yes | yes | no | no | no |
| back on its wheels from side and roof | must stay on the roof | either | must | must | must |
| braking, lateral g | archetype | ÷ and × 1.1 | 1.2 | 1.32 | 1.45 |

## How the targets scale

The metrics script turns an archetype range [lo, hi] (from archetypes.md) into the range for a level with `grip` from the table above and `arcade` = 1 - realism ÷ 100 (0 at 100%, 1 at arcade):

| Metric | Range |
| --- | --- |
| 0-100 | lo × (1 - 0.2 × arcade) to hi |
| top speed | lo × (1 - 0.05 × arcade) to hi (downforce adds rolling resistance) |
| braking | lo ÷ grip ÷ 1.05 to hi ÷ grip |
| lateral g | lo × grip to hi × grip × 1.08 |
| step steer roll | archetype roll range × the level's roll factors in the table above: 100% is [lo, hi], 75% is [0.6 lo, 0.85 hi], 50% is [0, 0.65 hi] and so on. Below 75% there is no lower bound. |
| handbrake | heading change 45-360°, peak yaw rate 60-400°/s |
| ride height | chassis 0.3-1.2 m above the ground after settling |
| launch line | under 2 m off the line by 100 km/h |

Example, hatch at 75% FWD: 0-100 5.32-7.20 s, top speed 232-275 km/h, braking 28.6-36.4 m, lateral g 0.99-1.28, roll 0.84-4.25°.

Across a car's levels, lateral g must not fall, braking must not get longer, roll must not grow and handbrake rotation must not slow as realism drops.

## Why these values

- **Grip 1.45 at arcade**: enough that a keyboard player at full lock cannot overwhelm the tires, without lateral g so high that the car feels glued (1.6-1.9 g measured).
- **counterSteer 0.6, driftGripScale 0.4 at arcade**: with counterSteer 0.7 and driftGripScale 0.45 the arcade cars rotated less under the handbrake than the 25% cars (141 vs 157°/s), because the counter steer caught the slide. 0.6/0.4 restores the ordering (170°/s).
- **selfRighting 4 at 50%**: 3 was enough for the low sports car but not the taller rally body on its roof. Taller or narrower bodies need more.
- **TC and ABS from 50% down**: below that the player should not have to manage wheelspin or lockups.
