import type {
	Box3DModule,
	b3BodyId,
	b3HeightFieldData,
	b3MeshData,
	b3Vec3,
	b3WorldId,
} from 'box3d.js';

export type RaceTrackName = 'circuit' | 'stage';

export interface RaceTrackBumpDef {
	kind: 'hump' | 'table';
	/** Distance from the start of the bump section (m) */
	at: number;
	height: number;
	length: number;
	count?: number;
	spacing?: number;
	label: string;
}

export interface RaceTrackDef {
	title: string;
	surface: 'asphalt' | 'gravel';
	/** Road width (m) */
	width: number;
	/** Width of the blend from road to landscape (m) */
	shoulder: number;
	/** Height of the hills away from the road (m) */
	hills: number;
	/** Height of the surface irregularities (m) */
	roughness: number;
	/**
	 * A road surface of its own, as a triangle mesh: `sink` is how far the terrain under it sits
	 * below the road (m), `ramp` how wide the slope from each road edge down to the terrain is (m).
	 * Without it the car drives on the height field.
	 */
	road?: { sink: number; ramp: number };
	/** Control points of the closed centreline: [x, z, elevation] */
	points: [number, number, number][];
	/** Start line, the centreline point nearest [x, z] */
	start: [number, number];
	/** Bump section start, the centreline point nearest [x, z] */
	bumpSection: [number, number];
	bumps: RaceTrackBumpDef[];
}

export interface RaceTrackSample {
	/** Distance along the track (m) */
	s: number;
	x: number;
	y: number;
	z: number;
	/** Unit tangent in the ground plane */
	tx: number;
	tz: number;
}

export interface RaceTrackBump {
	kind: 'hump' | 'table';
	label: string;
	height: number;
	length: number;
	position: b3Vec3;
	yaw: number;
	/** Hull points in the bump's local frame, flat [x, y, z, ...] */
	points: number[];
}

export interface RaceTrack {
	name: RaceTrackName;
	title: string;
	surface: 'asphalt' | 'gravel';
	width: number;
	length: number;
	/** One sample per metre */
	centerline: RaceTrackSample[];
	/** Centreline indices of the bump section */
	bumpSection: { from: number; to: number };
	field: {
		heights: number[];
		countX: number;
		countZ: number;
		cell: number;
		/** World x and z of the first height */
		origin: [number, number];
	};
	/** The road mesh, on a track with a `road` */
	road: {
		/** Flat [x, y, z, ...] in world space */
		positions: number[];
		/** Triangles, counter-clockwise seen from above */
		indices: number[];
		/** Per point: 0 on the road, rising to 1 at the outer edge of the ramp */
		verge: number[];
	} | null;
	bumps: RaceTrackBump[];
	start: { position: b3Vec3; yaw: number; s: number };
	/** Distance to the centreline, the road height there and the nearest sample */
	roadAt(
		x: number,
		z: number,
	): { distance: number; y: number; sample: RaceTrackSample } | null;
	/** The height field's surface at (x, z) */
	groundAt(x: number, z: number): number;
}

export const raceTracks: Record<RaceTrackName, RaceTrackDef>;

export function buildRaceTrack(name: RaceTrackName): RaceTrack;

export function createRaceTrackBodies(
	b3: Box3DModule,
	world: b3WorldId,
	track: RaceTrack,
): {
	ground: b3BodyId;
	/** The road mesh's body, on a track with a `road` */
	road: b3BodyId | null;
	bumpBodies: b3BodyId[];
	walls: b3BodyId[];
	field: b3HeightFieldData | null;
	mesh: b3MeshData | null;
};
