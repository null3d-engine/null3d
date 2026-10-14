# D-152: The terrain add-on

Status: decided by the helper of M2-EX35 on 13 October 2026, for the owner's review. Date: 2026-10-13. Task: M2-EX35.

Summary: `@null3d/terrain` draws a height field as a camera-centred quadtree of blocks. A block near the camera carries a fine grid, a far block a coarse one over more ground, and a skirt around each block hides the seam where two levels meet. Up to four tiled color layers blend by a splat map that the add-on fills from the height and the slope by default. The ground carries no collision; `heightAt` and `normalAt` place what stands on it. The package is built on the engine's public API only and reaches a project as `@null3d/terrain`, with its surface function in a `.wgsl` file that the null3D Vite plugin compiles. A 1,200 meter ground at the default settings draws about 200 blocks and about 130,000 triangles, and a sketch that never imports the package pays nothing.

## Question

The owner moved terrain into M2 ([D-142](D-142-more-techniques-before-1-0.md), after [D-132](D-132-showcase-look-and-features-2026-10-11.md)). Battle's hills and Creek's valley need ground that is fine near the camera and cheap far away, with several materials blended over it. The plan places terrain after 1.0, as a separate package `@null3d/terrain` built only on public APIs ([Technique review, October 2026](../technique-review-2026-10.md), section 13). Which technique draws the ground, how does the package build it, how does it close the seam between two levels, how do the layers blend, and how does the shader reach a project that installs the package?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)): a chunked height field with a level of detail that follows the camera, at a cost a phone can pay.
- Both backends are first-class (design principle 9): one look on WebGPU, compatibility mode and WebGL2, with image references on the Mac's GPU and on SwiftShader.
- Pay only for what you use (design principle 8). A sketch without the package downloads no terrain code, and a still camera rebuilds no block.
- No allocation per frame (hard rule 1). The selection writes into flat arrays, and `heightAt` and `normalAt` allocate nothing.
- Heavy machinery of its own is an add-on ([D-54](D-54-addon-modules.md)): the package reaches the engine only through public API, and it starts no workers.
- A glTF file or a standard scene does not need terrain, so it stays out of the core.

## Options

### How the ground is drawn

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: a camera-centred quadtree of blocks, one mesh each, heights baked from the field on the CPU | the plan's fit, with the heights baked instead of read in the vertex shader | Chosen |
| B: one grid mesh drawn as an instance batch, heights read from a height texture in the vertex shader | the plan's fit as written | Rejected for now |
| C: a uniform grid of tiles, each with the engine's `mesh.setLevels` | geomipmapping, three.js's `LOD` | Rejected |

Option B is the cleanest in theory: one draw call, heights in the vertex shader, and the per-instance data says which block. It needs a custom material's vertex stage to read a height texture and per-instance data that the current public API does not expose to a custom surface function. It also needs the level morph, since a block that grows its cells must move them. Option A bakes the heights into each block's mesh, so it needs no vertex texture read and no per-instance node table, and it uses only `geometry.fromArrays`, `scene.createMesh` and `materials.shader`.

Option C gives a fixed tile grid. To keep a large ground detailed near the camera and coarse far away, the finest tiles must cover the whole ground, which is far too many vertices and draw calls. A camera-centred quadtree spends its vertices where the camera looks.

### How the seam between two levels closes

| Option | Verdict |
| --- | --- |
| A: a skirt that hangs from each block's edge, a little below the ground | Chosen |
| B: a vertex morph that moves each edge vertex to the coarser level's place, as Strugar's CDLOD does | Rejected for now |
| C: a restricted quadtree, so neighbours differ by one level, with stitched edges | Rejected |

Option B needs a per-block morph factor in the shader, so each block would take its own material or its own uniform write. The engine's custom materials hold their uniforms per material, and a material per block would cost a pipeline state change per block. Option C needs the selection to know each block's neighbours and a stitch at every level change. Option A costs a few dozen extra vertices per block and no state change, and it hides the seam wherever the two surfaces differ. Its known limit: on a very steep seam a thin sliver of the skirt can still show. The add-on records the difference from Strugar's CDLOD in its docs.

### How the layers blend

| Option | Verdict |
| --- | --- |
| A: a custom surface function that samples four tiled maps and blends their base color and roughness by a splat map | Chosen |
| B: per-vertex colors baked from the layers | Rejected: no tiling detail |
| C: one albedo map baked for the whole ground | Rejected: the fine tiling of a large ground does not fit one texture |

### How the shader reaches a project that installs the package

The null3D Vite plugin compiles a project's own WGSL, and it skips `node_modules`, as [D-54](D-54-addon-modules.md) says. A tagged literal in the package's own source would stay an uncompiled string once the package is built into `lib/`, and `materials.shader` would refuse it. So the surface function lives in `packages/terrain/src/terrain.wgsl`, the module imports it, and the plugin compiles it in the project that uses the package, wherever the package sits. The package build now copies a package's `.wgsl` files into `lib/`, beside the JavaScript and the declarations, and the pack check requires `lib/terrain.wgsl`. The plugin writes `terrain.wgsl.d.ts` beside the file, as it does for any `.wgsl` file, so TypeScript sees the uniforms and the texture names.

## Data

**Blocks and triangles.** The quadtree's selection is scale-invariant: with the same `maxLevel` and `split`, a ground of any size picks the same blocks, because the split distance is a multiple of a block's size. A unit test and the numbers below come from the selection alone, which allocates nothing:

| Ground | `maxLevel` | `split` | Blocks | Triangles | Blocks by level |
| --- | --- | --- | --- | --- | --- |
| 1,200 m | 6 | 2.0 | 208 | 133,120 | 48, 48, 48, 64 |
| 1,200 m | 6 | 1.4 | 160 | 102,400 | 4, 36, 36, 36, 48 |
| 512 m | 5 | 2.2 | 208 | 133,120 | 40, 72, 96 |

Each block draws a 16 x 16 grid, 512 triangles, and a skirt of 128 triangles. The count is close to 200 whatever the camera does, and it does not grow with the ground's size. This is the frame's draw-call count and its vertex work; the fragment work scales with the pixels the ground covers. The figure is from the selection, not from a timing run: a timing run needs the browser queue and the display at its full rate, which the Mac's did not reach on 13 October. The record marks the frame cost as the block and triangle counts until a timing run is taken.

**Unit tests.** `bun run test` covers the height field (bilinear reads, the edge clamp, the range, the slope and the normal), the quadtree (the leaves tile the square exactly, the near ground is finer than the far ground, the same camera gives the same leaves, every key is unique) and a block's arrays (the grid sits on the ground, the skirt hangs below it, the positions are relative to the block's corner, every index names a vertex). The tests import no engine code, so they run without a browser.

**Cost when unused.** A sketch that never imports `@null3d/terrain` downloads none of its code, creates no material and draws no block. The package's JavaScript is in the sketch's own bundle and is not part of the engine's page start, so the engine's size budgets do not change.

## Decision

Option A for the ground, a skirt for the seam, a custom splat surface function, and a `.wgsl` file in the package. The add-on is `@null3d/terrain`, built only on public APIs.

## Consequences

- The add-on `@null3d/terrain`: `createTerrain(ctx, options)` and the `Terrain` class, the `Heightfield`, the `Quadtree`, the splat material and `terrainTextures`. `terrain.update(x, z)` rebuilds only when the camera crosses a cell of the finest level, so a still camera costs no work. `heightAt` and `normalAt` place objects. No collision.
- The tools: the package build copies a package's `.wgsl` files into `lib/`, and the pack check requires them. This serves any add-on that ships a surface function.
- The engine: no change. The add-on adds no template, bind layout, permutation bit, opcode, state flag, control slot, format, capability or error code.
- Docs and skills: `api/terrain`, the three.js mapping's terrain entry, the develop skill's table, quick reference and recipe.
- A demo, `examples/terrain`, and an image test on all three GPU tiers.
- Limits: the ground carries no collision, the seam closes with a skirt rather than a morph, and the layers carry color and a roughness, not normal or occlusion maps. The demo and the image test exercise the add-on; no benchmark scene uses it yet.

## References

- The technique review's section 13 places terrain after 1.0 as a package of its own, after Strugar (2010), CDLOD.
- [D-142](D-142-more-techniques-before-1-0.md), which moved terrain into M2.
- [D-54](D-54-addon-modules.md), the add-on rules.
