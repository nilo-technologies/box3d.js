// Extracts the Akina track's centreline from the "Akina Map Low Poly" glTF and writes it as
// examples/src/vehicle-track-akina.js, the control points the race track builder reads.
//
//   node examples/scripts/akina-centerline.mjs path/to/akina_map_low_poly/scene.gltf
//
// The model is by Unprofessional Modeler, CC-BY-4.0:
// https://sketchfab.com/3d-models/akina-map-low-poly-b86e2f7f76514bdf8acd917af01c030f
//
// The model has no terrain: its first mesh is the road surface, a ribbon about 9 m wide, and
// the others are walls along it and road markings. This script rasterises the road from above
// (a height per 25 cm cell), walks it from the summit to the bottom, re-centring between the
// road edges at every metre, smooths the walk (more where the road widens into a start area or
// a lay-by, which would otherwise pull the line sideways), trims the dead ends and keeps the
// fewest points that stay within a few centimetres of the smoothed line.

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
	console.error('usage: akina-centerline.mjs path/to/scene.gltf');
	process.exit(2);
}
const out = new URL('../src/vehicle-track-akina.js', import.meta.url);

// ---- The road mesh, Z up turned to Y up as the glTF's root node does: x, z, -y
const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
const bin = fs.readFileSync(path.join(path.dirname(file), gltf.buffers[0].uri));
function accessor(index) {
	const a = gltf.accessors[index];
	const view = gltf.bufferViews[a.bufferView];
	const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
	const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
	const stride = view.byteStride ?? size * 4;
	const ints = a.componentType === 5125;
	const values = new Float64Array(a.count * size);
	for (let k = 0; k < a.count; k++) {
		for (let c = 0; c < size; c++) {
			const at = offset + k * stride + c * 4;
			values[k * size + c] = ints ? bin.readUInt32LE(at) : bin.readFloatLE(at);
		}
	}
	return values;
}
const primitive = gltf.meshes[0].primitives[0];
const raw = accessor(primitive.attributes.POSITION);
const indices = accessor(primitive.indices);
const positions = new Float64Array(raw.length);
for (let i = 0; i < raw.length; i += 3) {
	positions[i] = raw[i];
	positions[i + 1] = raw[i + 2];
	positions[i + 2] = -raw[i + 1];
}

// ---- Road height per cell seen from above (NaN off the road)
const cell = 0.25;
const x0 = 60;
const z0 = -640;
const W = Math.ceil(790 / cell);
const H = Math.ceil(730 / cell);
const heights = new Float32Array(W * H).fill(Number.NaN);
for (let t = 0; t < indices.length; t += 3) {
	const p = [0, 1, 2].map((k) => {
		const i = indices[t + k] * 3;
		return [
			(positions[i] - x0) / cell,
			(positions[i + 2] - z0) / cell,
			positions[i + 1],
		];
	});
	const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
	const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1]];
	const den = e1[0] * e2[1] - e1[1] * e2[0];
	if (Math.abs(den) < 1e-9) continue;
	const xs = p.map((q) => q[0]);
	const zs = p.map((q) => q[1]);
	const minX = Math.max(0, Math.floor(Math.min(...xs)));
	const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
	const minZ = Math.max(0, Math.floor(Math.min(...zs)));
	const maxZ = Math.min(H - 1, Math.ceil(Math.max(...zs)));
	for (let iz = minZ; iz <= maxZ; iz++) {
		for (let ix = minX; ix <= maxX; ix++) {
			const dx = ix + 0.5 - p[0][0];
			const dz = iz + 0.5 - p[0][1];
			const u = (dx * e2[1] - dz * e2[0]) / den;
			const v = (e1[0] * dz - e1[1] * dx) / den;
			if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
			const y = p[0][2] + u * (p[1][2] - p[0][2]) + v * (p[2][2] - p[0][2]);
			const o = iz * W + ix;
			if (!(y <= heights[o])) heights[o] = y;
		}
	}
}
const heightAt = (x, z) => {
	const ix = Math.floor((x - x0) / cell);
	const iz = Math.floor((z - z0) / cell);
	if (ix < 0 || iz < 0 || ix >= W || iz >= H) return Number.NaN;
	return heights[iz * W + ix];
};
const onRoad = (x, z) => !Number.isNaN(heightAt(x, z));
const extent = (x, z, nx, nz) => {
	let d = 0;
	while (d < 14 && onRoad(x + nx * d, z + nz * d)) d += cell;
	return d;
};

// ---- Walk the road from the summit, a metre at a time
const walk = [];
{
	let x = 90;
	let z = -195;
	let heading = Math.PI / 2;
	const turns = [0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1.1, 1.3].flatMap((a) => [a, -a]);
	for (let step = 0; step < 8000; step++) {
		let ahead = null;
		for (const turn of [0, ...turns]) {
			const h = heading + turn;
			if (onRoad(x + Math.sin(h), z + Math.cos(h))) {
				heading = h;
				ahead = [x + Math.sin(h), z + Math.cos(h)];
				break;
			}
		}
		if (!ahead) break;
		// Re-centre between the edges across the road, gently where it is wide
		const lx = Math.cos(heading);
		const lz = -Math.sin(heading);
		const a = extent(ahead[0], ahead[1], lx, lz);
		const b = extent(ahead[0], ahead[1], -lx, -lz);
		const offset = ((a - b) / 2) * (a + b > 11 ? 0.15 : 0.5);
		const cx = ahead[0] + lx * offset;
		const cz = ahead[1] + lz * offset;
		const turn = Math.atan2(cx - x, cz - z) - heading;
		heading += Math.atan2(Math.sin(turn), Math.cos(turn)) * 0.6;
		x += Math.sin(heading);
		z += Math.cos(heading);
		// The road ends in a slab at the bottom, where the walk would circle: stop when it comes
		// back near where it has been
		if (walk.some((q, i) => i < walk.length - 40 && Math.hypot(q[0] - x, q[1] - z) < 4)) break;
		walk.push([x, z, heightAt(x, z), a + b]);
	}
}

// ---- Smooth: 2 m along the road, 7 m where it is wider than a two lane road; heights over 6 m
// to take out the low poly facets. Then trim the slab at the bottom.
const n = walk.length;
const wide = walk.map((_, i) => {
	let most = 0;
	for (let k = -12; k <= 12; k++) most = Math.max(most, walk[Math.min(n - 1, Math.max(0, i + k))][3]);
	return most > 10.5;
});
const smooth = (values, sigma) =>
	values.map((_, i) => {
		const s = sigma(i);
		const r = Math.ceil(3 * s);
		let sum = 0;
		let weight = 0;
		for (let k = -r; k <= r; k++) {
			const g = Math.exp(-(k * k) / (2 * s * s));
			sum += g * values[Math.min(n - 1, Math.max(0, i + k))];
			weight += g;
		}
		return sum / weight;
	});
const NARROW = 2;
const WIDE = 7;
const SPACING = Number(process.env.SPACING ?? 5);
const sx = smooth(walk.map((q) => q[0]), (i) => (wide[i] ? WIDE : NARROW));
const sz = smooth(walk.map((q) => q[1]), (i) => (wide[i] ? WIDE : NARROW));
const sy = smooth(walk.map((q) => q[2]), () => 6);
let last = n - 1;
while (last > 0 && sz[last] < -603) last--;
const line = [];
for (let i = 0; i <= last; i++) line.push([sx[i], sz[i], sy[i]]);

// ---- Points every ${SPACING} m along the line. Catmull-Rom through evenly spaced points follows
// the line closely; unevenly spaced ones (as a Douglas-Peucker pass leaves) make it overshoot into
// small loops, and the road mesh built on it folds over there.
const along = [0];
for (let i = 1; i < line.length; i++) {
	along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
}
const total = along[along.length - 1];
const segments = Math.round(total / SPACING);
const resampled = [];
for (let k = 0, j = 0; k <= segments; k++) {
	const d = (k * total) / segments;
	while (j < line.length - 2 && along[j + 1] < d) j++;
	const t = (d - along[j]) / (along[j + 1] - along[j]);
	resampled.push(line[j].map((v, c) => v + (line[j + 1][c] - v) * t));
}

// Centre the map on the origin with the bottom of the road at height 0
const bottom = line[line.length - 1][2];
const points = resampled.map(([x, z, y]) => [x - 450, z + 280, y - bottom].map((v) => Math.round(v * 100) / 100));

let length = 0;
for (let i = 1; i < line.length; i++) {
	length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
}
const rows = [];
for (let i = 0; i < points.length; i += 6) {
	rows.push(`\t${points.slice(i, i + 6).map((p) => `[${p.join(', ')}]`).join(', ')},`);
}
fs.writeFileSync(
	out,
	`// The Akina track's centreline, from the summit to the bottom: [x, z, elevation] in metres.
// Generated by examples/scripts/akina-centerline.mjs from the road of "Akina Map Low Poly"
// (https://sketchfab.com/3d-models/akina-map-low-poly-b86e2f7f76514bdf8acd917af01c030f) by
// Unprofessional Modeler (https://sketchfab.com/themodel_finder), licensed under CC-BY-4.0
// (http://creativecommons.org/licenses/by/4.0/). Do not edit by hand: rerun the script.
//
// ${Math.round(length)} m long, ${Math.round(line[0][2] - bottom)} m from the summit to the bottom, ${points.length} points.

export const akinaCredit =
	'Akina track based on "Akina Map Low Poly" by Unprofessional Modeler (CC-BY-4.0)';

export const akinaCreditUrl =
	'https://sketchfab.com/3d-models/akina-map-low-poly-b86e2f7f76514bdf8acd917af01c030f';

/** @type {[number, number, number][]} */
export const akinaPoints = [
${rows.join('\n')}
];
`,
);
console.log(
	`${points.length} points, ${Math.round(length)} m, ${Math.round(line[0][2] - bottom)} m drop -> ${out.pathname}`,
);
