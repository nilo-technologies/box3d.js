# Realism levels

One table, shared by every car. Apply the row for the brief's level after the car and drivetrain layers. Do not tune these per car: when a car fails a realism check, fix the car layer. The exception is a failure the findings trace to the engine, such as the ABS lockup in [findings.md](findings.md) #7 and #20: no car or realism setting fixes it, so leave the preset alone and report it.

| Field | 100 | 75 | 50 | 25 | 0 (arcade) | How to apply |
| --- | --- | --- | --- | --- | --- | --- |
| tire grip | 1.0 | 1.15 | 1.3 | 1.45 | 1.6 | multiply all four friction values (`longitudinalPeakFriction`, `longitudinalSlideFriction`, `lateralPeakFriction`, `lateralSlideFriction`) on every wheel, and the rear wheels' `maxBrakeTorque` |
| steering falloff | ×1 | ×1 | ×1 | ×1.15 | ×1.15 | multiply `steering.speedReference` |
| `rollInfluence` | 0 | 0.1 | 0.15 | 0.2 | 0.25 | set |
| `counterSteer` | 0 | 0.15 | 0.2 | 0.2 | 0.2 | set |
| `driftGripScale` | 1 | 0.85 | 0.7 | 0.55 | 0.4 | set |
| downforce | ×1 | ×1.5 | ×2.5 | ×4 | ×6 | multiply the car's `downforce` |
| center of mass drop | 0 | 0.05 | 0.1 | 0.17 | 0.25 | subtract from `centerOfMassOffset` y (m) |
| `selfRighting` | 0 | 1 | 4 | 8 | 10 | set |
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
| braking, lateral g | archetype | ÷ and × 1.15 | 1.3 | 1.45 | 1.6 |
| keyboard moves (brake and turn, trail brake, lift off, slalom, flick) stay under 25° of sideslip | no | no | must | must | must |
| full lock at 120 km/h reaches this share of the level's lateral g floor | no target | 0.75 | 0.8 | 0.85 | 0.9 |

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
| keyboard moves | peak sideslip under 25° (`forgivingSlip`) at 50% and below |
| turning at speed (`stepTurnG`) | at least lateral g lo × grip × the level's share above, averaged over 0.5-2.5 s of the step steer |
| ride height | chassis 0.3-1.2 m above the ground after settling |
| launch line | under 2 m off the line by 100 km/h |

Example, hatch at 75% FWD: 0-100 5.32-7.20 s, top speed 232-275 km/h, braking 27.3-34.8 m, lateral g 1.04-1.34, roll 0.84-4.25°.

Across a car's levels, lateral g must not fall, braking must not get longer, roll must not grow and handbrake rotation must not slow as realism drops.

## Why these values

- **Forgiving steering from 75% down**: a keyboard player only has full lock, full brake and full throttle, so the levels must survive those. Every level below 100% has more grip on all four tires, which keeps the car's balance and so its handbrake drifts (a rear only grip bias stabilised the car too, but cut handbrake rotation by up to 20%, findings #33). From 25% down the steering falloff row gives more lock at speed, so full lock uses the extra grip (the arcade sports car turns at 1.84-1.94 g at 120 km/h); at 50% the same extra lock let the RWD car spin going lock to lock. `counterSteer` stays at 0.2: it acts in every corner, not only in slides, and at 0.6 the arcade car turned at 0.8 g at full lock and 120 km/h (findings #31). `rollInfluence` stays low because it takes load off the outside rear wheel, which then locks when braking in a turn (findings #30).
- **Rear brakes scale with the grip** so the brake balance stays the same share of the rear grip at every level. Front brakes are capped by ABS (or lock without it), so they stay as the car layer sets them.
- **selfRighting 8 at 25%**: with less `rollInfluence` the 25% sports car rolled more, and one perturbed variant tipped over slowly onto two wheels after landing a jump on the rough ground; 6 did not catch it.
- **Grip 1.6 at arcade** (was 1.45): with more steering at speed, 1.55 still let the arcade RWD sports car spin in the flick (51°); 1.6 holds it under 12° in every perturbed variant. Lateral g is 1.78 g on the sports car.
- **driftGripScale 0.4 at arcade**: with counterSteer 0.7 and driftGripScale 0.45 the arcade cars rotated less under the handbrake than the 25% cars (141 vs 157°/s), because the counter steer caught the slide. 0.6/0.4 restored the ordering (170°/s); counterSteer is now 0.2 and the ordering holds with room to spare.
- **selfRighting 4 at 50%**: 3 was enough for the low sports car but not the taller rally body on its roof. Taller or narrower bodies need more.
- **TC and ABS from 50% down**: below that the player should not have to manage wheelspin or lockups.
