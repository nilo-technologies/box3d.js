// Race tracks for the vehicle examples: a paved circuit and an off-road stage. Plain JS so Node
// tests can build the same physics as the examples; types live in vehicle-tracks.d.ts.
//
// Each track is a closed Catmull-Rom spline through control points [x, z, elevation]. The
// spline is resampled every metre, and the terrain is a height field: flat across the road at
// the centreline's elevation, blending over the shoulder into a landscape that follows the
// road's elevation plus some hills. Bumps are separate convex hull bodies laid across the road
// along a straight bump section, so their shape is exact rather than limited by the height
// field's grid.

const TAU = Math.PI * 2;

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
};

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

const smoothstep = (e0, e1, x) => {
	const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Builds a track's centreline, terrain heights, bump hulls and start pose */
export function buildRaceTrack(name) {
	const def = raceTracks[name];
	const pts = def.points;
	const n = pts.length;

	// Dense spline, then resampled every metre along its length
	const dense = [];
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n];
		const p1 = pts[i];
		const p2 = pts[(i + 1) % n];
		const p3 = pts[(i + 2) % n];
		for (let k = 0; k < 60; k++) dense.push(catmullRom(p0, p1, p2, p3, k / 60));
	}
	dense.push(dense[0]);
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
	const count = Math.floor(length);
	const centerline = [];
	let j = 0;
	for (let k = 0; k < count; k++) {
		const s = (k * length) / count;
		while (lengths[j + 1] < s) j++;
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
	for (let k = 0; k < count; k++) {
		const a = centerline[(k - 1 + count) % count];
		const b = centerline[(k + 1) % count];
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
	const bumpStart = nearestIndex(def.bumpSection[0], def.bumpSection[1]);
	const bumpEnd =
		bumpStart +
		Math.max(
			...def.bumps.map(
				(b) => b.at + (b.count ?? 1) * (b.spacing ?? 0) + b.length,
			),
		) +
		10;
	const flatY = centerline[bumpStart].y;
	for (let k = bumpStart - 15; k <= bumpEnd + 15; k++) {
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
	const key = (gx, gz) => `${gx},${gz}`;
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
	const seed = name.length;
	// The landscape follows the road's elevation nearby: a Gaussian weighted average of the
	// centreline heights, fading to ground level far from the road. Computed on a coarse grid
	// and interpolated, since it only varies over tens of metres.
	const coarse = 4;
	const cx = Math.ceil((countX * cell) / coarse) + 2;
	const cz = Math.ceil((countZ * cell) / coarse) + 2;
	const baseGrid = new Float32Array(cx * cz);
	// Near the road a narrow average follows it closely; further out it hands over to a wide one,
	// so the land never drops away where the narrow average runs out of road
	const nearSpread = 12;
	const farSpread = 40;
	for (let iz = 0; iz < cz; iz++) {
		for (let ix = 0; ix < cx; ix++) {
			const x = x0 + ix * coarse;
			const z = z0 + iz * coarse;
			let wn = 0;
			let yn = 0;
			let wf = 1e-3;
			let yf = 0;
			for (const c of centerline) {
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
	const heights = new Array(countX * countZ);
	for (let iz = 0; iz < countZ; iz++) {
		for (let ix = 0; ix < countX; ix++) {
			const x = x0 + ix * cell;
			const z = z0 + iz * cell;
			const base = baseAt(x, z);
			const road = roadAt(x, z);
			const d = road ? road.distance : Number.POSITIVE_INFINITY;
			const away = smoothstep(half + def.shoulder, half + def.shoulder + 30, d);
			const land = base + def.hills * hills(x, z, seed) * away;
			const onRoad = 1 - smoothstep(half, half + def.shoulder, d);
			const roadY = road ? road.y : land;
			let h = land + (roadY - land) * onRoad;
			// Loose surface: small irregularities everywhere off the bump section
			if (def.roughness > 0) {
				h +=
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
				// and the base sits 5 cm under it so the bump is seated; past each edge the bump ramps
				// down over 2.5 m, so a car rejoining from the verge meets a slope, not a wall.
				for (const w of [-half, half]) points.push(w, h, u);
				for (const w of [-half - 2.5, half + 2.5]) points.push(w, -0.05, u);
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

	const s0 = at(nearestIndex(def.start[0], def.start[1]));
	return {
		name,
		title: def.title,
		surface: def.surface,
		width: def.width,
		length,
		centerline,
		bumpSection: { from: bumpStart, to: bumpEnd },
		field: { heights, countX, countZ, cell, origin: [x0, z0] },
		bumps,
		start: {
			position: [s0.x, s0.y, s0.z],
			yaw: Math.atan2(s0.tx, s0.tz),
			s: s0.s,
		},
		roadAt,
	};
}

/** Creates the track's static bodies: the terrain height field and the bump hulls */
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
	// Invisible walls just inside the edge of the field, behind the bank
	const width = (countX - 1) * cell;
	const depth = (countZ - 1) * cell;
	const top = Math.max(...heights) + 20;
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
	return { ground, bumpBodies, walls };
}
