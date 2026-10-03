# D-37: Sprites

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-G1.

## Question

1. How does a batch of sprites reach the GPU: through the instance batches' rows, culling and sorting, or through a draw path of its own?
2. How does each sprite's size, rotation, color and atlas frame reach the vertex shader, on both GPU paths, within hard rule 7 (instance data in vertex buffers only)?
3. What does a size mean without size attenuation, and how does a port of three.js's `Sprite` keep its look?

## Rule

- Blended sprites sort back to front with the scene's other blended objects, as three.js sorts each `Sprite`.
- 100,000 sprites draw on all three tiers, at a cost per sprite within S1's cost per row.
- The parity scene passes three.js's rule against `Sprite` and `SpriteMaterial`: under 0.1% of the pixels differ, or no more than between three.js's two renderers.
- No new work in a frame that draws no sprites, and no change to the culling shader or the WebGL2 data textures that every other row pays for.

## Data

PENDING: the parity figures and the cost per sprite, measured after the quiet window.

## Decision

1. A sprite batch is an instance batch of the core, with a flag and rows of its own. It keeps its positions where every batch keeps them, so grid cells, active counts, dirty marks, layers and uploads work as they do for any batch. In place of rotations as quaternions and scales, it holds sizes (2 floats), rotations in radians (1), linear colors (4) and atlas frames (one 32-bit integer).
2. The batch's update packs each sprite into the row's 3 x 4 world matrix, in `null3d_core::sprites`. The width and the height sit on the diagonal, the position relative to the row's cell in the last column, and the other entries hold the rotation, the color and the frame bits as small values: the rotation and the color times 2^-20, the frame bits times 2^-32. The factors are powers of two, so the shader multiplies each value back exactly. Culling takes a row's radius from the matrix's longest column, which stays the larger side: the packed values add a few thousandths at most. So the culling shader, the WebGL2 data textures, the cell offsets, the transparent pass's sort and its uploads all take sprite rows unchanged. The frame bits hold the frame's column, its row from the image's bottom, and a bit for sizes in pixels.
3. Two templates draw sprites: `SPRITE` (22), with the material's color alone, and `SPRITE_MAP` (23), which samples the map at the sprite's frame. A sprite material with a live map draws with the second, as `UnlitMap` falls back to `Unlit`. The vertex shader moves each corner of a unit quad across the screen as three.js's sprite shader does. It scales the corner by the size, turns it by the rotation, and adds it to the center's clip position times the projection's scale along x and y. That scale is the length of the first two rows of the view-projection matrix, as the camera's rotation keeps lengths.
4. Without size attenuation, sizes are in CSS pixels. The frame uniform's spare `camera_range.zw` carries the change in normalized device coordinates across one CSS pixel, from the pixel ratio that the sketch runner passes to the core (`setPixelRatio`). Such sprites have no bounds in the world, so the core gives them an unbounded sphere, and the GPU culling's bucket takes `UNCULLED_BOUNDS`.
5. The anchor, three.js's `center`, moves the quad mesh: each batch's quad has its anchor at the origin, and batches with one anchor share the mesh. The mesh's radius then bounds the sprite at any rotation. The atlas sets the material's texture coordinate transform to one frame's size, and the frame's column and row move the coordinates in the vertex shader.
6. Sprite batches stay out of the depth prepass, which places vertices by the mesh's template, and out of the scene's raycast trees, whose items have boxes in the world. Batch rows cast no shadows yet, so sprites cast none.

## Options rejected

- A draw path of its own, as the debug lines have: a vertex buffer of sprites, uploaded from the typed arrays. It needs its own sort, interleaved by hand with the transparent pass's, its own cells for precision far from the origin, and its own culling. The instance path has all three on both GPU paths already.
- Color and frame as an extra instance attribute. WebGPU reads each instance's ids from a fourth `vec4u`, whose last three words are free, but the culling shader would need a buffer of colors and frames to copy from. WebGL2 would need a fourth texel per row in its data textures, which every row of every batch would pay for in memory and uploads. M2-K2's custom attributes may take that route later.
- Rotation as a quaternion about the view axis, written into the batch's rotations. Sketches would build a quaternion per sprite for one angle, and three.js's `SpriteMaterial.rotation` is an angle.
- Colors in 8 bits. Linear 8-bit colors band in the dark. The packed floats keep full precision, and allow components up to 1,024 for bloom.
- Sizes without attenuation as a fraction of the view's height, as three.js's sprites take them. Pixels are what markers and icons need, and points (M2-G2) take pixels as three.js's `PointsMaterial` does. The docs give the conversion.
- A separate camera right and up vector in the frame uniform for billboarding. The view-projection's rows give the same offset in clip space with no new uniform, for perspective and orthographic cameras.

## Consequences

- Code: `crates/null3d-core/src/sprites.rs`, the sprite rows of `instances.rs`, `Shading::Sprite` and `SpriteMap` in the renderer, the templates `SPRITE` and `SPRITE_MAP`, `wgsl/sprite.wgsl`, the core calls `createSpriteBatch` and `setPixelRatio`, and `scene/sprites.ts` with `scene.createSprites`.
- Tests: the core's packing and update tests, the render crate's `sprites.rs`, `scene/sprites.test.ts`, the image tests `sprites` and `sprites-100k`, and the parity scene `sprites`.
- Docs: `api/sprites`, the mapping's `sprite` entry, and both skills.
- M2-G2's points can draw on this path: a point is a sprite with one size, and its shader can read the same packed rows.
- M2-H1's batch origins apply to sprite batches as to any batch.
