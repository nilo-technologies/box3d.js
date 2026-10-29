import Box3D from 'box3d.js/inline';
import { createDebugRenderer } from 'box3d.js/three';

const b3 = await Box3D();
const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());

/* SNIPPET_START: debug-draw */
// `THREE` is the page's own three build (`three` or `three/webgpu`). `scene` is
// any Object3D. This module does not import three itself.
declare const THREE: Parameters<typeof createDebugRenderer>[2]['THREE'];
declare const scene: Parameters<typeof createDebugRenderer>[2]['parent'];

const debug = createDebugRenderer(b3, world, {
    THREE,
    parent: scene,
    settings: { shapes: true, contacts: true, colors: { sensor: 0xffd400 } },
});

b3.b3World_Step(world, 1 / 60, 4);
debug.update();
debug.settings.contactNormals = true;

// The buffer API is there when you draw it yourself. One buffer, refilled in place.
const draw = b3.createDebugDrawBuffer();
const shape = b3.createDebugShapeRecord();
b3.getDebugDraw(draw, world, { shapes: true });
for (let i = 0, n = b3.getNumDebugShapes(draw); i < n; i++) {
    b3.getDebugShapeAt(shape, draw, i);
    const geometry = b3.getDebugGeometry(shape.geometryId); // wasm views; copy to cache
    console.log(shape.state, geometry?.indices.length);
}
b3.destroyDebugDrawBuffer(draw);
debug.dispose();
/* SNIPPET_END: debug-draw */
