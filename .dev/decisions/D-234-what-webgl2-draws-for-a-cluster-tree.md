# D-234: What WebGL2 draws for a tree of cluster patches

Status: decided and built by M3-L3. Built: the WebGPU path ([D-213](D-213-cluster-levels.md)), the
tree's cut into whole levels, the WebGL2 route with `WEBGL_multi_draw`, and the fallback without
it. The figures are in [D-231](D-231-cluster-levels-cost.md). Task: M3-L3.

Summary: A WebGL2 page draws the patches of a tree on the job workers where the device has
`WEBGL_multi_draw`. Each chosen patch is a range of the tree's index list in one multi-draw call.
A browser without it, such as Firefox, draws the whole levels that the asset tool cuts from the
tree, through the level system. The WebGPU path that draws objects directly, and the shadow maps,
draw those levels too.

## Question

The plan for M3-L3 gives a WebGL2 device two routes. With `WEBGL_multi_draw` (Chrome and Safari),
the job workers walk the tree for each view and each chosen patch is one range of a multi-draw
call, up to 256 ranges a call, so a frame uploads ranges and no triangles. Without it (Firefox),
the mesh draws whole levels cut from its tree, through the levels of [D-137](D-137-lod-groups.md).

What does a WebGL2 page draw, and how does each route work?

## Rule

A WebGL2 page may draw the whole mesh, but then the tree buys it nothing and a large static mesh
pays the full triangle list on that path. Neither route may wait on a browser feature that
[D-179](D-179-technique-rulings.md) ruling 27 keeps gated: multi-draw *indirect* and 64-bit
atomics. Plain `WEBGL_multi_draw` is not gated, and the backend already uses it. The routes draw
the same set of patches as the compute pass: the threshold, the source's matrix and the parent
test must agree.

## Data

The asset tool cuts each tree into whole levels. Each cut keeps every patch whose own error is
under the cut's error and whose parent's is not, so a cut covers the mesh once. The cuts take the
errors where the cut holds at most three quarters of the triangles of the cut before it, up to six
cuts. Each level shares the mesh's vertices and stores only its indices. The tool orders the
vertices coarsest level first, as it does for the levels of a mesh without a tree. The levels go
into the file with `MSFT_lod`, so other viewers draw them, and the engine's loader gives the mesh
its levels.

The route with `WEBGL_multi_draw`:

- After a view's culling, the job workers walk each cluster mesh's tree, for the buckets whose
  source list holds that one object. A patch draws where the patch's own error passes the view's
  threshold and the error of the patch above it does not, at the distance to the patch's own
  sphere. The walk moves each patch's sphere by the object's matrix and the cell's offset from the
  camera, and reads the view's rule. It is the same rule as the compute pass
  (`cluster_cull.wgsl`).
- A patch is a range of the tree's index list. The chosen ranges sort by their first index, and
  ranges that are neighbours in the list merge into one, so a view records fewer ranges.
- Each range is one record of a multi-draw call, which carries at most 256 records
  (`sizes::MULTI_DRAW_RECORDS`). A tree's draw takes one call for each 256 ranges, and one call
  more when its run also holds another draw. The per-view draw record buffer is sized for every
  patch of every tree, which bounds those calls ([the code review](../code-review.md)'s finding
  R5-01).
- The tree's indices upload once per mesh into an index buffer of its own, as 16-bit indices,
  because a mesh that draws a tree fills one part of at most 65,535 vertices. The draw binds that
  buffer in place of the mesh page's. The tree's index list therefore costs two bytes for each
  index, beside the mesh's own. For the test model, the tree's 202,032 indices take 404,064 bytes,
  and a view's chosen runs take at most 4,088 bytes, eight for each of its 511 patches.

### The page's index base

WebGL2 packs several meshes into one page of vertex and index data, and rebases each mesh's index
list by the mesh's first vertex in the page (`Packing::Pages`). A path that uploads indices of its
own must apply that base. The three paths answer as follows:

- **This route** uploads the tree's indices, which name the mesh's own vertices, so the upload adds
  the mesh's first vertex in its page. Without it, a tree mesh that follows another in a page draws
  the other mesh's vertices. The test model is the first mesh in its page, so no picture can see
  the fault. The unit test `a_trees_indices_add_the_meshs_first_vertex_in_its_page` fails when the
  base is left out.
- A run of draws can hold two trees, which share a page, a pipeline and a material. Each call binds
  its own tree's index buffer, not only a change between a tree and a whole mesh. The test
  `two_trees_in_one_run_bind_their_own_index_buffers` fails when the binding follows the kind of
  draw instead of the tree.
- **The whole-level fallback** draws meshes that `MeshStorage::add_level` made. That method applies
  the base itself, shifting a level's indices by the base part's first vertex on WebGL2 and leaving
  them alone for shared buffers, whose draw adds the base vertex. The fallback therefore needs no
  work of its own.
- **The WebGPU indirect route** reads its tree from the mesh's own indices, with no page base, and
  its indirect draw carries the mesh's `base_vertex` in the shared vertex buffer. The tree's
  indices and that base vertex are what the pass writes.

The class of fault is a per-page index base that each new buffer path has to apply. A path that
uploads its own indices inherits it.

### The draw-record buffer's memory

A multi-draw record is 16 bytes, and a call binds a block of 256 records, so a block takes 4,096
bytes for up to 256 chosen ranges. The buffer is sized for every patch of every tree, which answers
[the code review](../code-review.md)'s finding R5-01 at a cost that a scene of many trees
multiplies:

| Measure | Value |
| --- | --- |
| One patch's record | 16 bytes |
| A full block of 256 ranges | 4,096 bytes |
| A tree of `p` patches | `ceil(p / 256) + 1` blocks a frame slot, because a tree's run may also hold another draw |
| The buffer's slots | 3, one for each frame the GPU may draw |
| A million-triangle tree, about 16,000 patches | 64 blocks a slot, 262,144 bytes, and 786,432 bytes (0.75 MiB) a view |
| Ten such trees | 7.9 MB a view |
| A hundred such trees | 78.6 MB a view |
| The test model, 511 patches | 3 blocks a slot, 36,864 bytes a view |

The figure is an upper bound: a view chooses fewer ranges than the tree holds, and the blocks
round up. Sizing the buffer per frame, as M3-L2 sizes the copy lists, is the trim that this memory
owes. The plan's example of 3,000 chosen patches takes 12 calls, so a view's records are a small
share of the bound.

The fallback:

- A WebGL2 device without `WEBGL_multi_draw` builds no cluster bucket. Its level buckets stay as
  they are, so the mesh draws the whole level that its distance picks. This is the same route that
  the WebGPU direct path and the shadow maps take.
- The asset tool writes the levels whenever it writes a tree, whatever `--lod` says. A mesh that
  already has levels in its file keeps them.
- A mesh that one scene object does not draw keeps its levels on both paths: a mesh that several
  copies draw, a mesh split over several parts, and an instance batch. The GPU pass also needs one
  copy and one part, so this covers the same meshes on both paths.

Each fallback case has a test that fails if the case draws patched instead:

- **More than one copy:** `a_tree_with_two_copies_keeps_its_whole_levels` in `tests/cpu_culled.rs`,
  and `the_gpu_path_keeps_a_trees_levels_when_two_objects_draw_the_mesh` in `tests/levels.rs`.
  Two objects share a bucket, so its count is two and the walk has no single matrix.
- **More than one part:** `a_tree_split_into_parts_keeps_its_whole_levels` on WebGL2 and
  `the_gpu_path_keeps_a_trees_levels_when_its_mesh_fills_several_parts` on the GPU, each of which
  builds a grid past 65,535 vertices and asserts that it fills more than one part.
- **An instance batch:** `a_one_row_batch_keeps_its_whole_levels`, which draws the tree's mesh as
  one batch row. The row carries its own matrix, and the walk takes a scene object's. The GPU
  path's scan also reads scene object keys alone, which the same test's WebGL2 layout exercises.
- **The direct WebGPU path:** `the_direct_path_draws_a_trees_whole_levels_rather_than_its_patches`
  in `tests/levels.rs`, which forces `direct_draws`, draws the tree's mesh as one object, and
  asserts that a far object draws its lower level and that no cluster pipeline is made. One object
  matters: the world's own ball mesh is drawn twice, and the two-copy rule would keep its levels
  with no direct-path guard at all.
- **No `WEBGL_multi_draw`:** `a_tree_draws_whole_where_the_device_draws_one_range_a_call`, and
  the level test `a_tree_draws_no_whole_level_where_the_device_draws_many_ranges`, which shows the
  level buckets return without multi-draw.

The shadow maps are not a separate test: they draw the casters' layout, which never takes a tree,
so the same `drawn` check that the direct path exercises keeps their levels.

The motion pass walks the same calls as the opaque pass, with the same patch view, so a tree's
calls keep their places in the draw records. Its own draws are skipped after their calls are
numbered. The test `a_tree_keeps_the_motion_pass_in_step_with_the_opaque_draw_records` binds the
draw record at the second call's offset; without the patch view it binds the first, as the probe
showed.

### Pictures

The expectation for the WebGL2 draw was that only the cluster model's pictures could move, because
`tests/pages/assets/models/cluster-terrain.glb` is the only committed file that holds a tree. A
search of the tests, examples, samples and benchmarks finds no other. The three pictures that load
it are `cluster`, `cluster-far` and `cluster-coarse`. The first-use case loads it too, but keeps no
picture. The file is a fixture that the tool rebuilds, and `clusters.test.ts` compares it byte for
byte, so its new levels are part of this change.

- `cluster` and `cluster-far` change from the whole triangle list to the tree's patches on WebGL2.
  At the 1 pixel threshold the patches change the picture by less than one pixel, so the
  expectation was that they stay within the test's tolerance. They did.
- `cluster-coarse` at 16 pixels changes strongly: the expectation was a picture well outside
  `cluster`'s, and the WebGL2 drawing shows much coarser triangles. It has its own reference in
  each set. The Mac set is accepted here; the Linux SwiftShader set comes from a CI run.
- The fixture now carries whole levels as well. A viewer that draws no patches draws them, but
  every path that draws patches ignores them, so no other picture moves. The `lod` pictures use
  their own meshes.

## Decision

Both routes are built. A WebGL2 device with `WEBGL_multi_draw` draws the tree's patches from the
job workers, and one without it draws the whole levels that the tool cuts from the tree. The
drawing method of the WebGPU path stays as [D-213](D-213-cluster-levels.md#drawing-on-webgpu)
records. No path is dropped and no route waits on a gated feature.

## Consequences

- A large static mesh on WebGL2 gets the tree's saving where the browser draws many ranges in one
  call. Firefox pays one whole level, which is still less than the base mesh, and the frame does
  not pause to upload triangles.
- The job workers' walk and the compute pass keep one rule in two places. A change to the
  threshold, the source's matrix or the parent test in one must change the other, or a device
  draws a different set of patches from another's.
- The tree's index buffer costs about two bytes for each index of the tree, and the fallback levels
  grow the file.
- A one-row instance batch draws whole levels on both paths, even though one copy draws it. The
  walk takes one scene object's matrix, and the batch's row carries its own.
- The plan asks for a shadow cut per cascade or tile view, with `lodShadowFactor` on the
  threshold. The shadow maps draw the whole levels instead, on both paths, as
  [D-213](D-213-cluster-levels.md) records. That is a deviation from the plan, and the owner
  should accept it or ask for the cut.
