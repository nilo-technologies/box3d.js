// Minimal topographic look for the vehicle examples: warm paper tones, terrain shaded by height
// with contour lines every 2 m, a soft sky gradient, dark roads with thin white edges and coral
// accents. On the race tracks the road is its own ribbon mesh along the track's spline, so its
// edges and lines are crisp instead of following the 2 m terrain grid.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { RaceTrack } from './vehicle-tracks';

export const topo = {
	sky: [0xeee8dc, 0xf7f4ec] as const,
	fog: 0xf1ece2,
	/** Ground from low to high */
	ground: [0xe9e1cf, 0xf4efe3] as const,
	/** Ramps, hills, rocks and bumps: a shade darker than the ground */
	solid: 0xddd2bb,
	contour: 0xc4b391,
	contourSpacing: 2,
	asphalt: 0x3c3c3c,
	gravel: 0x8c7a5b,
	line: 0xffffff,
	accent: 0xe07a5f,
};

/** Sky gradient, fog and soft lights. The scene's default lights go dark. */
export function applyTopoAtmosphere(
	scene: THREE.Scene,
	fogNear = 150,
	fogFar = 650,
): void {
	scene.traverse((o) => {
		if (o instanceof THREE.AmbientLight || o instanceof THREE.DirectionalLight)
			o.intensity = 0;
	});
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 256;
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
	const gradient = ctx.createLinearGradient(0, 0, 0, 256);
	const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
	gradient.addColorStop(0, hex(topo.sky[0]));
	gradient.addColorStop(1, hex(topo.sky[1]));
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 2, 256);
	const sky = new THREE.CanvasTexture(canvas);
	sky.colorSpace = THREE.SRGBColorSpace;
	scene.background = sky;
	scene.fog = new THREE.Fog(topo.fog, fogNear, fogFar);
	scene.add(new THREE.HemisphereLight(topo.sky[0], topo.ground[0], 0.8));
	const sun = new THREE.DirectionalLight(0xffffff, 0.6);
	sun.position.set(120, 200, 80);
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
			.replace('#include <common>', '#include <common>\nvarying float vHeight;')
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvHeight = (modelMatrix * vec4(position, 1.0)).y;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying float vHeight;\nuniform vec3 contourColor;\nuniform float contourSpacing;',
			)
			.replace(
				'#include <dithering_fragment>',
				`#include <dithering_fragment>
	// Offset so flat ground at a whole metre height (the test track's floor) is not a line
	float f = vHeight / contourSpacing + 0.37;
	// fwidth is 0 on perfectly flat ground, and smoothstep(0, 0, x) is undefined
	float w = max(fwidth(f), 1e-4);
	float line = 1.0 - smoothstep(0.0, 1.5 * w, abs(fract(f - 0.5) - 0.5));
	gl_FragColor.rgb = mix(gl_FragColor.rgb, contourColor, line * 0.8);`,
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

	// Bumps in the accent colour
	const bumpMaterial = new THREE.MeshStandardMaterial({
		color: topo.accent,
		roughness: 0.85,
	});
	for (const bump of track.bumps) {
		const points: THREE.Vector3[] = [];
		for (let k = 0; k < bump.points.length; k += 3) {
			points.push(
				new THREE.Vector3(
					bump.points[k],
					bump.points[k + 1],
					bump.points[k + 2],
				),
			);
		}
		const mesh = new THREE.Mesh(new ConvexGeometry(points), bumpMaterial);
		mesh.position.set(...bump.position);
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
