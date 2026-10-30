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
```

## Vehicle presets

- `examples/src/vehicle-presets.js` holds the vehicle presets: the four originals and a 45 car matrix (sports, rally, super x realism 100/75/50/25/0 x fwd/rwd/awd), built in layers (car, then drivetrain, then realism level).
- To build or tune a car, follow the skill in `.claude/skills/vehicle-tuning/SKILL.md`, and check the result with `node examples/scripts/vehicle-metrics.mjs` (`--preset <name>`, `--car <name>`, `--all`, or `--file <module>`). Every matrix preset must pass it.

## Conventions

- Do not edit `README.md` directly. Edit `docs/README.template.md` and the snippets in `docs/`, then run `pnpm docs:build`.
- Do not modify files under `vendor/` unless the user explicitly asks you to.
- The build pins Emscripten to 6.0.2. Do not bump it unless asked.
- Record user-facing changes in `CHANGELOG.md`.
