# D-37: Sprites

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-G1.

## Question

1. How does a batch of sprites reach the GPU? It can use the rows, culling and sorting of instance batches, or a draw path of its own.
2. How does each sprite's size, rotation, color and atlas frame reach the vertex shader on both GPU paths? Hard rule 7 allows instance data in vertex buffers only.
3. What does a size mean without size attenuation, and how does a port of three.js's `Sprite` keep its look?

## Rule

- Blended sprites sort back to front with the scene's other blended objects, as three.js sorts each `Sprite`.
- 100,000 sprites draw on all three tiers, at a cost per sprite within S1's cost per row.
- The parity scene passes three.js's rule against `Sprite` and `SpriteMaterial`. Under 0.1% of the pixels differ, or no more than between three.js's two renderers.
- A frame that draws no sprites does no new work. The culling shader and the WebGL2 data textures, which every other row pays for, do not change.

## Data

### Parity with three.js

Pixels that differ from three.js by its rule, Chrome on the Mac's GPU, 4 October 2026:

| Scene | Core WebGPU | Compatibility mode | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| `sprites`: 8 blended sprites at frames of an atlas, and 3 opaque sprites sized in pixels | 0.000% | 0.033% | 0.000% | 0.036% |

`bun run parity -- --scene sprites --tier webgpu,compat,webgl2` compares the `sprites` image test with the twin `bench/pages/threejs/sprites.html`. Both draw the scene of `bench/scenes/sprites.ts`. The twin draws one `Sprite` with a `SpriteMaterial` per sprite. A blended sprite's material takes a copy of the atlas whose offset and repeat pick its frame. An opaque sprite's material has `sizeAttenuation: false`, and its scale comes from the pixel size by `threeScreenScale`. Overlapping sprites at different depths check the sort. Turned sprites and a white mark at the top of each frame check the rotation and which way is up.

### 100,000 sprites

The `sprites-100k` image test draws one dynamic batch of 100,000 sprites in one draw, on all three tiers. The Mac's GPU drew it on each tier, blended and opaque, in under 4 s a test. CI's software GPU takes tens of seconds for 100,000 rows on WebGPU, as for S1's boxes. A blended field took about a minute there, so the test draws the field opaque, and the `sprites` scene checks blending and sorting.

A sprite costs what an instance row costs on the GPU and in culling: the same 48-byte matrix, the same culling, the same draw. The batch's update differs. It packs each sprite one at a time, where a mesh batch composes four rows at a time with SIMD. The packing has no trigonometry: the shader turns the corners. A timed comparison with S1 is left to the benchmark job, as this Mac is shared.

## Decision

1. A sprite batch is an instance batch of the core, with a flag and rows of its own. It keeps its positions where every batch keeps them. So grid cells, active counts, dirty marks, layers and uploads work as they do for any batch. In place of quaternions and scales, it holds sizes (2 floats), rotations in radians (1), linear colors (4) and atlas frames (one 32-bit integer).
2. The batch's update packs each sprite into the row's 3 x 4 world matrix, in `null3d_core::sprites`. The width and the height sit on the diagonal, and the position relative to the row's cell in the last column. The other entries hold the rotation, the color and the frame bits as small values. The rotation and the color are multiplied by 2^-20, and the frame bits by 2^-32. The factors are powers of two, so the shader multiplies each value back exactly.
   Culling takes a row's radius from the matrix's longest column. That column stays the larger side, because the packed values add a few thousandths at most. So the culling shader, the WebGL2 data textures, the cell offsets, the transparent pass's sort and its uploads take sprite rows unchanged. The frame bits hold the frame's column, its row from the image's bottom, and a bit for sizes in pixels.
3. Two templates draw sprites: `SPRITE` (22), with the material's color alone, and `SPRITE_MAP` (23), which samples the map at the sprite's frame. A sprite material with a live map draws with the second, as `UnlitMap` falls back to `Unlit`. The vertex shader moves each corner of a unit quad across the screen as three.js's sprite shader does. It scales the corner by the size and turns it by the rotation. Then it adds the corner to the center's clip position, times the projection's scale along x and y. That scale is the length of each of the first two rows of the view-projection matrix, because the camera's rotation keeps lengths.
4. Without size attenuation, sizes are in CSS pixels. The frame uniform's spare `camera_range.zw` carries the change in normalized device coordinates across one CSS pixel. It comes from the pixel ratio that the sketch runner passes to the core (`setPixelRatio`). Such sprites have no bounds in the world. So the core gives them an unbounded sphere, and the GPU culling's bucket takes `UNCULLED_BOUNDS`.
5. The anchor, three.js's `center`, moves the quad mesh: each batch's quad has its anchor at the origin, and batches with one anchor share the mesh. The mesh's radius then bounds the sprite at any rotation. The atlas sets the material's texture coordinate transform to one frame's size, and the frame's column and row move the coordinates in the vertex shader.
6. Sprite batches stay out of the depth prepass, which places vertices by the mesh's template. They stay out of the scene's raycast trees too, whose items have boxes in the world. Batch rows cast no shadows yet, so sprites cast none.
7. The scene's module imports no value from the material and mesh modules, so its release build keeps none of their error text. The sketch runner hands the scene `spriteParts` (`scene/sprite-parts.ts`), which makes each batch's quad and material.

## Options rejected

- A draw path of its own, as the debug lines have: a vertex buffer of sprites, uploaded from the typed arrays. It needs its own culling and its own cells for precision far from the origin. Its sort must also mix by hand with the transparent pass's. The instance path has all three on both GPU paths already.
- Color and frame as an extra instance attribute. WebGPU reads each instance's ids from a fourth `vec4u`, whose last three words are free. But the culling shader would need a buffer of colors and frames to copy from. WebGL2 would need a fourth texel per row in its data textures, which every row of every batch would pay for in memory and uploads. M2-K2's custom attributes may take that route later.
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
