// AudioWorklet behind the engine voices in vehicle-audio.ts. An engine is a train of exhaust
// pulses: each cylinder fires once per 720° four-stroke cycle at its angle in the firing order,
// and each firing is a short pulse of pressure (a quick rise and an exponential decay) with
// some combustion noise riding on it. The pulses ring two fixed exhaust resonances (formants),
// then pass through a soft saturator and a muffler low pass that opens with the throttle.
// Uneven firing angles or uneven pulse strengths between banks give the burble of a cross-plane
// V8 or the rumble of a boxer; small random timing and strength changes keep it from sounding
// like a machine. Off throttle at high rpm, some firings pop (overrun crackle).
//
// The voice arrives as a message (see EngineVoiceConfig in vehicle-audio.ts), the rpm and the
// throttle as AudioParams. An electric voice is a few sines at fixed orders of the rpm instead.

/** Topology-preserving state variable filter (Simper). band is normalized to a peak of 1. */
class Svf {
	constructor() {
		this.ic1 = 0;
		this.ic2 = 0;
		this.a1 = 0;
		this.a2 = 0;
		this.a3 = 0;
		this.k = 1;
		this.low = 0;
		this.band = 0;
	}

	set(freq, q) {
		const f = Math.min(Math.max(freq, 10), sampleRate * 0.45);
		const g = Math.tan((Math.PI * f) / sampleRate);
		this.k = 1 / Math.max(q, 0.05);
		this.a1 = 1 / (1 + g * (g + this.k));
		this.a2 = g * this.a1;
		this.a3 = g * this.a2;
	}

	run(x) {
		const v3 = x - this.ic2;
		const v1 = this.a1 * this.ic1 + this.a2 * v3;
		const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
		this.ic1 = 2 * v1 - this.ic1;
		this.ic2 = 2 * v2 - this.ic2;
		this.low = v2;
		this.band = this.k * v1;
	}
}

const decayCoef = (ms) =>
	Math.exp(-1 / (Math.max(ms, 0.01) * 0.001 * sampleRate));

class VehicleEngineProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: 'rpm',
				defaultValue: 800,
				minValue: 0,
				maxValue: 30000,
				automationRate: 'k-rate',
			},
			{
				name: 'throttle',
				defaultValue: 0,
				minValue: 0,
				maxValue: 1,
				automationRate: 'k-rate',
			},
		];
	}

	constructor() {
		super();
		this.voice = null;
		this.theta = 0;
		this.cylinders = [];
		this.formant1 = new Svf();
		this.formant2 = new Svf();
		this.muffler = new Svf();
		this.pop = 0;
		this.dcIn = 0;
		this.dcOut = 0;
		this.phases = [];
		this.port.onmessage = (event) => this.configure(event.data);
	}

	configure(voice) {
		this.voice = voice;
		if (!voice) return;
		this.cylinders = voice.firing.map(([angle, gain], i) => {
			const old = this.cylinders[i];
			return {
				angle,
				gain,
				next: angle,
				x: old ? old.x : 0,
				y: old ? old.y : 0,
			};
		});
		this.pulseScale = -1;
		this.kPop = decayCoef(14);
		this.formant1.set(voice.formants[0][0], voice.formants[0][1]);
		this.formant2.set(voice.formants[1][0], voice.formants[1][1]);
		this.phases = (voice.whine ?? []).map((_, i) => this.phases[i] ?? 0);
	}

	process(_inputs, outputs, parameters) {
		const out = outputs[0][0];
		if (!out) return true;
		const v = this.voice;
		if (!v) {
			out.fill(0);
			return true;
		}
		const rpm = parameters.rpm[0];
		const throttle = parameters.throttle[0];

		if (v.whine) {
			// Electric: sines at fixed orders of the motor speed, a little louder under load
			const level = (0.35 + 0.65 * throttle) * v.level;
			for (let s = 0; s < out.length; s++) {
				let y = 0;
				for (let i = 0; i < v.whine.length; i++) {
					const [order, gain] = v.whine[i];
					this.phases[i] += (2 * Math.PI * order * rpm) / 60 / sampleRate;
					if (this.phases[i] > 2 * Math.PI) this.phases[i] -= 2 * Math.PI;
					y += gain * Math.sin(this.phases[i]);
				}
				out[s] = (y + v.noise * 0.02 * (Math.random() * 2 - 1)) * level;
			}
			return true;
		}

		this.muffler.set(v.muffler * (1 + v.mufflerOpen * throttle), 0.7);
		// An exhaust pulse lasts a fixed number of crank degrees, so above 2500 rpm it shortens with
		// the rpm. Otherwise the pulses would overlap into a steady pressure at high revs.
		const pulseScale = Math.min(1, 2500 / Math.max(rpm, 300));
		if (Math.abs(pulseScale - this.pulseScale) > 0.005) {
			this.pulseScale = pulseScale;
			this.kAttack = decayCoef(v.attack * pulseScale);
			this.kDecay = decayCoef(v.decay * pulseScale);
		}
		// Fewer pulses per second carry less energy. Make up part of it so idle stays audible.
		const rateGain = Math.min(
			Math.max(Math.sqrt(3000 / Math.max(rpm, 300)), 0.7),
			2.2,
		);
		// Pulses are weaker off throttle, as the engine is pumping air rather than burning fuel
		const load = 0.5 + 0.5 * throttle;
		const overrun = throttle < 0.1 && rpm > 2500;
		const step = (rpm * 6) / sampleRate; // degrees of crank per sample
		const [, , gain1] = v.formants[0];
		const [, , gain2] = v.formants[1];
		const drive = Math.max(v.drive, 0.05);

		for (let s = 0; s < out.length; s++) {
			const prev = this.theta;
			let next = prev + step;
			const wrapped = next >= 720;
			if (wrapped) next -= 720;

			let sum = 0;
			for (const c of this.cylinders) {
				const fire = c.next;
				const crossed = wrapped
					? fire > prev || fire <= next
					: fire > prev && fire <= next;
				if (crossed) {
					let amp = c.gain * load * (1 + v.ampJitter * (Math.random() * 2 - 1));
					if (overrun && Math.random() < v.crackle) {
						amp *= 2;
						this.pop = Math.max(this.pop, 0.5 + 0.7 * Math.random());
					}
					c.x += amp;
					c.y += amp;
					const jittered = c.angle + v.jitter * (Math.random() * 2 - 1);
					c.next = ((jittered % 720) + 720) % 720;
				}
				sum += c.x - c.y;
				c.x *= this.kDecay;
				c.y *= this.kAttack;
			}
			this.theta = next;

			const noise = Math.random() * 2 - 1;
			const excitation = sum * (1 + v.noise * noise) + this.pop * noise;
			this.pop *= this.kPop;

			this.formant1.run(excitation);
			this.formant2.run(excitation);
			let y =
				excitation * v.dry +
				this.formant1.band * gain1 +
				this.formant2.band * gain2;
			y = Math.tanh(y * drive) / drive;
			this.muffler.run(y);
			y = this.muffler.low;

			// DC blocker: the pulses only push, so their average is not zero
			const dc = y - this.dcIn + 0.995 * this.dcOut;
			this.dcIn = y;
			this.dcOut = dc;
			out[s] = dc * v.level * rateGain;
		}
		return true;
	}
}

registerProcessor('vehicle-engine', VehicleEngineProcessor);
