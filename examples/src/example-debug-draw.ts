// Debug Draw — one of every shape type, every joint type, and every body-state
// colour box3d can hold, drawn by box3d.js/three. Each Debug checkbox changes the
// overlay. The Filter folder hides the category-2 post (mask 1) and drops the
// joint row (it sits past drawingBounds.minZ). Disabled bodies leave the
// broadphase, and a time-of-impact colour lasts a single frame, so those two
// states are not in the scene.

import type { Box3DModule, b3Quat, b3Vec3 } from 'box3d.js';
import Box3D from 'box3d.js/inline';
import { createDebugRenderer, type DebugColorMap } from 'box3d.js/three';
import * as THREE from 'three';
import { createHarness } from './harness';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 9.5, 12.5], target: [0, 0.4, -0.4] });

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

const IDENTITY: b3Quat = [0, 0, 0, 1];
const Z_TO_Y: b3Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const JOINT_Z = -6.4;

function boxHull(hx: number, hy: number, hz: number) {
	return b3.b3CreateHull([
		-hx,
		-hy,
		-hz,
		hx,
		-hy,
		-hz,
		hx,
		-hy,
		hz,
		-hx,
		-hy,
		hz,
		-hx,
		hy,
		-hz,
		hx,
		hy,
		-hz,
		hx,
		hy,
		hz,
		-hx,
		hy,
		hz,
	])!;
}

function staticBody(position: b3Vec3) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_staticBody;
	def.position = position;
	return b3.b3CreateBody(world, def);
}

function dynamicBody(position: b3Vec3, awake: boolean) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = position;
	def.enableSleep = !awake;
	def.isAwake = awake;
	const body = b3.b3CreateBody(world, def);
	if (awake) b3.b3Body_EnableSleep(body, false);
	return body;
}

function kinematicBody(position: b3Vec3, awake: boolean) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_kinematicBody;
	def.position = position;
	def.enableSleep = !awake;
	def.isAwake = awake;
	const body = b3.b3CreateBody(world, def);
	if (awake) b3.b3Body_EnableSleep(body, false);
	return body;
}

function frame(position: b3Vec3, quaternion: b3Quat) {
	return { position, quaternion };
}

// Names sit in the world, just above the thing they describe. The sprite's
// center.y is 0, so `y` is the bottom of the label. Fixed positions: the fast
// box, the slide, and the kinematic mover all move under a stationary tag.
function makeLabel(
	text: string,
	x: number,
	y: number,
	z: number,
	height: number,
): void {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	const font = 'bold 64px sans-serif';
	ctx.font = font;
	const padX = 28;
	const metrics = ctx.measureText(text);
	canvas.width = Math.ceil(metrics.width + padX * 2);
	canvas.height = 96;
	ctx.font = font;
	ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#ffffff';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, canvas.width / 2, canvas.height / 2);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.generateMipmaps = false;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const sprite = new THREE.Sprite(material);
	sprite.center.set(0.5, 0);
	sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
	sprite.position.set(x, y, z);
	sprite.renderOrder = 10;
	app.scene.add(sprite);
}

// Ground covers the shape gallery and the state row. The joint row is past its
// far edge, on its own platforms, so a drawing-bounds box can drop just that row.
b3.b3CreateBoxShape(
	staticBody([0, -0.25, 1.6]),
	b3.b3DefaultShapeDef(),
	13.5,
	0.25,
	4,
);

// --- shape gallery, z = 4 ---------------------------------------------------

const wedge = b3.b3CreateHull([
	-0.5, -0.22, -0.4, 0.5, -0.22, -0.4, 0.5, -0.22, 0.4, -0.5, -0.22, 0.4, -0.5,
	0.5, -0.4, -0.5, 0.5, 0.4,
])!;
b3.b3CreateHullShape(
	dynamicBody([-11, 1.6, 4], true),
	b3.b3DefaultShapeDef(),
	wedge,
);

const mesh = b3.b3CreateWaveMesh(8, 5, 0.4, 0.45, 0.7, 0.9)!;
b3.b3CreateMeshShape(
	staticBody([-7.4, 0, 4]),
	b3.b3DefaultShapeDef(),
	mesh,
	[1, 1, 1],
);

const columns = 8;
const rows = 6;
const heights: number[] = [];
for (let z = 0; z < rows; z++) {
	for (let x = 0; x < columns; x++) {
		heights.push(Math.sin(x * 0.7) * Math.cos(z * 0.8) * 0.55);
	}
}
const heightField = b3.b3CreateHeightField(
	heights,
	columns,
	rows,
	[0.38, 1, 0.38],
)!;
b3.b3CreateHeightFieldShape(
	staticBody([-4.9, 0, 3.05]),
	b3.b3DefaultShapeDef(),
	heightField,
);

const pedestal = boxHull(0.45, 0.2, 0.45);
const compound = b3.b3CreateCompound({
	hulls: [{ hull: pedestal, transform: frame([0, 0.2, 0], IDENTITY) }],
	spheres: [{ sphere: { center: [0, 0.95, 0], radius: 0.38 } }],
	capsules: [
		{
			capsule: {
				center1: [0, 1.5, 0],
				center2: [0, 2.05, 0],
				radius: 0.16,
			},
		},
	],
})!;
b3.b3CreateCompoundShape(
	staticBody([0.4, 0, 4]),
	b3.b3DefaultShapeDef(),
	compound,
);

b3.b3CreateSphereShape(
	dynamicBody([2.8, 1.4, 4], true),
	b3.b3DefaultShapeDef(),
	{
		center: [0, 0, 0],
		radius: 0.4,
	},
);
b3.b3CreateCapsuleShape(
	dynamicBody([5, 1.5, 4], true),
	b3.b3DefaultShapeDef(),
	{
		center1: [0, -0.35, 0],
		center2: [0, 0.35, 0],
		radius: 0.22,
	},
);

// Sliding contact. Velocity is reapplied every frame so the friction segment
// stays a nonzero yellow line on the forces pass.
const slideDef = b3.b3DefaultShapeDef();
slideDef.baseMaterial.friction = 0.9;
const slide = dynamicBody([7.4, 0.28, 2.2], true);
b3.b3CreateBoxShape(slide, slideDef, 0.28, 0.28, 0.28);

// Category bit 1 only. Default shapes use every bit, so mask 1 hides this post
// and leaves the rest of the scene. It sits inside the clip box.
const postDef = b3.b3DefaultShapeDef();
postDef.filter.categoryBits = 2n;
b3.b3CreateBoxShape(staticBody([12.2, 1.7, 3.4]), postDef, 0.28, 1.7, 0.28);

// --- body-state colours, z = 0.6 --------------------------------------------

const sensorDef = b3.b3DefaultShapeDef();
sensorDef.isSensor = true;
b3.b3CreateBoxShape(staticBody([-11, 0.85, 0.6]), sensorDef, 0.35, 0.35, 0.35);

const mover = kinematicBody([-8.6, 0.55, 0.6], true);
b3.b3CreateBoxShape(mover, b3.b3DefaultShapeDef(), 0.28, 0.28, 0.28);

const kinematicSleeper = kinematicBody([-6.3, 0.28, 0.6], false);
b3.b3CreateBoxShape(kinematicSleeper, b3.b3DefaultShapeDef(), 0.28, 0.28, 0.28);

const bullet = dynamicBody([-4, 0.28, 0.6], true);
b3.b3Body_SetBullet(bullet, true);
b3.b3CreateBoxShape(bullet, b3.b3DefaultShapeDef(), 0.28, 0.28, 0.28);

// Small box, well under the linear speed cap, fast enough that continuous
// collision marks it fast. Floated so it does not also pick up a contact colour.
const fast = dynamicBody([-1, 1.2, -1.3], true);
b3.b3Body_SetGravityScale(fast, 0);
b3.b3CreateBoxShape(fast, b3.b3DefaultShapeDef(), 0.22, 0.22, 0.22);

// Angular speed above B3_MAX_ROTATION / dt (~47 rad/s at 60 Hz). Reapplied
// every frame because the solver clears the flag once the speed is clamped.
const spinner = dynamicBody([-1.6, 1.35, 0.6], true);
b3.b3Body_SetGravityScale(spinner, 0);
b3.b3CreateBoxShape(spinner, b3.b3DefaultShapeDef(), 0.28, 0.28, 0.28);

const customDef = b3.b3DefaultShapeDef();
customDef.baseMaterial.customColor = 0xff44aa;
b3.b3CreateBoxShape(staticBody([0.8, 0.3, 0.6]), customDef, 0.28, 0.28, 0.28);

const invalidDef = b3.b3DefaultShapeDef();
invalidDef.density = 0;
const invalid = dynamicBody([3, 1.45, 0.6], true);
b3.b3Body_SetGravityScale(invalid, 0);
b3.b3CreateBoxShape(invalid, invalidDef, 0.28, 0.28, 0.28);

const sleeper = dynamicBody([5.3, 1.6, 0.6], false);
b3.b3Body_SetGravityScale(sleeper, 0);
b3.b3CreateBoxShape(sleeper, b3.b3DefaultShapeDef(), 0.28, 0.28, 0.28);

// --- one of each joint, on platforms the clip box does not reach ------------

const updates: Array<(dt: number) => void> = [];

function platform(x: number) {
	const body = staticBody([x, -0.1, JOINT_Z]);
	b3.b3CreateBoxShape(body, b3.b3DefaultShapeDef(), 1.1, 0.1, 0.8);
	return body;
}

function revolute(x: number) {
	const hub = platform(x);
	const arm = dynamicBody([x + 0.45, 1.35, JOINT_Z], true);
	b3.b3CreateBoxShape(arm, b3.b3DefaultShapeDef(), 0.42, 0.08, 0.08);
	const jd = b3.b3DefaultRevoluteJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = arm;
	jd.base.localFrameA = frame([0, 1.45, 0], Z_TO_Y);
	jd.base.localFrameB = frame([-0.45, 0, 0], Z_TO_Y);
	jd.enableLimit = true;
	jd.lowerAngle = -1;
	jd.upperAngle = 1;
	jd.enableMotor = true;
	jd.motorSpeed = 1.4;
	jd.maxMotorTorque = 4000;
	b3.b3CreateRevoluteJoint(world, jd);
}

function prismatic(x: number) {
	const hub = platform(x);
	const slider = dynamicBody([x, 1.15, JOINT_Z], true);
	b3.b3CreateBoxShape(slider, b3.b3DefaultShapeDef(), 0.18, 0.18, 0.18);
	const jd = b3.b3DefaultPrismaticJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = slider;
	jd.base.localFrameA = frame([0, 1.25, 0], IDENTITY);
	jd.base.localFrameB = frame([0, 0, 0], IDENTITY);
	jd.enableLimit = true;
	jd.lowerTranslation = -0.55;
	jd.upperTranslation = 0.55;
	jd.enableMotor = true;
	jd.maxMotorForce = 8000;
	const joint = b3.b3CreatePrismaticJoint(world, jd);
	let t = 0;
	updates.push((dt) => {
		t += dt;
		b3.b3PrismaticJoint_SetMotorSpeed(joint, Math.sin(t) * 1.6);
	});
}

function spherical(x: number) {
	const hub = platform(x);
	const bob = dynamicBody([x, 0.85, JOINT_Z], true);
	b3.b3CreateSphereShape(bob, b3.b3DefaultShapeDef(), {
		center: [0, 0, 0],
		radius: 0.2,
	});
	const jd = b3.b3DefaultSphericalJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = bob;
	jd.base.localFrameA = frame([0, 1.7, 0], Z_TO_Y);
	jd.base.localFrameB = frame([0, 0.75, 0], Z_TO_Y);
	jd.enableConeLimit = true;
	jd.coneAngle = 0.55;
	jd.enableTwistLimit = true;
	jd.lowerTwistAngle = -0.6;
	jd.upperTwistAngle = 0.6;
	b3.b3CreateSphericalJoint(world, jd);
	b3.b3Body_SetLinearVelocity(bob, [1.2, 0, 0]);
}

function weld(x: number) {
	const hub = platform(x);
	const bar = dynamicBody([x + 0.35, 1.3, JOINT_Z], true);
	b3.b3CreateBoxShape(bar, b3.b3DefaultShapeDef(), 0.4, 0.08, 0.08);
	const hook = dynamicBody([x + 0.7, 1.05, JOINT_Z], true);
	b3.b3CreateBoxShape(hook, b3.b3DefaultShapeDef(), 0.08, 0.28, 0.08);
	const rj = b3.b3DefaultRevoluteJointDef();
	rj.base.bodyIdA = hub;
	rj.base.bodyIdB = bar;
	rj.base.localFrameA = frame([-0.35, 1.4, 0], Z_TO_Y);
	rj.base.localFrameB = frame([-0.7, 0, 0], Z_TO_Y);
	rj.enableMotor = true;
	rj.motorSpeed = 0.8;
	rj.maxMotorTorque = 4000;
	b3.b3CreateRevoluteJoint(world, rj);
	const wj = b3.b3DefaultWeldJointDef();
	wj.base.bodyIdA = bar;
	wj.base.bodyIdB = hook;
	wj.base.localFrameA = frame([0.4, 0, 0], IDENTITY);
	wj.base.localFrameB = frame([0, 0.25, 0], IDENTITY);
	b3.b3CreateWeldJoint(world, wj);
}

function distance(x: number) {
	const hub = platform(x);
	// Water-density sphere: the azure extra is 0.001 * tension, about a metre.
	const bob = dynamicBody([x, 0.95, JOINT_Z], true);
	b3.b3CreateSphereShape(bob, b3.b3DefaultShapeDef(), {
		center: [0, 0, 0],
		radius: 0.32,
	});
	const jd = b3.b3DefaultDistanceJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = bob;
	jd.base.localFrameA = frame([0, 2.15, 0], IDENTITY);
	jd.base.localFrameB = frame([0, 0, 0], IDENTITY);
	jd.length = 1.15;
	jd.enableLimit = true;
	jd.minLength = 0.55;
	jd.maxLength = 1.7;
	b3.b3CreateDistanceJoint(world, jd);
}

function wheel(x: number) {
	const hub = platform(x);
	const tire = dynamicBody([x, 0.7, JOINT_Z], true);
	b3.b3CreateCapsuleShape(tire, b3.b3DefaultShapeDef(), {
		center1: [-0.1, 0, 0],
		center2: [0.1, 0, 0],
		radius: 0.28,
	});
	const jd = b3.b3DefaultWheelJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = tire;
	jd.base.localFrameA = frame([0, 1.5, 0], Z_TO_Y);
	jd.base.localFrameB = frame([0, 0, 0], Z_TO_Y);
	jd.enableSuspensionSpring = true;
	jd.suspensionHertz = 2.5;
	jd.suspensionDampingRatio = 0.4;
	jd.enableSuspensionLimit = true;
	jd.lowerSuspensionLimit = -0.35;
	jd.upperSuspensionLimit = 0.35;
	jd.enableSpinMotor = true;
	jd.spinSpeed = 5;
	jd.maxSpinTorque = 2000;
	jd.enableSteering = true;
	jd.enableSteeringLimit = true;
	jd.lowerSteeringLimit = -0.5;
	jd.upperSteeringLimit = 0.5;
	b3.b3CreateWheelJoint(world, jd);
}

function motor(x: number) {
	const target = kinematicBody([x, 1.15, JOINT_Z], true);
	b3.b3CreateBoxShape(target, b3.b3DefaultShapeDef(), 0.12, 0.12, 0.12);
	const box = dynamicBody([x + 0.45, 1.15, JOINT_Z], true);
	b3.b3CreateBoxShape(box, b3.b3DefaultShapeDef(), 0.16, 0.16, 0.16);
	const jd = b3.b3DefaultMotorJointDef();
	jd.base.bodyIdA = target;
	jd.base.bodyIdB = box;
	jd.linearHertz = 4;
	jd.linearDampingRatio = 0.7;
	jd.maxSpringForce = 1e6;
	jd.angularHertz = 4;
	jd.angularDampingRatio = 0.7;
	jd.maxSpringTorque = 1e6;
	b3.b3CreateMotorJoint(world, jd);
	let t = 0;
	updates.push((dt) => {
		t += dt;
		b3.b3Body_SetTransform(
			target,
			[x + Math.cos(t) * 0.4, 1.15 + Math.sin(t * 1.3) * 0.28, JOINT_Z],
			IDENTITY,
		);
	});
}

function parallel(x: number) {
	const hub = platform(x);
	const plate = dynamicBody([x, 1.05, JOINT_Z], true);
	b3.b3CreateBoxShape(plate, b3.b3DefaultShapeDef(), 0.4, 0.07, 0.4);
	const pin = b3.b3DefaultSphericalJointDef();
	pin.base.bodyIdA = hub;
	pin.base.bodyIdB = plate;
	pin.base.localFrameA = frame([0, 1.15, 0], IDENTITY);
	pin.base.localFrameB = frame([0, 0, 0], IDENTITY);
	b3.b3CreateSphericalJoint(world, pin);
	const jd = b3.b3DefaultParallelJointDef();
	jd.base.bodyIdA = hub;
	jd.base.bodyIdB = plate;
	jd.base.localFrameA = frame([0, 1.15, 0], Z_TO_Y);
	jd.base.localFrameB = frame([0, 0, 0], Z_TO_Y);
	jd.hertz = 2;
	jd.dampingRatio = 0.5;
	jd.maxTorque = 1e6;
	b3.b3CreateParallelJoint(world, jd);
	b3.b3Body_SetAngularVelocity(plate, [0.8, 0, 0.4]);
}

function filterJoint(x: number) {
	platform(x);
	const a = dynamicBody([x, 0.32, JOINT_Z], true);
	b3.b3CreateBoxShape(a, b3.b3DefaultShapeDef(), 0.26, 0.26, 0.26);
	const b = dynamicBody([x + 0.15, 0.7, JOINT_Z], true);
	b3.b3CreateBoxShape(b, b3.b3DefaultShapeDef(), 0.26, 0.26, 0.26);
	const jd = b3.b3DefaultFilterJointDef();
	jd.base.bodyIdA = a;
	jd.base.bodyIdB = b;
	b3.b3CreateFilterJoint(world, jd);
}

const jointX = [-10.4, -7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8, 10.4];
revolute(jointX[0]);
prismatic(jointX[1]);
spherical(jointX[2]);
weld(jointX[3]);
distance(jointX[4]);
wheel(jointX[5]);
motor(jointX[6]);
parallel(jointX[7]);
filterJoint(jointX[8]);

// Shape gallery, in front. x is shifted toward the camera axis so a tag
// raised above its shape still sits over that shape on screen.
makeLabel('hull', -10.67, 1.41, 4, 0.5);
makeLabel('mesh', -7.13, 1.33, 4, 0.5);
makeLabel('height field', -3.36, 1.88, 4, 0.5);
makeLabel('compound', 0.42, 1.45, 4, 0.5);
makeLabel('sphere', 2.72, 1.41, 4, 0.5);
makeLabel('capsule', 4.87, 1.69, 4, 0.5);
makeLabel('friction', 8.23, 1.62, 2.2, 0.5);
makeLabel('category 2', 11.99, 3.78, 3.4, 0.52);

// Body-state colours. The fast box shuttles behind this row, so its tag sits on the lane.
makeLabel('sensor', -10.77, 1.76, 0.6, 0.42);
makeLabel('kinematic', -8.42, 1.43, 0.6, 0.42);
makeLabel('kin. sleep', -6.15, 1.24, 0.6, 0.42);
makeLabel('bullet', -3.9, 1.24, 0.6, 0.42);
makeLabel('fast', -0.39, 2.11, -1.3, 0.46);
makeLabel('speed cap', -1.56, 2.34, 0.6, 0.42);
makeLabel('custom', 0.75, 2.06, 0.6, 0.42);
makeLabel('invalid mass', 2.94, 2.29, 0.6, 0.42);
makeLabel('sleeping', 5.19, 2.44, 0.6, 0.42);

// Joint row, far back. Alternate heights so the longer names don't touch.
const jointNames = [
	'revolute',
	'prismatic',
	'spherical',
	'weld',
	'distance',
	'wheel',
	'motor',
	'parallel',
	'filter',
];
for (let i = 0; i < jointNames.length; i++) {
	const high = i % 2 === 0;
	makeLabel(jointNames[i], jointX[i], high ? 4.35 : 2.85, JOINT_Z, 0.9);
}

const debug = createDebugRenderer(b3, world, {
	THREE,
	parent: app.scene,
	settings: {
		shapes: true,
		shapeStyle: 'wireframe',
		joints: true,
		contacts: true,
		contactNormals: false,
		forceScale: 0.04,
		jointScale: 2,
		pointSize: 1,
		normalScale: 5,
	},
});

const settings = debug.settings;
const show = app.gui.addFolder('Debug');
const flags = [
	'shapes',
	'bounds',
	'joints',
	'jointExtras',
	'mass',
	'contacts',
	'contactNormals',
	'contactForces',
	'frictionForces',
	'contactFeatures',
	'islands',
	'graphColors',
] as const;
for (const key of flags) show.add(settings, key);
show.add(settings, 'shapeStyle', ['wireframe', 'solid', 'both']);

const scale = app.gui.addFolder('Scale');
scale.add(settings, 'forceScale', 0, 0.15, 0.005);
scale.add(settings, 'jointScale', 0.1, 3, 0.05);
scale.add(settings, 'pointSize', 0.25, 4, 0.05);
scale.add(settings, 'normalScale', 1, 12, 0.5);
scale.add(settings, 'opacity', 0.05, 1, 0.05);
scale.add(settings, 'depthTest');
scale.add(settings, 'renderOrder', -10, 10, 1);

if (settings.colors === undefined) settings.colors = {};
const colors = settings.colors as DebugColorMap &
	Record<string, number | string | null>;
const colorKeys = [
	'static',
	'kinematic',
	'kinematicSleeping',
	'awake',
	'sleeping',
	'sensor',
	'disabled',
	'fast',
	'bullet',
	'speedCapped',
	'timeOfImpact',
	'invalidMass',
	'custom',
	'bounds',
	'joints',
	'mass',
	'contactPoints',
	'contactNormals',
	'contactForces',
	'frictionForces',
	'islands',
] as const;
const colorFolder = app.gui.addFolder('Colors');
for (const key of colorKeys) {
	const proxy = { on: false, color: '#ffffff' };
	colorFolder
		.add(proxy, 'on')
		.name(key)
		.onChange((on: boolean) => {
			colors[key] = on ? proxy.color : null;
		});
	colorFolder
		.addColor(proxy, 'color')
		.name(`${key} tint`)
		.onChange((value: string) => {
			if (proxy.on) colors[key] = value;
		});
}
colorFolder.close();

const filter = app.gui.addFolder('Filter');
const filterProxy = {
	limitMask: false,
	maskBits: 1,
	limitBounds: false,
	minX: -14,
	minY: -2,
	minZ: -2,
	maxX: 14,
	maxY: 8,
	maxZ: 8,
};
function applyFilter(): void {
	settings.maskBits = filterProxy.limitMask ? filterProxy.maskBits : undefined;
	settings.drawingBounds = filterProxy.limitBounds
		? [
				filterProxy.minX,
				filterProxy.minY,
				filterProxy.minZ,
				filterProxy.maxX,
				filterProxy.maxY,
				filterProxy.maxZ,
			]
		: undefined;
}
filter
	.add(filterProxy, 'limitMask')
	.name('mask hides bit-2 post')
	.onChange(applyFilter);
filter
	.add(filterProxy, 'maskBits', 0, 0xffff, 1)
	.name('maskBits')
	.onChange(applyFilter);
filter
	.add(filterProxy, 'limitBounds')
	.name('bounds clip joints')
	.onChange(applyFilter);
filter.add(filterProxy, 'minX', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'minY', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'minZ', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxX', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxY', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxZ', -40, 40, 0.5).onChange(applyFilter);
filter.close();

const scratch: b3Vec3 = [0, 0, 0];
let time = 0;

app.onFrame((dt) => {
	time += dt;
	b3.b3Body_SetTransform(
		mover,
		[-8.6 + Math.sin(time) * 0.35, 0.55, 0.6],
		IDENTITY,
	);

	b3.b3Body_GetPosition(scratch, fast);
	if (scratch[0] > 2.4) {
		b3.b3Body_SetTransform(fast, [-3.2, 1.2, -1.3], IDENTITY);
	}
	b3.b3Body_SetLinearVelocity(fast, [18, 0, 0]);

	b3.b3Body_SetAngularVelocity(spinner, [0, 80, 0]);

	b3.b3Body_GetPosition(scratch, slide);
	if (scratch[0] > 10.2) {
		b3.b3Body_SetTransform(slide, [6.6, 0.28, 2.2], IDENTITY);
	}
	b3.b3Body_SetLinearVelocity(slide, [5, 0, 0]);

	for (const update of updates) update(dt);

	app.step(() => b3.b3World_Step(world, 1 / 60, 4));
	b3.b3Body_SetAwake(sleeper, false);
	b3.b3Body_SetAwake(kinematicSleeper, false);
	debug.update();
});
app.start();
