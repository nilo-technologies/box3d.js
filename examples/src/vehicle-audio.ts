// Procedural car sound for the vehicle examples, made with the Web Audio API and no audio files:
// an engine whose pitch follows the rpm and whose tone opens up with the throttle, tire squeal
// from filtered noise that follows how far the tires slide, wind noise with speed, a thump
// when the suspension hits its bump stop, and a turbo whistle with a blow-off hiss on lift. Browsers only start audio after a user gesture, so
// the context resumes on the first key press or click.

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

export type VehicleAudio = {
	/** Call once per frame */
	update(sound: VehicleSound, dt: number): void;
	/** Firing pulses per crankshaft turn are cylinders / 2, which sets the engine pitch */
	setCylinders(cylinders: number): void;
	setVolume(volume: number): void;
	/** 0 to 1, as last set */
	readonly volume: number;
};

/** Engine pitch relative to the firing frequency: a fifth lower sounds deeper and calmer */
const ENGINE_PITCH = 2 / 3;

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

export function createVehicleAudio(volume = 0.5): VehicleAudio {
	let context: AudioContext | null = null;
	let cylinders = 6;
	let level = volume;

	// Built on first use, inside the gesture that unlocks audio
	let nodes: {
		master: GainNode;
		engine: OscillatorNode;
		engineSub: OscillatorNode;
		engineTone: BiquadFilterNode;
		engineGain: GainNode;
		squealFilter: BiquadFilterNode;
		squealGain: GainNode;
		windGain: GainNode;
		whistle: OscillatorNode;
		whistleGain: GainNode;
		thumpBuffer: AudioBuffer;
	} | null = null;

	function build(ctx: AudioContext) {
		const master = ctx.createGain();
		master.gain.value = level;
		master.connect(ctx.destination);

		// Engine: a triangle below the firing frequency over a sine an octave under it, through a
		// gentle low pass that opens a little with the throttle. Both waveforms are soft, with few
		// high harmonics.
		const engineTone = ctx.createBiquadFilter();
		engineTone.type = 'lowpass';
		engineTone.Q.value = 0.7;
		const engineGain = ctx.createGain();
		engineGain.gain.value = 0;
		engineTone.connect(engineGain).connect(master);
		const engine = ctx.createOscillator();
		engine.type = 'triangle';
		const engineSub = ctx.createOscillator();
		engineSub.type = 'sine';
		const subGain = ctx.createGain();
		subGain.gain.value = 0.8;
		engine.connect(engineTone);
		engineSub.connect(subGain).connect(engineTone);
		engine.start();
		engineSub.start();

		const noise = noiseBuffer(ctx, 2);

		// Tire squeal: noise through a resonant band pass around 1-2 kHz. The band keeps about 1% of
		// the noise power, hence the large gains below.
		const squealFilter = ctx.createBiquadFilter();
		squealFilter.type = 'bandpass';
		squealFilter.Q.value = 6;
		squealFilter.frequency.value = 1400;
		const squealGain = ctx.createGain();
		squealGain.gain.value = 0;
		loopedNoise(ctx, noise)
			.connect(squealFilter)
			.connect(squealGain)
			.connect(master);

		// Wind: low passed noise that rises with speed
		const windFilter = ctx.createBiquadFilter();
		windFilter.type = 'lowpass';
		windFilter.frequency.value = 500;
		const windGain = ctx.createGain();
		windGain.gain.value = 0;
		loopedNoise(ctx, noise)
			.connect(windFilter)
			.connect(windGain)
			.connect(master);

		// Turbo whistle: a quiet high sine whose pitch rises with the boost, as the compressor wheel
		// spins up
		const whistle = ctx.createOscillator();
		whistle.type = 'sine';
		whistle.frequency.value = 2000;
		const whistleGain = ctx.createGain();
		whistleGain.gain.value = 0;
		whistle.connect(whistleGain).connect(master);
		whistle.start();

		return {
			master,
			engine,
			engineSub,
			engineTone,
			engineGain,
			squealFilter,
			squealGain,
			windGain,
			whistle,
			whistleGain,
			thumpBuffer: noiseBuffer(ctx, 0.25),
		};
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

	function thump(strength: number) {
		if (!context || !nodes) return;
		const source = context.createBufferSource();
		source.buffer = nodes.thumpBuffer;
		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 180;
		const gain = context.createGain();
		const t = context.currentTime;
		gain.gain.setValueAtTime(0.9 * strength, t);
		gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
		source.connect(filter).connect(gain).connect(nodes.master);
		source.start(t);
	}

	// Blow-off valve: a short hiss of noise when the throttle closes on boost
	function blowOff(strength: number) {
		if (!context || !nodes) return;
		const source = context.createBufferSource();
		source.buffer = nodes.thumpBuffer;
		const filter = context.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 2600;
		filter.Q.value = 0.8;
		const gain = context.createGain();
		const t = context.currentTime;
		gain.gain.setValueAtTime(0.35 * strength, t);
		gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
		source.connect(filter).connect(gain).connect(nodes.master);
		source.start(t);
	}

	let lastCompression = 0;
	let thumpCooldown = 0;
	let lastThrottle = 0;
	let blowOffCooldown = 0;

	return {
		update(sound, dt) {
			if (!context || !nodes || context.state !== 'running') return;
			const t = context.currentTime;
			// Smooth every parameter over a few frames so steps in the simulation do not click
			const glide = 0.05;

			// A fifth below the firing frequency, but not under 40 Hz so small speakers still play it
			const firing = (Math.max(sound.engineRpm, 300) / 60) * (cylinders / 2);
			const pitch = Math.max(firing * ENGINE_PITCH, 40);
			nodes.engine.frequency.setTargetAtTime(pitch, t, glide);
			nodes.engineSub.frequency.setTargetAtTime(pitch / 2, t, glide);
			nodes.engineTone.frequency.setTargetAtTime(
				pitch * (1.2 + 1.8 * sound.throttle),
				t,
				glide,
			);
			nodes.engineGain.gain.setTargetAtTime(
				0.07 + 0.13 * sound.throttle,
				t,
				glide,
			);

			const speed = Math.abs(sound.speed);
			const squeal = speed > 1.5 ? sound.skid * Math.min(speed / 8, 1) : 0;
			nodes.squealGain.gain.setTargetAtTime(1.0 * squeal, t, glide);
			nodes.squealFilter.frequency.setTargetAtTime(
				1100 + 700 * sound.skid,
				t,
				glide,
			);
			nodes.windGain.gain.setTargetAtTime(
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
				thump(Math.min(0.4 + speed / 30, 1));
				thumpCooldown = 0.25;
			}
			lastCompression = sound.compression;

			nodes.whistle.frequency.setTargetAtTime(
				1800 + 4200 * sound.boost,
				t,
				glide,
			);
			nodes.whistleGain.gain.setTargetAtTime(0.03 * sound.boost, t, glide);
			blowOffCooldown = Math.max(blowOffCooldown - dt, 0);
			if (
				lastThrottle > 0.5 &&
				sound.throttle < 0.1 &&
				sound.boost > 0.3 &&
				blowOffCooldown === 0
			) {
				blowOff(sound.boost);
				blowOffCooldown = 0.3;
			}
			lastThrottle = sound.throttle;
		},
		setCylinders(count) {
			cylinders = count;
		},
		setVolume(value) {
			level = value;
			if (context && nodes)
				nodes.master.gain.setTargetAtTime(value, context.currentTime, 0.05);
		},
		get volume() {
			return level;
		},
	};
}
