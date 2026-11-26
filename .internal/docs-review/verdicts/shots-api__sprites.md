# Shot and demo-link verdicts: api/sprites

## Shots

### sprites-lines: keep, with a fixed alt text

- The reference image exists: `tests/image/references/chrome-real-gpu/webgpu/demo-sprites-lines.png` (also in compat and webgl2). It shows the demo's default view: the spark fountain over the pool.
- It helps the intro. The second intro paragraph already names this demo and its 2,000 sparks in one batch.
- Problem 1: the picture also shows a neon helix and a dashed ring. Those are lines, not sprites. The alt text names only the sparks. Use: "A fountain of glowing sparks over a dark pool, ringed by a neon helix and a dashed loop of lines". Or say in the caption that only the sparks are sprites.
- Problem 2: the reference is only 320 x 180 pixels. It will look soft at page width. If a sharper picture is needed, capture the demo's default view after its hold, at a larger canvas size. The source and the view stay the same.

### sprites-100k: reject

- The source is wrong. It is not a scripted shot. A reference already exists: `tests/image/references/chrome-real-gpu/webgpu/sprites-100k.png` (also in compat and webgl2).
- The picture does not help. At 320 x 180 it is a field of colored noise, with two flat orange and teal blocks at the sides. Those blocks are the pixel-sized sprites whose centers lie outside the view, which a reader cannot know. The point of "Speed" is one draw for 100,000 sprites. A still picture cannot show a draw count.
- If "Speed" needs a picture, none of the current references shows it well. Leave the section without one.

## Demo links

### Sprite batches, `sprites-lines/`, under "Create a batch": reject as a duplicate

- The code is right. The demo has no `code` value, so its name with a slash is the code. The sketch calls `scene.createSprites` with an additive, dynamic batch of 2,000 sparks.
- But the intro already links the same demo, and the stats list it as the page's one example link. A second link to it two paragraphs later adds nothing.

### Flipbook atlases, `particles/`, under "Atlases": reject; use `compare/battle/`

- The code exists, and the demo does show flipbooks (flames, smoke).
- But it does not use the API on this page. It uses the particles add-on (`createParticles`), which draws through the engine's particle buffers (`scene.createParticleBuffer`), not a sprite batch. It never sets `atlas` on `createSprites`, and never writes `frames`. A reader of "Atlases" who opens it will not find the code the section describes.
- `compare/battle/` (in comparisons.ts) does show it. Its fire and smoke go through `examples/lib/particles-null3d.ts`, which calls `scene.createSprites({ atlas: { columns, rows } })` and copies each sprite's frame into `frames`. The fire atlas is 4 x 4 frames of a fireball's life, and the smoke atlas is 2 x 2. Note for the link text: the atlas code is in the shared helper, not in the battle sketch itself.

### Added by the reviewer: weighted blending, `weighted-transparency/`, under "Blending, sorting and depth"

- Not proposed, but it fits. The sketch makes two sprite batches of 600 smoke puffs, one with `blending: 'weighted'` and one with `blending: 'normal'`. Its summary says the normal batch pops as the camera turns. That is the sorting issue the section explains.

## Concepts said to have no demo

- Sizes in CSS pixels: confirmed. No demo makes sprites with `sizeAttenuation: false`. The galaxy demo uses it, but on a points batch, not sprites. The `sprites` image test draws pixel-sized sprites, but that is a test page, not a demo.
- Clicks on sprites: confirmed. No demo adds pointer events or raycasts to a sprite batch. In the sprites and lines demo the pointer moves the fountain; it does not pick sprites.
