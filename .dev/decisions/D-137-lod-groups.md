# D-137: Levels of detail picked by screen error

Status: proposed by the helper of M2-I4 on 11 October 2026, for the owner's review. Date: 2026-10-11. Task: M2-I4.

Summary: `mesh.setLevels` gives a mesh levels of detail: simpler meshes, each with its error in the mesh's units. Every object and every instance batch row that draws such a mesh picks one level per frame, the coarsest whose error covers less than a pixel threshold on the screen. The GPU's culling shader picks it on WebGPU and the job workers pick it on WebGL2, with one stateless rule, so both paths switch at the same distances. Near a switch, the two levels cross-fade with a 4 × 4 dither, from a band of builds that only fading objects use. Shadow views pick with the main camera's position and a larger threshold, so shadows draw a coarser level. The governor's render scale feeds the rule, and a governor step raises the threshold when frames run late.

## Question

Creek needs denser forests and Night town a bigger skyline at the same cost. A far tree of 2,000 triangles covers a few pixels, and its vertex work buys nothing. three.js has the `LOD` object, and the asset tool already writes levels with their errors ([D-91](D-91-level-planning.md)), but the engine draws only the full mesh. How does the engine pick a level for each object and each instance row, on both GPU paths, without a visible pop, and what do the shadows draw?

## Rule

- Levels switch where the screen-error rule says, at the same distances on WebGPU, compatibility mode and WebGL2 (the task's done-when).
- The rule is Godot's: the coarsest level whose error, projected on the screen, is under the threshold of 1 pixel, with the render scale in the screen's height ([D-53](D-53-technique-defaults.md)).
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

With option A, `mesh.setLevels([{ mesh, error }, ...])` gives a mesh its lower levels, as Unity's mesh levels and glTF's `MSFT_lod` attach them to a mesh. Objects and batches keep the base mesh's id, so picking, raycasts, skinning, the software occlusion blockers and the transparent pass read the mesh as before. The glTF loader calls `setLevels` from `MSFT_lod`. Each level keeps its own engine mesh, so it draws from its own index range in the pages, and must have the base mesh's vertex attributes, as it draws with the base mesh's pipelines.

| Option | Verdict |
| --- | --- |
| The object's mesh id names a level set, with a bit of its own | Rejected. Every reader of an object's mesh (raycasts, skinning, morphs, blockers, the sorted pass, mesh destruction) would have to resolve the set first |
| A level set as a mesh of its own, sharing the base mesh's parts | Rejected. Removing a mesh moves the parts of the meshes after it, and a shared part would move under the set |

A level's bucket key names it with a level key, a bit and the base mesh's id with the level's number, so a level's bucket never merges with the bucket of an object that draws the same simple mesh as a mesh of its own.

### Picking the level

Each source keeps one entry in the bucket table, which names the bucket of its base level. Each level has a bucket of its own: one pipeline, mesh and material, as every bucket is. Each level's bucket record holds three new words: the level's error, the bucket of the next coarser level, and its fade bucket. So the culling shader walks from the base level's bucket to the coarsest level whose error passes, with no new buffer and no new table. The WebGL2 builder keeps the same links in its layout, and the job workers walk them per row.

The rule, for a source whose sphere centre lies at distance `d` from the main camera:

```text
level j draws when  error[j] × scale × k < threshold × d,  with k = render height × P[1][1] / 2
```

`scale` is the largest axis scale of the source's world matrix, which both paths compute from the same matrix. The error grows from level to level, so the walk stops at the first level that fails. `d` is the Euclidean distance, so turning the camera never changes a level. An orthographic camera uses `d = 1`, since its pixels do not shrink with distance.

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

The band starts at the switch distance and is 15% of it long. In it, the source draws its new level with a fade amount `t` from 0 to 1 and its old level with `1 - t`. A pixel draws the new level where its dither value is under `t`, and the old level elsewhere.

`discard` turns off hidden-surface removal on tile GPUs (Apple, PowerVR), so the fading builds must not draw the sources that do not fade. Each level's bucket therefore has a fade bucket beside it, whose pipelines are the `LOD_FADE` builds. Only sources inside a band land there. Their builds are a first-use shader set, so a page without fading levels downloads none.

The fade amount reaches the fragment shader as a flat value:

- WebGPU: the culling shader writes it into the free fourth word of the copy's ids. The sign says which side: positive for the new level, negative for the old.
- WebGL2: the index list's entries have no spare bits (23 bits of row, 9 of cell). A fade bucket's entries take two words: the entry, then the fade amount's bits. Its draw record marks the pairs, and the fading builds read both.

### Shadows

Shadow cascades, shadow tiles, mirrors and the outline view already place every source relative to the main camera. So `d` is the main camera's distance in every view, and each shadow view picks with the main camera's `k`, not its own orthographic projection. A shadow view multiplies the threshold by the preset's shadow factor, so its casters draw a coarser level. Shadow views do not fade: they draw the level that the rule picks.

| Option | Verdict |
| --- | --- |
| Shadows pick by the main camera's distance, with a larger threshold | Chosen |
| Shadows pick by the light's view | Rejected. A cascade's orthographic view would pick by the cascade's texel size, and a caster could shadow its own surface with a level far from the one the camera sees |
| Shadows always draw the base level | Rejected. The shadow passes would keep the full vertex cost of a dense forest |

Far cascades and shadow tiles keep their drawn depth between redraws. A level change then shows in them at their next redraw, which is within the far cascades' interval, or when the tile's light or a caster moves.

### The governor

The render scale is part of the render height, so a lower scale picks coarser levels with no new step. A new governor step, after the render scale's steps, doubles the threshold, up to four times the preset's. It runs only while the scene draws a level set.

## Costs

To be measured. The rows below give the plan.

| Item | Cost |
| --- | --- |
| Scene without levels | One more word read and compared per source in the culling shader; none on the job workers, which skip the level walk while no layout has levels |
| Bucket records | 13 words in place of 10, per bucket |
| WebGPU slices | Each level's bucket and fade bucket holds a slice for every source of the set, in each view: 64 bytes per source per level per view |
| WebGL2 | Two words per fading entry; levels cost nothing while their buckets are empty, as empty draws are skipped |
| Shader downloads | The `lod_fade` set, on first use |
| JavaScript and WebAssembly | To be measured by the size check |

## Data

To be measured: a dense forest of instanced trees and a skyline of objects, on the Mac's GPU, with levels on and off, on each path. GPU time per frame, CPU time per thread, triangles drawn.

## Decision

Pending the data.

## Consequences

- Skinned and morphed objects draw their base level: their vertices come from regions of their own, which levels do not have yet.
- Blended and transmissive sources draw their base level: the transparent pass sorts them on the job workers with buckets of its own.
- Custom materials, and masks that test their alpha by coverage or by the hash, switch levels at once: their builds have no fading level.
- A static batch with levels is not culled in groups of 64 rows on WebGL2, so each row can pick its own level.
- Levels are separate engine meshes, so the levels from a glTF file that share the base mesh's vertices take a copy of them each.
- The three.js mapping's `LOD (addLevel)` entry maps to `mesh.setLevels`, with distances converted at a 50 degree field of view on a screen 1,080 pixels high.

## Follow-ups

1. Levels for skinned objects, first. Battle's armies are skinned, so they gain nothing yet. The WebGPU skinning pass skins each object's vertices into a region of its own. Each level would need a region, and the skinning pass would skin only the level that the object draws. A skinned object's level can be picked on the CPU before the skinning pass, as skinned objects are few. Expected gain, an estimate to measure: S5's Knight has 4,957 vertices, and its first level switches in at 12.8 m (D-91), each level halving the one above. An army seen from 30 to 60 m away would draw levels 2 and 3, a quarter to an eighth of the vertices. Skinning and vertex shading would then cost about a third of today's, so the skinning pass and the shadow passes, which grow with the vertices, would take roughly half their GPU time or less.
2. Levels for blended and transmissive sources, in the transparent pass's own buckets.
3. Fading builds for custom materials, which double their builds, and for alpha to coverage and the alpha hash.
4. Levels as index ranges of the base mesh's vertices, so a file's levels take no copy of them.
