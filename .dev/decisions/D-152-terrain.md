# D-152: The terrain add-on

Status: decided by the helper of M2-EX35, for the owner's review. Built: the terrain add-on is on main (`64439513b`). Not measured yet: a timing run of its frame cost. The owner's review is pending. Task: M2-EX35.

Summary: `@null3d/terrain` draws a height field as a camera-centered quadtree of blocks, fine near the camera and coarse far away, with skirts over the seams. A block splits by the screen error of its cells, measured from the camera's 3D distance to each block's height box. Every pixel lights from a normal map baked over the whole ground, so a coarse block keeps the hills' relief. Up to four tiled color layers blend by a splat map, and each layer's own height shows it through its neighbours at a boundary. `heightAt` and `normalAt` place what stands on the ground, which has no collision. Built on public API only, it draws about 200 blocks and 130,000 triangles over a 1,200 meter ground, and a sketch without it pays nothing.

## Question

The owner moved terrain into M2 ([D-142](D-142-more-techniques-before-1-0.md), after [D-132](D-132-showcase-look-and-features.md)). Battle's hills and Creek's valley need ground that is fine near the camera and cheap far away, with several materials blended over it. The technique review's section 13 describes terrain as a separate package, `@null3d/terrain`, built only on public APIs ([the technique review](../technique-review.md)). Which technique draws the ground, how does the package build it, how does it close the seam between two levels, how do the layers blend, and how does the shader reach a project that installs the package?

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
| A: a camera-centered quadtree of blocks, one mesh each, heights baked from the field on the CPU | the plan's fit, with the heights baked instead of read in the vertex shader | Chosen |
| B: one grid mesh drawn as an instance batch, heights read from a height texture in the vertex shader | the plan's fit as written | Rejected for now |
| C: a uniform grid of tiles, each with the engine's `mesh.setLevels` | geomipmapping, three.js's `LOD` | Rejected |

Option B is the cleanest in theory: one draw call, heights in the vertex shader, and the per-instance data says which block. It needs a custom material's vertex stage to read a height texture and per-instance data that the public API does not expose to a custom surface function. It also needs the level morph, since a block that grows its cells must move them. Option A bakes the heights into each block's mesh, so it needs no vertex texture read and no per-instance node table, and it uses only `geometry.fromArrays`, `scene.createMesh` and `materials.shader`.

Option C gives a fixed tile grid. To keep a large ground detailed near the camera and coarse far away, the finest tiles must cover the whole ground, which is far too many vertices and draw calls. A camera-centered quadtree spends its vertices where the camera looks.

### How the seam between two levels closes

| Option | Verdict |
| --- | --- |
| A: a skirt that hangs from each block's edge, a little below the ground | Chosen |
| B: a vertex morph that moves each edge vertex to the coarser level's place, as Strugar's CDLOD does | Rejected for now |
| C: a restricted quadtree, so neighbors differ by one level, with stitched edges | Rejected |

Option B needs a per-block morph factor in the shader, so each block would take its own material or its own uniform write. The engine's custom materials hold their uniforms per material, and a material per block would cost a pipeline state change per block. Option C needs the selection to know each block's neighbors and a stitch at every level change. Option A costs a few dozen extra vertices per block and no state change, and it hides the seam wherever the two surfaces differ. Its known limit: on a very steep seam a thin sliver of the skirt can still show. The add-on records the difference from Strugar's CDLOD in its docs.

### How the layers blend

| Option | Verdict |
| --- | --- |
| A: a custom surface function that samples four tiled maps and blends their base color and roughness by a splat map | Chosen |
| B: per-vertex colors baked from the layers | Rejected: no tiling detail |
| C: one albedo map baked for the whole ground | Rejected: the fine tiling of a large ground does not fit one texture |

Each layer also carries a height at each texel, and that height offsets its weight before the layers normalize. Two layers at equal weight then meet where their heights cross, in ragged patches that follow each map's own detail, rather than in a smooth cross-fade. The method is Mishkinis's height-based blending (GPU Pro 4, 2013). The height comes from the map's brightness by default, because the maps that `terrainTextures` makes keep a full alpha channel, and its light and dark texels already separate grass, soil, rock and snow. A caller whose map keeps a height in its alpha channel sets `heightFrom: 'alpha'`. `contrast`, from 0 to 1 and 0.5 by default, sets how far a layer's height moves its weight. A contrast of 0 restores the plain splat blend, and the image test compares the two.

Rejected: a separate height map for each layer. A fifth texture per layer would cost a slot and an asset, and a port has no height maps of its own.

### How a pixel lights

| Option | Verdict |
| --- | --- |
| A: a normal map baked per pixel over the whole ground, from the height field's central differences | Chosen |
| B: the mesh's vertex normals | Rejected: a far block's cells are larger than the height samples, so the far hills shade flat |
| C: the field's normal in the vertex shader | Rejected: the engine's custom surface function reads no vertex texture, and a coarse mesh still has too few vertices |

The normal map is `rgba8` at the height field's resolution, with mip levels, built on the CPU in the sketch worker when the terrain is made. It stores the normal's x and z, each remapped to a byte, and the surface rebuilds y from the unit length and renormalizes. It is the material's sixth texture beside the splat map and the four layer maps. `bakedNormals: false` skips the texture and lights from the mesh's own normals, which the image test uses to show the difference.

### How a block splits

| Option | Verdict |
| --- | --- |
| A: a screen-space error of the block's cell, with the camera's 3D distance to the block's height box | Chosen |
| B: the camera's distance across the ground alone, as a multiple of the block's size | Rejected: a high camera keeps full detail under it, and the field of view does not count |
| C: the height range of the block projected to pixels | Rejected: the range overstates the error of a smooth hill, and picks far more blocks than it needs |

The block splits while one cell of its grid would project to more screen pixels than the allowed error. The cell's world size, the vertical field of view, the drawing buffer's height and the 3D distance to the block's height box set that projection. A narrow field of view then keeps detail farther out, and a camera high above the ground draws the ground under it coarser. The height boxes come from the field's samples once, when the quadtree is made, so a selection reads no heights. The `error` option names the allowed error in pixels, and its default is 35 times the quality preset's `lodThreshold`: Low doubles the threshold and draws coarser ground, as it does for a mesh's levels of detail ([D-137](D-137-lod-groups.md)).

The relation keeps the earlier default look. At 1,080 device pixels and a 52 degree field of view, an error of 35 pixels of a 16 cell grid puts the split distance at about twice the block's size, as the earlier rule did. The High preset's 208 blocks and 133,120 triangles for a 1,200 meter ground are the earlier figures for that reason.

### How the shader reaches a project that installs the package

The null3D Vite plugin compiles a project's own WGSL, and it skips `node_modules`, as [D-54](D-54-addon-modules.md) says. A tagged literal in the package's own source would stay an uncompiled string once the package is built into `lib/`, and `materials.shader` would refuse it. So the surface function lives in `packages/terrain/src/terrain.wgsl` and the module imports it.

The pack step compiles that file, as [D-54](D-54-addon-modules.md) requires: the built module imports `terrain.wgsl.js`, which holds the compiled shader, and a module for each set of the material's builds sits beside it. A project that installs the package takes the compiled form as it is, and a page that loads the package from a CDN can load it. No raw `.wgsl` file leaves the repository. The plugin still writes `terrain.wgsl.d.ts` beside the source file, as it does for any `.wgsl` file, so TypeScript sees the uniforms and the texture names, and the pack copies that declaration into `lib/`.

Rejected: copying the raw file into `lib/` for the user's plugin to compile. It keeps the package small, but it costs every project a shader compile, and it leaves a CDN page with a file that a browser cannot import.

## Data

**Blocks and triangles.** The quadtree's selection is scale-invariant: with the same `maxLevel`, error and view, a ground of any size picks the same blocks, because the error is a share of a block's cell. A unit test and the numbers below come from the selection alone, which allocates nothing:

| Ground | `maxLevel` | `error` | Blocks | Triangles | Blocks by level |
| --- | --- | --- | --- | --- | --- |
| 1,200 m | 6 | 35 | 208 | 133,120 | 48, 48, 48, 64 |
| 1,200 m | 6 | 70 | 64 | 40,960 | 12, 12, 12, 12, 16 |
| 512 m | 5 | 35 | 160 | 102,400 | 48, 48, 64 |

The camera stands at ground level in a flat field, at 1,080 device pixels and a 52 degree field of view. An error of 35 is High's default, since the preset's `lodThreshold` is 1, and 70 is Low's. A camera 500 m above the same ground picks 52 blocks instead. Each block draws a 16 x 16 grid, 512 triangles, and a skirt of 128 triangles. The count does not grow with the ground's size. This is the frame's draw-call count and its vertex work; the fragment work scales with the pixels the ground covers. The figure is from the selection, not from a timing run. A timing run needs the browser queue and the display at its full rate, and none is taken yet. Until one is, the record gives the frame cost as the block and triangle counts, per preset.

**Unit tests.** `bun run test` covers the height field (bilinear reads, the edge clamp, the range, the slope, the normal, and the normal map), the quadtree (the leaves tile the square exactly, the near ground is finer than the far ground, a high camera draws coarser blocks than a low one, a narrow field of view keeps detail farther out, a block's height box counts in the distance, an error of 0 keeps the finest level, the same camera gives the same leaves, every key is unique) and a block's arrays (the grid sits on the ground, the skirt hangs below it, the positions are relative to the block's corner, every index names a vertex). The tests import no engine code, so they run without a browser.

**Cost when unused.** A sketch that never imports `@null3d/terrain` downloads none of its code, creates no material and draws no block. The package's JavaScript is in the sketch's own bundle and is not part of the engine's page start, so the engine's size budgets do not change.

## Decision

Option A for the ground, a skirt for the seam, a custom splat surface function, and a `.wgsl` file in the package. The add-on is `@null3d/terrain`, built only on public APIs.

## Consequences

- The add-on `@null3d/terrain`: `createTerrain(ctx, options)` and the `Terrain` class, the `Heightfield`, the `Quadtree`, the splat material and `terrainTextures`. `terrain.update(eye)` rebuilds only when the camera crosses a cell of the finest level, rises by one, or changes its lens, so a still camera costs no work. `heightAt` and `normalAt` place objects. No collision.
- The tools: the pack step compiles a package's `.wgsl` files into modules in `lib/`, beside their declarations. This serves any add-on that ships a surface function.
- The engine: no change. The add-on adds no template, bind layout, permutation bit, opcode, state flag, control slot, format, capability or error code.
- Docs and skills: `api/terrain`, the three.js mapping's terrain entry, and the develop skill's quick reference and recipe.
- A demo, `examples/terrain`, and an image test on all three GPU tiers. The image test's references show the baked normals and the height blending. `tests/image/terrain-shading.spec.ts` compares each feature with its own switch, so a picture that loses the feature could not match the reference.
- Limits: the ground carries no collision, the seam closes with a skirt rather than a morph, and a layer carries a color, a roughness and a height, not its own normal or occlusion map. The demo, the image test and the allocation switch exercise the add-on; no timed benchmark scene uses it.

## The frame path allocates nothing

`terrain.update(eye)` takes the camera's world position in one array that the caller keeps, and reads the x, y and z from it. A fraction that crosses a call the browser does not inline becomes an object of its own. The camera's position is a fraction, so an `update(x, y, z)` would allocate in every frame. The impostor add-on takes the camera's position the same way. So both add-ons ask a sketch for the same thing: one array, kept by the caller, passed once a frame.

Three more habits keep the frame path free of allocation, in the add-on and in the engine's vertex update. Each is in the [implementation notes](../implementation-notes.md#hot-paths-without-allocation).

- A leaf key stays inside the small-integer range. `quadtree.test.ts` fails on a leaf key above it.
- The quadtree's selection calls neither `Math.hypot` nor `2 ** level`.
- `updateVertices` searches its attribute table without a callback that closes over the attribute's name.

`bench:allocation --terrain` passes at 308.1 bytes per frame, and every terrain place is under the 4 byte budget.

## Visibility, the build limit and large splits

- **Visibility.** The terrain keeps the list of blocks that draw, and `setVisible` shows or hides only those. A hidden ground stays hidden through updates. The cache keeps up to `maxBlocks` blocks of earlier selections, at every level, and `update` does nothing while the camera stays in its cell. Showing every cached block would draw coarse and fine blocks over the same ground until the camera moved.
- **The build limit.** `update` builds at most `blocksPerUpdate` blocks, 16 by default, per call. Crossing the edge of a coarse block needs up to 30 new blocks at the defaults, and about 70 on a 10 km ground. Each needs its grid of heights and normals, a mesh upload and a scene object. Until the new selection is complete, the ground draws the last complete one, which tiles the whole ground, so no hole shows. The first update builds its whole selection, since there is nothing to draw before it. A block that draws keeps its mesh until the newest selection is built, so a build that finds no free mesh makes one rather than taking it from the ground on screen. One pass over the map finds the block that waited longest for a mesh.
- **Large splits.** The selection's arrays grow when a selection needs more, and `split` must be at most 8, about 8,000 leaves at 15 levels. A 10 km ground at 15 levels picks 4,798 leaves at a split of 6. Arrays of a fixed 4,096 leaves would drop the writes past their end while the count kept them, so blocks would get a `NaN` key and origin.

`packages/terrain/src/terrain.test.ts` drives `Terrain` through a fake sketch context and checks each case: the selection always tiles the ground once, the build limit, the old ground while the new one builds, `setVisible`, eviction and `destroy`.

## References

- The technique review's section 13 places terrain after 1.0 as a package of its own, after Strugar (2010), CDLOD.
- [D-142](D-142-more-techniques-before-1-0.md), which moved terrain into M2.
- [D-54](D-54-addon-modules.md), the add-on rules.
