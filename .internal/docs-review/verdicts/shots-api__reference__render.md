# Verdicts: api/reference/render (shots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links

- scene pass -> `security-camera/` (at `ScenePassOptions`): KEEP. The code exists in examples/demos.ts. The sketch calls `render.addPass({ kind: 'scene', camera: security, writes: 'security', size })` and shows the texture on a monitor through `textures.fromPass`. It shows every key member of the options in plain view.
- compute passes -> `ocean/` (at `ComputePassOptions`): KEEP, with a note. The code exists. The demo's own sketch only calls `createOcean`; the compute passes live in the water add-on (packages/water/src/ocean.ts): a chain of compute passes with `layers`, `values`, `textures`, `size`, `format` and a `fallback`. No demo sketch calls a compute pass directly, so this is the best link. The link text should say the passes are inside the water add-on, so a reader who opens the sketch is not confused.
- reflection pass -> `water/` (at `ReflectionPassOptions`): REJECT, replace. The code exists, but the water sketch never calls `addPass`; the water add-on adds the reflection pass out of sight (packages/water/src/water.ts). Use `mesh-arrays/` instead (the demo has no code value, so its folder name is the code). Its sketch calls `render.addPass({ kind: 'reflection', writes: 'water', plane })` and reads it in a custom material with `reflection_uv`, which is exactly what this section describes. Its summary also says "a reflection pass mirrors the island in the water".

## Concepts said to have no demo

- ComputeFallback: WRONG, a demo shows it. `ocean/` runs on WebGL2 through the fragment forms that the water add-on passes as `fallback` to each compute pass (packages/water/src/ocean.ts). Link `ocean/` at `ComputeFallback`, with the same note that the code is in the add-on.
- PassReadResult: CONFIRMED. No demo, sketch or add-on calls `render.readPass`.
