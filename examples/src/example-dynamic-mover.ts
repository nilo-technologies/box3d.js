// Dynamic Mover — box3d's dynamic character controller from box3d.js/character,
// a port of box3d's samples/dynamic_mover.cpp. The capsule is a rigid body with
// locked rotation: a mover joint drives it toward the target velocity and a pogo
// joint holds it above the ground, so it climbs steps, pushes crates and is
// pushed back, slides off steep slopes and rides tagged kinematic platforms.
//
// The pogo rays are drawn each frame: the central ray, plus the octagon "skirt"
// cast when the centre misses or lands on a steep surface. Green is the ray the
// pogo used, yellow the other hits, grey the misses.
//
// Controls: WASD move (camera-relative) · Space jump · Shift sprint · drag to orbit.

import type { Box3DModule, b3BodyId, b3Quat, b3Vec3 } from 'box3d.js';
import { DynamicMover } from 'box3d.js/character';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';
import { quatFromAxisAngle } from './math';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 4, 8], target: [0, 1.5, 0] });

const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());

const PLATFORM_MATERIAL = 1n;

function staticBox(
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	q?: b3Quat,
): b3BodyId {
	const def = b3.b3DefaultBodyDef();
	def.position = [x, y, z];
	if (q) def.rotation = q;
	const body = b3.b3CreateBody(world, def);
	b3.b3CreateBoxShape(body, b3.b3DefaultShapeDef(), hx, hy, hz);
	return body;
}

// ground, top at y = 0
staticBox(0, -0.5, 0, 40, 0.5, 40);

// stairs up to a bridge: 10 steps of 0.2
for (let i = 0; i < 10; i++) {
	const h = 0.2 * (i + 1);
	staticBox(6, h / 2, -4 - 0.5 * i, 1.5, h / 2, 0.25);
}
staticBox(6, 1, -11, 1.5, 1, 2);

// a walkable 20° ramp and a 50° slope the mover slides off
staticBox(
	-6,
	0.9,
	-6,
	2,
	0.15,
	3,
	quatFromAxisAngle([1, 0, 0], (20 * Math.PI) / 180),
);
staticBox(
	-11,
	1.4,
	-6,
	2,
	0.15,
	3,
	quatFromAxisAngle([1, 0, 0], (50 * Math.PI) / 180),
);

// a narrow ledge: the skirt rays let the mover stand on its edge
staticBox(0, 0.6, -9, 1.5, 0.6, 0.1);

// pushable crates
for (let i = 0; i < 4; i++) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = [3 + 1.1 * i, 0.5, 4];
	const body = b3.b3CreateBody(world, def);
	const sd = b3.b3DefaultShapeDef();
	sd.density = 50;
	b3.b3CreateBoxShape(body, sd, 0.5, 0.5, 0.5);
}

// a kinematic platform tagged with PLATFORM_MATERIAL, so the mover rides it
const platformDef = b3.b3DefaultBodyDef();
platformDef.type = b3.b3BodyType.b3_kinematicBody;
platformDef.position = [-6, 0.6, 5];
const platform = b3.b3CreateBody(world, platformDef);
const platformShape = b3.b3DefaultShapeDef();
platformShape.baseMaterial.userMaterialId = PLATFORM_MATERIAL;
b3.b3CreateBoxShape(platform, platformShape, 1.5, 0.15, 1.5);
const platformCenter: b3Vec3 = [-6, 0.6, 5];

const mover = new DynamicMover(b3, world, {
	position: [0, 1.5, 0],
	platformMaterialId: PLATFORM_MATERIAL,
});

const renderer = createWorldRenderer(b3, world);
app.scene.add(renderer.object3d);

// ---------------------------------------------------------------------------
// Tuning — the same sliders as box3d's Dynamic Mover sample
// ---------------------------------------------------------------------------

const tuning = { gravityScale: mover.gravityScale };
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
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const TIME_STEP = 1 / 60;
const position: b3Vec3 = [0, 0, 0];
const lastPosition: b3Vec3 = [0, 1.5, 0];
const kinematicPosition: b3Vec3 = [0, 0, 0];
const camDir = new THREE.Vector3();
const forward: b3Vec3 = [0, 0, 0];
const right: b3Vec3 = [0, 0, 0];
const throttle: [number, number] = [0, 0];
let jumpReleased = true;
let elapsed = 0;

app.onFrame(() => {
	elapsed += TIME_STEP;

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

	app.step(() => {
		// slide the platform back and forth by velocity, so contacts and the mover joint follow it
		b3.b3Body_GetPosition(kinematicPosition, platform);
		const targetX = platformCenter[0] + 4 * Math.sin(0.6 * elapsed);
		b3.b3Body_SetLinearVelocity(platform, [
			(targetX - kinematicPosition[0]) / TIME_STEP,
			0,
			0,
		]);

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
