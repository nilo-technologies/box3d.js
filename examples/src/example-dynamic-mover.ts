// Dynamic Mover — box3d's dynamic character controller from box3d.js/character,
// a port of box3d's samples/dynamic_mover.cpp. The capsule is a rigid body with
// locked rotation: a mover joint drives it toward the target velocity and a pogo
// joint holds it above the ground, so it climbs steps, pushes crates and is
// pushed back, slides off steep slopes and rides tagged kinematic platforms.
//
// The course, clockwise from the start:
// * north: three stair flights (0.15, 0.3 and 0.45 steps) to a landing, a
//   bridge, and a ramp back down; stepping posts and a balance beam
// * west: ramps at 15°, 30° and 42° (walkable) and 55° (too steep, you slide)
// * south-west: props — a crate pyramid, barrels, balls, logs, a heavy crate
//   and a seesaw
// * south-east: rough ground of half-buried spheres, and a spinning sweeper arm
//   that shoves the character unless it jumps
// * east: moving platforms — a slider, an elevator up to a high deck, and a
//   ferry. They are tagged with the mover's platformMaterialId, so the mover
//   joint attaches to them and they carry the character.
//
// The pogo rays are drawn each frame: the central ray, plus the octagon "skirt"
// cast when the centre misses or lands on a steep surface. Green is the ray the
// pogo used, yellow the other hits, grey the misses.
//
// Controls: WASD move (camera-relative) · Space jump · Shift sprint · R reset ·
// drag to orbit.

import type {
	Box3DModule,
	b3BodyId,
	b3HullData,
	b3Quat,
	b3Vec3,
} from 'box3d.js';
import { DynamicMover } from 'box3d.js/character';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';
import { quatFromAxisAngle } from './math';

const b3: Box3DModule = await Box3D();
const START: b3Vec3 = [0, 1.5, 3];
const app = createHarness({ camera: [0, 6, 11], target: START });

const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());

const PLATFORM_MATERIAL = 1n;
const IDENTITY: b3Quat = [0, 0, 0, 1];
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function body(
	type: 'static' | 'kinematic' | 'dynamic',
	position: b3Vec3,
	rotation: b3Quat = IDENTITY,
): b3BodyId {
	const def = b3.b3DefaultBodyDef();
	if (type === 'kinematic') def.type = b3.b3BodyType.b3_kinematicBody;
	if (type === 'dynamic') def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = position;
	def.rotation = rotation;
	return b3.b3CreateBody(world, def);
}

function shapeDef(density = 1, platform = false) {
	const sd = b3.b3DefaultShapeDef();
	sd.density = density;
	if (platform) sd.baseMaterial.userMaterialId = PLATFORM_MATERIAL;
	return sd;
}

function staticBox(
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	q?: b3Quat,
): b3BodyId {
	const b = body('static', [x, y, z], q);
	b3.b3CreateBoxShape(b, shapeDef(), hx, hy, hz);
	return b;
}

// A cylinder hull centred on its body. The hull is copied into the shape.
function cylinder(
	b: b3BodyId,
	height: number,
	radius: number,
	density = 1,
): void {
	const hull = b3.b3CreateCylinder(
		height,
		radius,
		-height / 2,
		24,
	) as b3HullData;
	b3.b3CreateHullShape(b, shapeDef(density), hull);
	b3.b3DestroyHull(hull);
}

// A ramp whose top surface rises from the ground at z = zStart to `rise` toward -z,
// with a pad at the top so the character can stand there.
function ramp(
	x: number,
	zStart: number,
	halfWidth: number,
	rise: number,
	degrees: number,
): void {
	const angle = degrees * DEG;
	const run = rise / Math.tan(angle);
	const length = rise / Math.sin(angle);
	const t = 0.2;
	staticBox(
		x,
		rise / 2 - (Math.cos(angle) * t) / 2,
		zStart - run / 2 - (Math.sin(angle) * t) / 2,
		halfWidth,
		t / 2,
		length / 2,
		quatFromAxisAngle([1, 0, 0], angle),
	);
	staticBox(x, rise / 2, zStart - run - 1, halfWidth, rise / 2, 1);
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

// ground, top at y = 0, and a low perimeter wall
staticBox(0, -0.5, 0, 30, 0.5, 30);
staticBox(-30, 0.5, 0, 0.5, 1, 30);
staticBox(30, 0.5, 0, 0.5, 1, 30);
staticBox(0, 0.5, -30, 30, 1, 0.5);
staticBox(0, 0.5, 30, 30, 1, 0.5);

// north: three 6 m stair flights to a 1.8 m landing. The capsule's bottom rides
// about 0.6 m up, so the pogo steps up anything lower than that.
const LANDING = 1.8;
for (const [x, steps] of [
	[4, 12],
	[7, 6],
	[10, 4],
]) {
	const rise = LANDING / steps;
	const depth = 6 / steps;
	for (let i = 0; i < steps; i++) {
		const top = rise * (i + 1);
		staticBox(x, top / 2, -4 - (i + 0.5) * depth, 1.3, top / 2, depth / 2);
	}
}
staticBox(7, LANDING / 2, -12, 4.3, LANDING / 2, 2);
// bridge east from the landing, then a 25° ramp back down
staticBox(15.55, LANDING - 0.1, -13.3, 4.25, 0.1, 0.6);
ramp(21, -12.6 + LANDING / Math.tan(25 * DEG) + 1e-3, 1.2, LANDING, 25);

// north-centre: stepping posts and a balance beam, 0.4 m high. The skirt rays let the
// mover stand on them when the centre ray misses.
for (let i = 0; i < 7; i++) {
	const post = body('static', [-1 + (i % 2) * 0.8, 0.2, -4 - i]);
	cylinder(post, 0.4, 0.3);
}
staticBox(1.6, 0.2, -7, 0.08, 0.2, 3);

// west: ramps, steepest last. 42° is still walkable (normal y 0.74 > 0.7); 55° is not.
ramp(-5, -2, 1.5, 1.5, 15);
ramp(-9, -2, 1.5, 2, 30);
ramp(-13, -2, 1.5, 2.5, 42);
ramp(-17, -2, 1.5, 3, 55);

// south-west: props
{
	// crate pyramid
	for (let row = 0; row < 4; row++) {
		for (let i = 0; i < 4 - row; i++) {
			const b = body('dynamic', [
				-7 + i * 0.85 + row * 0.42,
				0.4 + row * 0.8,
				6,
			]);
			b3.b3CreateBoxShape(b, shapeDef(40), 0.4, 0.4, 0.4);
		}
	}
	// barrels
	for (let i = 0; i < 4; i++)
		cylinder(body('dynamic', [-12 + i * 0.9, 0.5, 5]), 1, 0.35, 60);
	// balls
	for (let i = 0; i < 6; i++) {
		const r = 0.3 + 0.05 * i;
		const b = body('dynamic', [
			-15 + (i % 3) * 1.2,
			r,
			8 + Math.floor(i / 3) * 1.4,
		]);
		b3.b3CreateSphereShape(b, shapeDef(30), { center: [0, 0, 0], radius: r });
	}
	// logs
	for (let i = 0; i < 3; i++) {
		const b = body('dynamic', [-7, 0.25, 10 + i * 0.7]);
		b3.b3CreateCapsuleShape(b, shapeDef(50), {
			center1: [-0.8, 0, 0],
			center2: [0.8, 0, 0],
			radius: 0.25,
		});
	}
	// a heavy crate the mover can barely shove
	b3.b3CreateBoxShape(
		body('dynamic', [-4, 0.6, 12]),
		shapeDef(1500),
		0.6,
		0.6,
		0.6,
	);

	// seesaw: a plank on a revolute joint about z, limited to ±17°
	const pivot = staticBox(-12, 0.25, 13, 0.2, 0.25, 0.6);
	const plank = body('dynamic', [-12, 0.58, 13]);
	b3.b3CreateBoxShape(plank, shapeDef(20), 3, 0.08, 0.8);
	const jd = b3.b3DefaultRevoluteJointDef();
	jd.base.bodyIdA = pivot;
	jd.base.bodyIdB = plank;
	jd.base.localFrameA = { position: [0, 0.25, 0], quaternion: IDENTITY };
	jd.base.localFrameB = { position: [0, -0.08, 0], quaternion: IDENTITY };
	jd.enableLimit = true;
	jd.lowerAngle = -0.3;
	jd.upperAngle = 0.3;
	b3.b3CreateRevoluteJoint(world, jd);
}

// south-east: rough ground of half-buried spheres
for (let i = 0; i < 24; i++) {
	const r = 0.3 + 0.3 * (((i * 7) % 5) / 4);
	const b = body('static', [
		1.5 + (i % 6) * 1.1,
		-r * 0.45,
		11 + Math.floor(i / 6) * 1.2,
	]);
	b3.b3CreateSphereShape(b, shapeDef(), { center: [0, 0, 0], radius: r });
}

// east: moving platforms, all tagged so the mover rides them
interface MovingPlatform {
	body: b3BodyId;
	path: (t: number, out: b3Vec3) => void;
}
const platforms: MovingPlatform[] = [];
// A 0.2 m thick slab tagged with PLATFORM_MATERIAL that follows `path`.
function kinematicPlatform(
	position: b3Vec3,
	hx: number,
	hz: number,
	path: MovingPlatform['path'],
): void {
	const b = body('kinematic', position);
	b3.b3CreateBoxShape(b, shapeDef(1, true), hx, 0.1, hz);
	platforms.push({ body: b, path });
}

// slider: back and forth along x
kinematicPlatform([11, 0.25, 5], 1.5, 1.5, (t, out) => {
	out[0] = 11 + 3 * Math.sin(0.5 * t);
	out[1] = 0.25;
	out[2] = 5;
});
// elevator: from the ground up to a 3.3 m deck
kinematicPlatform([18, 0.25, 5], 1.5, 1.5, (t, out) => {
	out[0] = 18;
	out[1] = 0.25 + 1.5 * (1 - Math.cos(0.4 * t));
	out[2] = 5;
});
staticBox(21.5, 1.65, 5, 2, 1.65, 2);
// sweeper: a spinning arm at waist height. It isn't a platform: the mover is a dynamic
// body, so the arm shoves it aside unless you jump over. (The mover joint matches a
// platform's linear velocity only, as upstream, so it doesn't ride spinning bodies.)
{
	const hub = body('static', [11, 0.4, 13]);
	cylinder(hub, 0.8, 0.4);
	const sweeper = body('kinematic', [11, 1, 13]);
	b3.b3CreateBoxShape(sweeper, shapeDef(), 3, 0.12, 0.12);
	b3.b3Body_SetAngularVelocity(sweeper, [0, 0.9, 0]);
}
// ferry: a loop that rises and falls
kinematicPlatform([19, 0.25, 15], 1.3, 1.3, (t, out) => {
	out[0] = 19 + 2.5 * Math.cos(0.35 * t);
	out[1] = 0.25 + 0.8 * (1 - Math.cos(0.7 * t));
	out[2] = 15 + 4 * Math.sin(0.35 * t);
});

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

const mover = new DynamicMover(b3, world, {
	position: START,
	platformMaterialId: PLATFORM_MATERIAL,
});

const renderer = createWorldRenderer(b3, world);
app.scene.add(renderer.object3d);

function reset(): void {
	b3.b3Body_SetTransform(mover.bodyId, START, IDENTITY);
	b3.b3Body_SetLinearVelocity(mover.bodyId, [0, 0, 0]);
}

// ---------------------------------------------------------------------------
// Tuning — the same sliders as box3d's Dynamic Mover sample
// ---------------------------------------------------------------------------

const tuning = { gravityScale: mover.gravityScale, reset };
const folder = app.gui.addFolder('Mover');
folder.add(mover, 'enableSkirtPogo').name('skirt pogo');
folder.add(mover, 'jumpSpeed', 0, 20, 0.1).name('jump speed');
folder.add(mover, 'maxSpeed', 0, 20, 1).name('max speed');
folder.add(mover, 'accelerate', 0, 100, 1);
folder.add(mover, 'friction', 0, 20, 0.1);
folder.add(mover, 'airSteer', 0, 1, 0.01).name('air steer');
folder
	.add(tuning, 'gravityScale', 0.5, 4, 0.1)
	.name('gravity scale')
	.onChange((v: number) => mover.setGravityScale(v));
folder.add(mover, 'pogoHertz', 0, 30, 1).name('pogo hertz');
folder.add(mover, 'pogoDampingRatio', 0, 4, 0.1).name('pogo damping');
folder.add(mover, 'maxGroundForce', 0, 20000, 100).name('ground force');
folder.add(tuning, 'reset').name('reset (R)');

const status = { onGround: false, walkable: false, pogoLength: '0.00' };
const statusFolder = app.gui.addFolder('State');
statusFolder.add(status, 'onGround').name('on ground').listen().disable();
statusFolder.add(status, 'walkable').listen().disable();
statusFolder.add(status, 'pogoLength').name('pogo length').listen().disable();

// ---------------------------------------------------------------------------
// Pogo probe lines
// ---------------------------------------------------------------------------

const probePositions = new Float32Array(mover.probes.length * 6);
const probeColors = new Float32Array(mover.probes.length * 6);
const probeGeometry = new THREE.BufferGeometry();
probeGeometry.setAttribute(
	'position',
	new THREE.BufferAttribute(probePositions, 3),
);
probeGeometry.setAttribute('color', new THREE.BufferAttribute(probeColors, 3));
const probeLines = new THREE.LineSegments(
	probeGeometry,
	new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
);
probeLines.frustumCulled = false;
probeLines.renderOrder = 999;
app.scene.add(probeLines);

const GREY = new THREE.Color(0x808080);
const YELLOW = new THREE.Color(0xffd700);
const GREEN = new THREE.Color(0x00ff00);

function updateProbeLines(): void {
	for (let i = 0; i < mover.probeCount; i++) {
		const p = mover.probes[i];
		const o = i * 6;
		probePositions[o] = p.origin[0];
		probePositions[o + 1] = p.origin[1];
		probePositions[o + 2] = p.origin[2];
		probePositions[o + 3] = p.origin[0] + p.fraction * p.translation[0];
		probePositions[o + 4] = p.origin[1] + p.fraction * p.translation[1];
		probePositions[o + 5] = p.origin[2] + p.fraction * p.translation[2];
		const c = !p.hit ? GREY : i === mover.selectedProbe ? GREEN : YELLOW;
		for (let k = 0; k < 2; k++) {
			probeColors[o + 3 * k] = c.r;
			probeColors[o + 3 * k + 1] = c.g;
			probeColors[o + 3 * k + 2] = c.b;
		}
	}
	probeGeometry.setDrawRange(0, mover.probeCount * 2);
	probeGeometry.attributes.position.needsUpdate = true;
	probeGeometry.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Input and loop
// ---------------------------------------------------------------------------

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
	const key = e.key.toLowerCase();
	if (key === 'r' && !e.repeat) reset();
	keys.add(key);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
// A key released while the window is unfocused never sends keyup.
window.addEventListener('blur', () => keys.clear());

const TIME_STEP = 1 / 60;
const position: b3Vec3 = [0, 0, 0];
const lastPosition: b3Vec3 = [...START];
const target = { position: [0, 0, 0] as b3Vec3, quaternion: IDENTITY };
const camDir = new THREE.Vector3();
const forward: b3Vec3 = [0, 0, 0];
const right: b3Vec3 = [0, 0, 0];
const throttle: [number, number] = [0, 0];
let jumpReleased = true;
let elapsed = 0;
let accumulator = 0;

app.onFrame((dt) => {
	// camera-relative movement basis, flattened to the ground
	app.camera.getWorldDirection(camDir);
	camDir.y = 0;
	camDir.normalize();
	forward[0] = camDir.x;
	forward[2] = camDir.z;
	right[0] = -camDir.z;
	right[2] = camDir.x;

	throttle[0] = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
	throttle[1] = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);

	// Fixed 60 Hz steps for the real frame time, so the speed doesn't depend on the
	// display's refresh rate. The harness clamps dt to 1/30, so at most two per frame.
	accumulator += dt;
	app.step(() => {
		while (accumulator >= TIME_STEP) {
			accumulator -= TIME_STEP;
			elapsed += TIME_STEP;

			// kinematic platforms follow their paths by target transform, so contacts and
			// the mover joint see their velocity.
			for (const m of platforms) {
				m.path(elapsed, target.position);
				b3.b3Body_SetTargetTransform(m.body, target, TIME_STEP, true);
			}

			// jumping again needs a fresh press
			if (keys.has(' ')) {
				if (jumpReleased && mover.jump()) jumpReleased = false;
			} else {
				jumpReleased = true;
			}

			mover.update(
				TIME_STEP,
				forward,
				right,
				throttle,
				keys.has('shift') ? 1.5 : 1,
			);
			b3.b3World_Step(world, TIME_STEP, 4);
		}
	});

	renderer.update();
	updateProbeLines();

	status.onGround = mover.onGround;
	status.walkable = mover.walkable;
	status.pogoLength = mover.pogoLength.toFixed(2);

	// follow the mover, keeping the user's orbit offset
	b3.b3Body_GetPosition(position, mover.bodyId);
	app.camera.position.x += position[0] - lastPosition[0];
	app.camera.position.y += position[1] - lastPosition[1];
	app.camera.position.z += position[2] - lastPosition[2];
	app.controls.target.set(position[0], position[1], position[2]);
	lastPosition[0] = position[0];
	lastPosition[1] = position[1];
	lastPosition[2] = position[2];
});
app.start();
