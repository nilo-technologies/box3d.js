# Drivetrain layers

Apply after the car layer and before the realism row. Each car carries four numbers for these layers: `frontLsd`, `rearLsd`, `centerLsd` and `awdFront` (the AWD front torque share).

## FWD

- One differential: wheels 0 and 1, `torqueRatio` 1, `limitedSlipRatio` = `frontLsd` (open 1.0 for an economy car, 1.15-1.3 for a hot hatch or a sporty car).
- Move the center of mass forward 0.15 m (`centerOfMassOffset` z += 0.15). A transverse engine sits over the front axle, and it puts weight on the driven wheels. Without it a 420 N·m FWD sports car took 7.05 s to 100 km/h; with it, 6.32 s.
- Anti-roll: front × 0.8, rear × 1.6. The stiffer rear bar lets the rear rotate and offsets the front-drive understeer.
- A front engine car is naturally 60/40 front heavy as FWD. A mid engine car converted to FWD keeps only about 40% on the front even after the shift, so its launch is traction limited (5-8 s to 100 km/h for a 720 N·m car): that is physics, not a tuning fault.

## RWD

- One differential: wheels 2 and 3, `torqueRatio` 1, `limitedSlipRatio` = `rearLsd` (1.4 supercar with TC, 1.5 sports, 1.6 rally).
- Bars as the car layer has them.

## AWD

- Two differentials: wheels 0/1 with `torqueRatio` = `awdFront` and `limitedSlipRatio` = `frontLsd`; wheels 2/3 with `1 - awdFront` and `rearLsd`.
- `centerLimitedSlipRatio` = `centerLsd` (1.25-1.4).
- Anti-roll: front × 0.9, rear × 1.1.
- Front shares by archetype: sports 0.4 (40/60), rally 0.5 (50/50), supercar 0.3 (30/70), hatch 0.4-0.5.
- AWD launches are engine limited, not traction limited, so 0-100 barely changes with realism (4.33 s at every level for the sports car).

## Torque shares and wheel order

Wheels: 0 front left, 1 front right, 2 rear left, 3 rear right. Shares must add to 1; the smoke test checks the matrix. Leave unused differential slots as `{ leftWheel: -1, rightWheel: -1, torqueRatio: 0, leftRightSplit: 0.5, limitedSlipRatio: 1 }` and set `differentialCount`.
