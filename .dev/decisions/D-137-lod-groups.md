# D-137: Levels of detail picked by screen error

Status: accepted. The owner approved the design, and chose to merge it with the forest demo as it is; a later task improves the demo's look. The owner also ruled that M3-L1 to M3-L4 build every proposal of a review of this system, cluster levels included. Built: the design below with M3-L1's and M3-L2's changes, the fade rule and distance bands of [D-211](D-211-lod-fade-and-distance-bands.md), the WebGPU path of [D-213](D-213-cluster-levels.md)'s cluster levels, and M3-L4's impostor cards that relight. Open: the two follow-ups at the end. Task: M2-I4, then M3-L1, M3-L2 and M3-L4.

Summary: `mesh.setLevels` gives a mesh simpler levels; each object and batch row draws the coarsest level whose screen error stays under a pixel threshold. WebGPU's culling shader and WebGL2's job workers pick with one stateless rule, so both switch at the same distances, and hand-set levels cross-fade with a dither. Shadows pick coarser levels, bounds under the threshold draw nothing, and the copy lists hold one copy per source that draws.

## Question

Creek needs denser forests and Night town a bigger skyline at the same cost. A far tree of 2,000 triangles covers a few pixels, and its vertex work buys nothing. three.js has the `LOD` object, and the asset tool writes levels with their errors ([D-91](D-91-level-planning.md)). How does the engine pick a level for each object and each instance row, on both GPU paths, without a visible pop? And what do the shadows draw?

A review compares this system with other work: Hyper3D's article "[Level of detail 3D](https://hyper3d.ai/blog/level-of-detail-3d)", Unity 6's Mesh LOD and LOD Group, and Godot 4's mesh LOD and visibility ranges. It also takes in Bevy's visibility range, SpeedTree, meshoptimizer 1.x and its [`clusterlod.h`](https://github.com/zeux/meshoptimizer/blob/master/demo/clusterlod.h), [nanite-webgpu](https://github.com/Scthe/nanite-webgpu) and Unreal 5.7's Nanite foliage. The owner ruled that all of its proposals are built, as M3-L1 to M3-L4.

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

`d` is the straight-line distance to the nearest point of the sphere, `max(center distance - radius, 1 mm)`, as meshoptimizer's README, Godot and `clusterlod.h` measure it. Turning the camera therefore never changes a level. The minimum keeps the distance positive when the camera lies inside the bounds. Such an object keeps its base level, and the fade ratio stays defined. Measured to the center, an object whose radius is half its distance would show twice the allowed error on its near side. So large meshes and merged far cells keep finer levels at the same camera distance.

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

A level fades only where its switch shows ([D-211](D-211-lod-fade-and-distance-bands.md)). The asset tool's levels have a measured error, and they change the picture by less than a pixel at the switch: [D-91](D-91-level-planning.md) finds no wider change at 502 of 518 switches. They switch at once, with no double draw, discard or fade list. A level given by a distance, by a coverage or by a hand-set error fades, on Low too, since its switch would pop. Creek's leaf-card trees are such levels. The `lodFade` quality setting controls only the distance bands.

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

Shadow cascades, shadow tiles, mirrors and the outline view already place every source relative to the main camera. So `d` is the main camera's distance in every view, and each shadow view picks with the main camera's `k`, not its own orthographic projection. A shadow view multiplies the threshold by the preset's shadow factor, so its casters draw a coarser level. Shadow views do not fade: they draw the level that the rule picks.

| Option | Verdict |
| --- | --- |
| Shadows pick by the main camera's distance, with a larger threshold | Chosen |
| Shadows pick by the light's view | Rejected. A cascade's orthographic view would pick by the cascade's texel size, and a caster could shadow its own surface with a level far from the one the camera sees |
| Shadows always draw the base level | Rejected. The shadow passes would keep the full vertex cost of a dense forest |

Far cascades and shadow tiles keep their drawn depth between redraws. A level change then shows in them at their next redraw. That comes within the far cascades' interval, or when the tile's light or a caster moves.

### A bound under a pixel draws nothing

Every level set has a last level that holds no geometry. An object or instance row hides when the world diameter of its bounding sphere covers fewer pixels than `lodThreshold`:

```text
diameter × factor < distance,  factor = render height × P[1][1] / (2 × threshold)
```

This is the factor that picks every level, so the render height, the render scale and the governor's doubled threshold all move the hide distance. The diameter, not the radius, measures the object: a bound that covers half a pixel each way is a pixel across, and other engines cull at that size. At Medium and above an object goes when its diameter is under a pixel, and on Low under two.

Past the hide distance lies the same 8% band as a level switch. There the level that the object would draw goes into its fade bucket with a negative fade value, so the dither drops a growing share of its pixels until none remain. Without a band, or without a fading build, the object hides at the hide distance. A mesh without levels never hides, so a scene without levels still pays nothing. Both paths compare the same values: the job workers and the direct-draw culling read `levels.rs`, and the GPU's culling shader reads `cull.wgsl`.

The shadow views use their own threshold, times `lodShadowFactor`, as their level choice does. A caster's shadow therefore goes at a nearer distance than the object itself. It draws no band, as the shadow maps already pick without one.

### The governor

The render scale is part of the render height, so a lower scale picks coarser levels with no new step. A governor step, after the render scale's steps, doubles the threshold, up to four times the preset's. It runs only while the scene draws a level set.

### Copy lists that follow what draws

A view's compacted instance buffer holds one copy of each source that draws, in the slice that the bucket's draw reads. Any source of a set may pick any level. A slice for every source of the set in every bucket of the set would take four times the copies that the sources need for four levels, and eight times with fading bands. Each copy takes 64 bytes per source per level per view. The copies of a dense forest would then pass WebGPU's 128 MiB binding limit near 260,000 copies.

So the frame sizes each level's slice to the copies that it draws, and the slices of one set take the room of the set's sources. `Layout::fit_copies` (`crates/null3d-render/src/gpu_driven/copies.rs`) counts the copies that each view places in each bucket. It uses the same stateless rule that the culling shader runs. It takes the largest count over the views that draw the layout. A source near a switch distance counts toward both levels that it may pick. So a slice never falls short of the shader's writes, whatever the last bits of a shared distance come to. The buckets without levels keep the slices of the build. A scene without levels runs no count.

| Copies of four levels, with fading bands | A slice per source in every bucket, by arithmetic | Sized to what draws, measured |
| --- | --- | --- |
| 40,000 copies, the main view | 20.5 MB | 2.6 MB |
| 40,000 copies, the four cascades' casters list | 10.2 MB | 2.6 MB |
| Both lists together | 30.7 MB | 5.1 MB |

`crates/null3d-render/tests/levels.rs` measures the right-hand figures from the frame's own copy lists. `forty_thousand_copies_of_four_levels_take_one_copy_each` reads the main view, and `forty_thousand_casters_of_four_cascades_take_one_copy_each` reads the casters' layout with four cascades. The four cascades draw one copy list, so the list takes one copy for each of the 40,000 trees, and neither the levels nor the cascade count multiply it. The middle column is arithmetic at 64 bytes a copy. The main view would have eight slices, one for each of four levels and its fading band: 20.5 MB. The casters' list would have four, because its shadow pipelines take no fading build, and its fade buckets exist only in the scene layout: 10.2 MB.

A band adds about a tenth more, for the sources inside it, which take a copy in each of two fade buckets.

The culling shader cannot size these slices itself. A draw reads its bucket's copies from a vertex buffer offset that the frame records on the CPU. An indirect draw keeps its first instance at 0 (hard rule 8). A count on the GPU would need a readback, or a second pass that costs every frame. The CPU count runs only for the sources of a mesh with levels. A list of chosen patches per view has the same sizing problem (M3-L3). Its count can read this one.

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

### Trees with leaf cards

Creek's trees come from glTF files whose leaves are cards: quads with an alpha-masked leaf texture. The level planner ([D-91](D-91-level-planning.md)) locks each list's border, so the lists of a mesh still meet. Every vertex of a card lies on the card's border, so no card can lose a triangle. A test tree with a trunk of 384 triangles and 600 cards of 2 triangles each, 1,584 triangles in all, shows it. The trunk halves to 192 triangles, but the step keeps 1,392 of 1,584, more than three quarters, and the planner stops before the first level. Without the lock, meshopt's simplifier folds each card into one triangle. That cuts away half of each card's leaf texture.

So the asset tool thins card lists in a step of its own, and a tree that leaves Blender without levels still gets them.

- The tool calls a part a card list when every separate piece of it, after welding, is a quad of four vertices and two triangles, or a card folded along its middle of six vertices and four triangles, as Creek makes its leaves. A flat-shaded surface splits into pieces of three vertices, so it never matches, and it keeps the simplifier's path.
- Each level keeps every second card of the level above, in an order along a space-filling curve of the cards' middles, so a level thins the crown evenly, not one side first.
- Each kept card grows about its middle by the square root of two for that step, so the cards keep the surface that the dropped ones covered. The file stores the level's own positions, because the growth moves vertices. This is the one level kind that copies vertices.
- The level's error is the size of the largest card that it drops. Creek's cards are 0.8 m wide. On a 1,080-pixel screen, a level switches at about a kilometer. That is conservative: it thins a crown only long after the geometry detail has gone. A hand-authored level, as Creek's Blender script makes, switches nearer. The tool's rule stays geometric and predictable. An author who wants earlier thinning gives the level its own error.
- The card step runs only for a mesh that a skin does not pose, because a posed list's positions are in the scene's units and the level's stored positions are in the mesh's.

The picture `asset-card-level` shows this step. The tool builds a tree of 40 cards of 0.3 m and a trunk. The picture loads the tool's file and draws its first lower level. That level keeps 20 cards and grows each about its middle by the square root of two. A card's size is the level's error, so the switch lies far out. The picture sets the threshold to 16 pixels, the most that the setting takes, and gives the tree a bias of 4. At a 640 by 360 picture and a 40-degree lens, the rule's factor is 30.9. The level's error of 0.424 m then switches it 13 m out. The bias divides that to 3.3 m, and the camera's nearest point lies at 3.8 m. The crown spans about 100 of the picture's 640 pixels. The fixture has a second card level, which keeps 10 cards at an error of 0.636 m. With the bias of 4 it switches at 4.9 m, past the camera, so the picture draws the first one.

Without the step the tool plans no level for the crown at all. Every edge of a card is an open border, which the simplifier keeps, so the crown's triangles never fall. The picture would then draw all 40 cards at their own size, and 0.9 percent of its pixels differ from the reference, against the picture tests' limit of 0.1 percent. The unit tests hold the step's own rules: `keeps a share of the cards at each level, grown about their middles`, `writes each card level its own positions, and shares the wood stream`, and `treats a card folded along its middle as a card, as Creek makes its leaves`.

An author can also make the levels in Blender and export them with `MSFT_lod`, which the loader reads. The forest demo's procedural pines make their levels in code.

### Texture coordinates in the level error

The simplifier weighs normals and vertex colors in its error. Without texture coordinates there, a texture could slide between two vertices of a level with no error shown. So the planner adds each texture coordinate set to the attributes that the simplifier keeps, with a weight of a sixty-fourth of the mesh's longest side. A texture coordinate's unit covers the texture across the mesh. A slide of a large share of a texture therefore counts like a small distance, while a slide of a few texels stays under the geometry's own error. Texture seams still lock, and welding still keeps two copies of a vertex apart where their coordinates differ.

The weight is modest on purpose. The error that the simplifier reports includes the attributes, and the engine reads a level's error as a distance. A heavy weight would make every textured mesh switch levels much farther out. At a sixty-fourth, the test scene's ball keeps four levels, where the same scene without texture coordinates in the error has six.

The picture `asset-bent-grid` shows this weight. The tool builds a flat grid of one meter across and 32 by 32 cells, whose texture repeats twice across it, and the picture looks at it from about a meter. It sets the threshold to 16 pixels, the most that the setting takes. At a 640 by 360 picture and a 60-degree lens, the rule's factor is 19.5. The four lower levels report errors of 0.0055 m, 0.011 m, 0.070 m and 0.25 m, which switch them 0.11 m, 0.22 m, 1.4 m and 4.8 m out. The camera's nearest point lies at 0.87 m, so the second lower level draws, and its texture moves under a pixel. Without the weight the four errors fall to 0.00001 m through 0.00017 m, and the coarsest level switches at 3 mm. It draws against the camera, and its texture scrambles: 10.0 percent of the pixels differ, against the picture tests' limit of 0.1 percent. So `asset-bent-grid` is the weight's proof, and it passes on all three tiers and in Firefox and Safari (run 40248658928). On that picture the owner ruled the weight question moot: no exemption remains.

The unit test's own bent grid measures the weight. It is a flat grid of one meter across, 32 by 32 cells, whose texture coordinates repeat the texture eight times across it. With the shipped weight, one sixty-fourth of the longest side, its coarsest level reports an error of 0.116 units. The same grid with one texture coordinate everywhere reports 0.00016, so the reported error is the weight's. A slide of the whole texture over a one-meter mesh counts as one sixty-fourth of a unit, a small fraction of the mesh's size. The unit test reads the error itself, which is the quantity the weight adds: `counts a texture that would slide, where a flat surface otherwise simplifies free` holds the bent grid's coarsest error above 0.11 units.

### The level image tests

The level image tests place their spheres by their nearest points. Each copy stands along its own ray at the exact distance the rule measures. A copy placed at a depth and then moved off the camera's axis would lie 2 to 4 percent farther than that depth, so nearer its next switch than the test means. The five percent either side of a switch hides that where the levels switch at once. A bias of 2 does not hide it: it halves the switch and the copies' distance, while the sideways offset keeps its size. The nearest copy, at 95 percent of its switch, would then cross that switch and draw level one.

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

Live simplification of meshes while the program runs is not planned: it costs CPU time and uploads every frame, and cluster levels give its result.
