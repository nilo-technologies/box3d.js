// Makes weight transfer visible in the vehicle examples. The physics already moves load between
// the wheels, but with the arcade assists (roll influence, a lowered center of mass) and stiff
// springs the body barely moves. This adds a visual-only body sway on top of the chassis pose:
// a spring driven by the chassis acceleration that pitches the body under braking and launch and
// leans it out of corners. The wheels stay where the physics put them. A HUD panel shows the
// live load on each wheel.

import type GUI from 'lil-gui';
import * as THREE from 'three';

const G = 9.81;
const deg = (d: number) => (d * Math.PI) / 180;

/** Per car sway state, reset when the car is spawned or teleported */
export type BodySway = {
	roll: number;
	pitch: number;
	rollRate: number;
	pitchRate: number;
	/** Filtered chassis acceleration: left (+x) and forward (+z), m/s^2 */
	left: number;
	forward: number;
	prevVelocity: THREE.Vector3;
	/** Skip the next acceleration sample, after a teleport or a spawn */
	fresh: boolean;
};

export function createBodySway(): BodySway {
	return {
		roll: 0,
		pitch: 0,
		rollRate: 0,
		pitchRate: 0,
		left: 0,
		forward: 0,
		prevVelocity: new THREE.Vector3(),
		fresh: true,
	};
}

export type WeightTransferView = {
	/** Call after every physics step with the chassis velocity and rotation */
	sample(
		sway: BodySway,
		velocity: THREE.Vector3,
		rotation: THREE.Quaternion,
		grounded: boolean,
		step: number,
	): void;
	/** Call once per frame: integrates the sway and poses the body about the axle line */
	pose(sway: BodySway, body: THREE.Object3D, pivotY: number, dt: number): void;
	/** Call once per frame with each wheel's load (N), wheels in front left, front right, rear left, rear right order */
	showLoads(loads: ArrayLike<number>, count: number, dt: number): void;
};

export function createWeightTransferView(gui: GUI): WeightTransferView {
	// A road car rolls about 3-4°/g and pitches about 2°/g in total, and its body settles
	// after one small overshoot. The physics already gives the realistic presets about
	// 1.5°/g of roll, so the sway adds a little on top rather than doubling it.
	const settings = {
		/** Scales roll and pitch together: 0 turns the sway off, above 1 exaggerates it */
		amount: 1,
		roll: 2.5,
		pitch: 2,
		frequency: 1.3,
		damping: 0.7,
		loads: true,
	};
	const folder = gui.addFolder('Weight transfer (visual)');
	folder.$title.title =
		'Visual-only body motion on top of the physics, so load moving between the wheels is easy to see. Does not change handling.';
	folder.add(settings, 'amount', 0, 3, 0.05).name('sway amount');
	folder.add(settings, 'roll', 0, 10, 0.25).name('body roll (°/g)');
	folder.add(settings, 'pitch', 0, 8, 0.25).name('body pitch (°/g)');
	folder.add(settings, 'frequency', 0.5, 4, 0.05).name('sway frequency (Hz)');
	folder.add(settings, 'damping', 0.05, 1.5, 0.01).name('sway damping');
	folder
		.add(settings, 'loads')
		.name('wheel load panel')
		.onChange((on: boolean) => {
			panel.style.display = on ? '' : 'none';
		});

	// ---- Load panel: one bar per wheel in a top down car layout, front at the top
	// The touch controls move and shrink it through these variables, see example.css
	const panel = document.createElement('div');
	panel.style.cssText =
		'position:fixed;left:18px;bottom:var(--vehicle-loads-bottom,18px);padding:10px 12px;border-radius:8px;' +
		'transform:scale(var(--vehicle-loads-scale,1));transform-origin:0 100%;' +
		'background:rgba(0,0,0,.55);color:#eee;font:600 11px ui-monospace,monospace;' +
		'pointer-events:none;user-select:none;text-align:center';
	const cells: HTMLElement[] = [];
	const bars: HTMLElement[] = [];
	const grid = document.createElement('div');
	grid.style.cssText =
		'display:grid;grid-template-columns:repeat(2,34px);gap:8px 28px;justify-content:center;' +
		'padding:6px 10px;border:2px solid rgba(255,255,255,.25);border-radius:14px';
	for (let i = 0; i < 4; i++) {
		const cell = document.createElement('div');
		cell.style.cssText =
			'height:52px;background:#2a2a2a;border-radius:4px;position:relative;overflow:hidden';
		const bar = document.createElement('div');
		bar.style.cssText =
			'position:absolute;left:0;right:0;bottom:0;height:50%;background:#b8c0cc';
		// Static share marker at half height
		const mark = document.createElement('div');
		mark.style.cssText =
			'position:absolute;left:0;right:0;bottom:50%;height:1px;background:rgba(255,255,255,.5)';
		cell.append(bar, mark);
		grid.append(cell);
		cells.push(cell);
		bars.push(bar);
	}
	const split = document.createElement('div');
	split.style.marginTop = '6px';
	panel.append(grid, split);
	document.body.appendChild(panel);

	// Smoothed per wheel share of the total load, 1 is a quarter
	const share = [1, 1, 1, 1];
	// Grey at a quarter of the load, orange when loaded, dark when unloaded
	const even = new THREE.Color(0xb8c0cc);
	const hot = new THREE.Color(0xff7a1f);
	const empty = new THREE.Color(0x4a4a4a);
	const color = new THREE.Color();

	const inverse = new THREE.Quaternion();
	const local = new THREE.Vector3();
	const euler = new THREE.Euler(0, 0, 0, 'ZXY');
	const pivot = new THREE.Vector3();

	return {
		sample(sway, velocity, rotation, grounded, step) {
			if (sway.fresh) {
				sway.prevVelocity.copy(velocity);
				sway.fresh = false;
				return;
			}
			// Acceleration in chassis space. Airborne the body should relax, not react to
			// gravity. A soft limit at 1.2 g stands in for the springs stiffening toward the
			// bump stops, so a landing or a wall hit does not throw the body around.
			local.subVectors(velocity, sway.prevVelocity).divideScalar(step);
			sway.prevVelocity.copy(velocity);
			local.applyQuaternion(inverse.copy(rotation).invert());
			const limit = 1.2 * G;
			const left = grounded ? limit * Math.tanh(local.x / limit) : 0;
			const forward = grounded ? limit * Math.tanh(local.z / limit) : 0;
			// Tire forces flicker from step to step, and a real body is too heavy to follow
			// them, so low pass the acceleration (150 ms) before it drives the spring
			const k = 1 - Math.exp(-step / 0.15);
			sway.left += (left - sway.left) * k;
			sway.forward += (forward - sway.forward) * k;
		},

		pose(sway, body, pivotY, dt) {
			// Body leans away from the turn and dives under braking: positive roll about +z
			// lifts the left side, positive pitch about +x drops the nose
			const rollTarget = settings.amount * deg(settings.roll) * (sway.left / G);
			const pitchTarget =
				-settings.amount * deg(settings.pitch) * (sway.forward / G);
			const omega = 2 * Math.PI * settings.frequency;
			const c = 2 * settings.damping * omega;
			const n = Math.max(1, Math.ceil(dt / (1 / 240)));
			const h = Math.min(dt, 0.1) / n;
			for (let i = 0; i < n; i++) {
				sway.rollRate +=
					(omega * omega * (rollTarget - sway.roll) - c * sway.rollRate) * h;
				sway.pitchRate +=
					(omega * omega * (pitchTarget - sway.pitch) - c * sway.pitchRate) * h;
				sway.roll += sway.rollRate * h;
				sway.pitch += sway.pitchRate * h;
			}
			// Rotate about the axle line so the body tips over the wheels instead of sliding
			euler.set(sway.pitch, 0, sway.roll);
			body.quaternion.setFromEuler(euler);
			pivot.set(0, pivotY, 0);
			body.position
				.copy(pivot)
				.sub(pivot.clone().applyQuaternion(body.quaternion));
		},

		showLoads(loads, count, dt) {
			if (!settings.loads) return;
			let total = 0;
			for (let i = 0; i < count; i++) total += Math.max(loads[i], 0);
			const k = 1 - Math.exp(-dt / 0.08);
			for (let i = 0; i < 4; i++) {
				const target =
					i < count && total > 1 ? (Math.max(loads[i], 0) / total) * count : 0;
				share[i] += (target - share[i]) * k;
				// Bar height: half is a quarter of the load, full is double that
				const s = share[i];
				bars[i].style.height = `${Math.min(s / 2, 1) * 100}%`;
				color
					.copy(even)
					.lerp(s >= 1 ? hot : empty, Math.min(Math.abs(s - 1) * 1.5, 1));
				bars[i].style.background = `#${color.getHexString()}`;
				cells[i].style.visibility = i < count ? '' : 'hidden';
			}
			if (count >= 4) {
				const sum = share[0] + share[1] + share[2] + share[3] || 1;
				const front = ((share[0] + share[1]) / sum) * 100;
				const left = ((share[0] + share[2]) / sum) * 100;
				split.textContent = `front ${front.toFixed(0)}% · left ${left.toFixed(0)}%`;
			}
		},
	};
}
