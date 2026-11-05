# D-324: Slots, one copy's level culled group by group

Status: decided and built on WebGPU's indirect path, for the camera's own view, where the view culls in one phase. The groups of a piece are opted into, a model at a time: the asset tool takes `--groups` and the engine takes `buildLevels({ groups: true })`, and both default off, so a model without the opt-in writes pieces alone and plans no groups ([D-307](D-307-mesh-pieces.md)). A layout takes slots only when the copies that would hold them carry about 2.4 million triangles together, which is what buys the pass's fixed cost back; a scene below that takes no slot buckets at all and draws as it did without them. Group-level occlusion, slots for shadow casters, and a check that adapts the slots as a camera moves are not built.

Summary: A mesh's pieces of a large list split into groups of 64 to 128 triangles. The few copies that carry the most triangles of a level draw its groups through slots: up to four a level, 128 a scene, finest level first. A slot culls its level's groups for its one copy and packs their indices into the view's own list, so one indirect draw draws it. The picture matches the pieces' picture in every view tested. The pass costs about 0.3 ms a frame on this Mac, so a layout takes slots only where the copies would carry about 2.4 million triangles; a scene with less draws as it did without slots.

## Question

Pieces cull a level at about 4,096 triangles a piece ([D-307](D-307-mesh-pieces.md)). A copy near the camera, which carries most of a scene's triangles, still draws every triangle of each piece that shows. A group of 64 to 128 triangles lies inside one piece. How does null3D cull at that grain without vertex pulling, within the hard rules, and with few extra draws?

## Rule

- The picture equals the pieces' picture, on every GPU path. The group's bounds lie inside its piece's, so a group never shows where its piece does not.
- Per-instance data stays in vertex buffers, and first instance stays 0 (hard rules 7 and 8).
- The pass fits the culling shell's limits: one uniform and eight storage buffers (hard rule 6), at most 128 threads a workgroup, and only the WGSL features that every browser reports (rule 10).
- No frame allocates, and no frame walks every copy (hard rule 1, [D-137](D-137-lod-groups.md#copy-lists-that-follow-what-draws)).
- The material shaders do not change, so a slot draws with its level's pipeline and material as they are.

## The groups

Groups are opt-in because they cost their planning time and their bytes, and only a model whose copies carry much of a level draws them back. The asset tool's `--groups` asks for them, and the engine's `buildLevels({ groups: true })` asks for a mesh made in code; both default off, so a page that asks for neither never downloads the clusterizer and a file without them holds pieces alone. The planner splits each piece of a large list into groups of at most 128 triangles that lie close together, as meshoptimizer's clusterizer makes them ([`levels/pieces.js`](../../packages/engine/levels/pieces.js)). Each group takes a sphere and a cone of its own, made as a piece's. A group never crosses from one piece into the next, and the groups of each piece hold its triangles in the list's order. The asset tool writes them as `NULL3D_pieces` version 2, with a byte a group of triangles and two vectors of four floats a group of bounds. A file of version 1 draws its pieces without groups. A mesh made in code plans its groups on the job workers with its pieces.

## The slots

A slot is one copy's level. Each level whose pieces carry groups takes up to four slots, as many as 128 slots a scene, the finest levels first. A slot copies its level's pipeline, its material, its group and its pick build. It draws after the level's pieces and goes idle with the level.

The CPU gives a slot its copy without walking the copies a second time. The count that sizes the levels' slices already picks every source's level ([D-137](D-137-lod-groups.md#copy-lists-that-follow-what-draws)). It keeps the four nearest copies of each slot level in extra words of each thread's tally, and the tallies merge. A copy at a switch between levels, and one inside a fading band, offers nothing: the GPU may pick a level other than the one the CPU picked. If that happens, the copy draws through its pieces as before, so the picture stays right.

The culling shader sends a copy to its slot before it queues the copy for the pieces. A pieced level's record names its first slot and its count in the word of its first joint, which a pieced bucket never reads. A slot's record holds its copy's source plus one in the word that otherwise names its next level. The shader matches the copy against those words, appends it to the slot, and returns. A copy that goes to a slot draws through neither the pieces nor the piece check's tally.

## The pass

The slot pass is a second build of the cluster levels' shader, `GROUPS`, and it binds the cluster pass's group exactly: one uniform with a dynamic offset and eight storage buffers. Binding 1 holds the slots' records, then their groups', their pieces' and their parts'. Binding 2 reads one page's 16-bit indices in place, which makes that page's index buffer a storage buffer too. The rest are the view's compacted instances and indirect draws, the runs, the offsets, the view's list and the slots' draws.

Three dispatches fill the list:

- The count tests each of a slot's groups, with every thread of a workgroup taking one. It tests the group's piece first, with the frustum and the cone, and the group itself after it.
- The scan, one workgroup a slot, adds the runs up into the groups' places in the slot's room and writes the slot's indirect draw.
- The copy, a workgroup a run of groups, writes the kept indices with their part's base vertex already added.

The list holds 32-bit indices, so a level split into parts draws with one draw and a base vertex of 0. A slot's room in the list is fixed for the frame: the CPU sizes it from the triangles of the pieces that show for that copy, with an eighth and three groups to spare. A run past the room is dropped rather than written past it, and the picture would show it, so the picture test guards the bound.

The pass draws for the camera's own view alone, where the view culls in one phase. A two-phase view draws its second set of copies after a depth pass, and a slot would draw a copy that the first phase had not placed. The levels debug view reads each copy's level code, which a slot's copy does not carry. The direct-draw path culls on the CPU and runs no pass. Slots draw from one mesh page only, where that page's index bytes fit the 128 MiB storage binding.

## Data

### The picture

`tests/image/mesh-groups.spec.ts` draws the rock field with pieces of version 1 and the same file with groups, in four views, and compares the frames pixel for pixel.

| Path | Differing pixels | Triangles, pieces / groups | Draws |
| --- | --- | --- | --- |
| WebGPU, indirect | 0 0 0 0 | 195,542 / 179,090 | 39 / 47 |
| WebGPU, compatibility mode | 0 0 0 0 | 195,541 / 179,089 | 38 / 46 |
| WebGPU, direct draws | 0 0 0 0 | 195,542 / 195,542 | 22 / 22 |
| WebGL2 | 0 0 0 0 | 376,497 / 376,497 | 47 / 47 |

### The frame time

`NULL3D_MESH_GROUPS_COST=1 bun run test:browser -- mesh-groups-cost.spec.ts`, on this Mac in the pinned Chrome, WebGPU's indirect path at Medium, three rounds a side in turn, 2 s of warm-up and 2 s measured a side. The computer's one-minute load was 3.2 to 5.8 at the start of each measurement. `engine.measure` gives the medians. The frame interval read 16.67 ms in every run, because Playwright's browser caps the display at 60 Hz, so only the GPU time and the CPU time separate the sides.

| Scene | Triangles | Draws | GPU ms, pieces / slots | Busiest thread's CPU ms | Load |
| --- | --- | --- | --- | --- | --- |
| 84 copies, 320 by 180 | 195,542 / 179,090 | 22 / 30 | 0.68 / 0.82 | 0.13 / 0.19 | 5.8 |
| 84 copies, 1600 by 900 | 328,256 / 311,804 | 18 / 26 | 1.17 / 1.54 | 0.20 / 0.17 | 5.7 |
| 19 copies, 320 by 180 | 42,900 / 34,421 | 19 / 27 | 0.37 / 0.72 | 0.18 / 0.20 | 4.0 |
| 19 copies, 1600 by 900 | 73,939 / 62,075 | 18 / 26 | 0.91 / 1.21 | 0.19 / 0.25 | 3.2 |

The rounds separate the sides with no overlap. At 84 copies and 320 by 180 pixels the GPU time read 0.68, 0.68 and 0.58 ms without slots, against 1.11, 0.82 and 0.77 with them.

The pass costs about 0.3 ms a frame at each size, and the triangles it cuts are worth about 0.01 to 0.1 ms on this Mac, at 0.2 to 0.3 ms a million triangles. So it does not pay at these sizes here. Its cost barely changes with the scene: eight slots test about 420 groups and copy about 100,000 indices, and the rest is three dispatches, a producer-consumer barrier between the copy and the main pass, and eight more draws in each pass that draws them.

The GPU check of the branch, which draws s4 and s6, found no change against its parent: s4 at Medium 2.85 to 2.86 ms, s6 at Medium 3.72 to 3.67 ms, s4 at High 3.88 to 4.08 ms and s6 at High 4.66 to 4.54 ms. Neither page has a mesh whose pieces carry groups, so those figures measure the pass's absence and the layout's extra buckets, not its work.

### The gate

The pass costs a frame about 0.3 ms whatever the scene, and a cut triangle is worth 0.2 to 0.3 ms a million. A slot draws its whole level where its groups do not cull, so the copies that would hold the layout's slots carry a level's triangles each until the groups cull them. A half cut must therefore reach about 1.2 million triangles, and the copies must carry about 2.4 million.

`Layout::add_slots` adds no slot bucket below that figure. A scene of smaller levels then keeps the buckets, the draws and the culling it had without slots, and the cost page measures the same draws on both sides. The figure is a build choice, because it depends only on the levels' triangles and their slots, not on the camera. A check that follows a camera would need the GPU's kept counts read back.

The cost page's second scene is one rock of about 630,000 triangles with a coarse level and four copies, which carries about 2.5 million. It passes the gate and draws 38% fewer triangles, from 587,032 to 364,763, with 0 differing pixels. At 1600 by 900 its GPU time fell from 1.63 to 1.42 ms, with the rounds 1.59, 1.67 and 1.63 against 1.42, 1.48 and 1.34, and no overlap. At 320 by 180 the run read 0.78 against 1.24 ms at a load of 7.3, whose rounds spread too widely to judge.

## Look

The picture is the pieces' picture, pixel for pixel, in every view that the picture test draws. The groups only order a piece's triangles and cull some of them conservatively, and a slot draws the copy at its level's material and pipeline. No option changes the look.

## Decision

Build the groups and the slot pass as above, for the camera's own view on WebGPU's indirect path, with up to four slots a level and 128 a scene.

Rejected:

- A slot for every copy. A view's list per copy needs a work list that the GPU sizes, and a readback or a second pass to place every copy's groups. The index copy also costs per triangle what the indirect draw does not.
- A tree of cluster patches for each copy, as [D-213](D-213-cluster-levels.md) draws one. The props of a heavy scene need about 128 MB of 32-bit indices, past the 128 MiB binding.
- Vertex pulling of the groups, as three.js does. It breaks hard rule 7, and every material would need a build that reads its vertices from storage.
- Many pieces in place of groups. A level of a million triangles needs thousands of them, and each costs a draw in every pass.
- Groups as the only grain, on every GPU path. WebGL2's job workers cull copies and pieces on the CPU, and copying the groups' indices there costs what the desktop pass costs, on a thread that has little room.
- Slots in a view that culls in two phases, before the group-level occlusion of the next step. A slot's copy is placed by the first phase, so the second phase's slot would draw a copy that a depth pass had not yet hidden or shown.
- Slots for shadow casters. The casters' layouts draw their levels whole, and the shadow triangles cost less than the camera's. The gain stays to be measured.
- A slot's list of 16-bit indices with the view's base vertex. A level that splits into parts needs a base vertex a part, so the list would carry one draw a part. A 32-bit index with the part's base vertex added keeps one draw a slot.
- Reading the indices from several pages in one pass. Binding 2 reads one page's indices, so a second page needs a second bind group and a second run of the pass. One page holds every level of a scene that packs its meshes into shared buffers.

## Consequences

- The engine's shader set gains the `GROUPS` build in the cluster levels' first-use file, so no page that draws no slot downloads it.
- A mesh page's index buffer takes the storage use when a slot draws from it, which changes that buffer's creation and nothing it draws.
- A mesh whose pieces carry groups draws at most four extra buckets a level, each with one draw in each pass that draws it, and the frame gives each a slice of one copy.
- The frame's count keeps the nearest four copies of each slot level in extra tally words. The count visits the same sources as before, so no copy is walked twice.
- The levels' slices, the bundles and the slot tables follow the pick as the level slices do: a change records the bundles again.
- The piece check's tally leaves out a copy that draws through a slot, so its "would draw whole" count reads slightly low for such a mesh.
- A layout takes slots or none when it is built, so a camera that flies close to a heavy mesh does not gain them until the scene's structure changes. The threshold is the constant `SLOT_PAY_TRIANGLES`.
