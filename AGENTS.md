# Agent Instructions

This repository is **Nilo's fork** of box3d.js.

- Our repo (`origin`): `nilo-technologies/box3d.js`
- Original fork / upstream: `isaac-mason/box3d.js` (credited in `LICENSE`)
- Vendored submodules: `nilo-technologies/box3d` (`vendor/box3d`, Nilo's fork of `erincatto/box3d`), `kmammou/v-hacd` (`vendor/v-hacd`)

## Pull requests: never target the original fork

- **Never create pull requests against `isaac-mason/box3d.js`**, or against the upstream repos `erincatto/box3d` and `kmammou/v-hacd`.
- All PRs go to `nilo-technologies/box3d.js`, usually with `main` as the base branch.
- Changes to the box3d engine itself go to `nilo-technologies/box3d` (base `main`), and only when the user explicitly asks for them.
- Also do not open issues, comments, reviews, or pushes on those upstream repos.
- `gh pr create` in a fork **defaults to the upstream parent repo**. Always pass the repo explicitly:

```bash
gh pr create --repo nilo-technologies/box3d.js --base main --head <branch>
```

- When using the GitHub MCP tools, always set `owner: nilo-technologies` and `repo: box3d.js`.
- If it is unclear where a PR should go, ask the user. Do not guess.

## Project layout

- `src/bindings.cpp`: Emscripten embind bindings for box3d and V-HACD
- `src/facade.js`: JS facade layered on top of the generated module
- `scripts/build.mjs`: build script that produces everything in `dist/`
- `dist/`: built outputs (`.mjs`, `.wasm`, `.d.ts`). These are committed, so rebuild them after changing `src/`
- `examples/`: Three.js examples (pnpm workspace package `@box3d/examples`)
- `docs/`: README generator and typed doc snippets
- `test/smoke.mjs`: smoke tests

## Commands

```bash
pnpm build          # requires emsdk 6.0.2 on PATH (emcmake / em++)
pnpm build:debug
pnpm test           # smoke tests against dist/
pnpm docs:build     # regenerates README.md from docs/README.template.md
pnpm docs:check     # type-checks doc snippets
pnpm check          # biome lint + format check for examples/src
pnpm bench:decomposition:quality   # V-HACD's merge against the surface merge (surfaceMerge)
```

## Vehicle presets

- `src/wheeled-vehicles.js` (with `src/wheeled-vehicles.d.ts`, shipped as `box3d.js/wheeled-vehicles`) holds the vehicle presets: the four originals and a 45 car matrix (sports, rally, super x realism 100/75/50/25/0 x fwd/rwd/awd), built in layers (car, then drivetrain, then realism level). The metrics and laps scripts read `src/wheeled-vehicles.js` directly, so tuning needs no rebuild, but `dist/wheeled-vehicles.mjs` and `dist/wheeled-vehicles.d.ts` are plain copies that must be refreshed before committing (`pnpm build` does it; `pnpm test` fails on a stale copy).
- To build or tune a car, follow the skill in `.claude/skills/vehicle-tuning/SKILL.md`, and check the result with `node examples/scripts/vehicle-metrics.mjs` (`--preset <name>`, `--car <name>`, `--all`, or `--file <module>`). Every matrix preset must pass it. For how easy a car is to drive with a keyboard, run `node examples/scripts/vehicle-wasd.mjs --car <name>`: a WASD driver through `createSteeringLimiter`, reporting the highest clean cornering pace and how the car fails above it.

## Convex decomposition

- Without the surface merge, `b3ComputeConvexDecomposition` and friends run V-HACD (`vendor/v-hacd`). With `surfaceMerge: true`, or a `maxConcavity` alone, the engine's `b3MergeConvexPieces` (`vendor/box3d/src/convex_merge.c`) decomposes the mesh instead, merging pieces against the mesh surface instead of by volume. By default it starts from the triangles of the mesh (`seedTriangles`, on by default, `b3ConvexMergeDef::seedTriangles`) and V-HACD does not run. With `seedTriangles: false` V-HACD hands over all its pieces and the merge joins those. By default the merge finds its limit with a sweep (`b3ConvexMergeDef::enableSweep`); `sweep: false` merges once, to `maxConcavity`. `b3MergeConvexDecomposition` runs the merge on its own over the pieces it is handed, and `b3SweepConvexDecomposition` is a decomposition with the merge on, returned with the steps of the sweep. The bindings read the options, fill in the defaults and clamp them (`readMergeOptions` in `src/bindings.cpp`, mirrored for the cache key by `decompositionMergeKey` in `src/facade.js`, which must change together). The engine does the rest: the range that follows the mesh size when `minConcavity` or `maxConcavity` is left out, the sweep, and the choice of step.
- `test/bench-decomposition-quality.mjs` compares the surface merge with V-HACD on the procedural meshes in `test/decomposition-meshes.mjs`, with the metrics in `test/decomposition-metrics.mjs` (hull count, time, deepest open space sealed, volume over and missing). Run it before and after touching either merge. `--pieces` starts the merge from V-HACD's pieces, `--sweep` prints each mesh's sweep and the step kept, and `--versions` sets the two ways to start against each other: the triangles and V-HACD's pieces. `--dump <dir>` writes each result as JSON, and `node examples/scripts/decomposition-screenshots.mjs <dir> <out>` draws them side by side.

## Conventions

- Do not edit `README.md` directly. Edit `docs/README.template.md` and the snippets in `docs/`, then run `pnpm docs:build`.
- Do not modify files under `vendor/` unless the user explicitly asks you to.
- The build pins Emscripten to 6.0.2. Do not bump it unless asked.
- Record user-facing changes in `CHANGELOG.md`.
