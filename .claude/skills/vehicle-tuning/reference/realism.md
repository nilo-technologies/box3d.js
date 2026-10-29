# Realism levels

One table, shared by every car. Apply the row for the brief's level after the car and drivetrain layers. Do not tune these per car: when a car fails a realism check, fix the car layer. (The single exception so far is noted below.)

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

Across a car's levels, lateral g must not fall, braking must not get longer, roll must not grow and handbrake rotation must not slow as realism drops.

## Why these values

- **Grip 1.45 at arcade**: enough that a keyboard player at full lock cannot overwhelm the tires, without lateral g so high that the car feels glued (1.6-1.9 g measured).
- **counterSteer 0.6, driftGripScale 0.4 at arcade**: with counterSteer 0.7 and driftGripScale 0.45 the arcade cars rotated less under the handbrake than the 25% cars (141 vs 157°/s), because the counter steer caught the slide. 0.6/0.4 restores the ordering (170°/s).
- **selfRighting 4 at 50%**: 3 was enough for the low sports car but not the taller rally body on its roof. Taller or narrower bodies need more.
- **TC and ABS from 50% down**: below that the player should not have to manage wheelspin or lockups.
