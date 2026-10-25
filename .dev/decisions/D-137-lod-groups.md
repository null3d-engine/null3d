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

A review on 19 October 2026 compared this system with other work. The sources were Hyper3D's article "[Level of detail 3D](https://hyper3d.ai/blog/level-of-detail-3d)", Unity 6's Mesh LOD and LOD Group, and Godot 4's mesh LOD and visibility ranges. They were also Bevy's visibility range, SpeedTree, meshoptimizer 1.x and its [`clusterlod.h`](https://github.com/zeux/meshoptimizer/blob/master/demo/clusterlod.h), [nanite-webgpu](https://github.com/Scthe/nanite-webgpu) and Unreal 5.7's Nanite foliage. The owner ruled that all of its proposals are built, cluster levels included. They are M3's first tasks, M3-L1 to M3-L4, before the tasks of [D-172](D-172-neon-harbour-follow-ups.md). They come first because they also correct guidance in this record and in the docs.

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
## Addendum: a bound under a pixel draws nothing (21 October 2026)

M3-L1 gives every level set a last level that holds no geometry. An object or instance row hides
when the world diameter of its bounding sphere covers fewer pixels than `lodThreshold`:

```text
diameter × factor < distance,  factor = render height × P[1][1] / (2 × threshold)
```

This is the factor that picks every level, so the render height, the render scale and the
governor's doubled threshold all move the hide distance. The diameter, not the radius, measures the
object: a bound that covers half a pixel each way is a pixel across, and other engines cull at that
size. At Medium and above an object goes when its diameter is under a pixel, and on Low under two.

Past the hide distance lies the same 8% band as a level switch. There the level that the object
would draw goes into its fade bucket with a negative fade value, so the dither drops a growing
share of its pixels until none remain. Without a band, or without a fading build, the object hides
at the hide distance. A mesh without levels never hides, so a scene without levels still pays
nothing. Both paths compare the same values: the job workers and the direct-draw culling read
`levels.rs`, and the GPU's culling shader reads `cull.wgsl`.

The shadow views use their own threshold, times `lodShadowFactor`, as their level choice does. A
caster's shadow therefore goes at a nearer distance than the object itself. It draws no band, as
the shadow maps already pick without one.

## Addendum: the copy lists follow what draws (22 October 2026)

A view's compacted instance buffer holds one copy of each source that draws, in the slice that the
bucket's draw reads. The build gave every bucket of a mesh with levels a slice for every source of
the set, because any source may pick any level. A set of four levels therefore took four times the
copies that its sources need. With fading bands it took eight times. Each cost 64 bytes per source
per level per view. The copies of a dense forest passed WebGPU's 128 MiB binding limit near 260,000
copies.

The frame now sizes each level's slice to the copies that it draws. The slices of one set take the
room of the set's sources. `Layout::fit_copies`
(`crates/null3d-render/src/gpu_driven/copies.rs`) counts the copies that each view places in each
bucket. It uses the same stateless rule that the culling shader runs. It takes the largest count
over the views that draw the layout. A source near a switch distance counts toward both levels that
it may pick. So a slice never falls short of the shader's writes, whatever the last bits of a
shared distance come to. The buckets without levels keep the slices of the build. A scene without
levels runs no count.

| Copies of four levels, with fading bands | Before | After |
| --- | --- | --- |
| 40,000 copies, the main view | 20.5 MB | 2.6 MB |
| 40,000 copies, the main view and four cascades | 61 MB | 13 MB |

`crates/null3d-render/tests/levels.rs` measures the figures from the frame's own copy lists. A
band adds about a tenth more, for the sources inside it, which take a copy in each of two fade
buckets.

The culling shader cannot size these slices itself. A draw reads its bucket's copies from a vertex
buffer offset that the frame records on the CPU. An indirect draw keeps its first instance at 0
(hard rule 8). A count on the GPU would need a readback, or a second pass that costs every frame.
The CPU count runs only for the sources of a mesh with levels. A list of chosen patches per view has
the same sizing problem (M3-L3). Its count can read this one.

## Addendum: an object may bias its threshold (22 October 2026)

Godot gives each geometry instance a `lod_bias`, which moves the levels of that object alone: a
hero object keeps its detail while its neighbours turn coarse. null3D now has the same, as
`object.setLevelBias(bias)`.

The bias divides the factor of the level rule. A bias above 1 raises the object's threshold, so
every switch happens at a nearer distance, and a bias below 1 keeps its detail. The same factor
divides the rule that hides a bound under the threshold. A detailed hero object therefore also
stays visible farther out. A bias of 1 leaves both rules as they were, and a scene without levels
pays nothing.

The bias belongs to the object, and it reaches the culling shader in the object's bucket record. A
bucket holds one bias. So an object whose bias differs from 1 draws from a bucket of its own, which
the layout's bounds code gives it. Objects that share a bias share a bucket. Instance rows have no
bias of their own yet, so a batch keeps the threshold of the quality settings.

| The rule that picks a level | At a bias of 1 | At a bias of 2 |
| --- | --- | --- |
| A level switches in at | `error × scale × factor` | half that distance |
| A bound hides at | `diameter × factor` | half that distance |

The core keeps one float for each object, which raises an object's row from 263 bytes to 267. The
job workers read it beside each row's sphere. `cull.wgsl` reads it from the bucket record, which
takes 14 words in place of 13. A record that holds 0 keeps the quality settings' threshold, so a
test needs no bias.

## Addendum: the fade rule and the distance bands (22 October 2026)

D-211 builds the fade rule, the three switch measures and the distance bands that this record's
addendum of 19 October 2026 asked for. It supersedes two statements above: the fade is no longer
a setting for every band, and a distance or a coverage no longer becomes an error at a reference
screen. A bucket record now holds 15 words, the measure joined the switch value, and the culling
shader reads a source's distance range from a data texture.

## Addendum: a level may shade with its own material (22 October 2026, M3-L2)

A far level now draws with a material of its own where the author gives one, so it shades more
cheaply than the near level: without a normal map, or with an opaque mask in place of an
alpha-tested one. The engine's part is small because buckets are already per material.

- `mesh.setLevels` takes a `material` on any level. A level without one draws with the material of
  the level before it, so a set names the cheaper material once. The base level draws with the
  object's or the instance batch's material.
- The rule is a chain rather than an absolute material on every level, so `links_of` can find a
  coarser level's bucket from any level's key without carrying the base material. A level key
  holds its own effective material, and the next level takes its own or that one.
- A level's bucket key is built from the level's mesh and material, through the same steps as a
  source's key: the pipeline, the map group, the page, the level key and the material. The
  receive-shadows bit comes from the base key's pipeline, since the level belongs to the same
  object. A level whose material cannot draw with the mesh's vertex format is left out, like any
  pair that draws nowhere.
- Fading builds follow each level's own pipeline. A cheaper level material that masks fades; one
  that does not mask has no fading build and switches at once.
- A glTF file gives a level a material when the level node's primitive names another material than
  the node's primitive. The asset tool keeps one material per mesh, so its levels inherit.

The lod image test's new `lod-material` case draws each level with a material of its own in the
level's color, a different pipeline from the base's vertex-colored one, and must draw the same
image as `lod`. E1221 now names a level material that is destroyed or from another engine.

## Addendum: the tool thins leaf cards (22 October 2026, M3-L2)

The asset tool now writes levels for meshes whose parts are separate cards, so a tree that leaves
Blender without levels still gets them (follow-up 5).

- The tool calls a part a card list when every separate piece of it, after welding, is a quad of
  four vertices and two triangles, or a card folded along its middle of six vertices and four
  triangles, as Creek makes its leaves. A flat-shaded surface splits into pieces of three vertices,
  so it never matches, and it keeps the simplifier's path.
- Each level keeps every second card of the level above, in an order along a space-filling curve
  of the cards' middles, so a level thins the crown evenly rather than one side first.
- Each kept card grows about its middle by the square root of two for that step, so the cards
  keep the surface that the dropped ones covered. The file stores the level's own positions,
  because the growth moves vertices. This is the one level kind that copies vertices.
- The level's error is the size of the largest card that it drops, as the follow-up said. Creek's
  cards are 0.8 m wide. On a 1,080-pixel screen, a level switches at about a kilometer. That is
  conservative: it thins a crown only long after the geometry detail has gone. A hand-authored
  level, as Creek's Blender script makes, switches nearer. The tool's rule stays geometric and
  predictable. An author who wants earlier thinning gives the level its own error.
- The card step runs only for a mesh that a skin does not pose, because a posed list's positions
  are in the scene's units and the level's stored positions are in the mesh's.

## Addendum: texture coordinates in the level error (22 October 2026, M3-L2)

The simplifier weighed normals and vertex colors in its error, so a texture could slide between
two vertices of a level with no error shown. The planner now adds each texture coordinate set to
the attributes that the simplifier keeps, with a weight of a sixty-fourth of the mesh's longest
side. A texture coordinate's unit covers the texture across the mesh, so a slide of a large share
of a texture counts like a small distance, while a slide of a few texels stays under the geometry's
own error. Texture seams still lock, and welding still keeps two copies of a vertex apart where
their coordinates differ.

The weight is deliberately modest. The error that the simplifier reports includes the attributes,
and the engine reads a level's error as a distance, so a heavy weight would make every textured
mesh switch levels much farther out. At a sixty-fourth, the test scene's ball keeps four levels,
where the same scene without texture coordinates in the error has six.

## Addendum: the level pictures place each copy by its own distance (22 October 2026, M3-L2)

The level image tests placed each copy at a depth equal to the share of its switch, and then moved
it off the camera's axis to spread the copies across the picture. A copy off the axis lies farther
from the camera than its depth, by 2 to 4 percent of the distance, so every copy sat a little
nearer its next switch than the test meant.

The five percent either side of a switch hid that in the pictures where the levels switch at once.
The bias test did not hide it. Its objects take a bias of 2, which halves the switch and the copies'
distance with it, while the sideways offset keeps its size. The nearest copy, at 95 percent of its
switch, then crossed that switch and drew level one.

Each copy now stands along its own ray at the exact distance the rule measures. The measured
figures, from a native test on the job workers and from the picture on all three paths:

| Object | Switch | Copy at 95 percent | Copy at 103 percent |
| --- | --- | --- | --- |
| No bias | 15.59 m | base level, one copy | level 1 |
| Bias of 2 | 7.795 m | base level, one copy | level 1 |

The biased switch is exactly half the unbiased one. The pictures moved by 0.5 to 0.9 percent for
the tests that switch levels at once, and by 2.7 to 3.2 percent for the fading bands, whose dither
depends on how far past a switch a copy lies. The new `lod-bias` picture has its own references in
both environments: a bias of 2 puts the same levels at half the distance, so the copies are twice
the size on screen and cannot share the plain picture.

## Addendum: a level from a file costs its indices alone (22 October 2026, M3-L2R)

The asset tool writes each level's triangles over the base mesh's own vertex accessors. The loader
read them as a mesh of its own all the same, so it copied the whole vertex stream once per level.

A level now draws the base mesh's vertices from its own indices. It shares the base's page and
vertex ranges. The storage appends the level's triangles after the base's own. On WebGL2 it shifts
them by the part's place in its page; on WebGPU the draw adds the part's base vertex. The level
takes the base's radius, format and vertex count. It goes when the base goes. Taking the level out
frees its indices alone, never the base's vertices.

Two kinds of level still copy their vertices. One names its own positions, as the tool's cards do.
The other has a base that the engine split into parts, or that morph targets pose. A skinned base
shares its vertices, because the skin moves the same vertices whichever level names them.

The test scene's ball shows the saving. Its base has 1,225 vertices of 16 bytes, and four levels.
Held as copies, the levels took 91,600 bytes of GPU memory. Held over the base's vertices, they
take 13,200. The four levels save 78,400 bytes on that one mesh. One picture test draws the file
with each level's accessors copied. Its picture must match the shared one: the shared level draws
the same pixels as the copied level. On 23 October 2026 that held on the Mac, which matched the two
frames in every pixel on its GPU and on its software GPU. CI's software GPU differed in one to three
pixels of the 640 x 360 frame, each by one step of 255. The same vertices, read from another place
in a buffer, round so there. The test keeps the exact match on the Mac and allows sixteen pixels on
SwiftShader ([Image tests](../image-tests.md#references)).

## Addendum, 23 October 2026: impostor cards that blend three views and relight

D-151 recorded three-view blending as a later step, and said the impostor cards are a sprite batch
that shows the stored view nearest the camera. The atlas was also shaded for one sun, so a scene
whose sun moves showed cards lit for a sun that had set. M3-L4 asked for both faults to go.

The cards are now one instance batch of quads, drawn by the add-on's own material, which the engine
compiles from WGSL that ships with the package. Three properties carry the change:

- The vertex offset faces every quad to the screen. It reads the instance's world matrix, whose
  columns are the card's axes turned into the view's space, and returns the move that puts the
  quad's corner on the screen's plane. The engine applies the instance transform afterwards, so
  the offset is that rotation's inverse applied to the wanted point.
- The surface function folds the direction from the card toward the eye onto the octahedral grid,
  finds the triangle of cell centers that holds it, and blends the three cells by its barycentric
  weights. The same weights blend their stored normals, which are decoded in each view's space and
  turned by the camera's axes, since the card faces the screen. The engine then lights the card
  with the scene's lights, exactly as it lights a mesh.
- The atlas is twice what it was: a color atlas, in sRGB, and a surface atlas whose red and green
  hold the octahedral code of the view's normal, blue the point's depth and alpha its coverage.
  `encodeImpostorSurface` writes those texels, so a bake stores the surface and never its light.

The add-on still changes no engine source, as D-151 ruled: the material, the quad and the octahedral
code all sit in `@null3d/impostors`. The octahedral fold now exists twice, once in TypeScript for
the bake and the unit tests and once in WGSL for the card, so a change to one must change the other;
the picture test draws the cards around many directions so a disagreement shows.

The eye comes from the frame's camera, so the cards have no per-frame call. `update` left the API,
and with it the origin that the sprite batch needed: the engine draws everything relative to the
camera, so world positions keep their precision far from the world's origin.

## Addendum: the vertices of a file's levels are shared, but not ordered by level (25 October 2026, M3-L2)

The plan asked for a file's levels to draw ranges of the base mesh's indices. Those indices name the
base's own vertices. The vertices were to come in coarsest-level-first order, as meshoptimizer's
README advises. The first part is built. A level the asset tool writes names the base's accessors.
The loader therefore stores the level over the base's vertices. The level costs its indices alone.
The second part is not built. It is a recorded choice rather than a gap.

Coarsest-first order is a new step in the tool's pipeline. `reorderMeshes` runs before the levels are
planned. It orders the vertices for the GPU's vertex cache, not by level. Ordering by level needs
a reorder after `planLevels`. That step remaps every vertex stream and every level's indices. The
owner's ruling of 25 October 2026 holds it back until its gain is stated in bytes.

What the ordering would gain is the share of the vertex buffer that a coarse level must have
resident. Without it, a level's indices point across almost the whole buffer. The tool's test ball
has a base of 1,225 vertices of 16 bytes. Its coarsest level names 122 vertices. Those vertices span
1,201 slots, 98% of the array. A draw of that level therefore needs almost the whole 19,600-byte
vertex buffer. In coarsest-first order the same 122 vertices would sit in the first 1,952 bytes. A
staged loader could then send 1,952 bytes, not 19,600, before the first coarse draw. That holds back
17,648 bytes, 90% of the vertex buffer, until a finer level arrives. The gain scales with the base's
vertex bytes, and it is a streaming and cache gain only. The levels already copy no vertices, so no
total memory and no picture changes. It gains nothing for the 40,000-pine scene, whose procedural
levels are meshes of their own. M3-L4's staged loading is the user that would spend the step.

## Addendum: the levels' cost on an iPad and a phone (25 October 2026, M3-L2)

The level-of-detail section asks each of its tasks for the GPU time and memory on the Mac, an iPad
and an S24-class phone. The Mac's GPU time is in this record's table of 11 October. The copy lists'
memory is in the addendum above. This addendum adds the two devices.

The `lod-cost` page draws 40,000 pines, four levels each. It times the forest with every tree at its
base mesh. It then times it with each tree at the level that its size on the screen picks. The two
sides take turns, two seconds at a time, three times over, at Low and at High. After the timing the
page reports each side's GPU buffer bytes from the stats overlay.

The owner's rule of 25 October 2026 splits the rows. Memory is read exactly, so a cloud iPad's
memory stands. A GPU time is a timing, so an iPad's absolute figure comes from the owner's own iPad.
The cloud iPad's figure stands beside it as the comparison. Phones keep the cloud-first rule, so
the Galaxy S24 gives both of its rows.

| Device | Path | Preset | GPU off, on (ms) | GPU buffers off, on (MiB) |
| --- | --- | --- | --- | --- |
| iPad Pro 13, cloud | WebGPU | Low | 10.95, 5.28 | 22.0, 22.0 |
| iPad Pro 13, cloud | WebGPU | High | 42.38, 32.12 | 25.6, 25.6 |
| iPad Pro 13, cloud | compatibility | Low | 11.00, 5.40 | 22.0, 22.0 |
| iPad Pro 13, cloud | compatibility | High | 31.36, 26.41 | 25.6, 25.6 |
| iPad Pro 13, cloud | WebGL2 | Low | no timer | 6.1, 6.1 |
| iPad Pro 13, cloud | WebGL2 | High | no timer | 6.2, 6.2 |
| Galaxy S24, cloud | WebGL2 | Low | no timer | 6.1, 6.1 |
| Galaxy S24, cloud | WebGL2 | High | no timer | 6.2, 6.2 |

The cloud iPad ran Safari 26.6.1 on iOS 26 at 59 Hz. Its window was 1,032 by 1,264 CSS pixels at
2x. Its levels cut the GPU time by 52% at Low on both WebGPU paths. They cut it by 24% at High on
core WebGPU. Its GPU buffer bytes do not change between the two sides. The copy lists therefore
follow what draws on the device as they do on the Mac. The lists take one copy per source. They do
not take a slice per level per view. The Mac's table above holds the same finding: 2.6 MB in the
main view and 13 MB with four cascades, against 20.5 MB and 61 MB before.

The Galaxy S24 ran Chrome 152 on Android 16 with no WebGPU adapter, so only its WebGL2 rows ran.
Chrome on Android reports no WebGL2 GPU timer. The cloud display ran at 30 Hz, so its frame interval
sits at its 33.3 ms limit and hides any saving. The runner marks its timings unreliable. Its GPU
buffer bytes also do not change, at 6.1 MiB at Low and 6.2 MiB at High. Its CPU time rises with the
levels on, by 1.78 ms at Low and 1.35 ms at High. That is the level picks and the fade pairs.

The owner's own iPad row is still owed. It takes the same page on that device with
`bun tests/real-browsers.ts --plan lod-cost --lan ipad-safari`, with the dev server running and the
runner page open in Safari. The cloud tablet's GPU times above stand beside it as the comparison.
