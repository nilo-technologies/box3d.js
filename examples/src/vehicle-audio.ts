// Procedural car sound for the vehicle examples, made with the Web Audio API and no audio files.
//
// The engine is modeled the way it makes sound: every cylinder firing sends a pressure pulse
// down the exhaust. An AudioWorklet generates one short pulse per firing, each a little
// different (cylinders never fire identically, and a cross-plane V8's uneven firing order gives
// its burble), and a bank of resonant filters stands in for the exhaust and body resonances that
// shape those pulses into the engine's tone. The pitch comes from the pulse rate, so it follows
// the rpm, and the throttle sets how hard the pulses are.
//
// The tires make a stick-slip howl (two narrow, wavering resonances) over a broadband scrub,
// wind rises with speed, and the suspension thumps at its bump stop. Everything shares a short
// room reverb and a compressor so it sounds like one car in one place.
//
// Browsers only start audio after a user gesture, so the live context starts on the first key
// press or click. buildVehicleSound also works on an OfflineAudioContext, to render the sound of
// a recorded drive.

export type VehicleSound = {
	engineRpm: number;
	/** Throttle after the gearbox logic, 0 to 1 */
	throttle: number;
	/** Forward speed (m/s) */
	speed: number;
	/** How hard the hardest sliding tire slides, 0 to 1 */
	skid: number;
	/** Largest suspension compression this frame, 0 extended to 1 at the bump stop */
	compression: number;
};

export type VehicleAudio = {
	/** Call once per frame */
	update(sound: VehicleSound, dt: number): void;
	/** Firing pulses per crankshaft turn are cylinders / 2, which sets the engine pitch */
	setCylinders(cylinders: number): void;
	setVolume(volume: number): void;
	/** 0 to 1, as last set */
	readonly volume: number;
};

export type VehicleSoundGraph = {
	/** Schedules the sound for one frame at the context time `time` (s) */
	set(sound: VehicleSound, time: number, dt: number): void;
	setCylinders(cylinders: number): void;
	/** Master volume, 0 to 1 */
	setVolume(volume: number, time: number): void;
};

// The worklet runs in its own scope, so it is shipped as source text
const engineWorklet = `
// Relative pulse strength per firing, in firing order. Small differences between cylinders make
// the engine sound mechanical rather than electronic; the cross-plane V8 pattern alternates
// strong and weak pulses on each exhaust bank, which is its burble.
const PATTERNS = {
	4: [1, 0.92, 0.97, 0.9],
	6: [1, 0.9, 0.96, 0.92, 0.98, 0.88],
	8: [1, 0.7, 0.94, 0.66, 0.9, 0.74, 1, 0.68],
};

class EngineProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: 'rpm', defaultValue: 900, minValue: 0, automationRate: 'k-rate' },
			{ name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
			{ name: 'cylinders', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
		];
	}

	constructor() {
		super();
		this.phase = 0;
		this.cylinder = 0;
		this.pulse = 0;
		this.hiss = 0;
		this.seed = 12345;
		this.dc = 0;
	}

	random() {
		this.seed = (this.seed * 16807) % 2147483647;
		return this.seed / 2147483647;
	}

	process(_inputs, outputs, parameters) {
		const out = outputs[0][0];
		const rpm = Math.max(parameters.rpm[0], 300);
		const throttle = parameters.throttle[0];
		const cylinders = Math.round(parameters.cylinders[0]);
		const pattern = PATTERNS[cylinders] ?? PATTERNS[6];
		const firing = (rpm / 60) * (cylinders / 2);
		const step = firing / sampleRate;
		// Each pulse decays within its share of the cycle, so pulses blur together at high rpm
		const decay = Math.exp(-1 / (sampleRate * Math.min(0.004, 0.45 / firing)));
		const hissDecay = Math.exp(-1 / (sampleRate * 0.0012));
		// Off throttle the pulses are weak and ragged; on throttle they are strong and even
		const load = 0.25 + 0.75 * throttle;
		const spread = 0.35 - 0.2 * throttle;
		for (let i = 0; i < out.length; i++) {
			this.phase += step;
			if (this.phase >= 1) {
				this.phase -= 1;
				this.cylinder = (this.cylinder + 1) % pattern.length;
				const strength = pattern[this.cylinder] * load * (1 - spread / 2 + spread * this.random());
				this.pulse += strength;
				this.hiss += strength * (0.3 + 0.5 * throttle);
			}
			const sample = this.pulse + (this.random() * 2 - 1) * this.hiss;
			this.pulse *= decay;
			this.hiss *= hissDecay;
			// The pulses only push, so remove their average
			this.dc += (sample - this.dc) * 0.002;
			out[i] = sample - this.dc;
		}
		return true;
	}
}

registerProcessor('vehicle-engine', EngineProcessor);
`;

let workletUrl: string | null = null;
const loadedContexts = new WeakSet<BaseAudioContext>();

async function loadEngineWorklet(context: BaseAudioContext): Promise<void> {
	if (loadedContexts.has(context)) return;
	workletUrl ??= URL.createObjectURL(
		new Blob([engineWorklet], { type: 'text/javascript' }),
	);
	await context.audioWorklet.addModule(workletUrl);
	loadedContexts.add(context);
}

/** Deterministic noise, so offline renders are repeatable */
function noiseBuffer(
	context: BaseAudioContext,
	seconds: number,
	seed: number,
): AudioBuffer {
	const buffer = context.createBuffer(
		1,
		Math.floor(context.sampleRate * seconds),
		context.sampleRate,
	);
	const data = buffer.getChannelData(0);
	let s = seed;
	for (let i = 0; i < data.length; i++) {
		s = (s * 16807) % 2147483647;
		data[i] = (s / 2147483647) * 2 - 1;
	}
	return buffer;
}

function loopedNoise(context: BaseAudioContext, buffer: AudioBuffer) {
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.loop = true;
	source.start();
	return source;
}

function filter(
	context: BaseAudioContext,
	type: BiquadFilterType,
	frequency: number,
	Q: number,
	gain = 0,
): BiquadFilterNode {
	const node = context.createBiquadFilter();
	node.type = type;
	node.frequency.value = frequency;
	node.Q.value = Q;
	node.gain.value = gain;
	return node;
}

/** A small room: decaying noise, a little brighter at the start */
function roomResponse(context: BaseAudioContext): AudioBuffer {
	const length = Math.floor(context.sampleRate * 0.7);
	const buffer = context.createBuffer(2, length, context.sampleRate);
	for (let c = 0; c < 2; c++) {
		const data = buffer.getChannelData(c);
		let s = 777 + c;
		for (let i = 0; i < length; i++) {
			s = (s * 16807) % 2147483647;
			const t = i / context.sampleRate;
			data[i] = ((s / 2147483647) * 2 - 1) * Math.exp(-t * 7);
		}
	}
	return buffer;
}

/** Builds the car's sound graph into `output` and returns the controls */
export async function buildVehicleSound(
	context: BaseAudioContext,
	output: AudioNode,
	volume = 0.5,
): Promise<VehicleSoundGraph> {
	await loadEngineWorklet(context);

	const master = context.createGain();
	master.gain.value = volume;
	const compressor = context.createDynamicsCompressor();
	compressor.threshold.value = -18;
	compressor.ratio.value = 3;
	compressor.attack.value = 0.01;
	compressor.release.value = 0.2;
	master.connect(compressor).connect(output);

	// Everything goes to the master directly and a little of it through the room
	const bus = context.createGain();
	bus.connect(master);
	const room = context.createConvolver();
	room.buffer = roomResponse(context);
	const roomLevel = context.createGain();
	roomLevel.gain.value = 0.18;
	bus.connect(room).connect(roomLevel).connect(master);

	// ---- Engine: pulses through exhaust and body resonances
	const engine = new AudioWorkletNode(context, 'vehicle-engine', {
		numberOfInputs: 0,
		outputChannelCount: [1],
	});
	const engineRpm = engine.parameters.get('rpm') as AudioParam;
	const engineThrottle = engine.parameters.get('throttle') as AudioParam;
	const engineCylinders = engine.parameters.get('cylinders') as AudioParam;
	const engineGain = context.createGain();
	engineGain.gain.value = 0;
	// The exhaust's resonances: a low boom, the main body of the note and a rasp above it
	const resonances = [
		filter(context, 'peaking', 95, 1.2, 9),
		filter(context, 'peaking', 260, 1.5, 6),
		filter(context, 'peaking', 720, 2.5, 3),
	];
	const muffler = filter(context, 'lowpass', 1200, 0.6);
	const rumble = filter(context, 'highpass', 30, 0.7);
	let node: AudioNode = engine;
	for (const r of [rumble, ...resonances, muffler]) node = node.connect(r);
	node.connect(engineGain).connect(bus);

	// Intake roar: noise that opens with throttle and rpm
	const noise = noiseBuffer(context, 2, 1);
	const intake = filter(context, 'bandpass', 900, 0.8);
	const intakeGain = context.createGain();
	intakeGain.gain.value = 0;
	loopedNoise(context, noise).connect(intake).connect(intakeGain).connect(bus);

	// ---- Tires: a stick-slip howl over broadband scrub
	const squealSource = loopedNoise(context, noiseBuffer(context, 2, 2));
	const howl = [
		filter(context, 'bandpass', 850, 22),
		filter(context, 'bandpass', 1260, 18),
	];
	const howlGain = context.createGain();
	howlGain.gain.value = 0;
	for (const h of howl) squealSource.connect(h).connect(howlGain);
	howlGain.connect(bus);
	const scrub = filter(context, 'lowpass', 450, 0.7);
	const scrubGain = context.createGain();
	scrubGain.gain.value = 0;
	loopedNoise(context, noiseBuffer(context, 2, 3))
		.connect(scrub)
		.connect(scrubGain)
		.connect(bus);

	// ---- Wind
	const wind = filter(context, 'lowpass', 500, 0.5);
	const windGain = context.createGain();
	windGain.gain.value = 0;
	loopedNoise(context, noiseBuffer(context, 2, 4))
		.connect(wind)
		.connect(windGain)
		.connect(bus);

	const thumpBuffer = noiseBuffer(context, 0.25, 5);
	function thump(strength: number, time: number) {
		const source = context.createBufferSource();
		source.buffer = thumpBuffer;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.9 * strength, time);
		gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
		source
			.connect(filter(context, 'lowpass', 180, 0.7))
			.connect(gain)
			.connect(bus);
		source.start(time);
	}

	let lastCompression = 0;
	let thumpCooldown = 0;
	let wobble = 0;
	let seed = 99;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};

	return {
		set(sound, t, dt) {
			// Smooth every parameter over a few frames so steps in the simulation do not click
			const glide = 0.04;
			const rpm = Math.max(sound.engineRpm, 300);
			engineRpm.setTargetAtTime(rpm, t, glide);
			engineThrottle.setTargetAtTime(sound.throttle, t, glide);
			const rev = rpm / 7000;
			engineGain.gain.setTargetAtTime(0.5 + 0.35 * sound.throttle, t, glide);
			muffler.frequency.setTargetAtTime(
				700 + 1600 * sound.throttle + 900 * rev,
				t,
				glide,
			);
			intakeGain.gain.setTargetAtTime(0.05 * sound.throttle * rev, t, glide);
			intake.frequency.setTargetAtTime(500 + 900 * rev, t, glide);

			const speed = Math.abs(sound.speed);
			const slide = speed > 1.5 ? sound.skid * Math.min(speed / 8, 1) : 0;
			// The howl wavers as the tread sticks and slips
			wobble += (random() - 0.5) * 0.3 - wobble * 0.1;
			const howlPitch = (700 + 350 * sound.skid) * (1 + 0.03 * wobble);
			howl[0].frequency.setTargetAtTime(howlPitch, t, 0.03);
			howl[1].frequency.setTargetAtTime(howlPitch * 1.48, t, 0.03);
			howlGain.gain.setTargetAtTime(
				2.2 * slide * (0.85 + 0.15 * random()),
				t,
				0.03,
			);
			scrubGain.gain.setTargetAtTime(0.35 * slide, t, glide);
			windGain.gain.setTargetAtTime(
				Math.min((speed / 70) ** 2, 1) * 0.6,
				t,
				0.2,
			);

			thumpCooldown = Math.max(thumpCooldown - dt, 0);
			if (
				sound.compression > 0.95 &&
				lastCompression < 0.85 &&
				thumpCooldown === 0
			) {
				thump(Math.min(0.4 + speed / 30, 1), t);
				thumpCooldown = 0.25;
			}
			lastCompression = sound.compression;
		},
		setCylinders(count) {
			engineCylinders.value = count;
		},
		setVolume(value, t) {
			master.gain.setTargetAtTime(value, t, 0.05);
		},
	};
}

/** The live sound for the examples, started by the first key press or click */
export function createVehicleAudio(volume = 0.5): VehicleAudio {
	let context: AudioContext | null = null;
	let graph: VehicleSoundGraph | null = null;
	let cylinders = 6;
	let level = volume;

	function unlock() {
		if (!context) {
			const ctx = new AudioContext();
			context = ctx;
			void buildVehicleSound(ctx, ctx.destination, level).then((g) => {
				g.setCylinders(cylinders);
				graph = g;
			});
		}
		if (context.state === 'suspended') void context.resume();
	}
	window.addEventListener('keydown', unlock);
	window.addEventListener('pointerdown', unlock);

	return {
		update(sound, dt) {
			if (!context || !graph || context.state !== 'running') return;
			graph.set(sound, context.currentTime, dt);
		},
		setCylinders(count) {
			cylinders = count;
			graph?.setCylinders(count);
		},
		setVolume(value) {
			level = value;
			if (context && graph) graph.setVolume(value, context.currentTime);
		},
		get volume() {
			return level;
		},
	};
}
