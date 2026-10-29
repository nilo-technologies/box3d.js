import type { b3Vec3, b3VehicleDef, Box3DModule } from 'box3d.js';

export type VehiclePresetName = 'fwd' | 'rwd' | 'awd' | 'offroad';

export interface VehiclePreset {
	title: string;
	/** Half extents of the chassis collision box (m) */
	halfExtents: b3Vec3;
	/** Tunes a b3DefaultVehicleDef() in place and returns it */
	apply(def: b3VehicleDef): b3VehicleDef;
}

export const vehiclePresets: Record<VehiclePresetName, VehiclePreset>;

export function createPresetVehicleDef(b3: Box3DModule, name: VehiclePresetName): b3VehicleDef;
