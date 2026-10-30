import type { Box3DModule, b3BodyId, b3Vec3, b3WorldId } from 'box3d.js';

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
	bumps: RaceTrackBump[];
	start: { position: b3Vec3; yaw: number; s: number };
	/** Distance to the centreline, the road height there and the nearest sample */
	roadAt(
		x: number,
		z: number,
	): { distance: number; y: number; sample: RaceTrackSample } | null;
}

export const raceTracks: Record<RaceTrackName, RaceTrackDef>;

export function buildRaceTrack(name: RaceTrackName): RaceTrack;

export function createRaceTrackBodies(
	b3: Box3DModule,
	world: b3WorldId,
	track: RaceTrack,
): { ground: b3BodyId; bumpBodies: b3BodyId[]; walls: b3BodyId[] };
