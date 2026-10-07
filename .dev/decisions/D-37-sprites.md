# D-37: Sprites and points

Status: decided, 2026-10-04; points decided 2026-10-05. Date: 2026-10-04. Tasks: M2-G1, M2-G2 ([Points](#points)).

Summary: A sprite batch is an instance batch whose update packs each sprite's size, rotation, color and atlas frame into its row's world matrix, so culling, sorting and both GPU paths take sprites unchanged. Sizes without attenuation are in CSS pixels. The sprite code loads on first use, so `scene.createSprites` returns a promise. The parity scene differs from three.js's `Sprite` in 0.000% to 0.033% of the pixels. Points are sprites of one size, with sizes in world units, and their parity scene takes a limit of 0.2% for WebGPU's sample pattern and compatibility mode's 8-bit edges.

## Question

1. How does a batch of sprites reach the GPU? It can use the rows, culling and sorting of instance batches, or a draw path of its own.
2. How does each sprite's size, rotation, color and atlas frame reach the vertex shader on both GPU paths? Hard rule 7 allows instance data in vertex buffers only.
3. What does a size mean without size attenuation, and how does a port of three.js's `Sprite` keep its look?
4. What does the sprite code add to a page's download, and does a page without sprites pay for it?

## Rule

- Blended sprites sort back to front with the scene's other blended objects, as three.js sorts each `Sprite`.
- 100,000 sprites draw on all three tiers, at a cost per sprite within S1's cost per row.
- The parity scene passes three.js's rule against `Sprite` and `SpriteMaterial`. Under 0.1% of the pixels differ, or no more than between three.js's two renderers.
- A frame that draws no sprites does no new work. The culling shader and the WebGL2 data textures, which every other row pays for, do not change.
- A page without sprites downloads none of their code ([D-14](D-14-js-budget.md)'s rule for M2). The start stays within 140 KB after Brotli, and the sprite code's own file within 16 KB.

## Data

### Parity with three.js

Pixels that differ from three.js by its rule, Chrome on the Mac's GPU, 4 October 2026:

| Scene | Core WebGPU | Compatibility mode | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| `sprites`: 8 blended sprites at frames of an atlas, and 3 opaque sprites sized in pixels | 0.000% | 0.033% | 0.000% | 0.036% |

`bun run parity -- --scene sprites --tier webgpu,compat,webgl2` compares the `sprites` image test with the twin `bench/pages/threejs/sprites.html`. Both draw the scene of `bench/scenes/sprites.ts`. The twin draws one `Sprite` with a `SpriteMaterial` per sprite. A blended sprite's material takes a copy of the atlas whose offset and repeat pick its frame. An opaque sprite's material has `sizeAttenuation: false`, and its scale comes from the pixel size by `threeScreenScale`. Overlapping sprites at different depths check the sort. Turned sprites and a white mark at the top of each frame check the rotation and which way is up.

### 100,000 sprites

The `sprites-100k` image test draws one dynamic batch of 100,000 sprites in one draw, on all three tiers. The Mac's GPU drew it on each tier, blended and opaque, in under 4 s a test. CI's software GPU takes tens of seconds for 100,000 rows on WebGPU, as for S1's boxes. A blended field took about a minute there, so the test draws the field opaque, and the `sprites` scene checks blending and sorting.

A sprite costs what an instance row costs on the GPU and in culling: the same 48-byte matrix, the same culling, the same draw. The batch's update differs. It packs each sprite one at a time, where a mesh batch composes four rows at a time with SIMD. The packing has no trigonometry: the shader turns the corners. The S1 benchmark page takes a `sprites` switch, which draws S1's swarm as one dynamic batch of blended sprites. A timed run of S1 against S1 with `?sprites` gives the cost per sprite against S1's cost per row. It waits for a quiet Mac. With the switch, the allocation check passes on both GPU paths, and no place of the sprite code allocates ([Benchmarks](../benchmarks.md#allocation-and-profiling)).

### Download size

Sizes after Brotli from `bun run build:check-size`, against main at 9ef7c7a (#265), 4 October 2026. A pipelined page on main downloads 99.9 KB at its start, of the 100 KB budget that held before M2-R5.

| Version of the sprite code | `sketch-worker.js` | `page-sketch-runner.js` | Largest shader file | Pipelined start |
| --- | --- | --- | --- | --- |
| main, no sprites | 28,552 bytes | 24,620 bytes | 23,285 bytes | 99.9 KB |
| All sprite code in the start, `createSprites` returns the batch | +623 bytes | +569 bytes | +692 bytes | 101.2 KB |
| Sprite code on first use, `createSprites` returns a promise | +299 bytes | +340 bytes | +692 bytes | 100.9 KB |

The sprite templates added their WGSL and GLSL to every shader file, as each feature's shaders did (D-13). That growth alone took the start past 100 KB, so sprites fit only with M2-R5's budget of 140 KB. Since [D-56](D-56-first-use-shader-files.md), the templates load on first use, in files of 2.9 to 4.7 KB after Brotli. The sprite code that loads on first use is one file of 641 bytes. The page and the sketch worker build the same file, so both threads load it from one address.

## Decision

1. A sprite batch is an instance batch of the core, with a flag and rows of its own. It keeps its positions where every batch keeps them. So grid cells, active counts, dirty marks, layers and uploads work as they do for any batch. In place of quaternions and scales, it holds sizes (2 floats), rotations in radians (1), linear colors (4) and atlas frames (one 32-bit integer).
2. The batch's update packs each sprite into the row's 3 x 4 world matrix, in `null3d_core::sprites`. The width and the height sit on the diagonal, and the position relative to the row's cell in the last column. The other entries hold the rotation, the color and the frame bits as small values. The rotation and the color are multiplied by 2^-20, and the frame bits by 2^-32. The factors are powers of two, so the shader multiplies each value back exactly.
   Culling takes a row's radius from the matrix's longest column. That column stays the larger side, because the packed values add a few thousandths at most. So the culling shader, the WebGL2 data textures, the cell offsets, the transparent pass's sort and its uploads take sprite rows unchanged. The frame bits hold the frame's column, its row from the image's bottom, and a bit for sizes in pixels.
3. Two templates draw sprites: `SPRITE` (22), with the material's color alone, and `SPRITE_MAP` (23), which samples the map at the sprite's frame. A sprite material with a live map draws with the second, as `UnlitMap` falls back to `Unlit`. The vertex shader moves each corner of a unit quad across the screen as three.js's sprite shader does. It scales the corner by the size and turns it by the rotation. Then it adds the corner to the center's clip position, times the projection's scale along x and y. That scale is the length of each of the first two rows of the view-projection matrix, because the camera's rotation keeps lengths.
4. Without size attenuation, sizes are in CSS pixels. The frame uniform's spare `camera_range.zw` carries the change in normalized device coordinates across one CSS pixel. It comes from the pixel ratio that the sketch runner passes to the core (`setPixelRatio`). Such sprites have no bounds in the world. So the core gives them an unbounded sphere, and the GPU culling's bucket takes `UNCULLED_BOUNDS`.
5. The anchor, three.js's `center`, moves the quad mesh: each batch's quad has its anchor at the origin, and batches with one anchor share the mesh. The mesh's radius then bounds the sprite at any rotation. The atlas sets the material's texture coordinate transform to one frame's size, and the frame's column and row move the coordinates in the vertex shader.
6. Sprite batches stayed out of the depth prepass at first, which places vertices by the mesh's template. Since M2-F2 they draw their depth with their own vertex shader, as custom materials do ([D-43](D-43-webgl2-prepass.md#custom-materials-and-sprites)). They stay out of the scene's raycast trees too, whose items have boxes in the world. Batch rows cast no shadows yet, so sprites cast none.
7. The sprite code loads on first use, as [D-14](D-14-js-budget.md)'s rule for M2 asks. The call `scene.createSprites` checks the options first, so a wrong atlas or center fails before any download. Then it imports `scene/sprites.ts` and returns a promise of the batch. That module holds the `SpriteBatch` class, and makes each batch's quad and material. Like the glTF loader, it imports only constants and types. A value that it shared with its thread's first file would go into a file of its own. Every page would then download that file at its start. So the sketch runner hands the scene the engine's geometry and materials, for the module to use. The size report lists the module's file apart from the start. The engine test of first-use files checks that a page without sprites downloads neither.

## Options rejected

- A draw path of its own, as the debug lines have: a vertex buffer of sprites, uploaded from the typed arrays. It needs its own culling and its own cells for precision far from the origin. Its sort must also mix by hand with the transparent pass's. The instance path has all three on both GPU paths already.
- Color and frame as an extra instance attribute. WebGPU reads each instance's ids from a fourth `vec4u`, whose last three words are free. But the culling shader would need a buffer of colors and frames to copy from. WebGL2 would need a fourth texel per row in its data textures, which every row of every batch would pay for in memory and uploads. M2-K2's custom attributes may take that route later.
- `scene.createSprites` that returns the batch at once, with its code in every page's start, as three.js makes a `Sprite` at once. It cost a pipelined page's start 623 bytes, where the call and its checks cost 299. D-14's rule for M2 keeps a feature's code out of the start of pages that do not use it. The promise costs a page with sprites one round trip at its first batch, in the setup function. A sprite batch with a map waits for its texture's download too.
- Rotation as a quaternion about the view axis, written into the batch's rotations. Sketches would build a quaternion per sprite for one angle, and three.js's `SpriteMaterial.rotation` is an angle.
- Colors in 8 bits. Linear 8-bit colors band in the dark. The packed floats keep full precision, and allow components up to 1,024 for bloom.
- Sizes without attenuation as a fraction of the view's height, as three.js's sprites take them. Pixels are what markers and icons need, and points (M2-G2) take pixels as three.js's `PointsMaterial` does. The docs give the conversion.
- A separate camera right and up vector in the frame uniform for billboarding. The view-projection's rows give the same offset in clip space with no new uniform, for perspective and orthographic cameras.

## Consequences

- Code: `crates/null3d-core/src/sprites.rs`, the sprite rows of `instances.rs`, `Shading::Sprite` and `SpriteMap` in the renderer, the templates `SPRITE` and `SPRITE_MAP`, `wgsl/sprite.wgsl`, the core calls `createSpriteBatch` and `setPixelRatio`, `scene/sprites.ts`, which loads on first use, and `scene.createSprites`.
- Tests: the core's packing and update tests, the render crate's `sprites.rs`, `scene/sprites.test.ts`, the image tests `sprites` and `sprites-100k`, and the parity scene `sprites`.
- Docs: `api/sprites`, the mapping's `sprite` entry, and both skills.
- M2-G2's points draw on this path: a point is a sprite with one size, and the sprite shaders read its rows. [Points](#points) gives the choices.
- M2-H1's batch origins apply to sprite batches as to any batch.

## Points

### Question

1. How do points of three.js's `Points` and `PointsMaterial` reach the GPU? WebGPU draws point primitives one pixel wide only, and WebGL caps their size at a limit that each GPU sets.
2. What does a point's size mean with size attenuation, where three.js's rule depends on the camera's field of view?
3. What do points add to a page's download?

### Rule

- Points draw the same on all three tiers, at any size.
- The parity scene passes three.js's rule against `Points`, or a limit whose reason is a GPU path's sampling, not the points.
- A page without points or sprites downloads none of their code. A frame that draws no points does no new work.

### Data

Pixels that differ from three.js's WebGLRenderer by its rule, 5 October 2026. three.js's WebGPURenderer draws `Points` one pixel wide, so it cannot be the reference:

| Scene | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `points`, Chrome on the Mac's GPU | 0.056% | 0.110% | 0.020% |
| `points`, SwiftShader on the Mac | 0.079% | 0.119% | 0.001% |

`bun run parity -- --scene points --tier webgpu,compat,webgl2` compares the `points` image test with the twin `bench/pages/threejs/points.html`. `CI=1` runs it on SwiftShader. Both draw the scene of `bench/scenes/points.ts`. It holds opaque squares sized in world units at seven depths, cut-out discs of a map, see-through discs, and squares sized in pixels. The twin draws each cloud as one `Points` with vertex colors, and converts each world size with `threePointSize`. three.js takes its `size` and `scale` uniforms from the renderer's size and pixel ratio. So the twin sets the renderer to the image's size at a ratio of 1.

On WebGL2, SwiftShader matches three.js in all but 3 pixels. The edges of the floor and the wall differ in every scene. Every other differing pixel lies on a point's edge that crosses a pixel:

- On WebGPU, SwiftShader differs only at the top and bottom edges of 7 squares, by one row each. WebGPU's samples within a pixel lie mirrored top to bottom against WebGL's, so such an edge covers other samples. The sprites scene shows none of this, because three.js's WebGPURenderer is its reference there.
- On the Mac's GPU, the same two edge rows differ on all three tiers, WebGL2 included. One covered 50% of a pixel in null3D and 62% in three.js, and the other 100% against about 85%. So that GPU puts the edges of a WebGL point a little apart from the edges of two triangles. The other 31 squares match, and the cut-out discs differ in 15 edge pixels.
- In compatibility mode, the 8-bit path averages the samples of an edge after it encodes them, as in the glTF instancing and morph scenes. The edges of bright squares on the blue wall and of the dark marks on the see-through discs differ.

So the parity scene takes a limit of 0.2%, as the morph scene does.

Sizes after Brotli from `bun run build:check-size`, against main at 91c7d279d (#303), 5 October 2026:

| File | main | With points | Growth |
| --- | --- | --- | --- |
| `js/page-sprites.js`, the sprite code that loads on first use | 641 bytes | 851 bytes | +210 bytes |
| `js/sketch-worker.js` | 37,547 bytes | 37,705 bytes | +158 bytes |
| `js/page-sketch-runner.js` | 33,146 bytes | 33,273 bytes | +127 bytes |
| A pipelined page's start | 121.5 KB | 121.6 KB | Within the 140 KB budget |

The WebAssembly files and the shader files do not change. The start grows by `scene.createPoints` and its checks.

### Decision

1. A point batch is a sprite batch: one sprite row per point, with one frame, no rotation and the middle as its anchor. The class `PointBatch` wraps a `SpriteBatch` and shows only `positions` and `colors`. So points take the sprite path's culling, sorting, cells, origins, depth prepass and both GPU paths. They need no new core, shader or GPU code.
2. All points share one size, as `PointsMaterial.size` is one value. The size stays in every row's matrix, because culling reads a row's radius from it. `setSize` writes every row's size and marks every row. A sketch that needs a size per point uses sprites.
3. With size attenuation, the size is in world units, as a sprite's is. three.js scales a point by half the canvas's height over its depth, with no projection. So its size in the world is its `size` times `tan(fov / 2)`. That size changes with the field of view. The author's size reads as a size in the world only at a field of view of 90 degrees. World units keep the author's intent at every field of view and match sprites. The port skill and the mapping give the conversion, as [D-52](D-52-intent-parity.md) asks.
4. Without size attenuation, the size is in CSS pixels, as three.js's is (`size` times the pixel ratio in device pixels). Such points get the sprites' unbounded sphere, so they are never culled.
5. Points are opaque by default, as `PointsMaterial` is: `transparent` is false by default. `transparent` maps to `alphaMode: 'blend'`, and `alphaTest` to `'mask'` with `alphaCutoff`.
6. `colors` takes 3 numbers per point, as three.js's color attribute and line batches do, or 4 with alpha. The row array always holds 4.
7. The points code lives in the sprite module, `scene/sprites.ts`, which loads on first use. Points need no module of their own: their code is a small wrapper, and a page with points needs the sprite code anyway. The scene checks the arrays and the size, which throw E1206, E1108 and E1203, before the download.

### Options rejected

- Point primitives where the GPU path allows them: WebGL2 for sizes under its limit, WebGPU for one-pixel points. It needs a second draw path with its own culling and sort. Its look depends on each GPU's size limit, and its points vanish when their centers leave the screen.
- three.js's size rule with size attenuation. Ported sizes would keep their look with no conversion. But a size would then depend on the field of view, unlike every other size in null3D. A zoom by field of view would keep points the same size on screen while everything else grows.
- The size in the material, as a uniform, with rows that hold only positions and colors. The culling shader and the WebGL2 culling read each row's radius from its matrix. A uniform size would need a culling path of its own. It would save `setSize` its pass over the rows, which sketches rarely call.
- A point module of its own. It would add a file to download beside the sprite module, for a wrapper of a few hundred bytes.

### Consequences of points

- Code: `PointBatch`, `PointOptions` and `pointBatch` in `scene/sprites.ts`, and `scene.createPoints`, which shares `spriteBatch` with `scene.createSprites`.
- Tests: the points tests of `scene/sprites.test.ts`, the image test `points`, and the parity scene `points`.
- Docs: `api/points`, the mapping's `points` entry, E1206 and E1406, and both skills.
