// AudioWorklet behind the engine voices in vehicle-audio.ts. An engine is a train of exhaust
// pulses: each cylinder fires once per 720° four-stroke cycle at its angle in the firing order (a
// rotary's cycle is 1080°: three turns of the shaft, one per rotor face),
// and each firing is a short pulse of pressure (a quick rise and an exponential decay) with
// some combustion noise riding on it. Uneven firing angles or uneven pulse strengths between
// banks give the burble of a cross-plane V8 or the rumble of a boxer; small random timing and
// strength changes keep it from sounding like a machine. During an overrun crackle burst, some
// firings pop. A voice with misfire has an uneven idle, in one of these styles (brap):
// - bursts, as a ported rotary does: exhaust left in the chamber dilutes each charge a little
//   more, so the burns weaken, until one fails to light. Its fuel bangs in the hot exhaust and
//   the chamber clears for a strong burn again.
// - lope: the firings burn at fixed strengths of their own (the voice's lope), a pattern that
//   repeats every cycle, so the idle pulses at a steady rhythm tied to the revs
// - skips: now and then a firing drops out
// - mixed: the lope with the odd skip
// - even: none of it
// A voice with a lope and no misfire (a V8 on a big cam) lopes at idle only.
//
// The pulses then go through one of two exhausts:
// - Pipes (the default): a waveguide model of the exhaust system. Each pulse runs down its
//   cylinder's header runner to the bank's collector, where the runners meet the mid pipe, then
//   on to the muffler and out of the tailpipe. Every pipe is a pair of delay lines, one each
//   way, and every end reflects part of the wave: the closed exhaust valves, the junction at the
//   collector, the muffler and the open tailpipe end, which reflects the lows inverted and
//   radiates the rest. The pipes' resonances come from their lengths, so unequal headers rumble
//   and a V8 with an exhaust per bank burbles out of a tailpipe on each side. The gas heats up
//   under load, which raises the speed of sound and the resonances with it.
// - Resonances (the older model): two fixed exhaust resonances (formants), a soft saturator and
//   a muffler low pass.
//
// An intake layer adds induction roar: each cylinder draws a suction pulse on its intake
// stroke, with rushing air riding on it, which rings the plenum and the airbox. It grows with
// the throttle and the airflow. The output is stereo: each bank's tailpipe sits on its side, as
// wide as the voice's mix says, and the intake in the middle.
//
// High revs are where a synthetic engine turns harsh, so three things keep them smooth:
// - Each pulse starts between samples, at the exact moment of the firing. Snapping it to the
//   nearest sample is a timing error of up to half a sample, which at 8000 rpm is noise.
// - The random firing timing fades out as the revs and load rise. A real engine's combustion
//   varies most at idle and light load and settles at high revs; random timing there only
//   reads as rasp between the harmonics.
// - Above about 3000 rpm the firing harmonics climb into 2-5 kHz, where hearing is most
//   sensitive. A wide dip there deepens with the revs, and the muffler rolls off at 24 dB per
//   octave rather than 12, so the top end howls instead of buzzing.
//
// The voice arrives as a message (see EngineVoiceConfig in vehicle-audio.ts), the rpm, the
// throttle and the crackle level as AudioParams. vehicle-audio.ts decides when the exhaust
// crackles (after a hard pull, on some lifts) and sets overrun for the length of the burst.
// An electric voice is a few sines at fixed orders of the rpm instead.

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

/** A delay line, read a fractional number of samples back (at least 1) */
class Delay {
	constructor(size) {
		this.buf = new Float32Array(size);
		this.w = 0;
	}

	read(delay) {
		const n = this.buf.length;
		let r = this.w - delay;
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

/** Longest pipe delay (s): 5 m of cold gas */
const MAX_PIPE = 0.012;
/** Speed of sound in the exhaust (m/s), cold at idle and hot at full load */
const GAS_COLD = 440;
const GAS_HOT = 640;
/** Wall losses: what is left of a wave after each run along a pipe, and the low pass on it */
const PIPE_LOSS = 0.985;
const PIPE_CUTOFF = 5000;
/** Admittance of the mid pipe at the collector, relative to one runner: it is wider */
const MID_AREA = 2;
/** Of a wave coming back up the tailpipe, the share the muffler reflects back down it */
const TAIL_REFLECT = 0.3;
/** Below this the open tailpipe end reflects a wave (inverted) rather than radiating it (Hz) */
const OPEN_CUTOFF = 900;
/** Brings the flow out of the tailpipe to about the level the saturator expects */
const PIPE_GAIN = 4;

const onePole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
/** Low pass on the rumble riding on an idle afterfire: low, so the bang is a whump, not a crack */
const BANG_ROUGH = onePole(400);

/** A pipe: a wave travelling each way, both arriving a little duller and weaker */
class Pipe {
	constructor(length) {
		const size = Math.ceil(sampleRate * MAX_PIPE) + 4;
		this.length = length;
		this.ahead = new Delay(size);
		this.back = new Delay(size);
		this.delay = 2;
		this.endLow = 0;
		this.startLow = 0;
	}

	/** Sets the delay for the speed of sound (m/s) */
	setSpeed(c) {
		const max = this.ahead.buf.length - 3;
		this.delay = Math.min(Math.max((this.length / c) * sampleRate, 2), max);
	}

	/** The wave arriving at the far end */
	atEnd(k) {
		this.endLow += k * (this.ahead.read(this.delay) - this.endLow);
		return this.endLow * PIPE_LOSS;
	}

	/** The wave arriving back at the near end */
	atStart(k) {
		this.startLow += k * (this.back.read(this.delay) - this.startLow);
		return this.startLow * PIPE_LOSS;
	}
}

/** An idle afterfire's rise and decay (ms). BANG_ROUGH, with the pipe settings, is the low pass
 * on its rumble. */
const BANG_ATTACK = 1.5;
const BANG_DECAY = 14;
/** Its strength, against a firing at full strength */
const BANG_LEVEL = 0.35;
/** How much weaker the weakest face burns at idle with the regular lope */
const LOPE_DEPTH = 0.85;
/**
 * The lope's feel. A strong burn kicks the shaft faster and a weak one lets it slow (WOBBLE, a
 * share of the speed per firing), so the idle's pitch swings with the lope. Diluted charges burn
 * slowly, so the weakest face fires LATE degrees behind the beat. Each face's strength varies by
 * VARY from cycle to cycle, so no two braps match, and the strong burns are the roughest (RASP,
 * combustion noise on top of the voice's).
 */
const LOPE_WOBBLE = 0.05;
const LOPE_LATE = 15;
const LOPE_VARY = 0.25;
const LOPE_RASP = 0.6;
/**
 * Off idle, for a voice with misfire (the rotary). Coasting on a closed throttle above idle, the
 * port overlap makes the burns uneven again: the lope comes back at COAST_LOPE of its idle depth,
 * and unburnt fuel lights in the exhaust, a pop on COAST_POPS of the firings. Cruising on a
 * light throttle, the faces' differences come through at CRUISE_LOPE of the depth, a growl.
 */
const COAST_LOPE = 0.8;
const COAST_POPS = 0.04;
const CRUISE_LOPE = 0.45;
/** Seconds the shaft speed takes to settle after a kick: the flywheel and the idle control */
const WOBBLE_SETTLE = 0.08;

const decayCoef = (ms) =>
	Math.exp(-1 / (Math.max(ms, 0.01) * 0.001 * sampleRate));

const smoothstep = (a, b, x) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Centre (Hz) and Q of the high-rev dip, and its depth at full revs (0.6 is about -8 dB) */
const PRESENCE_HZ = 3200;
const PRESENCE_Q = 0.8;
const PRESENCE_DEPTH = 0.6;
/** The dip starts at the first rpm and is at full depth by the second */
const PRESENCE_RPM = [3000, 8000];

// Build options (a voice's build), each a change to how the sound is made:
// - blowdown: each pulse rises smoothly as the exhaust valve opens and the cylinder blows down,
//   and the gas rushing out behind it leaves a short suction dip (scavenging), instead of a
//   sharp step and an exponential decay
// - interference: in a bank's shared manifold a pulse that follows the last one closely meets
//   its back pressure and comes out weaker, and one after a long gap stronger. The value is the
//   change at twice or half the even gap.
// - drift: each cylinder's strength wanders slowly from cycle to cycle (its mixture and
//   breathing), by about this share, rather than only at random each firing
// - crossover: the share of each bank's wave that crosses into the other bank's mid pipe, as an
//   H or X pipe joins them
// - chamber: a chambered muffler, an expansion chamber this long (m) after the muffler whose
//   ends reflect, instead of the muffler's low pass alone
// - secondary: a 4-2-1 header. Each bank's runners pair up, alternate firings together (1 and
//   4, 2 and 3 on an inline four), into secondary pipes this long (m), which then meet the mid
//   pipe at the collector
// - honk: the intake tract as a pipe, the runner and the airbox snorkel, closed at the valve
//   and open at the mouth. Each suction pulse rings it, a tone rather than rushing air. The
//   value is its level.
// - cam: the rpm where a second, high lift cam takes over (as VTEC does). Above it the pulses
//   are sharper and stronger and the intake breathes harder.
/** Suction after a blowdown pulse: its depth against the peak, and its span in decay times */
const BLOWDOWN_SUCTION = 0.12;
const BLOWDOWN_SPAN = [2.5, 5];
/** How much of a cylinder's drift it keeps from one firing to its next */
const DRIFT_HOLD = 0.97;
/** Chamber ends: wave in from the narrow pipe, reflected inside, and out into the tailpipe */
const CHAMBER_IN = 0.4;
const CHAMBER_REFLECT = 0.6;
const CHAMBER_OUT = 1.6;
/** Admittance of a 4-2-1 header's secondary pipe, against a runner's */
const SECONDARY_AREA = 1.5;
/** Intake tract length (m), the speed of sound in the cold air in it, and how much of a wave
 * the closed valve and the open mouth reflect */
const TRACT_LENGTH = 0.75;
const TRACT_AIR = 343;
const TRACT_VALVE = 0.9;
const TRACT_MOUTH = 0.8;
/** The high cam: how much shorter its pulses are, how much stronger, and how much louder the
 * intake, all at full changeover. It changes over across CAM_BLEND rpm. */
const CAM_SHARPEN = 0.3;
const CAM_PUNCH = 0.25;
const CAM_INTAKE = 0.8;
const CAM_BLEND = 300;

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
			{
				// Crackle burst level, 0 none to 1 a lift from a fully hot exhaust
				name: 'overrun',
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
		// Two stages of a fourth order Butterworth low pass
		this.muffler = new Svf();
		this.muffler2 = new Svf();
		this.presence = new Svf();
		this.presence.set(PRESENCE_HZ, PRESENCE_Q);
		this.pop = 0;
		// An idle misfire's afterfire: a slow push of pressure in the exhaust (rise and decay), and
		// the low rumble riding on it
		this.bangX = 0;
		this.bangY = 0;
		this.rumble = 0;
		this.dcIn = 0;
		this.dcOut = 0;
		// Pipes: an exhaust system per bank, and the header runner each cylinder breathes out of
		this.banks = [];
		this.runners = [];
		this.gasHeat = 0;
		// Exhaust built up in the chambers at idle, and the level at which the next charge fails
		this.residual = 0;
		this.threshold = 1;
		// The lope's kicks to the shaft speed, as a share of it, and the average face's weakness
		this.wobble = 0;
		this.meanLope = 0;
		// Crank degrees turned since the start, and each bank's last firing on it (interference)
		this.crank = 0;
		this.bankFired = [];
		// The intake tract (honk), and the low pass on the wave at its open mouth
		this.tract = new Pipe(TRACT_LENGTH);
		this.tractLow = 0;
		this.plenum = new Svf();
		this.airbox = new Svf();
		this.airbox.set(1100, 0.7);
		this.phases = [];
		this.port.onmessage = (event) => this.configure(event.data);
	}

	configure(voice) {
		this.voice = voice;
		if (!voice) return;
		const pipes = voice.pipes;
		const cycle = voice.cycle ?? 720;
		this.theta %= cycle;
		this.cylinders = voice.firing.map(([angle, gain], i) => {
			const old = this.cylinders[i];
			return {
				gain,
				// Crank degrees to this cylinder's next firing, and its random timing offset
				due: (((angle - this.theta) % cycle) + cycle) % cycle,
				offset: 0,
				x: old ? old.x : 0,
				y: old ? old.y : 0,
				// The runner it breathes out of, and its intake stroke: crank degrees to the
				// suction pulse (negative while none is due) and the pulse itself
				runner: pipes ? (pipes.port?.[i] ?? i) : 0,
				intakeDue: -1,
				ix: 0,
				iy: 0,
				// How much weaker it burns at idle, for the regular lope
				lope: voice.lope?.[i] ?? 0,
				// Combustion roughness on its current pulse, from the lope
				rasp: 0,
				// Its bank, its slow drift in strength, and a blowdown pulse's age (samples, -1
				// for none) and strength
				bank: pipes ? (pipes.runners[pipes.port?.[i] ?? i]?.[1] ?? 0) : 0,
				drift: old ? old.drift : 0,
				age: -1,
				amp: 0,
			};
		});
		this.meanLope = voice.lope
			? voice.lope.reduce((a, b) => a + b, 0) / voice.lope.length
			: 0;
		this.banks = [];
		this.runners = [];
		if (pipes) {
			const bankCount = Math.max(...pipes.runners.map(([, bank]) => bank)) + 1;
			for (let b = 0; b < bankCount; b++) {
				this.banks.push({
					runners: [],
					mid: new Pipe(pipes.mid),
					tail: new Pipe(pipes.tail),
					muffler: new Svf(),
					muffler2: new Svf(),
					presence: new Svf(),
					openLow: 0,
					chamber: new Pipe(voice.build?.chamber || 0.3),
					midIn: 0,
					dcIn: 0,
					dcOut: 0,
					left: 1,
					right: 1,
				});
			}
			this.bankFired = this.banks.map(() => -1e9);
			for (const [length, bank] of pipes.runners) {
				const runner = { pipe: new Pipe(length), push: 0, atCollector: 0 };
				this.runners.push(runner);
				this.banks[bank].runners.push(runner);
			}
			// A 4-2-1 header pairs each bank's runners, alternate firings together
			for (const bank of this.banks) {
				bank.secondaries = [];
				if (!voice.build?.secondary) continue;
				for (let g = 0; g < Math.min(2, bank.runners.length); g++)
					bank.secondaries.push({
						pipe: new Pipe(voice.build.secondary),
						runners: bank.runners.filter((_, j) => j % 2 === g),
						atEnd: 0,
					});
			}
			// Each bank's tailpipe sits on its side of the stereo picture, at equal power
			const width = voice.mix?.width ?? 0;
			this.banks.forEach((bank, b) => {
				const position = bankCount > 1 ? (b === 0 ? -width : width) : 0;
				const angle = ((position + 1) * Math.PI) / 4;
				bank.left = Math.SQRT2 * Math.cos(angle);
				bank.right = Math.SQRT2 * Math.sin(angle);
				bank.presence.set(PRESENCE_HZ, PRESENCE_Q);
			});
		}
		if (voice.intake) this.plenum.set(voice.intake.hz, 2.5);
		this.tract.setSpeed(TRACT_AIR);
		this.pulseScale = -1;
		this.kPop = decayCoef(14);
		this.kBangAttack = decayCoef(BANG_ATTACK);
		this.kBangDecay = decayCoef(BANG_DECAY);
		this.formant1.set(voice.formants[0][0], voice.formants[0][1]);
		this.formant2.set(voice.formants[1][0], voice.formants[1][1]);
		this.phases = (voice.whine ?? []).map((_, i) => this.phases[i] ?? 0);
	}

	process(_inputs, outputs, parameters) {
		const out = outputs[0][0];
		if (!out) return true;
		const right = outputs[0][1] ?? null;
		const v = this.voice;
		if (!v) {
			out.fill(0);
			right?.fill(0);
			return true;
		}
		const rpm = parameters.rpm[0];
		const throttle = parameters.throttle[0];
		const overrun = parameters.overrun[0];

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
			right?.set(out);
			return true;
		}

		const mufflerHz = v.muffler * (1 + v.mufflerOpen * throttle);
		this.muffler.set(mufflerHz, 0.541);
		this.muffler2.set(mufflerHz, 1.307);
		// A voice can keep more of its top end (presence below 1): the rotary's scream
		const presence =
			PRESENCE_DEPTH *
			(v.presence ?? 1) *
			smoothstep(PRESENCE_RPM[0], PRESENCE_RPM[1], rpm);
		// Combustion steadies with revs and load: full jitter at idle, a fifth of it at 7500 rpm
		const steady =
			Math.min(Math.max(1500 / Math.max(rpm, 300), 0.2), 1) *
			(1 - 0.4 * throttle);
		const jitter = v.jitter * steady;
		const ampJitter = v.ampJitter * (0.4 + 0.6 * steady);
		// An exhaust pulse lasts a fixed number of crank degrees, so above 2500 rpm it shortens with
		// the rpm. Otherwise the pulses would overlap into a steady pressure at high revs.
		// The high cam, past its changeover, makes them shorter still
		const camOn = v.build?.cam
			? smoothstep(
					v.build.cam - CAM_BLEND / 2,
					v.build.cam + CAM_BLEND / 2,
					rpm,
				)
			: 0;
		const pulseScale =
			Math.min(1, 2500 / Math.max(rpm, 300)) * (1 - CAM_SHARPEN * camOn);
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
		const load = (0.5 + 0.5 * throttle) * (1 + CAM_PUNCH * camOn);
		const step = (rpm * 6) / sampleRate; // degrees of crank per sample
		const [, , gain1] = v.formants[0];
		const [, , gain2] = v.formants[1];
		const drive = Math.max(v.drive, 0.05);
		const usePipes = v.exhaust === 'pipes' && this.banks.length > 0;
		const p = v.pipes;
		if (usePipes) {
			// The gas heats with the load over a second or two, and sound runs faster in hot gas
			const target = Math.min(rpm / 7000, 1.2) * (0.3 + 0.7 * throttle);
			this.gasHeat +=
				(target - this.gasHeat) * Math.min(out.length / sampleRate / 1.5, 1);
			const c = GAS_COLD + (GAS_HOT - GAS_COLD) * Math.min(this.gasHeat, 1);
			for (const r of this.runners) r.pipe.setSpeed(c);
			for (const bank of this.banks) {
				bank.mid.setSpeed(c);
				bank.tail.setSpeed(c);
				bank.chamber.setSpeed(c);
				for (const sec of bank.secondaries) sec.pipe.setSpeed(c);
				bank.muffler.set(mufflerHz, 0.541);
				bank.muffler2.set(mufflerHz, 1.307);
			}
		}
		const kPipe = onePole(PIPE_CUTOFF);
		const kOpen = onePole(OPEN_CUTOFF);
		// Intake: suction pulses longer than the exhaust's, through a throttle plate that lets
		// more of them reach the airbox as it opens, and louder as more air flows
		const intake = v.intake && v.intake.level > 0 ? v.intake : null;
		const intakeLevel = intake
			? intake.level *
				(v.mix?.intake ?? 1) *
				(0.15 + 0.85 * throttle) *
				(0.3 + 0.7 * Math.min(rpm / 6000, 1.2)) *
				(1 + CAM_INTAKE * camOn)
			: 0;
		const cycle = v.cycle ?? 720;
		// The bursts belong to idle and light load: none above 3200 rpm or near full throttle,
		// where the flow through the ports scavenges the chambers
		const idling = (1 - smoothstep(1100, 3200, rpm)) * (1 - 0.8 * throttle);
		const misfire = (v.misfire ?? 0) * idling;
		const style = v.brap ?? 'lope';
		// Off idle: coasting on a closed throttle above idle, and cruising on a light one
		const uneven = (v.misfire ?? 0) > 0;
		const coasting = uneven
			? (1 - smoothstep(0.02, 0.15, throttle)) *
				smoothstep(1500, 2600, rpm) *
				(1 - smoothstep(6500, 8500, rpm))
			: 0;
		const cruising = uneven
			? smoothstep(2200, 3500, rpm) *
				smoothstep(0.1, 0.25, throttle) *
				(1 - smoothstep(0.5, 0.85, throttle))
			: 0;
		// How strongly the lope's pattern comes through: fully at idle, partly off it. A voice with
		// a lope and no misfire (a V8 on a big cam) only lopes at idle.
		const lopeIn = uneven
			? Math.max(idling, COAST_LOPE * coasting, CRUISE_LOPE * cruising)
			: v.lope
				? idling
				: 0;
		const loping = lopeIn > 0 && (style === 'lope' || style === 'mixed');
		const kWobble = Math.exp(-1 / (WOBBLE_SETTLE * sampleRate));
		const kIntakeAttack = decayCoef(0.5 * pulseScale);
		const kIntakeDecay = decayCoef(3.5 * pulseScale);
		const build = v.build ?? {};
		const msToSamples = 0.001 * sampleRate;
		const riseTime = 1.5 * v.attack * pulseScale * msToSamples;
		const decayTime = v.decay * pulseScale * msToSamples;
		const suctionStart = BLOWDOWN_SPAN[0] * decayTime;
		const suctionLength = (BLOWDOWN_SPAN[1] - BLOWDOWN_SPAN[0]) * decayTime;
		// The even gap between a bank's firings
		const evenGap =
			(cycle * this.banks.length) / Math.max(this.cylinders.length, 1);

		for (let s = 0; s < out.length; s++) {
			// The shaft runs a little faster or slower than the rpm as the lope kicks it
			const turn = step * (1 + this.wobble);
			this.wobble *= kWobble;
			this.theta += turn;
			if (this.theta >= cycle) this.theta -= cycle;
			this.crank += turn;

			let sum = 0;
			let suction = 0;
			for (const r of this.runners) r.push = 0;
			for (const c of this.cylinders) {
				c.due -= turn;
				if (intake && c.intakeDue >= 0) {
					c.intakeDue -= turn;
					if (c.intakeDue < 0) {
						const late = -c.intakeDue / turn;
						c.ix += c.gain * kIntakeDecay ** late;
						c.iy += c.gain * kIntakeAttack ** late;
					}
				}
				if (c.due <= 0) {
					let amp = c.gain * load * (1 + ampJitter * (Math.random() * 2 - 1));
					if (overrun > 0 && Math.random() < v.crackle * overrun) {
						amp *= 2;
						this.pop = Math.max(this.pop, 0.5 + 0.7 * Math.random());
					}
					c.rasp = 0;
					if (loping) {
						// Regular lope: the faces burn at their own strengths, a pattern that repeats
						// every cycle, a little differently each time
						const weak = c.lope * (1 + LOPE_VARY * (Math.random() * 2 - 1));
						amp *= 1 - LOPE_DEPTH * lopeIn * weak;
						// Only at idle is the shaft slow enough for a burn to kick its speed audibly
						this.wobble +=
							LOPE_WOBBLE * LOPE_DEPTH * idling * (this.meanLope - weak);
						c.rasp = LOPE_RASP * lopeIn * Math.max(1 - weak, 0);
					}
					if (coasting > 0 && Math.random() < COAST_POPS * coasting) {
						// Coasting: unburnt fuel lights in the exhaust, mostly a round pop, now and then
						// with a crackle on it
						const bang = BANG_LEVEL * (0.5 + 0.6 * Math.random()) * coasting;
						this.bangX += bang;
						this.bangY += bang;
						if (Math.random() < 0.3)
							this.pop = Math.max(this.pop, 0.25 * Math.random());
					}
					if (misfire > 0 && (style === 'skips' || style === 'mixed')) {
						// Now and then a firing drops out, leaving a gap
						const chance = (style === 'skips' ? 1.1 : 0.35) * misfire;
						if (Math.random() < chance) amp *= 0.03;
					}
					if (misfire > 0 && style === 'bursts') {
						if (this.residual >= this.threshold) {
							// Too diluted to light: the charge bangs in the exhaust and the chamber clears
							amp *= 0.08;
							const bang = BANG_LEVEL * (0.8 + 0.5 * Math.random()) * idling;
							this.bangX += bang;
							this.bangY += bang;
							this.residual = 0;
							this.threshold = 0.7 + 0.6 * Math.random();
						} else {
							// Weaker as the exhaust builds up, slowly at first
							amp *= 1 - 0.65 * idling * (this.residual / this.threshold) ** 2;
							// A strong burn leaves more exhaust behind
							this.residual += misfire * (0.5 + Math.random());
						}
					}
					if (build.drift) {
						// A slow random walk, about unit size
						const step =
							(Math.random() + Math.random() + Math.random() - 1.5) * 2;
						c.drift =
							DRIFT_HOLD * c.drift + Math.sqrt(1 - DRIFT_HOLD ** 2) * step;
						amp *= Math.max(1 + build.drift * c.drift, 0.2);
					}
					if (build.interference && this.bankFired.length > 0) {
						// The crank angle the firing happened at, and the gap since the bank's last
						const at = this.crank + c.due;
						const gap = at - this.bankFired[c.bank];
						this.bankFired[c.bank] = at;
						const t = Math.min(Math.max(Math.log2(gap / evenGap), -1), 1);
						amp *= 1 + build.interference * t;
					}
					// The firing happened part way through this sample: start the pulse that far along
					const late = -c.due / turn;
					if (build.blowdown) {
						c.age = late;
						c.amp = amp;
					} else {
						c.x += amp * this.kDecay ** late;
						c.y += amp * this.kAttack ** late;
					}
					// Next cycle, with a new timing offset. Counting down a whole cycle means a firing
					// can never repeat within one, whatever the jitter.
					// A weak face of the lope fires late, behind the beat
					const offset =
						jitter * (Math.random() * 2 - 1) +
						(loping ? LOPE_LATE * lopeIn * c.lope : 0);
					c.due += cycle + offset - c.offset;
					c.offset = offset;
					// The intake valve opens near the top of the exhaust stroke, and the pull peaks
					// partway down the intake stroke
					c.intakeDue = c.due - (cycle - 450);
				}
				let shape = c.x - c.y;
				if (c.age >= 0) {
					// Blowdown: a smooth rise and a decay, then the scavenging suction
					const t = c.age;
					const rise = 1 - Math.exp(-t / riseTime);
					shape = rise * rise * Math.exp(-t / decayTime);
					const u = (t - suctionStart) / suctionLength;
					if (u > 0 && u < 1)
						shape -= BLOWDOWN_SUCTION * 0.5 * (1 - Math.cos(2 * Math.PI * u));
					shape *= c.amp;
					c.age = u >= 1 ? -1 : t + 1;
				}
				const pulse =
					c.rasp > 0 ? shape * (1 + c.rasp * (Math.random() * 2 - 1)) : shape;
				sum += pulse;
				if (usePipes) this.runners[c.runner].push += pulse;
				c.x *= this.kDecay;
				c.y *= this.kAttack;
				if (intake) {
					suction += c.ix - c.iy;
					c.ix *= kIntakeDecay;
					c.iy *= kIntakeAttack;
				}
			}

			const noise = Math.random() * 2 - 1;
			// Overrun crackle is sharp: noise bursts. An idle afterfire is round: a slow push of
			// pressure with a low rumble on it, which rings the pipes.
			this.rumble += BANG_ROUGH * (noise - this.rumble);
			const afterfire = (this.bangX - this.bangY) * (1 + 2.5 * this.rumble);
			this.bangX *= this.kBangDecay;
			this.bangY *= this.kBangAttack;
			const pop = this.pop * noise + afterfire;
			this.pop *= this.kPop;
			const gain = v.level * rateGain;

			// Intake roar: the suction pulses and the air rushing in with them, ringing the plenum
			// and dulled by the airbox
			let air = 0;
			if (intake) {
				const roar = suction * (0.35 + 0.9 * (Math.random() * 2 - 1));
				this.plenum.run(roar);
				this.airbox.run(roar);
				air = (this.plenum.band + 0.5 * this.airbox.low) * intakeLevel * gain;
				if (build.honk) {
					// The tract: the suction pulls at the valve end, and the open mouth reflects the
					// lows back inverted and radiates the rest
					const mouth = this.tract.atEnd(kPipe);
					const valveEnd = this.tract.atStart(kPipe);
					this.tract.ahead.write(TRACT_VALVE * valveEnd - suction);
					this.tractLow += kOpen * (mouth - this.tractLow);
					const reflected = -TRACT_MOUTH * this.tractLow;
					this.tract.back.write(reflected);
					air += build.honk * (mouth - reflected) * intakeLevel * gain;
				}
			}

			if (!usePipes) {
				const excitation = sum * (1 + v.noise * noise) + pop;
				this.formant1.run(excitation);
				this.formant2.run(excitation);
				let y =
					excitation * v.dry +
					this.formant1.band * gain1 +
					this.formant2.band * gain2;
				y = Math.tanh(y * drive) / drive;
				this.muffler.run(y);
				this.muffler2.run(this.muffler.low);
				y = this.muffler2.low;
				if (presence > 0) {
					this.presence.run(y);
					y -= presence * this.presence.band;
				}

				// DC blocker: the pulses only push, so their average is not zero
				const dc = y - this.dcIn + 0.995 * this.dcOut;
				this.dcIn = y;
				this.dcOut = dc;
				out[s] = dc * gain + air;
				if (right) right[s] = out[s];
				continue;
			}

			// Pipes: an exhaust system per bank
			const grit = 1 + v.noise * noise;
			let left = air;
			let rightSum = air;
			for (const bank of this.banks) {
				const runners = bank.runners;
				let arriving = 0;
				for (const r of runners) {
					r.atCollector = r.pipe.atEnd(kPipe);
					arriving += r.atCollector;
				}
				const midAtMuffler = bank.mid.atEnd(kPipe);
				const midAtCollector = bank.mid.atStart(kPipe);
				const tailAtEnd = bank.tail.atEnd(kPipe);
				const tailAtMuffler = bank.tail.atStart(kPipe);

				let joint;
				if (bank.secondaries.length > 0) {
					// 4-2-1: each pair of runners meets its secondary pipe at one pressure, and the
					// secondaries meet the mid pipe at the collector
					let fromSecondaries = 0;
					for (const sec of bank.secondaries) {
						sec.atEnd = sec.pipe.atEnd(kPipe);
						fromSecondaries += sec.atEnd;
					}
					joint =
						(2 *
							(SECONDARY_AREA * fromSecondaries + MID_AREA * midAtCollector)) /
						(SECONDARY_AREA * bank.secondaries.length + MID_AREA);
					for (const sec of bank.secondaries) {
						const back = sec.pipe.atStart(kPipe);
						let inflow = 0;
						for (const r of sec.runners) inflow += r.atCollector;
						const merge =
							(2 * (inflow + SECONDARY_AREA * back)) /
							(sec.runners.length + SECONDARY_AREA);
						for (const r of sec.runners) {
							const atValve = r.pipe.atStart(kPipe);
							r.pipe.back.write(merge - r.atCollector);
							r.pipe.ahead.write(r.push * grit + p.valve * atValve);
						}
						sec.pipe.ahead.write(merge - back);
						sec.pipe.back.write(joint - sec.atEnd);
					}
				} else {
					// Collector: the runners and the wider mid pipe meet at one pressure
					joint =
						(2 * (arriving + MID_AREA * midAtCollector)) /
						(runners.length + MID_AREA);
					for (const r of runners) {
						// At the valve end the closed valve reflects, and the cylinder pushes its pulse
						// in
						const atValve = r.pipe.atStart(kPipe);
						r.pipe.back.write(joint - r.atCollector);
						r.pipe.ahead.write(r.push * grit + p.valve * atValve);
					}
				}
				// Overrun pops are fuel lighting in the hot pipe past the collector. The write waits
				// until every bank is done, in case a crossover mixes them.
				bank.midIn = joint - midAtCollector + 2 * pop;

				// Muffler: part of the wave reflects back up the mid pipe and the rest passes its low
				// pass into the tailpipe. A wave coming back up the tailpipe mostly dies in it.
				bank.muffler.run(midAtMuffler);
				bank.muffler2.run(bank.muffler.low);
				bank.mid.back.write(p.reflect * midAtMuffler);
				let muffled = bank.muffler2.low;
				if (build.chamber) {
					// Chambered: the wave rings between the chamber's ends on its way through
					const chamberEnd = bank.chamber.atEnd(kPipe);
					const chamberStart = bank.chamber.atStart(kPipe);
					bank.chamber.ahead.write(
						CHAMBER_IN * muffled + CHAMBER_REFLECT * chamberStart,
					);
					bank.chamber.back.write(CHAMBER_REFLECT * chamberEnd);
					muffled = CHAMBER_OUT * chamberEnd;
				}
				bank.tail.ahead.write(
					(1 - 0.5 * p.reflect) * muffled + TAIL_REFLECT * tailAtMuffler,
				);

				// Open end: the lows reflect back inverted, and the gas flowing out radiates. The flow
				// is the arriving wave minus the reflected one, so the lows the pipe keeps ringing
				// with also come out strongest, as the bass of a real exhaust does.
				bank.openLow += kOpen * (tailAtEnd - bank.openLow);
				const reflected = -p.open * bank.openLow;
				bank.tail.back.write(reflected);
				const flow = (tailAtEnd - reflected) * PIPE_GAIN;

				// The steady part of the flow goes first: long pulses that overlap at high revs
				// push a steady pressure, which would hold the saturator in its flat top
				let y = flow - bank.dcIn + 0.995 * bank.dcOut;
				bank.dcIn = flow;
				bank.dcOut = y;
				y = Math.tanh(y * drive) / drive;
				if (presence > 0) {
					bank.presence.run(y);
					y -= presence * bank.presence.band;
				}
				// The pipes keep ringing between pulses, so they need none of the rate make-up gain
				const voiced = y * v.level * p.level;
				left += voiced * bank.left;
				rightSum += voiced * bank.right;
			}
			const cross = this.banks.length === 2 ? (build.crossover ?? 0) : 0;
			const [b0, b1] = this.banks;
			if (cross > 0) {
				b0.mid.ahead.write((1 - cross) * b0.midIn + cross * b1.midIn);
				b1.mid.ahead.write((1 - cross) * b1.midIn + cross * b0.midIn);
			} else for (const bank of this.banks) bank.mid.ahead.write(bank.midIn);
			if (right) {
				out[s] = left;
				right[s] = rightSum;
			} else out[s] = (left + rightSum) / 2;
		}
		return true;
	}
}

registerProcessor('vehicle-engine', VehicleEngineProcessor);
