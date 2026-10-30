// On-screen driving controls for touch screens: a steering pad on the left, and gas,
// brake/reverse, handbrake and flip upright buttons on the right. They feed the demo's own
// input path: a held button puts its code in the same key set the keyboard fills, a tap goes
// through the same press handler as a key press, and the pad gives an analog steer that the
// demo reads like the gamepad stick. Each control follows its own finger, so steering and gas
// work at the same time, and a finger can slide between the pedal buttons. The buttons are
// native buttons and the pad is a slider, so they also work focused with the keyboard.
//
// Shown on coarse pointer screens, or after the first touch on any other. ?touch=1 forces the
// controls on (to try them with a mouse) and ?touch=0 keeps them off. Layout is in example.css.

/** Codes a held button adds to the key set */
export const touchCodes = {
	gas: 'TouchGas',
	brake: 'TouchBrake',
	handbrake: 'TouchHandbrake',
} as const;

export type TouchControlsOptions = {
	/** The key set the keyboard fills; held buttons add their codes to it */
	keys: Set<string>;
	/** The keyboard's press handler; tap buttons send their key code to it */
	onPress(code: string): void;
	/** Called once when the controls first show */
	onShow?(): void;
};

export type TouchControls = {
	/** True once the controls are on screen */
	readonly shown: boolean;
	/** True while a finger is on the steering pad */
	readonly steering: boolean;
	/** Analog steer from the pad, -1 full left to 1 full right */
	readonly steer: number;
};

/** Pad half width share around the centre with no steer, and the share that gives full lock */
const DEAD_ZONE = 0.08;
const FULL_LOCK = 0.8;

export function createTouchControls(
	options: TouchControlsOptions,
): TouchControls {
	const { keys, onPress } = options;

	const root = document.createElement('div');
	root.className = 'touch-controls';
	root.hidden = true;
	root.innerHTML =
		'<div class="touch-steer" role="slider" tabindex="0" aria-label="steer" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0" aria-valuetext="straight">' +
		'<span class="touch-arrow" aria-hidden="true">◀&#xFE0E;</span><span class="touch-knob"></span><span class="touch-arrow" aria-hidden="true">▶&#xFE0E;</span></div>' +
		'<div class="touch-pedals">' +
		'<button type="button" class="touch-button touch-reset" data-tap="KeyR" aria-label="flip upright">↻<small>flip</small></button>' +
		`<button type="button" class="touch-button touch-handbrake" data-hold="${touchCodes.handbrake}" aria-label="handbrake">HB<small>hand</small></button>` +
		`<button type="button" class="touch-button touch-brake" data-hold="${touchCodes.brake}" aria-label="brake and reverse">▼<small>brake</small></button>` +
		`<button type="button" class="touch-button touch-gas" data-hold="${touchCodes.gas}" aria-label="gas">▲<small>gas</small></button>` +
		'</div>';
	const pad = root.querySelector('.touch-steer') as HTMLElement;
	const knob = root.querySelector('.touch-knob') as HTMLElement;
	const pedals = root.querySelector('.touch-pedals') as HTMLElement;
	const holdButtons = [...pedals.querySelectorAll<HTMLElement>('[data-hold]')];

	const state = { shown: false, steering: false, steer: 0 };
	let steerPointer: number | null = null;
	/** Pointer id to the hold code under that finger, or null between buttons */
	const pedalPointers = new Map<number, string | null>();
	/** Hold codes of buttons held down with Enter or Space while focused */
	const keyboardHeld = new Set<string>();

	// ---- Steering pad: the steer follows where the finger is across the pad
	function setSteer(steer: number): void {
		state.steer = steer;
		knob.style.left = `${50 + steer * 40}%`;
		const percent = Math.round(Math.abs(steer) * 100);
		pad.setAttribute('aria-valuenow', steer.toFixed(2));
		pad.setAttribute(
			'aria-valuetext',
			percent === 0
				? 'straight'
				: `${steer < 0 ? 'left' : 'right'} ${percent}%`,
		);
	}

	function updateSteer(e: PointerEvent): void {
		const rect = pad.getBoundingClientRect();
		const half = rect.width / 2;
		const x = (e.clientX - rect.left - half) / half;
		const magnitude = Math.min(
			Math.max((Math.abs(x) - DEAD_ZONE) / (FULL_LOCK - DEAD_ZONE), 0),
			1,
		);
		setSteer(Math.sign(x) * magnitude);
	}

	function releaseSteer(): void {
		steerPointer = null;
		state.steering = false;
		setSteer(0);
		pad.classList.remove('on');
	}

	pad.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		if (steerPointer !== null) return;
		pad.setPointerCapture(e.pointerId);
		steerPointer = e.pointerId;
		state.steering = true;
		pad.classList.add('on');
		updateSteer(e);
	});
	pad.addEventListener('pointermove', (e) => {
		if (e.pointerId === steerPointer) updateSteer(e);
	});
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
		pad.addEventListener(type, (e) => {
			if ((e as PointerEvent).pointerId === steerPointer) releaseSteer();
		});
	}
	// Focused, the pad is a slider: the arrow keys steer full lock while held. The keys also
	// reach the demo's own arrow key steering, which gives the same steer.
	const arrowSteer = { ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>;
	pad.addEventListener('keydown', (e) => {
		if (!(e.code in arrowSteer) || steerPointer !== null) return;
		state.steering = true;
		setSteer(arrowSteer[e.code]);
	});
	pad.addEventListener('keyup', (e) => {
		if (e.code in arrowSteer && steerPointer === null) releaseSteer();
	});
	pad.addEventListener('blur', () => {
		if (steerPointer === null) releaseSteer();
	});

	// ---- Pedal buttons: the cluster captures each finger and hit tests it as it moves
	function holdCodeAt(e: PointerEvent): string | null {
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const button = el?.closest<HTMLElement>('[data-hold]');
		return button && pedals.contains(button)
			? (button.dataset.hold ?? null)
			: null;
	}

	function syncHeld(): void {
		const held = new Set([...pedalPointers.values(), ...keyboardHeld]);
		for (const button of holdButtons) {
			const code = button.dataset.hold as string;
			const on = held.has(code);
			button.classList.toggle('on', on);
			if (on) keys.add(code);
			else keys.delete(code);
		}
	}

	pedals.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		const tap = (e.target as HTMLElement).closest<HTMLElement>('[data-tap]');
		if (tap?.dataset.tap) {
			tap.classList.add('on');
			setTimeout(() => tap.classList.remove('on'), 150);
			onPress(tap.dataset.tap);
			return;
		}
		pedals.setPointerCapture(e.pointerId);
		pedalPointers.set(e.pointerId, holdCodeAt(e));
		syncHeld();
	});
	pedals.addEventListener('pointermove', (e) => {
		if (!pedalPointers.has(e.pointerId)) return;
		const code = holdCodeAt(e);
		if (code === pedalPointers.get(e.pointerId)) return;
		pedalPointers.set(e.pointerId, code);
		syncHeld();
	});
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
		pedals.addEventListener(type, (e) => {
			if (pedalPointers.delete((e as PointerEvent).pointerId)) syncHeld();
		});
	}

	// Keyboard: a focused button works with Enter or Space, held for as long as the key is.
	// These keys stop here so Space does not also pull the demo's handbrake.
	const activateKeys = new Set(['Enter', 'NumpadEnter', 'Space']);
	pedals.addEventListener('keydown', (e) => {
		const button = e.target as HTMLElement;
		if (!activateKeys.has(e.code) || !button.matches('button')) return;
		e.stopPropagation();
		const hold = button.dataset.hold;
		if (!hold) return; // the tap button flips on the click that follows
		e.preventDefault();
		if (e.repeat) return;
		keyboardHeld.add(hold);
		syncHeld();
	});
	pedals.addEventListener('keyup', (e) => {
		const hold = (e.target as HTMLElement).dataset.hold;
		if (!activateKeys.has(e.code) || !hold) return;
		e.preventDefault();
		keyboardHeld.delete(hold);
		syncHeld();
	});
	pedals.addEventListener('focusout', (e) => {
		const hold = (e.target as HTMLElement).dataset.hold;
		if (hold && keyboardHeld.delete(hold)) syncHeld();
	});
	// A click from a pointer has a detail of 1 or more and already flipped on pointerdown
	pedals.addEventListener('click', (e) => {
		const tap = (e.target as HTMLElement).closest<HTMLElement>('[data-tap]');
		if (tap?.dataset.tap && e.detail === 0) onPress(tap.dataset.tap);
	});

	// Let go of everything when the page loses focus, a finger can lift unseen
	function releaseAll(): void {
		releaseSteer();
		pedalPointers.clear();
		keyboardHeld.clear();
		syncHeld();
	}
	window.addEventListener('blur', releaseAll);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) releaseAll();
	});
	// No long press menu or selection on the controls
	root.addEventListener('contextmenu', (e) => e.preventDefault());
	root.addEventListener('selectstart', (e) => e.preventDefault());

	document.body.appendChild(root);

	function show(): void {
		if (state.shown) return;
		state.shown = true;
		root.hidden = false;
		document.body.classList.add('vehicle-touch');
		// No pinch zoom while driving: touch-action covers the canvas and controls, this covers
		// two finger gestures that start elsewhere and Safari's own gesture events
		document.addEventListener(
			'touchmove',
			(e) => {
				if (e.touches.length > 1) e.preventDefault();
			},
			{ passive: false },
		);
		document.addEventListener('gesturestart', (e) => e.preventDefault());
		options.onShow?.();
	}

	const param = new URLSearchParams(location.search).get('touch');
	if (param !== '0') {
		const coarse = matchMedia('(pointer: coarse)');
		if (param === '1' || coarse.matches) show();
		else {
			const onPointer = (e: PointerEvent) => {
				if (e.pointerType !== 'touch') return;
				window.removeEventListener('pointerdown', onPointer, true);
				show();
			};
			window.addEventListener('pointerdown', onPointer, true);
			coarse.addEventListener('change', () => {
				if (coarse.matches) show();
			});
		}
	}

	return state;
}
