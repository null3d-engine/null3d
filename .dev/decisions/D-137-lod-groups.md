# D-137: Levels of detail picked by screen error

Status: accepted. The owner approved the design, and chose to merge it with the forest demo as it is; a later task improves the demo's look. The owner also ruled that M3-L1 to M3-L4 build every proposal of a review of this system, cluster levels included. Built: the design below with M3-L1's and M3-L2's changes, the fade rule and distance bands of [D-211](D-211-lod-fade-and-distance-bands.md), shadow views that pick in their own texels, the WebGPU path of [D-213](D-213-cluster-levels.md)'s cluster levels, and M3-L4's impostor cards that relight. Open: the two follow-ups at the end. Task: M2-I4, then M3-L1, M3-L2 and M3-L4.

Summary: `mesh.setLevels` gives a mesh up to 15 simpler levels; each object and batch row draws the coarsest level whose screen error stays under a pixel threshold. WebGPU's culling shader and WebGL2's job workers pick with one stateless rule, so both switch at the same distances, and hand-set levels cross-fade with a dither. Each shadow view picks its casters' levels by their error in its own texels, bounds under the threshold draw nothing, and the copy lists hold one copy per source that draws in each level.

## Question

Creek needs denser forests and Night town a bigger skyline at the same cost. A far tree of 2,000 triangles covers a few pixels, and its vertex work buys nothing. three.js has the `LOD` object, and the asset tool writes levels with their errors ([D-91](D-91-level-planning.md)). How does the engine pick a level for each object and each instance row, on both GPU paths, without a visible pop? And what do the shadows draw?

A review compares this system with other work: Hyper3D's article "[Level of detail 3D](https://hyper3d.ai/blog/level-of-detail-3d)", Unity 6's Mesh LOD and LOD Group, and Godot 4's mesh LOD and visibility ranges. It also takes in Bevy's visibility range, SpeedTree, meshoptimizer 1.x and its [`clusterlod.h`](https://github.com/zeux/meshoptimizer/blob/master/demo/clusterlod.h), [nanite-webgpu](https://github.com/Scthe/nanite-webgpu) and Unreal 5.7's Nanite foliage. The owner ruled that all of its proposals are built, as M3-L1 to M3-L4.

## Rule

- Levels switch where the screen-error rule says, at the same distances on WebGPU, compatibility mode and WebGL2 (the task's done-when).
- The rule is Godot's: the coarsest level whose error, projected on the screen, is under the threshold of 1 pixel. The screen's height includes the render scale ([D-53](D-53-technique-defaults.md)).
- A switch does not pop: the levels hand over smoothly, or the record states the alternative.
- A shadow view picks a caster's level by the caster's error in the view's own texels, whatever the camera's distance, so a shadow map that keeps its depth between draws stays right. A shadow never shows another level's silhouette on its own caster's surface by more than the normal bias hides.
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

With option A, `mesh.setLevels([{ mesh, error }, ...])` gives a mesh its lower levels, as Unity's mesh levels and glTF's `MSFT_lod` attach them to a mesh. Objects and batches keep the base mesh's id. So picking, raycasts, skinning, the software occlusion blockers and the transparent pass read the base mesh. The glTF loader calls `setLevels` from `MSFT_lod`. A level must have the base mesh's vertex attributes. Each level keeps its own engine mesh. A level from a file has no vertices of its own: it draws the base mesh's vertices from its own indices ([Levels from files](#levels-from-files)).

| Option | Verdict |
| --- | --- |
| The object's mesh id names a level set, with a bit of its own | Rejected. Every reader of an object's mesh (raycasts, skinning, morphs, blockers, the sorted pass, mesh destruction) would have to resolve the set first |
| A level set as a mesh of its own, sharing the base mesh's parts | Rejected. Removing a mesh moves the parts of the meshes after it, and a shared part would move under the set |

A level's bucket key holds a level bit, the base mesh's id and the level's number. So a level's bucket never merges with the bucket of an object that draws the same simple mesh as a mesh of its own.

### Picking the level

Each source keeps one entry in the bucket table, which names the bucket of its base level. Each level has a bucket of its own: one pipeline, mesh and material, as every bucket is. Each level's bucket record also holds the level's switch value with its measure, the bucket of the next coarser level, its fade bucket and the object's level bias. A record takes 15 words. So the culling shader walks from the base level's bucket to the coarsest level whose switch passes, with no new buffer and no new table. The WebGL2 builder keeps the same links in its layout, and the job workers walk them per row.

The rule, for a source whose bounding sphere lies at distance `d` from the main camera:

```text
level j draws when  error[j] × scale × k < threshold × d,  with k = render height × P[1][1] / 2
```

`scale` is the largest axis scale of the source's world matrix. Both paths compute it from the same matrix. The error grows from level to level, so the walk stops at the first level that fails. An orthographic camera uses `d = 1`, since its pixels do not shrink with distance.

`d` is the level distance: the straight-line distance to the sphere's center less half its radius, `max(center distance - radius / 2, 1 mm)` (`LEVEL_RADIUS_SHARE`). Turning the camera therefore never changes a level. The minimum keeps the distance positive when the camera lies inside the middle of the bounds. Such an object keeps its base level, and the fade ratio stays defined. A level given by its error measures this distance, and so does the rule that hides a small bound. A level given by a distance or by coverage, and a distance band, measure to the sphere's nearest point, `max(center distance - radius, 1 mm)`, because their authors set them in meters for the near side of the object.

A level's error is its largest anywhere on the mesh, so the measure decides how a large copy trades its near side against the rest of it. The desert benchmark's walk view shows the trade, in held frames at 1920 x 1080 compared with the same frames drawn from base levels alone, by FLIP (a perceptual image difference, 0 for the same image), at 1 pixel:

| Level distance | Triangles a frame | FLIP, whole frame | FLIP, bottom third, worst frame | Pixels over 0.1 |
| --- | --- | --- | --- | --- |
| Nearest point, as meshoptimizer's README, Godot and `clusterlod.h` measure | 4.98 M | 0.0119 | 0.007 | 2.4% |
| Center less half the radius (chosen) | 4.27 M | 0.0137 | 0.009 | 3.0% |
| Center, as three.js r187's meshlet pipeline measures | 3.32 M | 0.0171 | 0.017 | 4.0% |

The nearest point keeps an arch of 20 m radius, whose center lies 32 m away, at its base level of a million triangles, because its near side lies 8 m away. Its far side, 50 m away, then draws detail that no pixel shows. The center shows the error on the near side of large copies: the bottom third of the worst frame, where the near arches stand, errs by 2.4 times as much. Half the radius keeps the near side within the nearest point's error and draws 14% fewer triangles. Copies small against their distance, such as the desert's pebbles, pick the same level under all three measures. A tree of cluster patches keeps the nearest point (`LevelRule::patch_distance`, `cluster_cull.wgsl`): a patch's sphere encloses its children's, so the nearest point never measures a child farther than its parent, and a cut leaves no hole. A perspective light's tile keeps the nearest point too, because a caster's level must stay within a texel of its surface everywhere for the normal bias to hide it.

`bench/research/triangle-budget/` holds the scripts, the held frames' figures and the comparison (`results/compare.json`), and the experiment's change (`distance-share.patch`).

`LevelRule::distance` in `crates/null3d-core/src/levels.rs` picks for the job workers, and `level_of` in `crates/null3d-shaders/wgsl/cull.wgsl` picks for the GPU cull. Both use the same expression, so a switch happens at the same camera distance on every GPU path.

A level can also switch by a distance in meters or by a share of the screen's height, beside its error ([D-211](D-211-lod-fade-and-distance-bands.md)). Those two measures do not read the render height, so they switch at the same distance on every screen height.

| Option | Verdict |
| --- | --- |
| A stateless rule: each frame, each view picks from the distance alone | Chosen. Both paths and every view pick the same level for the same source. The fade band below does what hysteresis would |
| Hysteresis of about 10%, from a per-source record of the last level | Rejected. It needs a per-source word that the GPU writes and a per-view history, and the paths could then disagree after a camera cut. three.js's `LOD` has no hysteresis by default either |

### An object's level bias

Godot gives each geometry instance a `lod_bias`, which moves the levels of that object alone: a hero object keeps its detail while its neighbors turn coarse. null3D has the same, as `object.setLevelBias(bias)`.

The bias divides the factor of the level rule. A bias above 1 raises the object's threshold, so every switch happens at a nearer distance, and a bias below 1 keeps its detail. The same factor divides the rule that hides a bound under the threshold. A detailed hero object therefore also stays visible farther out. A bias of 1 keeps both rules at the quality settings' threshold, and a scene without levels pays nothing.

The bias belongs to the object, and it reaches the culling shader in the object's bucket record. A bucket holds one bias. So an object whose bias differs from 1 draws from a bucket of its own, which the layout's bounds code gives it. Objects that share a bias share a bucket. Instance rows have no bias of their own yet, so a batch keeps the threshold of the quality settings.

| The rule that picks a level | At a bias of 1 | At a bias of 2 |
| --- | --- | --- |
| A level switches in at | `error × scale × factor` | half that distance |
| A bound hides at | `diameter × factor` | half that distance |

The core keeps one float for each object, 4 bytes of its 275-byte row (`ROW_BYTES` in `crates/null3d-core/src/scene.rs`). The job workers read it beside each row's sphere, and `cull.wgsl` reads it from the bucket record. A record that holds 0 keeps the quality settings' threshold, so a test needs no bias.

### The hand-over

| Option | Verdict |
| --- | --- |
| Dithered cross-fade (Bevy's visibility ranges, Unity's LOD cross-fade): over a band past each switch distance, both levels draw, and a 4 × 4 ordered dither gives each pixel to one of them | Chosen for a level whose switch shows. It needs no blending and no sorting, and the two levels never cover a pixel twice |
| Alpha blending of the two levels | Rejected. Both levels would sort with the transparent pass, and each pixel would shade twice |
| Geomorphing (moving vertices toward the coarser level) | Rejected. It needs vertex-to-vertex links between levels, which the simplifier does not keep, and a custom vertex path for every template |
| A plain switch at the distance | Chosen for a level whose switch does not show, and for builds that have no fading level |

A level fades only where its switch shows ([D-211](D-211-lod-fade-and-distance-bands.md)). The asset tool's levels have a measured error, and at the one-pixel threshold they are measured at they change the picture by less than a pixel at the switch: [D-91](D-91-level-planning.md) finds no wider change at 502 of 518 switches. They switch at once, with no double draw, discard or fade list. The threshold is live, and the governor can raise it to 4 or 8 pixels, where the switch shows: a measured level takes the fading band once the governed threshold rises above about one and a half pixels, and switches at once below that. A level given by a distance, by a coverage or by a hand-set error fades at every threshold, on Low too, since its switch would pop. Creek's leaf-card trees are such levels. The `lodFade` quality setting controls only the distance bands.

The band starts at the switch distance and is 8% of it long (`FADE_BAND`). In it, the source draws its new level with a fade amount `t` from 0 to 1 and its old level with `1 - t`. A pixel draws the new level where its dither value is under `t`, and the old level elsewhere. A wider band dithers a wide part of a tree at a short switch distance, and the 4 × 4 dither then shows as a grid of dots on foliage close to the camera. The band's test reads `FADE_BAND`, not fixed distances.

`discard` turns off hidden-surface removal on tile GPUs (Apple, PowerVR), so the fading builds must not draw the sources that do not fade. Each fading level's bucket therefore has a fade bucket beside it, whose pipelines are the `LOD_FADE` builds. Only sources inside a band land there. Their builds are a first-use shader set, so a page without fading levels downloads none.

The fade amount reaches the fragment shader as a flat value:

- WebGPU: the culling shader writes it into the free fourth word of the copy's ids. The sign says which side: positive for the new level, negative for the old.
- WebGL2: the index list's entries have no spare bits (23 bits of row, 9 of cell). A fade bucket's entries take two words: the entry, then the fade amount's bits. Its draw record marks the pairs, and the fading builds read both.

### A dither phase per copy

One 4 × 4 pattern for every copy would line up the copies inside a band into one grid, which shows on Creek's foliage. So each copy shifts the pattern by a phase from 0 to 15 that a hash of the copy picks. Two copies rarely share a phase, so their patterns do not line up. The shift moves the pattern by whole pixels within its 4 × 4 tile. Every copy therefore draws the same set of dither values, in another place.

The two levels of a band draw the same copy, so they take the same phase. Each pixel still draws exactly one level, and no gap opens between them. A copy's source names it on both GPU paths. The culling shader writes it beside the fade value on WebGPU, and the index list holds it on WebGL2. The hash is `pcg` from `null3d::noise`, which every GPU works out alike. The phase rides in the flat vertex value that carries the fade value. It adds no texture, no draw and no lookup, and the vertex shader hashes each copy once per vertex.

Both GPU paths carry the phase in the same shader source, so a change to the pattern lands on both at once.

### Masks with alpha to coverage

Foliage draws with masks, and a mask smooths its cut edges with alpha to coverage by default. Without a fade, every hand-set tree level in a forest would pop at its switches. So the fading builds also build with alpha to coverage, and with the sample mask builds that WebGPU's targets without alpha use for it.

| Option | Verdict |
| --- | --- |
| The pixel dither after the coverage test: the shader works out the coverage as before, then drops the pixels of the other level | Chosen. Each kept pixel keeps its smoothed edge, and the two levels still never share a pixel. It needs no new shader code, only the builds |
| Scaling the coverage by the fade amount | Rejected. The GPU turns the same alpha into the same samples in both levels. At `t = 0.5` both levels would cover the same half of each pixel's samples, and leave the other half empty, so the band would show holes |
| Writing each level's own samples with a sample mask | Rejected. WebGL2 has no sample mask output, so the two paths would fade differently |

The masks that test their alpha by the hash switch at once, so that the fading set stays small. The same dither would work after the hash test ([Follow-ups](#follow-ups)).

### Shadows

Each shadow view picks its casters' levels by their error in its own texels, as three.js r187's meshlet pipeline does (its `shadowLodThreshold`). The rule keeps its form, with the view's own measure:

```text
level j draws in a cascade when  error[j] × scale < threshold × texel
level j draws in a tile when     error[j] × scale < threshold × texel_per_meter × d_light
```

A cascade is an orthographic view whose texels have one size, `texel`, at every distance, so its distance counts as 1 and its factor is `1 / (texel × threshold)`. A spot or point light's tile is a perspective view from the light, so `d_light` is the distance from the light to the nearest point of the sphere, and its texels grow by `texel_per_meter` with each meter. The sun's hero tile is orthographic, as a cascade is. The threshold is the `lodShadowThreshold` quality setting, in texels: 1 on every preset, as three.js's default. `LevelRule::for_light` in `crates/null3d-core/src/levels.rs` builds the rule, and `cull.wgsl` reads where the view measures from (`measure`, beside the rule's factor).

A cascade's box keeps its size while the camera moves and turns ([D-15](D-15-cascade-split.md)), so its texel keeps its size too. A caster's level in a cascade therefore never changes while the camera moves, and a tile's changes only when its light or the caster moves. Far cascades and tiles keep their depth between redraws ([D-16](D-16-moving-casters-and-bias.md), [D-61](D-61-shadow-tile-redraws.md)), and that depth stays right. A rule by the camera's distance would change a level as the camera moves, and a kept layer would show the change at its next redraw. A light whose shadow distance follows the farthest receiver resizes its boxes when that distance steps, by 1.25 times a step ([D-168](D-168-auto-shadow-distance.md)), and its casters' levels follow the new texels.

The look rule sets the threshold. The normal bias moves each receiver by up to one texel of its cascade along its normal ([D-16](D-16-moving-casters-and-bias.md)). A shadow level that errs by under a texel lies within that offset of the base surface, so it does not shadow the base surface. The camera's own level errs by under a pixel. The filter's square of 3 or 5 texels and the comparison with the receiver's plane absorb the rest. The image test `cluster-shadows-fine` draws a ground that shadows its own hills with the finest patches in every cascade, and must match `cluster-shadows`, which draws each cascade's own cut. A larger threshold would let a level's silhouette pass the bias, so no preset raises it.

The desert benchmark with shadows gave 2.4 times fewer cascade triangles in the walk view and 1.8
times fewer in the aerial view. The frame's triangles were a third lower, mostly from the ground's
patches ([D-213](D-213-cluster-levels.md#shadow-views)). Those figures are void. Their build drew
null3D at 3840 x 2160 for a page of 1920 x 1080, with culling spheres off center. The GPU also
refused its frames at Medium with E1305 ([D-322](D-322-benchmark-against-threejs-meshlets.md#the-canvas-size-fault),
[D-307](D-307-mesh-pieces.md#the-check-during-play)). On a build with both fixes, the walk view's three cascades
add 4.30 M triangles to the camera's 3.64 M (run 20261104-153548-bench, [D-322](D-322-benchmark-against-threejs-meshlets.md#results-of-the-fair-rematch)).
A comparison of the two rules on that build remains to be taken.

The Island showcase, at High on WebGPU with the governor off, draws the same frame with either
rule on the commit that this change starts from: 6.50 M triangles against 6.49 M, 3,727 draw calls
in both, and its three cascades in 3.79 ms against 3.76 ms (medians of three runs on the dev
server, at loads of 30 to 80). Its casters there carry no levels and no tree, so the rule has
nothing to pick. The run-time levels that a mesh made in code plans ([D-310](D-310-runtime-levels.md))
give them levels, and then each cascade picks them in its texels too.

Three properties of a source keep the camera's measures in a shadow view:

- A distance band reads the camera's distance in every view, so a source outside its band casts no shadow, as before.
- A level given by a distance or by screen coverage switches at the camera's distance, as its author set it for the camera. Such a level has no error to measure in texels.
- Shadow views do not fade: they draw the level that the rule picks.

| Option | Verdict |
| --- | --- |
| Each shadow view picks by its own texels, at a threshold of one texel | Chosen. The level holds while the camera moves, so cached cascades and tiles stay right. A far cascade, whose texels are large, draws coarse levels, and a near one fine levels |
| Shadows pick by the main camera's distance, with the camera's threshold times a shadow factor of 2, or 4 on Low | Rejected. A far cascade drew a near caster at the near caster's fine level, many times its texels' detail. A kept layer showed the level of the camera's place at its last redraw. Two cascades could not pick two levels |
| One level for every cascade, from the finest cascade that holds the caster | Rejected. The level would follow the camera's place, as before, and a far cascade would draw the near cascade's detail |
| Shadows always draw the base level | Rejected. The shadow passes would keep the full vertex cost of a dense forest |

### A bound under a pixel draws nothing

Every level set has a last level that holds no geometry. An object or instance row hides when the world diameter of its bounding sphere covers fewer pixels than `lodThreshold`:

```text
diameter × factor < distance,  factor = render height × P[1][1] / (2 × threshold)
```

This is the factor that picks every level, so the render height, the render scale and the governor's doubled threshold all move the hide distance. The diameter, not the radius, measures the object: a bound that covers half a pixel each way is a pixel across, and other engines cull at that size. At Medium and above an object goes when its diameter is under a pixel, and on Low under two.

Past the hide distance lies the same 8% band as a level switch. There the level that the object would draw goes into its fade bucket with a negative fade value, so the dither drops a growing share of its pixels until none remain. Without a band, or without a fading build, the object hides at the hide distance. A mesh without levels never hides, so a scene without levels still pays nothing. Both paths compare the same values: the job workers and the direct-draw culling read `levels.rs`, and the GPU's culling shader reads `cull.wgsl`.

A shadow view hides a caster whose diameter covers fewer of its texels than `lodShadowThreshold`, as its level choice measures. A pebble 1 cm across draws nothing in a cascade of 2 cm texels, wherever the camera stands. It draws no band, as the shadow maps already pick without one.

### The threshold per preset

The threshold is 1 pixel from Medium up and 2 on Low. The desert benchmark's walk view measures what a coarser threshold would save and cost, at Medium, against the frames drawn from base levels alone. The figures are the mean of 8 held frames at 1920 x 1080, with the level distance measured to the nearest point. FLIP is a perceptual image difference, 0 for the same image, and its share over 0.1 counts the pixels that most viewers notice. Triangles and held-frame GPU times come from the development build, ground included:

| Camera threshold | Triangles | GPU, held frame | FLIP | Pixels over 0.1 |
| --- | --- | --- | --- | --- |
| 0.5 px | 8.14 M | 2.32 ms | 0.0126 | 2.5% |
| 1 px | 4.98 M | 1.72 ms | 0.0119 | 2.4% |
| 1.5 px | 3.71 M | 1.40 ms | 0.0179 | 5.1% |
| 2 px | 2.98 M | 1.37 ms | 0.0196 | 6.1% |
| 3 px | 2.39 M | 1.32 ms | 0.0215 | 6.7% |
| 4 px | 2.04 M | 1.32 ms | 0.0272 | 8.9% |
| three.js r187 meshlets, its 1 px | 1.73 M | 2.77 ms | 0.0208 | 7.1% |

Below 1 pixel nothing improves: about 0.012 is the frame's error from the parts that levels do not touch. Each engine is compared with its own base-level frames, so lighting and shadow methods do not count.

| Option | Verdict |
| --- | --- |
| 1 pixel from Medium up (chosen) | It keeps about half three.js's image error with 3.8 M triangles a frame on the desert's lap, at 1.48 ms of GPU time against three.js's 2.19 ms |
| 2 pixels on Medium | Rejected by the owner. It matches three.js's image error with 53% fewer triangles, 1.81 M a frame on the lap, and saves about 0.3 ms of GPU time (1.48 to 1.16 ms without shadows, 2.69 to 2.10 ms with three cascades). On the Mac the lap's frame is bound by the CPU, at 1.72 against 1.76 ms between frames, so the saving does not reach the screen, while the image loses its lead over three.js |
| A shadow threshold of 2 or 4 texels | Rejected. At 1 pixel, 2 texels draw 9.33 M triangles in place of 14.05 M with three cascades, for 0.47 ms. The error of the frame's bottom third, where the near casters' shadows fall, doubles from 0.0075 to 0.0146, and at 4 texels it triples |
| Lower the planner's normal weight from 1 to 0.25 | Rejected. At 1 pixel it draws 2.69 M triangles at an error of 0.0192: the same trade as a threshold of 2 pixels. It would also write every model file again |

The lap timings are three runs of 10 seconds each, through `bun run bench:run --scenes desert --switches lod=2` (`bench/research/triangle-budget/results/timings.log`). The runs with shadows reached a 1-minute load of 8 to 10, so their figures are rough. The held frames come from `bench/research/triangle-budget/scripts/shots.ts`, their comparison from `compare.py`.

### The governor

The render scale is part of the render height, so a lower scale picks coarser levels with no new step. A governor step, after the render scale's steps, doubles the threshold, up to four times the preset's. The same step doubles the shadow maps' threshold in texels. It runs only while the scene draws a level set.

### Copy lists that follow what draws

A view's compacted instance buffer holds one copy of each source that draws, in the slice that the bucket's draw reads. Any source of a set may pick any level. A slice for every source of the set in every bucket of the set would take four times the copies that the sources need for four levels, and eight times with fading bands. Each copy takes 64 bytes per source per level per view. The copies of a dense forest would then pass WebGPU's 128 MiB binding limit near 260,000 copies.

So the frame sizes each level's slice to the copies that it draws, and the slices of one set take the room of the set's sources. `Layout::fit_copies` (`crates/null3d-render/src/gpu_driven/copies.rs`) counts the copies that each view places in each bucket. It uses the same stateless rule that the culling shader runs. It takes the largest count over the views that draw the layout. A source near a switch distance counts toward both levels that it may pick. So a slice never falls short of the shader's writes, whatever the last bits of a shared distance come to. Each view counts only the sources inside its frustum, as its culling pass appends no other. The views of a scene whose staged levels a loader watches count every source, because the watches read every level that a source picks. The buckets without levels keep the slices of the build. A scene without levels runs no count. A slice keeps its place while its count fits, with spare room of an eighth of its count and 64 rows, because a view's bundle and buffer name the slices. A count that outgrows its slice moves the slices, and the frame records the bundles and sizes the buffers again ([Level slices and moving cameras](../implementation-notes.md#level-slices-and-moving-cameras)).

| Copies of four levels, with fading bands | A slice per source in every bucket, by arithmetic | Sized to what draws, measured |
| --- | --- | --- |
| 40,000 copies, the main view | 20.5 MB | 2.6 MB |
| 40,000 copies, the four cascades' casters list | 10.2 MB | 5.1 MB |
| Both lists together | 30.7 MB | 7.7 MB |

`crates/null3d-render/tests/levels.rs` measures the right-hand figures from the frame's own copy lists. `forty_thousand_copies_of_four_levels_take_one_copy_each` reads the main view, and `forty_thousand_casters_of_four_cascades_take_a_copy_for_each_level_that_a_cascade_picks` reads the casters' layout with four cascades. The cascades share one bucket table, so a level's slice holds the most copies that any cascade places in it. Each cascade picks in its own texels, so two cascades can place one caster in two levels. The test's 40,000 trees stand together inside every cascade, and the four cascades pick two levels: 5.1 MB, twice the 2.6 MB of one level. Each shadow view counts only the casters inside its frustum, with its sphere grown by the count's slack, so a caster that no cascade holds takes no copy. The same trees far past the shadow distance take none. The middle column is arithmetic at 64 bytes a copy. The main view would have eight slices, one for each of four levels and its fading band: 20.5 MB. The casters' list would have four, because its shadow pipelines take no fading build, and its fade buckets exist only in the scene layout: 10.2 MB.

Counting every caster in every cascade would put a near cascade's fine levels and a far cascade's coarse levels in every caster's count. The casters' list would then approach a slice for every copy in every level, the cost that this section removes.

A band adds about a tenth more, for the sources inside it, which take a copy in each of two fade buckets.

The culling shader cannot size these slices itself. A draw reads its bucket's copies from a vertex buffer offset that the frame records on the CPU. An indirect draw keeps its first instance at 0 (hard rule 8). A count on the GPU would need a readback, or a second pass that costs every frame. The CPU count runs only for the sources of a mesh with levels. A view's list of chosen patches has the same sizing problem, and the frame counts it on the CPU too ([D-213](D-213-cluster-levels.md#what-it-costs)).

The count picks a level for every source in every frame, twice for each source, at each edge of the slack. So its cost grows with the sources, even when only the camera moves. The desert comparison draws 16 batches with 63,000 rows in all. There, a CPU profile in Chrome on the MacBook Pro M5 Max put 3.5 ms of the sketch worker's 4.6 ms frame in the count. That build drew null3D at 3840 x 2160 ([D-322](D-322-benchmark-against-threejs-meshlets.md#the-canvas-size-fault)). The count's cost follows the sources, not the pixels, so the fault leaves these CPU figures as they are. The engine had started no job worker, as no other loop of the scene asked for one. So the count runs on the job workers, in chunks of 1,024 sources. Each thread counts into a tally of its own, and the tallies are summed. The sum is the same whatever thread counts which source, so the slices are unchanged. The tallies take a cache line's multiple of words per thread, in the layout's working list. `job_workers_count_the_same_copies_of_each_level_as_one_thread` in `crates/null3d-render/tests/levels.rs` compares four job workers with one thread. Its forest spreads over every level, band and the hide distance, in the camera's list and the casters'. On the job workers, the comparison's recording step fell to 1.1 to 1.7 ms. The sketch worker's frame fell to 1.2 to 2.0 ms ([Benchmarks](../benchmarks.md#the-desert-comparisons-sketch-worker)).

Each source's two picks share one walk of its levels (`LevelRule::pick_both`). A switch distance that stops the walk at the far edge stops it at the near edge too. So the walk to the far edge passes the place where the walk to the near edge stops. Each switch distance is worked out once. Both edges then settle their bands, ranges and hide distance with the code that `LevelRule::pick` runs. `one_walk_picks_what_two_picks_give_at_both_distances` in `crates/null3d-core/src/levels.rs` compares the two over 20,000 random chains, rules, ranges and distances, fading amounts included. Rejected:

- Skipping the count while the camera moves little. The count's purpose is a slice that never falls short. A bound on how far the camera may move before a source switches would need every input of the rule tracked. These are the rows, the scale, the bias, the field of view and the render scale.
- One slice per source in every level, for every set. It is the memory cost that this section removes. Small sets take it, as the next section says.

#### Small sets keep a slot for every source

The count saves memory in proportion to a set's sources, and costs CPU time in proportion to them, in every frame. For a small set it saves little and still costs every frame. S4 shows it. Its 492 balls take planned levels, in five sets, one for each material. Each frame then walked all 5,200 objects to count the balls, once for the camera's view and once for each of the three cascades at Medium. The sketch worker's frame rose from 0.225 ms to 0.373 ms on the MacBook Pro M5 Max, a rise of 0.15 ms. A build that counts only the first frame took 0.225 ms, so the count was the whole rise. The GPU time did not change.

So the count now does three things:

- It visits only the sources whose mesh has levels. The layout lists them when it is built, because a source keeps its home bucket until the next build. The count walked every source before and skipped the others.
- It counts the views that share a camera in one pass, as the shadow views do, so each source's sphere is read once for all of them. Each view counts only the sources inside its own frustum.
- It skips small sets. A build keeps a slot for every source of a set in each of its buckets, so such a set can never outgrow its slices. Each layout fixes sets in bucket order while they fit 8,192 slots in all (`FIXED_LEVEL_SLOTS` in `crates/null3d-render/src/gpu_driven/layout.rs`). At 64 bytes a copy, that is at most 512 KiB a view. No frame counts a fixed set's copies, and its slices never move. A set with pieces or a tree of cluster patches is always counted. Its idle levels leave many draws out of the bundles, as the Island's walls do.

A fixed set draws every level, also when no copy picks it, because only a count can find a level idle. S4 then draws 94 indirect draws where the counted sets drew 86. The 8 empty draws add about 0.01 ms to the render worker's replay, which is not S4's busiest thread. The GPU time stays the same.

| S4 at Medium, WebGPU, busiest thread | Median ms a frame |
| --- | --- |
| Before the balls had levels | 0.225 |
| Every source counted in every view | 0.373 |
| Only the sources with levels, the views of one camera in one pass | 0.28 to 0.30 |
| Small sets fixed | 0.223, against 0.210 for the base in the same rounds |

`a_small_sets_slices_hold_every_copy_in_every_level_and_never_move` in `crates/null3d-render/tests/levels.rs` moves a fixed set's ball through every level and finds its copy list unchanged, while a counted set's list moves. `a_layout_lists_only_the_sources_of_a_mesh_with_levels_for_the_count` in the layout's unit tests checks the two lists of sources. The tests of the count itself build their worlds with `fixed_level_slots: 0`, which counts every set.

The buffer takes room to grow while that room fits the binding, and only the need when it does not. A frame builder refuses a need past the device's limit with E1501, which names the limit in bytes. Every buffer that a frame sizes against a binding takes the same check. `a_copy_list_past_the_binding_is_refused_rather_than_sized_over_it` in `crates/null3d-render/tests/levels.rs` gives a device whose binding holds the sources, and a batch that reserves room in every bucket of its levels. It reads the refusal.

### A material per level

A far level draws with a material of its own where the author gives one, so it shades more cheaply than the near level: without a normal map, or with an opaque mask in place of an alpha-tested one. Buckets are per material, so the engine's part is small.

- `mesh.setLevels` takes a `material` on any level. A level without one draws with the material of the level before it, so a set names the cheaper material once. The base level draws with the object's or the instance batch's material.
- The rule is a chain, not an absolute material on every level, so `links_of` can find a coarser level's bucket from any level's key without carrying the base material. A level key holds its own effective material, and the next level takes its own or that one.
- A level's bucket key is built from the level's mesh and material, through the same steps as a source's key: the pipeline, the map group, the page, the level key and the material. The receive-shadows bit comes from the base key's pipeline, since the level belongs to the same object. A level whose material cannot draw with the mesh's vertex format is left out, like any pair that draws nowhere.
- Fading builds follow each level's own pipeline. A cheaper level material that masks fades; one that does not mask has no fading build and switches at once.
- A glTF file gives a level a material when the level node's primitive names another material than the node's primitive. The asset tool keeps one material per mesh, so its levels inherit.

The lod image test's `lod-material` case draws each level with a material of its own in the level's color, a different pipeline from the base's vertex-colored one. It must draw the same image as `lod`. E1221 names a level material that is destroyed or from another engine.

### Levels from files

The asset tool writes each level's triangles over the base mesh's own vertex accessors. The loader stores such a level over the base's vertices, so the level costs its indices alone. It shares the base's page and vertex ranges. The storage appends the level's triangles after the base's own. On WebGL2 it shifts them by the part's place in its page; on WebGPU the draw adds the part's base vertex. The level takes the base's radius, format and vertex count. It goes when the base goes. Taking the level out frees its indices alone, never the base's vertices.

Two kinds of level copy their vertices. One names its own positions, as the tool's cards do. The other has a base that the engine split into parts, or that morph targets pose. A skinned base shares its vertices, because the skin moves the same vertices whichever level names them.

The test scene's ball shows the saving. Its base has 1,225 vertices of 16 bytes, and four levels. As copies, the levels would take 91,600 bytes of GPU memory. Over the base's vertices they take 13,200, so the four levels save 78,400 bytes on that one mesh. One picture test draws the file with each level's accessors copied, and its picture must match the shared one. On the Mac the two frames match in every pixel, on its GPU and on its software GPU, in the run that commit `5701261aa` records. CI's software GPU differs in one to three pixels of the 640 x 360 frame, each by one step of 255. The same vertices, read from another place in a buffer, round so there. The test keeps the exact match on the Mac and allows sixteen pixels on SwiftShader ([Image tests](../image-tests.md#references)).

After the levels are planned, the tool orders each mesh's vertices coarsest level first, as meshoptimizer's README advises. The coarsest level's vertices come first, then each finer level's new ones, then the base mesh's own. Any vertex that no triangle uses comes last. Every vertex stream moves with them, and the base's indices and every level's indices are remapped. The step runs only for the meshes whose levels the tool plans; a file's own levels keep their order.

The order leaves each level at the start of the buffer. On the tool's staged terrain the coarsest level names 515 vertices and its largest index is 514. Each finer stage's largest index is one less than the vertices it uses, up to the finest stage's 16,641. A staged loader can therefore send the coarsest level's part of the buffer first and add each finer part as it arrives.

The step runs before the cluster planner. A mesh that takes both whole levels and a tree of patches therefore writes them over one vertex order, which is the layout that M3-L3's patch data and its fallback levels share. The tool builds it once, in `packages/cli/src/assets/levels.js`, and both writers name the base mesh's accessors.

The gain is the share of the buffer that a coarse level does not need resident. On the tool's test ball the coarsest level names 122 of 1,225 vertices of 16 bytes. Unordered, they spread over 98% of the array, so a draw needs almost the whole 19,600-byte vertex buffer. The order puts them in the first 1,952 bytes. That holds back 17,648 bytes, 90% of the buffer, until a finer level arrives. The gain scales with the base's vertex bytes, and it is a streaming and cache gain only. The levels copy no vertices, so no total memory and no picture changes. It gains nothing for the 40,000-pine scene, whose procedural levels are meshes of their own. M3-L4's staged loading is the user that spends it.

`packages/cli/src/assets/levels.test.ts` holds two facts. Each level and every coarser level share one prefix of the new numbering. Every triangle keeps the positions it drew before the reorder. Unordered, the coarsest level's 515 vertices reach index 12,245, and the levels together reach the base mesh's last index, 16,640. So the prefix check fails without the order.

### How many levels a mesh takes

A mesh takes up to 15 lower levels, 16 with the base mesh. The asset tool halves each level down
to about 32 triangles ([D-91](D-91-level-planning.md#how-far-the-levels-go)). So a mesh of `n`
triangles needs about log2(n / 32) levels. A desert pebble of 20,480 needs 9, and a mesh of a
million needs 15. The engine first took 7. The tool then took steep steps in the middle of the chain, and a
boulder's or an arch's mid level drew far past its distance, as D-91 records.

The limit lives in these places, and each one changed with it:

- `MAX_LEVELS` in `crates/null3d-render/src/levels.rs`, which sizes each mesh's level set.
- The level field of a bucket key's mesh word, 4 bits. A level key keeps its own top bit, so the
  base mesh's id must stay under 2^27. A unit test round-trips every level of such an id.
- The mask of the levels that fade, 16 bits through the renderer. The page passes a 32-bit word
  already, and the WebAssembly entry point cuts it to 16.
- The level code that the levels debug view reads: the level in 4 bits, the hidden mark at bit 4,
  the fade's share at bits 5 to 10, and the band's side at bit 11. The core writes it on WebGL2, and
  the culling shader on WebGPU. The debug view's shader reads it. A core unit test reads both
  shaders' text and fails when their bits differ from the core's. From the seventh lower level on,
  the view draws gray, its last color.
- `setLevels` in `packages/engine/src/scene/resources.ts`, which refuses a sixteenth lower level
  with E1221.

Each mesh slot of the level table grows from 108 to 212 bytes. The table holds a slot for every
mesh id up to the largest one with levels, so ten thousand meshes take about 2 MB. Nothing in a
frame grows with the limit itself. A mesh with more levels adds what each level adds: a draw
bucket for each pipeline key, and a fade bucket where a level fades. A level of the asset tool has
a measured error, so it switches at once and takes no fade bucket. Each source's level walk also
takes one more step for each level that it passes, on the GPU and on the job workers.

The desert benchmark measured the deeper chain against the tool's seven-level chain, on this
engine and the same ground. These figures are void. The comparison's runner drew null3D at Medium,
where the GPU refused that build's frames with E1305, and at 3840 x 2160 for a page of
1920 x 1080, with culling spheres off center ([D-322](D-322-benchmark-against-threejs-meshlets.md#the-canvas-size-fault)).
They stay as the only comparison of the two chains, and a run on a build with both fixes remains
to be taken. The deeper chain's own figures on such a build are in [D-322](D-322-benchmark-against-threejs-meshlets.md#results-of-the-fair-rematch):
3.64 M triangles and 1.17 ms of GPU time walking, 3.33 M and 1.15 ms from above. Each figure is the median of three uncapped runs of 10 seconds, with
the views' pages in turns, in Chrome on the MacBook Pro M5 Max:

| Page | Triangles | Draw calls | Frame interval | GPU time |
| --- | --- | --- | --- | --- |
| Walk, the whole scene | 15.35 M to 11.80 M | 206 to 264 | 6.84 to 6.45 ms | 3.91 to 3.61 ms |
| Aerial, the whole scene | 15.16 M to 9.23 M | 169 to 264 | 6.76 to 6.89 ms | 3.94 to 3.89 ms |
| Walk, pebbles alone | 2.14 M to 1.45 M | 49 to 61 | 4.81 to 4.88 ms | 1.19 to 1.26 ms |
| Walk, boulders alone | 3.70 M to 2.49 M | 33 to 49 | 4.68 to 3.84 ms | 1.00 to 1.03 ms |
| Walk, columns alone | 1.02 M to 0.44 M | 34 to 49 | 3.28 to 4.18 ms | 0.93 to 1.04 ms |
| Walk, arches alone | 5.88 M to 5.12 M | 55 to 70 | 5.34 to 4.45 ms | 2.35 to 2.52 ms |

Every kind draws fewer triangles, the boulders, columns and arches too, which the steep chain had
raised. The draw calls rise by a quarter to a half, by one per level that some copy picks. The
sketch worker's busy time fell into two modes on both chains: about 1.6 to 2.1 ms or 3.1 to 4.8 ms
for the same page. The render worker's moved with it, so the processor's speed sets the mode.
Within one mode, the deeper chain took 5% to 15% more of the sketch worker, for the extra draws
and the longer walks. The frame interval and the GPU time moved within the runs' spread, apart
from the walk view's GPU time, which fell by 8%.

How the data was produced: `bench/meshlets/build.ts` of the comparison's checkout with this
branch's asset tool, then its `run.ts --uncapped --runs 3` with `pump=1`, `warmup=3` and
`seconds=10`, over the engine's CDN build from this branch. Both model sets held the ground that
this branch's tool wrote, so only the props' levels differ. No other run used the machine.

### Trees with leaf cards

Creek's trees come from glTF files whose leaves are cards: quads with an alpha-masked leaf texture. The level planner ([D-91](D-91-level-planning.md)) locks each list's border, so the lists of a mesh still meet. Every vertex of a card lies on the card's border, so no card can lose a triangle. A test tree with a trunk of 384 triangles and 600 cards of 2 triangles each, 1,584 triangles in all, shows it. The trunk halves to 192 triangles, but the step keeps 1,392 of 1,584, more than three quarters, and the planner stops before the first level. Without the lock, meshopt's simplifier folds each card into one triangle. That cuts away half of each card's leaf texture.

So the asset tool thins card lists in a step of its own, and a tree that leaves Blender without levels still gets them.

- The tool calls a part a card list when every separate piece of it, after welding, is a quad of four vertices and two triangles, or a card folded along its middle of six vertices and four triangles, as Creek makes its leaves. A flat-shaded surface splits into pieces of three vertices, so it never matches, and it keeps the simplifier's path.
- Each level keeps every second card of the level above, in an order along a space-filling curve of the cards' middles, so a level thins the crown evenly, not one side first.
- Each kept card grows about its middle by the square root of two for that step, so the cards keep the surface that the dropped ones covered. The file stores the level's own positions, because the growth moves vertices. This is the one level kind that copies vertices.
- The level's error is the size of the largest card that it drops. Creek's cards are 0.8 m wide. On a 1,080-pixel screen, a level switches at about a kilometer. That is conservative: it thins a crown only long after the geometry detail has gone. A hand-authored level, as Creek's Blender script makes, switches nearer. The tool's rule stays geometric and predictable. An author who wants earlier thinning gives the level its own error.
- The card step runs only for a mesh that a skin does not pose, because a posed list's positions are in the scene's units and the level's stored positions are in the mesh's.

The picture `asset-card-level` shows this step. The tool builds a tree of 40 cards of 0.3 m and a trunk. The picture loads the tool's file and draws its first lower level. That level keeps 20 cards and grows each about its middle by the square root of two. A card's size is the level's error, so the switch lies far out. The picture sets the threshold to 16 pixels, the most that the setting takes, and gives the tree a bias of 4. At a 640 by 360 picture and a 40-degree lens, the rule's factor is 30.9. The level's error of 0.424 m then switches it 13 m out. The bias divides that to 3.3 m. The camera's nearest point lies at 3.8 m, and its level distance, to the crown's sphere's center less half its radius, lies farther out, short of the second level's switch. The crown spans about 100 of the picture's 640 pixels. The fixture has a second card level, which keeps 10 cards at an error of 0.636 m. With the bias of 4 it switches at 4.9 m, past the camera's level distance, so the picture draws the first one.

Without the step the tool plans no level for the crown at all. Every edge of a card is an open border, which the simplifier keeps, so the crown's triangles never fall. The picture would then draw all 40 cards at their own size, and 0.9 percent of its pixels differ from the reference, against the picture tests' limit of 0.1 percent. The unit tests hold the step's own rules: `keeps a share of the cards at each level, grown about their middles`, `writes each card level its own positions, and shares the wood stream`, and `treats a card folded along its middle as a card, as Creek makes its leaves`.

An author can also make the levels in Blender and export them with `MSFT_lod`, which the loader reads. The forest demo's procedural pines make their levels in code.

### Texture coordinates in the level error

The simplifier weighs normals and vertex colors in its error. Without texture coordinates there, a texture could slide between two vertices of a level with no error shown. So the planner adds each texture coordinate set to the attributes that the simplifier keeps, with a weight of a sixty-fourth of the mesh's longest side. A texture coordinate's unit covers the texture across the mesh. A slide of a large share of a texture therefore counts like a small distance, while a slide of a few texels stays under the geometry's own error. Texture seams still lock, and welding still keeps two copies of a vertex apart where their coordinates differ.

The weight is modest on purpose. The error that the simplifier reports includes the attributes, and the engine reads a level's error as a distance. A heavy weight would make every textured mesh switch levels much farther out. At a sixty-fourth of the mesh's side, the test scene's ball plans six levels, and its first lower level errs by 0.0105 m.

The picture `asset-bent-grid` shows this weight. The tool builds a flat grid of one meter across and 32 by 32 cells, whose texture repeats twice across it, and the picture looks at it from about a meter. It sets the threshold to 12 pixels. At a 640 by 360 picture and a 60-degree lens, the rule's factor is then 26.0. The first three lower levels report errors under 0.1 mm: on a flat surface whose texture coordinates run linearly between their seams, dropping inner vertices moves neither the surface nor the texture. The coarsest reports 0.055 m, the slide of its texture, and switches in 1.42 m out. The camera's level distance, to the grid's sphere's center less half its radius, is 1.23 m, so the third lower level draws, and its texture stays where the base mesh puts it. Without the weight the errors fall to 0.00001 m through 0.00017 m, and the coarsest level switches in 4 mm out. It draws against the camera, and its texture scrambles: 10.0 percent of the pixels differ, against the picture tests' limit of 0.1 percent. So `asset-bent-grid` is the weight's proof. At 16 pixels the coarsest level would switch in at 1.07 m, inside the camera's level distance, and the picture would show the slide that the weight measures: 10% of its pixels. On that picture the owner ruled the weight question moot: no exemption remains.

meshoptimizer weighs each attribute after it scales the list's points into a box of side 1, so an attribute's weight is a share of the list's own size, not a distance in the units of the positions. The planner therefore passes the mesh's longest side over 64 times the list's longest side, which is a sixty-fourth of the mesh's side in every unit. The planner reads a quantized file's positions in integer steps, so a weight of a sixty-fourth of the side in those units would weigh the texture coordinates 16,383 times more than meant in a mesh of 16,383 steps, and a mesh in meters by its size in meters. Too large an error keeps a textured mesh's fine levels far past where they stop showing, and stops its levels early: a textured sphere then reports an error of 4.3% of its size in steps and 1.5% in meters (`bench/research/triangle-budget/scripts/weight-units.ts`). `plans the same levels from a mesh in meters and from its quantized steps` in `packages/cli/src/assets/levels.test.ts` plans one bent grid in meters and in 16,383 steps, and requires the same triangles and the same errors as a share of the side; a weight in position units gives the quantized grid fewer levels.

The unit test's own bent grid measures the weight. It is a flat grid of one meter across, 32 by 32 cells, whose texture coordinates repeat the texture eight times across it. With the shipped weight, one sixty-fourth of the longest side, its coarsest level reports an error of 0.116 units. The same grid with one texture coordinate everywhere reports 0.00016, so the reported error is the weight's. A slide of the whole texture over a one-meter mesh counts as one sixty-fourth of a unit, a small fraction of the mesh's size. The unit test reads the error itself, which is the quantity the weight adds: `counts a texture that would slide, where a flat surface otherwise simplifies free` holds the bent grid's coarsest error above 0.11 units.

### The level image tests

The level image tests place their spheres by their nearest points. Each copy stands along its own ray at the exact distance that a level given by a distance or by coverage measures. A level given by its error measures half a radius farther, to the center less half the radius. So the test page sets each error half a radius over 1.03 farther out than the hand-set switch, and the hide test's threshold by the same shift: the copy at 103 percent then lies at exactly 103 percent of its switch whatever the measure, keeps the same share of the band's dither, and every measure draws the same picture (`lod-sketch.ts`, `ERROR_SHIFT`). A copy placed at a depth and then moved off the camera's axis would lie 2 to 4 percent farther than that depth, so nearer its next switch than the test means. The five percent either side of a switch hides that where the levels switch at once. A bias of 2 does not hide it: it halves the switch and the copies' distance, while the sideways offset keeps its size. The nearest copy, at 95 percent of its switch, would then cross that switch and draw level one.

The measured figures, from a native test on the job workers and from the picture on all three paths:

| Object | Switch | Copy at 95 percent | Copy at 103 percent |
| --- | --- | --- | --- |
| No bias | 15.59 m | base level, one copy | level 1 |
| Bias of 2 | 7.795 m | base level, one copy | level 1 |

The biased switch is exactly half the unbiased one. The fading bands' pictures depend on how far past a switch a copy lies. The `lod-bias` picture has its own references in both environments: a bias of 2 puts the same levels at half the distance, so the copies are twice the size on screen and cannot share the plain picture.

### Cluster levels

Cluster levels (M3-L3, [D-213](D-213-cluster-levels.md)) serve large static meshes that do not bend, such as scans, cliffs, buildings and CAD models. The asset tool builds a tree of patches of about 128 triangles with `clusterlod.h`. A patch draws when its own error is under the threshold and the error of the coarser patch above it is over it. The test needs no state from earlier frames, so both GPU paths can run it. Patches in a group switch together, so no gaps open.

Meshes with many copies, skinned meshes and leaf-card trees stay on this record's levels on both paths. Unreal's docs say its cluster method thins tree crowns with distance, because each leaf is a separate piece with open edges. Multi-draw indirect and 64-bit atomics wait for browsers, as [D-179](D-179-technique-rulings.md) ruling 27 says. Cluster levels need neither.

### Impostor cards that blend three views and relight

The impostor cards of [D-151](D-151-octahedral-impostors.md) (M3-L4) are one instance batch of quads, drawn by the add-on's own material. The engine compiles it from WGSL that ships with the package. The cards blend the three stored views nearest the camera, and the scene's lights light them. A bake that stored light would show cards lit for a sun that has set once the sun moves. Three properties carry the design:

- The vertex offset faces every quad to the screen. It reads the instance's world matrix, whose columns are the card's axes turned into the view's space, and returns the move that puts the quad's corner on the screen's plane. The engine applies the instance transform afterwards, so the offset is that rotation's inverse applied to the wanted point.
- The surface function folds the direction from the card toward the eye onto the octahedral grid, finds the triangle of cell centers that holds it, and blends the three cells by its barycentric weights. The same weights blend their stored normals, which are decoded in each view's space and turned by the camera's axes, since the card faces the screen. The engine then lights the card with the scene's lights, exactly as it lights a mesh.
- The bake writes two atlases: a color atlas, in sRGB, and a surface atlas whose red and green hold the octahedral code of the view's normal, blue the point's depth and alpha its coverage. `encodeImpostorSurface` writes those texels, so a bake stores the surface and never its light.

The add-on changes no engine source, as D-151 rules: the material, the quad and the octahedral code all sit in `@null3d/impostors`. The octahedral fold exists twice, once in TypeScript for the bake and the unit tests and once in WGSL for the card. A change to one must change the other, and the picture test draws the cards around many directions, so a disagreement shows.

The eye comes from the frame's camera, so the cards need no per-frame call and no origin of their own. The engine draws everything relative to the camera, so world positions keep their precision far from the world's origin.

## Costs

The size check measured the two download rows against main, in the runs of pull request #519 (commit `16a710a2f`), whose logs are not kept.

| Item | Cost |
| --- | --- |
| Scene without levels | One more word read and compared per source in the culling shader; none on the job workers, which skip the level walk while no layout has levels |
| Bucket records | 15 words in place of 10, per bucket |
| WebGPU copies | One copy per source that draws, in each view; a source in a band takes a copy in each of two fade buckets ([Copy lists that follow what draws](#copy-lists-that-follow-what-draws)) |
| WebGL2 | Two words per fading entry; levels cost nothing while their buckets are empty, as empty draws are skipped |
| Shader downloads | The `lod_fade` set, on the first fade: 20.6 to 23.9 KB after Brotli per build. The coverage set does not grow, as builds that fade and use alpha to coverage belong to the `lod_fade` set |
| JavaScript and WebAssembly | After Brotli: the WebAssembly glue +2.6 to 2.7%, the renderer page +2.3%, the main WGSL set +2.0%, and the occlusion build's culling shader +12.4% (4.1 to 4.6 KB). The WebAssembly modules +1.4%, about 5 KB each |

## Data

### The forest on the Mac

Measured on the Mac's GPU, in Chrome, on each path and preset, with levels off and on in turns, in the same runs of pull request #519. The scene is the lod-cost test page: 40,000 instanced pines with four levels each, over hills, under the sun's shadows, seen from above the canopy. Off draws every tree's base mesh. Each figure is the median of a run. The computer's 1-minute load stayed between 4.6 and 6.8. This run measured the first design: every band faded except on Low, which drew none, and the distance reached the sphere's center.

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

Every run held the display's rate of 60 frames a second. So the GPU time is the figure that shows the saving. Levels cut the GPU time on every path and preset, by 4 to 57%. WebGL2 gains most: its GPU time halves at every preset. On WebGPU and compat, the saving varies more between presets, from 4% to 57%. In this run Low gained most there: it had no fade bands and the largest threshold. This run does not split the cost of the fade bands from the other preset settings. On WebGL2, the busiest thread is the sketch worker. It takes up to 0.16 ms more per frame for the level picks and fade pairs. Each job worker takes 0.02 to 0.04 ms more. That is under 3% of a 60 Hz frame.

Other checks of that build, the one of pull request #519:

- Allocation: `bun run bench:allocation --levels` passed on WebGPU and on WebGL2. S1's 100,000 boxes pick a level and fade each frame, and no place allocates over its budget.
- GPU check: S4 and S6 have no levels. At Medium and High they kept their GPU time: +0.1% on S4 and -1.9 to -3.0% on S6.
- Image tests: the five level tests and the forest demo match their references on all three paths, on the Mac's GPU and on SwiftShader. The full Mac image suite's other 922 tests pass.

### The forest on an iPad, a phone and the Mac

The level-of-detail tasks ask for the GPU time and memory on the Mac, an iPad and an S24-class phone. The runs are [the MacBook Pro's](../tested-devices/macbook-pro-chrome/20261025-224727-lod-cost.md), [the iPad Pro 11's](../tested-devices/ipad-pro-11-inch-safari/20261025-122307-lod-cost.md), [the iPad Pro 13's](../tested-devices/ipad-pro-13-safari/20261025-092058-lod-cost.md), [the Galaxy S24's](../tested-devices/galaxy-s24-sm-s921b-chrome/20261025-092622-lod-cost.md) and [the Galaxy S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261025-150332-lod-cost.md). The `lod-cost` page draws 40,000 pines, four levels each, under the fade rule of [D-211](D-211-lod-fade-and-distance-bands.md). It times the forest with every tree at its base mesh. It then times it with each tree at the level that its size on the screen picks. The two sides take turns, two seconds at a time, three times over, at Low and at High. After the timing the page reports each side's GPU buffer bytes from the stats overlay. The copy lists' memory is in [Copy lists that follow what draws](#copy-lists-that-follow-what-draws).

By the owner's rule, memory is read exactly, so a cloud iPad's memory stands. A GPU time is a timing, so an iPad's absolute figure comes from the owner's own iPad. The cloud iPad's figure stands beside it as the comparison. Phones keep the cloud-first rule, so the Galaxy S24 gives both of its rows.

| Device | Path | Preset | GPU off, on (ms) | GPU buffers off, on (MiB) |
| --- | --- | --- | --- | --- |
| iPad Pro 11-inch, owner's | WebGPU | Low | 67.36, 16.83 | 21.8, 21.8 |
| iPad Pro 11-inch, owner's | WebGPU | High | 150.92, 53.64 | 25.6, 25.6 |
| iPad Pro 11-inch, owner's | compatibility | Low | 67.62, 17.83 | 21.8, 21.8 |
| iPad Pro 11-inch, owner's | compatibility | High | 97.24, 46.31 | 25.6, 25.6 |
| iPad Pro 11-inch, owner's | WebGL2 | Low | no timer | 6.2, 6.2 |
| iPad Pro 11-inch, owner's | WebGL2 | High | no timer | 6.3, 6.3 |
| iPad Pro 13, cloud | WebGPU | Low | 10.95, 5.28 | 22.0, 22.0 |
| iPad Pro 13, cloud | WebGPU | High | 42.38, 32.12 | 25.6, 25.6 |
| iPad Pro 13, cloud | compatibility | Low | 11.00, 5.40 | 22.0, 22.0 |
| iPad Pro 13, cloud | compatibility | High | 31.36, 26.41 | 25.6, 25.6 |
| iPad Pro 13, cloud | WebGL2 | Low | no timer | 6.1, 6.1 |
| iPad Pro 13, cloud | WebGL2 | High | no timer | 6.2, 6.2 |
| Galaxy S24, cloud | WebGL2 | Low | no timer | 6.1, 6.1 |
| Galaxy S24, cloud | WebGL2 | High | no timer | 6.2, 6.2 |
| Galaxy S25, cloud, stand-in | WebGPU | Low | 22.81, 7.08 | 25.8, 25.8 |
| Galaxy S25, cloud, stand-in | WebGPU | High | 54.33, 34.80 | 27.6, 27.6 |
| Galaxy S25, cloud, stand-in | compatibility | Low | 23.72, 7.21 | 25.8, 25.8 |
| Galaxy S25, cloud, stand-in | compatibility | High | 25.69, 25.36 | 27.6, 27.6 |
| Galaxy S25, cloud, stand-in | WebGL2 | Low | no timer | 6.2, 6.2 |
| Galaxy S25, cloud, stand-in | WebGL2 | High | no timer | 6.2, 6.2 |
| Mac, Chrome | WebGPU | Low | 5.43, 3.70 | 19.8, 19.8 |
| Mac, Chrome | WebGPU | High | 9.54, 5.68 | 23.7, 23.7 |
| Mac, Chrome | compatibility | Low | 5.90, 3.74 | 19.8, 19.8 |
| Mac, Chrome | compatibility | High | 7.33, 4.16 | 23.7, 23.7 |
| Mac, Chrome | WebGL2 | Low | 8.25, 5.46 | 6.2, 6.2 |
| Mac, Chrome | WebGL2 | High | 12.48, 4.23 | 6.3, 6.3 |

The owner's iPad Pro 11-inch ran Safari 26.6.2 on iPadOS 26.7 at 59 Hz. Its window was 1,194 by 659 CSS pixels at 2x. Its levels cut the GPU time by 75% at Low on core WebGPU, and by 64% at High. They cut it by 74% and 52% in compatibility mode. Its WebGL2 frame interval fell from 108.94 to 30.16 ms at Low and from 154.44 to 77.32 ms at High. Its GPU buffer bytes do not change between the two sides, at 21.8 MiB at Low and 25.6 MiB at High. The run's own files therefore hold the memory rows on this device too.

This iPad is an older model than the cloud iPad Pro 13, so its absolute times are several times larger. At Low on core WebGPU its frame takes 67.36 ms with the base meshes against the Pro's 10.95 ms. That gap is why the owner's own iPad gives the absolute row, and why the Pro's figures stand beside it as the comparison, not in its place.

The cloud iPad ran Safari 26.6.1 on iOS 26 at 59 Hz. Its window was 1,032 by 1,264 CSS pixels at 2x. Its levels cut the GPU time by 52% at Low on core WebGPU, and by 51% in compatibility mode. They cut it by 24% at High on core WebGPU. Its GPU buffer bytes do not change between the two sides.

The Galaxy S24 ran Chrome 152 on Android 16 with no WebGPU adapter, so only its WebGL2 rows ran. Chrome on Android reports no WebGL2 GPU timer. The cloud display ran at 30 Hz, so its frame interval sits at its 33.3 ms limit and hides any saving. The runner marks its frame intervals unreliable; its CPU times do not depend on the display. Its GPU buffer bytes also do not change, at 6.1 MiB at Low and 6.2 MiB at High. Its CPU time rises with the levels on, by 1.78 ms at Low and 1.35 ms at High. That is the level picks and the fade pairs.

The Galaxy S25 stands in for the S24 class, because the S24 times no GPU on either path; it is the closest cloud device that times a GPU, as the rule for a device that cannot run the plan allows. It ran Chrome 152 on Android 15, on Qualcomm's Adreno 830. That is a faster GPU of another make than the S24's Samsung Xclipse 940. So its row shows the phone class's saving, not the S24's own figure. Its levels cut the GPU time by 69% at Low and 36% at High on core WebGPU, and by 70% at Low in compatibility mode. High on compatibility mode was flat. Its display ran at 30 Hz, so the runner marks its frame intervals unreliable; its GPU timer times do not depend on the display. Every interval sits at the display's 33.3 ms cap apart from High on core WebGPU, where the base-meshes side missed the cap at 66.6 ms. That interval's fall is the cap, not the levels' doing, so it is no saving. Its GPU buffer bytes do not change, at 25.8 MiB at Low and 27.6 MiB at High, and 6.2 MiB on WebGL2.

The Mac ran the page in Chrome: six pages in 3.9 minutes, each page's load gate under 8, between 6.1 and 7.9. The load then drifted to 8.7 after WebGPU High's gate and 11.1 after compatibility Low's gate. Every path held the display's 16.67 ms interval. The levels cut the GPU time by 32% at Low and 40% at High on core WebGPU, by 37% and 43% in compatibility mode, and by 34% and 66% on WebGL2. Its GPU buffer bytes do not change between the two sides, at 19.8 MiB at Low and 23.7 MiB at High, and 6.2 and 6.3 MiB on WebGL2. Chrome on the Mac times WebGL2, where the tablets and the phone report no timer there.

Levels add no GPU buffer bytes on any device: the totals are 19.8 and 23.7 MiB on the Mac, 21.8 and 25.6 on the iPads, and 25.8 and 27.6 on the S25. That they are identical off and on does not prove the sizing. Off is a threshold of 0 and keeps the buckets, so a slice per level per view would give identical sides too, and far more bytes. The absolute totals rule that out: each stays below the 30.7 MB that such slices would take for the two copy lists alone. The two Rust copy-list tests measure one copy per source, 2.6 MB each.

An iPad run connects only once the iPad trusts the mkcert root. Until then the runner page sits on "starting" and nothing reaches the Mac. [Device sessions](../devices.md) records that step.

## Decision

Ship the design as above. The data shows a clear saving on every path and preset, and no cost for scenes without levels.

## Consequences

- Morphed objects draw their base level: their vertices come from regions of their own, which levels do not have. A skinned object draws a level while the level names the base mesh's own vertices, as the asset tool's levels do.
- Blended and transmissive sources draw their base level: the transparent pass sorts them on the job workers with buckets of its own.
- Custom materials, and masks that test their alpha by the hash, switch levels at once: their builds have no fading level. A distance band cuts at once for them too. Masks with alpha to coverage, the default for foliage, fade. The dither drops whole pixels after the coverage test, so each kept pixel keeps its smoothed edge (see [Masks with alpha to coverage](#masks-with-alpha-to-coverage)).
- A static batch with levels is not culled in groups of 64 rows on WebGL2, so each row can pick its own level.
- The three.js mapping's `LOD (addLevel)` entry maps to `mesh.setLevels`, with each level's distance as its `distance` ([D-211](D-211-lod-fade-and-distance-bands.md)).

## Follow-ups

1. Levels for blended and transmissive sources, in the transparent pass's own buckets.
2. Fading builds for custom materials, which double their builds, and for the alpha hash.

Simplification in every frame is not planned: it costs CPU time and uploads every frame, and cluster levels give its result. A mesh made in code plans its levels once, on the job workers, with the asset tool's planner, and keeps them ([D-310](D-310-runtime-levels.md)). Those levels switch at once, as a file's measured levels do.
