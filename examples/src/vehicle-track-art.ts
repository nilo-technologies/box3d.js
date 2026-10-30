// Minimal topographic look for the vehicle examples: warm paper tones, terrain shaded by height
// and slope with contour lines every 2 m, a flat background, dark roads with thin white edges and coral
// accents. On the race tracks the road is its own ribbon mesh along the track's spline, so its
// edges and lines are crisp instead of following the 2 m terrain grid.

import * as THREE from 'three';
import type { RaceTrack } from './vehicle-tracks';

export const topo = {
	fog: 0xf1ece2,
	/** Ground from low to high */
	ground: [0xe9e1cf, 0xf4efe3] as const,
	/** Ramps, hills, rocks and bumps: a shade darker than the ground */
	solid: 0xddd2bb,
	contour: 0xc4b391,
	contourSpacing: 2,
	asphalt: 0x5a5a5a,
	gravel: 0x8c7a5b,
	line: 0xffffff,
	accent: 0xe07a5f,
};

const sunPosition = new THREE.Vector3(200, 75, 120);

/** Flat background, fog and a low sun. The scene's default lights go dark. */
export function applyTopoAtmosphere(
	scene: THREE.Scene,
	fogNear = 150,
	fogFar = 650,
): void {
	scene.traverse((o) => {
		if (o instanceof THREE.AmbientLight || o instanceof THREE.DirectionalLight)
			o.intensity = 0;
	});
	// No sky: one flat tone that the fog fades the land into
	scene.background = new THREE.Color(topo.fog);
	scene.fog = new THREE.Fog(topo.fog, fogNear, fogFar);
	// A low sun rakes across the ground so bumps and slopes cast clear shading
	scene.add(new THREE.HemisphereLight(topo.fog, topo.ground[0], 0.55));
	const sun = new THREE.DirectionalLight(0xffffff, 1.0);
	sun.position.copy(sunPosition);
	scene.add(sun);
}

/**
 * A matte material with contour lines at every `contourSpacing` metres of world height, drawn
 * in the fragment shader so they stay thin at any distance
 */
export function topoMaterial(
	options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
	const material = new THREE.MeshStandardMaterial({ roughness: 1, ...options });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.contourColor = { value: new THREE.Color(topo.contour) };
		shader.uniforms.contourSpacing = { value: topo.contourSpacing };
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying float vHeight;\nvarying float vUp;',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvHeight = (modelMatrix * vec4(position, 1.0)).y;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying float vHeight;\nvarying float vUp;\nuniform vec3 contourColor;\nuniform float contourSpacing;',
			)
			.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
	// Offset so flat ground at a whole metre height (the test track's floor) is not a line
	float f = vHeight / contourSpacing + 0.37;
	// fwidth is 0 on perfectly flat ground, and smoothstep(0, 0, x) is undefined
	float w = max(fwidth(f), 1e-4);
	float line = 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(f - 0.5) - 0.5));
	gl_FragColor.rgb = mix(gl_FragColor.rgb, contourColor, line * 0.8);
	// Hillshade: steeper ground a little darker, so slopes read even in flat light
	gl_FragColor.rgb *= 1.0 - 0.35 * smoothstep(0.02, 0.5, 1.0 - vUp);`,
			);
	};
	// The shader edit is the same for every topo material, so they can share one program
	material.customProgramCacheKey = () => 'topo-contours';
	return material;
}

/** Vertex colours for a terrain: the ground tone from low to high */
export function heightColors(heights: ArrayLike<number>): Float32Array {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < heights.length; i++) {
		lo = Math.min(lo, heights[i]);
		hi = Math.max(hi, heights[i]);
	}
	const low = new THREE.Color(topo.ground[0]);
	const high = new THREE.Color(topo.ground[1]);
	const color = new THREE.Color();
	const colors = new Float32Array(heights.length * 3);
	for (let i = 0; i < heights.length; i++) {
		color.copy(low).lerp(high, (heights[i] - lo) / (hi - lo + 1e-6));
		colors[i * 3] = color.r;
		colors[i * 3 + 1] = color.g;
		colors[i * 3 + 2] = color.b;
	}
	return colors;
}

/** Matte paint for road surfaces and lines, drawn over the terrain with a depth offset */
export function overlayMaterial(color: number): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.9,
		side: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2,
	});
}

/** A strip following the centreline between two lateral offsets, lifted above the terrain */
function ribbon(
	track: RaceTrack,
	from: number,
	to: number,
	lift: number,
	only?: (s: number) => boolean,
): THREE.BufferGeometry {
	const line = track.centerline;
	const positions: number[] = [];
	const indices: number[] = [];
	const n = line.length;
	let open = false;
	for (let i = 0; i <= n; i++) {
		const c = line[i % n];
		if (only && !only(c.s)) {
			open = false;
			continue;
		}
		// Left of the direction of travel is +x when it is +z, so the normal is (tz, -tx)
		const base = positions.length / 3;
		positions.push(
			c.x + c.tz * from,
			c.y + lift,
			c.z - c.tx * from,
			c.x + c.tz * to,
			c.y + lift,
			c.z - c.tx * to,
		);
		if (open) indices.push(base - 2, base, base - 1, base - 1, base, base + 1);
		open = true;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

/**
 * A bump's visible surface: the same shape as its convex hull (the upper outline of the profile
 * across the road, ramping down to the base beyond each edge), as a fine grid with smooth normals
 */
function bumpGeometry(points: number[], half: number): THREE.BufferGeometry {
	// The profile along the road from the hull's top points at the road edge
	const profile: [number, number][] = [];
	for (let k = 0; k < points.length; k += 3) {
		if (Math.abs(points[k] - half) < 1e-4 && points[k + 1] >= 0) {
			profile.push([points[k + 2], points[k + 1]]);
		}
	}
	profile.sort((a, b) => a[0] - b[0]);
	// Its upper convex hull, which is what the physics hull follows
	const hull: [number, number][] = [];
	for (const p of profile) {
		while (hull.length >= 2) {
			const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]];
			if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0)
				hull.pop();
			else break;
		}
		hull.push(p);
	}
	// Densify so the shading interpolates smoothly along it
	const along: [number, number][] = [];
	for (let i = 0; i < hull.length - 1; i++) {
		for (let k = 0; k < 4; k++) {
			const t = k / 4;
			along.push([
				hull[i][0] + (hull[i + 1][0] - hull[i][0]) * t,
				hull[i][1] + (hull[i + 1][1] - hull[i][1]) * t,
			]);
		}
	}
	along.push(hull[hull.length - 1]);
	const ramp = 2.5;
	const across = [
		-half - ramp,
		-half - ramp / 2,
		-half,
		0,
		half,
		half + ramp / 2,
		half + ramp,
	];
	const positions: number[] = [];
	for (const [u, h] of along) {
		for (const w of across) {
			const edge = Math.max(0, Math.abs(w) - half) / ramp;
			positions.push(w, -0.05 + (h + 0.05) * (1 - edge), u);
		}
	}
	const indices: number[] = [];
	const m = across.length;
	for (let i = 0; i < along.length - 1; i++) {
		for (let j = 0; j < m - 1; j++) {
			const a = i * m + j;
			// Wound counter-clockwise seen from above, so the faces and normals point up
			indices.push(a, a + m, a + 1, a + 1, a + m, a + m + 1);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

/** The race track's terrain, road, start line, bumps and start gate */
export function addRaceTrackArt(
	scene: THREE.Scene,
	track: RaceTrack,
): THREE.Group {
	const group = new THREE.Group();
	scene.add(group);

	// Terrain: the height field's own vertices with smooth normals
	const { heights, countX, countZ, cell, origin } = track.field;
	const positions = new Float32Array(countX * countZ * 3);
	for (let i = 0; i < countX * countZ; i++) {
		positions[i * 3] = origin[0] + (i % countX) * cell;
		positions[i * 3 + 1] = heights[i];
		positions[i * 3 + 2] = origin[1] + Math.floor(i / countX) * cell;
	}
	const indices: number[] = [];
	for (let iz = 0; iz < countZ - 1; iz++) {
		for (let ix = 0; ix < countX - 1; ix++) {
			const a = iz * countX + ix;
			indices.push(a, a + countX, a + 1, a + 1, a + countX, a + countX + 1);
		}
	}
	const terrain = new THREE.BufferGeometry();
	terrain.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	terrain.setAttribute(
		'color',
		new THREE.BufferAttribute(heightColors(heights), 3),
	);
	terrain.setIndex(indices);
	terrain.computeVertexNormals();
	group.add(new THREE.Mesh(terrain, topoMaterial({ vertexColors: true })));

	// Road, edge lines and start line
	const half = track.width / 2;
	const paved = track.surface === 'asphalt';
	group.add(
		new THREE.Mesh(
			ribbon(track, -half, half, 0.05),
			overlayMaterial(paved ? topo.asphalt : topo.gravel),
		),
	);
	const line = overlayMaterial(topo.line);
	for (const side of [-1, 1]) {
		const a = side * (half - 0.35);
		group.add(new THREE.Mesh(ribbon(track, a, a - side * 0.18, 0.07), line));
	}
	const startS = track.start.s;
	const nearStart = (s: number) => {
		const d = (((s - startS) % track.length) + track.length) % track.length;
		return Math.min(d, track.length - d) <= 1;
	};
	group.add(new THREE.Mesh(ribbon(track, -half, half, 0.08, nearStart), line));

	// Bumps in the accent colour, lifted with the road so even the small ones show, with smooth
	// normals so the low sun shades their shape
	const bumpMaterial = new THREE.MeshStandardMaterial({
		color: topo.accent,
		roughness: 0.85,
		polygonOffset: true,
		polygonOffsetFactor: -3,
		polygonOffsetUnits: -3,
	});
	// Even the big hump slopes only about 10 degrees, which plain lighting barely shows, so the
	// shading is exaggerated: faces tilted toward the sun brighten and faces tilted away darken
	bumpMaterial.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vSlope;')
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvSlope = normalize(mat3(modelMatrix) * objectNormal);',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vSlope;')
			.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
	float tilt = dot(normalize(vSlope).xz, normalize(vec2(${sunPosition.x}, ${sunPosition.z})));
	gl_FragColor.rgb *= clamp(1.0 + 4.0 * tilt, 0.45, 1.6);`,
			);
	};
	for (const bump of track.bumps) {
		const mesh = new THREE.Mesh(bumpGeometry(bump.points, half), bumpMaterial);
		mesh.position.set(
			bump.position[0],
			bump.position[1] + 0.05,
			bump.position[2],
		);
		mesh.rotation.y = bump.yaw;
		group.add(mesh);
	}

	// A thin start gate over the start line
	const gate = new THREE.Group();
	const frame = new THREE.MeshStandardMaterial({
		color: topo.asphalt,
		roughness: 0.9,
	});
	const span = half + 1.5;
	for (const side of [-1, 1]) {
		const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 0.2), frame);
		pole.position.set(side * span, 2.5, 0);
		gate.add(pole);
	}
	const banner = new THREE.Mesh(
		new THREE.BoxGeometry(span * 2, 0.5, 0.12),
		new THREE.MeshStandardMaterial({ color: topo.accent, roughness: 0.9 }),
	);
	banner.position.set(0, 4.9, 0);
	gate.add(banner);
	gate.position.set(...track.start.position);
	gate.rotation.y = track.start.yaw;
	group.add(gate);
	return group;
}
