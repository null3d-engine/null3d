# D-213: Cluster levels in the asset tool and their file

Status: decided. Date: 22 October 2026. Task: M3-L3.

Summary: A large static mesh becomes a tree of patches of about 128 triangles, which the asset tool builds and stores in `NULL3D_clusters`. The tool builds the tree in its own code with meshoptimizer's simplifier, not with `clusterlod.h` compiled to WebAssembly, because the tool runs in Node and has no C toolchain. Every patch's indices name the mesh's own vertices. A sphere of 32,768 triangles builds a tree of just over 500 patches that holds about 1.5 times its triangles.

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

How the data was produced: `bun test packages/cli/src/assets/clusters.test.ts` on 22 October 2026, with the build's own records read back as the engine reads them.

## Decision

1. The tool's own code builds the tree, in `packages/cli/src/assets/clusters.js`. It cuts each mesh part into compact leaves across the longest axis of their centroids, joins pairs of patches upward, and simplifies each group toward half its triangles with meshoptimizer's `simplifyWithAttributes`, with the group's border locked. This is the shape that `clusterlod.h` builds, in the tool's own language, so the tool needs no C toolchain and the same input gives the same bytes on every machine. `clusterlod.h`'s partition step is replaced by the centroid split.
2. A patch's error is the largest of its children's errors plus the error of its own simplification, and at least 1.5 times the largest. Errors therefore rise strictly along every chain, which the draw rule needs. A step above the root that cannot lose a triangle ends the chain, so a patch never repeats its child's triangles.
3. The tree is stored in `NULL3D_clusters` on the primitive, in three accessors: the indices of every patch one after another, four floats of each patch's sphere, and four integers of each patch's run, its parent and its error. The extension is not required, so other loaders draw the whole mesh.
4. A mesh gets a tree when it has 20,000 triangles or more, no skin and no morph targets, a material that neither blends nor masks, and at most four copies. A mesh that bends has no fixed patch bounds, and many copies pay about twice their indices for no saving, so those meshes keep whole levels.
5. The engine stores the tree against the mesh's id, checks it against the mesh's vertices, and draws the whole mesh until the WebGPU path draws patches. The drawing method's cost is recorded in an addendum to this record when that path lands.

## Consequences

- `--clusters` adds about twice a mesh's indices to its file, so a page that does not draw patches pays that size.
- Whole levels stay in the file as well, so WebGL2 and other viewers keep their fallback. The plan's cut of the same tree into whole levels comes with the WebGPU path, which replaces the separate simplification pass for these meshes.
- The build needs no `partitionClusters`, so the tool keeps the meshoptimizer version that the engine pins.

## Addendum: the drawing method on WebGPU (23 October 2026, M3-L3)

The plan offered two ways to draw a tree's patches: a compute pass that copies the chosen patches'
indices into a view's own list and draws them with one indirect draw, or a vertex shader that reads
the patches as it draws them, as nanite-webgpu does. The first is built. The second is rejected for
now: it needs a new build of every material's shader, so a page's shader text grows for a feature
that most scenes never use, and the downloading and compiling of those builds lands at the start.

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
and the copy's matrix, so a mesh that draws several copies keeps its whole triangle list for now.
The level rule reads the view's factor as whole levels do, but not a per-object bias.

### What it costs

| Measure | Value |
| --- | --- |
| The test model | A heightfield of 32,768 triangles, a tree of 511 patches and 202,032 indices |
| Per-patch buffers | 4 bytes a patch for the runs and 4 for the offsets |
| The view's list | 4 bytes an index, sized for every patch in the tree rather than the chosen ones: 808,128 bytes for the test model |
| The scene's tables | 32 bytes a patch and 4 bytes an index, shared by every view: 824,480 bytes for the test model |
| Per-view buffers, allocated | About 1.16 MiB for the test model, half again the bytes in use |
| GPU time | Not yet measured: see below |

The list is the cost the plan expected, and larger: it holds every patch's indices, so a view never
sizes a buffer again mid-frame, but a 1,000,000-triangle mesh takes about 8 MB for each view. Sizing
it per frame, as M3-L2 sized the copy lists, is the trim it owes.

The GPU time is not measured yet. `tests/image/cluster-cost.spec.ts` times the test model at three
camera distances, on both GPU paths and each quality preset, and prints the figures; it waits for a
quiet Mac and the machine that ran this branch never held one long enough for the run to finish. The
figures go in this table when they are taken.

### What is not built

- The WebGL2 multi-draw path and Firefox's whole-level fallback draw the whole triangle list. The
  tree's cut into whole levels, which the Consequences above promise with this path, is also not
  built; `--lod` still makes a mesh's whole levels separately. [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)
  decides what a WebGL2 page draws and what each route still needs.
- The direct-draw path, which a WebGPU device takes when its start-up probe measures it faster,
  records no cluster pass, so a cluster mesh draws whole there too. The image tests force the
  indirect path with `?direct=off`, and so does the cost page, because the probe's choice moves
  with the machine and with it the picture.
- The shadow maps draw a cluster mesh whole on both paths, as the concept page says.

## Addendum, 23 October 2026: the pass's shader waits for a tree

The cluster pass's shader moved out of the start into the `cluster_levels` file, which loads on
first use (`69646f09a`). The path then built the pass's pipeline with the first recorded frame
of every WebGPU page, whether or not its scene held a tree. A game that plays offline caches the
start's files and the files of the features it names. It names no cluster feature, so the first
frame asked for a file the cache did not hold, and the request failed on every start. The offline
check of the fresh-project test found it.

`GpuDrivenRenderer` now makes the pipeline with the first frame whose layouts hold a tree of cluster
patches. It keeps the pipeline after that. The culling pipeline beside it does not change, and the
direct-draw path builds neither of the two. A scene without a tree downloads no cluster shader. A
scene that gains one builds the pipeline on that frame. The first-use page says so. The test
`crates/null3d-render/tests/cluster_levels.rs` pins both halves: no tree makes no cluster
pipeline, and the frame that gains a tree creates the pipeline and dispatches it. A later frame
creates it no more.
