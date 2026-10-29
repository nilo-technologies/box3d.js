import type { Box3DModule, b3AABB, b3WorldId } from 'box3d.js';

/** Structural stand-in for an Object3D. The caller passes its own three build. */
export interface DebugObject3D {
	add(object: DebugObject3D): void;
	remove(object: DebugObject3D): void;
	readonly children: DebugObject3D[];
	position: { set(x: number, y: number, z: number): unknown };
	quaternion: { set(x: number, y: number, z: number, w: number): unknown };
	scale: { set(x: number, y: number, z: number): unknown };
	matrixAutoUpdate: boolean;
	renderOrder: number;
	frustumCulled: boolean;
	visible: boolean;
	updateMatrix(): void;
}

export interface DebugBufferGeometry {
	setAttribute(name: string, attribute: unknown): void;
	setIndex(attribute: unknown): void;
	setDrawRange(start: number, count: number): void;
	computeVertexNormals(): void;
	applyQuaternion(q: unknown): void;
	translate(x: number, y: number, z: number): void;
	dispose(): void;
	getAttribute(name: string): { array: ArrayLike<number> } | undefined;
}

export interface DebugMaterial {
	color: { set(...args: any[]): unknown };
	opacity: number;
	transparent: boolean;
	depthTest: boolean;
	depthWrite: boolean;
	vertexColors?: boolean;
	size?: number;
	side?: number;
	needsUpdate: boolean;
	onBeforeCompile?: (...args: any[]) => void;
	dispose(): void;
}

/** The slice of a THREE namespace this module constructs. Pass `three` or `three/webgpu`. */
export interface DebugThree {
	Group: new (...args: any[]) => DebugObject3D;
	Mesh: new (...args: any[]) => DebugObject3D;
	LineSegments: new (...args: any[]) => DebugObject3D;
	Points: new (...args: any[]) => DebugObject3D;
	BufferGeometry: new (...args: any[]) => DebugBufferGeometry;
	EdgesGeometry: new (...args: any[]) => DebugBufferGeometry;
	SphereGeometry: new (...args: any[]) => DebugBufferGeometry;
	CapsuleGeometry: new (...args: any[]) => DebugBufferGeometry;
	BufferAttribute: new (...args: any[]) => unknown;
	MeshBasicMaterial: new (...args: any[]) => DebugMaterial;
	LineBasicMaterial: new (...args: any[]) => DebugMaterial;
	PointsMaterial: new (...args: any[]) => DebugMaterial;
	Color: new (...args: any[]) => { set(...args: any[]): unknown; r: number; g: number; b: number };
	Quaternion: new (...args: any[]) => { setFromUnitVectors(a: unknown, b: unknown): unknown };
	Vector3: new (...args: any[]) => { set(x: number, y: number, z: number): unknown };
	DoubleSide: number;
}

export type DebugColor = number | string | null;

/** `null` keeps box3d's own colour. Mass has none, so `null` there is white. */
export interface DebugColorMap {
	static?: DebugColor;
	kinematic?: DebugColor;
	kinematicSleeping?: DebugColor;
	awake?: DebugColor;
	sleeping?: DebugColor;
	sensor?: DebugColor;
	disabled?: DebugColor;
	fast?: DebugColor;
	bullet?: DebugColor;
	speedCapped?: DebugColor;
	timeOfImpact?: DebugColor;
	invalidMass?: DebugColor;
	custom?: DebugColor;
	bounds?: DebugColor;
	joints?: DebugColor;
	mass?: DebugColor;
	contactPoints?: DebugColor;
	contactNormals?: DebugColor;
	contactForces?: DebugColor;
	frictionForces?: DebugColor;
	islands?: DebugColor;
}

export interface DebugRendererSettings {
	shapes?: boolean;
	shapeStyle?: 'wireframe' | 'solid' | 'both';
	bounds?: boolean;
	joints?: boolean;
	jointExtras?: boolean;
	mass?: boolean;
	contacts?: boolean;
	contactNormals?: boolean;
	contactForces?: boolean;
	frictionForces?: boolean;
	contactFeatures?: boolean;
	islands?: boolean;
	graphColors?: boolean;
	forceScale?: number;
	jointScale?: number;
	/** Multiplier on box3d's point sizes. */
	pointSize?: number;
	/** Stretches contact-normal segments. box3d draws them at 0.3 length units. */
	normalScale?: number;
	maskBits?: number;
	drawingBounds?: b3AABB;
	opacity?: number;
	depthTest?: boolean;
	renderOrder?: number;
	colors?: DebugColorMap;
}

export interface DebugRenderer {
	/** Live. `update` reads it each call. */
	settings: DebugRendererSettings;
	object3d: DebugObject3D;
	update(): void;
	dispose(): void;
}

export function createDebugRenderer(
	b3: Box3DModule,
	worldId: b3WorldId,
	options: {
		THREE: DebugThree;
		parent: DebugObject3D;
		settings?: DebugRendererSettings;
	},
): DebugRenderer;
