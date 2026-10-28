// Debug Draw — box3d's own debug primitives, drawn by box3d.js/three into the
// harness scene. The overlay is the visualization: hull, mesh, height field,
// compound, sensor, and a distance joint.

import type { Box3DModule, b3Quat, b3Vec3 } from 'box3d.js';
import Box3D from 'box3d.js/inline';
import { createDebugRenderer, type DebugColorMap } from 'box3d.js/three';
import * as THREE from 'three';
import { createHarness } from './harness';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 8, 14], target: [0, 1, 0] });

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
worldDef.enableSleep = false;
const world = b3.b3CreateWorld(worldDef);

const IDENTITY: b3Quat = [0, 0, 0, 1];

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

function dynamicBody(position: b3Vec3) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = position;
	def.enableSleep = false;
	const body = b3.b3CreateBody(world, def);
	b3.b3Body_EnableSleep(body, false);
	return body;
}

// Ground, so the dynamic bodies have something to rest on and emit contacts.
b3.b3CreateBoxShape(
	staticBody([0, -0.2, 0]),
	b3.b3DefaultShapeDef(),
	9,
	0.2,
	5,
);

// Convex hull: a wedge, dropped onto the ground.
const wedge = boxHull(0.7, 0.45, 0.7);
b3.b3CreateHullShape(
	dynamicBody([-5, 2.5, 1.2]),
	b3.b3DefaultShapeDef(),
	wedge,
);

// Triangle mesh.
const mesh = b3.b3CreateWaveMesh(12, 8, 0.4, 0.7, 1.1, 0.9)!;
b3.b3CreateMeshShape(
	staticBody([-4.2, 0, -1.6]),
	b3.b3DefaultShapeDef(),
	mesh,
	[1, 1, 1],
);

// Height field.
const columns = 12;
const rows = 8;
const heights: number[] = [];
for (let z = 0; z < rows; z++) {
	for (let x = 0; x < columns; x++) {
		heights.push(Math.sin(x * 0.6) * Math.cos(z * 0.7) * 0.9);
	}
}
const heightField = b3.b3CreateHeightField(
	heights,
	columns,
	rows,
	[0.4, 1, 0.4],
)!;
b3.b3CreateHeightFieldShape(
	staticBody([1.2, 0, -1.6]),
	b3.b3DefaultShapeDef(),
	heightField,
);

// Compound: a hull pedestal plus a sphere, in compound-local space.
const pedestal = boxHull(0.6, 0.25, 0.6);
const compound = b3.b3CreateCompound({
	hulls: [
		{
			hull: pedestal,
			transform: { position: [0, 0.25, 0], quaternion: IDENTITY },
		},
	],
	spheres: [{ sphere: { center: [0, 1.2, 0], radius: 0.5 } }],
})!;
b3.b3CreateCompoundShape(
	staticBody([5.2, 0, 0.4]),
	b3.b3DefaultShapeDef(),
	compound,
);

// Sensor. Wheat in box3d's debug colours, and it does not collide.
const sensorDef = b3.b3DefaultShapeDef();
sensorDef.isSensor = true;
b3.b3CreateBoxShape(staticBody([-5, 1.4, -1.8]), sensorDef, 0.7, 0.7, 0.7);

// Distance joint between two dynamic boxes.
const anchor = dynamicBody([2.2, 3.6, 1.6]);
b3.b3CreateBoxShape(anchor, b3.b3DefaultShapeDef(), 0.35, 0.35, 0.35);
const bob = dynamicBody([2.2, 1.6, 1.6]);
b3.b3CreateBoxShape(bob, b3.b3DefaultShapeDef(), 0.4, 0.4, 0.4);
const joint = b3.b3DefaultDistanceJointDef();
joint.base.bodyIdA = anchor;
joint.base.bodyIdB = bob;
joint.base.localFrameA = { position: [0, 0, 0], quaternion: IDENTITY };
joint.base.localFrameB = { position: [0, 0, 0], quaternion: IDENTITY };
joint.length = 2;
b3.b3CreateDistanceJoint(world, joint);

const debug = createDebugRenderer(b3, world, {
	THREE,
	parent: app.scene,
	settings: {
		shapes: true,
		shapeStyle: 'wireframe',
		joints: true,
		contacts: true,
		contactNormals: false,
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
scale.add(settings, 'forceScale', 0, 4, 0.05);
scale.add(settings, 'jointScale', 0.1, 3, 0.05);
scale.add(settings, 'pointSize', 0.25, 4, 0.05);
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
	minX: -20,
	minY: -5,
	minZ: -20,
	maxX: 20,
	maxY: 20,
	maxZ: 20,
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
filter.add(filterProxy, 'limitMask').name('limit mask').onChange(applyFilter);
filter
	.add(filterProxy, 'maskBits', 0, 0xffff, 1)
	.name('maskBits')
	.onChange(applyFilter);
filter
	.add(filterProxy, 'limitBounds')
	.name('limit bounds')
	.onChange(applyFilter);
filter.add(filterProxy, 'minX', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'minY', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'minZ', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxX', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxY', -40, 40, 0.5).onChange(applyFilter);
filter.add(filterProxy, 'maxZ', -40, 40, 0.5).onChange(applyFilter);
filter.close();

app.onFrame(() => {
	app.step(() => b3.b3World_Step(world, 1 / 60, 4));
	debug.update();
});
app.start();
