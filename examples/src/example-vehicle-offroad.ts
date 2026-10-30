// Vehicle: AWD off-roader. Off-road AWD on heightfield terrain: long travel, big tires, a ramp and rocks.
// The car, world, camera and settings panel come from vehicle-demo.ts; the tuning lives in
// box3d.js/vehicles and every value can be changed live in the Vehicle folder.

import { runVehicleDemo } from './vehicle-demo';

await runVehicleDemo({
	preset: 'offroad',
	terrain: 'offroad',
	color: 0xffd93d,
	blurb:
		'Long travel suspension and big tires. Climb the hill, take the ramp; R flips it back upright.',
});
