// Vehicle: sound lab. Tunes the vehicle examples' procedural sound (engine, tires, turbo, wind,
// bump stop) without driving a car. The Drive folder feeds the sound: hold W or the up arrow to
// rev, drag the sliders yourself, or let a loop drive it (free revs, a pull through the gears
// and a stop, a drift). A small engine and turbo model stands in for the physics, using the
// rpm range, gearing and turbo types from vehicle-presets.js. The scope shows the waveform and
// the spectrum. The tuning is saved and shared with the driving examples, whose Sound folder
// has the same settings.

import GUI from 'lil-gui';
import { createVehicleAudio, type VehicleSound } from './vehicle-audio';
import {
	turboTypes,
	type VehicleCarName,
	type VehicleTurboName,
	vehicleCars,
} from './vehicle-presets';
import { addSoundPanel, carEngines } from './vehicle-sound-panel';

type Mode = 'keys' | 'manual' | 'rev' | 'pull' | 'drift';

const modes: Record<string, Mode> = {
	'hold W / ↑ to rev': 'keys',
	'sliders only': 'manual',
	'loop: free revs': 'rev',
	'loop: pull through gears': 'pull',
	'loop: drift': 'drift',
};

const audio = createVehicleAudio(0.5);

const settings = {
	car: 'sports' as VehicleCarName,
	turbo: 'twinScroll' as VehicleTurboName,
	cylinders: carEngines.sports.cylinders,
	volume: audio.volume,
	mode: 'keys' as Mode,
};
audio.setCylinders(settings.cylinders);
audio.setCarVoice(carEngines.sports.voice);

const sound: VehicleSound & { gear: number } = {
	engineRpm: vehicleCars.sports.engine.idleRpm,
	throttle: 0,
	speed: 0,
	skid: 0,
	compression: 0,
	boost: 0,
	gear: 0,
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const gui = new GUI({ title: 'Sound lab' });

const carOptions: Record<string, VehicleCarName> = {};
for (const [key, car] of Object.entries(vehicleCars)) {
	carOptions[car.title] = key as VehicleCarName;
}
const turboOptions: Record<string, VehicleTurboName> = {};
for (const [key, type] of Object.entries(turboTypes)) {
	turboOptions[type.title] = key as VehicleTurboName;
}

const playFolder = gui.addFolder('Play');
playFolder.add({ play: () => audio.blowOff(1) }, 'play').name('▶ blow-off (V)');
playFolder.add({ play: () => audio.flutter(1) }, 'play').name('▶ stutter (C)');
playFolder.add({ play: () => audio.thump(1) }, 'play').name('▶ bump stop (B)');

const carFolder = gui.addFolder('Car');
carFolder
	.add(settings, 'car', carOptions)
	.name('car (rpm, gears, auto voice)')
	.onChange((name: VehicleCarName) => {
		settings.cylinders = carEngines[name]?.cylinders ?? 6;
		audio.setCylinders(settings.cylinders);
		audio.setCarVoice(carEngines[name]?.voice ?? 'classic');
		resetDrive();
	});
carFolder.add(settings, 'turbo', turboOptions).name('turbo');
carFolder
	.add(settings, 'cylinders', 2, 16, 1)
	.name('cylinders (classic voice)')
	.listen()
	.onChange((count: number) => audio.setCylinders(count));
carFolder
	.add(settings, 'volume', 0, 1, 0.05)
	.name('master volume')
	.onChange((value: number) => audio.setVolume(value));

const driveFolder = gui.addFolder('Drive');
driveFolder
	.add(settings, 'mode', modes)
	.name('driven by')
	.onChange(() => {
		resetDrive();
		updateEnabled();
	});
const inputs = {
	rpm: driveFolder.add(sound, 'engineRpm', 0, 9000, 10).name('rpm').listen(),
	throttle: driveFolder
		.add(sound, 'throttle', 0, 1, 0.01)
		.name('throttle')
		.listen(),
	boost: driveFolder.add(sound, 'boost', 0, 1, 0.01).name('boost').listen(),
	speed: driveFolder
		.add(sound, 'speed', 0, 90, 0.1)
		.name('speed (m/s)')
		.listen(),
	skid: driveFolder.add(sound, 'skid', 0, 1, 0.01).name('tire slide').listen(),
	compression: driveFolder
		.add(sound, 'compression', 0, 1, 0.01)
		.name('suspension')
		.listen(),
};

function updateEnabled(): void {
	const manual = settings.mode === 'manual';
	const keys = settings.mode === 'keys';
	inputs.rpm.enable(manual);
	inputs.throttle.enable(manual);
	inputs.boost.enable(manual);
	inputs.speed.enable(manual || keys);
	inputs.skid.enable(manual || keys);
	inputs.compression.enable(manual || keys);
}
updateEnabled();

const panel = addSoundPanel(gui, audio, { open: true });

// For scripted checks: window.soundLab reads the live inputs and the output level
Object.assign(window, {
	soundLab: {
		audio,
		sound,
		settings,
		panel,
		/** RMS of the output over the analyser's last buffer */
		rms() {
			if (!analyser) return 0;
			const data = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(data);
			let sum = 0;
			for (const x of data) sum += x * x;
			return Math.sqrt(sum / data.length);
		},
	},
});

// ---------------------------------------------------------------------------
// Keys: W / ↑ throttle, Space slides the tires, B hits the bump stop
// ---------------------------------------------------------------------------

const held = new Set<string>();
const isTyping = (e: KeyboardEvent) =>
	e.target instanceof HTMLInputElement ||
	e.target instanceof HTMLTextAreaElement ||
	e.target instanceof HTMLSelectElement;
window.addEventListener('keydown', (e) => {
	if (isTyping(e)) return;
	held.add(e.code);
	if (e.code === 'KeyB' && !e.repeat) audio.thump(1);
	if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

// ---------------------------------------------------------------------------
// Engine and turbo model
// ---------------------------------------------------------------------------

const stageBoost = [0, 0];

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(Math.max((x - a) / Math.max(b - a, 1e-6), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Boost from the turbo type's stages, each lagging toward throttle x its rpm curve */
function updateBoost(dt: number): void {
	const type = turboTypes[settings.turbo];
	const maxRpm = vehicleCars[settings.car].engine.maxRpm;
	let total = 0;
	let gains = 0;
	type.stages.forEach((stage, i) => {
		const target =
			sound.throttle *
			smoothstep(stage.spool, stage.full, sound.engineRpm / maxRpm);
		const time = target > stageBoost[i] ? stage.spoolTime : stage.bleedTime;
		stageBoost[i] +=
			(target - stageBoost[i]) * Math.min(dt / Math.max(time, 0.01), 1);
		total += stage.gain * stageBoost[i];
		gains += stage.gain;
	});
	const lagged = gains > 0 ? total / gains : 0;
	const instant = type.instantFraction ?? 0;
	sound.boost =
		gains > 0 ? instant * sound.throttle + (1 - instant) * lagged : 0;
}

/** Out of gear: the rpm climbs on throttle, falls back to idle off it and bounces off the limiter */
function freeRev(throttle: number, dt: number): void {
	const { idleRpm, maxRpm } = vehicleCars[settings.car].engine;
	sound.throttle += (throttle - sound.throttle) * Math.min(dt * 12, 1);
	const rate = sound.throttle > 0.05 ? 7000 * sound.throttle : -4500;
	sound.engineRpm = Math.min(
		Math.max(sound.engineRpm + rate * dt, idleRpm),
		maxRpm,
	);
	if (sound.engineRpm >= maxRpm - 1) sound.engineRpm = maxRpm - 350;
	sound.gear = 0;
}

let clock = 0;
let phase: 'launch' | 'accelerate' | 'shift' | 'brake' | 'pause' = 'launch';
let phaseTime = 0;

function resetDrive(): void {
	clock = 0;
	phase = 'launch';
	phaseTime = 0;
	stageBoost.fill(0);
	sound.engineRpm = vehicleCars[settings.car].engine.idleRpm;
	sound.throttle = 0;
	sound.boost = 0;
	sound.gear = 0;
	if (settings.mode !== 'manual' && settings.mode !== 'keys') {
		sound.speed = 0;
		sound.skid = 0;
		sound.compression = 0;
	}
}

function setPhase(next: typeof phase): void {
	phase = next;
	phaseTime = 0;
}

/** Wheel speed (m/s) to engine rpm in a gear (1 is first) */
function gearRpm(speed: number, gear: number): number {
	const car = vehicleCars[settings.car];
	const ratio = car.gears[gear - 1] * car.finalDrive;
	return ((speed / car.wheelRadius) * ratio * 60) / (2 * Math.PI);
}

/** Launch, pull through every gear with a lift at each shift, brake to a stop, wait, repeat */
function pull(dt: number): void {
	const car = vehicleCars[settings.car];
	const { idleRpm, maxRpm } = car.engine;
	const shiftRpm = 0.9 * maxRpm;
	const top = car.gears.length;
	phaseTime += dt;
	sound.skid = 0;

	if (phase === 'launch' || phase === 'accelerate') {
		if (sound.gear === 0) sound.gear = 1;
		sound.throttle = 1;
		const ratio = car.gears[sound.gear - 1] / car.gears[0];
		const accel = 8 * ratio * (0.75 + 0.35 * sound.boost);
		sound.speed += (accel - 0.0004 * sound.speed ** 2) * dt;
		sound.engineRpm = gearRpm(sound.speed, sound.gear);
		if (phase === 'launch') {
			// Clutch slip holds the revs up, and the driven tires spin for a moment
			sound.engineRpm = Math.max(sound.engineRpm, idleRpm + 2600);
			sound.skid = Math.max(0.7 * (1 - phaseTime / 0.7), 0);
			if (phaseTime > 0.9) setPhase('accelerate');
		}
		if (sound.engineRpm >= shiftRpm) {
			setPhase(sound.gear < top && sound.speed < 75 ? 'shift' : 'brake');
		}
	} else if (phase === 'shift') {
		sound.throttle = 0;
		sound.speed -= 0.5 * dt;
		sound.engineRpm = gearRpm(sound.speed, sound.gear);
		if (phaseTime > 0.22) {
			sound.gear++;
			setPhase('accelerate');
		}
	} else if (phase === 'brake') {
		sound.throttle = 0;
		sound.speed = Math.max(sound.speed - 9 * dt, 0);
		// A brief lock-up chirp as the brakes bite
		sound.skid = phaseTime < 0.35 ? 0.45 : 0;
		if (sound.gear > 1 && gearRpm(sound.speed, sound.gear) < 0.45 * maxRpm)
			sound.gear--;
		sound.engineRpm = Math.max(gearRpm(sound.speed, sound.gear), idleRpm);
		if (sound.speed === 0) setPhase('pause');
	} else {
		sound.gear = 0;
		freeRev(0, dt);
		if (phaseTime > 1.5) setPhase('launch');
	}
	sound.compression = 0;
}

/** Holding a slide: wavering throttle and slip, a bump every few seconds */
function drift(dt: number): void {
	const { maxRpm } = vehicleCars[settings.car].engine;
	const t = clock;
	sound.gear = 3;
	sound.speed = 17 + 3 * Math.sin(0.4 * t);
	sound.throttle = Math.min(Math.max(0.75 + 0.35 * Math.sin(1.1 * t), 0), 1);
	sound.skid = Math.min(
		Math.max(0.55 + 0.3 * Math.sin(0.9 * t) + 0.15 * Math.sin(3.1 * t), 0),
		1,
	);
	sound.engineRpm = maxRpm * (0.72 + 0.1 * Math.sin(1.1 * t - 0.4));
	sound.compression = t % 2.7 < dt ? 1 : 0.4;
}

function step(dt: number): void {
	clock += dt;
	switch (settings.mode) {
		case 'manual':
			break;
		case 'keys': {
			const throttle =
				held.has('KeyW') || held.has('ArrowUp') || held.has('Space') ? 1 : 0;
			freeRev(throttle, dt);
			updateBoost(dt);
			if (held.has('Space')) sound.skid = 1;
			break;
		}
		case 'rev':
			freeRev(clock % 3 < 1.3 ? 1 : 0, dt);
			updateBoost(dt);
			break;
		case 'pull':
			pull(dt);
			updateBoost(dt);
			break;
		case 'drift':
			drift(dt);
			updateBoost(dt);
			break;
	}
	// Space is a burnout: the tires squeal even with the speed slider at zero
	const burnout = settings.mode === 'keys' && held.has('Space');
	audio.update(
		burnout ? { ...sound, speed: Math.max(sound.speed, 12) } : sound,
		dt,
	);
}

// ---------------------------------------------------------------------------
// Scope: waveform on top, spectrum (log frequency) below
// ---------------------------------------------------------------------------

const style = document.createElement('style');
style.textContent = `
	#scope { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; }
	.sound-lab-info { max-width: min(460px, calc(100vw - 40px)); }
	.sound-lab-info b { font-size: 15px; }
	.sound-lab-readout { font-variant-numeric: tabular-nums; margin-top: 4px; color: #ffd166; }
	.sound-lab-hint { color: #aaa; }
`;
document.head.appendChild(style);

const canvas = document.createElement('canvas');
canvas.id = 'scope';
document.body.appendChild(canvas);
const ctx2d = canvas.getContext('2d') as CanvasRenderingContext2D;

const info = document.createElement('div');
info.className = 'overlay sound-lab-info';
info.innerHTML = `
	<b>Vehicle: sound lab</b><br />
	Tune the engine, tire and turbo sound in the Sound folder. It saves as you go, and the
	driving examples use the same tuning.<br />
	<span class="sound-lab-hint">W / ↑ rev · Space burnout · V blow-off · C stutter · B bump stop</span>
	<div class="sound-lab-readout"></div>
	<div class="sound-lab-hint" data-start>Click or press a key to start the sound.</div>
`;
document.body.appendChild(info);
const readout = info.querySelector('.sound-lab-readout') as HTMLElement;
const startHint = info.querySelector('[data-start]') as HTMLElement;

let analyser: AnalyserNode | null = null;
let timeData = new Uint8Array(0);
let freqData = new Uint8Array(0);

function resize(): void {
	const ratio = Math.min(window.devicePixelRatio, 2);
	canvas.width = Math.floor(window.innerWidth * ratio);
	canvas.height = Math.floor(window.innerHeight * ratio);
	ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const MIN_HZ = 20;
const MAX_HZ = 12000;
const hzToX = (hz: number, width: number) =>
	(Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * width;

function drawScope(): void {
	const w = window.innerWidth;
	const h = window.innerHeight;
	ctx2d.fillStyle = '#1a1a1a';
	ctx2d.fillRect(0, 0, w, h);

	const output = audio.output;
	if (!analyser && output) {
		analyser = output.context.createAnalyser();
		analyser.fftSize = 8192;
		analyser.smoothingTimeConstant = 0.7;
		output.connect(analyser);
		timeData = new Uint8Array(analyser.fftSize);
		freqData = new Uint8Array(analyser.frequencyBinCount);
	}
	startHint.style.display =
		output && (output.context as AudioContext).state === 'running'
			? 'none'
			: '';

	const waveTop = h * 0.3;
	const waveHeight = h * 0.25;
	const specTop = h * 0.6;
	const specHeight = h * 0.35;

	// Frequency grid
	ctx2d.font = '11px system-ui, sans-serif';
	ctx2d.textAlign = 'center';
	for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
		const x = hzToX(hz, w);
		ctx2d.fillStyle = 'rgba(255,255,255,0.06)';
		ctx2d.fillRect(x, specTop, 1, specHeight);
		ctx2d.fillStyle = 'rgba(255,255,255,0.35)';
		ctx2d.fillText(
			hz >= 1000 ? `${hz / 1000}k` : `${hz}`,
			x,
			specTop + specHeight + 14,
		);
	}
	ctx2d.fillStyle = 'rgba(255,255,255,0.06)';
	ctx2d.fillRect(0, waveTop + waveHeight / 2, w, 1);

	if (!analyser) return;
	analyser.getByteTimeDomainData(timeData);
	analyser.getByteFrequencyData(freqData);

	// Waveform, a quarter of the buffer so engine cycles are visible
	const samples = timeData.length / 4;
	ctx2d.strokeStyle = '#ff6b6b';
	ctx2d.lineWidth = 1.5;
	ctx2d.beginPath();
	for (let i = 0; i < samples; i++) {
		const x = (i / (samples - 1)) * w;
		const y = waveTop + (timeData[i] / 255) * waveHeight;
		if (i === 0) ctx2d.moveTo(x, y);
		else ctx2d.lineTo(x, y);
	}
	ctx2d.stroke();

	// Spectrum
	const nyquist = analyser.context.sampleRate / 2;
	ctx2d.fillStyle = 'rgba(78,205,196,0.55)';
	ctx2d.beginPath();
	ctx2d.moveTo(0, specTop + specHeight);
	for (let x = 0; x <= w; x += 2) {
		const hz = MIN_HZ * (MAX_HZ / MIN_HZ) ** (x / w);
		const bin = Math.min(
			Math.round((hz / nyquist) * freqData.length),
			freqData.length - 1,
		);
		ctx2d.lineTo(x, specTop + specHeight * (1 - freqData[bin] / 255));
	}
	ctx2d.lineTo(w, specTop + specHeight);
	ctx2d.closePath();
	ctx2d.fill();
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
	const dt = Math.min((now - last) / 1000, 0.05);
	last = now;
	step(dt);
	drawScope();
	const gear = sound.gear > 0 ? `gear ${sound.gear}` : 'neutral';
	readout.textContent =
		`${Math.round(sound.engineRpm)} rpm · ${gear} · ` +
		`${Math.round(sound.speed * 3.6)} km/h · boost ${Math.round(sound.boost * 100)}%`;
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
