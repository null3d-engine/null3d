# D-213: Cluster levels in the asset tool and their file

Status: decided and built. Built: the asset tool's tree, its file, the tree's cut into whole
levels, and the paths that draw the tree on WebGPU and on WebGL2. [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)
holds the WebGL2 routes. Task: M3-L3.

Summary: A large static mesh becomes a tree of patches of about 128 triangles, which the asset tool builds and stores in `NULL3D_clusters`. The tool builds the tree in its own code with meshoptimizer's simplifier, not with `clusterlod.h` compiled to WebAssembly, because the tool runs in Node and has no C toolchain. Every patch's indices name the mesh's own vertices. A sphere of 32,768 triangles builds a tree of just over 500 patches that holds about 1.5 times its triangles. The same build cuts the tree into whole levels, which a viewer that draws no patches draws.

## Question

How does the asset tool build a cluster tree, what does the file hold, and which meshes get one?

## Rule

- The tool and the engine agree on every byte from one source, and the tool runs in Node without a C toolchain.
- A patch draws where its own error passes a view's threshold and the error of the patch above it does not, so the patches that draw cover the mesh once at any distance.
- Patches of different detail still meet at their edges, with no gap and no pop.
- Every patch names the mesh's own vertices, so a tree adds no vertex stream.
- Other glTF loaders draw the whole mesh from the same file.

## Data

| Measure | Value |
| --- | --- |
| Seed mesh | A sphere of 32,768 triangles and 16,641 vertices |
| Leaf patches | 256, each of 128 triangles at most |
| Patches in the tree | Just over 500: the leaves, a parent above each pair of them, and a short chain above the root |
| The coarsest patch | About 450 triangles: the chain above the root stops where the simplifier can go no coarser with the seam held |
| Tree triangles against the base mesh's | About 1.5 times, and under 2.6 times |
| Errors | Strictly rising from every patch to its parent, on every chain |
| Vertices added by the tree | 0 |

How the data was produced: `bun test packages/cli/src/assets/clusters.test.ts` at commit `2331d49fa`, with the build's own records read back as the engine reads them.

## Decision

1. The tool's own code builds the tree, in `packages/cli/src/assets/clusters.js`. It cuts each mesh part into compact leaves across the longest axis of their centroids, joins pairs of patches upward, and simplifies each group toward half its triangles with meshoptimizer's `simplifyWithAttributes`, with the group's border locked. This is the shape that `clusterlod.h` builds, in the tool's own language, so the tool needs no C toolchain and the same input gives the same bytes on every machine. The centroid split stands in for `clusterlod.h`'s partition step.
2. A patch's error is the largest of its children's errors plus the error of its own simplification, and at least 1.5 times the largest. Errors therefore rise strictly along every chain, which the draw rule needs. A step above the root that cannot lose a triangle ends the chain, so a patch never repeats its child's triangles.
3. The tree is stored in `NULL3D_clusters` on the primitive, in three accessors: the indices of every patch one after another, four floats of each patch's sphere, and four integers of each patch's run, its parent and its error. The extension is not required, so other loaders draw the whole mesh.
4. A mesh gets a tree when it has 20,000 triangles or more, no skin and no morph targets, a material that neither blends nor masks, and at most four copies. A mesh that bends has no fixed patch bounds, and many copies pay about twice their indices for no saving, so those meshes keep whole levels.
5. The engine stores the tree against the mesh's id. It rewrites the tree's indices into the order of the vertices that the mesh's parts hold, and checks them against those vertices ([Meshes of several parts](#meshes-of-several-parts)). The WebGPU path draws the chosen patches ([Drawing on WebGPU](#drawing-on-webgpu)), and the WebGL2 path draws them on the job workers where the device has `WEBGL_multi_draw`. Every other path draws the whole levels cut from the tree ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)). [D-231](D-231-cluster-levels-cost.md) records what the pass costs.

## Consequences

- `--clusters` adds about twice a mesh's indices to its file, and the whole levels that the tree
  cuts into add their own indices, so a page that draws no patches pays that size.
- Whole levels stay in the file as well, so WebGL2 and other viewers keep their fallback. The build cuts the same tree into whole levels, in place of the separate simplification pass for these meshes. The levels share the mesh's vertices and the tool orders them coarsest level first, as it does for a mesh without a tree.
- The build needs no `partitionClusters`, so the tool keeps the meshoptimizer version that the engine pins.

## Drawing on WebGPU

The plan offers two ways to draw a tree's patches: a compute pass that copies the chosen patches'
indices into a view's own list and draws them with one indirect draw, or a vertex shader that reads
the patches as it draws them, as nanite-webgpu does. The first is built. The second is rejected: it
needs a new build of every material's shader, so a page's shader text grows for a feature that most
scenes never use, and the downloading and compiling of those builds lands at the start.

### How the pass runs

Three dispatches of one compute pipeline, recorded in the view's culling pass, fill the view's list:

1. A thread tests one patch: it moves the patch's sphere by the copy's world matrix, tests it against
   the view's six frustum planes, applies the level rule to the patch's own error and the error of
   the patch above it, and writes the patch's index count, or zero.
2. One workgroup adds the counts up into each patch's offset in the view's list, and writes each
   cluster mesh's indirect draw from where its patches start and end.
3. A workgroup copies each chosen patch's indices into the list.

The view's opaque pass binds that list as its index buffer and draws each cluster mesh with one
`DrawIndexedIndirect` that the scan sized. A view that culls none of a mesh's copies writes a zero
index count, so the mesh draws nothing without a second test. Every material build stays as it is.

The copy it reads is the bucket's own: a mesh draws its patches only where its bucket holds one copy
and the copy's matrix, so a mesh that draws several copies draws its whole triangle list.
The level rule reads the view's factor as whole levels do, but not a per-object bias.

### Meshes of several parts

The pages keep 16-bit indices. WebGL2 reads the index 65,535 as a primitive restart, so a mesh of
more vertices splits into parts of at most 65,535 vertices. Each part copies the vertices that its
triangles use. A tree's indices name the mesh's own vertices, so they can draw only a mesh in one
part. The desert benchmark of the meshlet comparison has a ground of 2,000,000 triangles and
1,002,001 vertices. On WebGPU it drew all 2,000,001 of its triangles in every frame
(`?props=0&direct=off`).

The pass's list and its indirect draw are 32-bit, so they reach any vertex of one vertex buffer.
Two changes let them reach a split mesh:

1. The engine rewrites the tree's indices into the order of the parts' vertices, one part after
   another (`MeshStorage::to_part_order`). It does so when the tree or a band of it arrives. A
   vertex that two parts copy takes its first copy, which holds the same bytes.
2. On shared buffers, a split mesh puts all its parts into one buffer, one after another
   (`MeshStorage::split`). It does so when one buffer can hold them all. A counting pass sizes
   the parts first, so the placement fails before it changes a page. A removal moves the parts
   together, so they stay in one run. The pass's draw then reads that buffer from the first
   part's base vertex (`MeshStorage::joined_parts`).

The layout draws a tree only over parts that lie in one run, so a mesh that one buffer cannot hold
draws whole levels. A shared buffer holds at most the storage binding's bytes, 128 MiB by default.
That is about 4 million vertices of 32 bytes, or 11 million of the ground's 12 bytes. The trees
that the camera's layout draws also share the binding. The scene's index table and each view's
list take 4 bytes an index, so they hold about 33 million indices in all. The copy step runs a
workgroup for each patch in one dispatch. One axis of a dispatch takes at most 65,535 workgroups,
so the trees share at most that many patches. The ground's 32,768 patches take half of them, so a mesh of about
4 million triangles fills the dispatch. The layout takes the trees in scene order. A tree that
does not fit draws whole levels, where it used to fail the frame
(`a_tree_past_the_cluster_binding_draws_whole`, `a_tree_past_one_dispatch_of_patches_draws_whole`).
Spreading the copy over rows, as the skinning pass spreads its workgroups, lifts the patch limit.

The desert benchmark's figures, on the Mac's Chrome with WebGPU at Medium, `view=walk&direct=off`,
a median over 5 s after 3 s of warm-up:

| Page | Triangles a frame, before | After | Draw calls, before | After |
| --- | --- | --- | --- | --- |
| The ground alone (`props=0`) | 2,000,001 | 139,929 | 57 | 2 |
| The whole desert | 13,671,589 | 11,713,827 | 214 | 159 |

The ground alone draws 14 times fewer triangles. Other runs shared the GPU, so the record keeps no
GPU time from these runs. The `props=0` switch is a local copy's, which leaves the props out.

Pictures from `engine.capture()` of the walk and aerial views match the whole mesh's. The one
difference is a few small holes in the middle distance, where a patch is missing. A wrong vertex would draw
stretched triangles instead. The WebGL2 copy reached its vertices another way and showed the
same holes ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md#meshes-of-several-parts)). So
they come from the tree's patch bounds and errors, which this change does not touch.

Rejected: a vertex buffer of the tree's own, a copy of the parts' vertices. The parts already
lie in one shared buffer here, so it would cost the mesh's vertex bytes for nothing. WebGL2's
pages hold too few vertices for one run, so such a copy was built and measured there. The GPU ran
the tree's draws for seconds a frame. So that path keeps whole levels for a mesh of several parts
([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md#meshes-of-several-parts)).

### The pass's shader waits for a tree

The cluster pass's shader lives in the `cluster_levels` file, which loads on first use, not in the
start (`69646f09a`). `GpuDrivenRenderer` makes the pipeline with the first frame whose layouts hold
a tree of cluster patches, and keeps it after that. A pipeline made with the first frame of every
WebGPU page would ask for that file on every start. A game that plays offline caches the start's
files and the files of the features it names. It names no cluster feature, so that request fails on
every start, and the offline check of the fresh-project test catches it.

The culling pipeline beside it does not wait for a tree, and the direct-draw path builds neither of
the two. A scene without a tree downloads no cluster shader. A scene that gains one builds the
pipeline on that frame. The first-use page says so. The test
`crates/null3d-render/tests/cluster_levels.rs` pins both halves: no tree makes no cluster
pipeline, and the frame that gains a tree creates the pipeline and dispatches it. A later frame
does not create it again.

### What it costs

| Measure | Value |
| --- | --- |
| The test model | A heightfield of 32,768 triangles, a tree of 511 patches and 202,032 indices |
| Per-patch buffers | 4 bytes a patch for the runs and 4 for the offsets |
| The view's list | 4 bytes an index, sized for every patch in the tree rather than the chosen ones: 808,128 bytes for the test model |
| The scene's tables | 32 bytes a patch and 4 bytes an index, shared by every view: 824,480 bytes for the test model |
| Per-view buffers, allocated | About 1.16 MiB for the test model, half again the bytes in use |
| The benchmark's ground | 2,000,000 triangles and 1,002,001 vertices in 16 parts or more, a tree of 32,768 patches and 13,154,310 indices |
| The ground's scene tables | 1 MiB of patches and 52.6 MB of indices, 41% of the 128 MiB binding |
| The ground's view list | 52.6 MB for each camera view, and 256 KiB of runs and offsets |
| The ground's vertices | None beyond its parts, which share one buffer |
| GPU time | [D-231](D-231-cluster-levels-cost.md) |

The list is the cost the plan expected, and larger: it holds every patch's indices, so a view never
sizes a buffer again mid-frame, but a 1,000,000-triangle mesh takes about 8 MB for each view, and
the ground's 52.6 MB. Sizing it per frame, as M3-L2 sizes the copy lists, is the trim it owes.

`tests/image/cluster-cost.spec.ts` times the test model at three camera distances, on both GPU
paths and each quality preset, and prints the figures. [D-231](D-231-cluster-levels-cost.md) holds
them.

### What is not drawn from the tree

- The direct-draw path, which a WebGPU device takes when its start-up probe measures it faster,
  records no cluster pass, so a cluster mesh draws its whole levels there. The image tests force
  the indirect path with `?direct=off`, and so does the cost page, because the probe's choice moves
  with the machine and with it the picture.
- The shadow maps draw a cluster mesh's whole levels on both paths, as the concept page says.
  The plan asks for a cut per cascade or tile view, with `lodShadowFactor` on the threshold. That
  cut is not built, so the deviation is for the owner to accept
  ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)).
- A mesh that several copies draw, and a one-row instance batch, draw whole levels on both paths.
  [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md) gives the WebGL2 routes and their
  figures.
- On WebGPU, a mesh whose parts no one shared buffer holds, past 128 MiB of vertices, draws whole
  levels. So does a tree that would take the cluster tables past the storage binding, or the
  scene's patches past one dispatch ([Meshes of several parts](#meshes-of-several-parts)).
- On WebGL2, a mesh of several parts draws whole levels
  ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md#meshes-of-several-parts)).
