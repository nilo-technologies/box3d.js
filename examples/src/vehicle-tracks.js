// Race tracks for the vehicle examples: a paved circuit, an off-road stage and the Akina mountain
// pass, run downhill or uphill. Plain JS so Node tests can build the same physics as the examples;
// types live in vehicle-tracks.d.ts.
//
// Each track is a Catmull-Rom spline through control points [x, z, elevation]: closed for a
// circuit, open from start to finish for a point to point run. The spline is resampled every
// metre, and the terrain is a height field: flat across the road at the centreline's elevation,
// blending over the shoulder into a landscape that follows the road's elevation plus some hills.
// A paved track also has its road as a triangle mesh along the spline, a little above the
// terrain, with edges that ease down onto it, so the car drives on the road it sees and can leave
// and rejoin it smoothly. Bumps are separate convex hull bodies laid across the road along a
// straight bump section, so their shape is exact rather than limited by the height field's grid.
// Where the ground beside the road drops away or rises into a bank, as between the legs of a
// mountain pass, a track with `rails` gets guardrails: thin walls along the road edge.

import { akinaPoints } from './vehicle-track-akina.js';

const TAU = Math.PI * 2;

/** Guardrail wall thickness and height above the road (m) */
export const railThickness = 0.25;
export const railHeight = 0.9;

/**
 * The guardrails' collision category. A wheel sticks out past the chassis box, so against a rail
 * its cast lands on the rail's top and the car climbs it and stays there, leaning on it. The
 * chassis collides with the rails as with anything; the wheel casts skip them.
 */
export const railCategory = 1n << 62n;

/** Makes a vehicle def's wheel casts skip the guardrails */
export function wheelsIgnoreRails(def) {
	const filter = def.chassis.castFilter;
	def.chassis.castFilter = {
		...filter,
		maskBits: filter.maskBits & ~railCategory,
	};
	return def;
}

// Bump shapes, as a profile along the road: height at a distance x from the bump's centre
const profiles = {
	// Rounded, like a speed hump (the convex hull straightens its flanks)
	hump: (x, length, height) =>
		Math.abs(x) > length / 2
			? 0
			: (height * (1 + Math.cos((TAU * x) / length))) / 2,
	// Flat top with ramps a quarter of the length each
	table: (x, length, height) => {
		const ramp = length / 4;
		const d = length / 2 - Math.abs(x);
		return d <= 0 ? 0 : height * Math.min(d / ramp, 1);
	},
};

/**
 * Bumps along the bump section: `at` is the distance from the section start (m), `count` and
 * `spacing` repeat a bump, `kind` picks the profile.
 */
export const raceTracks = {
	circuit: {
		title: 'Race circuit',
		surface: 'asphalt',
		width: 12,
		shoulder: 10,
		hills: 3,
		roughness: 0,
		road: { sink: 0.15, ramp: 2.5 },
		points: [
			[0, -110, 0],
			[0, 40, 0],
			[12, 100, 1],
			[55, 128, 3],
			[110, 118, 6],
			[138, 78, 9],
			[128, 28, 13],
			[150, -8, 17],
			[200, -18, 20],
			[248, 10, 17],
			[285, 58, 12],
			[330, 62, 8],
			[352, 18, 5],
			[345, -50, 3],
			[322, -130, 2],
			[300, -170, 2],
			[220, -170, 2],
			[140, -170, 2],
			[70, -170, 1],
			[20, -160, 0],
		],
		start: [0, -60],
		bumpSection: [292, -170],
		bumps: [
			{
				kind: 'hump',
				at: 0,
				height: 0.03,
				length: 0.6,
				count: 3,
				spacing: 6,
				label: 'small sharp ridges',
			},
			{
				kind: 'hump',
				at: 22,
				height: 0.025,
				length: 1.2,
				count: 10,
				spacing: 1.2,
				label: 'washboard',
			},
			{
				kind: 'hump',
				at: 48,
				height: 0.08,
				length: 3.7,
				count: 2,
				spacing: 12,
				label: 'speed humps',
			},
			{
				kind: 'table',
				at: 80,
				height: 0.12,
				length: 8,
				label: 'flat topped table',
			},
			{
				kind: 'hump',
				at: 100,
				height: 0.2,
				length: 12,
				label: 'long gentle hump',
			},
			{ kind: 'hump', at: 125, height: 0.3, length: 6, label: 'big hump' },
		],
	},
	stage: {
		title: 'Off-road stage',
		surface: 'gravel',
		width: 8,
		shoulder: 8,
		hills: 7,
		roughness: 0.05,
		points: [
			[0, -90, 0],
			[0, 20, 2],
			[-15, 75, 6],
			[-60, 105, 11],
			[-125, 100, 17],
			[-175, 55, 23],
			[-165, 5, 28],
			[-125, -15, 30],
			[-95, -45, 24],
			[-110, -95, 16],
			[-150, -120, 10],
			[-195, -110, 7],
			[-225, -145, 5],
			[-205, -195, 4],
			[-150, -215, 3],
			[-70, -215, 2],
			[-10, -200, 1],
			[15, -150, 0],
		],
		start: [0, -50],
		bumpSection: [-150, -215],
		bumps: [
			{
				kind: 'hump',
				at: 0,
				height: 0.06,
				length: 0.8,
				count: 4,
				spacing: 5,
				label: 'small rocks',
			},
			{
				kind: 'hump',
				at: 26,
				height: 0.3,
				length: 9,
				count: 4,
				spacing: 10,
				label: 'whoops',
			},
			{ kind: 'table', at: 68, height: 0.2, length: 8, label: 'washout ledge' },
			{
				kind: 'hump',
				at: 92,
				height: 0.12,
				length: 1.8,
				count: 3,
				spacing: 3,
				label: 'ruts',
			},
			{ kind: 'hump', at: 112, height: 0.8, length: 10, label: 'jump' },
		],
	},
	// Traced from the road of "Akina Map Low Poly" (see vehicle-track-akina.js for the credit):
	// 5.5 km and 323 m of drop, mostly 4-10% with stretches of 15%, about twenty corners under 25 m
	// radius and a run of five hairpins. Uphill is the same road from the other end.
	'akina-downhill': akina('Akina downhill', false),
	'akina-uphill': akina('Akina uphill', true),
};

function akina(title, reverse) {
	return {
		title,
		surface: 'asphalt',
		width: 9,
		shoulder: 8,
		hills: 3,
		roughness: 0,
		// A short ramp keeps the road edges clear of the cliffs between stacked legs
		road: { sink: 0.15, ramp: 1.5, strips: 12 },
		farSpread: 70,
		points: akinaPoints,
		closed: false,
		reverse,
		run: { start: 30, finish: 30 },
		rails: { drop: 3 },
		bumps: [],
	};
}

function catmullRom(p0, p1, p2, p3, t) {
	const t2 = t * t;
	const t3 = t2 * t;
	return p1.map(
		(_, i) =>
			0.5 *
			(2 * p1[i] +
				(-p0[i] + p2[i]) * t +
				(2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
				(-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3),
	);
}

// Deterministic smooth noise: a few sine octaves at fixed irrational angles
function hills(x, z, seed) {
	let h = 0;
	let amp = 1;
	let freq = 1 / 70;
	for (let o = 0; o < 4; o++) {
		const a = seed * 1.7 + o * 2.1;
		h +=
			amp *
			Math.sin((x * Math.cos(a) + z * Math.sin(a)) * freq + seed + o) *
			Math.cos((x * Math.sin(a * 1.3) - z * Math.cos(a * 0.7)) * freq * 1.3);
		amp *= 0.5;
		freq *= 2.1;
	}
	return h;
}

/**
 * How far out from the centreline the road may reach on one side (1 left, -1 right) at sample i:
 * unlimited on the outside of a corner, 85% of the tightest radius within 3 m on the inside
 */
function innerReach(line, closed) {
	const n = line.length;
	const at = (k) =>
		closed ? line[((k % n) + n) % n] : line[Math.min(Math.max(k, 0), n - 1)];
	// Signed curvature: the turn over the 6 samples (6 m), negative turning left (toward +x
	// heading +z)
	const curvature = line.map((_, k) => {
		const a = at(k - 3);
		const b = at(k + 3);
		return Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz) / 6;
	});
	return (i, side) => {
		let reach = Number.POSITIVE_INFINITY;
		for (let k = i - 3; k <= i + 3; k++) {
			const kappa =
				curvature[closed ? ((k % n) + n) % n : Math.min(Math.max(k, 0), n - 1)];
			// The inside of a left turn is the left side
			if (side * kappa < 0) reach = Math.min(reach, 0.85 / Math.abs(kappa));
		}
		return reach;
	};
}

const smoothstep = (e0, e1, x) => {
	const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Builds a track's centreline, terrain heights, bump hulls and start pose */
export function buildRaceTrack(name) {
	const def = raceTracks[name];
	const closed = def.closed !== false;
	const pts = def.reverse ? [...def.points].reverse() : def.points;
	const n = pts.length;
	const point = (i) =>
		closed ? pts[(i + n) % n] : pts[Math.min(Math.max(i, 0), n - 1)];

	// Dense spline, then resampled every metre along its length. An open track ends at its last
	// point; a closed one comes back to its first.
	const dense = [];
	for (let i = 0; i < (closed ? n : n - 1); i++) {
		const p0 = point(i - 1);
		const p1 = point(i);
		const p2 = point(i + 1);
		const p3 = point(i + 2);
		for (let k = 0; k < 60; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 60));
	}
	dense.push(closed ? dense[0] : pts[n - 1]);
	const lengths = [0];
	for (let i = 1; i < dense.length; i++) {
		lengths.push(
			lengths[i - 1] +
				Math.hypot(
					dense[i][0] - dense[i - 1][0],
					dense[i][1] - dense[i - 1][1],
				),
		);
	}
	const length = lengths[lengths.length - 1];
	// A closed track's last sample is a metre short of its first; an open one has both ends
	const count = closed ? Math.floor(length) : Math.floor(length) + 1;
	const intervals = closed ? count : count - 1;
	const centerline = [];
	let j = 0;
	for (let k = 0; k < count; k++) {
		const s = (k * length) / intervals;
		while (j < lengths.length - 2 && lengths[j + 1] < s) j++;
		const t = (s - lengths[j]) / (lengths[j + 1] - lengths[j]);
		const a = dense[j];
		const b = dense[j + 1];
		centerline.push({
			s,
			x: a[0] + (b[0] - a[0]) * t,
			z: a[1] + (b[1] - a[1]) * t,
			y: a[2] + (b[2] - a[2]) * t,
		});
	}
	const sample = (k) =>
		closed
			? centerline[((k % count) + count) % count]
			: centerline[Math.min(Math.max(k, 0), count - 1)];
	for (let k = 0; k < count; k++) {
		const a = sample(k - 1);
		const b = sample(k + 1);
		const d = Math.hypot(b.x - a.x, b.z - a.z);
		centerline[k].tx = (b.x - a.x) / d;
		centerline[k].tz = (b.z - a.z) / d;
	}

	const nearestIndex = (x, z) => {
		let best = 0;
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = 0; k < count; k++) {
			const d = (centerline[k].x - x) ** 2 + (centerline[k].z - z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = k;
			}
		}
		return best;
	};
	const at = (s) => centerline[((Math.round(s) % count) + count) % count];

	// The bump section is level, so the bumps sit on a flat road
	const hasBumps = def.bumps.length > 0;
	const bumpStart = hasBumps
		? nearestIndex(def.bumpSection[0], def.bumpSection[1])
		: 0;
	const bumpEnd = hasBumps
		? bumpStart +
			Math.max(
				...def.bumps.map(
					(b) => b.at + (b.count ?? 1) * (b.spacing ?? 0) + b.length,
				),
			) +
			10
		: 0;
	const flatY = centerline[bumpStart].y;
	for (let k = bumpStart - 15; hasBumps && k <= bumpEnd + 15; k++) {
		const c = centerline[((k % count) + count) % count];
		const w = Math.min(
			smoothstep(bumpStart - 15, bumpStart, k),
			1 - smoothstep(bumpEnd, bumpEnd + 15, k),
		);
		c.y += (flatY - c.y) * w;
	}

	// Spatial hash of the centreline for the terrain queries
	const bucket = 10;
	const grid = new Map();
	const key = (gx, gz) => gx * 65536 + gz;
	for (const c of centerline) {
		const k = key(Math.floor(c.x / bucket), Math.floor(c.z / bucket));
		if (!grid.has(k)) grid.set(k, []);
		grid.get(k).push(c);
	}
	const near = (x, z, radius) => {
		const out = [];
		const r = Math.ceil(radius / bucket);
		const gx = Math.floor(x / bucket);
		const gz = Math.floor(z / bucket);
		for (let ix = -r; ix <= r; ix++) {
			for (let iz = -r; iz <= r; iz++) {
				for (const c of grid.get(key(gx + ix, gz + iz)) ?? []) out.push(c);
			}
		}
		return out;
	};

	/** Distance to the centreline and the road height there */
	function roadAt(x, z) {
		let best = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const c of near(x, z, 40)) {
			// Distance to the segment towards the next sample, so the road edge is smooth
			const dx = x - c.x;
			const dz = z - c.z;
			const along = Math.max(-0.5, Math.min(0.5, dx * c.tx + dz * c.tz));
			const d = Math.hypot(dx - along * c.tx, dz - along * c.tz);
			if (d < bestD) {
				bestD = d;
				best = c;
			}
		}
		return best ? { distance: bestD, y: best.y, sample: best } : null;
	}

	// Height field covering the track with a 60 m margin
	const cell = 2;
	const margin = 80;
	const xs = centerline.map((c) => c.x);
	const zs = centerline.map((c) => c.z);
	const x0 = Math.floor((Math.min(...xs) - margin) / cell) * cell;
	const z0 = Math.floor((Math.min(...zs) - margin) / cell) * cell;
	const countX = Math.ceil((Math.max(...xs) + margin - x0) / cell) + 1;
	const countZ = Math.ceil((Math.max(...zs) + margin - z0) / cell) + 1;
	const half = def.width / 2;
	// A paved road sits `sink` above the terrain under it, and its edges ease down to the terrain
	// over `ramp` metres; the landscape blends in beyond that
	const sink = def.road?.sink ?? 0;
	const ramp = def.road?.ramp ?? 0;
	const verge = half + ramp;
	const seed = name.length;
	// The landscape follows the road's elevation nearby: a Gaussian weighted average of the
	// centreline heights, fading to ground level far from the road. Computed on a coarse grid
	// and interpolated, since it only varies over tens of metres.
	const coarse = 4;
	const cx = Math.ceil((countX * cell) / coarse) + 2;
	const cz = Math.ceil((countZ * cell) / coarse) + 2;
	const baseGrid = new Float32Array(cx * cz);
	// Near the road a narrow average follows it closely; further out it hands over to a wide one,
	// so the land never drops away where the narrow average runs out of road. Past 4 far spreads
	// from any road the land falls to height 0. A track with land far from its road (a mountain
	// pass) sets a wider far spread, and its land falls to the mean road height instead.
	const nearSpread = 12;
	const farSpread = def.farSpread ?? 40;
	const reach = 4 * farSpread;
	const farFloor = def.farSpread
		? centerline.reduce((sum, c) => sum + c.y, 0) / count
		: 0;
	for (let iz = 0; iz < cz; iz++) {
		const z = z0 + iz * coarse;
		// Only samples within reach of this row can count; the order stays the centreline's, so
		// the sums come out the same as over the whole line
		const band = centerline.filter((c) => Math.abs(c.z - z) <= reach);
		for (let ix = 0; ix < cx; ix++) {
			const x = x0 + ix * coarse;
			let wn = 0;
			let yn = 0;
			let wf = 1e-3;
			let yf = 1e-3 * farFloor;
			for (const c of band) {
				const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
				if (d2 > 16 * farSpread * farSpread) continue;
				const w = Math.exp(-d2 / (2 * farSpread * farSpread));
				wf += w;
				yf += w * c.y;
				if (d2 < 16 * nearSpread * nearSpread) {
					const v = Math.exp(-d2 / (2 * nearSpread * nearSpread));
					wn += v;
					yn += v * c.y;
				}
			}
			baseGrid[iz * cx + ix] = (yn + 0.3 * (yf / wf)) / (wn + 0.3);
		}
	}
	const baseAt = (x, z) => {
		const fx = (x - x0) / coarse;
		const fz = (z - z0) / coarse;
		const ix = Math.min(Math.floor(fx), cx - 2);
		const iz = Math.min(Math.floor(fz), cz - 2);
		const tx = fx - ix;
		const tz = fz - iz;
		const g = (i, k) => baseGrid[(iz + k) * cx + ix + i];
		return (
			(g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - tz) +
			(g(0, 1) * (1 - tx) + g(1, 1) * tx) * tz
		);
	};
	// 1 along the bump section, easing to 0 over 5 m beyond each end
	const sectionFrom = centerline[bumpStart % centerline.length].s;
	const sectionLength = bumpEnd - bumpStart;
	const inBumpSection = (s) => {
		const d = (((s - sectionFrom) % length) + length) % length;
		const outside =
			d <= sectionLength ? 0 : Math.min(d - sectionLength, length - d);
		return 1 - smoothstep(0, 5, outside);
	};
	const heights = new Array(countX * countZ);
	for (let iz = 0; iz < countZ; iz++) {
		for (let ix = 0; ix < countX; ix++) {
			const x = x0 + ix * cell;
			const z = z0 + iz * cell;
			const base = baseAt(x, z);
			const road = roadAt(x, z);
			const d = road ? road.distance : Number.POSITIVE_INFINITY;
			const away = smoothstep(
				verge + def.shoulder,
				verge + def.shoulder + 30,
				d,
			);
			const land = base + def.hills * hills(x, z, seed) * away;
			const onRoad = 1 - smoothstep(verge, verge + def.shoulder, d);
			const roadY = road ? road.y - sink : land;
			let h = land + (roadY - land) * onRoad;
			// Loose surface: small irregularities everywhere off the bump section, which stays flat
			// under the bump hulls
			if (def.roughness > 0) {
				const flat = road ? onRoad * inBumpSection(road.sample.s) : 0;
				h +=
					(1 - flat) *
					def.roughness *
					Math.sin(x * 1.7 + z * 0.9) *
					Math.sin(z * 1.3 - x * 0.6);
			}
			// The land rises 12 m into a bank around the edge of the field, so nothing drives off it
			const edge = Math.min(ix, iz, countX - 1 - ix, countZ - 1 - iz) * cell;
			h += 12 * (1 - smoothstep(0, 30, edge));
			heights[iz * countX + ix] = h;
		}
	}

	/** The height field's surface at (x, z), on the same triangles the physics and the art use */
	function groundAt(x, z) {
		const fx = Math.min(Math.max((x - x0) / cell, 0), countX - 1.001);
		const fz = Math.min(Math.max((z - z0) / cell, 0), countZ - 1.001);
		const ix = Math.floor(fx);
		const iz = Math.floor(fz);
		const u = fx - ix;
		const v = fz - iz;
		const h = (i, k) => heights[(iz + k) * countX + ix + i];
		// Each cell is split along the diagonal from (1, 0) to (0, 1)
		if (u + v <= 1)
			return h(0, 0) + (h(1, 0) - h(0, 0)) * u + (h(0, 1) - h(0, 0)) * v;
		return (
			h(1, 1) + (h(0, 1) - h(1, 1)) * (1 - u) + (h(1, 0) - h(1, 1)) * (1 - v)
		);
	}

	// The paved road: flat across at the centreline's height, then easing down past each edge to
	// 3 cm under the terrain, level where it leaves the road and where it meets the ground. Each
	// sample has a row of points across it; `verge` is 0 on the road and rises to 1 at the outer
	// edge of the ramp. On a mountain pass the ground beside the ramp can be a cliff down to the
	// leg below (the height field's 2 m cells smear it toward the road), so there the ramp stops a
	// metre down rather than following it.
	// In a hairpin tighter than the verge, the rows across the inside would cross each other and
	// fold the mesh over, so on the inside of a corner no point goes further out than 85% of the
	// tightest radius within 3 m.
	const reachInside = innerReach(centerline, closed);
	let roadMesh = null;
	if (def.road) {
		const steps = [0, 0.25, 0.5, 0.75, 1];
		// [side, t, f]: f × half out to the road edge, then t of the ramp. Each row is level across
		// and turns with the road, so on a graded corner two rows are level lines at different
		// heights and headings, and the quad between them twists: its triangles meet at a crease a
		// few millimetres high, which the dampers feel as chatter. `strips` splits the road across
		// into that many equal quads, and the crease shrinks with the square of their width. Every
		// split is also a seam along the road that a chassis touching down can snag on, most of all
		// one down the middle where a car lands, so an odd count (no centre seam) suits a track
		// with jumps.
		const strips = def.road.strips ?? 1;
		const inside = [];
		for (let k = 1; k < strips; k++) {
			const w = -1 + (2 * k) / strips;
			inside.push([Math.sign(w) || 1, 0, Math.abs(w)]);
		}
		const across = [
			...[...steps].reverse().map((t) => [-1, t, 1]),
			...inside,
			...steps.map((t) => [1, t, 1]),
		];
		const positions = [];
		const vergeAmount = [];
		for (let i = 0; i < count; i++) {
			const c = centerline[i];
			// Left of the direction of travel is +x when it is +z, so the normal is (tz, -tx)
			const out = (side, w) => Math.min(w, reachInside(i, side));
			const ends = [-1, 1].map((side) =>
				Math.max(
					groundAt(
						c.x + c.tz * side * out(side, verge),
						c.z - c.tx * side * out(side, verge),
					) - 0.03,
					c.y - 1,
				),
			);
			for (const [side, t, f] of across) {
				const w = side * out(side, f * half + ramp * t);
				const end = ends[side < 0 ? 0 : 1];
				positions.push(
					c.x + c.tz * w,
					c.y + (end - c.y) * smoothstep(0, 1, t),
					c.z - c.tx * w,
				);
				vergeAmount.push(t);
			}
		}
		const m = across.length;
		const indices = [];
		for (let i = 0; i < (closed ? count : count - 1); i++) {
			const next = ((i + 1) % count) * m;
			for (let j = 0; j < m - 1; j++) {
				const a = i * m + j;
				const b = next + j;
				// Wound counter-clockwise seen from above, so the faces point up
				indices.push(a, b, a + 1, a + 1, b, b + 1);
			}
		}
		roadMesh = { positions, indices, verge: vergeAmount };
	}

	// Bumps: convex hulls across the road at the flat section's height
	const bumps = [];
	const sampleProfile = (kind, len, height) => {
		const out = [];
		const steps = 12;
		for (let k = 0; k <= steps; k++) {
			const u = -len / 2 + (k / steps) * len;
			out.push([u, profiles[kind](u, len, height)]);
		}
		return out;
	};
	for (const b of def.bumps) {
		for (let r = 0; r < (b.count ?? 1); r++) {
			const c = at(bumpStart + b.at + r * (b.spacing ?? 0) + b.length / 2);
			const yaw = Math.atan2(c.tx, c.tz);
			const points = [];
			for (const [u, h] of sampleProfile(b.kind, b.length, b.height)) {
				// Local frame: z along the road, x across it, y up. The full profile spans the road
				// and the base sits 5 cm under the ground beside it so the bump is seated; past each
				// edge the bump ramps down over 2.5 m, so a car rejoining from the verge meets a
				// slope, not a wall.
				for (const w of [-half, half]) points.push(w, h, u);
				for (const w of [-half - 2.5, half + 2.5])
					points.push(w, -0.05 - sink, u);
			}
			bumps.push({
				kind: b.kind,
				label: b.label,
				height: b.height,
				length: b.length,
				position: [c.x, flatY, c.z],
				yaw,
				points,
			});
		}
	}

	// Guardrails along each side where the ground a few metres past the road edge sits more than
	// `rails.drop` above or below the road: the cliffs and banks between the stacked legs of a
	// mountain pass. Each stretch grows 8 m both ways, gaps under 20 m close and stretches under
	// 15 m go, so the rails run in whole lengths. Open tracks only: a stretch does not wrap.
	const rails = [];
	if (def.rails) {
		const probes = [
			verge + 2,
			verge + def.shoulder / 2,
			verge + def.shoulder + 4,
		];
		const offset = half + 0.6;
		for (const side of [-1, 1]) {
			const need = centerline.map((c) =>
				probes.some(
					(d) =>
						Math.abs(
							groundAt(c.x + c.tz * side * d, c.z - c.tx * side * d) - c.y,
						) > def.rails.drop,
				),
			);
			const grown = need.map((_, i) => {
				for (let k = Math.max(0, i - 8); k <= Math.min(count - 1, i + 8); k++) {
					if (need[k]) return true;
				}
				return false;
			});
			let runs = [];
			for (let i = 0; i < count; i++) {
				// Not round the inside of a hairpin, where the rail line would cross itself
				if (!grown[i] || reachInside(i, side) < offset + 1) continue;
				const last = runs[runs.length - 1];
				if (last && i - last[1] < 20) last[1] = i;
				else runs.push([i, i]);
			}
			runs = runs.filter(([a, b]) => b - a >= 15);
			for (const [a, b] of runs) {
				const points = [];
				for (let i = a; i <= b; i += 2) {
					const c = centerline[Math.min(i, b)];
					points.push(
						c.x + c.tz * side * offset,
						c.y,
						c.z - c.tx * side * offset,
					);
				}
				rails.push({ side, from: a, to: b, points });
			}
		}
	}

	const pose = (c) => ({
		position: [c.x, c.y, c.z],
		yaw: Math.atan2(c.tx, c.tz),
		s: c.s,
	});
	const s0 = closed
		? at(nearestIndex(def.start[0], def.start[1]))
		: centerline[Math.round(def.run.start)];
	return {
		name,
		title: def.title,
		surface: def.surface,
		width: def.width,
		closed,
		length,
		centerline,
		bumpSection: hasBumps ? { from: bumpStart, to: bumpEnd } : null,
		field: { heights, countX, countZ, cell, origin: [x0, z0] },
		road: roadMesh,
		bumps,
		rails,
		start: pose(s0),
		finish: closed
			? null
			: pose(centerline[count - 1 - Math.round(def.run.finish)]),
		roadAt,
		groundAt,
	};
}

/**
 * Creates the track's static bodies: the terrain height field, the road mesh (on a paved track)
 * and the bump hulls. The height field and mesh data outlive the world: free them with
 * `b3DestroyHeightField(field)` and `b3DestroyMesh(mesh)` after destroying it.
 */
export function createRaceTrackBodies(b3, world, track) {
	const { heights, countX, countZ, cell, origin } = track.field;
	const field = b3.b3CreateHeightField(heights, countX, countZ, [
		cell,
		1,
		cell,
	]);
	const groundDef = b3.b3DefaultBodyDef();
	groundDef.position = [origin[0], 0, origin[1]];
	const ground = b3.b3CreateBody(world, groundDef);
	b3.b3CreateHeightFieldShape(ground, b3.b3DefaultShapeDef(), field);
	let road = null;
	let mesh = null;
	if (track.road) {
		mesh = b3.b3CreateMesh(
			new Float32Array(track.road.positions),
			new Uint32Array(track.road.indices),
		);
		road = b3.b3CreateBody(world, b3.b3DefaultBodyDef());
		// Flush on the surface, so the wheels sit where the road is drawn
		const shapeDef = b3.b3DefaultShapeDef();
		shapeDef.meshRestOffset = 0;
		b3.b3CreateMeshShape(road, shapeDef, mesh, [1, 1, 1]);
	}
	const bumpBodies = [];
	for (const bump of track.bumps) {
		const def = b3.b3DefaultBodyDef();
		def.position = bump.position;
		const s = Math.sin(bump.yaw / 2);
		def.rotation = [0, s, 0, Math.cos(bump.yaw / 2)];
		const body = b3.b3CreateBody(world, def);
		const hull = b3.b3CreateHull(bump.points);
		b3.b3CreateHullShape(body, b3.b3DefaultShapeDef(), hull);
		b3.b3DestroyHull(hull);
		bumpBodies.push(body);
	}
	// Guardrails: a thin wall per 2 m of rail, from under the verge to 0.9 m above the road, its
	// inner face on the rail line
	let rails = null;
	if (track.rails.length) {
		rails = b3.b3CreateBody(world, b3.b3DefaultBodyDef());
		const railDef = b3.b3DefaultShapeDef();
		railDef.filter = { ...railDef.filter, categoryBits: railCategory };
		// Slippery, so a car that meets a rail at an angle slides along it rather than stopping dead
		railDef.baseMaterial = { ...railDef.baseMaterial, friction: 0.1 };
		for (const rail of track.rails) {
			const p = rail.points;
			for (let i = 0; i + 5 < p.length; i += 3) {
				// Outward, away from the road: the left normal (dz, -dx) on the left side (+1)
				const dx = p[i + 3] - p[i];
				const dz = p[i + 5] - p[i + 2];
				const len = Math.hypot(dx, dz);
				if (len < 1e-3) continue;
				const ox = ((rail.side * dz) / len) * railThickness;
				const oz = ((-rail.side * dx) / len) * railThickness;
				const points = [];
				for (const k of [i, i + 3]) {
					for (const [x, z] of [
						[p[k], p[k + 2]],
						[p[k] + ox, p[k + 2] + oz],
					]) {
						points.push(x, p[k + 1] - 0.6, z, x, p[k + 1] + railHeight, z);
					}
				}
				const hull = b3.b3CreateHull(points);
				b3.b3CreateHullShape(rails, railDef, hull);
				b3.b3DestroyHull(hull);
			}
		}
	}
	// Invisible walls just inside the edge of the field, behind the bank
	const width = (countX - 1) * cell;
	const depth = (countZ - 1) * cell;
	let top = 0;
	for (const h of heights) top = Math.max(top, h);
	top += 20;
	const walls = [];
	for (const [cx, cz, hx, hz] of [
		[origin[0] + 5, origin[1] + depth / 2, 1, depth / 2],
		[origin[0] + width - 5, origin[1] + depth / 2, 1, depth / 2],
		[origin[0] + width / 2, origin[1] + 5, width / 2, 1],
		[origin[0] + width / 2, origin[1] + depth - 5, width / 2, 1],
	]) {
		const def = b3.b3DefaultBodyDef();
		def.position = [cx, 0, cz];
		const wall = b3.b3CreateBody(world, def);
		b3.b3CreateBoxShape(wall, b3.b3DefaultShapeDef(), hx, top, hz);
		walls.push(wall);
	}
	return { ground, road, bumpBodies, rails, walls, field, mesh };
}
