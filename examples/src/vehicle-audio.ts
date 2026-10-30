// Procedural car sound for the vehicle examples, made with the Web Audio API and no audio files:
// an engine whose pitch follows the rpm, tire squeal from filtered noise that follows how far
// the tires slide, wind noise with speed, a thump when the suspension hits its bump stop, and a
// turbo with a compressor whine, intake whoosh and a blow-off valve or compressor flutter on
// lift. Browsers only start audio after a user gesture, so the context resumes on the first key
// press or click.
//
// The engine has several voices. Classic is a pair of soft oscillators. The others are built
// from exhaust pulses, one per cylinder firing, in vehicle-engine-worklet.js: inline four,
// boxer four, inline six, cross-plane and flat-plane V8, V10, V12, rotary, diesel, plus an
// electric whine. Character knobs (pipe size, brightness, rumble, roughness, grit, drive,
// crackle) scale a voice around its own design, so any setting still sounds like an engine.
//
// Every number that shapes the sound lives in VehicleSoundParams. audio.params is read every
// frame, so changing a field changes the sound right away. The examples only let the driver
// pick the engine voice (vehicle-engine-voice.ts); everything else stays at defaultSoundParams.

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
	/** Turbo boost as a fraction of full boost, 0 to 1. Always 0 without a turbo. */
	boost: number;
};

export type SoundWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

// ---------------------------------------------------------------------------
// Engine voices
// ---------------------------------------------------------------------------

/** What the worklet plays: one voice after the character knobs are applied */
export type EngineVoiceConfig = {
	/** [angle in the 720° cycle, pulse strength] per cylinder, in firing order */
	firing: [number, number][];
	/** Pulse rise and decay (ms). Short pulses are bright and tight, long ones soft and blatty. */
	attack: number;
	decay: number;
	/** Combustion noise riding on the pulses, 0 clean */
	noise: number;
	/** Random firing timing (degrees) and strength (fraction) per pulse */
	jitter: number;
	ampJitter: number;
	/** Two exhaust resonances: [Hz, Q, level] */
	formants: [[number, number, number], [number, number, number]];
	/** Level of the raw pulses next to the resonances */
	dry: number;
	/** Muffler low pass (Hz) at zero throttle, and how far it opens at full (1 doubles it) */
	muffler: number;
	mufflerOpen: number;
	/** Saturation */
	drive: number;
	/** Chance that a firing pops off throttle above 2500 rpm */
	crackle: number;
	/** Output level, set so every voice is about as loud as classic at 4000 rpm, part throttle */
	level: number;
	/** Electric only: [order of rpm / 60, level] sines instead of pulses */
	whine?: [number, number][];
};

export type EngineVoice = EngineVoiceConfig & {
	title: string;
	/** Cylinder count, which with the rpm sets the pitch */
	cylinders: number;
};

/** Even firing: n cylinders spaced 720 / n degrees apart, with these pulse strengths */
function evenFiring(gains: number[]): [number, number][] {
	return gains.map((gain, i) => [(i * 720) / gains.length, gain]);
}

export const engineVoices = {
	inline4: {
		title: 'Inline four (buzzy hatchback)',
		cylinders: 4,
		firing: evenFiring([1, 0.94, 1.04, 0.97]),
		attack: 0.25,
		decay: 2.6,
		noise: 0.35,
		jitter: 1.5,
		ampJitter: 0.08,
		formants: [
			[420, 3, 0.8],
			[1300, 4, 0.35],
		],
		dry: 0.3,
		muffler: 1400,
		mufflerOpen: 2.5,
		drive: 1.6,
		crackle: 0.04,
		level: 9.7,
	},
	boxer4: {
		title: 'Boxer four (unequal header rumble)',
		cylinders: 4,
		// Unequal length headers: the pulses from each bank arrive 14° apart from even
		firing: [
			[0, 1],
			[194, 0.86],
			[360, 1],
			[554, 0.86],
		],
		attack: 0.35,
		decay: 3.6,
		noise: 0.32,
		jitter: 2,
		ampJitter: 0.1,
		formants: [
			[260, 2.5, 0.9],
			[820, 3, 0.35],
		],
		dry: 0.3,
		muffler: 1100,
		mufflerOpen: 2.5,
		drive: 1.9,
		crackle: 0.06,
		level: 10.3,
	},
	inline6: {
		title: 'Inline six (smooth)',
		cylinders: 6,
		firing: evenFiring([1, 0.97, 1.02, 0.98, 1.01, 0.96]),
		attack: 0.25,
		decay: 2.4,
		noise: 0.25,
		jitter: 1,
		ampJitter: 0.05,
		formants: [
			[330, 3, 0.8],
			[1050, 3.5, 0.4],
		],
		dry: 0.3,
		muffler: 1600,
		mufflerOpen: 2.5,
		drive: 1.3,
		crackle: 0.03,
		level: 6.8,
	},
	v8: {
		title: 'Cross-plane V8 (muscle burble)',
		cylinders: 8,
		// Firing order 1-8-4-3-6-5-7-2: the banks go L R R L R L L R, so each bank's exhaust
		// pulses are uneven, which is the burble. The right bank is a little quieter here.
		firing: evenFiring([1, 0.72, 0.72, 1, 0.72, 1, 1, 0.72]),
		attack: 0.4,
		decay: 4.5,
		noise: 0.3,
		jitter: 2,
		ampJitter: 0.1,
		formants: [
			[180, 2.5, 0.9],
			[620, 3, 0.35],
		],
		dry: 0.3,
		muffler: 900,
		mufflerOpen: 3,
		drive: 2.2,
		crackle: 0.06,
		level: 7.5,
	},
	flatplaneV8: {
		title: 'Flat-plane V8 (supercar howl)',
		cylinders: 8,
		firing: evenFiring([1, 0.85, 1, 0.85, 1, 0.85, 1, 0.85]),
		attack: 0.2,
		decay: 2.2,
		noise: 0.25,
		jitter: 1,
		ampJitter: 0.06,
		formants: [
			[380, 3, 0.8],
			[1400, 4, 0.4],
		],
		dry: 0.3,
		muffler: 2200,
		mufflerOpen: 2.5,
		drive: 2,
		crackle: 0.05,
		level: 6.2,
	},
	v10: {
		title: 'V10 (high-revving scream)',
		cylinders: 10,
		firing: evenFiring([1, 0.9, 1, 0.9, 1, 0.9, 1, 0.9, 1, 0.9]),
		attack: 0.18,
		decay: 1.8,
		noise: 0.2,
		jitter: 0.8,
		ampJitter: 0.05,
		formants: [
			[450, 3, 0.8],
			[1700, 4, 0.45],
		],
		dry: 0.3,
		muffler: 2600,
		mufflerOpen: 2.5,
		drive: 1.8,
		crackle: 0.04,
		level: 5.8,
	},
	v12: {
		title: 'V12 (silky)',
		cylinders: 12,
		firing: evenFiring([1, 0.95, 1, 0.95, 1, 0.95, 1, 0.95, 1, 0.95, 1, 0.95]),
		attack: 0.16,
		decay: 1.6,
		noise: 0.15,
		jitter: 0.6,
		ampJitter: 0.04,
		formants: [
			[520, 3, 0.7],
			[2000, 4, 0.4],
		],
		dry: 0.3,
		muffler: 3000,
		mufflerOpen: 2,
		drive: 1.3,
		crackle: 0.02,
		level: 5.9,
	},
	rotary: {
		title: 'Rotary (brap)',
		cylinders: 4,
		// Two rotors, each firing once per turn of the eccentric shaft: four long pulses per cycle
		firing: evenFiring([1, 0.95, 1, 0.95]),
		attack: 0.8,
		decay: 7,
		noise: 0.8,
		jitter: 4,
		ampJitter: 0.15,
		formants: [
			[250, 1.5, 0.9],
			[700, 2, 0.5],
		],
		dry: 0.35,
		muffler: 1300,
		mufflerOpen: 3,
		drive: 3,
		crackle: 0.12,
		level: 8.5,
	},
	diesel: {
		title: 'Diesel four (clatter)',
		cylinders: 4,
		// Sharp pressure rise from compression ignition: a hard knock with a bright clatter on top
		firing: evenFiring([1, 0.92, 1.05, 0.95]),
		attack: 0.08,
		decay: 1.4,
		noise: 0.55,
		jitter: 1.5,
		ampJitter: 0.12,
		formants: [
			[160, 2, 0.9],
			[2400, 3, 0.45],
		],
		dry: 0.35,
		muffler: 1800,
		mufflerOpen: 1,
		drive: 1.2,
		crackle: 0,
		level: 4.8,
	},
	electric: {
		title: 'Electric motor (whine)',
		cylinders: 0,
		firing: [],
		attack: 1,
		decay: 1,
		noise: 1,
		jitter: 0,
		ampJitter: 0,
		formants: [
			[1000, 1, 0],
			[1000, 1, 0],
		],
		dry: 0,
		muffler: 8000,
		mufflerOpen: 0,
		drive: 1,
		crackle: 0,
		level: 1.8,
		// The motor's electrical order and the gear mesh above it
		whine: [
			[6, 0.5],
			[12, 0.25],
			[27, 0.12],
			[48, 0.06],
		],
	},
} satisfies Record<string, EngineVoice>;

export type EngineVoiceName = 'classic' | keyof typeof engineVoices;

/** 'auto' picks the voice of the car being driven (setCarVoice) */
export type EngineVoiceChoice = 'auto' | EngineVoiceName;

export type VehicleSoundParams = {
	engine: {
		voice: EngineVoiceChoice;
		/** Engine volume at zero and full throttle */
		idleVolume: number;
		throttleVolume: number;

		// Character, for the pulse voices. 1 is the voice as designed.
		/** Exhaust size: bigger pipes move the resonances down */
		pipeSize: number;
		/** Muffler cutoff */
		brightness: number;
		/** Level of the exhaust resonances */
		rumble: number;
		/** Random variation in the firing */
		roughness: number;
		/** Combustion noise */
		grit: number;
		/** Saturation */
		drive: number;
		/** Overrun pops */
		crackle: number;

		// The classic voice
		/** Pitch relative to the firing frequency (rpm / 60 x cylinders / 2). 2/3 is a fifth lower. */
		pitch: number;
		/** Lowest pitch (Hz), so small speakers still play it */
		minPitch: number;
		/** Main oscillator waveform, from soft (sine) to raspy (sawtooth) */
		wave: SoundWave;
		/** Level of the sine an octave below the main oscillator */
		subLevel: number;
		/** Level of a sawtooth an octave above, for an edgier engine. 0 leaves it out. */
		rasp: number;
		/** Low pass cutoff as a multiple of the pitch, at zero throttle and added at full */
		toneIdle: number;
		toneThrottle: number;
		/** Low pass resonance (Q) */
		resonance: number;
	};
	tires: {
		volume: number;
		/** Band pass center (Hz) while barely sliding, and added at a full slide */
		pitch: number;
		pitchSkid: number;
		/** Band pass Q: higher is a purer, whinier squeal */
		resonance: number;
		/** Speed (m/s) below which tires are silent, and where the squeal reaches full volume */
		minSpeed: number;
		fullSpeed: number;
	};
	turbo: {
		/**
		 * Compressor whistle: air noise through narrow resonant bands at the blade pass frequency
		 * (shaft speed x blades), as a turbo sounds in recordings, breathy rather than a pure tone
		 */
		whineVolume: number;
		/** Whistle pitch (Hz) at full shaft speed */
		whinePitch: number;
		/** Shaft speed at no boost, as a fraction of full: the turbo idles but never stops */
		idleSpin: number;
		/** Width of the whistle band as a fraction of its pitch: wider is airier, narrower purer */
		whineWidth: number;
		/** Level of a pure tone at the whistle pitch, for a more defined note. 0 is all air. */
		whineTone: number;
		/** Level of a quieter band an octave up */
		whineHarmonic: number;
		/** Shaft spin up and spin down times (s). The shaft keeps spinning after a lift. */
		spinUp: number;
		spinDown: number;
		/** Intake air rushing through the compressor, with boost and throttle */
		whooshVolume: number;
		/** What happens on a lift: a blow-off valve hiss, compressor flutter, both or nothing */
		valve: TurboValve;
		/**
		 * Also play the lift sound on a car without a turbo, as if every lift after a second of
		 * full throttle were a lift on full boost
		 */
		liftWithoutTurbo: boolean;
		blowOffVolume: number;
		/** Blow-off hiss pitch (Hz) when the valve opens. It falls as the pressure drops. */
		blowOffPitch: number;
		blowOffResonance: number;
		/** Blow-off length (s) */
		blowOffLength: number;
		/** Boost (0 to 1) needed for a lift to blow off or flutter */
		blowOffMinBoost: number;
		flutterVolume: number;
		/** Flutter chatter rate (Hz) at the start. It slows as the pressure drops. */
		flutterRate: number;
		/** Flutter pitch (Hz) */
		flutterPitch: number;
		/** Flutter length (s) */
		flutterLength: number;
	};
	wind: {
		volume: number;
		/** Speed (m/s) where the wind reaches full volume */
		fullSpeed: number;
		/** Low pass cutoff (Hz) */
		cutoff: number;
	};
	bump: {
		volume: number;
		/** Low pass cutoff (Hz) */
		cutoff: number;
		/** Length (s) */
		length: number;
		/** Suspension compression (0 to 1) that counts as hitting the bump stop */
		threshold: number;
	};
	/** Seconds over which parameters glide, so steps in the simulation do not click */
	smoothing: number;
};

export type TurboValve = 'blowOff' | 'flutter' | 'both' | 'none';

export const defaultSoundParams: VehicleSoundParams = {
	engine: {
		voice: 'auto',
		idleVolume: 0.07,
		throttleVolume: 0.13,
		pipeSize: 1,
		brightness: 1,
		rumble: 1,
		roughness: 1,
		grit: 1,
		drive: 1,
		crackle: 1,
		pitch: 2 / 3,
		minPitch: 40,
		wave: 'triangle',
		subLevel: 0.8,
		rasp: 0,
		toneIdle: 1.2,
		toneThrottle: 1.8,
		resonance: 0.7,
	},
	tires: {
		// The band keeps about 1% of the noise power, hence the large volume
		volume: 1,
		pitch: 1100,
		pitchSkid: 700,
		resonance: 6,
		minSpeed: 1.5,
		fullSpeed: 8,
	},
	turbo: {
		whineVolume: 0.018,
		whinePitch: 4200,
		idleSpin: 0.2,
		whineWidth: 0.04,
		whineTone: 0.08,
		whineHarmonic: 0.25,
		spinUp: 0.15,
		spinDown: 1.4,
		whooshVolume: 0.05,
		valve: 'blowOff',
		liftWithoutTurbo: false,
		blowOffVolume: 0.5,
		blowOffPitch: 3200,
		blowOffResonance: 1.2,
		blowOffLength: 0.45,
		blowOffMinBoost: 0.3,
		flutterVolume: 1.2,
		flutterRate: 20,
		flutterPitch: 800,
		flutterLength: 0.6,
	},
	wind: { volume: 0.6, fullSpeed: 70, cutoff: 500 },
	bump: { volume: 0.9, cutoff: 180, length: 0.22, threshold: 0.95 },
	smoothing: 0.05,
};

/** A deep copy of the defaults, or of the given params */
export function cloneSoundParams(
	params: VehicleSoundParams = defaultSoundParams,
): VehicleSoundParams {
	return structuredClone(params);
}

/** A voice with the character knobs applied */
function voiceConfig(
	voice: EngineVoice,
	p: VehicleSoundParams['engine'],
): EngineVoiceConfig {
	const pipe = Math.max(p.pipeSize, 0.1);
	return {
		firing: voice.firing,
		attack: voice.attack,
		decay: voice.decay,
		noise: voice.noise * p.grit,
		jitter: voice.jitter * p.roughness,
		ampJitter: Math.min(voice.ampJitter * p.roughness, 0.9),
		formants: [
			[
				voice.formants[0][0] / pipe,
				voice.formants[0][1],
				voice.formants[0][2] * p.rumble,
			],
			[
				voice.formants[1][0] / pipe,
				voice.formants[1][1],
				voice.formants[1][2] * p.rumble,
			],
		],
		dry: voice.dry,
		muffler: voice.muffler * p.brightness,
		mufflerOpen: voice.mufflerOpen,
		drive: voice.drive * p.drive,
		crackle: Math.min(voice.crackle * p.crackle, 1),
		level: voice.level,
		whine: voice.whine,
	};
}

// ---------------------------------------------------------------------------
// Audio graph
// ---------------------------------------------------------------------------

export type VehicleAudio = {
	/** Call once per frame */
	update(sound: VehicleSound, dt: number): void;
	/** Firing pulses per crankshaft turn are cylinders / 2, which sets the classic voice's pitch */
	setCylinders(cylinders: number): void;
	readonly cylinders: number;
	/** The voice 'auto' plays: the car's own engine */
	setCarVoice(voice: EngineVoiceName): void;
	/** The voice playing now, after resolving 'auto' */
	readonly voice: EngineVoiceName;
	setVolume(volume: number): void;
	/** 0 to 1, as last set */
	readonly volume: number;
	/** Live sound settings, read every frame */
	params: VehicleSoundParams;
	/** Plays the blow-off hiss, the compressor flutter or the bump stop thump now, strength 0 to 1 */
	blowOff(strength?: number): void;
	flutter(strength?: number): void;
	/** Plays what params.turbo.valve says happens on a lift: blow-off, flutter, both or nothing */
	lift(strength?: number): void;
	thump(strength?: number): void;
	/** The master output, once audio has started. Connect an AnalyserNode here to see it. */
	readonly output: GainNode | null;
};

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
	const buffer = context.createBuffer(
		1,
		Math.floor(context.sampleRate * seconds),
		context.sampleRate,
	);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

function loopedNoise(context: AudioContext, buffer: AudioBuffer) {
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.loop = true;
	source.start();
	return source;
}

/** Gains that bring the narrow noise bands of the turbo whistle to about the level of a sine */
const WHISTLE_AIR = 17.5;
const WHISTLE_HARMONIC = 8.7;

const workletUrl = new URL('./vehicle-engine-worklet.js', import.meta.url);

export function createVehicleAudio(
	volume = 0.5,
	params: VehicleSoundParams = cloneSoundParams(),
): VehicleAudio {
	let context: AudioContext | null = null;
	let cylinders = 6;
	let carVoice: EngineVoiceName = 'classic';
	let playing: EngineVoiceName = 'classic';
	let level = volume;

	// Built on first use, inside the gesture that unlocks audio
	let nodes: ReturnType<typeof build> | null = null;
	// The pulse voices, once the worklet module has loaded. Classic plays until then.
	let pulses: AudioWorkletNode | null = null;
	let pulsesKey = '';

	function build(ctx: AudioContext) {
		const master = ctx.createGain();
		master.gain.value = level;
		master.connect(ctx.destination);

		// Both engine voices meet in engineGain, which sets the engine volume
		const engineGain = ctx.createGain();
		engineGain.gain.value = 0;
		engineGain.connect(master);

		// Classic: a triangle below the firing frequency over a sine an octave under it, through a
		// gentle low pass that opens a little with the throttle. An optional sawtooth an octave up
		// adds rasp.
		const classicGain = ctx.createGain();
		classicGain.connect(engineGain);
		const engineTone = ctx.createBiquadFilter();
		engineTone.type = 'lowpass';
		engineTone.connect(classicGain);
		const engine = ctx.createOscillator();
		const engineSub = ctx.createOscillator();
		engineSub.type = 'sine';
		const engineSubGain = ctx.createGain();
		const engineRasp = ctx.createOscillator();
		engineRasp.type = 'sawtooth';
		const engineRaspGain = ctx.createGain();
		engineRaspGain.gain.value = 0;
		engine.connect(engineTone);
		engineSub.connect(engineSubGain).connect(engineTone);
		engineRasp.connect(engineRaspGain).connect(engineTone);
		engine.start();
		engineSub.start();
		engineRasp.start();

		// Pulse voices: the worklet joins here when it has loaded
		const pulseGain = ctx.createGain();
		pulseGain.gain.value = 0;
		pulseGain.connect(engineGain);
		ctx.audioWorklet
			.addModule(workletUrl)
			.then(() => {
				pulses = new AudioWorkletNode(ctx, 'vehicle-engine', {
					numberOfInputs: 0,
					outputChannelCount: [1],
				});
				pulses.connect(pulseGain);
			})
			.catch((error) =>
				console.warn('Engine voices unavailable, using classic', error),
			);

		const noise = noiseBuffer(ctx, 2);

		// Tire squeal: noise through a resonant band pass around 1-2 kHz
		const squealFilter = ctx.createBiquadFilter();
		squealFilter.type = 'bandpass';
		const squealGain = ctx.createGain();
		squealGain.gain.value = 0;
		loopedNoise(ctx, noise)
			.connect(squealFilter)
			.connect(squealGain)
			.connect(master);

		// Wind: low passed noise that rises with speed
		const windFilter = ctx.createBiquadFilter();
		windFilter.type = 'lowpass';
		const windGain = ctx.createGain();
		windGain.gain.value = 0;
		loopedNoise(ctx, noise)
			.connect(windFilter)
			.connect(windGain)
			.connect(master);

		// Turbo whistle: noise through two narrow band passes in a row at the blade pass
		// frequency, a quieter band an octave up, and a trace of pure tone for definition
		const whineGain = ctx.createGain();
		whineGain.gain.value = 0;
		whineGain.connect(master);
		const whistleBand = ctx.createBiquadFilter();
		whistleBand.type = 'bandpass';
		const whistleBand2 = ctx.createBiquadFilter();
		whistleBand2.type = 'bandpass';
		const whistleAir = ctx.createGain();
		loopedNoise(ctx, noise)
			.connect(whistleBand)
			.connect(whistleBand2)
			.connect(whistleAir)
			.connect(whineGain);
		const harmonicBand = ctx.createBiquadFilter();
		harmonicBand.type = 'bandpass';
		const harmonicGain = ctx.createGain();
		loopedNoise(ctx, noise)
			.connect(harmonicBand)
			.connect(harmonicGain)
			.connect(whineGain);
		const whistleTone = ctx.createOscillator();
		whistleTone.type = 'sine';
		const whistleToneGain = ctx.createGain();
		whistleTone.connect(whistleToneGain).connect(whineGain);
		whistleTone.start();

		// Turbo whoosh: air through the compressor, noise in a wide band that rises with the shaft
		const whooshFilter = ctx.createBiquadFilter();
		whooshFilter.type = 'bandpass';
		whooshFilter.Q.value = 0.9;
		const whooshGain = ctx.createGain();
		whooshGain.gain.value = 0;
		loopedNoise(ctx, noise)
			.connect(whooshFilter)
			.connect(whooshGain)
			.connect(master);

		const built = {
			master,
			engineGain,
			classicGain,
			engine,
			engineSub,
			engineSubGain,
			engineRasp,
			engineRaspGain,
			engineTone,
			pulseGain,
			squealFilter,
			squealGain,
			windFilter,
			windGain,
			whineGain,
			whistleBand,
			whistleBand2,
			whistleAir,
			harmonicBand,
			harmonicGain,
			whistleTone,
			whistleToneGain,
			whooshFilter,
			whooshGain,
			// Long enough for the longest one-shot the panel allows
			oneShotBuffer: noiseBuffer(ctx, 1.5),
		};
		applyStatic(built);
		return built;
	}

	// Settings that are not smoothed: waveforms and filter shapes
	function applyStatic(n: NonNullable<typeof nodes>) {
		if (n.engine.type !== params.engine.wave)
			n.engine.type = params.engine.wave;
		n.engineTone.Q.value = params.engine.resonance;
		n.squealFilter.Q.value = params.tires.resonance;
	}

	function unlock() {
		if (!context) {
			context = new AudioContext();
			nodes = build(context);
		}
		if (context.state === 'suspended') void context.resume();
	}
	window.addEventListener('keydown', unlock);
	window.addEventListener('pointerdown', unlock);
	// A touch only counts as a user gesture for audio once the finger lifts
	window.addEventListener('pointerup', unlock);
	// A touch only counts as a user gesture for audio once the finger lifts
	window.addEventListener('pointerup', unlock);

	function resolveVoice(): EngineVoiceName {
		const choice =
			params.engine.voice === 'auto' ? carVoice : params.engine.voice;
		return choice === 'classic' || choice in engineVoices ? choice : 'classic';
	}

	// Sends the voice to the worklet when it or a character knob changes
	function syncPulses(name: EngineVoiceName) {
		if (!pulses) return;
		const config =
			name === 'classic'
				? null
				: voiceConfig(engineVoices[name], params.engine);
		const key = JSON.stringify(config);
		if (key === pulsesKey) return;
		pulsesKey = key;
		pulses.port.postMessage(config);
	}

	// A burst of noise through a filter, rising over attack seconds and fading out by length
	function oneShot(
		type: BiquadFilterType,
		frequency: number,
		q: number,
		peak: number,
		length: number,
		attack = 0,
		endFrequency = frequency,
	) {
		if (!context || !nodes || peak <= 0) return;
		const source = context.createBufferSource();
		source.buffer = nodes.oneShotBuffer;
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.Q.value = q;
		const gain = context.createGain();
		const t = context.currentTime;
		const end = t + Math.min(Math.max(length, 0.02), 1.4);
		filter.frequency.setValueAtTime(frequency, t);
		if (endFrequency !== frequency)
			filter.frequency.exponentialRampToValueAtTime(endFrequency, end);
		if (attack > 0) {
			gain.gain.setValueAtTime(0.001, t);
			gain.gain.exponentialRampToValueAtTime(peak, t + attack);
		} else gain.gain.setValueAtTime(peak, t);
		gain.gain.exponentialRampToValueAtTime(0.001, end);
		source.connect(filter).connect(gain).connect(nodes.master);
		source.start(t);
		source.stop(end + 0.05);
	}

	function thump(strength = 1) {
		const p = params.bump;
		oneShot('lowpass', p.cutoff, 1, p.volume * strength, p.length);
	}

	// Blow-off valve: the valve pops open with a short low chuff, then the trapped charge air
	// hisses out, falling in pitch as the pressure drops
	function blowOff(strength = 1) {
		const p = params.turbo;
		const peak = p.blowOffVolume * strength;
		oneShot('lowpass', 260, 1, peak * 0.6, 0.07);
		oneShot(
			'bandpass',
			p.blowOffPitch,
			p.blowOffResonance,
			peak,
			p.blowOffLength,
			0.015,
			p.blowOffPitch * 0.35,
		);
	}

	// Compressor flutter: with no valve, the charge air pushes back through the compressor
	// wheel in bursts, a "stu-tu-tu" chatter that slows and fades as the pressure drops
	function flutter(strength = 1) {
		if (!context || !nodes) return;
		const p = params.turbo;
		const peak = p.flutterVolume * strength;
		if (peak <= 0) return;
		const source = context.createBufferSource();
		source.buffer = nodes.oneShotBuffer;
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = p.flutterPitch;
		filter.Q.value = 1.4;
		const gain = context.createGain();
		const t0 = context.currentTime;
		const length = Math.min(Math.max(p.flutterLength, 0.05), 1.4);
		gain.gain.setValueAtTime(0, t0);
		let t = t0;
		while (t < t0 + length) {
			const progress = (t - t0) / length;
			const period = 1 / (Math.max(p.flutterRate, 2) * (1 - 0.45 * progress));
			const amp = peak * (1 - progress) ** 1.5;
			gain.gain.linearRampToValueAtTime(amp, t + period * 0.25);
			gain.gain.linearRampToValueAtTime(0, t + period * 0.8);
			gain.gain.setValueAtTime(0, t + period);
			t += period;
		}
		source.connect(filter).connect(gain).connect(nodes.master);
		source.start(t0);
		source.stop(t + 0.05);
	}

	let lastCompression = 0;
	let thumpCooldown = 0;
	let lastThrottle = 0;
	let liftCooldown = 0;
	// Seconds of throttle since the last lift, which stands in for boost with liftWithoutTurbo
	let throttleHeld = 0;

	function lift(strength = 1) {
		const { valve } = params.turbo;
		if (valve === 'blowOff' || valve === 'both') blowOff(strength);
		if (valve === 'flutter' || valve === 'both') flutter(strength);
	}
	// Turbo shaft speed, 0 to 1: follows the boost up quickly and coasts down slowly
	let shaftSpeed = 0;

	return {
		update(sound, dt) {
			if (!context || !nodes || context.state !== 'running') return;
			applyStatic(nodes);
			const t = context.currentTime;
			const glide = Math.max(params.smoothing, 0.001);
			const { engine, tires, turbo, wind, bump } = params;

			// ---- Engine
			playing = resolveVoice();
			const classic = playing === 'classic' || !pulses;
			syncPulses(classic ? 'classic' : playing);
			nodes.classicGain.gain.setTargetAtTime(classic ? 1 : 0, t, 0.03);
			nodes.pulseGain.gain.setTargetAtTime(classic ? 0 : 1, t, 0.03);
			nodes.engineGain.gain.setTargetAtTime(
				engine.idleVolume + engine.throttleVolume * sound.throttle,
				t,
				glide,
			);
			if (pulses) {
				const rpm = Math.max(sound.engineRpm, 300);
				pulses.parameters.get('rpm')?.setTargetAtTime(rpm, t, glide);
				pulses.parameters
					.get('throttle')
					?.setTargetAtTime(sound.throttle, t, glide);
			}
			const firing = (Math.max(sound.engineRpm, 300) / 60) * (cylinders / 2);
			const pitch = Math.max(firing * engine.pitch, engine.minPitch);
			nodes.engine.frequency.setTargetAtTime(pitch, t, glide);
			nodes.engineSub.frequency.setTargetAtTime(pitch / 2, t, glide);
			nodes.engineRasp.frequency.setTargetAtTime(pitch * 2, t, glide);
			nodes.engineSubGain.gain.setTargetAtTime(engine.subLevel, t, glide);
			nodes.engineRaspGain.gain.setTargetAtTime(engine.rasp, t, glide);
			nodes.engineTone.frequency.setTargetAtTime(
				pitch * (engine.toneIdle + engine.toneThrottle * sound.throttle),
				t,
				glide,
			);

			// ---- Tires and wind
			const speed = Math.abs(sound.speed);
			const squeal =
				speed > tires.minSpeed
					? sound.skid * Math.min(speed / Math.max(tires.fullSpeed, 0.1), 1)
					: 0;
			nodes.squealGain.gain.setTargetAtTime(tires.volume * squeal, t, glide);
			nodes.squealFilter.frequency.setTargetAtTime(
				tires.pitch + tires.pitchSkid * sound.skid,
				t,
				glide,
			);
			nodes.windFilter.frequency.setTargetAtTime(wind.cutoff, t, glide);
			nodes.windGain.gain.setTargetAtTime(
				Math.min((speed / Math.max(wind.fullSpeed, 1)) ** 2, 1) * wind.volume,
				t,
				0.2,
			);

			thumpCooldown = Math.max(thumpCooldown - dt, 0);
			if (
				sound.compression > bump.threshold &&
				lastCompression < bump.threshold - 0.1 &&
				thumpCooldown === 0
			) {
				thump(Math.min(0.4 + speed / 30, 1));
				thumpCooldown = 0.25;
			}
			lastCompression = sound.compression;

			// ---- Turbo
			const spinTime = sound.boost > shaftSpeed ? turbo.spinUp : turbo.spinDown;
			shaftSpeed +=
				(sound.boost - shaftSpeed) * Math.min(dt / Math.max(spinTime, 0.01), 1);
			const spin = turbo.idleSpin + (1 - turbo.idleSpin) * shaftSpeed;
			// The airflow wavers a little, so the pitch drifts by about 1%
			const drift = 1 + 0.007 * Math.sin(t * 2.3) + 0.004 * Math.sin(t * 5.7);
			const bladePass = turbo.whinePitch * spin * drift;
			// A narrower band passes less noise power: make it up so width does not change volume
			const q = 1 / Math.max(turbo.whineWidth, 0.005);
			nodes.whistleBand.frequency.setTargetAtTime(bladePass, t, glide);
			nodes.whistleBand2.frequency.setTargetAtTime(bladePass, t, glide);
			nodes.whistleBand.Q.setTargetAtTime(q, t, glide);
			nodes.whistleBand2.Q.setTargetAtTime(q, t, glide);
			nodes.whistleAir.gain.setTargetAtTime(
				WHISTLE_AIR * Math.sqrt(q / 25),
				t,
				glide,
			);
			nodes.harmonicBand.frequency.setTargetAtTime(bladePass * 2, t, glide);
			nodes.harmonicBand.Q.setTargetAtTime(q, t, glide);
			nodes.harmonicGain.gain.setTargetAtTime(
				turbo.whineHarmonic * WHISTLE_HARMONIC * Math.sqrt(q / 25),
				t,
				glide,
			);
			nodes.whistleTone.frequency.setTargetAtTime(bladePass, t, glide);
			nodes.whistleToneGain.gain.setTargetAtTime(turbo.whineTone, t, glide);
			// The whistle follows the shaft, so it keeps singing as the turbo coasts down after a
			// lift, and it is loudest while air is flowing on throttle
			nodes.whineGain.gain.setTargetAtTime(
				turbo.whineVolume * shaftSpeed ** 1.5 * (0.35 + 0.65 * sound.throttle),
				t,
				glide,
			);
			nodes.whooshFilter.frequency.setTargetAtTime(600 + 3400 * spin, t, glide);
			nodes.whooshGain.gain.setTargetAtTime(
				turbo.whooshVolume * sound.boost * sound.throttle,
				t,
				glide,
			);

			liftCooldown = Math.max(liftCooldown - dt, 0);
			if (sound.throttle > 0.5) throttleHeld += dt;
			const charge =
				sound.boost > 0 || !turbo.liftWithoutTurbo
					? sound.boost
					: Math.min(throttleHeld, 1);
			if (
				lastThrottle > 0.5 &&
				sound.throttle < 0.1 &&
				charge > turbo.blowOffMinBoost &&
				liftCooldown === 0
			) {
				lift(charge);
				liftCooldown = 0.3;
			}
			if (sound.throttle < 0.1) throttleHeld = 0;
			lastThrottle = sound.throttle;
		},
		setCylinders(count) {
			cylinders = count;
		},
		get cylinders() {
			return cylinders;
		},
		setCarVoice(voice) {
			carVoice = voice;
		},
		get voice() {
			return playing;
		},
		setVolume(value) {
			level = value;
			if (context && nodes)
				nodes.master.gain.setTargetAtTime(value, context.currentTime, 0.05);
		},
		get volume() {
			return level;
		},
		params,
		blowOff,
		flutter,
		lift,
		thump,
		get output() {
			return nodes?.master ?? null;
		},
	};
}
