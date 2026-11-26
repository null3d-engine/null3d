# Verdicts: screenshots and demo links for api/reference/math

Page: docs/api/reference/math.md (generated from TSDoc with `@category api/math` in packages/engine/src/math, written by tools/gen-docs.ts and tools/lib/docs.ts).

## Screenshots

None proposed. Nothing to check.

## Demo links

### `math/` for "vec3, quat, createMath" (at `## vec3`): keep, but narrow the concept

- The code is right. The demo named `math` in examples/demos.ts has no `code` value, so the link is `https://github.com/null3d-engine/null3d/tree/main/examples/math/`.
- The demo shows `vec3` and `quat` well. Its sketch (examples/math/sketch.ts) places, turns and banks 300 drones each frame with `vec3.create`, `set`, `lerp`, `add`, `sub`, `scale`, `normalize`, `dot`, `cross`, `transformQuat`, and `quat.create`, `rotateY`, `multiply`, `fromEuler`, all into arrays made once. It also uses `math.seed`, `math.randFloat`, `math.damp` and `math.clamp`.
- It does not use `createMath`. The label "vec3, quat, createMath" is wrong for this link. Use "vec3, quat and math" instead.

### New link: `replay/` for `createMath` (at `## createMath`)

- The demo named `replay` has `code: 'replay/'`. Its simulation (examples/replay/sim.ts) builds `createMath({ sin, cos, acos, exp })` on an exact math library, so that a replay gives the same bits in every JavaScript engine. That is the exact use the `createMath` entry describes.
- Link: `https://github.com/null3d-engine/null3d/tree/main/examples/replay/`.

## Concepts said to have no demo

### `color` namespace: disproved, two demos use it

- `sprites-lines/` (examples/sprites-lines/sketch.ts) turns hex colors to linear RGB with `color.fromHex` and blends them along a neon helix, and for the sparks' heat. This is the clearest example. Link: `https://github.com/null3d-engine/null3d/tree/main/examples/sprites-lines/` (the demo has no `code` value).
- `property-animation/` (examples/property-animation/sketch.ts) makes seven hue keys with `color.fromHsl`. It is a second choice.
- Put the link at `## color`.
