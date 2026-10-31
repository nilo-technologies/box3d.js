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
		// Shock steepening: how much faster a wave runs ahead per unit of its pressure
		this.steep = 0;
	}

	/** Sets the delay for the speed of sound (m/s) */
	setSpeed(c) {
		const max = this.ahead.buf.length - 3;
		this.base = Math.min(Math.max((this.length / c) * sampleRate, 2), max);
		this.delay = this.base;
	}

	/** The wave arriving at the far end */
	atEnd(k) {
		// A steepening pipe carries high pressure faster, so it arrives sooner
		const delay = this.steep
			? Math.min(
					Math.max(this.delay * (1 - this.steep * this.endLow), 2),
					this.ahead.buf.length - 3,
				)
			: this.delay;
		this.endLow += k * (this.ahead.read(delay) - this.endLow);
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
// - itb: individual throttle bodies. Each cylinder breathes through a short trumpet of its own,
//   open to the air, and its suction pulse rings it: the howl of a race intake. The value is its
//   level.
// - flap: the rpm where an exhaust flap opens past the muffler on a firm throttle, so the
//   exhaust runs straight through, with the muffler's low pass and reflection mostly gone
// - steepen: shock steepening. Sound runs faster in the high pressure of a loud pulse, so each
//   pulse's front catches up with its foot as it runs down the runners, the secondaries and the
//   mid pipe, and sharpens toward a shock at full throttle: a race exhaust's rasp. The value is
//   the share by which a pulse of unit pressure runs faster.
// - combustion: real combustion varies from cycle to cycle at any revs and load, in strength by
//   about this share and in when it burns by about 30 times it in crank degrees, unlike the
//   voice's jitter, which fades out as the revs rise
// - heat: each pulse is a slug of hot gas, and sound runs faster in it, by this share for a
//   pulse of unit strength. It warms its runner and then its bank's mid pipe and cools within
//   milliseconds, so the pipes' resonances move with every pulse instead of standing still.
// - turbulence: noise from the flows mixing where the runners meet, as strong as the flow
//   arriving, so it rides on the pulses and rings the exhaust's own resonances
// - unthrottled: a diesel's breathing. No throttle plate, so the intake draws full air at any
//   throttle, and the fuel alone sets the power, so off throttle the cylinders only pump air and
//   the exhaust pulses nearly vanish
// - turbine: a turbo's turbine right after the collector, taking this share of energy out of
//   each pulse's peak and smoothing what passes, more as the load and the revs build boost
// - filter: a particulate filter before the muffler, porous ceramic that absorbs the mids and
//   highs by this share and reflects less
// - knockEdge: a diesel's combustion knock on the front of each pulse, a short sharp spike of
//   this strength against the pulse, loudest at light load. It runs through the exhaust with the
//   pulse.
// - quad: each bank's exhaust splits after the muffler into two tailpipes, the second this many
//   times as long as the first, so two sets of tailpipe resonances layer
// - intakeSwitch: the rpm where variable intake runners switch the throttle bodies' trumpets
//   from long to short, retuning the intake (needs itb)
// - megaphone: a collector that widens like a cone this long (m) between the runners and the mid
//   pipe, rather than a sharp junction. Each step in its width reflects a little, so it sends a
//   soft, spread out suction wave back up the runners instead of one sharp one.
// - tolerance: no two cylinders are made quite the same. Each runner is up to this many metres
//   longer or shorter, and each cylinder burns up to 1.5 times this share stronger or weaker,
//   the same every time the engine runs.
// - spacing: how far apart the tailpipes are (m). Each bank's tailpipe reaches the far ear later
//   than the near one, as well as quieter.
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
/** Intake trumpet length (m) for individual throttle bodies */
const TRUMPET_LENGTH = 0.3;
/** The exhaust flap opens over this many rpm either side of its rpm, and from this throttle
 * to the next; it takes FLAP_TIME s to swing. Through it, the straight pipe's low pass (Hz). */
const FLAP_RPM = 500;
const FLAP_THROTTLE = [0.3, 0.7];
const FLAP_TIME = 0.25;
const FLAP_CUTOFF = 4000;
/** Speed of sound in the air between the tailpipes and the listener (m/s) */
const AIR_SPEED = 343;
/** How long a runner's and a mid pipe's slug of hot gas lasts (ms at 2500 rpm and below) */
const HOT_RUNNER = 6;
const HOT_MID = 15;
/** The megaphone's sections and their widths (admittance against a runner), from the runners
 * to the mid pipe */
const MEGAPHONE_AREAS = [1.2, 1.8, 2.7, 4];
/** Of the muffler's output, the share each of a quad exhaust's two tailpipes takes */
const QUAD_SPLIT = 0.5;
/** Unthrottled: the pulses' strength off throttle once the fuel is cut, against full, and the
 * rpm span over which it cuts on the overrun (at idle the engine still burns idle fuel) */
const UNTHROTTLED_CUT = 0.12;
const FUEL_CUT_RPM = [1100, 1600];
/** The turbine: how hard it squashes a pulse's peak, the low pass on what passes (Hz), and the
 * share of its effect with no boost */
const TURBINE_SQUASH = 1.5;
const TURBINE_CUTOFF = 1200;
const TURBINE_IDLE = 0.3;
/** The particulate filter's low pass (Hz) and how much of the muffler's reflection it takes */
const FILTER_CUTOFF = 700;
const FILTER_ABSORB = 0.5;
/** The knock edge: how long the spike lasts (ms), and how much weaker it is at full throttle */
const KNOCK_EDGE_TIME = 0.15;
const KNOCK_EDGE_LOAD = 0.55;
/** Variable intake: the trumpets' long and short lengths (m), and the rpm span of the switch */
const TRUMPET_LONG = 0.45;
const TRUMPET_SHORT = 0.25;
const SWITCH_RPM = 300;
/** A fixed number from -1 to 1 for each index, the same every run */
const fixed = (i) => {
	const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
	return 2 * (x - Math.floor(x)) - 1;
};
/** About unit size, about normally distributed */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

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
		// How far the exhaust flap is open, 0 to 1
		this.flapOpen = 0;
		this.plenum = new Svf();
		this.airbox = new Svf();
		this.airbox.set(1100, 0.7);
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
				gain: gain * (1 + 1.5 * (voice.build?.tolerance ?? 0) * fixed(i)),
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
				// Its intake trumpet (individual throttle bodies) and its suction pulse now
				trumpet: old?.trumpet ?? new Pipe(TRUMPET_LENGTH),
				trumpetLow: 0,
				suck: 0,
				// The knock edge on its current pulse
				edge: 0,
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
					mid: Object.assign(new Pipe(pipes.mid), {
						steep: voice.build?.steepen ?? 0,
					}),
					tail: new Pipe(pipes.tail),
					tail2: voice.build?.quad
						? new Pipe(pipes.tail * voice.build.quad)
						: null,
					openLow2: 0,
					turbineLow: 0,
					filterLow: 0,
					muffler: new Svf(),
					muffler2: new Svf(),
					presence: new Svf(),
					openLow: 0,
					bypassLow: 0,
					index: b,
					hot: 0,
					farEar: new Delay(Math.ceil(sampleRate * 0.012) + 2),
					chamber: new Pipe(voice.build?.chamber || 0.3),
					midIn: 0,
					dcIn: 0,
					dcOut: 0,
					left: 1,
					right: 1,
				});
			}
			this.bankFired = this.banks.map(() => -1e9);
			for (const [j, [length, bank]] of pipes.runners.entries()) {
				const tolerance = (voice.build?.tolerance ?? 0) * fixed(j + 100);
				const runner = {
					pipe: new Pipe(length + tolerance),
					push: 0,
					atCollector: 0,
					hot: 0,
				};
				runner.pipe.steep = voice.build?.steepen ?? 0;
				this.runners.push(runner);
				this.banks[bank].runners.push(runner);
			}
			// A 4-2-1 header pairs each bank's runners, alternate firings together
			for (const bank of this.banks) {
				const megaphone = voice.build?.megaphone ?? 0;
				bank.cone = megaphone
					? MEGAPHONE_AREAS.map((area) => ({
							area,
							pipe: new Pipe(megaphone / MEGAPHONE_AREAS.length),
						}))
					: [];
				bank.secondaries = [];
				if (!voice.build?.secondary) continue;
				for (let g = 0; g < Math.min(2, bank.runners.length); g++)
					bank.secondaries.push({
						pipe: Object.assign(new Pipe(voice.build.secondary), {
							steep: voice.build.steepen ?? 0,
						}),
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
		for (const c of this.cylinders) c.trumpet.setSpeed(TRACT_AIR);
		this.pulseScale = -1;
		this.kPop = decayCoef(14);
		this.kBangAttack = decayCoef(BANG_ATTACK);
		this.kBangDecay = decayCoef(BANG_DECAY);
		this.formant1.set(voice.formants[0][0], voice.formants[0][1]);
		this.formant2.set(voice.formants[1][0], voice.formants[1][1]);
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
		// Pulses are weaker off throttle, as the engine is pumping air rather than burning fuel. An
		// unthrottled diesel cuts its fuel on the overrun, so coasting it barely pulses at all.
		const offThrottle = v.build?.unthrottled
			? 0.5 -
				(0.5 - UNTHROTTLED_CUT) *
					smoothstep(FUEL_CUT_RPM[0], FUEL_CUT_RPM[1], rpm)
			: 0.5;
		const load =
			(v.build?.unthrottled
				? offThrottle + (1 - offThrottle) * throttle
				: 0.5 + 0.5 * throttle) *
			(1 + CAM_PUNCH * camOn);
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
				bank.tail2?.setSpeed(c);
				bank.chamber.setSpeed(c);
				for (const sec of bank.secondaries) sec.pipe.setSpeed(c);
				for (const section of bank.cone) section.pipe.setSpeed(c);
				bank.muffler.set(mufflerHz, 0.541);
				bank.muffler2.set(mufflerHz, 1.307);
			}
		}
		const kPipe = onePole(PIPE_CUTOFF);
		const heat = v.build?.heat ?? 0;
		const kHotRunner = decayCoef(HOT_RUNNER * pulseScale);
		const kHotMid = decayCoef(HOT_MID * pulseScale);
		const turbulence = v.build?.turbulence ?? 0;
		const kOpen = onePole(OPEN_CUTOFF);
		const kBypass = onePole(FLAP_CUTOFF);
		const kTurbine = onePole(TURBINE_CUTOFF);
		const kFilter = onePole(FILTER_CUTOFF);
		const kEdge = decayCoef(KNOCK_EDGE_TIME);
		// The turbine works harder as the boost builds with the load and the revs
		const turbine = v.build?.turbine
			? v.build.turbine *
				(TURBINE_IDLE +
					(1 - TURBINE_IDLE) * throttle * smoothstep(1200, 2500, rpm))
			: 0;
		const filter = v.build?.filter ?? 0;
		const knockEdge = v.build?.knockEdge
			? v.build.knockEdge * (1 - KNOCK_EDGE_LOAD * throttle)
			: 0;
		if (v.build?.intakeSwitch) {
			// Variable intake: long trumpets low down, short ones up top
			const shortOn = smoothstep(
				v.build.intakeSwitch - SWITCH_RPM,
				v.build.intakeSwitch + SWITCH_RPM,
				rpm,
			);
			for (const c of this.cylinders) {
				c.trumpet.length =
					TRUMPET_LONG + (TRUMPET_SHORT - TRUMPET_LONG) * shortOn;
				c.trumpet.setSpeed(TRACT_AIR);
			}
		}
		// The flap swings toward open on a firm throttle above its rpm
		const flapTarget = v.build?.flap
			? smoothstep(v.build.flap - FLAP_RPM, v.build.flap + FLAP_RPM, rpm) *
				smoothstep(FLAP_THROTTLE[0], FLAP_THROTTLE[1], throttle)
			: 0;
		this.flapOpen +=
			(flapTarget - this.flapOpen) *
			Math.min(out.length / sampleRate / FLAP_TIME, 1);
		const flap = this.flapOpen;
		// The far ear's delay (samples), for a V's two tailpipes
		const spacing =
			this.banks.length === 2 && v.build?.spacing
				? Math.min(
						Math.max((v.build.spacing / AIR_SPEED) * sampleRate, 1),
						sampleRate * 0.012,
					)
				: 0;
		// Intake: suction pulses longer than the exhaust's, through a throttle plate that lets
		// more of them reach the airbox as it opens, and louder as more air flows
		const intake = v.intake && v.intake.level > 0 ? v.intake : null;
		const intakeLevel = intake
			? intake.level *
				(v.mix?.intake ?? 1) *
				(v.build?.unthrottled ? 1 : 0.15 + 0.85 * throttle) *
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
					if (build.combustion)
						amp *= Math.max(1 + build.combustion * gauss(), 0.2);
					if (heat && usePipes) {
						// Its slug of hot gas warms its runner, and later its bank's mid pipe
						const runner = this.runners[c.runner];
						runner.hot += amp;
						this.banks[c.bank].hot +=
							amp / Math.max(this.banks[c.bank].runners.length, 1);
					}
					if (knockEdge) c.edge += knockEdge * amp;
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
						(loping ? LOPE_LATE * lopeIn * c.lope : 0) +
						(build.combustion ? 30 * build.combustion * gauss() : 0);
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
				let pulse =
					c.rasp > 0 ? shape * (1 + c.rasp * (Math.random() * 2 - 1)) : shape;
				if (c.edge) {
					// The knock's sharp spike on the front of the pulse
					pulse += c.edge;
					c.edge *= kEdge;
				}
				sum += pulse;
				if (usePipes) this.runners[c.runner].push += pulse;
				c.x *= this.kDecay;
				c.y *= this.kAttack;
				if (intake) {
					c.suck = c.ix - c.iy;
					suction += c.suck;
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
				if (build.itb) {
					// A trumpet per cylinder, each rung by its own suction pulse
					let howl = 0;
					for (const c of this.cylinders) {
						const mouth = c.trumpet.atEnd(kPipe);
						const valveEnd = c.trumpet.atStart(kPipe);
						c.trumpet.ahead.write(TRACT_VALVE * valveEnd - c.suck);
						c.trumpetLow += kOpen * (mouth - c.trumpetLow);
						const reflected = -TRACT_MOUTH * c.trumpetLow;
						c.trumpet.back.write(reflected);
						howl += mouth - reflected;
					}
					air += build.itb * howl * intakeLevel * gain;
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
				if (heat) {
					// Hot gas carries sound faster: shorter delays while a slug passes
					for (const r of runners) {
						r.pipe.delay = Math.max(r.pipe.base / (1 + heat * r.hot), 2);
						r.hot *= kHotRunner;
					}
					bank.mid.delay = Math.max(bank.mid.base / (1 + heat * bank.hot), 2);
					bank.hot *= kHotMid;
				}
				let arriving = 0;
				for (const r of runners) {
					r.atCollector = r.pipe.atEnd(kPipe);
					arriving += r.atCollector;
				}
				const midAtMuffler = bank.mid.atEnd(kPipe);
				const midAtCollector = bank.mid.atStart(kPipe);
				const tailAtEnd = bank.tail.atEnd(kPipe);
				const tailAtMuffler = bank.tail.atStart(kPipe);

				// What leaves the collector: the mid pipe, or a megaphone's first section
				const cone = bank.cone;
				const firstArea = cone.length > 0 ? cone[0].area : MID_AREA;
				const firstBack =
					cone.length > 0 ? cone[0].pipe.atStart(kPipe) : midAtCollector;
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
						(2 * (SECONDARY_AREA * fromSecondaries + firstArea * firstBack)) /
						(SECONDARY_AREA * bank.secondaries.length + firstArea);
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
						(2 * (arriving + firstArea * firstBack)) /
						(runners.length + firstArea);
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
				let into = joint - firstBack + 2 * pop;
				// Turbulence where the flows mix, riding on the flow arriving
				if (turbulence)
					into += turbulence * (Math.random() * 2 - 1) * Math.abs(arriving);
				if (turbine > 0) {
					// The turbine takes energy out of each pulse's peak and smooths what passes
					const taken = into / (1 + TURBINE_SQUASH * turbine * Math.abs(into));
					bank.turbineLow += kTurbine * (taken - bank.turbineLow);
					into = taken + turbine * (bank.turbineLow - taken);
				}
				if (cone.length > 0) {
					// Megaphone: the wave widens section by section, each step reflecting a little,
					// and the last meets the mid pipe
					cone[0].pipe.ahead.write(into);
					for (let k = 1; k <= cone.length; k++) {
						const from = cone[k - 1];
						const ahead = from.pipe.atEnd(kPipe);
						const area = k < cone.length ? cone[k].area : MID_AREA;
						const back =
							k < cone.length ? cone[k].pipe.atStart(kPipe) : midAtCollector;
						const step =
							(2 * (from.area * ahead + area * back)) / (from.area + area);
						from.pipe.back.write(step - ahead);
						if (k < cone.length) cone[k].pipe.ahead.write(step - back);
						else into = step - back;
					}
				}
				bank.midIn = into;

				// Muffler: part of the wave reflects back up the mid pipe and the rest passes its low
				// pass into the tailpipe. A wave coming back up the tailpipe mostly dies in it.
				let toMuffler = midAtMuffler;
				if (filter) {
					// The particulate filter absorbs the mids and highs on the way in
					bank.filterLow += kFilter * (midAtMuffler - bank.filterLow);
					toMuffler = midAtMuffler + filter * (bank.filterLow - midAtMuffler);
				}
				bank.muffler.run(toMuffler);
				bank.muffler2.run(bank.muffler.low);
				// An open flap lets the wave past the muffler, so less of it reflects, and a filter
				// takes some of it
				bank.mid.back.write(
					p.reflect *
						(1 - 0.7 * flap) *
						(filter ? 1 - FILTER_ABSORB * filter : 1) *
						midAtMuffler,
				);
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
				if (flap > 0) {
					// Through the open flap: a straight pipe, dulled only a little
					bank.bypassLow += kBypass * (midAtMuffler - bank.bypassLow);
					muffled = (1 - flap) * muffled + flap * bank.bypassLow;
				}
				const tail2 = bank.tail2;
				const toTail = tail2 ? QUAD_SPLIT * muffled : muffled;
				bank.tail.ahead.write(
					(1 - 0.5 * p.reflect) * toTail + TAIL_REFLECT * tailAtMuffler,
				);

				// Open end: the lows reflect back inverted, and the gas flowing out radiates. The flow
				// is the arriving wave minus the reflected one, so the lows the pipe keeps ringing
				// with also come out strongest, as the bass of a real exhaust does.
				bank.openLow += kOpen * (tailAtEnd - bank.openLow);
				const reflected = -p.open * bank.openLow;
				bank.tail.back.write(reflected);
				let flow = (tailAtEnd - reflected) * PIPE_GAIN;
				if (tail2) {
					// The second tailpipe of a quad exhaust, alongside the first
					const tail2End = tail2.atEnd(kPipe);
					const tail2Muffler = tail2.atStart(kPipe);
					tail2.ahead.write(
						(1 - 0.5 * p.reflect) * toTail + TAIL_REFLECT * tail2Muffler,
					);
					bank.openLow2 += kOpen * (tail2End - bank.openLow2);
					const reflected2 = -p.open * bank.openLow2;
					tail2.back.write(reflected2);
					flow += (tail2End - reflected2) * PIPE_GAIN;
				}

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
				if (spacing > 0) {
					// The near ear hears this tailpipe now, the far one a little later
					const late = bank.farEar.read(spacing);
					bank.farEar.write(voiced);
					if (bank.index === 0) {
						left += voiced * bank.left;
						rightSum += late * bank.right;
					} else {
						left += late * bank.left;
						rightSum += voiced * bank.right;
					}
				} else {
					left += voiced * bank.left;
					rightSum += voiced * bank.right;
				}
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
