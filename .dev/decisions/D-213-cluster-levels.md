# D-213: Cluster levels in the asset tool and their file

Status: decided and built. Built: the asset tool's tree and its file, and the paths that draw
the tree on WebGPU and on WebGL2. Each mesh with a tree also gets the level planner's whole
levels. [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)
holds the WebGL2 routes. Task: M3-L3.

Summary: A large static mesh becomes a tree of patches of about 128 triangles, which the asset tool builds and stores in `NULL3D_clusters`. The tool builds the tree in its own code with meshoptimizer's simplifier, not with `clusterlod.h` compiled to WebAssembly, because the tool runs in Node and has no C toolchain. Every patch's indices name the mesh's own vertices. A sphere of 32,768 triangles builds a tree of just over 500 patches that holds about 1.5 times its triangles. The same build gives each mesh with a tree the whole levels that `--lod` plans. A viewer that draws no patches draws them, and so does every copy that draws whole levels.

## Question

How does the asset tool build a cluster tree, what does the file hold, and which meshes get one?

## Rule

- The tool and the engine agree on every byte from one source, and the tool runs in Node without a C toolchain.
- A patch draws where its own error passes a view's threshold at its own sphere. The error of the patch above it must not pass at that patch's sphere. The patches that draw then cover the mesh once at any distance.
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
| Errors | Never falling from a patch to its parent, on every chain |
| Spheres | Each parent's sphere holds its children's spheres |
| Vertices added by the tree | 0 |

How the data was produced: `bun test packages/cli/src/assets/clusters.test.ts` at commit `2331d49fa`, with the build's own records read back as the engine reads them. The errors and spheres rows follow the [addendum](#addendum-nested-spheres-and-errors-that-do-not-compound).

## Decision

1. The tool's own code builds the tree, in `packages/cli/src/assets/clusters.js`. It cuts each mesh part into compact leaves across the longest axis of their centroids, joins pairs of patches upward, and simplifies each group toward half its triangles with meshoptimizer's `simplifyWithAttributes`, with the group's border locked. This is the shape that `clusterlod.h` builds, in the tool's own language, so the tool needs no C toolchain and the same input gives the same bytes on every machine. The centroid split stands in for `clusterlod.h`'s partition step.
2. A patch's error is the larger of its children's errors and the error of its own simplification. A leaf's sphere holds its triangles, and every other patch's sphere holds its children's spheres. So along every chain the errors never fall and the spheres never shrink, which the draw rule needs. A patch keeps the simplifier's way of least error among those that reach the target or come near it. The whole levels choose the same way. A step above the root that cannot lose a triangle ends the chain, so a patch never repeats its child's triangles.
3. The tree is stored in `NULL3D_clusters` on the primitive, in three accessors. The first holds the indices of every patch one after another. The second holds four floats of each patch's sphere, and the third four integers of each patch's run, its parent and its error. The extension also names its layout's version, 2. The extension is not required, so other loaders draw the whole mesh.
4. A mesh gets a tree when it has 20,000 triangles or more, no skin and no morph targets, a material that neither blends nor masks, and at most four copies. A mesh that bends has no fixed patch bounds, and many copies pay about twice their indices for no saving, so those meshes keep whole levels.
5. The engine stores the tree against the mesh's id and checks it against the mesh's vertices. The WebGPU path draws the chosen patches ([Drawing on WebGPU](#drawing-on-webgpu)), and the WebGL2 path draws them on the job workers where the device has `WEBGL_multi_draw`. Every other path draws the mesh's whole levels ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)). [D-231](D-231-cluster-levels-cost.md) records what the pass costs.
6. Each mesh with a tree gets its whole levels from the level planner of [D-91](D-91-level-planning.md), with or without `--lod`. They are the levels that a mesh without a tree gets. The tree stays as it is. The levels share the mesh's vertices. The tool orders the vertices coarsest level first, then the finer levels, then the base mesh, as for a mesh without a tree. The reorder renames the tree's indices too ([Whole levels beside the tree](#whole-levels-beside-the-tree)).

## Consequences

- `--clusters` adds about twice a mesh's indices to its file. The whole levels add about as many
  indices again as the base mesh holds.
- Whole levels stay in the file as well, so WebGL2 and other viewers keep their fallback. Every
  copy of an instance batch draws them too. The asset tool cannot see a batch that page code
  makes, so a mesh drawn thousands of times can still get a tree. The levels halve at each step
  and go down to a few dozen triangles. So those copies draw few triangles far away.
- The build needs no `partitionClusters`, so the tool keeps the meshoptimizer version that the engine pins.

## Whole levels beside the tree

The paths that draw no patches draw a mesh's whole levels: the WebGPU direct path, WebGL2 without
`WEBGL_multi_draw`, the shadow maps, a mesh that several copies draw, and every instance batch.
The tool counts only the copies that the file places. So a mesh that page code draws in a batch
of thousands still gets a tree, and every copy draws whole levels.

The tool first cut the tree into whole levels. Each level was the set of patches whose own error
passed the level's error and whose parent's did not. That option is rejected. A cut drops only
what one patch saves over its children, about a quarter at each depth. The tree's errors also add
up along each chain (decision 2). So a cut's stored error ran far above its real distance from
the mesh. The desert benchmark's props showed it:

The table gives the first mesh of each kind; the other copies of each kind differ by under 5%.

| Mesh | Base triangles | Cut levels, coarsest | Planner's levels, six | Planner's levels now, coarsest |
| --- | --- | --- | --- | --- |
| Pebble | 20,480 | 3,592, 17.5% of the base | 320 | 32 |
| Boulder | 81,920 | 14,504 | 1,280 | 32 |
| Column | 518,688 | 92,130 | 8,104 | 324 |
| Arch | 1,023,360 | 181,985 | 15,990 | 658 |

| Measure, the first pebble | Cut levels | Planner's levels |
| --- | --- | --- |
| Triangles of each level | 15,360, 11,520, 8,640, 6,480, 4,800, 3,592 | 10,240, 5,120, 2,560, 1,280, 640, 142, 32 |
| Stored errors, in the mesh's integer steps | 51.9, 65.8, 209, 262, 1,600, 2,570 | 42.3, 83.1, 172, 339, 635, 2,190, 4,830 |
| Level indices against the base mesh's | 2.46 times | 0.98 times |

The cut's first level keeps three quarters of the pebble, and stores a larger error than the
planner's level of half the pebble. The cut's coarsest level, 3,592 triangles, stores 2,570 steps.
The planner's levels of 5,120 and 2,560 triangles store 172 and 339. So a cut level switched in
many times farther away than its real error needs. Every far copy drew the cut's 3,592
triangles, where the planner's levels draw 320 and fewer. Each mesh of the props shows the same shape. The
cut levels also took 2.46 times the base mesh's indices in the file, against 0.98 times for the
planner's six levels.

How the data was produced: `bun packages/cli/bin/null3d.js assets optimize props.glb out --lod
--clusters --no-blockers --bvh 0` on the desert benchmark's raw props file. The file holds 16
meshes and 5,076,704 triangles. The cut levels come from commit `f7ffdbff`, and the planner's
levels from this change. Each run was on the owner's Mac with no other run beside it. A script
read each node's `MSFT_lod` levels and `NULL3D_lod_error` from the written file. The middle column is the planner with its earlier cap of
six levels; [D-91](D-91-level-planning.md) gives the deeper chain.

## Drawing on WebGPU

The plan offers two ways to draw a tree's patches: a compute pass that copies the chosen patches'
indices into a view's own list and draws them with one indirect draw, or a vertex shader that reads
the patches as it draws them, as nanite-webgpu does. The first is built. The second is rejected: it
needs a new build of every material's shader, so a page's shader text grows for a feature that most
scenes never use, and the downloading and compiling of those builds lands at the start.

### How the pass runs

Three dispatches of one compute pipeline, recorded in the view's culling pass, fill the view's list:

1. A thread tests one patch: it moves the patch's sphere by the copy's world matrix, tests it against
   the view's six frustum planes, applies the level rule to the patch's own error at its own sphere
   and the error of the patch above it at that patch's sphere, and writes the patch's index count,
   or zero.
2. One workgroup adds the counts up into each patch's offset in the view's list, and writes each
   cluster mesh's indirect draw from where its patches start and end.
3. A workgroup copies each chosen patch's indices into the list.

The view's opaque pass binds that list as its index buffer and draws each cluster mesh with one
`DrawIndexedIndirect` that the scan sized. A view that culls none of a mesh's copies writes a zero
index count, so the mesh draws nothing without a second test. Every material build stays as it is.

The copy it reads is the bucket's own: a mesh draws its patches only where its bucket holds one copy
and the copy's matrix, so a mesh that draws several copies draws its whole triangle list.
The level rule reads the view's factor as whole levels do, but not a per-object bias.

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
| GPU time | [D-231](D-231-cluster-levels-cost.md) |

The list is the cost the plan expected, and larger: it holds every patch's indices, so a view never
sizes a buffer again mid-frame, but a 1,000,000-triangle mesh takes about 8 MB for each view. Sizing
it per frame, as M3-L2 sizes the copy lists, is the trim it owes.

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

## Addendum: nested spheres and errors that do not compound

The owner's session asked for this fix. A simulation of the draw rule on the
benchmark's pebble and boulder trees found holes and parts drawn twice from cameras outside the
mesh.

### The faults

- **Holes and double draws.** Both GPU paths tested the parent's error at the child's own distance,
  and each patch's sphere held its own triangles only. A parent's sphere then need not hold its
  children's. Two children of one parent could disagree on whether the parent passes. One child
  then draws with its parent, a double draw, and its sibling draws neither, a hole.
- **Errors that compound.** A parent's error was its children's plus its own simplification's, and
  at least 1.5 times its children's. Over 12 to 16 depths the root's error reached many times the
  mesh's size, so the coarse patches switched in far too late.
- **A choice of the fewest triangles.** Of the simplifier's ways, each patch kept the one with the
  fewest triangles, whatever its error.
- **The WebGPU table's parent.** The pass's table named each patch's parent by its place in its own
  tree. The shader read it as a place in the scene's table, so every cluster mesh after the first
  tested another mesh's patch as its parent.

### The fix

- A parent's sphere holds its children's spheres, from the leaves up, as 32-bit floats rounded
  outward. A parent's error is the larger of its children's and its own. Both paths test the
  parent's error at the parent's own sphere. A camera is then never nearer a child than its parent,
  so a parent that passes leaves each child below it passing. Each chain from a leaf up holds one
  run of passing patches, and the top of that run is the one patch that draws.
- meshoptimizer's `clusterlod.h` takes the same approach. It tests a group's error at the merged
  group's sphere, and notes that the precise bounds of the simplified mesh may break the order.
- Each patch keeps the way of least error among those that come within half the cut of the target.
  The halving planner of the whole levels chooses the same way.
- The layout writes each parent's place in the scene's table (`PatchTree::table_record`), which the
  shader reads.
- `NULL3D_clusters` names its layout's version, 2. The loader draws an older tree's mesh as whole
  levels, with the warning to optimize the file again. The core also refuses a tree or a band whose
  spheres or errors break the order (`PatchError::Nesting`, code 8).
- The two walks on WebGL2, the job workers' walk and the count of a band's picks, share one walk
  (`PatchTree::walk`).

### Options rejected

- **A parent's sphere in each record**, as `clusterlod.h` stores it. Its groups are not records of
  their own. Here each patch has one parent, and the parent's sphere is one record away. A second
  copy would add 16 bytes to every patch for no gain.
- **A margin on the old test.** No margin makes a parent's own triangles hold its children's, so
  the order still breaks.
- **Errors that add up.** With nested spheres, the larger of the two errors is enough for the order.
  A sum only makes the coarse patches switch in later.

### Data

The data comes from the benchmark's raw meshes, before and after the fix. Each was built with
`bun packages/cli/bin/null3d.js assets optimize <in> <out> --lod --clusters --no-blockers --bvh 0`. The pebble is `pebble-0` of the props file: 20,480 triangles, 2.06 m long.
The ground holds 2,000,000 triangles over 800 m. The trees keep their shape: the pebble has 514
patches over 12 depths and 2.10 times its triangles, and the ground 32,768 patches over 16 depths
and 2.19 times.

The measured distance is a two-sided distance between a patch and the full mesh below it. It
measures the patch's vertices and triangle centers against the full mesh. It also measures up to
6,000 of the full mesh's vertices against the patch. It takes up to 48 patches of each depth. Depth 0 is the root.

| Mesh | Depth | Stored error before | Stored error after | Measured distance |
| --- | --- | --- | --- | --- |
| Pebble | 0 | 34.6 m | 1.74 m | 0.43 m |
| Pebble | 5 | 3.98 m | 1.70 m | 0.22 m |
| Pebble | 8 | 0.28 m | 0.25 m | 0.037 m |
| Pebble | 10 | 0.0066 m | 0.0066 m | 0.0044 m |
| Ground | 0 | 4,752 m | 750 m | 9.1 m |
| Ground | 4 | 668 m | 315 m | 5.4 m |
| Ground | 8 | 35.0 m | 17.4 m | 1.0 m |
| Ground | 12 | 0.77 m | 0.67 m | 0.075 m |
| Ground | 14 | 0.026 m | 0.026 m | 0.017 m |

The figures below depth 0 are medians. Over 2,000 views each, with a threshold of 1 pixel in a
1080-pixel view at a 60 degree field of view:

| Mesh and cameras | Views with holes, before | Views with double draws, before | After |
| --- | --- | --- | --- |
| Pebble, outside the mesh at 1.01 to 40 root radii | 535 (27%) | 44 (2.2%) | 0 and 0 |
| Ground, outside the mesh at 1.01 to 40 root radii | 1,559 (78%) | 168 (8.4%) | 0 and 0 |
| Ground, 0.8 to 80 m above its highest point | 2,000 (100%) | 1,570 (79%) | 0 and 0 |

The ground's top errors stay well above the measured distance. Its outer border is locked, so the
patches near the root keep 2,000 to 4,000 triangles. At those steps the simplifier reports 200 to
760 m of error against 9 m measured, and the larger-of-two rule carries that figure up. The fix does
not change the simplifier's measure.

### Tests

`crates/null3d-render/tests/cluster_cover.rs` walks the tool's own trees of a lumpy pebble and a
heightfield, which `cluster-fixture.ts` writes into `tests/fixtures/cluster-trees/`. It uses 2,000
views each, inside and outside the mesh, at five thresholds, with scaled and turned copies. Every
leaf must find exactly one drawn patch on its chain. A second test applies the shader's rule, line
for line, to the pass's table of both trees in one scene, and pins the shader's lines. Its picks
must match the walk's. With the old parent test, 1,392 of 2,000 pebble views fail. With the old
table parent, 118,985 picks differ.

How the data was produced: the commands above ran on this branch and on its base, `f7ffdbff`. A
script then read each tree back and simulated the rule. The script lives outside the repository.
