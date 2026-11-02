// Vehicle: preset showcase. 45 presets, three cars (sports car, rally car, supercar) at five
// realism levels from 100% realistic to arcade, each as FWD, RWD or AWD, with the car's own
// turbo or any other type. Pick one in the Preset folder or with the hotkeys and it replaces the
// car where it stands. The presets are layered in box3d.js/wheeled-vehicles: car, then drivetrain, then
// realism level, then turbo. Each car plays its own engine sound.

import { wheeledVehicleCars, wheeledVehiclePresets } from 'box3d.js/wheeled-vehicles';
import { runWheeledVehicleDemo } from './vehicle-demo';
import { showcaseStart, showcaseTurbo } from './vehicle-showcase';

const { preset, terrain, turbo } = showcaseStart();
const carName = wheeledVehiclePresets[preset].matrix?.car ?? 'sports';
const car = wheeledVehicleCars[carName];

await runWheeledVehicleDemo({
	preset,
	terrain,
	color: car.color,
	blurb: car.blurb,
	showcase: true,
	turbo: showcaseTurbo(turbo, carName),
});
