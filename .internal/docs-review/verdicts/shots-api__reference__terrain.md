# Shot and demo-link verdicts: api/reference/terrain

## Shots

None proposed. Nothing to check.

## Demo links

- Concept "createTerrain and terrainTextures", code `terrain/`, under `## createTerrain`: KEEP.
  - The code `terrain/` exists in examples/demos.ts (demo `terrain`, title "Terrain").
  - The sketch (examples/terrain/sketch.ts) imports `createTerrain` and `terrainTextures` from `@null3d/terrain`, makes four layers with `terrainTextures(ctx.textures, { size: 128, seed: 7 })`, calls `createTerrain(ctx, {...})` with those layers, calls `terrain.update(eye)` each frame, and calls `setMorph(false)` behind a `?morph=off` switch.
  - Caution for whoever writes the link text: the sketch does not call `heightAt` or `normalAt`. Its boulders read the height function directly, though a comment in the sketch says `terrain.heightAt`. Do not say the demo shows those two members.

## Concepts said to have no demo

- "createHeightfield alone": CONFIRMED, no demo shows it. No file under examples/ calls `createHeightfield` or names `Heightfield`. The terrain, water and island showcase sketches all use `createTerrain`, which makes its own height field inside.
