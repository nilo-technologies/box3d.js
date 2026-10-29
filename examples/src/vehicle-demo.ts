// Shared driving demo used by the four vehicle examples: builds the world (paved track or
// off-road terrain), the car visuals, a chase camera, the HUD, keyboard and gamepad input,
// and the reusable settings panel. Physics runs at a fixed 60 Hz and the chassis is
// interpolated between steps for high refresh rate displays.

import type {
	Box3DModule,
	b3BodyId,
	b3Quat,
	b3Vec3,
	b3VehicleDef,
	VehicleWheelRecord,
} from 'box3d.js';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';
import { quatFromAxisAngle } from './math';
import {
	createPresetVehicleDef,
	type VehiclePresetName,
	vehiclePresets,
} from './vehicle-presets';
import { createVehicleSettings } from './vehicle-settings';

export type VehicleDemoOptions = {
	preset: VehiclePresetName;
	terrain: 'track' | 'offroad';
	/** Body paint */
	color: number;
	/** One line under the title */
	blurb: string;
};

const STEP = 1 / 60;
const SUBSTEPS = 4;

export async function runVehicleDemo(
	options: VehicleDemoOptions,
): Promise<void> {
	const b3: Box3DModule = await Box3D();
	const app = createHarness({ camera: [0, 4, -9], target: [0, 1, 0] });
	app.controls.enabled = false;
	app.scene.fog = new THREE.Fog(0x1a1a1a, 90, 320);
	app.camera.far = 600;
	app.camera.updateProjectionMatrix();

	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [0, -9.81, 0];
	const world = b3.b3CreateWorld(worldDef);

	// ---------------------------------------------------------------------------
	// World
	// ---------------------------------------------------------------------------

	const hidden = new Set<number>();

	function staticBody(position: b3Vec3, rotation?: b3Quat): b3BodyId {
		const def = b3.b3DefaultBodyDef();
		def.position = position;
		if (rotation) def.rotation = rotation;
		return b3.b3CreateBody(world, def);
	}

	function hullBody(position: b3Vec3, points: number[]): void {
		const hull = b3.b3CreateHull(points);
		b3.b3CreateHullShape(staticBody(position), b3.b3DefaultShapeDef(), hull);
		b3.b3DestroyHull(hull);
	}

	function dynamicBox(
		position: b3Vec3,
		half: b3Vec3,
		density: number,
		rotation?: b3Quat,
	): void {
		const def = b3.b3DefaultBodyDef();
		def.type = b3.b3BodyType.b3_dynamicBody;
		def.position = position;
		if (rotation) def.rotation = rotation;
		const body = b3.b3CreateBody(world, def);
		const shapeDef = b3.b3DefaultShapeDef();
		shapeDef.density = density;
		b3.b3CreateBoxShape(body, shapeDef, half[0], half[1], half[2]);
	}

	// Wedge from (x, 0, z0) rising along +z to height h at z1
	function wedge(
		x: number,
		halfWidth: number,
		z0: number,
		z1: number,
		h: number,
	): void {
		const pts: number[] = [];
		for (const sx of [-halfWidth, halfWidth]) {
			pts.push(sx, 0, z0, sx, 0, z1, sx, h, z1);
		}
		hullBody([x, 0, 0], pts);
	}

	function gridTexture(
		base: string,
		line: string,
		cells: number,
	): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 256;
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, 256, 256);
		ctx.strokeStyle = line;
		ctx.lineWidth = 2;
		const step = 256 / cells;
		for (let i = 0; i <= cells; i++) {
			ctx.beginPath();
			ctx.moveTo(i * step, 0);
			ctx.lineTo(i * step, 256);
			ctx.moveTo(0, i * step);
			ctx.lineTo(256, i * step);
			ctx.stroke();
		}
		const texture = new THREE.CanvasTexture(canvas);
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
		texture.anisotropy = 8;
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}

	let spawn: b3Vec3 = [0, 1.4, 0];

	function buildTrack(): void {
		const size = 250;
		const ground = staticBody([0, -0.5, 0]);
		b3.b3CreateBoxShape(ground, b3.b3DefaultShapeDef(), size, 0.5, size);
		hidden.add(ground.index1);

		const texture = gridTexture('#3a3d40', '#4a4e52', 4);
		texture.repeat.set(size / 4, size / 4);
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(size * 2, size * 2),
			new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
		);
		floor.rotation.x = -Math.PI / 2;
		app.scene.add(floor);

		// Circuit: a painted stadium oval around the course
		const ribbon = new THREE.Shape();
		const outer = 50;
		const inner = 40;
		const straight = 45;
		const cz = 45;
		ribbon.absarc(0, cz + straight, outer, 0, Math.PI, false);
		ribbon.absarc(0, cz - straight, outer, Math.PI, 2 * Math.PI, false);
		const hole = new THREE.Path();
		hole.absarc(0, cz + straight, inner, 0, Math.PI, false);
		hole.absarc(0, cz - straight, inner, Math.PI, 2 * Math.PI, false);
		ribbon.holes.push(hole);
		const circuit = new THREE.Mesh(
			new THREE.ShapeGeometry(ribbon, 48),
			new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.8 }),
		);
		circuit.rotation.x = Math.PI / 2;
		circuit.position.y = 0.01;
		app.scene.add(circuit);

		// Slalom cones down the start straight
		for (let i = 0; i < 7; i++) {
			const z = 25 + i * 11;
			dynamicBox([0, 0.4, z], [0.25, 0.4, 0.25], 25);
		}

		// Loose boxes past the slalom
		for (let row = 0; row < 4; row++) {
			for (let i = 0; i < 4 - row; i++) {
				dynamicBox(
					[(i - (3 - row) / 2) * 1.05, 0.5 + row * 1.0, 112],
					[0.5, 0.5, 0.5],
					60,
				);
			}
		}

		// Speed bumps in the left lane
		for (let i = 0; i < 6; i++) {
			const bump = staticBody([-22, 0, 15 + i * 12]);
			b3.b3CreateCapsuleShape(bump, b3.b3DefaultShapeDef(), {
				center1: [-5, 0, 0],
				center2: [5, 0, 0],
				radius: 0.14,
			});
		}

		// Jump ramp in the right lane, rising toward +z
		wedge(22, 4, 20, 34, 2.6);

		// A 20° hill with a flat top, to test the parking hold
		const rise = 7;
		const run = rise / Math.tan((20 * Math.PI) / 180);
		const z0 = 25;
		const pts: number[] = [];
		for (const sx of [-7, 7]) {
			pts.push(
				sx,
				0,
				z0,
				sx,
				rise,
				z0 + run,
				sx,
				rise,
				z0 + run + 12,
				sx,
				0,
				z0 + 2 * run + 12,
			);
		}
		hullBody([-62, 0, 0], pts);
	}

	function buildOffroad(): void {
		const count = 129;
		const cell = 2;
		const half = ((count - 1) * cell) / 2;

		const smooth = (e0: number, e1: number, x: number) => {
			const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
			return t * t * (3 - 2 * t);
		};
		const bump = (
			x: number,
			z: number,
			cx: number,
			cz: number,
			height: number,
			radius: number,
		) =>
			height *
			Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * radius * radius));
		const heightAt = (x: number, z: number) => {
			let h =
				1.6 * Math.sin(x * 0.06) * Math.cos(z * 0.05) +
				0.7 * Math.sin(x * 0.17 + z * 0.11) +
				0.25 * Math.sin(x * 0.45) * Math.sin(z * 0.4);
			h += bump(x, z, 55, 45, 16, 13); // steep hill
			h -= bump(x, z, -55, 55, 6, 14); // bowl
			h += bump(x, z, -60, -50, 9, 18);
			const moguls = smooth(30, 18, Math.hypot(x + 35, z + 5));
			h += moguls * 0.45 * Math.sin(x * 1.1) * Math.sin(z * 1.1);
			const flatSpawn = smooth(10, 22, Math.hypot(x, z));
			const flatRamp = smooth(
				10,
				16,
				Math.max(Math.abs(x) * 1.6, Math.abs(z - 38)),
			);
			const edge = smooth(
				half - 6,
				half - 30,
				Math.max(Math.abs(x), Math.abs(z)),
			);
			return h * flatSpawn * flatRamp * edge + (1 - edge) * 6;
		};

		const heights: number[] = [];
		for (let iz = 0; iz < count; iz++) {
			for (let ix = 0; ix < count; ix++) {
				heights.push(heightAt(ix * cell - half, iz * cell - half));
			}
		}
		const field = b3.b3CreateHeightField(heights, count, count, [
			cell,
			1,
			cell,
		]);
		b3.b3CreateHeightFieldShape(
			staticBody([-half, 0, -half]),
			b3.b3DefaultShapeDef(),
			field,
		);

		const positions = new Float32Array(count * count * 3);
		const colors = new Float32Array(count * count * 3);
		const low = new THREE.Color(0x4a5a34);
		const high = new THREE.Color(0x8a7a58);
		const color = new THREE.Color();
		for (let iz = 0, p = 0; iz < count; iz++) {
			for (let ix = 0; ix < count; ix++, p += 3) {
				const h = heights[iz * count + ix];
				positions[p] = ix * cell - half;
				positions[p + 1] = h;
				positions[p + 2] = iz * cell - half;
				color.copy(low).lerp(high, Math.min(Math.max((h + 2) / 14, 0), 1));
				colors[p] = color.r;
				colors[p + 1] = color.g;
				colors[p + 2] = color.b;
			}
		}
		const indices: number[] = [];
		for (let iz = 0; iz < count - 1; iz++) {
			for (let ix = 0; ix < count - 1; ix++) {
				const a = iz * count + ix;
				const b = a + 1;
				const c = a + count;
				const d = c + 1;
				indices.push(a, c, b, b, c, d);
			}
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		const uv = new Float32Array(count * count * 2);
		for (let i = 0; i < count * count; i++) {
			uv[i * 2] = positions[i * 3] / 4;
			uv[i * 2 + 1] = positions[i * 3 + 2] / 4;
		}
		geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		const texture = gridTexture('#ffffff', '#d8d8d8', 2);
		app.scene.add(
			new THREE.Mesh(
				geometry,
				new THREE.MeshStandardMaterial({
					vertexColors: true,
					map: texture,
					roughness: 1,
				}),
			),
		);

		// Ramp on the flattened pad ahead of the spawn
		wedge(0, 3.5, 30, 42, 2.8);

		// Rocks: half-buried hulls from a seeded generator
		let seed = 7;
		const random = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (let i = 0; i < 70; i++) {
			const x = (random() - 0.5) * 2 * (half - 20);
			const z = (random() - 0.5) * 2 * (half - 20);
			if (Math.hypot(x, z) < 18 || (Math.abs(x) < 8 && Math.abs(z - 36) < 12))
				continue;
			const r = 0.4 + random() * 1.1;
			const pts: number[] = [];
			for (let k = 0; k < 14; k++) {
				const u = random() * 2 - 1;
				const a = random() * Math.PI * 2;
				const s = Math.sqrt(1 - u * u);
				const k2 = 0.7 + random() * 0.5;
				pts.push(
					r * k2 * s * Math.cos(a),
					r * k2 * u * 0.7,
					r * k2 * s * Math.sin(a),
				);
			}
			hullBody([x, heightAt(x, z) - r * 0.2, z], pts);
		}

		// A few crates to shove around
		for (let i = 0; i < 6; i++) {
			dynamicBox(
				[-14 + (i % 3) * 1.3, 0.5 + Math.floor(i / 3), 14],
				[0.6, 0.5, 0.6],
				40,
			);
		}
		spawn = [0, heightAt(0, 0) + 1.6, 0];
	}

	if (options.terrain === 'track') buildTrack();
	else buildOffroad();

	// ---------------------------------------------------------------------------
	// Vehicle
	// ---------------------------------------------------------------------------

	const preset = vehiclePresets[options.preset];
	const [hx, hy, hz] = preset.halfExtents;
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = spawn;
	const chassis = b3.b3CreateBody(world, bodyDef);
	b3.b3CreateBoxShape(chassis, b3.b3DefaultShapeDef(), hx, hy, hz);
	hidden.add(chassis.index1);

	const defaults: b3VehicleDef = createPresetVehicleDef(b3, options.preset);
	const def = createPresetVehicleDef(b3, options.preset);
	def.chassisId = chassis;
	const vehicle = b3.b3CreateVehicle(world, def);
	const wheelCount = b3.b3Vehicle_GetWheelCount(vehicle);

	// The settings panel edits the live vehicle, so anything drawn from its settings reads this
	// cache instead of the preset. Reading them through embind builds a fresh object each time,
	// so refresh a few times a second rather than every frame.
	const live = {
		maxRpm: defaults.engine.maxRpm,
		manual: false,
		tractionControl: false,
		abs: false,
		wheels: defaults.wheels.slice(0, wheelCount),
	};
	function refreshLive(): void {
		live.maxRpm = b3.b3Vehicle_GetEngine(vehicle).maxRpm;
		live.manual =
			b3.b3Vehicle_GetTransmission(vehicle).mode.value ===
			b3.b3VehicleTransmissionMode.b3_vehicleTransmissionManual.value;
		const assists = b3.b3Vehicle_GetAssists(vehicle);
		live.tractionControl = assists.tractionControl;
		live.abs = assists.abs;
		for (let i = 0; i < wheelCount; i++)
			live.wheels[i] = b3.b3Vehicle_GetWheel(vehicle, i);
	}
	refreshLive();

	const stateBuffer = b3.createVehicleStateBuffer();
	const state = b3.createVehicleStateRecord();
	const wheelRecord: VehicleWheelRecord = b3.createVehicleWheelRecord();

	const worldRenderer = createWorldRenderer(b3, world, {
		shouldDraw: (_shape, body) => !hidden.has(body.index1),
	});
	app.scene.add(worldRenderer.object3d);

	const settings = createVehicleSettings(
		app.gui,
		b3,
		vehicle,
		defaults,
		stateBuffer,
	);

	// ---- Car visuals
	const car = new THREE.Group();
	app.scene.add(car);
	const paint = new THREE.MeshStandardMaterial({
		color: options.color,
		roughness: 0.35,
		metalness: 0.3,
	});
	const glass = new THREE.MeshStandardMaterial({
		color: 0x1b2430,
		roughness: 0.15,
		metalness: 0.6,
	});
	const trim = new THREE.MeshStandardMaterial({
		color: 0x18181a,
		roughness: 0.8,
	});
	const addBox = (
		w: number,
		h: number,
		d: number,
		x: number,
		y: number,
		z: number,
		m: THREE.Material,
	) => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
		mesh.position.set(x, y, z);
		car.add(mesh);
		return mesh;
	};
	addBox(hx * 2, hy * 2, hz * 2, 0, 0, 0, paint);
	const offroad = options.preset === 'offroad';
	const cabinLength = hz * (offroad ? 1.25 : 1.0);
	const cabinHeight = offroad ? hy * 1.5 : hy * 1.6;
	addBox(
		hx * 1.75,
		cabinHeight,
		cabinLength,
		0,
		hy + cabinHeight / 2,
		offroad ? -hz * 0.2 : -hz * 0.12,
		glass,
	);
	addBox(
		hx * 1.6,
		0.05,
		cabinLength * 0.9,
		0,
		hy + cabinHeight + 0.025,
		offroad ? -hz * 0.2 : -hz * 0.12,
		paint,
	);
	addBox(hx * 2.02, hy * 0.5, 0.12, 0, -hy * 0.35, hz + 0.02, trim);
	addBox(hx * 2.02, hy * 0.5, 0.12, 0, -hy * 0.35, -hz - 0.02, trim);
	const lamp = new THREE.MeshStandardMaterial({
		color: 0xfff3c4,
		emissive: 0xfff0b0,
		emissiveIntensity: 1.2,
	});
	const tail = new THREE.MeshStandardMaterial({
		color: 0x550000,
		emissive: 0xff2010,
		emissiveIntensity: 0.3,
	});
	for (const side of [-1, 1]) {
		addBox(0.3, 0.12, 0.05, side * hx * 0.7, hy * 0.35, hz + 0.01, lamp);
		addBox(0.3, 0.12, 0.05, side * hx * 0.7, hy * 0.35, -hz - 0.01, tail);
	}

	type WheelVisual = {
		group: THREE.Group;
		tire: THREE.MeshStandardMaterial;
		/** Radius and width the meshes were built with, to scale them to the live wheel */
		radius: number;
		width: number;
		localY: number;
		initialized: boolean;
	};
	const wheelVisuals: WheelVisual[] = [];
	for (let i = 0; i < wheelCount; i++) {
		const w = defaults.wheels[i];
		const group = new THREE.Group();
		const tire = new THREE.MeshStandardMaterial({
			color: 0x1c1c1c,
			roughness: 0.9,
		});
		const tireMesh = new THREE.Mesh(
			new THREE.CylinderGeometry(w.radius, w.radius, w.width, 28),
			tire,
		);
		tireMesh.rotation.z = Math.PI / 2;
		group.add(tireMesh);
		const rimMaterial = new THREE.MeshStandardMaterial({
			color: 0xb8bcc2,
			metalness: 0.8,
			roughness: 0.3,
		});
		const rim = new THREE.Mesh(
			new THREE.CylinderGeometry(
				w.radius * 0.62,
				w.radius * 0.62,
				w.width * 1.04,
				20,
			),
			rimMaterial,
		);
		rim.rotation.z = Math.PI / 2;
		group.add(rim);
		for (let s = 0; s < 3; s++) {
			const spoke = new THREE.Mesh(
				new THREE.BoxGeometry(w.width * 1.08, w.radius * 1.15, w.radius * 0.16),
				trim,
			);
			spoke.rotation.x = (s * Math.PI) / 3;
			group.add(spoke);
		}
		car.add(group);
		wheelVisuals.push({
			group,
			tire,
			radius: w.radius,
			width: w.width,
			localY: 0,
			initialized: false,
		});
	}

	// ---- Skid marks: instanced quads dropped under sliding tires
	const maxMarks = 3000;
	const marks = new THREE.InstancedMesh(
		new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({
			color: 0x0b0b0b,
			transparent: true,
			opacity: 0.55,
			depthWrite: false,
		}),
		maxMarks,
	);
	marks.count = 0;
	marks.frustumCulled = false;
	marks.renderOrder = 1;
	app.scene.add(marks);
	let markCursor = 0;
	const lastMark: (THREE.Vector3 | null)[] = new Array(wheelCount).fill(null);
	const markMatrix = new THREE.Matrix4();
	const markQuat = new THREE.Quaternion();
	const markScale = new THREE.Vector3();
	const markPos = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const normal = new THREE.Vector3();
	const dir = new THREE.Vector3();
	const tangentQuat = new THREE.Quaternion();

	function addMark(
		i: number,
		point: THREE.Vector3,
		n: THREE.Vector3,
		width: number,
	): void {
		const last = lastMark[i];
		if (last === null || last.distanceTo(point) > 1.5) {
			lastMark[i] = point.clone();
			return;
		}
		const length = last.distanceTo(point);
		if (length < 0.25) return;
		dir.subVectors(point, last).normalize();
		markPos
			.addVectors(point, last)
			.multiplyScalar(0.5)
			.addScaledVector(n, 0.02);
		markQuat.setFromUnitVectors(up, n);
		const localDir = dir.clone().applyQuaternion(markQuat.clone().invert());
		tangentQuat.setFromAxisAngle(up, Math.atan2(localDir.x, localDir.z));
		markQuat.multiply(tangentQuat);
		markScale.set(width, 1, length);
		markMatrix.compose(markPos, markQuat, markScale);
		marks.setMatrixAt(markCursor, markMatrix);
		markCursor = (markCursor + 1) % maxMarks;
		marks.count = Math.min(marks.count + 1, maxMarks);
		marks.instanceMatrix.needsUpdate = true;
		last.copy(point);
	}

	// ---------------------------------------------------------------------------
	// Input
	// ---------------------------------------------------------------------------

	const keys = new Set<string>();
	const driveKeys = new Set([
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Space',
	]);
	window.addEventListener('keydown', (e) => {
		if (e.target instanceof HTMLInputElement) return;
		if (driveKeys.has(e.code)) e.preventDefault();
		if (!e.repeat) onPress(e.code);
		keys.add(e.code);
	});
	window.addEventListener('keyup', (e) => keys.delete(e.code));
	window.addEventListener('blur', () => keys.clear());

	const isManual = () => live.manual;

	function setManual(manual: boolean): void {
		const transmission = b3.b3Vehicle_GetTransmission(vehicle);
		transmission.mode = manual
			? b3.b3VehicleTransmissionMode.b3_vehicleTransmissionManual
			: b3.b3VehicleTransmissionMode.b3_vehicleTransmissionAuto;
		b3.b3Vehicle_SetTransmission(vehicle, transmission);
		settings.sync();
		refreshLive();
	}

	function shift(delta: number): void {
		if (!isManual()) setManual(true);
		const gearCount = b3.b3Vehicle_GetTransmission(vehicle).gearCount;
		const gear = b3.b3Vehicle_GetState(vehicle).gear;
		b3.b3Vehicle_SetGear(
			vehicle,
			Math.min(Math.max(gear + delta, -1), gearCount),
		);
	}

	function resetCar(toSpawn: boolean): void {
		const [p, q] = b3.b3Body_GetTransform([0, 0, 0], [0, 0, 0, 1], chassis);
		const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
		const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
		const yaw = toSpawn ? 0 : Math.atan2(fx, fz);
		const position: b3Vec3 = toSpawn ? spawn : [p[0], p[1] + 1.5, p[2]];
		b3.b3Vehicle_Reset(vehicle, position, quatFromAxisAngle([0, 1, 0], yaw));
		lastMark.fill(null);
		for (const w of wheelVisuals) w.initialized = false;
		readPose();
		prevPos.copy(currPos);
		prevQuat.copy(currQuat);
	}

	function onPress(code: string): void {
		if (code === 'KeyE') shift(1);
		else if (code === 'KeyQ') shift(-1);
		else if (code === 'KeyM') setManual(!isManual());
		else if (code === 'KeyR') resetCar(false);
		else if (code === 'KeyT') resetCar(true);
	}

	const padPrev: boolean[] = [];
	function readInput() {
		const down = (...codes: string[]) =>
			codes.some((c) => keys.has(c)) ? 1 : 0;
		let throttle = down('KeyW', 'ArrowUp');
		let reverse = down('KeyS', 'ArrowDown');
		let steer = down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft');
		let handbrake = down('Space');

		const pad = navigator.getGamepads?.().find((p) => p !== null);
		if (pad) {
			const axis = pad.axes[0] ?? 0;
			if (Math.abs(axis) > 0.08)
				steer = Math.sign(axis) * ((Math.abs(axis) - 0.08) / 0.92);
			throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
			reverse = Math.max(reverse, pad.buttons[6]?.value ?? 0);
			handbrake = Math.max(
				handbrake,
				pad.buttons[0]?.pressed || pad.buttons[1]?.pressed ? 1 : 0,
			);
			const edge = (i: number, fn: () => void) => {
				const pressed = pad.buttons[i]?.pressed ?? false;
				if (pressed && !padPrev[i]) fn();
				padPrev[i] = pressed;
			};
			edge(5, () => shift(1));
			edge(4, () => shift(-1));
			edge(3, () => resetCar(false));
		}

		if (isManual())
			return { forward: throttle, brake: reverse, steer, handbrake };
		return { forward: throttle - reverse, brake: 0, steer, handbrake };
	}

	// ---------------------------------------------------------------------------
	// HUD
	// ---------------------------------------------------------------------------

	const info = document.createElement('div');
	info.className = 'overlay';
	info.innerHTML =
		`<b>${preset.title}</b><br>${options.blurb}<br>` +
		'<span style="opacity:.75">W/S or ↑/↓ drive and brake · A/D steer · space handbrake<br>' +
		'Q/E shift (manual) · M auto/manual · R flip upright · T back to start · gamepad works too</span>';
	document.body.appendChild(info);

	const hud = document.createElement('div');
	hud.style.cssText =
		'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);padding:8px 16px;border-radius:8px;' +
		'background:rgba(0,0,0,.55);color:#eee;font:600 14px ui-monospace,monospace;text-align:center;' +
		'pointer-events:none;user-select:none;min-width:260px';
	hud.innerHTML =
		'<div><span id="hud-speed" style="font-size:30px">0</span> km/h &nbsp; <span id="hud-gear" style="font-size:22px">N</span></div>' +
		'<div style="height:6px;background:#333;border-radius:3px;margin:6px 0;overflow:hidden">' +
		'<div id="hud-rpm" style="height:100%;width:0;background:#4d96ff"></div></div>' +
		'<div id="hud-flags" style="font-size:11px;opacity:.8"></div>';
	document.body.appendChild(hud);
	const hudSpeed = hud.querySelector('#hud-speed') as HTMLElement;
	const hudGear = hud.querySelector('#hud-gear') as HTMLElement;
	const hudRpm = hud.querySelector('#hud-rpm') as HTMLElement;
	const hudFlags = hud.querySelector('#hud-flags') as HTMLElement;

	function updateHud(): void {
		hudSpeed.textContent = Math.abs(state.speed * 3.6).toFixed(0);
		hudGear.textContent =
			state.gear < 0 ? 'R' : state.gear === 0 ? 'N' : String(state.gear);
		const rpm = Math.min(state.engineRpm / live.maxRpm, 1);
		hudRpm.style.width = `${(rpm * 100).toFixed(1)}%`;
		hudRpm.style.background = rpm > 0.9 ? '#ff6b6b' : '#4d96ff';
		const flags = [
			isManual() ? 'MANUAL' : 'AUTO',
			`${state.engineRpm.toFixed(0)} rpm`,
			live.tractionControl ? 'TC' : '',
			live.abs ? 'ABS' : '',
			state.stuck ? 'stuck: press R' : '',
		];
		hudFlags.textContent = flags.filter(Boolean).join(' · ');
	}

	// ---------------------------------------------------------------------------
	// Loop
	// ---------------------------------------------------------------------------

	const prevPos = new THREE.Vector3();
	const currPos = new THREE.Vector3();
	const prevQuat = new THREE.Quaternion();
	const currQuat = new THREE.Quaternion();
	const scratchPos: b3Vec3 = [0, 0, 0];
	const scratchQuat: b3Quat = [0, 0, 0, 1];

	function readPose(): void {
		b3.b3Body_GetTransform(scratchPos, scratchQuat, chassis);
		currPos.set(scratchPos[0], scratchPos[1], scratchPos[2]);
		currQuat.set(
			scratchQuat[0],
			scratchQuat[1],
			scratchQuat[2],
			scratchQuat[3],
		);
		b3.getVehicleStateData(stateBuffer, vehicle);
		b3.getVehicleStateAt(state, stateBuffer);
	}
	readPose();
	prevPos.copy(currPos);
	prevQuat.copy(currQuat);

	const renderPos = new THREE.Vector3();
	const renderQuat = new THREE.Quaternion();
	const invQuat = new THREE.Quaternion();
	const wheelPos = new THREE.Vector3();
	const wheelQuat = new THREE.Quaternion();
	const contact = new THREE.Vector3();
	const camPos = new THREE.Vector3(spawn[0], spawn[1] + 3, spawn[2] - 9);
	const camTarget = new THREE.Vector3();
	const forward = new THREE.Vector3();
	const slipColor = new THREE.Color();
	const tireBase = new THREE.Color(0x1c1c1c);
	const tireHot = new THREE.Color(0xff5a1f);
	const camDistance = hz * 2 + 4.5;
	const camHeight = hy + (offroad ? 2.6 : 2.0);

	let accumulator = 0;
	let telemetryTimer = 0;

	app.onFrame((dt) => {
		accumulator += dt;
		const input = readInput();
		app.step(() => {
			let steps = 0;
			while (accumulator >= STEP && steps < 4) {
				prevPos.copy(currPos);
				prevQuat.copy(currQuat);
				b3.b3Vehicle_SetInput(vehicle, input);
				b3.b3World_Step(world, STEP, SUBSTEPS);
				readPose();
				accumulator -= STEP;
				steps++;
			}
			// Drop the backlog only when the catch-up cap left a whole step unsimulated
			if (accumulator >= STEP) accumulator = 0;
		});
		if (currPos.y < -30) resetCar(true);

		const alpha = accumulator / STEP;
		renderPos.lerpVectors(prevPos, currPos, alpha);
		renderQuat.slerpQuaternions(prevQuat, currQuat, alpha);
		car.position.copy(renderPos);
		car.quaternion.copy(renderQuat);

		// Wheels in chassis space, with the suspension travel smoothed so debris does not
		// make them jitter
		invQuat.copy(currQuat).invert();
		const smoothing = 1 - Math.exp(-dt * 35);
		for (let i = 0; i < wheelCount; i++) {
			b3.getVehicleWheelAt(wheelRecord, stateBuffer, i);
			const visual = wheelVisuals[i];
			const p = wheelRecord.position;
			const q = wheelRecord.rotation;
			wheelPos.set(p[0], p[1], p[2]).sub(currPos).applyQuaternion(invQuat);
			wheelQuat.set(q[0], q[1], q[2], q[3]).premultiply(invQuat);
			if (!visual.initialized) {
				visual.localY = wheelPos.y;
				visual.initialized = true;
			}
			visual.localY += (wheelPos.y - visual.localY) * smoothing;
			visual.group.position.set(wheelPos.x, visual.localY, wheelPos.z);
			visual.group.quaternion.copy(wheelQuat);

			const wheelDef = live.wheels[i];
			visual.group.scale.set(
				wheelDef.width / visual.width,
				wheelDef.radius / visual.radius,
				wheelDef.radius / visual.radius,
			);
			const slide = wheelRecord.hasContact
				? Math.max(
						Math.abs(wheelRecord.slipRatio) /
							Math.max(wheelDef.tire.longitudinalSlideSlip, 1e-3),
						Math.abs(wheelRecord.slipAngle) /
							Math.max(wheelDef.tire.lateralSlideAngle, 1e-3),
					)
				: 0;
			const heat = Math.min(Math.max((slide - 0.35) / 0.65, 0), 1);
			slipColor.copy(tireBase).lerp(tireHot, heat);
			visual.tire.color.copy(slipColor);
			if (wheelRecord.hasContact && heat > 0.2 && Math.abs(state.speed) > 1) {
				const c = wheelRecord.contactPoint;
				const n = wheelRecord.contactNormal;
				contact.set(c[0], c[1], c[2]);
				normal.set(n[0], n[1], n[2]);
				addMark(i, contact, normal, wheelDef.width);
			} else {
				lastMark[i] = null;
			}
		}

		// Chase camera behind the car, flattened to the horizon
		forward.set(0, 0, 1).applyQuaternion(renderQuat);
		forward.y = 0;
		if (forward.lengthSq() < 1e-4) forward.set(0, 0, 1);
		forward.normalize();
		const desired = new THREE.Vector3()
			.copy(renderPos)
			.addScaledVector(forward, -camDistance)
			.add(new THREE.Vector3(0, camHeight, 0));
		camPos.lerp(desired, 1 - Math.exp(-dt * 6));
		camTarget
			.copy(renderPos)
			.add(new THREE.Vector3(0, 0.8, 0))
			.addScaledVector(forward, 2);
		app.camera.position.copy(camPos);
		app.controls.target.copy(camTarget);
		app.camera.lookAt(camTarget);

		worldRenderer.update();
		updateHud();
		telemetryTimer += dt;
		if (telemetryTimer > 0.1) {
			telemetryTimer = 0;
			settings.update();
			refreshLive();
		}
	});
	app.start();
}
