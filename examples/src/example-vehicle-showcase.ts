// Vehicle: preset showcase. 45 presets, three cars (sports car, rally car, supercar) at five
// realism levels from 100% realistic to arcade, each as FWD, RWD or AWD. Pick one in the Preset
// folder or with the hotkeys and it replaces the car where it stands. The presets are layered
// in vehicle-presets.js: car, then drivetrain, then realism level.

import { runVehicleDemo } from './vehicle-demo';
import { vehicleCars, vehiclePresets } from './vehicle-presets';
import { showcaseStart } from './vehicle-showcase';

const { preset, terrain } = showcaseStart();
const car = vehicleCars[vehiclePresets[preset].matrix?.car ?? 'sports'];

await runVehicleDemo({
	preset,
	terrain,
	color: car.color,
	blurb: car.blurb,
	showcase: true,
});
