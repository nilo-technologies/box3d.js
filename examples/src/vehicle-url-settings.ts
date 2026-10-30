// Shareable settings for the vehicle examples: every setting in the lil-gui panel that differs
// from what the page started with goes into the URL, so the address can be copied and opened
// elsewhere with the same tuning. A key is the setting's folder path and property, for example
//
//   ?preset=rally-50-awd&vehicle.assists.abs=0&vehicle.suspension.front.frequency=1.9
//
// Booleans are 1 or 0, numbers and options as they are. Opening the page applies the keys on
// top of the start values, in panel order, as if they were set by hand; a value the panel could
// not set (an unknown option, a number outside a slider's range) is ignored. Folders that are rebuilt
// (the Vehicle folder, on every preset swap) call reset() to drop their keys and take the new
// values as their start values.

import {
	type Controller,
	type default as GUI,
	NumberController,
	OptionController,
} from 'lil-gui';

export type UrlSettings = {
	/** Takes the panel's current values as the start values and drops the URL keys under `prefix` */
	reset(prefix: string): void;
};

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

function format(value: unknown): string {
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number') return String(Number(value.toPrecision(6)));
	return String(value);
}

function parse(text: string, like: unknown): unknown {
	if (typeof like === 'boolean') return text === '1' || text === 'true';
	if (typeof like === 'number') {
		const n = Number(text);
		return Number.isFinite(n) ? n : undefined;
	}
	return text;
}

/**
 * Whether the panel itself could set this value: one of a dropdown's options, or within a
 * slider's range. A hand-edited link can hold anything.
 */
function allowed(c: Controller, value: unknown): boolean {
	if (c instanceof OptionController) return c._values.includes(value);
	if (c instanceof NumberController && typeof value === 'number') {
		if (c._min !== undefined && value < c._min) return false;
		if (c._max !== undefined && value > c._max) return false;
	}
	return true;
}

/**
 * Keeps the panel's settings in the URL and applies the ones already there. `skip` names the
 * top level folders whose settings stay out of it (for example ones that write their own keys).
 */
export function syncSettingsWithUrl(
	gui: GUI,
	skip: string[] = [],
): UrlSettings {
	const skipped = new Set(skip.map(slug));

	/** Every setting by key, in panel order. Buttons and skipped folders are left out. */
	function settings(): Map<string, Controller> {
		const out = new Map<string, Controller>();
		const visit = (folder: GUI, path: string[]) => {
			// Gear ratios and the like share a property within a folder: number them instead
			const counts = new Map<string, number>();
			for (const c of folder.controllers)
				counts.set(c.property, (counts.get(c.property) ?? 0) + 1);
			const seen = new Map<string, number>();
			for (const c of folder.controllers) {
				if (typeof c.getValue() === 'function') continue;
				const n = (seen.get(c.property) ?? 0) + 1;
				seen.set(c.property, n);
				const name =
					(counts.get(c.property) ?? 0) > 1 ? `${c.property}${n}` : c.property;
				out.set([...path, name].join('.'), c);
			}
			for (const f of folder.folders) {
				const key = slug(f._title);
				if (path.length === 0 && skipped.has(key)) continue;
				visit(f, [...path, key]);
			}
		};
		visit(gui, []);
		return out;
	}

	const start = new Map<string, string>();
	function snapshot(): void {
		for (const [key, c] of settings())
			if (!start.has(key)) start.set(key, format(c.getValue()));
	}

	function write(): void {
		const url = new URL(location.href);
		for (const [key, c] of settings()) {
			const value = format(c.getValue());
			if (value === start.get(key)) url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		if (url.href !== location.href) history.replaceState(null, '', url);
	}

	snapshot();
	// Apply what the URL holds, in panel order so a choice that resets others (a turbo type,
	// the gear count) comes before the values that refine it
	const params = new URLSearchParams(location.search);
	for (const [key, c] of settings()) {
		const text = params.get(key);
		if (text === null) continue;
		const value = parse(text, c.getValue());
		if (value !== undefined && allowed(c, value)) c.setValue(value);
	}

	// Rewrite the whole set on every change, since one setting can move others (the turbo type,
	// the reset button). Sliders report when they are let go, buttons only on click.
	gui.onFinishChange(write);
	gui.onChange((e) => {
		if (typeof e.value === 'function') write();
	});

	return {
		reset(prefix) {
			for (const key of [...start.keys()])
				if (key.startsWith(`${prefix}.`)) start.delete(key);
			snapshot();
			// Drop every key under the prefix, including ones for controls the new folder lacks,
			// which write() would not visit
			const url = new URL(location.href);
			for (const key of [...url.searchParams.keys()])
				if (key.startsWith(`${prefix}.`)) url.searchParams.delete(key);
			history.replaceState(null, '', url);
			write();
		},
	};
}
