// A see-through 3D engine for the sound lab (example-vehicle-sound.ts), animated from the same
// rpm, throttle and boost that drive the sound. Each engine voice gets its own layout: inline,
// V or boxer pistons on a crank, or a twin-rotor rotary. The cylinders fire in
// the voice's firing order and at its firing angles, so a cross-plane V8 flashes unevenly
// between its banks, a boxer's unequal headers pulse in pairs, and each rotor face of a rotary
// fires in turn over three turns of the shaft. Each firing lights its
// cylinder, then its exhaust runner pulses as the gas leaves. The runners, the turbine housing
// and the downpipe glow as the exhaust heats up under load. The turbos spin with the boost and
// coast down after a lift; a supercharger turns with the crank. A blow-off puffs from the valve,
// a flutter from the compressor inlet, the tailpipe spits flame during overrun crackle, and the
// engine rocks on its mounts with the torque and shudders on the rev limiter.
//
// The crank turns at slowMotion times the real speed: at the real speed it would only flicker.

import * as THREE from 'three';
import {
	type EngineVoice,
	type EngineVoiceName,
	engineVoices,
	type VehicleSoundParams,
} from './vehicle-audio';

export type EngineInduction =
	| 'none'
	| 'single'
	| 'twin'
	| 'sequential'
	| 'supercharger';

export type EngineModelState = {
	rpm: number;
	/** 0 to 1 */
	throttle: number;
	/** The rev limiter has cut the ignition: nothing burns */
	cut: boolean;
	/** Boost of each turbo, 0 to 1. A list shorter than the turbos repeats its last value. */
	boost: number[];
	/** Overrun crackle, 0 to 1 */
	crackle: number;
};

export type EngineModel = {
	readonly group: THREE.Group;
	/** Rebuilds the engine for a voice ('classic' uses the cylinder count) and its induction */
	setEngine(
		voice: EngineVoiceName,
		cylinders: number,
		induction: EngineInduction,
	): void;
	update(state: EngineModelState, dt: number): void;
	/** A puff of charge air: from the blow-off valve, or out of the compressor inlet on a flutter */
	puff(strength: number, from: 'valve' | 'inlet'): void;
	/** A jolt on the engine mounts, for the bump stop */
	jolt(strength: number): void;
	/** Crank speed shown, as a fraction of the real one */
	slowMotion: number;
	/** What is shown, for example "Cross-plane V8, twin turbo" */
	readonly title: string;
	/** Radius of a sphere around the engine, for framing the camera */
	readonly radius: number;
};

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

type Layout = {
	title: string;
	kind: 'piston' | 'rotary';
	/** Tilt of each bank's bores from vertical (degrees), toward +z */
	banks: number[];
	/** Cylinder numbers in firing order, matching the voice's firing list */
	order: number[];
	/** A cylinder's slot along the crank (from the front) and its bank */
	place: (cylinder: number) => [number, number];
};

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const inline = (title: string, order: number[]): Layout => ({
	title,
	kind: 'piston',
	banks: [0],
	order,
	place: (n) => [n - 1, 0],
});

/** A V with cylinders 1 to n/2 on the first bank */
const vee = (title: string, angle: number, order: number[]): Layout => {
	const perBank = order.length / 2;
	return {
		title,
		kind: 'piston',
		banks: [angle / 2, -angle / 2],
		order,
		place: (n) => [(n - 1) % perBank, n <= perBank ? 0 : 1],
	};
};

/** Odd cylinders on one bank, even on the other, numbered front to back in pairs */
const alternateBanks = (n: number): [number, number] => [
	Math.ceil(n / 2) - 1,
	n % 2 ? 0 : 1,
];

const layouts: Record<keyof typeof engineVoices, Layout> = {
	inline4: inline('Inline four', [1, 3, 4, 2]),
	// Cylinders 1 and 3 on one side, 2 and 4 facing them
	boxer4: {
		title: 'Boxer four',
		kind: 'piston',
		banks: [90, -90],
		order: [1, 3, 2, 4],
		place: (n) => [n <= 2 ? 0 : 1, n % 2 ? 0 : 1],
	},
	inline6: inline('Inline six', [1, 5, 3, 6, 2, 4]),
	// 1-8-4-3-6-5-7-2 with odd cylinders on the left: the banks fire L R R L R L L R
	v8: {
		...vee('Cross-plane V8', 90, [1, 8, 4, 3, 6, 5, 7, 2]),
		place: alternateBanks,
	},
	// A flat crank alternates the banks every firing
	flatplaneV8: vee('Flat-plane V8', 90, [1, 5, 3, 7, 4, 8, 2, 6]),
	v10: vee('V10', 90, [1, 6, 5, 10, 2, 7, 3, 8, 4, 9]),
	v12: vee('V12', 60, [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10]),
	rotary: {
		title: 'Twin-rotor rotary',
		kind: 'rotary',
		banks: [],
		order: [],
		place: () => [0, 0],
	},
	diesel: inline('Inline four diesel', [1, 3, 4, 2]),
};

/** The classic voice has only a cylinder count: an inline up to six, a V above */
function classicLayout(cylinders: number): Layout {
	const n = Math.min(Math.max(Math.round(cylinders), 1), 16);
	if (n <= 6) {
		// Odd cylinders up the block and even ones back: 1-3-4-2 for a four
		const odd = range(n).filter((c) => c % 2 === 1);
		const even = range(n)
			.filter((c) => c % 2 === 0)
			.reverse();
		return inline(`${n} cylinder inline`, [...odd, ...even]);
	}
	return { ...vee(`V${n}`, 90, range(n)), place: alternateBanks };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** Bore pitch along the crank, bore radius, crank throw, rod length, piston height */
const PITCH = 1;
const BORE = 0.34;
const THROW = 0.3;
const ROD = 1;
const PISTON = 0.36;
/** Distance from the crank axis to the top of the bore */
const DECK = THROW + ROD + PISTON / 2 + 0.16;
/** Where the bore starts, just clear of the crank at the bottom of the stroke */
const SKIRT = ROD - THROW - 0.05;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function materials() {
	return {
		steel: new THREE.MeshStandardMaterial({
			color: 0x9aa0a8,
			metalness: 0.85,
			roughness: 0.3,
		}),
		dark: new THREE.MeshStandardMaterial({
			color: 0x34373c,
			metalness: 0.6,
			roughness: 0.5,
		}),
		alloy: new THREE.MeshStandardMaterial({
			color: 0xc8ccd2,
			metalness: 0.7,
			roughness: 0.35,
		}),
		cover: new THREE.MeshStandardMaterial({
			color: 0xb0222c,
			metalness: 0.35,
			roughness: 0.35,
		}),
		glass: new THREE.MeshStandardMaterial({
			color: 0x9fc4ff,
			metalness: 0.1,
			roughness: 0.1,
			transparent: true,
			opacity: 0.13,
			depthWrite: false,
			side: THREE.DoubleSide,
		}),
		filter: new THREE.MeshStandardMaterial({
			color: 0xd03a2a,
			roughness: 0.8,
		}),
	};
}

/** Exhaust metal that glows with heat, one material per part so each can pulse on its own */
const exhaustMaterial = () =>
	new THREE.MeshStandardMaterial({
		color: 0x6b5a4e,
		metalness: 0.7,
		roughness: 0.45,
		emissive: 0x000000,
	});

const glowMaterial = (color: number) =>
	new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

/** Black body from cold to dull red to orange, 0 to 1 */
function heatColor(heat: number, out: THREE.Color): THREE.Color {
	const h = Math.min(Math.max(heat, 0), 1.2);
	return out.setRGB(
		Math.min(h * 1.5, 1) * 0.7,
		Math.min(Math.max(h * 1.4 - 0.5, 0), 1) * 0.16,
		Math.min(Math.max(h * 2 - 1.7, 0), 1) * 0.03,
	);
}

function mesh<M extends THREE.Material>(
	geometry: THREE.BufferGeometry,
	material: M,
	parent: THREE.Object3D,
	x = 0,
	y = 0,
	z = 0,
): THREE.Mesh<THREE.BufferGeometry, M> {
	const m = new THREE.Mesh(geometry, material);
	m.position.set(x, y, z);
	parent.add(m);
	return m;
}

/** A cylinder with its axis along x */
function xCylinder(radius: number, length: number, segments = 24) {
	return new THREE.CylinderGeometry(radius, radius, length, segments).rotateZ(
		Math.PI / 2,
	);
}

function tube(
	points: THREE.Vector3[],
	radius: number,
	material: THREE.Material,
	parent: THREE.Object3D,
): THREE.CatmullRomCurve3 {
	const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
	mesh(new THREE.TubeGeometry(curve, 48, radius, 10), material, parent);
	return curve;
}

/** A shape in the yz plane extruded along x, centred: shape x maps to -z and shape y to y */
function extrudeX(shape: THREE.Shape, length: number) {
	return new THREE.ExtrudeGeometry(shape, {
		depth: length,
		bevelEnabled: false,
		curveSegments: 24,
	})
		.translate(0, 0, -length / 2)
		.rotateY(Math.PI / 2);
}

function shapeFrom(points: [number, number][]): THREE.Shape {
	const shape = new THREE.Shape();
	points.forEach(([u, v], i) => {
		if (i === 0) shape.moveTo(u, v);
		else shape.lineTo(u, v);
	});
	shape.closePath();
	return shape;
}

/** Rotates a point about the x axis */
const tiltX = (x: number, y: number, z: number, angle: number) =>
	new THREE.Vector3(
		x,
		y * Math.cos(angle) - z * Math.sin(angle),
		y * Math.sin(angle) + z * Math.cos(angle),
	);

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** A cylinder or rotor face: when it fires, where its gas goes and what lights up */
type Unit = {
	/** Firing angle in the voice's cycle (720°, or 1080° for a rotary), and pulse strength */
	angle: number;
	gain: number;
	flash: number;
	pulse: number;
	glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	/** Exhaust runner, which glows with heat and pulses after the firing */
	runner: THREE.MeshStandardMaterial | null;
	/** Moves its piston or rotor for a crank angle (radians) */
	pose(theta: number): void;
};

type Port = {
	x: number;
	exhaust: THREE.Vector3;
	intake: THREE.Vector3;
	/** Outward from the exhaust side */
	out: THREE.Vector3;
};

type Turbo = {
	wheel: THREE.Group;
	blades: THREE.MeshStandardMaterial;
	blur: THREE.MeshBasicMaterial;
	inlet: THREE.Vector3;
	shaft: number;
	angle: number;
};

type Flame = {
	mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
	light: THREE.PointLight;
	life: number;
};

type Puff = {
	sprite: THREE.Sprite;
	velocity: THREE.Vector3;
	age: number;
	life: number;
};

function puffTexture(): THREE.Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 64;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
	gradient.addColorStop(0.5, 'rgba(230,236,245,0.35)');
	gradient.addColorStop(1, 'rgba(230,236,245,0)');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 64, 64);
	return new THREE.CanvasTexture(canvas);
}

export function createEngineModel(
	turboParams?: VehicleSoundParams['turbo'],
): EngineModel {
	const group = new THREE.Group();
	const mat = materials();
	const smoke = puffTexture();

	// Rebuilt with each engine. body shakes on the mounts; the puffs stay in group.
	let body = new THREE.Group();
	let units: Unit[] = [];
	let spinners: { object: THREE.Object3D; rate: number }[] = [];
	let turbos: Turbo[] = [];
	let flames: Flame[] = [];
	let hot: THREE.MeshStandardMaterial[] = [];
	let valve: THREE.Vector3 | null = null;
	let firingsPerTurn = 3;
	/** Length of the firing cycle (degrees of the crank or eccentric shaft) */
	let cycle = 720;
	let combustion = new THREE.PointLight(0xff9a40, 0, 6, 1.5);
	let title = '';
	let radius = 5;
	const puffs: Puff[] = [];

	// Animation state
	let theta = 0;
	let heat = 0;
	let roll = 0;
	let joltY = 0;
	let joltV = 0;
	const color = new THREE.Color();
	const pulseColor = new THREE.Color(0.95, 0.3, 0.04);

	function dispose(root: THREE.Object3D) {
		root.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.geometry.dispose();
				const m = o.material as THREE.Material;
				if (!Object.values(mat).includes(m as never)) m.dispose();
			}
		});
	}

	// ---- Pistons on a crank

	function buildPistons(layout: Layout, firing: [number, number][]) {
		const slots = Math.max(...layout.order.map((n) => layout.place(n)[0])) + 1;
		const twoBanks = layout.banks.length > 1;
		// The banks sit a little apart along the crank, as their rods share the crank pins
		const xOf = (slot: number, bank: number) =>
			(slot - (slots - 1) / 2) * PITCH + (twoBanks ? (bank ? 0.22 : -0.22) : 0);
		const length = slots * PITCH + (twoBanks ? 0.44 : 0);
		const ports: Port[] = [];

		// Heads, cam covers and block per bank
		layout.banks.forEach((tilt, bank) => {
			const frame = new THREE.Group();
			frame.rotation.x = THREE.MathUtils.degToRad(tilt);
			const x = twoBanks ? (bank ? 0.22 : -0.22) : 0;
			mesh(
				new THREE.BoxGeometry(length - 0.1, DECK - SKIRT, BORE * 2 + 0.28),
				mat.glass,
				frame,
				x,
				(DECK + SKIRT) / 2,
			);
			mesh(
				new THREE.BoxGeometry(length, 0.36, BORE * 2 + 0.5),
				mat.alloy,
				frame,
				x,
				DECK + 0.18,
			);
			mesh(
				new THREE.BoxGeometry(length - 0.12, 0.2, BORE * 2 + 0.16),
				mat.cover,
				frame,
				x,
				DECK + 0.46,
			);
			for (let slot = 0; slot < slots; slot++) {
				mesh(
					new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12),
					mat.dark,
					frame,
					xOf(slot, bank),
					DECK + 0.62,
				);
			}
			body.add(frame);
		});

		// Crankcase, crankshaft, flywheel and pulley
		mesh(
			new THREE.BoxGeometry(length + 0.3, 0.9, 1.5),
			mat.glass,
			body,
			0,
			-0.35,
		);
		mesh(xCylinder(0.08, length + 1), mat.steel, body);
		addEnds(length / 2 + 0.25);

		firing.forEach(([angle, gain], k) => {
			const [slot, bank] = layout.place(layout.order[k]);
			const tilt = THREE.MathUtils.degToRad(layout.banks[bank]);
			const x = xOf(slot, bank);
			const frame = new THREE.Group();
			frame.position.x = x;
			frame.rotation.x = tilt;
			body.add(frame);
			mesh(
				new THREE.CylinderGeometry(BORE, BORE, DECK - SKIRT, 24, 1, true),
				mat.glass,
				frame,
				0,
				(DECK + SKIRT) / 2,
			);
			const piston = mesh(
				new THREE.CylinderGeometry(BORE * 0.95, BORE * 0.95, PISTON, 24),
				mat.alloy,
				frame,
			);
			const rod = mesh(new THREE.BoxGeometry(0.1, ROD, 0.07), mat.steel, frame);
			const web = new THREE.Group();
			frame.add(web);
			mesh(
				new THREE.BoxGeometry(0.09, THROW + 0.16, 0.24),
				mat.dark,
				web,
				0,
				THROW / 2,
			);
			mesh(new THREE.BoxGeometry(0.09, 0.22, 0.52), mat.dark, web, 0, -0.14);
			mesh(xCylinder(0.07, 0.2, 12), mat.steel, web, 0, THROW);
			const glow = mesh(
				new THREE.SphereGeometry(BORE * 0.9, 16, 12),
				glowMaterial(0xff8a2a),
				frame,
				0,
				DECK - 0.12,
			);

			const side = tilt < 0 ? -1 : 1;
			const portY = DECK + 0.18;
			const portZ = BORE + 0.28;
			ports.push({
				x,
				exhaust: tiltX(x, portY, side * portZ, tilt),
				intake: tiltX(x, portY, -side * portZ, tilt),
				out: tiltX(0, 0, side, tilt),
			});

			const pin = new THREE.Vector3();
			const wrist = new THREE.Vector3();
			units.push({
				angle,
				gain,
				flash: 0,
				pulse: 0,
				glow,
				runner: null,
				pose(crank) {
					// Angle past this cylinder's top dead centre, then the slider-crank
					const a = crank - THREE.MathUtils.degToRad(angle);
					const s =
						THROW * Math.cos(a) +
						Math.sqrt(ROD ** 2 - (THROW * Math.sin(a)) ** 2);
					web.rotation.x = a;
					pin.set(0, THROW * Math.cos(a), THROW * Math.sin(a));
					wrist.set(0, s, 0);
					piston.position.y = s + 0.06;
					rod.position.copy(pin).add(wrist).multiplyScalar(0.5);
					rod.quaternion.setFromUnitVectors(
						Y_AXIS,
						wrist.clone().sub(pin).normalize(),
					);
				},
			});
		});
		return { ports, length };
	}

	// ---- Twin-rotor rotary

	function buildRotary(firing: [number, number][]) {
		const R = 0.82;
		const e = 0.14;
		const width = 0.42;
		const housing: [number, number][] = [];
		for (let i = 0; i < 96; i++) {
			const t = (i / 96) * Math.PI * 2;
			const r = R + 0.05;
			housing.push([
				e * Math.cos(3 * t) + r * Math.cos(t),
				e * Math.sin(3 * t) + r * Math.sin(t),
			]);
		}
		// The rotor: a triangle with gently bulging flanks
		const rotor = new THREE.Shape();
		for (let k = 0; k < 3; k++) {
			const a = (k * 2 * Math.PI) / 3;
			const b = a + (2 * Math.PI) / 3;
			const mid = (a + b) / 2;
			if (k === 0) rotor.moveTo(R * Math.cos(a), R * Math.sin(a));
			rotor.quadraticCurveTo(
				0.72 * R * Math.cos(mid),
				0.72 * R * Math.sin(mid),
				R * Math.cos(b),
				R * Math.sin(b),
			);
		}
		const housingGeometry = extrudeX(shapeFrom(housing), width);
		const rotorGeometry = extrudeX(rotor, width - 0.08);
		const ports: Port[] = [];
		const rotorX = [-0.3, 0.3];
		rotorX.forEach((x, r) => {
			mesh(housingGeometry.clone(), mat.glass, body, x);
			const rotorMesh = mesh(rotorGeometry.clone(), mat.alloy, body, x);
			const glow = mesh(
				new THREE.SphereGeometry(0.32, 16, 12),
				glowMaterial(0xff8a2a),
				body,
				x,
				-0.55,
			);
			// Exhaust on +z, intake on -z (shape x maps to -z)
			ports.push({
				x,
				exhaust: new THREE.Vector3(x, -0.2, R + e + 0.1),
				intake: new THREE.Vector3(x, -0.2, -(R + e + 0.1)),
				out: new THREE.Vector3(0, 0, 1),
			});
			// Each rotor fires once per turn of the eccentric shaft: the voice's firings alternate
			firing.forEach(([angle, gain], k) => {
				if (k % 2 !== r) return;
				units.push({
					angle,
					gain,
					flash: 0,
					pulse: 0,
					glow,
					runner: null,
					pose(shaft) {
						// The rotor centre orbits the shaft; the rotor turns at a third of its speed
						const a = shaft + r * Math.PI;
						rotorMesh.position.set(x, e * Math.sin(a), -e * Math.cos(a));
						rotorMesh.rotation.x = a / 3;
					},
				});
			});
		});
		mesh(xCylinder(0.1, 1.6), mat.steel, body);
		addEnds(0.85);
		// End plates, see-through so the rotors show
		for (const x of [-0.53, 0.53]) {
			mesh(extrudeX(shapeFrom(housing), 0.04), mat.glass, body, x).scale.set(
				1,
				1.06,
				1.06,
			);
		}
		return { ports, length: 1.2 };
	}

	/** Pulley at the front, flywheel at the back, both turning with the crank */
	function addEnds(half: number) {
		const pulley = new THREE.Group();
		pulley.position.x = -half - 0.2;
		mesh(xCylinder(0.36, 0.16, 32), mat.dark, pulley);
		for (let i = 0; i < 3; i++) {
			const spoke = mesh(
				new THREE.BoxGeometry(0.18, 0.62, 0.08),
				mat.steel,
				pulley,
			);
			spoke.rotation.x = (i * Math.PI) / 3;
		}
		body.add(pulley);
		const flywheel = new THREE.Group();
		flywheel.position.x = half + 0.3;
		mesh(xCylinder(0.85, 0.12, 48), mat.steel, flywheel);
		const mark = glowMaterial(0xffd166);
		mark.opacity = 1;
		mesh(new THREE.BoxGeometry(0.14, 0.16, 0.08), mark, flywheel, 0, 0.72);
		mesh(
			new THREE.TorusGeometry(0.85, 0.05, 6, 48).rotateY(Math.PI / 2),
			mat.dark,
			flywheel,
		);
		body.add(flywheel);
		spinners.push({ object: pulley, rate: 1 }, { object: flywheel, rate: 1 });
	}

	// ---- Exhaust, turbos, intake

	function buildTurbo(at: THREE.Vector3): Turbo {
		const turbo = new THREE.Group();
		turbo.position.copy(at);
		const housing = exhaustMaterial();
		hot.push(housing);
		mesh(
			new THREE.TorusGeometry(0.34, 0.17, 12, 28).rotateY(Math.PI / 2),
			housing,
			turbo,
			0.3,
		);
		mesh(xCylinder(0.19, 0.4), housing, turbo, 0.66);
		mesh(xCylinder(0.14, 0.4), mat.dark, turbo);
		mesh(
			new THREE.TorusGeometry(0.4, 0.19, 12, 28).rotateY(Math.PI / 2),
			mat.alloy,
			turbo,
			-0.32,
		);
		mesh(
			new THREE.CylinderGeometry(0.27, 0.3, 0.42, 28, 1, true).rotateZ(
				Math.PI / 2,
			),
			mat.alloy,
			turbo,
			-0.7,
		);
		mesh(
			new THREE.CylinderGeometry(0.13, 0.13, 0.36, 16),
			mat.alloy,
			turbo,
			-0.32,
			0.48,
		);

		const wheel = new THREE.Group();
		wheel.position.x = -0.62;
		const blades = new THREE.MeshStandardMaterial({
			color: 0xe0e4ea,
			metalness: 0.9,
			roughness: 0.25,
			transparent: true,
		});
		mesh(
			new THREE.ConeGeometry(0.08, 0.26, 16).rotateZ(Math.PI / 2),
			mat.steel,
			wheel,
		);
		for (let i = 0; i < 7; i++) {
			const arm = new THREE.Group();
			arm.rotation.x = (i / 7) * Math.PI * 2;
			const blade = mesh(
				new THREE.BoxGeometry(0.2, 0.2, 0.025),
				blades,
				arm,
				0,
				0.13,
			);
			blade.rotation.y = 0.55;
			wheel.add(arm);
		}
		turbo.add(wheel);
		const blur = new THREE.MeshBasicMaterial({
			color: 0xdfe6ef,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		mesh(
			new THREE.CircleGeometry(0.25, 32).rotateY(Math.PI / 2),
			blur,
			turbo,
			-0.74,
		);
		body.add(turbo);
		return {
			wheel,
			blades,
			blur,
			inlet: at.clone().add(new THREE.Vector3(-0.95, 0, 0)),
			shaft: 0,
			angle: 0,
		};
	}

	function buildBreathing(
		ports: Port[],
		length: number,
		induction: EngineInduction,
		groups: number[][],
	) {
		const tailX = length / 2 + 2.2;
		const turboKind = induction !== 'none' && induction !== 'supercharger';

		// Plenum on the intake side, fed by short runners
		const intakeMid = new THREE.Vector3();
		const inward = new THREE.Vector3();
		for (const p of ports) {
			intakeMid.add(p.intake);
			inward.sub(p.out);
		}
		intakeMid.divideScalar(ports.length);
		inward.normalize();
		const plenum = intakeMid.clone().addScaledVector(inward, 0.55);
		const plenumLength = length + 0.2;
		mesh(
			new THREE.BoxGeometry(plenumLength, 0.34, 0.38),
			mat.alloy,
			body,
			0,
			plenum.y,
			plenum.z,
		);
		for (const p of ports) {
			const from = new THREE.Vector3(p.x, plenum.y, plenum.z);
			tube(
				[
					from,
					from.clone().lerp(p.intake, 0.5).addScaledVector(inward, 0.12),
					p.intake,
				],
				0.07,
				mat.alloy,
				body,
			);
		}
		const plenumFront = new THREE.Vector3(
			-plenumLength / 2 - 0.15,
			plenum.y,
			plenum.z,
		);

		groups.forEach((members, g) => {
			const port = new THREE.Vector3();
			const out = new THREE.Vector3();
			for (const i of members) {
				port.add(ports[i].exhaust);
				out.add(ports[i].out);
			}
			port.divideScalar(members.length);
			out.normalize();
			const at = port.clone().addScaledVector(out, 1.25);
			at.y -= 0.15;
			const inlet = at
				.clone()
				.add(new THREE.Vector3(0.3, 0, 0))
				.addScaledVector(out, -0.25);

			for (const i of members) {
				const p = ports[i];
				const runner = exhaustMaterial();
				hot.push(runner);
				const bend = p.exhaust.clone().addScaledVector(p.out, 0.45);
				tube(
					[
						p.exhaust,
						bend,
						bend.clone().lerp(inlet, 0.55).addScaledVector(out, 0.15),
						inlet,
					],
					0.085,
					runner,
					body,
				);
				// Every unit on this port: a rotor's two firings share one
				for (const u of units.filter((_, k) => unitPort[k] === i))
					u.runner = runner;
			}

			const downpipe = exhaustMaterial();
			hot.push(downpipe);
			const outlet = turboKind
				? at.clone().add(new THREE.Vector3(0.85, 0, 0))
				: inlet;
			const tailY = Math.min(at.y - 0.6, -1.4);
			const tail = new THREE.Vector3(tailX, tailY, at.z);
			tube(
				[
					outlet,
					outlet.clone().add(new THREE.Vector3(0.45, -0.35, 0)),
					new THREE.Vector3(tailX - 1, tailY, at.z),
					tail,
				],
				0.11,
				downpipe,
				body,
			);
			mesh(xCylinder(0.15, 0.3), mat.steel, body, tail.x + 0.1, tail.y, tail.z);
			addFlame(tail.clone().add(new THREE.Vector3(0.25, 0, 0)));

			if (!turboKind) return;
			const turbo = buildTurbo(at);
			turbos.push(turbo);
			// Charge pipe from the compressor up to the front of the plenum
			const from = at.clone().add(new THREE.Vector3(-0.32, 0.66, 0));
			const curve = tube(
				[
					from,
					from.clone().add(new THREE.Vector3(0, 0.45, 0)),
					new THREE.Vector3(
						plenumFront.x - 0.55,
						Math.max(from.y, plenum.y) + 0.55,
						(from.z + plenumFront.z) / 2,
					),
					plenumFront,
				],
				0.12,
				mat.alloy,
				body,
			);
			if (g === 0) {
				valve = curve.getPointAt(0.55);
				mesh(
					new THREE.CylinderGeometry(0.11, 0.11, 0.24, 16),
					mat.dark,
					body,
					valve.x,
					valve.y + 0.14,
					valve.z,
				);
				valve.y += 0.3;
			}
		});

		if (induction === 'none') {
			// Air filter on the plenum
			const filter = mesh(
				new THREE.CylinderGeometry(0.28, 0.22, 0.5, 24).rotateZ(Math.PI / 2),
				mat.filter,
				body,
			);
			filter.position.copy(plenumFront).add(new THREE.Vector3(-0.2, 0, 0));
		}
		if (induction === 'supercharger') {
			// A roots blower on the plenum, belt driven from the crank
			const top = plenum
				.clone()
				.addScaledVector(inward.y > 0.5 ? inward : Y_AXIS, 0.45);
			mesh(
				new THREE.BoxGeometry(plenumLength * 0.8, 0.46, 0.78),
				mat.glass,
				body,
				0,
				top.y,
				top.z,
			);
			const lobes: [number, number][] = [];
			for (let i = 0; i < 48; i++) {
				const a = (i / 48) * Math.PI * 2;
				const r = 0.16 + 0.06 * Math.cos(3 * a);
				lobes.push([r * Math.cos(a), r * Math.sin(a)]);
			}
			const lobeGeometry = extrudeX(shapeFrom(lobes), plenumLength * 0.75);
			for (const side of [-1, 1]) {
				const rotor = mesh(
					lobeGeometry.clone(),
					mat.alloy,
					body,
					0,
					top.y,
					top.z + side * 0.18,
				);
				spinners.push({ object: rotor, rate: 2 * side });
			}
			const pulleyX = -plenumLength * 0.4 - 0.15;
			const pulley = new THREE.Group();
			pulley.position.set(pulleyX, top.y, top.z);
			mesh(xCylinder(0.2, 0.12, 24), mat.dark, pulley);
			mesh(new THREE.BoxGeometry(0.14, 0.34, 0.06), mat.steel, pulley);
			body.add(pulley);
			spinners.push({ object: pulley, rate: 2 });
			// Belt from the crank pulley
			const crank = new THREE.Vector3(pulleyX, 0, 0);
			const to = new THREE.Vector3(pulleyX, top.y, top.z);
			const span = to.clone().sub(crank);
			const across = new THREE.Vector3().crossVectors(span, X_AXIS).normalize();
			for (const side of [-1, 1]) {
				const a = crank.clone().addScaledVector(across, side * 0.36);
				const b = to.clone().addScaledVector(across, side * 0.2);
				const belt = mesh(
					new THREE.BoxGeometry(0.1, a.distanceTo(b), 0.03),
					mat.dark,
					body,
				);
				belt.position.copy(a).add(b).multiplyScalar(0.5);
				belt.quaternion.setFromUnitVectors(
					Y_AXIS,
					b.clone().sub(a).normalize(),
				);
			}
		}
	}

	// Which port each unit breathes through
	let unitPort: number[] = [];

	function addFlame(at: THREE.Vector3) {
		const flame = mesh(
			new THREE.ConeGeometry(0.16, 0.8, 16, 1, true)
				.rotateZ(-Math.PI / 2)
				.translate(0.4, 0, 0),
			glowMaterial(0xff7a1a),
			body,
		);
		flame.position.copy(at);
		mesh(
			new THREE.ConeGeometry(0.08, 0.45, 12, 1, true)
				.rotateZ(-Math.PI / 2)
				.translate(0.22, 0, 0),
			glowMaterial(0xffe08a),
			flame,
		);
		const light = new THREE.PointLight(0xff7a1a, 0, 5, 1.5);
		light.position.copy(at).add(new THREE.Vector3(0.4, 0, 0));
		body.add(light);
		flames.push({ mesh: flame, light, life: 0 });
	}

	function setEngine(
		voice: EngineVoiceName,
		cylinders: number,
		induction: EngineInduction,
	) {
		group.remove(body);
		dispose(body);
		body = new THREE.Group();
		group.add(body);
		units = [];
		unitPort = [];
		spinners = [];
		turbos = [];
		flames = [];
		hot = [];
		valve = null;
		combustion = new THREE.PointLight(0xff9a40, 0, 6, 1.5);
		combustion.position.set(0, 1.2, 0);
		body.add(combustion);

		const layout =
			voice === 'classic' ? classicLayout(cylinders) : layouts[voice];
		const firing: [number, number][] =
			voice === 'classic'
				? layout.order.map((_, k) => [(k * 720) / layout.order.length, 1])
				: engineVoices[voice].firing;
		cycle =
			voice === 'classic'
				? 720
				: ((engineVoices[voice] as EngineVoice).cycle ?? 720);
		firingsPerTurn = firing.length / (cycle / 360);

		const { ports, length } =
			layout.kind === 'rotary'
				? buildRotary(firing)
				: buildPistons(layout, firing);
		// Units map to ports in order, two firings per port on a rotary
		unitPort = units.map((_, k) =>
			layout.kind === 'rotary' ? (k < units.length / 2 ? 0 : 1) : k,
		);
		// The exhaust splits into groups, each with its own turbo (if any) and tailpipe: one per
		// bank on a V or a boxer, and front and rear halves on an inline twin turbo. A single
		// turbo boxer joins both banks under the engine.
		const all = ports.map((_, i) => i);
		const twin = induction === 'twin' || induction === 'sequential';
		const single = induction === 'single';
		const boxer = layout.banks[0] === 90;
		let groups = [all];
		if (layout.banks.length > 1 && !(boxer && single)) {
			groups = [
				all.filter((i) => ports[i].exhaust.z > 0),
				all.filter((i) => ports[i].exhaust.z <= 0),
			];
		} else if (layout.banks.length <= 1 && twin) {
			const byX = [...all].sort((a, b) => ports[a].x - ports[b].x);
			const half = Math.ceil(byX.length / 2);
			groups = [byX.slice(0, half), byX.slice(half)];
		}
		buildBreathing(
			ports,
			length,
			induction,
			groups.filter((g) => g.length > 0),
		);
		const what =
			induction === 'none'
				? ''
				: induction === 'supercharger'
					? ', supercharged'
					: turbos.length > 1
						? induction === 'sequential'
							? ', sequential twin turbo'
							: ', twin turbo'
						: ', turbo';
		title = layout.title + what;

		const box = new THREE.Box3().setFromObject(body);
		radius = box.getBoundingSphere(new THREE.Sphere()).radius;
	}

	function puff(strength: number, from: 'valve' | 'inlet') {
		const origins =
			from === 'valve' ? (valve ? [valve] : []) : turbos.map((t) => t.inlet);
		for (const origin of origins) {
			const count = Math.round(6 + 10 * strength);
			for (let i = 0; i < count; i++) {
				const sprite = new THREE.Sprite(
					new THREE.SpriteMaterial({
						map: smoke,
						transparent: true,
						depthWrite: false,
					}),
				);
				sprite.position.copy(
					group.worldToLocal(body.localToWorld(origin.clone())),
				);
				const direction =
					from === 'valve'
						? new THREE.Vector3(Math.random() - 0.5, 1.2, Math.random() - 0.5)
						: new THREE.Vector3(-1.2, Math.random() - 0.3, Math.random() - 0.5);
				group.add(sprite);
				puffs.push({
					sprite,
					velocity: direction
						.normalize()
						.multiplyScalar((1.2 + Math.random() * 2) * (0.5 + strength)),
					age: 0,
					life: 0.4 + 0.5 * Math.random() * (0.5 + strength),
				});
			}
		}
	}

	function update(state: EngineModelState, dt: number) {
		const prev = theta;
		theta += (state.rpm / 60) * 360 * model.slowMotion * dt;
		const crossed = (angle: number) =>
			THREE.MathUtils.euclideanModulo(theta - angle, cycle) <
			THREE.MathUtils.euclideanModulo(prev - angle, cycle);
		const fire = state.cut ? 0 : 0.35 + 0.65 * state.throttle;
		const crank = THREE.MathUtils.degToRad(theta);

		// Exhaust heat rises over a few seconds of load and falls slowly
		const target =
			Math.min(state.rpm / 7000, 1.15) ** 1.5 * (0.15 + 0.85 * state.throttle) +
			0.25 * state.crackle;
		heat += (target - heat) * Math.min(dt / (target > heat ? 2.5 : 6), 1);

		let lit = 0;
		for (const u of units) {
			if (crossed(u.angle)) u.flash = Math.max(u.flash, fire * u.gain);
			// The exhaust valve opens most of a stroke after the firing
			if (crossed(u.angle + 160))
				u.pulse = Math.max(u.pulse, (state.cut ? 0.2 : fire) * u.gain);
			u.flash *= Math.exp(-dt / 0.07);
			u.pulse *= Math.exp(-dt / 0.16);
			u.pose(crank);
			u.glow.material.opacity = Math.min(u.flash, 1);
			u.glow.scale.setScalar(0.6 + 0.5 * u.flash);
			lit += u.flash;
		}
		combustion.intensity = 6 * Math.min(lit, 1.5);
		for (const u of units) {
			if (!u.runner) continue;
			// A rotor's two firings share a runner: take the stronger pulse
			const pulse = Math.max(
				...units.filter((o) => o.runner === u.runner).map((o) => o.pulse),
			);
			heatColor(heat, u.runner.emissive).lerp(
				pulseColor,
				Math.min(pulse * 0.8, 1),
			);
			u.runner.emissiveIntensity = 0.8 + 0.8 * pulse;
		}
		heatColor(heat, color);
		for (const m of hot) {
			if (units.some((u) => u.runner === m)) continue;
			m.emissive.copy(color);
		}
		for (const s of spinners) s.object.rotation.x = crank * s.rate;

		// Turbos: the shaft follows its boost, quickly up and slowly down
		const up = turboParams?.spinUp ?? 0.15;
		const down = turboParams?.spinDown ?? 1.4;
		const idle = turboParams?.idleSpin ?? 0.2;
		turbos.forEach((t, i) => {
			const boost = state.boost[Math.min(i, state.boost.length - 1)] ?? 0;
			t.shaft +=
				(boost - t.shaft) *
				Math.min(dt / Math.max(boost > t.shaft ? up : down, 0.01), 1);
			const spin = idle + (1 - idle) * t.shaft;
			t.angle += spin * 9 * Math.PI * 2 * dt;
			t.wheel.rotation.x = t.angle;
			t.blur.opacity = 0.55 * spin ** 1.5;
			t.blades.opacity = 1 - 0.65 * spin;
		});

		// Overrun pops at the tailpipes
		for (const f of flames) {
			if (state.crackle > 0 && Math.random() < state.crackle * dt * 22) {
				f.life = 0.05 + 0.08 * Math.random();
				f.mesh.scale.set(
					0.5 + Math.random() * (0.6 + state.crackle),
					0.7 + 0.6 * Math.random(),
					0.7 + 0.6 * Math.random(),
				);
			}
			f.life = Math.max(f.life - dt, 0);
			const on = f.life > 0 ? 1 : 0;
			f.mesh.material.opacity = on;
			(f.mesh.children[0] as Flame['mesh']).material.opacity = on;
			f.light.intensity = on * 8;
		}

		// On the mounts: rocked by the torque, buzzing at the firing rate, shuddering on the limiter
		roll +=
			(0.045 * state.throttle * (state.cut ? 0.4 : 1) - roll) *
			Math.min(dt * 5, 1);
		const buzz =
			firingsPerTurn > 0
				? (0.004 + (state.cut ? 0.012 : 0) + (state.rpm < 1200 ? 0.004 : 0)) *
					Math.sin(crank * firingsPerTurn)
				: 0;
		joltV += (-180 * joltY - 9 * joltV) * dt;
		joltY += joltV * dt;
		body.rotation.x = roll + buzz;
		body.position.y = joltY;

		for (let i = puffs.length - 1; i >= 0; i--) {
			const p = puffs[i];
			p.age += dt;
			const t = p.age / p.life;
			if (t >= 1) {
				group.remove(p.sprite);
				p.sprite.material.dispose();
				puffs.splice(i, 1);
				continue;
			}
			p.velocity.multiplyScalar(Math.exp(-dt * 3));
			p.sprite.position.addScaledVector(p.velocity, dt);
			p.sprite.scale.setScalar(0.25 + 1.1 * t);
			p.sprite.material.opacity = 0.8 * (1 - t) ** 1.5;
		}
		if (theta >= 2 * cycle) theta -= 2 * cycle;
	}

	const model: EngineModel = {
		group,
		setEngine,
		update,
		puff,
		jolt(strength) {
			joltV -= 2.5 * strength;
		},
		slowMotion: 1 / 20,
		get title() {
			return title;
		},
		get radius() {
			return radius;
		},
	};
	return model;
}
