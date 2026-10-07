# D-46: Wide lines

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-G3.

Summary: A line batch is an instance batch with one row per segment between its points, which packs the segment's middle, half, end colors in 8-bit sRGB, dash distance and width into the row's world matrix. The `LINE` template follows three.js's `LineMaterial`, and matches `Line2` exactly on WebGL2; lit lines add the `LINE_LIT` template. Both add 2.0 to 2.9 KB to each shader file, and the line code loads on first use.

## Question

1. How does a batch of lines reach the GPU? It can use the rows, culling and sorting of instance batches, as sprites do ([D-37](D-37-sprites.md)). Or it can have a draw path of its own, as the debug lines have.
2. A segment needs two end points, two colors and its distance along the line, for dashes. A vertex shader reads 12 floats per instance on both GPU paths: the row's world matrix, as hard rule 7 allows. How do the segment's values fit them?
3. How does a line look, and how do three.js's lines map onto it? three.js draws wide lines with `Line2` and `LineMaterial`, and one-pixel lines with `Line`, `LineSegments` and `LineLoop`.
4. Should lines take the scene's lights, and what does that cost?
5. What does the line code add to a page's download?

## Rule

- A line's look is chosen on quality ([D-52](D-52-intent-parity.md)). The width, colors and dashes that an author sets are intent, so a port's settings must keep their meaning.
- While the line shader follows `LineMaterial`'s steps, the parity scenes keep three.js's rule against `Line2` with `LineMaterial`, and against `LineBasicMaterial` and `LineDashedMaterial`. Under 0.1% of the pixels differ, or no more than between three.js's two renderers.
- Lines of any width draw the same on all three tiers.
- A frame that draws no lines does no new work, and a page without lines downloads none of their code ([D-14](D-14-js-budget.md)'s rule for M2).
- 100,000 segments that move every frame allocate nothing per frame in the engine's code.

## Data

### Parity with three.js

Pixels that differ from three.js by its rule, Chrome on the Mac's GPU, 4 October 2026. Each tier compares with three.js's renderer on the same API, as `bun run parity` does: WebGPU and compatibility mode with `WebGPURenderer`, WebGL2 with `WebGLRenderer`.

| Scene | Core WebGPU | Compatibility mode | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| `lines`: wide lines against `Line2` and `LineSegments2` | 4.391% | 0.974% | 0.000% | 4.681% |
| `lines-basic`: one-pixel lines against `LineBasicMaterial` and `LineDashedMaterial` | 0.111% | 0.313% | 0.129% | 0.319% |

Against `WebGLRenderer` on every tier, the `lines` scene differs in 0.412% of the pixels on core WebGPU and 4.418% in compatibility mode.

`bun run parity -- --scene lines,lines-basic --tier webgpu,compat,webgl2` compares the image tests with the twin `bench/pages/threejs/lines.html`. Both draw the scenes of `bench/scenes/lines.ts`. A zigzag 12 pixels wide shows the round joins at its sharp corners. A helix 5 pixels wide has a color at each point. Pairs of points make separate segments. Then come a dashed wave, a loop 0.12 world units wide, and a blended line 14 pixels wide over the others. The twin draws a loop as a strip that ends at its first point, because `Line2` has no loop and `WebGPURenderer` draws no `LineLoop`.

- WebGL2 matches `Line2` exactly: the shader follows `LineMaterial`'s vertex and fragment steps one for one.
- The blended line accounts for most of the WebGPU figures. The core WebGPU path blends linear colors in its HDR scene color. `WebGLRenderer` does the same into its sRGB target. The compatibility mode blends colors after it encodes them for the screen, and so does `WebGPURenderer`. So each path matches the three.js renderer that blends as it does. three.js's two renderers differ by more than null3D differs from either.
- The rest are edge pixels, on the boxes as much as on the lines. The WebGPU paths resolve their samples before the final pass, as for every scene.
- One-pixel lines differ more. three.js draws them as the GPU's own lines, one pixel wide with no caps. null3D draws them as quads 1 CSS pixel wide with round ends. The GPU's line rules differ between three.js's two renderers by more again.

### Lit lines

Lit lines need a second template, `LINE_LIT` (30), and shading code 7, with the same permutations as the unlit template. Lit lines have no three.js twin: the `lines-lit` image test draws them on all three tiers.

### Download size

A page downloads one shader file, and every shader file holds both line templates. Each file's growth against main at a8bf5ed (#272), after Brotli at quality 11, 4 October 2026:

| Shader files | Both templates | `LINE_LIT` alone |
| --- | --- | --- |
| The 8 files without half precision | 1.97 to 2.54 KB, 8 to 10% | 0.38 to 0.52 KB |
| The 4 half precision files | 2.46 to 2.93 KB, 10 to 12% | 0.79 to 0.96 KB |

The `LINE` template's own vertex and fragment code is about 1.8 KB of it, against 0.7 KB for both sprite templates. A first version of the vertex stage changed variables in place, and the shader compiler wrote each change out as new temporaries. Written with constants and selects instead, it saves about 0.3 KB per file. The half precision files grow more for lit lines. Their lit template uses `null3d::half`'s lighting, so the full-precision lighting of lit lines shares no text with it. A pipelined page's start grows from 100.6 KB to about 103.6 KB of its 140 KB budget. The coordinator accepted this on 4 October 2026, and noted a later change: shader text of features that load on first use could load with them.

Since [D-56](D-56-first-use-shader-files.md), both templates load on first use with the line code, in files of 5.6 to 7.6 KB after Brotli. The start shader files no longer hold them.

The line code that loads on first use is one file of 0.9 KB after Brotli, which both threads load from one address. Each WebAssembly file of the core grows by 2.0 to 2.1%, about 4.5 KB after Brotli, for the line rows of the batch update.

### Allocation

`bun run bench:allocation --lines` draws S1's swarm as one dynamic batch of 100,000 dashed segments, whose points move and whose dashes move every frame. On 4 October 2026 both GPU paths passed. On WebGPU the sketch worker allocated 263.6 bytes per frame and the render worker 492.0. On WebGL2 they allocated 332.3 and 139.4. Each place is one that every frame of S1 has, and no place of the line code showed in the samples.

## Decision

1. A line batch is an instance batch of the core, with points in place of rows. It owns the points and their linear colors, and has one row per segment. The mode says which points each segment joins. A strip joins each point to the next, a loop also joins the last to the first, and `segments` joins points in pairs. Active counts and dirty marks count points. The batch turns them into the rows of the segments that use those points. So grid cells, culling, layers, the transparent pass's sort and uploads take segments unchanged on both GPU paths.
2. The update packs each segment into its row's matrix, in `null3d_core::lines`. The middle sits in the last column, relative to the row's cell. The update writes it as the row's position too, which places the row in its cell. The first column is the half segment, from the middle to the end point. The second holds the end colors and the distance before the segment. The third holds the width, the look bits (world units, dashes), and the reach. Each value but the reach is multiplied by 2^-32, so the shader multiplies it back exactly and culling's radius never grows by it.
3. Each end's color is three 8-bit sRGB codes in one 24-bit whole number, which a float holds exactly. Two colors, the distance, the width, the look bits and the reach fill the 6 floats that the middle and the half segment leave. The update encodes each channel with a binary search over the 255 bounds between the sRGB codes, so it needs no power function per channel. Colors given as sRGB hex strings come back exactly.
4. Culling takes a row's radius from its longest column, times the radius of the batch's mesh. The segment mesh's corners lie within one unit of its origin. The reach is half the segment's length, plus half a width in world units. So the sphere holds the segment and its width exactly. A width in pixels has no size in the world, so the sphere holds the center line alone, as three.js's bounds do.
5. A dashed batch keeps each segment's distance along the line. The update finds the distances again from the first segment that a change reached to the end, one after another, in 64-bit floats. A dynamic dashed batch finds all of them every frame.
6. The `LINE` template (29) draws each segment as a quad with round caps, the method of `LineMaterial`'s shader. The GPU's own lines are one pixel wide on WebGPU and on most WebGL2 drivers. A quad holds any width on every tier, and the round caps close the joins at sharp corners with no geometry for the joins. The template trims a segment that ends behind the camera. It offsets each corner in CSS pixels, at right angles to the segment and out along it at the ends. It discards a cap's fragments outside a half disc. With world units, it moves the corners in the world, and keeps the fragments within half the width of the segment. Dashes discard fragments, and dashed lines have no caps. The material's custom values hold the dash size, gap size, dash scale and dash offset. So a change of the dashes writes one row, and needs no update of the segments. The width lives in the core, because culling needs it, so `lines.setWidth` packs every segment again.
7. Lines take the scene's fog, as three.js's lines do. With `lit: true` they draw with `LINE_LIT` (30). It shades the line's color as a standard material shades a surface that faces the camera. The sun, the clustered point and spot lights, the ambient light and the emissive color all count. The coordinator approved the size on 4 October 2026, while the owner was away.
8. The line code loads on first use, as sprites do. `scene.createLines` checks the points and options, then imports `scene/lines.ts` and returns a promise of the batch.
9. Line batches stay out of the depth prepass, because their fragment shader cuts out the round caps and the dashes, The prepass's fragment shader cuts nothing out, so it would write depth where the line draws nothing. They stay out of the raycast trees too, as sprite batches do. The debug lines stay one pixel wide, in development builds only.

## Options rejected

- A draw path of its own, as the debug lines have: a vertex buffer of segments with its own culling, cells and sort. The instance path has all three on both GPU paths.
- Colors in 32-bit floats. Two colors take 6 floats, and the distance, the width and the reach would not fit. Per-point colors above 1 for bloom are rare. The material's `color` above 1, or `emissive` on a lit line, makes lines bright instead.
- The width in the material only, as three.js has it. Culling then could not hold a width in world units, and segments near the view's edges would vanish while still in view.
- Each segment reading its neighbor's row for the next point, as three.js's `LineGeometry` does with two attributes over one buffer. Culling compacts the visible rows, so neighbors are not next to each other on the GPU.
- Lighting lines with the standard template. Its vertex stage places a mesh by the row's matrix, and a segment's matrix places no mesh.

## Consequences

- Code: `crates/null3d-core/src/lines.rs`, the line rows of `instances.rs`, `Shading::Line` and `LineLit` in the renderer, the templates `LINE` and `LINE_LIT`, `wgsl/line.wgsl`, the core calls `createLineBatch` and `setLineWidth`, `scene/lines.ts`, which loads on first use, and `scene.createLines`.
- Tests: the core's packing and update tests, the render crate's `lines.rs`, `scene/lines.test.ts`, the image tests `lines`, `lines-basic` and `lines-lit`, the parity scenes `lines` and `lines-basic`, and `bun run bench:allocation --lines`.
- Docs: `api/lines`, the mapping's `lines` entry and the edge and wireframe entries, and both skills.
- Line batches take M2-H1's batch origins: each point is relative to the batch's origin, and the update adds the origin to each segment's middle.
- null3D finds no edges of a mesh for lines yet. The mapping's edge and wireframe entries tell a port to build the edge points itself.
