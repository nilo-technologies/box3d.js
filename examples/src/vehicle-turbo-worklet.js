// AudioWorklet behind the turbo's running sound in vehicle-audio.ts: the compressor whistle and
// the intake whoosh. (The lift sounds, blow-off and flutter, are one-shots in vehicle-audio.ts.)
//
// The whistle is noise through two narrow band passes in a row at the blade pass frequency (the
// shaft speed times the blades), a quieter band an octave up and a trace of pure tone for
// definition. It follows the shaft, so it keeps singing as the turbo coasts down after a lift,
// and it is loudest while air flows on throttle. The whoosh is air through the compressor, noise
// in a wide band that rises with the shaft and grows with the boost.
//
// A turbo's build (see TurboBuild in vehicle-audio.ts) changes how the sound is made:
// - blades: the compressor wheel has this many blades, never quite the same, so each blade in
//   turn sounds a little stronger or weaker. The whistle carries sidebands at the shaft rate
//   around its pitch, as a real wheel does.
// - pulses: the turbine is spun by the engine's exhaust pulses, so the whistle swells and its
//   pitch wavers with every firing, by up to this share, most at low revs where the pulses are
//   far apart
// - charge: the compressor's sound travels down a charge pipe this long (m) to the throttle. A
//   shut throttle closes the pipe, so it rings like a tube, and a wide open one lets it through.
// - belt: a supercharger, driven by a belt off the crank, so its pitch is locked to the engine:
//   this many Hz of whine per engine rpm, rising and falling with the revs at once, with no spool.
//   Its strength follows the rpm and the throttle rather than the boost.
// - lobes: a twin-screw or Roots supercharger's rotors. Each lobe passing pushes a pulse of air,
//   so the whine is a series of harmonics of the lobe passing rate (the pitch), a gear-like
//   tone, on top of the whistle's air.
// - bypass: a supercharger's bypass valve. Off or on a part throttle it opens and the rotors run
//   unloaded, so the whine drops and dulls; at full throttle it shuts and the whine comes in full.
// - scrolls: a twin-scroll turbine. Each scroll is fed by the cylinders a turn apart, so the
//   pulses reach the turbine in turns, one scroll's this share weaker than the other's: the
//   pulse drive's throb gets a slower rhythm on top, at half the firing rate. Needs pulses.
// - wheel: a bigger compressor wheel spins slower, so the whistle sits at this share of the pitch
//   and its band is wider, airier
// - inertia: a big turbo's heavy shaft (s). The whistle sweeps up slowly as it spools and keeps
//   singing long after a lift, on top of the shaft's own spin up and down.
// - surge: on a part throttle with boost built up, little air flows against a high pressure, so
//   the compressor runs near surge and the flow through it pulses a few times a second (a
//   chuff), by up to this share. A wide open throttle flows enough to keep it away.
//
// The shaft speed, the boost, the throttle and the rpm arrive as AudioParams, the turbo as a
// message. Out is mono.

/** Gains that bring the narrow noise bands of the whistle to about the level of a sine */
const WHISTLE_AIR = 17.5;
const WHISTLE_HARMONIC = 8.7;
/** Seconds over which the whistle's pitch, width and levels glide */
const GLIDE = 0.05;
/** Blades: how much stronger or weaker a blade sounds, at most */
const BLADE_SPREAD = 0.8;
/** Pulses: the share of the pitch waver against the swell, and the rpm range over which the
 * pulses merge and the effect fades to PULSE_HIGH of itself */
const PULSE_PITCH = 0.02;
const PULSE_RPM = [2500, 6500];
const PULSE_HIGH = 0.35;
/** Pulses: how much of the swell reaches the airflow (the whoosh) */
const PULSE_FLOW = 0.5;
/** Speed of sound in the air (m/s) */
const AIR = 343;
/** Charge pipe: what the compressor end reflects, and what the throttle end reflects shut and
 * wide open */
const CHARGE_COMPRESSOR = 0.7;
const CHARGE_SHUT = 0.95;
const CHARGE_OPEN = 0.6;
const CHARGE_CUTOFF = 5000;
/** Surge: its rate (Hz) at no boost and added at full, and how far the rate wanders */
const SURGE_HZ = [8, 6];
const SURGE_WANDER = 0.15;
/** Wheel: how much wider the band gets for each share of pitch the wheel loses */
const WHEEL_WIDEN = 1.5;
/** Inertia: a heavy shaft spins up in this share of the time it takes to spin down */
const INERTIA_UP = 0.5;
/** Belt drive: the rpm at which the whine is at full strength, and how far the belt slips */
const BELT_FULL_RPM = 7000;
const BELT_SLIP = 0.0015;
/** Lobes: the harmonics' levels, from the lobe passing rate up, and their level against the air */
const LOBE_HARMONICS = [1, 0.55, 0.35, 0.2, 0.12, 0.07];
const LOBE_LEVEL = 0.6;
/** Bypass: the whine's strength and its harmonics' brightness with the valve fully open */
const BYPASS_OPEN = 0.3;
const BYPASS_DULL = 0.35;

const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
const smoothstep = (a, b, x) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** A band pass with a peak gain of 1, as Web Audio's BiquadFilterNode 'bandpass' */
class BandPass {
	constructor() {
		this.b0 = 0;
		this.b2 = 0;
		this.a1 = 0;
		this.a2 = 0;
		this.x1 = 0;
		this.x2 = 0;
		this.y1 = 0;
		this.y2 = 0;
	}

	set(freq, q) {
		const w =
			(2 * Math.PI * Math.min(Math.max(freq, 10), sampleRate * 0.45)) /
			sampleRate;
		const alpha = Math.sin(w) / (2 * Math.max(q, 0.01));
		const a0 = 1 + alpha;
		this.b0 = alpha / a0;
		this.b2 = -alpha / a0;
		this.a1 = (-2 * Math.cos(w)) / a0;
		this.a2 = (1 - alpha) / a0;
	}

	run(x) {
		const y =
			this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
		this.x2 = this.x1;
		this.x1 = x;
		this.y2 = this.y1;
		this.y1 = y;
		return y;
	}
}

/** A delay line, read a fractional number of samples back (at least 1) */
class Delay {
	constructor(size) {
		this.buf = new Float32Array(size);
		this.w = 0;
	}

	read(delay) {
		const n = this.buf.length;
		let r = this.w - Math.min(Math.max(delay, 1), n - 2);
		if (r < 0) r += n;
		const i = r | 0;
		const a = this.buf[i];
		return a + (this.buf[i + 1 === n ? 0 : i + 1] - a) * (r - i);
	}

	write(x) {
		this.buf[this.w] = x;
		this.w = this.w + 1 === this.buf.length ? 0 : this.w + 1;
	}
}

/** A fixed number from -1 to 1 for each index, the same every run */
const fixed = (i) => {
	const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
	return 2 * (x - Math.floor(x)) - 1;
};

class VehicleTurboProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			// Shaft speed, 0 stopped to 1 at full boost, before the idle spin is added
			{
				name: 'shaft',
				defaultValue: 0,
				minValue: 0,
				maxValue: 2,
				automationRate: 'k-rate',
			},
			{
				name: 'boost',
				defaultValue: 0,
				minValue: 0,
				maxValue: 2,
				automationRate: 'k-rate',
			},
			{
				name: 'throttle',
				defaultValue: 0,
				minValue: 0,
				maxValue: 1,
				automationRate: 'k-rate',
			},
			{
				name: 'rpm',
				defaultValue: 800,
				minValue: 0,
				maxValue: 30000,
				automationRate: 'k-rate',
			},
		];
	}

	constructor() {
		super();
		this.turbo = null;
		this.band1 = new BandPass();
		this.band2 = new BandPass();
		this.harmonic = new BandPass();
		this.whoosh = new BandPass();
		this.whoosh.set(500, 0.9);
		this.tonePhase = 0;
		this.lobePhases = LOBE_HARMONICS.map(() => 0);
		this.bladeCycles = 0;
		this.firePhase = 0;
		// Which scroll the last pulse came through
		this.scroll = 0;
		this.surgePhase = 0;
		// A heavy shaft's speed
		this.heavy = 0;
		this.time = 0;
		// Glided values, so steps in the simulation do not click
		this.pitch = -1;
		this.q = 25;
		this.whineLevel = 0;
		this.whooshLevel = 0;
		this.whooshHz = 500;
		this.charge = new Delay(Math.ceil(sampleRate * 0.03) + 4);
		this.chargeLow = 0;
		this.port.onmessage = (event) => {
			this.turbo = event.data;
		};
	}

	process(_inputs, outputs, parameters) {
		const out = outputs[0][0];
		if (!out) return true;
		const t = this.turbo;
		if (!t) {
			out.fill(0);
			return true;
		}
		let shaft = parameters.shaft[0];
		const boost = parameters.boost[0];
		const throttle = parameters.throttle[0];
		const rpm = parameters.rpm[0];
		const build = t.build ?? {};
		const n = out.length;

		this.time += n / sampleRate;
		const dt = n / sampleRate;
		if (build.inertia) {
			// The heavy shaft: slow to spin up, slower to spin down
			const time =
				shaft > this.heavy ? INERTIA_UP * build.inertia : build.inertia;
			this.heavy += (shaft - this.heavy) * (1 - Math.exp(-dt / time));
			shaft = this.heavy;
		}
		const spin = t.idleSpin + (1 - t.idleSpin) * shaft;
		const belt = build.belt ?? 0;
		// The airflow wavers a little, so a turbo's pitch drifts by about 1%. A belt only slips.
		const drift = belt
			? 1 + BELT_SLIP * Math.sin(this.time * 3.1)
			: 1 +
				0.007 * Math.sin(this.time * 2.3) +
				0.004 * Math.sin(this.time * 5.7);
		const wheel = build.wheel ?? 1;
		const targetPitch = (belt ? rpm * belt : t.pitch * wheel * spin) * drift;
		const targetQ =
			1 / Math.max(t.width, 0.005) / (1 + WHEEL_WIDEN * (1 - wheel));
		// How shut a bypass valve is: open off and on a part throttle, shut flat out
		const shut = build.bypass ? smoothstep(0.3, 0.8, throttle) : 1;
		const bright = BYPASS_DULL + (1 - BYPASS_DULL) * shut;
		const targetWhine = belt
			? t.whineVolume *
				Math.min(rpm / BELT_FULL_RPM, 1.2) ** 1.5 *
				(build.bypass
					? BYPASS_OPEN + (1 - BYPASS_OPEN) * shut
					: 0.35 + 0.65 * throttle)
			: t.whineVolume * shaft ** 1.5 * (0.35 + 0.65 * throttle);
		const targetWhooshHz = 500 + 2300 * spin;
		const targetWhoosh = t.whooshVolume * boost * throttle;
		// One glide step per block, as setTargetAtTime would do
		const k = 1 - Math.exp(-n / sampleRate / GLIDE);
		if (this.pitch < 0) this.pitch = targetPitch;
		this.pitch += (targetPitch - this.pitch) * k;
		this.q += (targetQ - this.q) * k;
		this.whineLevel += (targetWhine - this.whineLevel) * k;
		this.whooshHz += (targetWhooshHz - this.whooshHz) * k;
		this.whooshLevel += (targetWhoosh - this.whooshLevel) * k;
		const air = WHISTLE_AIR * Math.sqrt(this.q / 25);
		const harmonicLevel =
			t.harmonic * WHISTLE_HARMONIC * Math.sqrt(this.q / 25);
		this.whoosh.set(this.whooshHz, 0.9);

		// Pulses: the exhaust kicks the turbine once per firing
		const fireHz = (rpm / 60) * ((t.cylinders || 4) / 2);
		const pulses = build.pulses
			? build.pulses *
				(1 - (1 - PULSE_HIGH) * smoothstep(PULSE_RPM[0], PULSE_RPM[1], rpm))
			: 0;
		const blades = build.blades ?? 0;
		const chargeDelay = build.charge
			? ((2 * build.charge) / AIR) * sampleRate
			: 0;
		const chargeEnd =
			CHARGE_SHUT +
			(CHARGE_OPEN - CHARGE_SHUT) * smoothstep(0.1, 0.9, throttle);
		const kCharge = onePole(CHARGE_CUTOFF);
		// Near surge: boost built up, the throttle only part open
		const surge = build.surge
			? build.surge *
				smoothstep(0.25, 0.6, boost) *
				smoothstep(0.05, 0.25, throttle) *
				(1 - smoothstep(0.55, 0.85, throttle))
			: 0;
		const surgeHz =
			(SURGE_HZ[0] + SURGE_HZ[1] * boost) *
			(1 + SURGE_WANDER * Math.sin(this.time * 1.7));

		for (let s = 0; s < n; s++) {
			const noise = Math.random() * 2 - 1;
			let kick = 0;
			if (pulses > 0) {
				// A sharp swell after each firing, decaying until the next
				this.firePhase += fireHz / sampleRate;
				if (this.firePhase >= 1) {
					this.firePhase -= 1;
					this.scroll = 1 - this.scroll;
				}
				kick = Math.exp(-6 * this.firePhase) - 0.28;
				// A twin-scroll: the scrolls take turns, one a little weaker
				if (build.scrolls && this.scroll) kick *= 1 - build.scrolls;
			}
			// Surge: a soft dip in the airflow, then a quick swell
			let chuff = 0;
			if (surge > 0) {
				this.surgePhase += surgeHz / sampleRate;
				if (this.surgePhase >= 1) this.surgePhase -= 1;
				chuff = Math.sin(2 * Math.PI * this.surgePhase) ** 3;
			}
			const bend = 1 + 0.01 * surge * chuff;
			const pitch = this.pitch * (1 + PULSE_PITCH * pulses * kick) * bend;
			if (s === 0 || pulses > 0 || surge > 0) {
				this.band1.set(pitch, this.q);
				this.band2.set(pitch, this.q);
				this.harmonic.set(pitch * 2, this.q);
			}
			// Blades: each blade passing in turn, a little stronger or weaker than the last
			let blade = 1;
			if (blades > 0) {
				this.bladeCycles += pitch / sampleRate;
				if (this.bladeCycles >= blades) this.bladeCycles -= blades;
				blade = 1 + BLADE_SPREAD * fixed(Math.floor(this.bladeCycles) % blades);
			}
			const excite = noise;
			this.tonePhase += (2 * Math.PI * pitch) / sampleRate;
			if (this.tonePhase > 2 * Math.PI) this.tonePhase -= 2 * Math.PI;
			let whistle =
				this.band2.run(this.band1.run(excite)) * air +
				this.harmonic.run(excite) * harmonicLevel +
				Math.sin(this.tonePhase) * t.tone;
			if (build.lobes) {
				// The rotors: a pulse of air per lobe passing, a series of harmonics, the upper ones
				// dulled while a bypass is open
				let tone = 0;
				for (let h = 0; h < LOBE_HARMONICS.length; h++) {
					const f = pitch * (h + 1);
					if (f > sampleRate * 0.45) break;
					this.lobePhases[h] += (2 * Math.PI * f) / sampleRate;
					if (this.lobePhases[h] > 2 * Math.PI)
						this.lobePhases[h] -= 2 * Math.PI;
					tone +=
						LOBE_HARMONICS[h] * bright ** h * Math.sin(this.lobePhases[h]);
				}
				whistle += LOBE_LEVEL * tone;
			}
			// Each blade passing sounds its own strength, after the bands that set the pitch
			whistle *=
				blade *
				this.whineLevel *
				(1 + pulses * kick) *
				(1 + 0.5 * surge * chuff);

			const whoosh =
				this.whoosh.run(noise) *
				this.whooshLevel *
				(1 + PULSE_FLOW * pulses * kick) *
				(1 + surge * chuff);
			let y = whistle + whoosh;
			if (chargeDelay) {
				// The charge pipe: back and forth between the compressor and the throttle
				const back = this.charge.read(chargeDelay);
				this.chargeLow += kCharge * (back - this.chargeLow);
				const inPipe = y + CHARGE_COMPRESSOR * chargeEnd * this.chargeLow;
				this.charge.write(inPipe);
				y = inPipe * (1 - 0.5 * chargeEnd);
			}
			out[s] = y;
		}
		return true;
	}
}

registerProcessor('vehicle-turbo', VehicleTurboProcessor);
