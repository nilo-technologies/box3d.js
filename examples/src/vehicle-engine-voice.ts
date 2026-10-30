// Engine sound picker for the vehicle examples: one dropdown with the engine voice presets
// (each car's own engine, the classic synth, or any voice in engineVoices). The rest of the
// sound is fixed at defaultSoundParams in vehicle-audio.ts; to change it, edit the defaults.
// Add it to any page with
//
//   addEngineVoicePicker(gui, audio);

import type GUI from 'lil-gui';
import {
	type EngineVoiceChoice,
	type EngineVoiceName,
	engineVoices,
	type VehicleAudio,
} from './vehicle-audio';

/** The engine of each example car and matrix car: its cylinder count and the voice 'auto' plays */
export const carEngines: Record<
	string,
	{ cylinders: number; voice: EngineVoiceName }
> = {
	fwd: { cylinders: 4, voice: 'inline4' },
	rwd: { cylinders: 6, voice: 'inline6' },
	awd: { cylinders: 6, voice: 'inline6' },
	offroad: { cylinders: 8, voice: 'v8' },
	sports: { cylinders: 6, voice: 'inline6' },
	rally: { cylinders: 4, voice: 'boxer4' },
	super: { cylinders: 8, voice: 'flatplaneV8' },
};

const voiceOptions: Record<string, EngineVoiceChoice> = {
	"Auto (the car's engine)": 'auto',
	'Classic synth': 'classic',
};
for (const [key, voice] of Object.entries(engineVoices)) {
	voiceOptions[voice.title] = key as EngineVoiceName;
}

export function addEngineVoicePicker(gui: GUI, audio: VehicleAudio): void {
	gui.add(audio.params.engine, 'voice', voiceOptions).name('engine sound');
}
