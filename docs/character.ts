import Box3D from 'box3d.js/inline';
import { DynamicMover } from 'box3d.js/character';

const b3 = await Box3D();
const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());

/* SNIPPET_START: dynamic-mover */
const PLATFORM = 1n; // shapes with this userMaterialId carry the mover when kinematic

const mover = new DynamicMover(b3, world, {
    position: [0, 1.5, 0],
    platformMaterialId: PLATFORM,
});

// Every step, before b3World_Step. forward/right are horizontal (e.g. from the camera),
// throttle is [forward, right] on [-1, 1], and the last argument scales maxSpeed.
const forward: [number, number, number] = [0, 0, -1];
const right: [number, number, number] = [1, 0, 0];
if (mover.jump()) console.log('jumped'); // false while airborne
mover.update(1 / 60, forward, right, [1, 0], 1.5);
b3.b3World_Step(world, 1 / 60, 4);

// Tuning values are public fields, read every update.
mover.maxSpeed = 8;
mover.setGravityScale(2); // also resizes the pogo forces
console.log(mover.onGround, mover.walkable, mover.pogoLength, mover.probes[mover.selectedProbe]);

mover.destroy();
/* SNIPPET_END: dynamic-mover */
