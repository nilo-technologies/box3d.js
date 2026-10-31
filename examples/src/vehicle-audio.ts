// Procedural car sound for the vehicle examples, made with the Web Audio API and no audio files:
// an engine whose pitch follows the rpm, tire squeal from filtered noise that follows how far
// the tires slide, wind noise with speed, a thump when the suspension hits its bump stop, and a
// turbo with a compressor whine, intake whoosh and a blow-off valve or compressor flutter on
// lift. The lift sounds only play when a real car would make them (see "Lift sounds" below).
// Browsers only start audio after a user gesture, so the context resumes on the first key
// press or click.
//
// The engine has several voices. Classic is a pair of soft oscillators. The others are built
// from exhaust pulses, one per cylinder firing, in vehicle-engine-worklet.js: inline four,
// boxer four, inline six, cross-plane and flat-plane V8, V10, V12, rotary, diesel, plus an
// electric whine. The pulses run through a model of each voice's exhaust pipes (its headers,
// collector, muffler and tailpipe, one system per bank on a V), and an intake layer adds
// induction roar. Character knobs (pipe size, brightness, rumble, roughness, grit, drive,
// crackle, intake) scale a voice around its own design, so any setting still sounds like an
// engine.
//
// Everything is heard from a listener position (listenerPositions): outside behind the car with
// the ground and nearby walls reflecting, or in the cabin, where the body dulls the highs and
// booms in the lows. Dry plays it as synthesized.
//
// Every number that shapes the sound lives in VehicleSoundParams. audio.params is read every
// frame, so changing a field changes the sound right away. The driving examples only let the
// driver pick the engine voice (vehicle-engine-voice.ts); everything else stays at
// defaultSoundParams. The sound lab (example-vehicle-sound.ts, vehicle-sound-panel.ts) tunes all
// of it without a car.

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
	/**
	 * The boost comes from a belt driven supercharger. Its bypass valve recirculates the charge
	 * quietly on a lift, so there is no blow-off or flutter.
	 */
	supercharged?: boolean;
};

export type SoundWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

// ---------------------------------------------------------------------------
// Engine voices
// ---------------------------------------------------------------------------

/** What the worklet plays: one voice after the character knobs are applied */
export type EngineVoiceConfig = {
	/** [angle in the cycle, pulse strength] per cylinder, in firing order */
	firing: [number, number][];
	/** Length of the firing cycle in shaft degrees: 720 for a four-stroke, 1080 for a rotary */
	cycle?: number;
	/**
	 * Idle bursts: how fast exhaust builds up in the chambers at idle, per firing. The burns weaken
	 * as it does, until one fails to light and bangs in the exhaust, about every 1 / misfire firings.
	 */
	misfire?: number;
	/** The uneven idle's style, for a voice with misfire */
	brap?: BrapStyle;
	/**
	 * For the lope: how much weaker each firing burns at idle, in firing order, 0 to 1. Without
	 * misfire it is a big cam's lope, at idle only.
	 */
	lope?: number[];
	/** How much of the high-rev dip around 3.2 kHz the voice takes, 1 all of it */
	presence?: number;
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
	/** Chance that a firing pops during an overrun crackle burst, at full strength */
	crackle: number;
	/** Output level, set so every voice is about as loud as classic at 4000 rpm, part throttle */
	level: number;
	/** Electric only: [order of rpm / 60, level] sines instead of pulses */
	whine?: [number, number][];
	/** The exhaust the pulses go through: the pipes, or the two resonances above */
	exhaust?: EngineExhaust;
	/** The exhaust system the pipes model plays. The electric voice has none. */
	pipes?: EnginePipes;
	/** Intake roar: the plenum's resonance (Hz) and the level, 0 for none */
	intake?: { hz: number; level: number };
	/** How the listener hears it: the intake's level and how far apart the tailpipes sit (0 to 1) */
	mix?: { intake: number; width: number };
	/** How the sound is built, beyond the basic pulses and pipes. Leave out for none of it. */
	build?: EngineBuild;
};

export type EngineExhaust = 'pipes' | 'resonances';

/** Build options for a voice, see vehicle-engine-worklet.js. Each is off when left out. */
export type EngineBuild = {
	/** Pulses that swell in as the valve opens, then leave a scavenging suction dip */
	blowdown?: boolean;
	/** How much a bank's back pressure weakens a pulse that closely follows the last one */
	interference?: number;
	/** How far each cylinder's strength wanders, slowly, from cycle to cycle */
	drift?: number;
	/** The share of each bank's exhaust that crosses to the other bank (an H or X pipe) */
	crossover?: number;
	/** A chambered muffler's chamber length (m) */
	chamber?: number;
	/** A 4-2-1 header's secondary pipe length (m): alternate firings' runners pair up */
	secondary?: number;
	/** Level of the intake tract's honk: the suction pulses ringing a pipe, not rushing air */
	honk?: number;
	/** Rpm where a high lift cam takes over, with sharper, stronger pulses and more intake */
	cam?: number;
};

/** How an engine with misfire (the rotary) idles, see vehicle-engine-worklet.js */
export type BrapStyle = 'even' | 'lope' | 'bursts' | 'skips' | 'mixed';

export const brapStyles: Record<BrapStyle, string> = {
	even: 'Even (no brap)',
	lope: 'Regular lope, every 3 turns',
	bursts: 'Bursts: weakening, then a whump',
	skips: 'Skipped firings',
	mixed: 'Lope with the odd skip',
};

/**
 * An exhaust system for the pipes model. Each bank is a system of its own: header runners into
 * a collector, a mid pipe to the muffler and a tailpipe. Lengths set the resonances: a 0.6 m
 * runner, closed by the valve at one end, rings near 200 Hz in hot gas.
 */
export type EnginePipes = {
	/** Header runners: [length (m), bank], one per exhaust port */
	runners: [number, number][];
	/** The runner each firing breathes out of, in firing order. Leave out for one per firing. */
	port?: number[];
	/** Mid pipe from the collector to the muffler, and the tailpipe after it (m) */
	mid: number;
	tail: number;
	/** How much of a wave reflects off the closed valves, the muffler and the open tailpipe end */
	valve: number;
	reflect: number;
	open: number;
	/** Output level relative to `level`, so both exhausts are about as loud */
	level: number;
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

/** Header runners of one length, on the bank given per firing (all on bank 0 if left out) */
function headers(
	count: number,
	length: number,
	banks: number[] = [],
): [number, number][] {
	return Array.from({ length: count }, (_, i) => [length, banks[i] ?? 0]);
}

/** A flat-plane V8, V10 or V12 fires its banks in turn */
const alternate = (count: number) =>
	Array.from({ length: count }, (_, i) => i % 2);

export const engineVoices = {
	inline4: {
		title: 'Inline four (buzzy hatchback)',
		cylinders: 4,
		firing: evenFiring([1, 0.94, 1.04, 0.97]),
		// Rounded blowdown pulses, cylinders that wander slowly, a 4-2-1 header, a chambered
		// muffler, an intake that honks, and a high lift cam from 5600 rpm
		build: {
			blowdown: true,
			drift: 0.15,
			secondary: 0.4,
			chamber: 0.3,
			honk: 1,
			cam: 5600,
		},
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
		level: 12.5,
		// Four short equal headers, paired by the build's 4-2-1 secondaries into one collector
		pipes: {
			runners: headers(4, 0.55),
			mid: 1.6,
			tail: 0.5,
			valve: 0.85,
			reflect: 0.5,
			open: 0.8,
			level: 0.35,
		},
		intake: { hz: 230, level: 0.46 },
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
		level: 16.4,
		// Unequal length headers, short on one bank and long on the other, into one collector
		pipes: {
			runners: [
				[0.45, 0],
				[0.45, 0],
				[0.95, 0],
				[0.95, 0],
			],
			mid: 1.8,
			tail: 0.55,
			valve: 0.85,
			reflect: 0.55,
			open: 0.8,
			level: 0.32,
		},
		intake: { hz: 200, level: 0.68 },
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
		level: 11.2,
		// Six long equal headers into one collector
		pipes: {
			runners: headers(6, 0.7),
			mid: 2,
			tail: 0.6,
			valve: 0.85,
			reflect: 0.5,
			open: 0.8,
			level: 0.4,
		},
		intake: { hz: 260, level: 0.72 },
	},
	v8: {
		title: 'Cross-plane V8 (muscle burble)',
		cylinders: 8,
		// Firing order 1-8-4-3-6-5-7-2: the banks go L R R L R L L R, so each bank's exhaust
		// pulses are uneven, which is the burble. The right bank is a little quieter here.
		firing: evenFiring([1, 0.72, 0.72, 1, 0.72, 1, 1, 0.72]),
		// A big cam: at idle the long valve overlap leaves some cylinders a diluted charge, a
		// lumpy idle that swells and sags once every two turns
		lope: [0, 0.08, 0.25, 0.45, 0.55, 0.4, 0.2, 0.05],
		// Rounded blowdown pulses, each bank's uneven gaps fighting its manifold's back pressure,
		// cylinders that wander slowly, a crossover between the banks and a chambered muffler
		build: {
			blowdown: true,
			interference: 0.25,
			drift: 0.15,
			crossover: 0.3,
			chamber: 0.35,
		},
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
		level: 15.8,
		// A system per bank, so each bank's uneven pulses come out of its own tailpipe
		pipes: {
			runners: headers(8, 0.6, [0, 1, 1, 0, 1, 0, 0, 1]),
			mid: 1.8,
			tail: 0.5,
			valve: 0.85,
			reflect: 0.55,
			open: 0.85,
			level: 0.27,
		},
		intake: { hz: 150, level: 0.38 },
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
		level: 9.4,
		// A system per bank: each bank fires evenly, every 180°
		pipes: {
			runners: headers(8, 0.45, alternate(8)),
			mid: 1.5,
			tail: 0.45,
			valve: 0.85,
			reflect: 0.45,
			open: 0.8,
			level: 0.48,
		},
		intake: { hz: 300, level: 0.41 },
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
		level: 8.7,
		pipes: {
			runners: headers(10, 0.42, alternate(10)),
			mid: 1.5,
			tail: 0.4,
			valve: 0.85,
			reflect: 0.45,
			open: 0.8,
			level: 0.47,
		},
		intake: { hz: 330, level: 0.43 },
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
		level: 9.0,
		pipes: {
			runners: headers(12, 0.5, alternate(12)),
			mid: 1.7,
			tail: 0.45,
			valve: 0.85,
			reflect: 0.5,
			open: 0.8,
			level: 0.37,
		},
		intake: { hz: 360, level: 0.31 },
	},
	rotary: {
		title: 'Rotary (brap)',
		cylinders: 4,
		// Two rotors, each with three faces. A face fires once per turn of the rotor, which is three
		// turns of the shaft, so the cycle is 1080° and the rotors take turns every 180°. The faces
		// differ a little, which repeats every three turns: a growl under the note.
		cycle: 1080,
		firing: [
			[0, 1],
			[180, 0.95],
			[360, 0.82],
			[540, 1.06],
			[720, 1.12],
			[900, 0.86],
		],
		// The apex seal uncovers the peripheral exhaust port quickly, so a pulse starts firmly, and
		// the port stays open long, so it is fat
		attack: 0.35,
		decay: 5.5,
		noise: 0.6,
		jitter: 3,
		ampJitter: 0.12,
		// At idle the port overlap leaves exhaust in the chambers, until a charge fails to light
		// every six firings or so: the brap-brap
		misfire: 0.16,
		// The regular lope: strong at the start of each 1080° cycle and weaker over its faces, so
		// the idle goes brap once every three turns of the shaft
		lope: [0, 0.05, 0.3, 0.55, 0.75, 0.6],
		formants: [
			[250, 1.5, 0.9],
			[700, 2, 0.5],
		],
		dry: 0.35,
		muffler: 1400,
		mufflerOpen: 3,
		// Less saturation than the pistons: the exhaust is loud already, and more clips at high revs
		drive: 1.3,
		crackle: 0.15,
		// Flat out it screams: half the high-rev dip the others take
		presence: 0.5,
		level: 6.8,
		// Short ports, one per rotor, which no valve closes, into a free flowing exhaust
		pipes: {
			runners: headers(2, 0.3),
			port: [0, 1, 0, 1, 0, 1],
			mid: 1.3,
			tail: 0.45,
			valve: 0.5,
			reflect: 0.3,
			open: 0.75,
			level: 0.3,
		},
		intake: { hz: 280, level: 0.48 },
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
		level: 8.4,
		pipes: {
			runners: headers(4, 0.5),
			mid: 2.2,
			tail: 0.6,
			valve: 0.85,
			reflect: 0.55,
			open: 0.8,
			level: 0.36,
		},
		intake: { hz: 180, level: 0.54 },
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
		/** Rpm a lift has to come from for the exhaust to pop, and below which pops stop */
		crackleMinRpm: number;
		/** Chance that a lift after a hard pull pops at all, 0 to 1 */
		crackleChance: number;
		/** Length (s) of a crackle burst after a lift from a fully hot exhaust */
		crackleLength: number;
		/** The exhaust: 'pipes', a model of the pipes, or 'resonances', the older two resonances */
		exhaust: EngineExhaust;
		/** Intake roar, 1 as designed, 0 for none */
		intake: number;
		/** How a voice with an uneven idle (the rotary) idles */
		brap: BrapStyle;

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
		 * Also play the lift sound on a car without a turbo or with a supercharger, as if a second
		 * of full throttle built full boost. The hold, snap and cooldown rules still apply.
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
		/** Seconds the boost has to stay above blowOffMinBoost before the lift, so a tap is quiet */
		blowOffHold: number;
		/** Seconds after a blow-off or flutter before the next can play */
		blowOffCooldown: number;
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
	listener: {
		/** Where the sound is heard from, see listenerPositions */
		position: ListenerPosition;
		/** Level of the room's reflections, 1 as designed */
		room: number;
	};
	/** Seconds over which parameters glide, so steps in the simulation do not click */
	smoothing: number;
};

export type TurboValve = 'blowOff' | 'flutter' | 'both' | 'none';

export type ListenerPosition = 'dry' | 'exterior' | 'cabin';

/**
 * How each listener hears the car. intake and width shape the engine (the intake's level and how
 * far apart the tailpipes sit); lowpass (Hz) and boom (dB at 55 Hz) filter everything, as the
 * body of the car would; room is the level of the reflections, and level evens out what the room
 * and the boom add, so every position is about as loud.
 */
export const listenerPositions: Record<
	ListenerPosition,
	{
		title: string;
		intake: number;
		width: number;
		lowpass: number;
		boom: number;
		room: number;
		level: number;
	}
> = {
	dry: {
		title: 'Dry (no room)',
		intake: 1,
		width: 0.3,
		lowpass: 20000,
		boom: 0,
		room: 0,
		level: 1,
	},
	// Behind the car: the tailpipes either side, the intake at the far end, the ground and some
	// walls reflecting
	exterior: {
		title: 'Outside, behind the car',
		intake: 0.45,
		width: 0.4,
		lowpass: 16000,
		boom: 0,
		room: 0.35,
		level: 0.94,
	},
	// The driver's seat: the body blocks the highs and booms in the lows, the intake comes
	// through the bulkhead, and a small, close room
	cabin: {
		title: 'In the cabin',
		intake: 1.5,
		width: 0.2,
		lowpass: 1100,
		boom: 6,
		room: 0.4,
		level: 0.75,
	},
};

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
		crackleMinRpm: 3500,
		crackleChance: 0.6,
		crackleLength: 1.2,
		exhaust: 'pipes',
		intake: 1,
		brap: 'lope',
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
		whineVolume: 0.012,
		whinePitch: 4200,
		idleSpin: 0.2,
		whineWidth: 0.04,
		whineTone: 0.05,
		whineHarmonic: 0.12,
		spinUp: 0.15,
		spinDown: 1.4,
		whooshVolume: 0.05,
		valve: 'blowOff',
		liftWithoutTurbo: false,
		blowOffVolume: 0.5,
		blowOffPitch: 3200,
		blowOffResonance: 1.2,
		blowOffLength: 0.45,
		blowOffMinBoost: 0.4,
		blowOffHold: 0.4,
		blowOffCooldown: 1,
		flutterVolume: 1.2,
		flutterRate: 20,
		flutterPitch: 800,
		flutterLength: 0.6,
	},
	wind: { volume: 0.6, fullSpeed: 70, cutoff: 500 },
	bump: { volume: 0.9, cutoff: 180, length: 0.22, threshold: 0.95 },
	listener: { position: 'exterior', room: 1 },
	smoothing: 0.05,
};

/** A deep copy of the defaults, or of the given params */
export function cloneSoundParams(
	params: VehicleSoundParams = defaultSoundParams,
): VehicleSoundParams {
	return structuredClone(params);
}

/**
 * Copies every known field of a partial params object (for example parsed JSON) onto target,
 * ignoring unknown keys and values of the wrong type
 */
export function assignSoundParams(
	target: VehicleSoundParams,
	source: unknown,
): void {
	if (!source || typeof source !== 'object') return;
	const from = source as Record<string, unknown>;
	const to = target as unknown as Record<string, unknown>;
	for (const key of Object.keys(to)) {
		const value = from[key];
		const current = to[key];
		if (current && typeof current === 'object') {
			if (!value || typeof value !== 'object') continue;
			const group = current as Record<string, unknown>;
			for (const field of Object.keys(group)) {
				const v = (value as Record<string, unknown>)[field];
				if (typeof v === typeof group[field]) group[field] = v;
			}
		} else if (typeof value === typeof current) to[key] = value;
	}
}

/**
 * The fields of params that differ from base, for saving a tuning as what was changed so a later
 * change of a default still reaches it
 */
export function diffSoundParams(
	params: VehicleSoundParams,
	base: VehicleSoundParams = defaultSoundParams,
): Record<string, unknown> {
	const diff: Record<string, unknown> = {};
	const from = params as unknown as Record<string, unknown>;
	const against = base as unknown as Record<string, unknown>;
	for (const key of Object.keys(from)) {
		const value = from[key];
		if (value && typeof value === 'object') {
			const group: Record<string, unknown> = {};
			const baseGroup = against[key] as Record<string, unknown>;
			for (const [field, v] of Object.entries(value))
				if (v !== baseGroup[field]) group[field] = v;
			if (Object.keys(group).length > 0) diff[key] = group;
		} else if (value !== against[key]) diff[key] = value;
	}
	return diff;
}

/** A voice with the character knobs and the listener's mix applied, as the worklet plays it */
export function engineVoiceConfig(
	voice: EngineVoice,
	p: VehicleSoundParams['engine'],
	listener: ListenerPosition = 'dry',
): EngineVoiceConfig {
	const pipe = Math.max(p.pipeSize, 0.1);
	// Rumble scales how much the pipes ring: how much each end reflects
	const ring = (r: number) => Math.min(r * (0.6 + 0.4 * p.rumble), 0.97);
	const mix = listenerPositions[listener] ?? listenerPositions.dry;
	const pipes = voice.pipes && {
		...voice.pipes,
		runners: voice.pipes.runners.map(([length, bank]): [number, number] => [
			length * pipe,
			bank,
		]),
		mid: voice.pipes.mid * pipe,
		tail: voice.pipes.tail * pipe,
		valve: ring(voice.pipes.valve),
		reflect: ring(voice.pipes.reflect),
		open: ring(voice.pipes.open),
	};
	return {
		exhaust: p.exhaust,
		pipes,
		intake: voice.intake && {
			hz: voice.intake.hz / pipe,
			level: voice.intake.level * p.intake,
		},
		mix: { intake: mix.intake, width: mix.width },
		firing: voice.firing,
		cycle: voice.cycle,
		brap: p.brap,
		lope: voice.lope,
		build: voice.build,
		presence: voice.presence,
		misfire: voice.misfire && Math.min(voice.misfire * p.roughness, 0.6),
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
// Listener
// ---------------------------------------------------------------------------

/**
 * A made-up room response, different for each ear. Outside: the ground reflection a couple of
 * milliseconds behind, a few walls further off and a short tail. In the cabin: dense
 * reflections off the glass and panels within 10 ms, dying away within a few tens of ms.
 */
function roomImpulse(
	ctx: BaseAudioContext,
	kind: 'exterior' | 'cabin',
): AudioBuffer {
	const rate = ctx.sampleRate;
	const cabin = kind === 'cabin';
	const buffer = ctx.createBuffer(
		2,
		Math.ceil(rate * (cabin ? 0.15 : 0.9)),
		rate,
	);
	// Seeded, so the room is the same every time
	let seed = cabin ? 7 : 3;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed / 2147483647) * 2 - 1;
	};
	for (let ear = 0; ear < 2; ear++) {
		const data = buffer.getChannelData(ear);
		const taps = cabin ? 14 : 7;
		for (let i = 0; i < taps; i++) {
			const spread = (i + Math.abs(random())) / taps;
			let time: number;
			let amp: number;
			if (cabin) {
				time = 0.001 + 0.009 * spread;
				amp = 0.5 * (1 - i / taps) * Math.sign(random());
			} else if (i === 0) {
				// The ground, in phase
				time = 0.0025 + 0.0006 * ear;
				amp = 0.6;
			} else {
				time = 0.015 + 0.06 * spread;
				amp = 0.3 * (1 - i / taps) * Math.sign(random());
			}
			data[Math.floor(time * rate)] += amp;
		}
		// The tail: noise dulled by a one pole low pass, fading in over 5 ms and decaying
		const start = cabin ? 0.004 : 0.03;
		const decay = cabin ? 0.03 : 0.22;
		const level = (cabin ? 0.09 : 0.025) * Math.sqrt(48000 / rate);
		const k = 1 - Math.exp((-2 * Math.PI * (cabin ? 2500 : 3500)) / rate);
		let low = 0;
		for (let i = Math.floor(start * rate); i < data.length; i++) {
			low += k * (random() - low);
			const t = i / rate - start;
			data[i] += level * low * Math.exp(-t / decay) * Math.min(t / 0.005, 1);
		}
	}
	return buffer;
}

export type Listener = {
	/** Everything the listener hears goes in here */
	readonly input: GainNode;
	/** And comes out here, filtered and with the room added */
	readonly output: GainNode;
	/** Moves the listener, gliding over a few tens of ms */
	set(position: ListenerPosition, room: number): void;
};

/**
 * Hears the mix from a listener position: the cabin's body filtering and boom, then the room's
 * reflections. Works in an OfflineAudioContext too.
 */
export function createListener(ctx: BaseAudioContext): Listener {
	const input = ctx.createGain();
	const lowpass = ctx.createBiquadFilter();
	lowpass.type = 'lowpass';
	lowpass.Q.value = 0.6;
	lowpass.frequency.value = 20000;
	const boom = ctx.createBiquadFilter();
	boom.type = 'peaking';
	boom.frequency.value = 55;
	boom.Q.value = 1.2;
	boom.gain.value = 0;
	const convolver = ctx.createConvolver();
	convolver.normalize = false;
	const wet = ctx.createGain();
	wet.gain.value = 0;
	const output = ctx.createGain();
	input.connect(lowpass).connect(boom).connect(output);
	boom.connect(convolver).connect(wet).connect(output);
	const rooms: Partial<Record<ListenerPosition, AudioBuffer>> = {};
	let current: ListenerPosition | null = null;
	return {
		input,
		output,
		set(position, room) {
			const l = listenerPositions[position] ?? listenerPositions.dry;
			const t = ctx.currentTime;
			lowpass.frequency.setTargetAtTime(l.lowpass, t, 0.03);
			boom.gain.setTargetAtTime(l.boom, t, 0.03);
			wet.gain.setTargetAtTime(l.room * room, t, 0.03);
			output.gain.setTargetAtTime(l.level, t, 0.03);
			if (position === current) return;
			current = position;
			if (position === 'dry') return;
			rooms[position] ??= roomImpulse(ctx, position);
			convolver.buffer = rooms[position];
		},
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
	/** What reaches the speakers, after the listener, once audio has started. Connect an AnalyserNode here to see it. */
	readonly output: GainNode | null;
	/** Overrun crackle level, 0 to 1, while the exhaust pops after a lift */
	readonly crackle: number;
	/** Called when a one-shot plays, for visuals that react to it */
	onSound: ((name: VehicleSoundEvent, strength: number) => void) | null;
};

export type VehicleSoundEvent = 'blowOff' | 'flutter' | 'thump';

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
		// Every sound meets in master, then reaches the speakers through the listener
		const master = ctx.createGain();
		master.gain.value = level;
		const listener = createListener(ctx);
		master.connect(listener.input);
		listener.output.connect(ctx.destination);

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
					// Stereo: a tailpipe per bank on its own side
					outputChannelCount: [2],
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
			listener,
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

	let onSound: VehicleAudio['onSound'] = null;

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
				: engineVoiceConfig(
						engineVoices[name],
						params.engine,
						params.listener.position,
					);
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
		onSound?.('thump', strength);
	}

	// Blow-off valve: the valve pops open with a short low chuff, then the trapped charge air
	// hisses out, falling in pitch as the pressure drops. Less pressure is quieter, lower and
	// shorter, so strength (the boost there was) scales all three.
	function blowOff(strength = 1) {
		const p = params.turbo;
		const peak = p.blowOffVolume * strength;
		const pitch = p.blowOffPitch * (0.6 + 0.4 * strength);
		oneShot('lowpass', 260, 1, peak * 0.6, 0.07);
		oneShot(
			'bandpass',
			pitch,
			p.blowOffResonance,
			peak,
			p.blowOffLength * (0.5 + 0.5 * strength),
			0.015,
			pitch * 0.35,
		);
		onSound?.('blowOff', strength);
	}

	// Compressor flutter: with no valve, the charge air pushes back through the compressor
	// wheel in bursts, a "stu-tu-tu" chatter that slows and fades as the pressure drops
	function flutter(strength = 1) {
		if (!context || !nodes) return;
		const p = params.turbo;
		const peak = p.flutterVolume * strength;
		if (peak <= 0) return;
		// Less pressure chatters slower and runs out sooner
		const rate = Math.max(p.flutterRate * (0.6 + 0.4 * strength), 2);
		const source = context.createBufferSource();
		source.buffer = nodes.oneShotBuffer;
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = p.flutterPitch;
		filter.Q.value = 1.4;
		const gain = context.createGain();
		const t0 = context.currentTime;
		const length = Math.min(
			Math.max(p.flutterLength * (0.5 + 0.5 * strength), 0.05),
			1.4,
		);
		gain.gain.setValueAtTime(0, t0);
		let t = t0;
		while (t < t0 + length) {
			const progress = (t - t0) / length;
			const period = 1 / (rate * (1 - 0.45 * progress));
			const amp = peak * (1 - progress) ** 1.5;
			gain.gain.linearRampToValueAtTime(amp, t + period * 0.25);
			gain.gain.linearRampToValueAtTime(0, t + period * 0.8);
			gain.gain.setValueAtTime(0, t + period);
			t += period;
		}
		source.connect(filter).connect(gain).connect(nodes.master);
		source.start(t0);
		source.stop(t + 0.05);
		onSound?.('flutter', strength);
	}

	let lastCompression = 0;
	let thumpCooldown = 0;

	// ---- Lift sounds
	//
	// A lift is the throttle snapping shut: from above half to below 10% within LIFT_SNAP
	// seconds. Rolling off slowly lets the manifold pressure fall gently, so it makes no noise.
	//
	// Blow-off and flutter happen when a closing throttle traps real boost in the charge pipes.
	// So a lift only vents when the boost had stayed above blowOffMinBoost for blowOffHold
	// seconds (a tap or a part throttle squirt builds no pressure worth venting), not on a
	// supercharger (its bypass valve recirculates quietly), and only once the boost is seen
	// to fall (anti-lag holds the pressure up off throttle, so nothing vents). The boost there
	// was sets the loudness, pitch and length, and a cooldown stops quick taps stacking.
	//
	// Overrun crackle is unburnt fuel lighting in a hot exhaust. The exhaust heats up over
	// CRACKLE_HEAT_UP seconds of near full throttle above crackleMinRpm and cools when the load
	// goes. A lift from above crackleMinRpm with a hot exhaust pops with crackleChance, in a
	// burst that fades over crackleLength (shorter from a cooler exhaust), and stops when the
	// throttle opens or the revs drop below crackleMinRpm. A burst uses up the heat, so the next
	// needs another pull. Never at idle, after cruising or on blips.
	const LIFT_SNAP = 0.3;
	const CRACKLE_HEAT_UP = 1.5;
	const CRACKLE_COOL = 3;
	const CRACKLE_MIN_HEAT = 0.4;
	/** A lift vents once the boost has fallen this far below what it was on throttle */
	const VENT_DROP = 0.8;
	/** Seconds after a lift to see the boost fall before giving up (anti-lag) */
	const VENT_WAIT = 0.25;

	let liftCooldown = 0;
	// Throttle held above half since the last lift, and seconds since it last was
	let onThrottle = false;
	let sinceOnThrottle = 0;
	// Seconds of throttle since the last lift, which stands in for boost with liftWithoutTurbo
	let throttleHeld = 0;
	// Seconds the charge has stayed above blowOffMinBoost, the charge on the last frame on
	// throttle, and whether it was boost (rather than liftWithoutTurbo pretending)
	let chargeHeld = 0;
	let liftCharge = 0;
	let liftReal = true;
	// A lift waiting to see the boost fall: the charge to vent and the seconds left
	let vent: { charge: number; wait: number; real: boolean } | null = null;
	// Exhaust heat 0 to 1, and the crackle burst playing: its strength, length and age
	let exhaustHeat = 0;
	let crackle: { strength: number; length: number; age: number } | null = null;

	function lift(strength = 1) {
		const { valve } = params.turbo;
		if (valve === 'blowOff' || valve === 'both') blowOff(strength);
		if (valve === 'flutter' || valve === 'both') flutter(strength);
	}

	/** Follows the throttle and boost, plays the lift sounds and returns the crackle level */
	function updateLift(sound: VehicleSound, dt: number): number {
		const { engine, turbo } = params;
		liftCooldown = Math.max(liftCooldown - dt, 0);

		const hard = sound.throttle > 0.8 && sound.engineRpm > engine.crackleMinRpm;
		exhaustHeat = hard
			? Math.min(exhaustHeat + dt / CRACKLE_HEAT_UP, 1)
			: Math.max(exhaustHeat - dt / CRACKLE_COOL, 0);

		if (sound.throttle > 0.5) {
			onThrottle = true;
			sinceOnThrottle = 0;
			throttleHeld += dt;
			// Boost a valve can vent. liftWithoutTurbo pretends a car with none has some.
			const pressure = sound.supercharged ? 0 : sound.boost;
			liftReal = pressure > 0 || !turbo.liftWithoutTurbo;
			liftCharge = liftReal ? pressure : Math.min(throttleHeld, 1);
			chargeHeld = liftCharge > turbo.blowOffMinBoost ? chargeHeld + dt : 0;
			// The throttle opened again before the boost fell: nothing vents
			vent = null;
		} else sinceOnThrottle += dt;

		if (onThrottle && sound.throttle < 0.1) {
			onThrottle = false;
			const snapped = sinceOnThrottle <= LIFT_SNAP;
			if (
				snapped &&
				chargeHeld >= turbo.blowOffHold &&
				liftCooldown === 0 &&
				turbo.valve !== 'none'
			)
				vent = { charge: liftCharge, wait: VENT_WAIT, real: liftReal };
			if (
				snapped &&
				sound.engineRpm > engine.crackleMinRpm &&
				exhaustHeat > CRACKLE_MIN_HEAT &&
				Math.random() < engine.crackleChance
			) {
				crackle = {
					strength: exhaustHeat,
					length: engine.crackleLength * exhaustHeat,
					age: 0,
				};
				// The burst uses up the heat, so blips after it stay quiet until another pull
				exhaustHeat = 0;
			}
			chargeHeld = 0;
			throttleHeld = 0;
		}

		if (vent) {
			vent.wait -= dt;
			if (!vent.real || sound.boost <= vent.charge * VENT_DROP) {
				lift(vent.charge);
				liftCooldown = turbo.blowOffCooldown;
				vent = null;
			} else if (vent.wait <= 0) vent = null;
		}

		if (!crackle) return 0;
		crackle.age += dt;
		if (
			crackle.age >= crackle.length ||
			sound.throttle > 0.1 ||
			sound.engineRpm < engine.crackleMinRpm
		) {
			crackle = null;
			return 0;
		}
		return crackle.strength * (1 - crackle.age / crackle.length) ** 2;
	}

	// Turbo shaft speed, 0 to 1: follows the boost up quickly and coasts down slowly
	let shaftSpeed = 0;
	let overrun = 0;

	return {
		update(sound, dt) {
			if (!context || !nodes || context.state !== 'running') return;
			applyStatic(nodes);
			nodes.listener.set(params.listener.position, params.listener.room);
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
			// It tops out below 3 kHz: higher, at full boost and high revs, it turns into a hiss
			nodes.whooshFilter.frequency.setTargetAtTime(500 + 2300 * spin, t, glide);
			nodes.whooshGain.gain.setTargetAtTime(
				turbo.whooshVolume * sound.boost * sound.throttle,
				t,
				glide,
			);

			// ---- Lift sounds
			overrun = updateLift(sound, dt);
			pulses?.parameters.get('overrun')?.setValueAtTime(overrun, t);
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
			return nodes?.listener.output ?? null;
		},
		get crackle() {
			return overrun;
		},
		get onSound() {
			return onSound;
		},
		set onSound(listener) {
			onSound = listener;
		},
	};
}
