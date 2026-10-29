# Findings

What tuning the 45 car matrix taught, with the measurement that showed it. Newest at the bottom. Add to this file when you learn something new.

## Testing

1. **The lateral grip test must turn off the speed sensitive steering.** With `speedReference` 11 m/s the steering at 70 km/h is capped at about 8°, and the front tires need about 7° of slip at the peak, so lateral g measured the steering, not the tires: the arcade sports car read 1.17 g, less than the 50% car (1.32 g). With `speedReference` 0 during the test it reads 1.61 g and the realism ordering holds.
2. **The chassis is one box with no cabin.** A car dropped on its side tips back onto its wheels without any self righting, because the box is only 0.5-0.7 m tall. Test self righting from the roof instead.
3. **A dead level roof leaves the righting direction undecided.** At exactly 180° the roll angle flips between +π and -π every step and the torques cancel, so even `selfRighting` 10 stayed on its roof. Tilt the roof test by about 6°, as a real landing would be.
4. **Handbrake tests need full steer.** At 0.4 steer and 60 km/h every level rotated at about 33°/s, which is just cornering. At full steer the realistic sports car peaks at 78°/s and the arcade one at 170°/s.
5. **Lift before braking.** Lifting the throttle at 6000 rpm sends a -1000 N·m engine braking pulse into the driven wheels. Landing it in the same frames as full brake pushed the front wheels of a FWD supercar past their peak slip, and ABS never recovered them (37.4 m instead of 34.3 m). The metrics lift for 0.25 s first, like a driver.

## Engine behavior to design around

6. **The automatic gearbox shifts on road rpm, which trails the engine.** The shift uses the lower of engine rpm and wheel speed through the gearing. At full load the clutch slips about 300 rpm, so with `shiftUpRpm` 8200 and `maxRpm` 8500 the supercar sat on the limiter in 5th at 277 km/h. At 7900 it shifts and reaches 338 km/h. Keep `shiftUpRpm` at least 5% under `maxRpm`.
7. **ABS cannot release a locked wheel.** ABS caps the brake at the tire's peak torque, but a locked wheel needs only the lower sliding torque to stay locked, so a wheel that overshoots its peak slip (a full brake step before the weight has moved forward, or an engine braking pulse) stays locked. A front brake far above the front tires' peak makes this likely: the arcade AWD supercar braked in 24.3 m with 3200 N·m fronts and 22.2 m with 2400 N·m. Size front brakes near 1.15x the front peak torque on cars with ABS. (This is an engine limitation worth fixing in box3d: ABS should release when the slip passes the peak.)
8. **Traction control is conservative on a launch.** It caps the engine at the driven tires' peak torque, but part of that torque spins up the engine's own inertia and some goes to engine friction, so in first gear the tire ran at about 60% of its peak with no slip at all. The 50% rally car with TC took 6.47 s to 100 km/h while the 75% one without it (and with less grip) took 5.27 s. Lower engine inertia helps a little (0.15 to 0.1: 6.50 to 6.25 s). Expect two wheel drive cars with TC to launch slower than the tires allow.
9. **Full throttle without TC spins the driven tires to about 50 km/h** on a 420 N·m RWD car (slip ratio 7 at launch), so the tire works at its sliding friction. That is the realistic result for a flat out launch without launch control.
10. **The yaw inertia comes from the collision box.** `mass` rescales the shapes' inertia, so a longer or wider `halfExtents` makes the car rotate more lazily. Moving the center of mass does not change the inertia.
11. **Downforce acts at the center of mass** with forward speed squared: it adds grip at both ends equally and cannot balance the car. It also adds rolling resistance (the top speed fell 2-3% at the arcade levels).

## Tuning

12. **Body roll**: 22000/18000 N/m bars on a 1400 kg car with 2.0/2.2 Hz springs gave 1.3° in a 0.9 g step steer (too stiff for a road car); 16000/13000 gave 1.7°.
13. **FWD needs weight on the front.** Moving the center of mass 0.15 m forward took the FWD sports car from 7.05 s to 6.32 s and the realistic FWD roll into range.
14. **counterSteer fights the handbrake.** Above about 0.6 it catches the slide faster than `driftGripScale` lets the rear go: arcade rotated less than 25% until counterSteer went 0.7 to 0.6 and driftGripScale 0.45 to 0.4.
15. **A taller body needs more self righting.** `selfRighting` 3 rights the sports car (box half height 0.28 m) from its roof but not the rally car (0.34 m); 4 does both.
16. **Robustness check**: after tuning, ±3% mass and ±2% grip on all 45 presets flipped no checks. Run a similar check after big changes, because ABS lockups and spins are threshold effects and a preset that only just passes can flip.
17. **Only about 58% of the engine power reaches the drag at top speed.** Sports car: 236 kW at 6301 rpm in 6th against 139 kW of drag at 253 km/h. Supercar: 476 kW against 274 kW at 323 km/h. Rolling resistance (raised by downforce), wheel and engine damping and clutch slip take the rest. The plain (P ÷ drag)^(1/3) estimate overshot by 15-20% in the blind tests.
18. **Blind test, first round** (three agents with only this skill): a 50% AWD rally car and an arcade RWD supercar passed every check on the first run. A 75% FWD hot hatch failed braking on the first run (36.5 m against 36.4 m, with 2400 N·m front brakes, about 1.55x the front peak) and then sat on the top speed floor; it took six runs. That led to the brake sizing rule against the level's grip, the 0.58 power factor, the gear and rpm in the top speed output, `--perturb`, and gear ratios for every archetype.
