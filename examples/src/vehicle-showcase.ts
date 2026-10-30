// Preset picker for the vehicle showcase: car, realism and drivetrain dropdowns that swap the
// car in place, hotkeys for the same, a terrain switch, and a button that copies the live
// settings as JSON (including anything changed in the Vehicle folder).

import type { Box3DModule, b3VehicleId } from 'box3d.js';
import type GUI from 'lil-gui';
import type { VehicleTerrain } from './vehicle-demo';
import {
	drivetrainLayers,
	realismLevels,
	type VehicleCarName,
	type VehicleDrive,
	type VehiclePresetName,
	type VehicleRealism,
	vehicleCars,
	vehiclePresetName,
	vehiclePresets,
} from './vehicle-presets';

export type ShowcaseHost = {
	gui: GUI;
	b3: Box3DModule;
	terrain: VehicleTerrain;
	/** The car being driven */
	current(): { name: VehiclePresetName; vehicle: b3VehicleId };
	/** Replace the car with another preset where it stands */
	swap(name: VehiclePresetName, color: number): void;
	setInfo(title: string, blurb: string, extra?: string): void;
	/** Key code to handler, for keys the demo does not use itself */
	onPress: Map<string, () => void>;
};

const realismOrder: VehicleRealism[] = [100, 75, 50, 25, 0];

const terrains: VehicleTerrain[] = ['track', 'offroad', 'circuit', 'stage'];

/** Reads the start preset and terrain from the URL, e.g. ?preset=rally-50-awd&terrain=stage */
export function showcaseStart(): {
	preset: VehiclePresetName;
	terrain: VehicleTerrain;
} {
	const params = new URLSearchParams(location.search);
	const preset = params.get('preset') as VehiclePresetName | null;
	return {
		preset: preset && vehiclePresets[preset]?.matrix ? preset : 'sports-50-rwd',
		terrain: terrains.find((t) => t === params.get('terrain')) ?? 'track',
	};
}

function describeRealism(realism: VehicleRealism): string {
	const level = realismLevels[realism];
	const aids = [
		level.tractionControl ? 'TC' : '',
		level.abs ? 'ABS' : '',
	].filter(Boolean);
	const parts = [
		`grip ×${level.tireGrip.toFixed(2)}`,
		aids.length ? `${aids.join(' and ')} on` : "the car's own TC and ABS",
	];
	if (level.rollInfluence > 0)
		parts.push(`roll influence ${level.rollInfluence}`);
	if (level.counterSteer > 0) parts.push(`counter steer ${level.counterSteer}`);
	if (level.driftAssist > 0) parts.push(`drift assist ${level.driftAssist}`);
	if (level.selfRighting > 0) parts.push(`self righting ${level.selfRighting}`);
	if (level.maxTiltAngle > 0) parts.push(`tilt limit ${level.maxTiltAngle}°`);
	return parts.join(', ');
}

/** Every live setting of a vehicle as plain JSON, enums by name and 64 bit ids as strings */
export function vehicleSettingsJson(
	b3: Box3DModule,
	vehicle: b3VehicleId,
	name: string,
): string {
	const wheels = [];
	for (let i = 0; i < b3.b3Vehicle_GetWheelCount(vehicle); i++) {
		wheels.push(b3.b3Vehicle_GetWheel(vehicle, i));
	}
	const enums: Record<string, Record<string, { value: number }>> = {
		mode: b3.b3VehicleTransmissionMode,
		castType: b3.b3VehicleCastType,
	};
	const settings = {
		preset: name,
		note: 'Angles are in radians. Each object matches the b3Vehicle_Set* call of the same name.',
		chassis: b3.b3Vehicle_GetChassis(vehicle),
		wheels,
		engine: b3.b3Vehicle_GetEngine(vehicle),
		transmission: b3.b3Vehicle_GetTransmission(vehicle),
		drivetrain: b3.b3Vehicle_GetDrivetrain(vehicle),
		antiRoll: b3.b3Vehicle_GetAntiRoll(vehicle),
		steering: b3.b3Vehicle_GetSteering(vehicle),
		assists: b3.b3Vehicle_GetAssists(vehicle),
	};
	return JSON.stringify(
		settings,
		(key, value) => {
			if (typeof value === 'bigint') return value.toString();
			if (key in enums && value && typeof value.value === 'number') {
				const entry = Object.entries(enums[key]).find(
					([, e]) => e?.value === value.value,
				);
				return entry ? entry[0] : value.value;
			}
			return value;
		},
		2,
	);
}

function toast(text: string): void {
	const el = document.createElement('div');
	el.textContent = text;
	el.style.cssText =
		'position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:6px 14px;border-radius:6px;' +
		'background:rgba(0,0,0,.75);color:#eee;font:600 13px system-ui,sans-serif;pointer-events:none;z-index:10';
	document.body.appendChild(el);
	setTimeout(() => el.remove(), 1600);
}

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Clipboard access needs a secure context and focus; fall back to a selected textarea
		const area = document.createElement('textarea');
		area.value = text;
		area.style.cssText = 'position:fixed;opacity:0';
		document.body.appendChild(area);
		area.select();
		const ok = document.execCommand('copy');
		area.remove();
		return ok;
	}
}

export function addShowcase(host: ShowcaseHost): void {
	const { gui, b3 } = host;
	const start = host.current().name;
	const matrix = vehiclePresets[start].matrix ?? {
		car: 'sports' as VehicleCarName,
		realism: 50 as VehicleRealism,
		drive: 'rwd' as VehicleDrive,
	};
	const params = {
		car: matrix.car,
		realism: matrix.realism,
		drive: matrix.drive,
		terrain: host.terrain,
		copy: async () => {
			const { name, vehicle } = host.current();
			const ok = await copyText(vehicleSettingsJson(b3, vehicle, name));
			toast(ok ? `Copied ${name} settings` : 'Copy failed, see the console');
			if (!ok) console.log(vehicleSettingsJson(b3, vehicle, name));
		},
	};

	const folder = gui.addFolder('Preset');
	// Keep the picker above the Vehicle folder, which is rebuilt on every swap
	const vehicleFolder = gui.folders.find((f) => f._title === 'Vehicle');
	if (vehicleFolder) {
		gui.$children.insertBefore(folder.domElement, vehicleFolder.domElement);
	}

	const carOptions: Record<string, VehicleCarName> = {};
	for (const [key, car] of Object.entries(vehicleCars)) {
		carOptions[car.title] = key as VehicleCarName;
	}
	const realismOptions: Record<string, VehicleRealism> = {};
	for (const realism of realismOrder) {
		realismOptions[realismLevels[realism].title] = realism;
	}
	const driveOptions: Record<string, VehicleDrive> = {};
	for (const [key, layer] of Object.entries(drivetrainLayers)) {
		driveOptions[layer.title] = key as VehicleDrive;
	}

	const carController = folder
		.add(params, 'car', carOptions)
		.name('car (1/2/3)')
		.onChange(apply);
	const realismController = folder
		.add(params, 'realism', realismOptions)
		.name('realism ([ ])')
		.onChange(apply);
	const driveController = folder
		.add(params, 'drive', driveOptions)
		.name('drive (F/G/H)')
		.onChange(apply);
	folder
		.add(params, 'terrain', {
			'Test track': 'track',
			'Off-road area': 'offroad',
			'Race circuit': 'circuit',
			'Off-road stage': 'stage',
		})
		.name('terrain (reloads)')
		.onChange(() => {
			updateUrl();
			location.reload();
		});
	folder.add(params, 'copy').name('copy settings JSON');

	function presetName(): VehiclePresetName {
		return vehiclePresetName(params.car, params.realism, params.drive);
	}

	function updateUrl(): void {
		const url = new URL(location.href);
		url.searchParams.set('preset', presetName());
		url.searchParams.set('terrain', params.terrain);
		history.replaceState(null, '', url);
	}

	function updateInfo(): void {
		const car = vehicleCars[params.car];
		host.setInfo(
			vehiclePresets[presetName()].title,
			`${car.blurb}<br>${realismLevels[params.realism].title}: ${describeRealism(params.realism)}.`,
			'<br>1/2/3 sports, rally, supercar · [ ] less or more realistic · F/G/H front, rear, all wheel drive',
		);
	}

	function apply(): void {
		// lil-gui hands option values back as given, but a stale string would build a bad name
		params.realism = Number(params.realism) as VehicleRealism;
		host.swap(presetName(), vehicleCars[params.car].color);
		for (const c of [carController, realismController, driveController])
			c.updateDisplay();
		updateUrl();
		updateInfo();
	}

	const setCar = (car: VehicleCarName) => () => {
		params.car = car;
		apply();
	};
	const setDrive = (drive: VehicleDrive) => () => {
		params.drive = drive;
		apply();
	};
	const stepRealism = (delta: number) => () => {
		const i = realismOrder.indexOf(params.realism);
		const next = realismOrder[Math.min(Math.max(i + delta, 0), 4)];
		if (next === params.realism) return;
		params.realism = next;
		apply();
	};
	host.onPress.set('Digit1', setCar('sports'));
	host.onPress.set('Digit2', setCar('rally'));
	host.onPress.set('Digit3', setCar('super'));
	// [ moves toward arcade, ] toward realistic
	host.onPress.set('BracketLeft', stepRealism(1));
	host.onPress.set('BracketRight', stepRealism(-1));
	host.onPress.set('KeyF', setDrive('fwd'));
	host.onPress.set('KeyG', setDrive('rwd'));
	host.onPress.set('KeyH', setDrive('awd'));

	updateUrl();
	updateInfo();
}
