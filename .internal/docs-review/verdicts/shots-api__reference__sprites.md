# Verdicts: api/reference/sprites (shots and demo links)

## Shots

None were proposed. Nothing to check.

## Demo links

- SpriteBatch -> `sprites-lines/` (under `## SpriteBatch`). KEEP.
  The demo "Sprites and lines" in examples/demos.ts has no `code` value, so the contract gives `sprites-lines/`. Its sketch (examples/sprites-lines/sketch.ts) makes one dynamic sprite batch of glowing sparks with `scene.createSprites({ count, map, blending: 'additive', dynamic: true })` and writes the `positions`, `sizes` and `colors` rows every frame. That is the SpriteBatch use the page describes. The demo does not use `frames` or an atlas.

## Concepts said to have no demo

- SpriteAtlas: DISPROVED. The battle comparison (code `compare/battle/` in examples/compare/comparisons.ts) shows it.
  Its null3D sketch (examples/compare/battle/sketch.ts) makes two sprite layers with `null3dSprites`, one with `fireAtlas()` (a 4 by 4 grid of frames) and one with `smokeAtlas()` (a 2 by 2 grid). `null3dSprites` in examples/lib/particles-null3d.ts calls `scene.createSprites({ map, atlas: { columns, rows } })` and copies each sprite's frame into `batch.frames`. The night-town comparison (`compare/night-town/`) uses the same helper, so it also shows an atlas.
  Caveat: the `createSprites` call with `atlas` sits in the shared helper examples/lib/particles-null3d.ts, not in the battle folder. A reader who follows the link must follow one import to find it. The link is still correct under the contract, and the battle sketch is the shortest real example.
  Proposed link under `## SpriteAtlas`: https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/
