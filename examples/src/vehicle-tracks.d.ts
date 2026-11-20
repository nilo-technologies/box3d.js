import type {
	Box3DModule,
	b3BodyId,
	b3HeightFieldData,
	b3MeshData,
	b3Vec3,
	b3WheeledVehicleDef,
	b3WorldId,
} from 'box3d.js';

export type RaceTrackName = 'circuit' | 'stage' | 'downhill' | 'uphill';

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
	 * Without it the car drives on the height field. `strips` (1 by default) splits the road across
	 * into equal quads: on graded corners a single quad twists into a crease the dampers feel as
	 * load chatter, while every split is a seam a chassis touching down can snag on (worst down
	 * the middle, so prefer an odd count where cars jump).
	 */
	road?: { sink: number; ramp: number; strips?: number };
	/**
	 * Spread of the wide landscape average (m), 40 by default. Past 4 spreads from any road the
	 * land falls to 0, or with this set, to the mean road height.
	 */
	farSpread?: number;
	/** Control points of the centreline: [x, z, elevation] */
	points: [number, number, number][];
	/** false for a point to point track from the first point to the last. true by default. */
	closed?: boolean;
	/** Runs the points backwards, as the uphill of a downhill */
	reverse?: boolean;
	/** On a closed track: the start line, the centreline point nearest [x, z] */
	start?: [number, number];
	/** On an open track: the start and finish lines, in metres from each end */
	run?: { start: number; finish: number };
	/**
	 * Guardrails where the ground beside the road sits more than `drop` metres above or below it
	 * (open tracks only)
	 */
	rails?: { drop: number };
	/** Bump section start, the centreline point nearest [x, z] (when there are bumps) */
	bumpSection?: [number, number];
	bumps: RaceTrackBumpDef[];
}

export interface RaceTrackRail {
	/** 1 on the left of the direction of travel, -1 on the right */
	side: 1 | -1;
	/** Centreline indices the rail runs along */
	from: number;
	to: number;
	/** The rail line every 2 m at road height, flat [x, y, z, ...]: the wall's inner face */
	points: number[];
}

export interface RaceTrackPose {
	position: b3Vec3;
	yaw: number;
	/** Distance along the track (m) */
	s: number;
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
	/** false for a point to point track */
	closed: boolean;
	length: number;
	/** One sample per metre */
	centerline: RaceTrackSample[];
	/** Centreline indices of the bump section, on a track with bumps */
	bumpSection: { from: number; to: number } | null;
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
	rails: RaceTrackRail[];
	start: RaceTrackPose;
	/** The finish line of a point to point track */
	finish: RaceTrackPose | null;
	/** Distance to the centreline, the road height there and the nearest sample */
	roadAt(
		x: number,
		z: number,
	): { distance: number; y: number; sample: RaceTrackSample } | null;
	/** The height field's surface at (x, z) */
	groundAt(x: number, z: number): number;
}

export const raceTracks: Record<RaceTrackName, RaceTrackDef>;

/** Guardrail wall thickness and height above the road (m) */
export const railThickness: number;
export const railHeight: number;

/** The guardrails' collision category: the chassis hits them, the wheel casts skip them */
export const railCategory: bigint;

/** Makes a vehicle def's wheel casts skip the guardrails (on the def, which it returns) */
export function wheelsIgnoreRails(
	def: b3WheeledVehicleDef,
): b3WheeledVehicleDef;

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
	/** The guardrails' body, on a track with rails */
	rails: b3BodyId | null;
	walls: b3BodyId[];
	field: b3HeightFieldData | null;
	mesh: b3MeshData | null;
};
