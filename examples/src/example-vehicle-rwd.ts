// Vehicle: RWD sports car. Rear wheel drive: limited slip, 420 N·m, no traction control, handbrake drifts.
// The car, world, camera and settings panel come from vehicle-demo.ts; the tuning lives in
// vehicle-presets.js and every value can be changed live in the Vehicle folder.

import { runVehicleDemo } from './vehicle-demo';

await runVehicleDemo({
	preset: 'rwd',
	terrain: 'track',
	color: 0xff6b6b,
	blurb:
		'Rear wheel drive, traction control off. Pull the handbrake into a corner and catch the slide with throttle.',
});
