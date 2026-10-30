// Vehicle: FWD hatchback. Front wheel drive: open front diff, front brake bias, mild understeer.
// The car, world, camera and settings panel come from vehicle-demo.ts; the tuning lives in
// box3d.js/vehicles and every value can be changed live in the Vehicle folder.

import { runVehicleDemo } from './vehicle-demo';

await runVehicleDemo({
	preset: 'fwd',
	terrain: 'track',
	color: 0x4d96ff,
	blurb:
		'Front wheel drive. Lift off mid corner to tuck the nose in; it pushes wide if you power through.',
});
