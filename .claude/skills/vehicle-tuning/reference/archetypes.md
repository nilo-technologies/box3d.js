# Archetypes

Starting ranges for the car layer at 100% realism, and the targets the metrics script checks (`archetypes` in `examples/scripts/vehicle-metrics.mjs`). Pick values inside the ranges that fit the brief, then measure. Targets are from published figures for real cars of each class; 0-100 figures are launch control runs, so the script gives two wheel drive cars 0.6 s of slack.

## Targets (100% realism)

| | sports | rally | super | hatch |
| --- | --- | --- | --- | --- |
| real cars | Cayman GTS, M2 | Rally2 on gravel tires, on tarmac | 720S, Huracan | Golf GTI, Civic Type R |
| 0-100 FWD (s) | 5.0-6.8 | 5.0-7.0 | 5.0-8.0 | 5.6-7.2 |
| 0-100 RWD (s) | 4.2-5.4 | 4.3-6.0 | 2.9-4.0 | 5.4-7.0 |
| 0-100 AWD (s) | 3.8-5.0 | 3.8-5.2 | 2.7-3.5 | 4.8-6.2 |
| top speed (km/h) | 245-290 | 180-215 | 300-350 | 235-275 |
| 100-0 braking (m) | 32-40 | 36-46 | 28-35 | 33-40 |
| lateral g | 0.95-1.15 | 0.85-1.05 | 1.1-1.4 | 0.9-1.08 |
| step steer roll (°) | 1.4-4 | 1.8-6 | 0.7-3 | 1.4-5 |

## Car layer ranges

| | sports | rally | super | hatch |
| --- | --- | --- | --- | --- |
| mass (kg) | 1300-1500 | 1200-1300 | 1450-1650 | 1300-1450 |
| `halfExtents` | ≈ [0.72, 0.28, 2.15] | ≈ [0.74, 0.34, 2.0] | ≈ [0.84, 0.24, 2.3] | ≈ [0.7, 0.32, 2.0] |
| center of mass y over auto | +0.10 to +0.14 | +0.14 to +0.18 | +0.04 to +0.08 | +0.12 to +0.16 |
| center of mass z | 0 to +0.08 | +0.05 to +0.1 | -0.2 to -0.3 (mid engine) | +0.15 to +0.3 (front heavy) |
| half track, wheelbase (m) | 0.8, 2.55 | 0.8, 2.5 | 0.86, 2.7 | 0.77, 2.6 |
| wheel radius (m) | 0.33 | 0.32-0.33 | 0.35 | 0.32 |
| spring frequency F/R (Hz) | 2.0 / 2.2 | 1.5 / 1.6 | 2.5 / 2.7 | 1.9 / 2.1 |
| travel min/max (m) | 0.17 / 0.33 | 0.12 / 0.45 | 0.18 / 0.30 | 0.17 / 0.34 |
| tire peak slip, lateral peak angle | 0.1, 7° | 0.18, 11° | 0.09, 6.5° | 0.1, 7° |
| tire μ (lat peak / lat slide) | 1.10 / 0.94 | 1.00 / 0.90 | 1.25 / 1.00 | 1.02 / 0.90 |
| longitudinal peak / slide | 1.15 / 0.95 | 1.05 / 0.92 | 1.30 / 1.00 | 1.08 / 0.92 |
| torque (N·m) at rpm | 400-480 at 5000 | 380-420 at 4000 | 650-770 at 6000 | 350-420 at 2000-4500 |
| max rpm | 7000-7500 | 7500 | 8500 | 6500-7000 |
| gears | 6 | 6 close ratio, short final (4.4) | 7 | 6 |
| engine inertia | 0.2 | 0.12 | 0.15 | 0.15-0.2 |
| anti-roll F/R (N/m) | 16000 / 13000 | 16000 / 12000 | 30000 / 26000 | 20000 / 14000 |
| brakes F/R (N·m) | 2600 / 1500 | 2300 / 1500 | 2400 / 2200 | 2400 / 1200 |
| handbrake (N·m) | 2500 | 4000 (hydraulic) | 2000 | 2500 |
| steering lock, speedReference | 34°, 11 | 38°, 12 | 32°, 13 | 35°, 11 |
| downforce, drag | 0.25, 0.4 | 0.15, 0.45 | 0.6, 0.38 | 0.15, 0.38 |
| own TC / ABS | off / on | off / off | on / on | on / on |
| LSDs F/R/center, AWD front share | 1.15 / 1.5 / 1.3, 0.4 | 1.3 / 1.6 / 1.4, 0.5 | 1.1 / 1.4 / 1.25, 0.3 | 1.25 / 1.4 / 1.3, 0.4-0.5 |

## Character notes

- **Sports**: balanced, progressive. Roll you can see (about 2°/g). Without TC at 100% it spins the rears on a flat out launch and can spin in a full lock step steer at 120 km/h: that is the realistic result.
- **Rally**: soft and tall, long travel, gravel tires (late, broad peak, low slide drop), hydraulic handbrake, short gearing. On tarmac it brakes long (no ABS, gravel tires) and rolls the most. Its taller body needs more `selfRighting` at the arcade levels.
- **Super**: stiff, low, sticky, mid engine (rear heavy), real downforce. Gear the top gear so drag, not the limiter, sets the top speed, and keep `shiftUpRpm` well under the limiter. Size the front brake near the front tires' peak torque (about 1.15x) or ABS braking can lock the fronts.
- **Hatch**: front heavy (60/40 as FWD), softer than a sports car, torque low in the rev range (turbo), modest tires. FWD understeers: balance it with a stiff rear bar.
