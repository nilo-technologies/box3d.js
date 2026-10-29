// Convex Decomposition — V-HACD splits concave meshes into convex pieces that box3d
// can collide. Each dynamic object is ONE body with one hull shape per piece, created
// with b3CreateConvexDecompositionShapesAsync: with this single-threaded build, V-HACD
// runs in a Web Worker, so the page keeps rendering while it works, and the hull shapes
// are attached to the body in one call when it finishes. Results are cached per mesh +
// options, so only the first torus and the first L-shape run V-HACD; every later drop
// reuses the result and only builds its hull shapes. Bodies are created disabled and
// enabled once their shapes exist. The static bowl is one compound shape (compounds are
// static-only), built from b3ComputeConvexDecompositionAsync. The "show" control draws
// the hull shapes, the source mesh they approximate, or both overlaid.

import type { Box3DModule, b3BodyId, b3CompoundData } from 'box3d.js';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 6.5, 8.5], target: [0, 1.5, 0] });

type Mesh = { positions: Float32Array; indices: Uint32Array };

// indexed torus around the y axis
function torusMesh(
	radius: number,
	tube: number,
	radial = 24,
	tubular = 12,
): Mesh {
	const positions: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i < radial; i++) {
		const u = (i / radial) * Math.PI * 2;
		for (let j = 0; j < tubular; j++) {
			const v = (j / tubular) * Math.PI * 2;
			const r = radius + tube * Math.cos(v);
			positions.push(r * Math.cos(u), tube * Math.sin(v), r * Math.sin(u));
		}
	}
	for (let i = 0; i < radial; i++) {
		for (let j = 0; j < tubular; j++) {
			const a = i * tubular + j;
			const b = ((i + 1) % radial) * tubular + j;
			const c = ((i + 1) % radial) * tubular + ((j + 1) % tubular);
			const d = i * tubular + ((j + 1) % tubular);
			indices.push(a, d, b, b, d, c);
		}
	}
	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices),
	};
}

// an L-shaped prism: the L outline extruded along z, centered on the origin
function lShapeMesh(size: number, arm: number, depth: number): Mesh {
	const outline = [
		[0, 0],
		[size, 0],
		[size, arm],
		[arm, arm],
		[arm, size],
		[0, size],
	];
	const c = size / 3;
	const positions: number[] = [];
	for (const z of [-depth / 2, depth / 2])
		for (const [x, y] of outline) positions.push(x - c, y - c, z);
	const n = outline.length;
	const indices: number[] = [];
	// caps: the L is star-shaped from its corner, so a fan from vertex 0 works
	for (let i = 1; i < n - 1; i++) {
		indices.push(0, i + 1, i); // back cap (faces -z)
		indices.push(n, n + i, n + i + 1); // front cap (faces +z)
	}
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		indices.push(i, j, n + j, i, n + j, n + i);
	}
	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices),
	};
}

// a thick-walled bowl: outer and inner hemispheres joined by a rim ring
function bowlMesh(outer: number, wall: number, lat = 10, lon = 32): Mesh {
	const inner = outer - wall;
	const positions: number[] = [];
	const ring = (r: number, k: number) => {
		const phi = (k / lat) * (Math.PI / 2); // 0 at the bottom pole, pi/2 at the rim
		for (let j = 0; j < lon; j++) {
			const t = (j / lon) * Math.PI * 2;
			positions.push(
				r * Math.sin(phi) * Math.cos(t),
				r - r * Math.cos(phi),
				r * Math.sin(phi) * Math.sin(t),
			);
		}
	};
	for (let k = 0; k <= lat; k++) ring(outer, k);
	const innerBase = positions.length / 3;
	for (let k = 0; k <= lat; k++) ring(inner, k);
	// lift the inner shell so both shells share the rim height
	for (let v = innerBase; v < positions.length / 3; v++)
		positions[v * 3 + 1] += wall;

	const indices: number[] = [];
	const at = (base: number, k: number, j: number) => base + k * lon + (j % lon);
	for (let k = 0; k < lat; k++) {
		for (let j = 0; j < lon; j++) {
			const [a, b, c, d] = [
				at(0, k, j),
				at(0, k, j + 1),
				at(0, k + 1, j + 1),
				at(0, k + 1, j),
			];
			indices.push(a, b, c, a, c, d); // outer, facing out
			const [e, f, g, h] = [
				at(innerBase, k, j),
				at(innerBase, k, j + 1),
				at(innerBase, k + 1, j + 1),
				at(innerBase, k + 1, j),
			];
			indices.push(e, g, f, e, h, g); // inner, facing the bowl's hollow
		}
	}
	for (let j = 0; j < lon; j++) {
		const [o0, o1] = [at(0, lat, j), at(0, lat, j + 1)];
		const [i0, i1] = [at(innerBase, lat, j), at(innerBase, lat, j + 1)];
		indices.push(o0, i1, o1, o0, i0, i1); // rim
	}
	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices),
	};
}

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

const groundDef = b3.b3DefaultBodyDef();
const ground = b3.b3CreateBody(world, groundDef);
b3.b3CreateBoxShape(ground, b3.b3DefaultShapeDef(), 30, 0.5, 30);

// what to draw: the convex hull shapes box3d collides with, the source mesh they were
// decomposed from (translucent with its triangle wireframe), or both
const display = { view: 'both' as 'both' | 'shapes' | 'mesh' };
const isDecomposed = (body: b3BodyId) => body.index1 !== ground.index1;

const renderer = createWorldRenderer(b3, world, {
	shouldDraw: (_shape, body) => display.view !== 'mesh' || !isDecomposed(body),
});
app.scene.add(renderer.object3d);

const sourceSolid = new THREE.MeshStandardMaterial({
	color: 0xf2f2f2,
	roughness: 0.6,
	flatShading: true,
	side: THREE.DoubleSide,
});
const sourceWire = new THREE.LineBasicMaterial({
	color: 0xffffff,
	transparent: true,
});
type SourceGeometry = {
	solid: THREE.BufferGeometry;
	wire: THREE.WireframeGeometry;
};
function sourceGeometry(mesh: Mesh): SourceGeometry {
	const solid = new THREE.BufferGeometry();
	solid.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
	solid.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
	solid.computeVertexNormals();
	return { solid, wire: new THREE.WireframeGeometry(solid) };
}
function sourceObject(geometry: SourceGeometry): THREE.Object3D {
	const group = new THREE.Group();
	group.add(new THREE.Mesh(geometry.solid, sourceSolid));
	group.add(new THREE.LineSegments(geometry.wire, sourceWire));
	return group;
}
const sourceGroup = new THREE.Group();
app.scene.add(sourceGroup);

// source meshes of dynamic bodies follow their body each frame
const tracked: { body: b3BodyId; object: THREE.Object3D }[] = [];
const _p: [number, number, number] = [0, 0, 0];
const _q: [number, number, number, number] = [0, 0, 0, 1];
function updateSourceMeshes() {
	for (const { body, object } of tracked) {
		b3.b3Body_GetPosition(_p, body);
		b3.b3Body_GetRotation(_q, body);
		object.position.set(_p[0], _p[1], _p[2]);
		object.quaternion.set(_q[0], _q[1], _q[2], _q[3]);
	}
}

let bowlPieces: THREE.Object3D | null = null;
function applyView() {
	const { view } = display;
	sourceGroup.visible = view !== 'shapes';
	if (bowlPieces) bowlPieces.visible = view !== 'mesh';
	// over the shapes the mesh is a translucent shell; alone it is drawn solid
	const alone = view === 'mesh';
	sourceSolid.transparent = !alone;
	sourceSolid.opacity = alone ? 1 : 0.25;
	sourceSolid.depthWrite = alone;
	sourceSolid.needsUpdate = true;
	sourceWire.opacity = alone ? 0.25 : 0.6;
}
applyView();

const status = {
	bowl: 'decomposing…',
	decomposing: 0,
	bodies: 0,
	lastPieces: 0,
	lastMs: 0,
	cache: '0 hits / 0 misses',
};
app.gui
	.add(display, 'view', {
		'shapes + mesh': 'both',
		shapes: 'shapes',
		mesh: 'mesh',
	})
	.name('show')
	.onChange(applyView);
const statusFolder = app.gui.addFolder('Decomposition');
for (const key of Object.keys(status) as (keyof typeof status)[])
	statusFolder.add(status, key).disable().listen();

let bowlReady = false;
let bowlCompound: b3CompoundData | null = null;
// set before the world is destroyed: pending decompositions check it after they resolve
let disposed = false;

// the bowl's shape references its compound, so the compound is freed after the world
addEventListener('pagehide', (event) => {
	if (event.persisted) return;
	disposed = true;
	b3.b3DestroyWorld(world);
	b3.b3DestroyCompound(bowlCompound);
});

// static bowl: one compound shape. The renderer can't introspect compounds, so the
// pieces are drawn here from the packed decomposition.
async function buildBowl() {
	const mesh = bowlMesh(4, 0.5);
	const t0 = performance.now();
	const bowl = await b3.b3ComputeConvexDecompositionAsync(
		mesh.positions,
		mesh.indices,
		{
			maxConvexHulls: 32,
			resolution: 100000,
		},
	);
	if (disposed) return;
	status.bowl = `${bowl.offsets.length - 1} pieces in ${Math.round(performance.now() - t0)} ms`;

	const bowlDef = b3.b3DefaultBodyDef();
	bowlDef.position = [0, 0.5, 0];
	const bowlBody = b3.b3CreateBody(world, bowlDef);
	bowlCompound = b3.b3CreateDecompositionCompound(bowl).compound;
	if (bowlCompound)
		b3.b3CreateBakedCompoundShape(
			bowlBody,
			b3.b3DefaultShapeDef(),
			bowlCompound,
		);

	const bowlGroup = new THREE.Group();
	bowlGroup.position.set(0, 0.5, 0);
	b3.b3UnpackConvexDecomposition(bowl).forEach((piece, i) => {
		const points: THREE.Vector3[] = [];
		for (let k = 0; k < piece.length; k += 3)
			points.push(new THREE.Vector3(piece[k], piece[k + 1], piece[k + 2]));
		const color = new THREE.Color().setHSL(0.6, 0.15, 0.3 + (i % 5) * 0.04);
		bowlGroup.add(
			new THREE.Mesh(
				new ConvexGeometry(points),
				new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
			),
		);
	});
	app.scene.add(bowlGroup);
	bowlPieces = bowlGroup;

	const bowlSource = sourceObject(sourceGeometry(mesh));
	bowlSource.position.set(0, 0.5, 0);
	sourceGroup.add(bowlSource);
	applyView();
	bowlReady = true;
}

const meshes = {
	torus: { mesh: torusMesh(0.8, 0.28), maxConvexHulls: 12 },
	lShape: { mesh: lShapeMesh(1.6, 0.55, 0.6), maxConvexHulls: 4 },
};
const sourceGeometries = {
	torus: sourceGeometry(meshes.torus.mesh),
	lShape: sourceGeometry(meshes.lShape.mesh),
};

// dynamic objects: one body each. The body starts disabled so it can't fall before its
// shapes exist; b3CreateConvexDecompositionShapesAsync decomposes off the main thread and
// attaches every hull shape in one call, then the body is enabled.
const shapeDef = b3.b3DefaultShapeDef();
shapeDef.density = 1;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const MAX_BODIES = 40;
async function drop(kind: keyof typeof meshes) {
	if (status.bodies + status.decomposing >= MAX_BODIES) return;
	const { mesh, maxConvexHulls } = meshes[kind];
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.isEnabled = false;
	def.position = [rand(-1.5, 1.5), rand(6, 9), rand(-1.5, 1.5)];
	const axis = [rand(-1, 1), rand(-1, 1), rand(-1, 1)];
	const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
	const half = rand(0, Math.PI);
	const s = Math.sin(half) / len;
	def.rotation = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
	const body = b3.b3CreateBody(world, def);

	status.decomposing++;
	const t0 = performance.now();
	try {
		const shapes = await b3.b3CreateConvexDecompositionShapesAsync(
			body,
			shapeDef,
			mesh.positions,
			mesh.indices,
			{ maxConvexHulls, resolution: 50000 },
		);
		if (disposed) return;
		b3.b3Body_Enable(body);
		const object = sourceObject(sourceGeometries[kind]);
		sourceGroup.add(object);
		tracked.push({ body, object });
		status.bodies++;
		status.lastPieces = shapes.count;
		status.lastMs = +(performance.now() - t0).toFixed(2);
		const { hits, misses } = b3.b3GetConvexDecompositionCacheStats();
		status.cache = `${hits} hits / ${misses} misses`;
	} catch (err) {
		// once disposed, the body went with the world and the rejection is expected
		if (disposed) return;
		// otherwise a failed drop would leave its disabled body behind on every retry
		b3.b3DestroyBody(body);
		console.error(err);
	} finally {
		status.decomposing--;
	}
}

const actions = {
	dropTorus: () => void drop('torus'),
	dropLShape: () => void drop('lShape'),
	autoDrop: true,
};
statusFolder.add(actions, 'dropTorus').name('drop torus');
statusFolder.add(actions, 'dropLShape').name('drop L-shape');
statusFolder.add(actions, 'autoDrop').name('auto drop');
statusFolder.open();

// the page renders and simulates while every decomposition runs in the background
let timer = 0;
app.onFrame((dt) => {
	if (disposed) return;
	timer += dt;
	const canDrop =
		actions.autoDrop &&
		bowlReady &&
		status.decomposing === 0 &&
		status.bodies < MAX_BODIES;
	if (canDrop && timer > 0.5) {
		timer = 0;
		void drop(status.bodies % 2 === 0 ? 'torus' : 'lShape');
	}
	app.step(() => b3.b3World_Step(world, 1 / 60, 4));
	renderer.update();
	updateSourceMeshes();
});
app.start();

buildBowl().catch((err) => {
	status.bowl = `failed: ${err instanceof Error ? err.message : err}`;
	console.error(err);
});
