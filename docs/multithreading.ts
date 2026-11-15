import type { Box3DModule } from 'box3d.js';

/* SNIPPET_START: mt-init */
// The multithreaded build uses SharedArrayBuffer under the hood.
// The page must be served with cross-origin isolation headers:
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp
const isolated = self.crossOriginIsolated === true;

// The workers a world will step on, the calling thread counted.
const hwThreads = navigator.hardwareConcurrency ?? 4;
const workerCount = isolated ? Math.max(2, hwThreads - 1) : 0;

// Pick the right build at runtime; fall back gracefully when isolation is absent.
// The threaded build starts its threads as it loads (pthreadPoolSize, 4 by default):
// one for each worker past the calling thread.
const b3: Box3DModule = isolated
    ? await (await import('box3d.js/mt-inline')).default({ pthreadPoolSize: workerCount - 1 })
    : await (await import('box3d.js/inline')).default();
/* SNIPPET_END: mt-init */

/* SNIPPET_START: mt-world */
const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];

// Set workerCount to enable box3d's internal multi-threaded solver. box3d clamps
// it to [1, 32] (B3_MAX_WORKERS), and the threaded build to the pool's idle
// threads plus the calling one. Leave at 0 for single-threaded.
worldDef.workerCount = workerCount;

const world = b3.b3CreateWorld(worldDef);
/* SNIPPET_END: mt-world */

/* SNIPPET_START: mt-step */
// The simulation API is identical to the single-threaded build;
// only the import and workerCount differ.
b3.b3World_Step(world, 1 / 60, 4);
/* SNIPPET_END: mt-step */

b3.b3DestroyWorld(world);
