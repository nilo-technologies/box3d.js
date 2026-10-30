// Sound tuning panel for the sound lab (example-vehicle-sound.ts): a lil-gui folder with every
// setting in VehicleSoundParams (engine voice and character, tires, turbo, wind, bump stop),
// buttons that play the blow-off, the stutter (flutter) and the bump, hotkeys for the first two
// (V and C), and copy, paste and reset. Changes apply live and are saved in localStorage (only
// what differs from the defaults). The driving examples don't read it: they play
// defaultSoundParams with an engine voice picker. Add it to any page with
//
//   addSoundPanel(gui, audio);
//
// To make a tuning the default, copy it and paste it over defaultSoundParams in vehicle-audio.ts.

import type GUI from 'lil-gui';
import {
	assignSoundParams,
	cloneSoundParams,
	defaultSoundParams,
	diffSoundParams,
	type EngineVoiceChoice,
	type EngineVoiceName,
	engineVoices,
	type SoundWave,
	type TurboValve,
	type VehicleAudio,
	type VehicleSoundParams,
} from './vehicle-audio';
import { copyText, toast } from './vehicle-showcase';

export type SoundPanelOptions = {
	/** Folder title */
	title?: string;
	/** Open the folder at the start */
	open?: boolean;
	/** localStorage key for the tuning, or null to not save it */
	storageKey?: string | null;
	/** V plays the blow-off and C the stutter (compressor flutter). On unless false. */
	hotkeys?: boolean;
};

export type SoundPanel = {
	folder: GUI;
	/** Call after changing audio.params from code so the sliders show it */
	refresh(): void;
};

const STORAGE_KEY = 'box3d.vehicle-sound.v2';
/** Before v2 every field was saved, defaults included */
const OLD_STORAGE_KEY = 'box3d.vehicle-sound';

const waves: SoundWave[] = ['sine', 'triangle', 'square', 'sawtooth'];

const voiceOptions: Record<string, EngineVoiceChoice> = {
	"Auto (the car's engine)": 'auto',
	'Classic synth': 'classic',
};
for (const [key, voice] of Object.entries(engineVoices)) {
	voiceOptions[voice.title] = key as EngineVoiceName;
}

const valveOptions: Record<string, TurboValve> = {
	'Blow-off valve (pssh)': 'blowOff',
	'Stutter / compressor flutter (stu-tu-tu)': 'flutter',
	Both: 'both',
	Nothing: 'none',
};

/** [field, min, max, step, label] */
type Slider<G> = [keyof G & string, number, number, number, string];

type EngineParams = VehicleSoundParams['engine'];

const engineVolumeSliders: Slider<EngineParams>[] = [
	['idleVolume', 0, 0.5, 0.005, 'volume at idle'],
	['throttleVolume', 0, 0.5, 0.005, 'volume added on throttle'],
];

// Each scales the voice around its own design, within a range that stays engine-like
const characterSliders: Slider<EngineParams>[] = [
	['pipeSize', 0.6, 1.6, 0.01, 'pipe size'],
	['brightness', 0.4, 2.5, 0.01, 'brightness (muffler)'],
	['rumble', 0, 2, 0.01, 'rumble (resonance)'],
	['roughness', 0, 3, 0.01, 'roughness (lumpy idle)'],
	['grit', 0, 2.5, 0.01, 'grit (combustion noise)'],
	['drive', 0.3, 2.5, 0.01, 'drive (saturation)'],
	['crackle', 0, 5, 0.01, 'overrun crackle'],
];

const classicSliders: Slider<EngineParams>[] = [
	['pitch', 0.25, 2, 0.01, 'pitch (x firing freq)'],
	['minPitch', 0, 120, 1, 'lowest pitch (Hz)'],
	['subLevel', 0, 2, 0.05, 'sub octave level'],
	['rasp', 0, 1, 0.01, 'rasp (octave up saw)'],
	['toneIdle', 0.5, 8, 0.05, 'tone at idle (x pitch)'],
	['toneThrottle', 0, 12, 0.05, 'tone added on throttle'],
	['resonance', 0.1, 20, 0.1, 'tone resonance (Q)'],
];

const tireSliders: Slider<VehicleSoundParams['tires']>[] = [
	['volume', 0, 4, 0.05, 'squeal volume'],
	['pitch', 200, 4000, 10, 'pitch (Hz)'],
	['pitchSkid', 0, 3000, 10, 'pitch added at full slide'],
	['resonance', 0.5, 30, 0.1, 'whine (Q)'],
	['minSpeed', 0, 10, 0.1, 'silent below (m/s)'],
	['fullSpeed', 0.5, 40, 0.5, 'full volume at (m/s)'],
];

type TurboParams = VehicleSoundParams['turbo'];

const whineSliders: Slider<TurboParams>[] = [
	['whineVolume', 0, 0.2, 0.001, 'whistle volume'],
	['whinePitch', 1000, 10000, 10, 'whistle pitch at full spin (Hz)'],
	['idleSpin', 0, 0.6, 0.01, 'idle spin'],
	['whineWidth', 0.01, 0.2, 0.001, 'airiness (band width)'],
	['whineTone', 0, 1, 0.01, 'pure tone mix'],
	['whineHarmonic', 0, 1, 0.01, 'octave up'],
	['spinUp', 0.01, 2, 0.01, 'spin up (s)'],
	['spinDown', 0.05, 5, 0.01, 'spin down (s)'],
	['whooshVolume', 0, 0.5, 0.005, 'intake whoosh'],
];

const valveSliders: Slider<TurboParams>[] = [
	['blowOffMinBoost', 0, 1, 0.01, 'on lift above boost'],
	['blowOffVolume', 0, 2, 0.01, 'blow-off volume'],
	['blowOffPitch', 500, 8000, 10, 'blow-off pitch (Hz)'],
	['blowOffResonance', 0.3, 10, 0.1, 'blow-off resonance (Q)'],
	['blowOffLength', 0.05, 1.4, 0.01, 'blow-off length (s)'],
	['flutterVolume', 0, 4, 0.01, 'flutter volume'],
	['flutterRate', 5, 40, 0.5, 'flutter rate (Hz)'],
	['flutterPitch', 200, 3000, 10, 'flutter pitch (Hz)'],
	['flutterLength', 0.1, 1.4, 0.01, 'flutter length (s)'],
];

const windSliders: Slider<VehicleSoundParams['wind']>[] = [
	['volume', 0, 2, 0.01, 'volume'],
	['fullSpeed', 5, 150, 1, 'full volume at (m/s)'],
	['cutoff', 50, 4000, 10, 'cutoff (Hz)'],
];

const bumpSliders: Slider<VehicleSoundParams['bump']>[] = [
	['volume', 0, 3, 0.01, 'volume'],
	['cutoff', 30, 1000, 5, 'cutoff (Hz)'],
	['length', 0.02, 1.4, 0.01, 'length (s)'],
	['threshold', 0.5, 1, 0.01, 'at compression'],
];

function loadSaved(key: string): unknown {
	try {
		const text = localStorage.getItem(key);
		if (text) return JSON.parse(text);
		// An old save holds every field. Keep only what differs from the defaults, and drop the
		// classic voice, which was the default then.
		const old = key === STORAGE_KEY && localStorage.getItem(OLD_STORAGE_KEY);
		if (!old) return null;
		const params = cloneSoundParams();
		assignSoundParams(params, JSON.parse(old));
		if (params.engine.voice === 'classic')
			params.engine.voice = defaultSoundParams.engine.voice;
		const migrated = diffSoundParams(params);
		localStorage.setItem(key, JSON.stringify(migrated));
		localStorage.removeItem(OLD_STORAGE_KEY);
		return migrated;
	} catch {
		return null;
	}
}

function save(key: string, params: VehicleSoundParams): void {
	try {
		localStorage.setItem(key, JSON.stringify(diffSoundParams(params)));
	} catch {
		// Private windows and blocked storage: the tuning just lasts until reload
	}
}

export function addSoundPanel(
	gui: GUI,
	audio: VehicleAudio,
	options: SoundPanelOptions = {},
): SoundPanel {
	const params = audio.params;
	const storageKey =
		options.storageKey === undefined ? STORAGE_KEY : options.storageKey;
	if (storageKey) assignSoundParams(params, loadSaved(storageKey));

	const folder = gui.addFolder(options.title ?? 'Sound');
	if (!options.open) folder.close();

	function sliders<G extends object>(
		parent: GUI,
		group: G,
		list: Slider<G>[],
	): void {
		for (const [field, min, max, step, label] of list) {
			parent.add(group, field, min, max, step).name(label);
		}
	}

	const engine = folder.addFolder('Engine');
	engine
		.add(params.engine, 'voice', voiceOptions)
		.name('voice')
		.onChange(() => showVoiceControls());
	sliders(engine, params.engine, engineVolumeSliders);
	const character = engine.addFolder('Character');
	sliders(character, params.engine, characterSliders);
	character
		.add(
			{
				reset: () => {
					for (const [field] of characterSliders)
						(params.engine[field] as number) = defaultSoundParams.engine[
							field
						] as number;
					refresh();
					changed();
				},
			},
			'reset',
		)
		.name('reset character');
	const classic = engine.addFolder('Classic synth voice').close();
	classic.add(params.engine, 'wave', waves).name('waveform');
	sliders(classic, params.engine, classicSliders);

	// Character shapes the pulse voices and the classic folder the classic voice: grey out the
	// set that does nothing for the chosen voice
	function showVoiceControls(): void {
		const isClassic = params.engine.voice === 'classic';
		for (const c of character.controllers) c.enable(!isClassic);
		for (const c of classic.controllers) c.enable(isClassic);
	}
	showVoiceControls();

	const tires = folder.addFolder('Tires').close();
	sliders(tires, params.tires, tireSliders);

	const turbo = folder.addFolder('Turbo').close();
	const keyHint = (key: string) =>
		options.hotkeys === false ? '' : ` (${key})`;
	turbo
		.add({ play: () => audio.blowOff(1) }, 'play')
		.name(`▶ play blow-off${keyHint('V')}`);
	turbo
		.add({ play: () => audio.flutter(1) }, 'play')
		.name(`▶ play stutter${keyHint('C')}`);
	turbo.add(params.turbo, 'valve', valveOptions).name('on lift');
	turbo
		.add(params.turbo, 'liftWithoutTurbo')
		.name('play on every lift, even without a turbo');
	sliders(turbo, params.turbo, whineSliders);
	sliders(turbo, params.turbo, valveSliders);

	const wind = folder.addFolder('Wind').close();
	sliders(wind, params.wind, windSliders);

	const bump = folder.addFolder('Bump stop').close();
	sliders(bump, params.bump, bumpSliders);
	bump.add({ play: () => audio.thump(1) }, 'play').name('▶ play thump');

	folder.add(params, 'smoothing', 0.001, 0.5, 0.001).name('smoothing (s)');

	function refresh(): void {
		for (const c of folder.controllersRecursive()) c.updateDisplay();
		showVoiceControls();
	}

	function changed(): void {
		if (storageKey) save(storageKey, params);
	}
	folder.onChange(changed);

	const actions = {
		copy: async () => {
			const text = JSON.stringify(params, null, '\t');
			const ok = await copyText(text);
			toast(ok ? 'Copied sound settings' : 'Copy failed, see the console');
			if (!ok) console.log(text);
		},
		paste: () => {
			const text = window.prompt('Paste sound settings JSON');
			if (!text) return;
			try {
				assignSoundParams(params, JSON.parse(text));
			} catch {
				toast('That is not valid JSON');
				return;
			}
			refresh();
			changed();
			toast('Pasted sound settings');
		},
		reset: () => {
			assignSoundParams(params, cloneSoundParams());
			refresh();
			changed();
			toast('Sound back to defaults');
		},
	};
	folder.add(actions, 'copy').name('copy as JSON');
	folder.add(actions, 'paste').name('paste JSON');
	folder.add(actions, 'reset').name('reset to defaults');

	if (options.hotkeys !== false) {
		window.addEventListener('keydown', (e) => {
			const target = e.target as HTMLElement | null;
			if (e.repeat || target?.closest?.('input, textarea, select')) return;
			if (e.code === 'KeyV') audio.blowOff(1);
			else if (e.code === 'KeyC') audio.flutter(1);
		});
	}

	return { folder, refresh };
}
