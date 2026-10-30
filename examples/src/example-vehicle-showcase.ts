// Vehicle: preset showcase. 45 presets, three cars (sports car, rally car, supercar) at five
// realism levels from 100% realistic to arcade, each as FWD, RWD or AWD, with the car's own
// turbo or any other type. Pick one in the Preset folder or with the hotkeys and it replaces the
// car where it stands. The presets are layered in vehicle-presets.js: car, then drivetrain, then
// realism level, then turbo. Each car plays its own engine sound.

import { runVehicleDemo } from './vehicle-demo';
import { vehicleCars, vehiclePresets } from './vehicle-presets';
import { showcaseStart, showcaseTurbo } from './vehicle-showcase';

const { preset, terrain, turbo } = showcaseStart();
const carName = vehiclePresets[preset].matrix?.car ?? 'sports';
const car = vehicleCars[carName];

await runVehicleDemo({
	preset,
	terrain,
	color: car.color,
	blurb: car.blurb,
	showcase: true,
	turbo: showcaseTurbo(turbo, carName),
});
