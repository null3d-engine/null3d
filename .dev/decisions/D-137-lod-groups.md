# D-137: Levels of detail picked by screen error

Status: accepted. The owner approved the design on 11 October 2026. The owner also chose to merge it with the forest demo as it is; a later task improves the demo's look. Date: 2026-10-11. Task: M2-I4.

Summary: `mesh.setLevels` gives a mesh levels of detail: simpler meshes, each with its error in the mesh's units. Every object and every instance batch row that draws such a mesh picks one level per frame. It picks the coarsest level whose error covers less than a pixel threshold on the screen. The GPU's culling shader picks it on WebGPU and the job workers pick it on WebGL2. Both use one stateless rule, so both paths switch at the same distances. Near a switch, the two levels cross-fade with a 4 × 4 dither, from a band of builds that only fading objects use. Shadow views pick with the main camera's position and a larger threshold, so shadows draw a coarser level. The governor's render scale feeds the rule, and a governor step raises the threshold when frames run late.

## Question

Creek needs denser forests and Night town a bigger skyline at the same cost. A far tree of 2,000 triangles covers a few pixels, and its vertex work buys nothing. three.js has the `LOD` object, and the asset tool already writes levels with their errors ([D-91](D-91-level-planning.md)). But the engine draws only the full mesh. How does the engine pick a level for each object and each instance row, on both GPU paths, without a visible pop? And what do the shadows draw?

## Rule

- Levels switch where the screen-error rule says, at the same distances on WebGPU, compatibility mode and WebGL2 (the task's done-when).
- The rule is Godot's: the coarsest level whose error, projected on the screen, is under the threshold of 1 pixel. The screen's height includes the render scale ([D-53](D-53-technique-defaults.md)).
- A switch does not pop: the levels hand over smoothly, or the record states the alternative.
- Shadows use a coarser level. A shadow never shows another level's silhouette on its own caster's surface by more than the normal bias hides.
- No cost for scenes without levels: no new upload, no shader download, no bucket and no branch that costs measurable time (design principle 8).
- No allocation per frame (hard rule 1). No new storage buffer in the culling shader, which already binds the eight that every device allows.
- A dense scene measured with and without levels on the Mac's GPU, per path.

## Options

### Where the level lives

| Option | Verdict |
| --- | --- |
| A: levels belong to the base mesh. Every object and batch that draws the mesh picks a level each frame. One source per object or row | Chosen |
| B: one object per level, as three.js's `LOD` holds one child per level, each culled with a band of distances | Rejected. A batch of 50,000 trees would need a batch per level, each with the rows' matrices, cells and uploads again. Culling work and memory grow with the levels |
| C: the sketch switches meshes with `setMesh` | Rejected. A mesh change rebuilds every draw table, records each view's bundle again and uploads every matrix |

With option A, `mesh.setLevels([{ mesh, error }, ...])` gives a mesh its lower levels, as Unity's mesh levels and glTF's `MSFT_lod` attach them to a mesh. Objects and batches keep the base mesh's id. So picking, raycasts, skinning, the software occlusion blockers and the transparent pass read the mesh as before. The glTF loader calls `setLevels` from `MSFT_lod`. Each level keeps its own engine mesh, so it draws from its own index range in the pages. It must have the base mesh's vertex attributes, as it draws with the base mesh's pipelines.

| Option | Verdict |
| --- | --- |
| The object's mesh id names a level set, with a bit of its own | Rejected. Every reader of an object's mesh (raycasts, skinning, morphs, blockers, the sorted pass, mesh destruction) would have to resolve the set first |
| A level set as a mesh of its own, sharing the base mesh's parts | Rejected. Removing a mesh moves the parts of the meshes after it, and a shared part would move under the set |

A level's bucket key holds a level bit, the base mesh's id and the level's number. So a level's bucket never merges with the bucket of an object that draws the same simple mesh as a mesh of its own.

### Picking the level

Each source keeps one entry in the bucket table, which names the bucket of its base level. Each level has a bucket of its own: one pipeline, mesh and material, as every bucket is. Each level's bucket record holds three new words: the level's error, the bucket of the next coarser level, and its fade bucket. So the culling shader walks from the base level's bucket to the coarsest level whose error passes, with no new buffer and no new table. The WebGL2 builder keeps the same links in its layout, and the job workers walk them per row.

The rule, for a source whose sphere centre lies at distance `d` from the main camera:

```text
level j draws when  error[j] × scale × k < threshold × d,  with k = render height × P[1][1] / 2
```

`scale` is the largest axis scale of the source's world matrix. Both paths compute it from the same matrix. The error grows from level to level, so the walk stops at the first level that fails. `d` is the straight-line distance. So turning the camera never changes a level. An orthographic camera uses `d = 1`, since its pixels do not shrink with distance.

| Option | Verdict |
| --- | --- |
| A stateless rule: each frame, each view picks from the distance alone | Chosen. Both paths and every view pick the same level for the same source. The fade band below does what hysteresis would |
| Hysteresis of about 10%, as the plan estimated, from a per-source record of the last level | Rejected. It needs a per-source word that the GPU writes and a per-view history, and the paths could then disagree after a camera cut. three.js's `LOD` has no hysteresis by default either |

### The hand-over

| Option | Verdict |
| --- | --- |
| Dithered cross-fade (Bevy's visibility ranges, Unity's LOD cross-fade): over a band past each switch distance, both levels draw, and a 4 × 4 ordered dither gives each pixel to one of them | Chosen. It needs no blending and no sorting, and the two levels never cover a pixel twice |
| Alpha blending of the two levels | Rejected. Both levels would sort with the transparent pass, and each pixel would shade twice |
| Geomorphing (moving vertices toward the coarser level) | Rejected. It needs vertex-to-vertex links between levels, which the simplifier does not keep, and a custom vertex path for every template |
| A plain switch at the distance | Kept for Low, where the fade is off, and for groups that turn the fade off |

The band starts at the switch distance and is 8% of it long. In it, the source draws its new level with a fade amount `t` from 0 to 1 and its old level with `1 - t`. A pixel draws the new level where its dither value is under `t`, and the old level elsewhere.

`discard` turns off hidden-surface removal on tile GPUs (Apple, PowerVR), so the fading builds must not draw the sources that do not fade. Each level's bucket therefore has a fade bucket beside it, whose pipelines are the `LOD_FADE` builds. Only sources inside a band land there. Their builds are a first-use shader set, so a page without fading levels downloads none.

The fade amount reaches the fragment shader as a flat value:

- WebGPU: the culling shader writes it into the free fourth word of the copy's ids. The sign says which side: positive for the new level, negative for the old.
- WebGL2: the index list's entries have no spare bits (23 bits of row, 9 of cell). A fade bucket's entries take two words: the entry, then the fade amount's bits. Its draw record marks the pairs, and the fading builds read both.

### Masks with alpha to coverage

Foliage draws with masks, and a mask smooths its cut edges with alpha to coverage by default. Without a fade, every tree in a forest would pop at its switches. So the fading builds also build with alpha to coverage, and with the sample mask builds that WebGPU's targets without alpha use for it.

| Option | Verdict |
| --- | --- |
| The pixel dither after the coverage test: the shader works out the coverage as before, then drops the pixels of the other level | Chosen. Each kept pixel keeps its smoothed edge, and the two levels still never share a pixel. It needs no new shader code, only the builds |
| Scaling the coverage by the fade amount | Rejected. The GPU turns the same alpha into the same samples in both levels. At `t = 0.5` both levels would cover the same half of each pixel's samples, and leave the other half empty, so the band would show holes |
| Writing each level's own samples with a sample mask | Rejected. WebGL2 has no sample mask output, so the two paths would fade differently |

The masks that test their alpha by the hash keep their switch at once, so that the fading set stays small. The same dither would work after the hash test (follow-up 3).

### Shadows

Shadow cascades, shadow tiles, mirrors and the outline view already place every source relative to the main camera. So `d` is the main camera's distance in every view, and each shadow view picks with the main camera's `k`, not its own orthographic projection. A shadow view multiplies the threshold by the preset's shadow factor, so its casters draw a coarser level. Shadow views do not fade: they draw the level that the rule picks.

| Option | Verdict |
| --- | --- |
| Shadows pick by the main camera's distance, with a larger threshold | Chosen |
| Shadows pick by the light's view | Rejected. A cascade's orthographic view would pick by the cascade's texel size, and a caster could shadow its own surface with a level far from the one the camera sees |
| Shadows always draw the base level | Rejected. The shadow passes would keep the full vertex cost of a dense forest |

Far cascades and shadow tiles keep their drawn depth between redraws. A level change then shows in them at their next redraw. That comes within the far cascades' interval, or when the tile's light or a caster moves.

### The governor

The render scale is part of the render height, so a lower scale picks coarser levels with no new step. A new governor step, after the render scale's steps, doubles the threshold, up to four times the preset's. It runs only while the scene draws a level set.

## Costs

The size check measured the two download rows on 11 October 2026, against main.

| Item | Cost |
| --- | --- |
| Scene without levels | One more word read and compared per source in the culling shader; none on the job workers, which skip the level walk while no layout has levels |
| Bucket records | 13 words in place of 10, per bucket |
| WebGPU slices | Each level's bucket and fade bucket holds a slice for every source of the set, in each view: 64 bytes per source per level per view |
| WebGL2 | Two words per fading entry; levels cost nothing while their buckets are empty, as empty draws are skipped |
| Shader downloads | The `lod_fade` set, on the first fade: 20.6 to 23.9 KB after Brotli per build, under the 32 KB first-use budget. The coverage set did not grow, as builds that fade and use alpha to coverage belong to the `lod_fade` set |
| JavaScript and WebAssembly | After Brotli: the WebAssembly glue grew 2.6 to 2.7%, the renderer page 2.3%, the main WGSL set 2.0%, and the occlusion build's culling shader 12.4% (4.1 to 4.6 KB). The WebAssembly modules grew 1.4%, about 5 KB each |

## Data

Measured on 11 October 2026 on the Mac's GPU, in Chrome, on each path and preset, with levels off and on in turns. The scene is the lod-cost test page: 40,000 instanced pines with four levels each, over hills, under the sun's shadows, seen from above the canopy. Off draws every tree's base mesh. Each figure is the median of a run. The computer's 1-minute load stayed between 4.6 and 6.8.

| Path | Preset | GPU off (ms) | GPU on (ms) | Change | Busiest CPU thread off / on (ms) |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 5.24 | 3.08 | -41% | 0.16 / 0.13 |
| WebGPU | Medium | 5.90 | 5.57 | -6% | 0.13 / 0.14 |
| WebGPU | High | 7.01 | 5.77 | -18% | 0.14 / 0.13 |
| WebGPU | Ultra | 7.34 | 5.90 | -20% | 0.13 / 0.14 |
| Compat | Low | 7.01 | 3.01 | -57% | 0.13 / 0.13 |
| Compat | Medium | 6.23 | 5.57 | -11% | 0.16 / 0.14 |
| Compat | High | 6.55 | 6.29 | -4% | 0.14 / 0.15 |
| Compat | Ultra | 8.59 | 4.06 | -53% | 0.19 / 0.19 |
| WebGL2 | Low | 8.13 | 4.07 | -50% | 0.25 / 0.34 |
| WebGL2 | Medium | 11.78 | 5.92 | -50% | 0.26 / 0.42 |
| WebGL2 | High | 14.12 | 6.36 | -55% | 0.27 / 0.41 |
| WebGL2 | Ultra | 11.83 | 5.16 | -56% | 0.28 / 0.43 |

Every run held the display's rate of 60 frames a second. So the GPU time is the figure that shows the saving. Levels cut the GPU time on every path and preset, by 4 to 57%. WebGL2 gains most: its GPU time halves at every preset. On WebGPU and compat, the saving varies more between presets, from 4% to 57%. Low gains most there: it has no fade bands and the largest threshold. This run does not split the cost of the fade bands from the other preset settings. On WebGL2, the busiest thread is the sketch worker. It takes up to 0.16 ms more per frame for the level picks and fade pairs. Each job worker takes 0.02 to 0.04 ms more. That is under 3% of a 60 Hz frame.

Other checks on the same day:

- Allocation: `bun run bench:allocation --levels` passed on WebGPU and on WebGL2. S1's 100,000 boxes pick a level and fade each frame, and no place allocates over its budget.
- GPU check: S4 and S6 have no levels. At Medium and High they kept their GPU time: +0.1% on S4 and -1.9 to -3.0% on S6.
- Image tests: the five level tests and the forest demo match their references on all three paths, on the Mac's GPU and on SwiftShader. The full Mac image suite's other 922 tests pass.

### Trees with leaf cards

Creek's trees will come from glTF files whose leaves are cards: quads with an alpha-masked leaf texture. On 11 October 2026, a test tree went through `assets optimize --lod`. It had a trunk of 384 triangles and 600 cards of 2 triangles each, 1,584 triangles in all. The tool wrote no levels for it.

The cause is in the level planner ([D-91](D-91-level-planning.md)). It locks each list's border, so the lists of a mesh still meet. Every vertex of a card lies on the card's border, so no card can lose a triangle. The trunk halves to 192 triangles, but the step keeps 1,392 of 1,584, more than three quarters, and the planner stops before the first level. Without the lock, meshopt's simplifier folds each card into one triangle. That cuts away half of each card's leaf texture, so it is no answer either.

So for trees with leaf cards, the planner needs a step of its own for lists of separate cards. The step keeps a share of the cards, spread evenly over the crown. It grows each kept card, so that the crown keeps its cover. The error of such a level is the size of the cards it drops. Until then, an author can make the levels in Blender and export them with `MSFT_lod`, which the loader reads. The forest demo's procedural pines make their levels in code.

## Decision

Ship the design as above. The data shows a clear saving on every path and preset, and no cost for scenes without levels.

## Consequences

- Skinned and morphed objects draw their base level: their vertices come from regions of their own, which levels do not have yet.
- Blended and transmissive sources draw their base level: the transparent pass sorts them on the job workers with buckets of its own.
- Custom materials, and masks that test their alpha by the hash, switch levels at once: their builds have no fading level. Masks with alpha to coverage, the default for foliage, fade. The dither drops whole pixels after the coverage test, so each kept pixel keeps its smoothed edge (see "Masks with alpha to coverage" above).
- A static batch with levels is not culled in groups of 64 rows on WebGL2, so each row can pick its own level.
- Levels are separate engine meshes, so the levels from a glTF file that share the base mesh's vertices take a copy of them each.
- The three.js mapping's `LOD (addLevel)` entry maps to `mesh.setLevels`, with distances converted at a 50 degree field of view on a screen 1,080 pixels high.

## Follow-ups

1. Levels for skinned objects, first. Battle's armies are skinned, so they gain nothing yet. The WebGPU skinning pass skins each object's vertices into a region of its own. Each level would need a region, and the skinning pass would skin only the level that the object draws. A skinned object's level can be picked on the CPU before the skinning pass, as skinned objects are few. Expected gain, an estimate to measure: S5's Knight has 4,957 vertices, and its first level switches in at 12.8 m (D-91). Each level halves the one above. An army seen from 30 to 60 m away would draw levels 2 and 3, a quarter to an eighth of the vertices. Skinning and vertex shading would then cost about a third of today's. The skinning pass and the shadow passes grow with the vertices, so they would take roughly half their GPU time or less.
2. Levels for blended and transmissive sources, in the transparent pass's own buckets.
3. Fading builds for custom materials, which double their builds, and for the alpha hash.
4. Levels as index ranges of the base mesh's vertices, so a file's levels take no copy of them.
5. Levels for trees with leaf cards in the asset tool. The step keeps a share of the cards and grows them ("Trees with leaf cards" above). Creek needs this step before its trees from files can use levels.


## Addendum: the band is narrower (19 October 2026)

The owner saw the 4 × 4 dither as a grid of dots on foliage close to the camera in Creek. The band
was 15% of the switch distance, which at a short switch distance covers a wide part of a tree. It is
now 8%, so less of the tree dithers at once while the hand-over stays smooth. The band's test reads
`FADE_BAND` rather than fixed distances, so the share can change again without rewriting the test.

## Addendum: M3's level-of-detail work (owner, 19 October 2026)

A review on 19 October 2026 compared this system with other work. The sources were Hyper3D's article "[Level of detail 3D](https://hyper3d.ai/blog/level-of-detail-3d)", Unity 6's Mesh LOD and LOD Group, and Godot 4's mesh LOD and visibility ranges. They were also Bevy's visibility range, SpeedTree, meshoptimizer 1.x and its [`clusterlod.h`](https://github.com/zeux/meshoptimizer/blob/master/demo/clusterlod.h), [nanite-webgpu](https://github.com/Scthe/nanite-webgpu) and Unreal 5.7's Nanite foliage. The owner ruled that all of its proposals are built, cluster levels included. They are M3's first tasks, M3-L1 to M3-L4, before the tasks of [D-172](D-172-rive-city-follow-ups.md). They come first because they also correct guidance in this record and in the docs.

The review found five weak points in what this record describes:

- The fade goes where it shows least. The asset tool's levels change the picture by less than a pixel at the switch. D-91 found no wider change at 502 of 518 switches. Yet they pay for the double draw, the discard and the fade lists. Hand-made levels, such as Creek's leaf-card trees, change the picture far more. On Low, which turns the fade off, they pop. The fade becomes a choice per level. It is off for a measured error, and on for a level given by distance or by a hand-set error, on Low too.
- The rule measures to the center of the bounds. An object whose radius is half its distance then shows twice the allowed error on its near side. The rule moves to the nearest point of the bounds, as meshoptimizer, Godot and `clusterlod.h` do.
- Each level and each fade list reserves room for every copy, in every view. Read from the code, 40,000 copies with 4 levels and 4 cascades take about 61 MB of copy lists, plus growth room. One list per view would take about 13 MB. The main view's list passes WebGPU's default 128 MiB binding limit near 260,000 copies with four fading levels. These are estimates to measure. The lists will follow what draws.
- Every copy uses the same 4 × 4 pattern, so neighbouring copies line up into one grid. The pattern will differ per copy.
- A distance or a screen coverage becomes an error for a screen 1,080 pixels high. So on a screen 2,160 pixels high, the level switches at twice the distance. Levels can then be picked by distance or by coverage beside error.

Cluster levels (M3-L3) serve large static meshes that do not bend, such as scans, cliffs, buildings and CAD models:

- The asset tool builds a tree of patches of about 128 triangles with `clusterlod.h`. A patch draws when its own error is under the threshold and the error of the coarser patch above it is over it. The test needs no state from earlier frames, so both GPU paths can run it. Patches in a group switch together, so no gaps open.
- On WebGPU, a compute pass tests the patches in each view and draws the chosen ones with one indirect draw.
- On WebGL2 with `WEBGL_multi_draw` (Chrome and Safari), the job workers test them, and each chosen patch is one range of a multi-draw call.
- On WebGL2 without it (Firefox), the mesh draws whole levels cut from its tree, through this record's levels.
- Meshes with many copies, skinned meshes and leaf-card trees stay on this record's levels on both paths. Unreal's docs say its cluster method thins tree crowns with distance, because each leaf is a separate piece with open edges.
- Multi-draw indirect and 64-bit atomics wait for browsers, as [D-179](D-179-technique-rulings-2026-10-15.md) ruling 27 says. Cluster levels need neither.

Follow-ups 1, 4 and 5 come in M3, in M3-L2. Follow-ups 2 and 3 stay open. Live simplification of meshes while the program runs is not planned: it costs CPU time and uploads every frame, and cluster levels give its result.

## Addendum: the level distance reaches the nearest point (21 October 2026)

The level rule measured from the camera to the center of an object's bounding sphere. It now
measures to the nearest point of the sphere, as meshoptimizer's README, Godot and `clusterlod.h`
do. The distance is `max(center distance - radius, 1 mm)`. The minimum keeps the distance positive
when the camera lies inside the bounds. Such an object then keeps its base level, and the fade
ratio stays defined.

`LevelRule::distance` in `crates/null3d-core/src/levels.rs` picks for the job workers, and
`level_of` in `crates/null3d-shaders/wgsl/cull.wgsl` picks for the GPU cull. Both use the same
expression, so a switch happens at the same camera distance on every GPU path.

An object whose radius is half its distance showed twice the allowed error on its near side before.
Its switch now moves outward by its radius. Large meshes and merged far cells therefore keep finer
levels at the same camera distance.

The level-of-detail image tests place their spheres by their nearest points. The image tests and the
forest, atmosphere, light-shafts and impostors demos were rechecked, and their references were
redrawn where the picture moved.
## Addendum: a dither phase per copy (21 October 2026)

The band's 4 × 4 ordered dither was the same for every copy, so the copies inside a band lined up into one grid. The owner saw that grid on Creek's foliage, and the narrower band of 19 October made it smaller but did not remove it.

Each copy now shifts the pattern by a phase from 0 to 15 that a hash of the copy picks. Two copies rarely share a phase, so their patterns no longer line up. The shift moves the pattern by whole pixels within its 4 × 4 tile. Every copy therefore draws the same set of dither values, in another place.

The two levels of a band draw the same copy, so they take the same phase. Each pixel still draws exactly one level, and no gap opens between them. A copy's source names it on both GPU paths. The culling shader writes it beside the fade value on WebGPU, and the index list holds it on WebGL2. The hash is `pcg` from `null3d::noise`, which every GPU works out alike. The phase rides in the flat vertex value that already carried the fade value. The change adds no texture, no draw and no lookup, and the vertex shader hashes each copy once per vertex.

Both GPU paths carry the phase in the same shader source, so a change to the pattern lands on both at once. The `lod-fade` test drew new pictures, about 1% of its pixels on each tier, and its references moved in both sets. The demos whose trees carry levels stayed within the image tolerance on both GPUs, so their references did not move.
