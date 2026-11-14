# D-234: What WebGL2 draws for a tree of cluster patches

Status: decided and built by M3-L3. Built: the WebGPU path ([D-213](D-213-cluster-levels.md)), the
whole levels that the asset tool writes beside each tree, and the WebGL2 route with `WEBGL_multi_draw`.
Also built: that route's copy of the vertices for a mesh of several parts, the fallback without
multi-draw, and a walk of its own for each shadow view. The figures are in [D-231](D-231-cluster-levels-cost.md). Task: M3-L3.

Summary: A WebGL2 page draws the patches of a tree on the job workers where the device has
`WEBGL_multi_draw`. Each chosen patch is a range of the tree's index list in one multi-draw call.
A mesh of more than 65,535 vertices draws from a copy of its vertices with 32-bit indices, where
the device also has `WEBGL_provoking_vertex`. A browser without these, such as Firefox, draws the
mesh's whole levels through the level system.
The asset tool plans them as `--lod` does and writes them beside the tree. The WebGPU path that
draws objects directly draws those levels too. Each shadow view walks the tree for itself, in its
own texels.

## Question

The plan for M3-L3 gives a WebGL2 device two routes. With `WEBGL_multi_draw` (Chrome and Safari),
the job workers walk the tree for each view and each chosen patch is one range of a multi-draw
call, up to 256 ranges a call, so a frame uploads ranges and no triangles. Without it (Firefox),
the mesh draws whole levels, through the levels of [D-137](D-137-lod-groups.md).

What does a WebGL2 page draw, and how does each route work?

## Rule

A WebGL2 page may draw the whole mesh, but then the tree buys it nothing and a large static mesh
pays the full triangle list on that path. Neither route may wait on a browser feature that
[D-179](D-179-technique-rulings.md) ruling 27 keeps gated: multi-draw *indirect* and 64-bit
atomics. Plain `WEBGL_multi_draw` is not gated, and the backend already uses it. The routes draw
the same set of patches as the compute pass: the threshold, the source's matrix and the parent
test must agree.

## Data

The asset tool gives each mesh with a tree the whole levels that `--lod` plans
([D-91](D-91-level-planning.md)). Each level has about half the triangles of the level above,
down to about 32 triangles. Each level shares the mesh's
vertices and stores only its indices. An earlier build cut the tree into whole levels instead;
[D-213](D-213-cluster-levels.md#whole-levels-beside-the-tree) gives the figures that rejected it. The tool orders the
vertices coarsest level first, as it does for the levels of a mesh without a tree. The levels go
into the file with `MSFT_lod`, so other viewers draw them, and the engine's loader gives the mesh
its levels.

The route with `WEBGL_multi_draw`:

- After a view's culling, the job workers walk each cluster mesh's tree, for the buckets whose
  source list holds that one object. Each camera view and each shadow view walks with its own
  rule: a cascade or a tile measures the error in its own texels
  ([D-137](D-137-lod-groups.md#shadows)). A patch draws where its own error passes the view's
  threshold at the distance to its own sphere. The error of the patch above it must not pass at
  the distance to that patch's sphere. A parent's sphere holds its children's, so the patches
  that draw cover the mesh once ([D-213](D-213-cluster-levels.md#decision)).
  The walk moves each patch's sphere by the object's matrix and the cell's offset from the
  camera, and reads the view's rule. It is the same rule as the compute pass
  (`cluster_cull.wgsl`). The walk lives in one place, `PatchTree::walk`, which the count of a
  band's picks and the WebGPU path's sizing of each view's list read too. It starts at the root
  and goes down a patch's children only while the patch's own error fails, so it visits the
  patches that draw and those above them, not the whole tree. A sphere outside the view leaves
  out every patch below it.
- A patch is a range of the tree's index list. The chosen ranges sort by their first index, and
  ranges that are neighbours in the list merge into one, so a view records fewer ranges.
- Each range is one record of a multi-draw call, which carries at most 256 records
  (`sizes::MULTI_DRAW_RECORDS`). A tree's draw takes one call for each 256 ranges, and one call
  more when its run also holds another draw. The per-view draw record buffer is sized for every
  patch of every tree, which bounds those calls ([the code review](../code-review.md)'s finding
  R5-01).
- The tree's indices upload once per mesh into an index buffer of its own, as 32-bit indices.
  They then reach every vertex of a mesh of several parts. The draw binds that buffer in place of the
  mesh page's. The tree's index list therefore costs four bytes for each index, beside the mesh's
  own. A buffer and its writes take whole four-byte words, which 32-bit indices always fill. The
  test model's tree of 196,941 indices takes 787,764 bytes. A view's chosen runs take at most
  4,112 bytes, eight for each of its 514 patches. Only a mesh that the layout draws from its tree
  gets the buffer, so a device that draws whole levels uploads no tree.

### The page's index base

WebGL2 packs several meshes into one page of vertex and index data, and rebases each mesh's index
list by the mesh's first vertex in the page (`Packing::Pages`). A path that uploads indices of its
own must apply that base. The three paths answer as follows:

- **This route** uploads the tree's indices, which name the mesh's own vertices. For a mesh in one
  page, the upload adds the mesh's first vertex in its page. A mesh of several parts draws from its
  own copy of its vertices, which starts at the mesh's first vertex, so it adds nothing. Without
  the base, a tree mesh that follows another in a page draws
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

The rebase fix was necessary but not sufficient. The page's base is not the only per-page state
that a tree's indices depend on: a run can hold two trees, and each must bind its own buffer. The
class of fault is per-page state that a new buffer path has to apply, and a path that uploads its
own indices inherits it.

### Meshes of several parts

A page holds at most 65,535 vertices, which its 16-bit indices reach. A mesh of more vertices fills
several pages, so a tree's indices cannot name its vertices through one page. The WebGPU path
draws its patches from one shared buffer ([D-213](D-213-cluster-levels.md#meshes-of-several-parts)).

On WebGL2, such a mesh's tree gets a vertex buffer of its own, a copy of the mesh's parts'
vertices. The copy holds the parts one after another, in the order that the tree's indices name. The tree's 32-bit
indices read that copy, and the draw binds it in place of the page's vertices. The copy uploads
with the tree, and again after the mesh's vertices change. The route needs `WEBGL_provoking_vertex`,
for the reason below. A device without it draws the whole levels that the tool writes beside the
tree.

The test is the desert benchmark of the meshlet comparison, with its ground alone (`props=0`). The
ground has 2,000,000 triangles, 1,002,001 vertices of 12 bytes and a tree of 32,768 patches and
13,154,310 indices. Chrome on the Mac, at Medium, `view=walk`:

| Build | Triangles a frame | Frame interval | GPU process |
| --- | --- | --- | --- |
| Whole levels (`multidraw=off`) | 4,000,007 | 8.3 ms, 120 frames a second | 1,643 MB, 464 MB of it graphics |
| The tree from its copy, last-vertex rule | about 290,000 | 5,300 to 9,000 ms | 102 GB, then a restart |
| The tree from its copy, first-vertex rule | 263,009 to 263,987 | 8.3 ms, 109 to 118 frames a second | 1,735 MB, 535 MB of it graphics |

The tree draws 15 times fewer triangles than whole levels. Other agents' browsers shared the GPU
during these runs, so the record keeps no GPU time, and the frame rates vary. The copy costs
12.0 MB, the mesh's vertex bytes a second time, and the tree's index list 52.6 MB. The
graphics memory grew by 71 MB, which those two and the draw records account for.
The mesh's own pages and whole levels stay, because the fallbacks draw them. With the last-vertex rule the picture was right, and the walk drew about 2,285 ranges a frame
in calls of up to 256. Each frame's list replayed in under 50 ms, and the engine's threads were
idle.

The cause is ANGLE on Metal, which Chrome on the Mac runs WebGL2 on. Before each draw whose program
has a flat varying, it copies the whole bound index buffer into a new one. The copy turns GLSL's
last provoking vertex into Metal's first. The engine's programs all have flat varyings, from WGSL's
`@interpolate(flat, either)`. A copy of a page's index list is small. The tree's list is 52.6 MB,
and each range drawn from it made a copy of all of it:

- `vmmap` of the GPU process listed 2,085 regions of exactly 50.2 MiB, the size of the tree's index
  buffer. 12 s after the first frame, `footprint` put 101 GB of the process's 102 GB in
  "IOAccelerator (graphics)". Chrome then restarted the GPU process.
- `sample` showed Chrome's GPU thread in `-[_MTLCommandBuffer waitUntilCompleted]` in every sample.
  Metal's submission thread waited in the kernel. A Metal System Trace showed 3 ms of GPU work from
  the page in 8 s, and one command buffer that spent 4,878 ms in the driver.
- Timing each call against the GPU hid the fault: with a wait for the GPU before each tree call,
  a frame took 20 ms. So the per-call timings measured small figures, and only a pipelined frame
  grew the memory.
- A standalone page reproduced it with one flat varying. Ten rounds of 2,000 ranges from a 52.6 MB
  list took 47,782 ms and grew its GPU process to 409 GB. Without the varying they took 191 ms, and
  with a 2.4 MB list 991 ms. The earlier standalone pages had no flat varying.
- Changing the upload path, or drawing each range with its own call instead of a multi-draw call,
  left the copies as they were. The vertex format, the 4K target, the draw index and the copies of
  the draw records into textures were each ruled out the same way.

`WEBGL_provoking_vertex` lets a page pick the first-vertex convention, which Metal draws without a
copy. WGSL's `either` allows any vertex, and the WebGPU path takes the first already. The backend
picks it at start where the extension exists (`useFirstProvokingVertex` in
`packages/engine/src/gpu/webgl2/backend.ts`). With it the standalone page took 193 ms. A browser
without the extension keeps the last-vertex rule and its copies.

The page's probe reports the extension to the engine as `CAPABILITY_FIRST_PROVOKING_VERTEX`, and
the frame builder draws a split mesh's tree only with it. A tree in one page draws its patches
either way. Its index list holds about 3 MB at most, against the ground's 52.6 MB, so each copy
costs far less. No browser with `WEBGL_multi_draw` and without the extension was measured.

Chrome offers the extension. Playwright's WebKit 26.6, a proxy for Safari, offers it and
`WEBGL_multi_draw`. Safari itself is not checked: its remote automation is off on this Mac, and
turning it on opens a window on the owner's screen. Firefox offers neither, so it draws whole
levels.

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
| The test model, 514 patches | 3 blocks a slot, 36,864 bytes a view |
| Each shadow view, a cascade or a tile | The casters' layout's own slot, with the same blocks for each tree that it draws |

The figure is an upper bound: a view chooses fewer ranges than the tree holds, and the blocks
round up. Sizing the buffer per frame, as M3-L2 sizes the copy lists, is the trim that this memory
owes. The plan's example of 3,000 chosen patches takes 12 calls, so a view's records are a small
share of the bound.

The fallback:

- A WebGL2 device without `WEBGL_multi_draw` builds no cluster bucket. Its level buckets stay as
  they are, so the mesh draws the whole level that its distance picks, and each shadow view the
  level that its texels pick. This is the same route that the WebGPU direct path takes.
- The asset tool writes the levels whenever it writes a tree, whatever `--lod` says. They are the
  levels that `--lod` gives a mesh without a tree. A mesh that
  already has levels in its file keeps them.
- A mesh that one scene object does not draw keeps its levels on both paths: a mesh that several
  copies draw, and an instance batch. The tool counts only the copies that the file places. So a
  mesh that page code draws in a batch of thousands still has a tree, and every copy draws the
  whole levels. The GPU pass also needs one copy, so this covers the same meshes on both paths.
- A mesh split over several parts keeps its levels on a WebGL2 device without
  `WEBGL_provoking_vertex` ([Meshes of several parts](#meshes-of-several-parts)).

Each fallback case has a test that fails if the case draws patched instead:

- **More than one copy:** `a_tree_with_two_copies_keeps_its_whole_levels` in `tests/cpu_culled.rs`,
  and `the_gpu_path_keeps_a_trees_levels_when_two_objects_draw_the_mesh` in `tests/levels.rs`.
  Two objects share a bucket, so its count is two and the walk has no single matrix.
- **More than one part, on WebGL2 without `WEBGL_provoking_vertex`:**
  `a_tree_split_into_parts_keeps_its_whole_levels`, which builds a grid past 65,535 vertices and
  asserts that it fills more than one part. With the extension, the same grid draws its patches in
  one call from the tree's copy of its vertices, with 32-bit indices
  (`a_tree_split_into_parts_draws_its_patches_from_a_copy_of_its_vertices`). A tree in one page
  draws its patches with or without the extension, and makes no copy
  (`a_tree_in_one_page_draws_its_patches_with_or_without_the_first_vertex`). The unit test
  `a_split_meshs_tree_draws_from_a_copy_of_its_parts_vertices` checks the copy's bytes, part by
  part. The GPU path draws the grid's patches
  (`the_gpu_path_draws_the_tree_of_a_mesh_that_fills_several_parts`).
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

Firefox is the browser that takes that route, and no run in it has drawn this branch yet. The
frame builder's tests with no multi-draw prove the choice on the engine, but not on the browser. A
run of the `checks` plan in Firefox on this Mac, `bun run test:real-browsers Firefox`, draws the
manifest, the three cluster pictures among it, against the `chrome-real-gpu` references. CI's
Firefox job draws the same manifest. Either settles the browser claim, and the run can be arranged
here while the Mac's Firefox answers.

The casters' layout draws a tree only where the scene's layout draws the same object's tree, whose
buffers the scene's upload makes. `each_shadow_view_draws_the_patches_that_its_own_walk_picks` in
`tests/cpu_culled.rs` checks that the cascades bind the tree's index list and record ranges of
their own, and `a_caster_whose_tree_the_scene_does_not_draw_keeps_its_whole_levels` that no shadow
view draws a tree without multi-draw.

The motion pass walks the same calls as the opaque pass, with the same patch view, so a tree's
calls keep their places in the draw records. A tree that moves draws its chosen runs from the
tree's own index list, as the opaque pass does, and the pass binds that list whenever the call's
tree changes within a run. `a_moving_tree_binds_its_own_index_list_in_the_motion_pass` proves the
binding; without it the pass draws the mesh page's list. The other test,
`a_tree_keeps_the_motion_pass_in_step_with_the_opaque_draw_records`, binds the draw record at the
second call's offset; without the patch view it binds the first, as the probe showed.

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
- The fixture carries whole levels as well. A viewer that draws no patches draws them, but every
  path that draws patches ignores them, so no other picture moves. The `lod` pictures use their own
  meshes. `cluster-no-multi-draw` draws them.

## Decision

Both routes are built. A WebGL2 device with `WEBGL_multi_draw` draws the tree's patches from the
job workers, and one without it draws the mesh's whole levels. A mesh of several parts also needs
`WEBGL_provoking_vertex`, and then draws from a copy of its vertices. The
drawing method of the WebGPU path stays as [D-213](D-213-cluster-levels.md#drawing-on-webgpu)
records. No path is dropped and no route waits on a gated feature.

## Consequences

- A large static mesh on WebGL2 gets the tree's saving where the browser draws many ranges in one
  call. Firefox pays one whole level, which halves at each step away from the camera, and the
  frame does not pause to upload triangles.
- The job workers' walk and the compute pass keep one rule in two places. A change to the
  threshold, the source's matrix or the parent test in one must change the other, or a device
  draws a different set of patches from another's. `tests/cluster_cover.rs` in the render crate
  guards the pair. It applies the shader's rule, line for line, to the pass's table of two real
  trees, and pins the shader's lines. Its picks must match the walk's in every view.
- The tree's index buffer costs four bytes for each index of the tree, and the fallback levels
  grow the file. A mesh of several parts also holds its vertices twice on WebGL2.
- A one-row instance batch draws whole levels on both paths, even though one copy draws it. The
  walk takes one scene object's matrix, and the batch's row carries its own.
- Each cascade and tile walks its own cut through the tree, in its own texels, on both paths, as
  the plan asks ([D-213](D-213-cluster-levels.md#shadow-views)). Each shadow view adds its own
  block of draw records for each tree that it draws.
