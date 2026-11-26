# Shot and demo-link verdicts: errors/E1209 (Too many textures)

Source to edit: packages/engine/src/errors/codes.ts (entry E1209) and fixes.ts, rendered by tools/lib/docs.ts.

## Shots

None proposed. No change: an error page about a texture limit has no view that a picture would explain.

## Demo links

None proposed. See below: one demo is worth a link.

## Concepts said to have no demo

1. "WebGL2 texture units per shader stage": confirmed, no demo. A device limit is not something a demo shows. No demo or comparison reads or prints the unit count, and no sketch triggers this error.

2. "a custom material's textures beside the lighting's": not confirmed. The "Render to texture" demo (code security-camera/) shows it.
   - In examples/security-camera/sketch.ts, a custom lit material (materials.shader with roughness) reads its own texture, the camera feed, through `textures: { feed }`.
   - The same scene has a directional floodlight with shadows and an ambient light, so the lit shader reads its own maps and shadow textures beside the material's.
   - The demo has reference images in the webgpu, compat and webgl2 tiers, so it runs on WebGL2, where this limit applies.
   - Link: https://github.com/null3d-engine/null3d/tree/main/examples/security-camera/
   - Use it on the "How to fix it" part, as an example of a custom material with one texture of its own that fits in what the lit shader leaves.
   - A weaker match: the "Custom shader inputs" demo (shader-inputs/), whose pool floor material reads one reflection texture and receives shadows (examples/shader-inputs/pool.ts). Its summary is about instance and object inputs, so it is not the better link here.
