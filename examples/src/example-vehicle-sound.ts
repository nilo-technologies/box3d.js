// Vehicle: sound lab. Tunes the vehicle examples' procedural sound (engine, tires, turbo, wind,
// bump stop) without driving a car. The Drive folder feeds the sound: hold W or the up arrow to
// rev, drag the sliders yourself, or let a loop drive it (free revs, a pull through the gears
// and a stop, a drift). A small engine and turbo model stands in for the physics, using the
// rpm range, gearing and turbo types from box3d.js/vehicles. A see-through 3D engine
// (vehicle-engine-model.ts) runs from the same inputs: its pistons, firing flashes, glowing
// exhaust and spinning turbo follow the rpm, throttle and boost. The scope along the bottom
// shows the waveform and the spectrum. The tuning is saved in localStorage; to hear it in the
// driving examples, copy it over defaultSoundParams in vehicle-audio.ts.

import {
	turboTypes,
	type VehicleCarName,
	type VehicleTurboName,
	vehicleCars,
} from 'box3d.js/vehicles';
import GUI from 'lil-gui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
	createVehicleAudio,
	type EngineVoiceName,
	engineVoices,
	type VehicleSound,
} from './vehicle-audio';
import {
	createEngineModel,
	type EngineInduction,
} from './vehicle-engine-model';
import { carEngines } from './vehicle-engine-voice';
import { addSoundPanel } from './vehicle-sound-panel';

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

// Before and after: the old sound is the two resonance exhaust, no intake, heard dry. Switching
// back restores what was set before, and nothing here is saved.
const compare = { sound: 'new' as 'new' | 'old' };
// What the dropdown shows. Its change handler reads the old value from compare.
const compareView = { ...compare };
const newSound = {
	exhaust: audio.params.engine.exhaust,
	intake: audio.params.engine.intake,
	position: audio.params.listener.position,
};
function setCompare(sound: 'new' | 'old'): void {
	const { engine, listener } = audio.params;
	if (sound === 'old' && compare.sound === 'new') {
		Object.assign(newSound, {
			exhaust: engine.exhaust,
			intake: engine.intake,
			position: listener.position,
		});
		engine.exhaust = 'resonances';
		engine.intake = 0;
		listener.position = 'dry';
	} else if (sound === 'new' && compare.sound === 'old') {
		engine.exhaust =
			newSound.exhaust === 'resonances' ? 'pipes' : newSound.exhaust;
		engine.intake = newSound.intake || 1;
		listener.position =
			newSound.position === 'dry' ? 'exterior' : newSound.position;
	}
	compare.sound = sound;
	compareView.sound = sound;
	panel.refresh();
	compareControl.updateDisplay();
}
const compareControl = playFolder
	.add(compareView, 'sound', {
		'New: exhaust pipes, intake, room': 'new',
		'Old: two resonances, dry': 'old',
	})
	.name('before / after (O)')
	.onChange((sound: 'new' | 'old') => setCompare(sound));

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
	if (e.code === 'KeyO' && !e.repeat)
		setCompare(compare.sound === 'new' ? 'old' : 'new');
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

// Rev limiter: at the max rpm the ignition cuts until the revs fall LIMITER_DROP, then fires
// again, a quick stutter just under the redline. Snapping the revs back by a few hundred rpm
// every frame instead would warble the pitch. The sound hears a cut as a dip in load
// (CUT_THROTTLE of the pedal), not a lift, so it never blows off or crackles.
const LIMITER_DROP = 120;
const CUT_FALL = 5000;
const CUT_THROTTLE = 0.6;
let limiterCut = false;

/** Out of gear: the rpm climbs on throttle, falls back to idle off it and stutters on the limiter */
function freeRev(throttle: number, dt: number): void {
	const { idleRpm, maxRpm } = vehicleCars[settings.car].engine;
	sound.throttle += (throttle - sound.throttle) * Math.min(dt * 12, 1);
	if (sound.engineRpm >= maxRpm) limiterCut = true;
	else if (sound.engineRpm <= maxRpm - LIMITER_DROP || sound.throttle < 0.05)
		limiterCut = false;
	const rate = limiterCut
		? -CUT_FALL
		: sound.throttle > 0.05
			? 7000 * sound.throttle
			: -4500;
	sound.engineRpm = Math.min(
		Math.max(sound.engineRpm + rate * dt, idleRpm),
		maxRpm,
	);
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
	limiterCut = false;
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
	if (settings.mode !== 'keys' && settings.mode !== 'rev') limiterCut = false;
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
		{
			...sound,
			speed: burnout ? Math.max(sound.speed, 12) : sound.speed,
			throttle: limiterCut ? sound.throttle * CUT_THROTTLE : sound.throttle,
			supercharged: settings.turbo === 'supercharger',
		},
		dt,
	);
	engine.update(
		{
			rpm: sound.engineRpm,
			throttle: sound.throttle,
			cut: limiterCut,
			boost:
				settings.turbo === 'sequential' && settings.mode !== 'manual'
					? stageBoost
					: [sound.boost],
			crackle: audio.crackle,
		},
		dt,
	);
}

// ---------------------------------------------------------------------------
// 3D engine, framed above the scope
// ---------------------------------------------------------------------------

/** Share of the window the scope covers at the bottom */
const SCOPE_HEIGHT = 0.3;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.id = 'engine-view';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
	new RoomEnvironment(),
	0.04,
).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2a2018, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(-4, 8, 6);
scene.add(keyLight);
const grid = new THREE.GridHelper(24, 24, 0x3a3a3a, 0x262626);
grid.position.y = -2.4;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(-7, 4.5, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.2, 0);

const engine = createEngineModel(audio.params.turbo);
scene.add(engine.group);
audio.onSound = (name, strength) => {
	if (name === 'thump') engine.jolt(strength);
	else engine.puff(strength, name === 'blowOff' ? 'valve' : 'inlet');
};

const modelFolder = gui.addFolder('Engine model');
modelFolder.add(engine, 'slowMotion', 0.01, 0.25, 0.01).name('speed (x real)');

const inductions: Record<VehicleTurboName, EngineInduction> = {
	none: 'none',
	small: 'single',
	big: 'single',
	twinScroll: 'single',
	parallel: 'twin',
	sequential: 'sequential',
	vgt: 'single',
	electric: 'single',
	supercharger: 'supercharger',
	antiLag: 'single',
};

/** The voice playing, with 'auto' resolved to the car's engine as the audio does */
function engineVoice(): EngineVoiceName {
	const choice = audio.params.engine.voice;
	if (choice === 'auto') return carEngines[settings.car]?.voice ?? 'classic';
	return choice === 'classic' || choice in engineVoices ? choice : 'classic';
}

let engineKey = '';

/** Rebuilds the engine when the voice, the cylinder count or the turbo changes, and frames it */
function syncEngine(): void {
	const voice = engineVoice();
	const induction = inductions[settings.turbo];
	const key = `${voice} ${voice === 'classic' ? settings.cylinders : ''} ${induction}`;
	if (key === engineKey) return;
	engineKey = key;
	engine.setEngine(voice, settings.cylinders, induction);
	const fit =
		engine.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
	const direction = camera.position.clone().sub(controls.target).normalize();
	camera.position.copy(controls.target).addScaledVector(direction, fit * 0.95);
}

function resizeView(): void {
	const w = window.innerWidth;
	const h = window.innerHeight;
	renderer.setSize(w, h);
	camera.aspect = w / h;
	// Shift the picture so the engine sits centred above the scope and left of the panel
	const panel = Math.min(gui.domElement.offsetWidth, w / 3);
	camera.setViewOffset(w, h, panel / 2, (h * SCOPE_HEIGHT) / 2, w, h);
	camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeView);
resizeView();

// ---------------------------------------------------------------------------
// Scope along the bottom: waveform on top, spectrum (log frequency) below
// ---------------------------------------------------------------------------

const style = document.createElement('style');
style.textContent = `
	#engine-view { position: fixed; inset: 0; display: block; }
	#scope {
		position: fixed; left: 0; bottom: 0; width: 100vw; height: ${SCOPE_HEIGHT * 100}vh;
		display: block; pointer-events: none;
	}
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
	Tune the engine, tire and turbo sound in the Sound folder. It saves as you go; copy it as
	JSON to make it the default.<br />
	<span class="sound-lab-hint">W / ↑ rev · Space burnout · V blow-off · C stutter · B bump stop · O before / after · drag to orbit</span>
	<div class="sound-lab-readout"></div>
	<div class="sound-lab-hint" data-engine></div>
	<div class="sound-lab-hint" data-start>Click or press a key to start the sound.</div>
`;
document.body.appendChild(info);
const readout = info.querySelector('.sound-lab-readout') as HTMLElement;
const startHint = info.querySelector('[data-start]') as HTMLElement;
const engineLabel = info.querySelector('[data-engine]') as HTMLElement;

let analyser: AnalyserNode | null = null;
let timeData = new Uint8Array(0);
let freqData = new Uint8Array(0);

function resize(): void {
	const ratio = Math.min(window.devicePixelRatio, 2);
	canvas.width = Math.floor(window.innerWidth * ratio);
	canvas.height = Math.floor(window.innerHeight * SCOPE_HEIGHT * ratio);
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
	const h = window.innerHeight * SCOPE_HEIGHT;
	ctx2d.clearRect(0, 0, w, h);
	const shade = ctx2d.createLinearGradient(0, 0, 0, h);
	shade.addColorStop(0, 'rgba(26,26,26,0)');
	shade.addColorStop(0.25, 'rgba(26,26,26,0.85)');
	shade.addColorStop(1, 'rgba(26,26,26,0.95)');
	ctx2d.fillStyle = shade;
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

	const waveTop = h * 0.12;
	const waveHeight = h * 0.3;
	const specTop = h * 0.46;
	const specHeight = h * 0.44;

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
			specTop + specHeight + 12,
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
	syncEngine();
	step(dt);
	controls.update();
	renderer.render(scene, camera);
	drawScope();
	const gear = sound.gear > 0 ? `gear ${sound.gear}` : 'neutral';
	readout.textContent =
		`${Math.round(sound.engineRpm)} rpm · ${gear} · ` +
		`${Math.round(sound.speed * 3.6)} km/h · boost ${Math.round(sound.boost * 100)}%` +
		(limiterCut ? ' · limiter' : '');
	engineLabel.textContent = `${engine.title}, shown at ${engine.slowMotion.toFixed(2)}x speed`;
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
