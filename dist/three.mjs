// Debug renderer for box3d.js. It does not import three: pass the same THREE
// namespace the rest of the page uses (`three` or `three/webgpu`). Two copies
// of three on one page break instanceof checks.
//
//   import { createDebugRenderer } from 'box3d.js/three';
//   const debug = createDebugRenderer(b3, world, { THREE, parent: scene, settings });
//   debug.update(); // after stepping
//   debug.dispose();

// Matches DebugShapeState in src/bindings.cpp. Index is the buffer's state value.
const STATE_NAMES = [
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
];

const ROLE_COLOR_KEY = {
	bounds: 'bounds',
	joints: 'joints',
	mass: 'mass',
	contactPoints: 'contactPoints',
	contactNormals: 'contactNormals',
	contactForces: 'contactForces',
	frictionForces: 'frictionForces',
	islands: 'islands',
};

const DEFAULTS = {
	shapes: true,
	shapeStyle: 'wireframe',
	bounds: false,
	joints: false,
	jointExtras: false,
	mass: false,
	contacts: false,
	contactNormals: false,
	contactForces: false,
	frictionForces: false,
	contactFeatures: false,
	islands: false,
	graphColors: false,
	forceScale: 1,
	jointScale: 1,
	pointSize: 1,
	normalScale: 1,
	opacity: 1,
	depthTest: true,
	renderOrder: 0,
};

const RING = 16;
const ARC = 8;
const SPHERE_LINE_VERTS = 3 * RING * 2;
const CAPSULE_LINE_VERTS = 2 * RING * 2 + 4 * 2 + 4 * ARC * 2;
const MASS_AXIS = 0.4;

const EDGES = [0, 4, 4, 5, 5, 1, 1, 0, 2, 6, 6, 7, 7, 3, 3, 2, 0, 2, 4, 6, 5, 7, 1, 3];

function fillDefaults(settings) {
	for (const key of Object.keys(DEFAULTS)) {
		if (settings[key] === undefined) settings[key] = DEFAULTS[key];
	}
	if (settings.colors === undefined) settings.colors = {};
	return settings;
}

function rotateInto(out, q, x, y, z, px, py, pz) {
	const qx = q[0];
	const qy = q[1];
	const qz = q[2];
	const qw = q[3];
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	out[0] = px + x + qw * tx + (qy * tz - qz * ty);
	out[1] = py + y + qw * ty + (qz * tx - qx * tz);
	out[2] = pz + z + qw * tz + (qx * ty - qy * tx);
}

export function createDebugRenderer(b3, worldId, options) {
	const THREE = options.THREE;
	const settings = fillDefaults(options.settings ?? {});
	const parent = options.parent;

	const root = new THREE.Group();
	root.name = 'box3d-debug';
	root.frustumCulled = false;
	parent.add(root);

	const buf = b3.createDebugDrawBuffer();
	const shapeRec = b3.createDebugShapeRecord();
	const segmentRec = b3.createDebugSegment();
	const pointRec = b3.createDebugPoint();
	const sphereRec = b3.createDebugSpherePrimitive();
	const capsuleRec = b3.createDebugCapsulePrimitive();
	const boxRec = b3.createDebugBoxPrimitive();
	const boundsRec = b3.createDebugBoundsPrimitive();
	const transformRec = b3.createDebugTransformPrimitive();

	const role = {
		bounds: b3.DebugDrawRole.bounds.value,
		joints: b3.DebugDrawRole.joints.value,
		mass: b3.DebugDrawRole.mass.value,
		contactPoints: b3.DebugDrawRole.contactPoints.value,
		contactNormals: b3.DebugDrawRole.contactNormals.value,
		contactForces: b3.DebugDrawRole.contactForces.value,
		frictionForces: b3.DebugDrawRole.frictionForces.value,
		contactFeatures: b3.DebugDrawRole.contactFeatures.value,
		islands: b3.DebugDrawRole.islands.value,
		graphColors: b3.DebugDrawRole.graphColors.value,
	};
	const roleKey = {
		[role.bounds]: ROLE_COLOR_KEY.bounds,
		[role.joints]: ROLE_COLOR_KEY.joints,
		[role.mass]: ROLE_COLOR_KEY.mass,
		[role.contactPoints]: ROLE_COLOR_KEY.contactPoints,
		[role.contactNormals]: ROLE_COLOR_KEY.contactNormals,
		[role.contactForces]: ROLE_COLOR_KEY.contactForces,
		[role.frictionForces]: ROLE_COLOR_KEY.frictionForces,
		[role.islands]: ROLE_COLOR_KEY.islands,
	};

	const drawOpts = {
		shapes: false,
		bounds: false,
		joints: false,
		jointExtras: false,
		mass: false,
		contacts: false,
		contactNormals: false,
		contactForces: false,
		frictionForces: false,
		contactFeatures: false,
		islands: false,
		graphColors: false,
		forceScale: 1,
		jointScale: 1,
		drawingBounds: undefined,
		maskBits: undefined,
	};

	const color = new THREE.Color();
	const rgb = [1, 1, 1];
	const tmp = [0, 0, 0];
	const tmpB = [0, 0, 0];
	const corners = new Float32Array(24);
	const basis = { ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: 1, dx: 0, dy: 1, dz: 0 };

	const geometries = new Map();
	const objects = new Map();

	const lineGeometry = new THREE.BufferGeometry();
	const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
	const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
	lines.frustumCulled = false;
	lines.matrixAutoUpdate = false;
	root.add(lines);
	let lineCapacity = 0;

	const pointGeometry = new THREE.BufferGeometry();
	const pointMaterial = new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: false });
	pointMaterial.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float aSize;')
			.replace('gl_PointSize = size;', 'gl_PointSize = size * (aSize / 8.0);');
	};
	const points = new THREE.Points(pointGeometry, pointMaterial);
	points.frustumCulled = false;
	points.matrixAutoUpdate = false;
	root.add(points);
	let pointCapacity = 0;

	function syncDrawOpts() {
		drawOpts.shapes = !!settings.shapes;
		drawOpts.bounds = !!settings.bounds;
		drawOpts.joints = !!settings.joints;
		drawOpts.jointExtras = !!settings.jointExtras;
		drawOpts.mass = !!settings.mass;
		drawOpts.contacts = !!settings.contacts;
		drawOpts.contactNormals = !!settings.contactNormals;
		drawOpts.contactForces = !!settings.contactForces;
		drawOpts.frictionForces = !!settings.frictionForces;
		drawOpts.contactFeatures = !!settings.contactFeatures;
		drawOpts.islands = !!settings.islands;
		drawOpts.graphColors = !!settings.graphColors;
		drawOpts.forceScale = settings.forceScale;
		drawOpts.jointScale = settings.jointScale;
		drawOpts.drawingBounds = settings.drawingBounds;
		drawOpts.maskBits = settings.maskBits;
	}

	function resolvePacked(packed, key) {
		const override = key != null && settings.colors ? settings.colors[key] : undefined;
		if (override != null) return override;
		if (key === 'mass') return 0xffffff;
		return packed & 0xffffff;
	}

	function writeRgb(value) {
		color.set(value);
		rgb[0] = color.r;
		rgb[1] = color.g;
		rgb[2] = color.b;
	}

	function applyLook(material) {
		const opacity = settings.opacity ?? 1;
		material.opacity = opacity;
		material.transparent = opacity < 1;
		material.depthTest = settings.depthTest !== false;
		material.depthWrite = settings.depthTest !== false && opacity >= 1;
	}

	function ensureLines(vertexCount) {
		if (vertexCount <= lineCapacity) return;
		const next = Math.max(vertexCount, lineCapacity * 2, 64);
		lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(next * 3), 3));
		lineGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(next * 3), 3));
		lineCapacity = next;
	}

	function ensurePoints(count) {
		if (count <= pointCapacity) return;
		const next = Math.max(count, pointCapacity * 2, 32);
		pointGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(next * 3), 3));
		pointGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(next * 3), 3));
		pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(next), 1));
		pointCapacity = next;
	}

	function cacheGeometry(id) {
		let cached = geometries.get(id);
		if (cached) return cached;
		const view = b3.getDebugGeometry(id);
		if (!view) return null;
		const positions = new Float32Array(view.positions);
		const indices = new Uint32Array(view.indices);
		const spheres = new Float32Array(view.spheres);
		const capsules = new Float32Array(view.capsules);
		let triangle = null;
		if (indices.length > 0) {
			triangle = new THREE.BufferGeometry();
			triangle.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			triangle.setIndex(new THREE.BufferAttribute(indices, 1));
			triangle.computeVertexNormals();
		}
		cached = { positions, indices, spheres, capsules, triangle };
		geometries.set(id, cached);
		return cached;
	}

	function partGeometry(kind, a, b, c, d) {
		if (kind === 'sphere') {
			const geo = new THREE.SphereGeometry(Math.max(a, 1e-4), 16, 12);
			geo.translate(b, c, d);
			return geo;
		}
		const c1x = a;
		const c1y = b;
		const c1z = c;
		const c2x = d[0];
		const c2y = d[1];
		const c2z = d[2];
		const radius = d[3];
		let dx = c2x - c1x;
		let dy = c2y - c1y;
		let dz = c2z - c1z;
		const length = Math.hypot(dx, dy, dz);
		const midX = (c1x + c2x) * 0.5;
		const midY = (c1y + c2y) * 0.5;
		const midZ = (c1z + c2z) * 0.5;
		if (length < 1e-5) {
			const geo = new THREE.SphereGeometry(Math.max(radius, 1e-4), 16, 12);
			geo.translate(midX, midY, midZ);
			return geo;
		}
		dx /= length;
		dy /= length;
		dz /= length;
		const geo = new THREE.CapsuleGeometry(Math.max(radius, 1e-4), length, 4, 10);
		const from = new THREE.Vector3(0, 1, 0);
		const to = new THREE.Vector3(dx, dy, dz);
		const q = new THREE.Quaternion().setFromUnitVectors(from, to);
		geo.applyQuaternion(q);
		geo.translate(midX, midY, midZ);
		return geo;
	}

	function buildObject(cached) {
		const group = new THREE.Group();
		group.matrixAutoUpdate = false;
		group.frustumCulled = false;
		const materials = [];
		const owned = [];
		const style = settings.shapeStyle;
		const solid = style === 'solid' || style === 'both';
		const wire = style === 'wireframe' || style === 'both';

		function addPart(geometry) {
			owned.push(geometry);
			if (solid) {
				const mat = new THREE.MeshBasicMaterial({
					side: THREE.DoubleSide,
					polygonOffset: true,
					polygonOffsetFactor: 1,
					polygonOffsetUnits: 1,
				});
				const mesh = new THREE.Mesh(geometry, mat);
				mesh.matrixAutoUpdate = false;
				mesh.frustumCulled = false;
				group.add(mesh);
				materials.push(mat);
			}
			if (wire) {
				const edges = new THREE.EdgesGeometry(geometry);
				owned.push(edges);
				const mat = new THREE.LineBasicMaterial();
				const segs = new THREE.LineSegments(edges, mat);
				segs.matrixAutoUpdate = false;
				segs.frustumCulled = false;
				group.add(segs);
				materials.push(mat);
			}
		}

		if (cached.triangle) addPart(cached.triangle);
		const spheres = cached.spheres;
		for (let i = 0; i < spheres.length; i += 4) {
			addPart(partGeometry('sphere', spheres[i + 3], spheres[i], spheres[i + 1], spheres[i + 2]));
		}
		const capsules = cached.capsules;
		for (let i = 0; i < capsules.length; i += 7) {
			addPart(
				partGeometry('capsule', capsules[i], capsules[i + 1], capsules[i + 2], [
					capsules[i + 3],
					capsules[i + 4],
					capsules[i + 5],
					capsules[i + 6],
				]),
			);
		}
		// The shared triangle buffer is owned by the cache, not this object.
		const localOwned = owned.filter((geo) => geo !== cached.triangle);
		return { group, materials, owned: localOwned, style };
	}

	function dropShape(id) {
		const obj = objects.get(id);
		if (obj) {
			root.remove(obj.group);
			for (const mat of obj.materials) mat.dispose();
			for (const geo of obj.owned) geo.dispose();
			objects.delete(id);
		}
		const cached = geometries.get(id);
		if (cached) {
			if (cached.triangle) cached.triangle.dispose();
			geometries.delete(id);
		}
	}

	function syncShapes() {
		const seen = new Set();
		const n = b3.getNumDebugShapes(buf);
		for (let i = 0; i < n; i++) {
			b3.getDebugShapeAt(shapeRec, buf, i);
			const id = shapeRec.geometryId;
			seen.add(id);
			const cached = cacheGeometry(id);
			if (!cached) continue;
			let obj = objects.get(id);
			if (!obj || obj.style !== settings.shapeStyle) {
				if (obj) {
					root.remove(obj.group);
					for (const mat of obj.materials) mat.dispose();
					for (const geo of obj.owned) geo.dispose();
					objects.delete(id);
				}
				obj = buildObject(cached);
				objects.set(id, obj);
				root.add(obj.group);
			}
			const stateName = STATE_NAMES[shapeRec.state] ?? 'custom';
			const tint = resolvePacked(shapeRec.color, stateName);
			for (const mat of obj.materials) {
				mat.color.set(tint);
				applyLook(mat);
			}
			obj.group.position.set(shapeRec.position[0], shapeRec.position[1], shapeRec.position[2]);
			obj.group.quaternion.set(shapeRec.rotation[0], shapeRec.rotation[1], shapeRec.rotation[2], shapeRec.rotation[3]);
			obj.group.updateMatrix();
			obj.group.renderOrder = settings.renderOrder ?? 0;
		}
		for (const id of objects.keys()) {
			if (!seen.has(id)) dropShape(id);
		}
	}

	const cursor = { n: 0 };
	let linePositions = null;
	let lineColors = null;

	function vertex(x, y, z) {
		const i = cursor.n++;
		const o = i * 3;
		linePositions[o] = x;
		linePositions[o + 1] = y;
		linePositions[o + 2] = z;
		lineColors[o] = rgb[0];
		lineColors[o + 1] = rgb[1];
		lineColors[o + 2] = rgb[2];
	}

	function segment(ax, ay, az, bx, by, bz) {
		vertex(ax, ay, az);
		vertex(bx, by, bz);
	}

	function paint(roleId, packed) {
		writeRgb(resolvePacked(packed, roleKey[roleId]));
	}

	function writeEdgesFromCorners() {
		for (let e = 0; e < EDGES.length; e += 2) {
			const a = EDGES[e] * 3;
			const b = EDGES[e + 1] * 3;
			segment(corners[a], corners[a + 1], corners[a + 2], corners[b], corners[b + 1], corners[b + 2]);
		}
	}

	function fillAabb(aabb) {
		for (let i = 0; i < 8; i++) {
			const o = i * 3;
			corners[o] = i & 4 ? aabb[3] : aabb[0];
			corners[o + 1] = i & 2 ? aabb[4] : aabb[1];
			corners[o + 2] = i & 1 ? aabb[5] : aabb[2];
		}
		writeEdgesFromCorners();
	}

	function fillBox(extents, position, rotation) {
		for (let i = 0; i < 8; i++) {
			const x = i & 4 ? extents[0] : -extents[0];
			const y = i & 2 ? extents[1] : -extents[1];
			const z = i & 1 ? extents[2] : -extents[2];
			rotateInto(tmp, rotation, x, y, z, position[0], position[1], position[2]);
			const o = i * 3;
			corners[o] = tmp[0];
			corners[o + 1] = tmp[1];
			corners[o + 2] = tmp[2];
		}
		writeEdgesFromCorners();
	}

	function setBasis(dx, dy, dz) {
		const ax = Math.abs(dy) < 0.9 ? 0 : 1;
		const ay = Math.abs(dy) < 0.9 ? 1 : 0;
		const az = 0;
		let ux = dy * az - dz * ay;
		let uy = dz * ax - dx * az;
		let uz = dx * ay - dy * ax;
		const ul = Math.hypot(ux, uy, uz) || 1;
		ux /= ul;
		uy /= ul;
		uz /= ul;
		basis.ux = ux;
		basis.uy = uy;
		basis.uz = uz;
		basis.vx = dy * uz - dz * uy;
		basis.vy = dz * ux - dx * uz;
		basis.vz = dx * uy - dy * ux;
		basis.dx = dx;
		basis.dy = dy;
		basis.dz = dz;
	}

	function writeCircle(cx, cy, cz, radius, ux, uy, uz, vx, vy, vz, turns) {
		const n = turns === 1 ? RING : ARC;
		const span = turns * Math.PI * 2;
		for (let i = 0; i < n; i++) {
			const t0 = (i / n) * span;
			const t1 = ((i + 1) / n) * span;
			const c0 = Math.cos(t0);
			const s0 = Math.sin(t0);
			const c1 = Math.cos(t1);
			const s1 = Math.sin(t1);
			segment(
				cx + radius * (c0 * ux + s0 * vx),
				cy + radius * (c0 * uy + s0 * vy),
				cz + radius * (c0 * uz + s0 * vz),
				cx + radius * (c1 * ux + s1 * vx),
				cy + radius * (c1 * uy + s1 * vy),
				cz + radius * (c1 * uz + s1 * vz),
			);
		}
	}

	function fillSphereOutline(center, radius) {
		writeCircle(center[0], center[1], center[2], radius, 1, 0, 0, 0, 1, 0, 1);
		writeCircle(center[0], center[1], center[2], radius, 1, 0, 0, 0, 0, 1, 1);
		writeCircle(center[0], center[1], center[2], radius, 0, 1, 0, 0, 0, 1, 1);
	}

	function fillCapsuleOutline(p1, p2, radius) {
		let dx = p2[0] - p1[0];
		let dy = p2[1] - p1[1];
		let dz = p2[2] - p1[2];
		const length = Math.hypot(dx, dy, dz);
		if (length < 1e-5) {
			fillSphereOutline(p1, radius);
			return;
		}
		dx /= length;
		dy /= length;
		dz /= length;
		setBasis(dx, dy, dz);
		writeCircle(p1[0], p1[1], p1[2], radius, basis.ux, basis.uy, basis.uz, basis.vx, basis.vy, basis.vz, 1);
		writeCircle(p2[0], p2[1], p2[2], radius, basis.ux, basis.uy, basis.uz, basis.vx, basis.vy, basis.vz, 1);
		const sides = [
			[basis.ux, basis.uy, basis.uz],
			[-basis.ux, -basis.uy, -basis.uz],
			[basis.vx, basis.vy, basis.vz],
			[-basis.vx, -basis.vy, -basis.vz],
		];
		for (const s of sides) {
			segment(
				p1[0] + radius * s[0],
				p1[1] + radius * s[1],
				p1[2] + radius * s[2],
				p2[0] + radius * s[0],
				p2[1] + radius * s[1],
				p2[2] + radius * s[2],
			);
		}
		// Hemispheres bulge away from the segment.
		writeCircle(p1[0], p1[1], p1[2], radius, basis.ux, basis.uy, basis.uz, -dx, -dy, -dz, 0.5);
		writeCircle(p1[0], p1[1], p1[2], radius, basis.vx, basis.vy, basis.vz, -dx, -dy, -dz, 0.5);
		writeCircle(p2[0], p2[1], p2[2], radius, basis.ux, basis.uy, basis.uz, dx, dy, dz, 0.5);
		writeCircle(p2[0], p2[1], p2[2], radius, basis.vx, basis.vy, basis.vz, dx, dy, dz, 0.5);
	}

	function fillMass(position, rotation) {
		writeRgb(resolvePacked(0, 'mass'));
		segment(position[0], position[1], position[2], ...axisEnd(rotation, MASS_AXIS, 0, 0, position));
		segment(position[0], position[1], position[2], ...axisEnd(rotation, 0, MASS_AXIS, 0, position));
		segment(position[0], position[1], position[2], ...axisEnd(rotation, 0, 0, MASS_AXIS, position));
	}

	function axisEnd(rotation, x, y, z, position) {
		rotateInto(tmpB, rotation, x, y, z, position[0], position[1], position[2]);
		return tmpB;
	}

	function syncLines() {
		const segments = b3.getNumDebugSegments(buf);
		const boundsN = b3.getNumDebugBounds(buf);
		const boxes = b3.getNumDebugBoxes(buf);
		const spheres = b3.getNumDebugSpheres(buf);
		const capsules = b3.getNumDebugCapsules(buf);
		const transforms = b3.getNumDebugTransforms(buf);
		const needed =
			segments * 2 +
			boundsN * 24 +
			boxes * 24 +
			spheres * SPHERE_LINE_VERTS +
			capsules * CAPSULE_LINE_VERTS +
			transforms * 6;
		// The default pass draws shapes only, so the first frames have no line
		// vertices. Attributes are allocated on the first non-empty pass.
		if (needed === 0) {
			lineGeometry.setDrawRange(0, 0);
			lines.visible = false;
			return;
		}
		ensureLines(needed);
		linePositions = lineGeometry.getAttribute('position').array;
		lineColors = lineGeometry.getAttribute('color').array;
		cursor.n = 0;

		for (let i = 0; i < segments; i++) {
			b3.getDebugSegmentAt(segmentRec, buf, i);
			paint(segmentRec.role, segmentRec.color);
			let x2 = segmentRec.p2[0];
			let y2 = segmentRec.p2[1];
			let z2 = segmentRec.p2[2];
			// box3d's contact normals are 0.3 length units. Scale them so a wide
			// scene can still show the direction.
			if (segmentRec.role === role.contactNormals) {
				const scale = settings.normalScale ?? 1;
				const x1 = segmentRec.p1[0];
				const y1 = segmentRec.p1[1];
				const z1 = segmentRec.p1[2];
				x2 = x1 + (x2 - x1) * scale;
				y2 = y1 + (y2 - y1) * scale;
				z2 = z1 + (z2 - z1) * scale;
			}
			segment(segmentRec.p1[0], segmentRec.p1[1], segmentRec.p1[2], x2, y2, z2);
		}
		for (let i = 0; i < boundsN; i++) {
			b3.getDebugBoundsAt(boundsRec, buf, i);
			paint(boundsRec.role, boundsRec.color);
			fillAabb(boundsRec.aabb);
		}
		for (let i = 0; i < boxes; i++) {
			b3.getDebugBoxAt(boxRec, buf, i);
			paint(boxRec.role, boxRec.color);
			fillBox(boxRec.extents, boxRec.position, boxRec.rotation);
		}
		for (let i = 0; i < spheres; i++) {
			b3.getDebugSphereAt(sphereRec, buf, i);
			paint(sphereRec.role, sphereRec.color);
			fillSphereOutline(sphereRec.center, sphereRec.radius);
		}
		for (let i = 0; i < capsules; i++) {
			b3.getDebugCapsuleAt(capsuleRec, buf, i);
			paint(capsuleRec.role, capsuleRec.color);
			fillCapsuleOutline(capsuleRec.p1, capsuleRec.p2, capsuleRec.radius);
		}
		for (let i = 0; i < transforms; i++) {
			b3.getDebugTransformAt(transformRec, buf, i);
			fillMass(transformRec.position, transformRec.rotation);
		}

		lineGeometry.setDrawRange(0, cursor.n);
		lineGeometry.getAttribute('position').needsUpdate = true;
		lineGeometry.getAttribute('color').needsUpdate = true;
		lines.visible = cursor.n > 0;
		applyLook(lineMaterial);
		lineMaterial.color.set(0xffffff);
		lines.renderOrder = settings.renderOrder ?? 0;
	}

	function syncPoints() {
		const n = b3.getNumDebugPoints(buf);
		if (n === 0) {
			pointGeometry.setDrawRange(0, 0);
			points.visible = false;
			return;
		}
		ensurePoints(n);
		const positions = pointGeometry.getAttribute('position').array;
		const colors = pointGeometry.getAttribute('color').array;
		const sizes = pointGeometry.getAttribute('aSize').array;
		for (let i = 0; i < n; i++) {
			b3.getDebugPointAt(pointRec, buf, i);
			writeRgb(resolvePacked(pointRec.color, roleKey[pointRec.role]));
			const o = i * 3;
			positions[o] = pointRec.position[0];
			positions[o + 1] = pointRec.position[1];
			positions[o + 2] = pointRec.position[2];
			colors[o] = rgb[0];
			colors[o + 1] = rgb[1];
			colors[o + 2] = rgb[2];
			sizes[i] = pointRec.size;
		}
		pointGeometry.setDrawRange(0, n);
		pointGeometry.getAttribute('position').needsUpdate = true;
		pointGeometry.getAttribute('color').needsUpdate = true;
		pointGeometry.getAttribute('aSize').needsUpdate = true;
		points.visible = n > 0;
		pointMaterial.size = (settings.pointSize ?? 1) * 8;
		applyLook(pointMaterial);
		pointMaterial.color.set(0xffffff);
		points.renderOrder = settings.renderOrder ?? 0;
	}

	function update() {
		syncDrawOpts();
		b3.getDebugDraw(buf, worldId, drawOpts);
		if (settings.shapes) syncShapes();
		else {
			for (const id of objects.keys()) dropShape(id);
		}
		syncLines();
		syncPoints();
		root.renderOrder = settings.renderOrder ?? 0;
	}

	function dispose() {
		for (const id of [...objects.keys()]) dropShape(id);
		root.remove(lines);
		root.remove(points);
		lineGeometry.dispose();
		pointGeometry.dispose();
		lineMaterial.dispose();
		pointMaterial.dispose();
		parent.remove(root);
		b3.destroyDebugDrawBuffer(buf);
	}

	return { settings, object3d: root, update, dispose };
}
