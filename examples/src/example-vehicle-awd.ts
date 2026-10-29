// Vehicle: AWD road car. All wheel drive: 40/60 split with a center limited slip, traction control and ABS.
// The car, world, camera and settings panel come from vehicle-demo.ts; the tuning lives in
// vehicle-presets.js and every value can be changed live in the Vehicle folder.

import { runVehicleDemo } from './vehicle-demo';

await runVehicleDemo({
	preset: 'awd',
	terrain: 'track',
	color: 0x6bcb77,
	blurb:
		'All wheel drive with a 40/60 split, traction control and ABS. Fast and planted through the slalom.',
});
