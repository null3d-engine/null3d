# D-152: The terrain add-on

Status: decided by the helper of M2-EX35 on 13 October 2026, for the owner's review. Built: the terrain add-on is on main (`64439513b`). The owner's review is pending. Date: 2026-10-13. Task: M2-EX35.

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

- The add-on `@null3d/terrain`: `createTerrain(ctx, options)` and the `Terrain` class, the `Heightfield`, the `Quadtree`, the splat material and `terrainTextures`. `terrain.update(eye)` rebuilds only when the camera crosses a cell of the finest level, so a still camera costs no work. `heightAt` and `normalAt` place objects. No collision.
- The tools: the package build copies a package's `.wgsl` files into `lib/`, and the pack check requires them. This serves any add-on that ships a surface function.
- The engine: no change. The add-on adds no template, bind layout, permutation bit, opcode, state flag, control slot, format, capability or error code.
- Docs and skills: `api/terrain`, the three.js mapping's terrain entry, the develop skill's table, quick reference and recipe.
- A demo, `examples/terrain`, and an image test on all three GPU tiers.
- Limits: the ground carries no collision, the seam closes with a skirt rather than a morph, and the layers carry color and a roughness, not normal or occlusion maps. The demo and the image test exercise the add-on; no benchmark scene uses it yet.

## Addendum: the frame path takes the camera's position array (16 October 2026)

`bench:allocation --terrain` failed when the switch landed. The add-on's frame path allocated about
5 KB per frame, and hard rule 1 allows none. Removing the allocations found four objects per call,
and the last one decided the shape of `update`.

Three were objects the browser made inside the add-on and inside the engine's vertex update. A leaf
key was packed past the small-integer range. The quadtree's selection called `Math.hypot` and used
`2 ** level`. And `updateVertices` searched its attribute table with a callback that closed over the
attribute's name. Each is now a habit in the [implementation notes](../implementation-notes.md#hot-paths-without-allocation).

The fourth was `update(x, z)` itself. A fraction that crosses a call the browser does not inline
becomes an object of its own, and the camera's ground position is a fraction. Passing whole numbers
in place of it made the switch pass, which named the cause. So `update` takes the camera's world
position in one array that the caller keeps, and reads the x and the z from it. The impostor add-on
already takes the camera's position this way. Both add-ons now ask a sketch for the same thing: one
array, kept by the caller, passed once a frame.

A parity check covers the change. Over a 1,024 meter ground at `maxLevel` 6, 66,049 camera positions
pick exactly the same leaves as before, and every height and normal is unchanged. `quadtree.test.ts`
now fails on a leaf key above the small-integer range.

The switch passes at 308.1 bytes per frame, and every terrain place is under the 4 byte budget.

## References

- The technique review's section 13 places terrain after 1.0 as a package of its own, after Strugar (2010), CDLOD.
- [D-142](D-142-more-techniques-before-1-0.md), which moved terrain into M2.
- [D-54](D-54-addon-modules.md), the add-on rules.

## Addendum, 15 October 2026: visibility, a build limit and large splits

The code review of 15 October found three faults in `Terrain` and its quadtree.

- **`setVisible(true)` showed every cached block.** The cache keeps up to `maxBlocks` blocks of earlier selections, at every level, and `update` does nothing while the camera stays in its cell. Coarse and fine blocks then drew over the same ground until the camera moved. The terrain now keeps the list of blocks that draw, and `setVisible` shows or hides only those. A hidden ground stays hidden through updates.
- **A cell crossing built every new block in one frame.** Crossing the edge of a coarse block needs up to 30 new blocks at the defaults, and about 70 on a 10 km ground, each with its grid of heights and normals, a mesh upload and a scene object. `update` now builds at most `blocksPerUpdate` blocks, 16 by default, per call. Until the new selection is complete, the ground draws the last complete one, which tiles the whole ground, so no hole shows. The first update builds its whole selection, since there is nothing to draw before it. A block that draws keeps its mesh until the newest selection is built, so a build that finds no free mesh makes one rather than taking it from the ground on screen. One pass over the map finds the block that waited longest for a mesh.
- **A large split overflowed the selection's arrays.** The arrays held 4,096 leaves, and `split` had no upper bound: a 10 km ground at 15 levels picks 4,798 leaves at a split of 6. Writes past the end were dropped while the count kept them, so blocks got a `NaN` key and origin. The arrays now grow when a selection needs more, and `split` must be at most 8, about 8,000 leaves at 15 levels.

`packages/terrain/src/terrain.test.ts` drives `Terrain` through a fake sketch context and checks each case: the selection always tiles the ground once, the build limit, the old ground while the new one builds, `setVisible`, eviction and `destroy`.
