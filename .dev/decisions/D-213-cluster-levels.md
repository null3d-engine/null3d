# D-213: Cluster levels in the asset tool and their file

Status: decided and built. Built: the asset tool's tree and its file, the measured patch errors,
and the paths that draw the tree on WebGPU and on WebGL2. Each mesh with a tree also gets the level
planner's whole levels. [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md) holds the WebGL2
routes. Task: M3-L3.

Summary: The asset tool builds a large static mesh into a tree of patches of about 128 triangles and stores it in `NULL3D_clusters`. Each patch's sphere holds its children's, and its error is its measured distance from the full mesh below it. The benchmark ground's top patch holds 29 triangles at 10.5 m, against 10.45 m measured, where the simplifier's estimate gave 750 m on 4,006 triangles.

## Question

How does the asset tool build a cluster tree, what does the file hold, and which meshes get one?

## Rule

- The tool and the engine agree on every byte from one source, and the tool runs in Node without a C toolchain.
- A patch draws where its own error passes a view's threshold at its own sphere. The error of the patch above it must not pass at that patch's sphere. The patches that draw then cover the mesh once at any distance.
- A patch's stored error is its distance from the full mesh below it. A view then switches the patch in where that distance spans under the threshold, and no farther.
- Patches of different detail still meet at their edges, with no gap and no pop.
- Every patch names the mesh's own vertices, so a tree adds no vertex stream.
- Other glTF loaders draw the whole mesh from the same file.

## Data

The unit test's sphere:

| Measure | Value |
| --- | --- |
| Seed mesh | A sphere of 32,768 triangles and 16,641 vertices, with normals and texture coordinates |
| Leaf patches | 256, each of 128 triangles at most |
| Patches in the tree | 512: the leaves, a parent above each pair of them, and a short chain above the root |
| The coarsest patch | 450 triangles, where the simplifier can go no coarser with the shared vertices and the texture seam held |
| Tree triangles against the base mesh's | 2.10 times |
| Errors | The measured distance, and never falling from a patch to its parent |
| Spheres | Each parent's sphere holds its children's spheres |
| Vertices added by the tree | 0 |

How the data was produced: `bun test packages/cli/src/assets/clusters.test.ts`, with the build's
own records read back as the engine reads them, and a script that plans the same sphere.

### The benchmark's meshes

The data comes from the desert benchmark's raw ground and props. Each was built with
`bun packages/cli/bin/null3d.js assets optimize <in> <out> --lod --clusters --no-blockers --bvh 0`.
The pebble is `pebble-0` of the props file: 20,480 triangles, 2.06 m long. The ground holds
2,000,000 triangles over 800 m. The figures are in meters. The stored error is the file's own. The
measured distance comes from a separate script. It measures the patch's vertices and triangle
centers against the full mesh. It also measures up to 6,000 of the full mesh's vertices against the
patch. It takes up to 48 patches of each depth. Depth 0 is the top patch, and the other rows give
medians.

| Mesh and patch | Simplifier's error, larger of two | Measured error now | Measured distance |
| --- | --- | --- | --- |
| Pebble, top patch | 1.74, 24 triangles | 0.430, 24 triangles | 0.428 |
| Pebble, the depth of 64 patches | 0.0219 | 0.0096 | 0.0096 |
| Ground, top patch | 750, 4,006 triangles | 10.5, 29 triangles | 10.45 |
| Ground, the depth of 16 patches | 153 | 5.09 | 5.09 |
| Ground, the depth of 512 patches | 3.37 | 0.328 | 0.310 |
| Ground, the depth of 8,192 patches | 0.026 | 0.025 | 0.017 |

The measured distance in the table is that of the tree with measured errors. The simplifier's
errors stood far above their own tree's distances: 9.1 m at the ground's top, 3.97 m at 16 patches
and 0.30 m at 512.

The ground's tree holds 32,772 patches over 20 depths and 2.17 times its triangles. Its top patches
hold 29, 61, 124, 250, 502 and 1,004 triangles. With the outer edge locked, the top three depths
held 3,004 to 4,010 triangles each. The pebble keeps its tree of 514 patches over 12 depths. Over
2,000 views of each mesh, from outside it and from 0.8 to 80 m above the ground, no view leaves a
hole or draws a part twice. In one run the ground built in 66 s and the props in 105 s. A run
beside the picture tests took 200 s and 129 s.

How the data was produced: the commands above on this branch, and on commit `c6ea15f3` for the
simplifier's errors, on the owner's Mac with other sessions running beside them. The measuring
script reads each tree back and lives outside the repository.

## Look

The nested spheres remove holes and parts drawn twice, which the old rule left in 27% of the
pebble's views and 78% of the ground's. The measured errors let the coarse patches switch in where
their real distance allows, so a far view draws far fewer triangles for the same picture.

## Decision

1. The tool's own code builds the tree, in `packages/cli/src/assets/clusters.js`. It cuts each mesh part into compact leaves across the longest axis of their centroids. It joins pairs of patches upward, and simplifies each group toward half its triangles with meshoptimizer's `simplifyWithAttributes`. This is the shape that `clusterlod.h` builds, in the tool's own language. So the tool needs no C toolchain, and the same input gives the same bytes on every machine. The centroid split stands in for `clusterlod.h`'s partition step.
2. A group keeps in place the vertices that it shares with other groups, as `clusterlod.h` does, so a patch beside a finer one still meets it. The mesh's own open edge stays free, so the simplifier moves its vertices along it. Three kinds of open-edge vertex stay put. One is where the edge turns by more than 30 degrees, and one where more than two open edges meet. The third is where another open edge runs within a hundred-thousandth of the mesh's side. The simplifier's own error hardly sees a corner cut off a flat surface, and two sides of an unwelded seam would part.
3. A patch keeps the simplifier's way of least error among those that come within half the cut of the target. The helper `simplifyTries` makes that choice for the whole levels too.
4. A patch's error is its distance from the full mesh below it, and at least its children's. The tool measures each full vertex below the patch against the patch. It also measures the middle and the edge midpoints of each of the patch's triangles against the full mesh. A box tree (`surface-distance.js`) finds each nearest triangle. A leaf's sphere holds its triangles, and every other patch's sphere holds its children's spheres. So along every chain the errors never fall and the spheres never shrink, which the draw rule needs.
5. The tree is stored in `NULL3D_clusters` on the primitive, in three accessors. The first holds the indices of every patch one after another. The second holds four floats of each patch's sphere, and the third four integers of each patch's run, its parent and its error. The extension also names its layout's version, 2. The loader draws a tree of an older version as whole levels. The core refuses a tree or a band whose spheres or errors break the order (`PatchError::Nesting`). The extension is not required, so other loaders draw the whole mesh.
6. A mesh gets a tree when it has 20,000 triangles or more, no skin and no morph targets, a material that neither blends nor masks, and at most four copies. A mesh that bends has no fixed patch bounds, so it keeps whole levels. Many copies pay about twice their indices for no saving, so they keep whole levels too.
7. The engine stores the tree against the mesh's id. It rewrites the tree's indices into the order of the vertices that the mesh's parts hold, and checks them against those vertices ([Meshes of several parts](#meshes-of-several-parts)). The WebGPU path draws the chosen patches ([Drawing on WebGPU](#drawing-on-webgpu)), and the WebGL2 path draws them on the job workers where the device has `WEBGL_multi_draw` and the mesh is one part. Both apply one rule, which `PatchTree::walk` holds for the job workers. Every other path draws the mesh's whole levels ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)). [D-231](D-231-cluster-levels-cost.md) records what the pass costs.
8. Each mesh with a tree gets its whole levels from the level planner of [D-91](D-91-level-planning.md), with or without `--lod`. They are the levels that a mesh without a tree gets. The tree stays as it is. The levels share the mesh's vertices. The tool orders the vertices coarsest level first, then the finer levels, then the base mesh, as for a mesh without a tree. The reorder renames the tree's indices too ([Whole levels beside the tree](#whole-levels-beside-the-tree)).

## Options rejected

- **The parent's error tested at the child's own distance, with each sphere around its own
  triangles.** A parent's sphere then need not hold its children's, so two children could disagree
  on whether their parent passes. One then drew with its parent, and its sibling drew neither. Over
  2,000 views, 27% of the pebble's views left holes and 2.2% drew parts twice. The ground's figures
  were 78% and 8.4% from outside it, and 100% and 79% from just above it.
- **Errors that add up**: the children's error plus the simplifier's, and at least 1.5 times the
  children's. The sum compounded over 12 to 16 depths. The pebble's top patch stored 34.6 m and the
  ground's 4,752 m, so the coarse patches switched in far beyond any view.
- **The larger of the children's error and the simplifier's.** This is `clusterlod.h`'s rule. It
  keeps the order. The simplifier measures each vertex against the planes of the triangles that
  it merged, which run on past them. On the ground's top patches it gave 750 m against 9.1 m
  measured. On a closed, curved surface it can also fall short: a plain sphere of radius 1 and
  32,768 triangles stored 0.695 on a top patch that lies 1.40 from the surface. A view then drew
  that patch where its error showed.
- **Every open edge locked**, as the simplifier's `LockBorder` does. The ground's top patches kept
  the whole rim of 4,000 edges, so its top three depths held 3,004 to 4,010 triangles each.
- **The open edge free with no corners kept.** The simplifier cut the ground's corners off, and its
  top patch measured 263 m from the surface.
- **The fewest triangles of the simplifier's ways**, whatever their error. A way that drops one more
  triangle could double the error.
- **A parent's sphere in each record**, as `clusterlod.h` stores it. Its groups are not records of
  their own. Here each patch has one parent, one record away, and a second copy would add 16 bytes
  to every patch.

## Consequences

- `--clusters` adds about twice a mesh's indices to its file. The whole levels add about as many
  indices again as the base mesh holds.
- Whole levels stay in the file as well, so WebGL2 and other viewers keep their fallback. Every
  copy of an instance batch draws them too. The asset tool cannot see a batch that page code
  makes, so a mesh drawn thousands of times can still get a tree. The levels halve at each step
  and go down to a few dozen triangles. So those copies draw few triangles far away.
- The build needs no `partitionClusters`, so the tool keeps the meshoptimizer version that the engine pins.
- Measuring each patch costs time. Each search stops at the first triangle within the error already
  found. Without that stop, the ground's build took 111 s, and with it 66 s.
- A tree's index count can be odd. The WebGL2 path pads the tree's index buffer to whole words, or
  the page drew nothing of the tree ([D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md)).

## Whole levels beside the tree

The paths that draw no patches draw a mesh's whole levels: the WebGPU direct path, WebGL2 without
`WEBGL_multi_draw`, the shadow maps, a mesh that several copies draw, and every instance batch.
The tool counts only the copies that the file places. So a mesh that page code draws in a batch
of thousands still gets a tree, and every copy draws whole levels.

The tool first cut the tree into whole levels. Each level was the set of patches whose own error
passed the level's error and whose parent's did not. That option is rejected. A cut drops only
what one patch saves over its children, about a quarter at each depth. The tree's errors then
also added up along each chain. So a cut's stored error ran far above its real distance from the
mesh. The desert benchmark's props showed it:

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


## Tests

- `crates/null3d-render/tests/cluster_cover.rs` walks the tool's own trees of a lumpy pebble and a
  heightfield, which `cluster-fixture.ts` writes into `tests/fixtures/cluster-trees/`. It uses
  2,000 views each, inside and outside the mesh, at five thresholds, with scaled and turned copies.
  Every leaf must find exactly one drawn patch on its chain. With the parent tested at the child's
  distance, 1,392 of the 2,000 pebble views fail.
- The same file applies the shader's rule, line for line, to the pass's table of both trees in one
  scene, and pins the shader's lines. Its picks must match the walk's. When the table names each
  parent by its place in its own tree, 118,985 picks differ.
- `clusters.test.ts` checks that every sphere holds its children's, that errors never fall toward
  the root, and that the root's stored error lies within its distance from the full mesh, which the
  test measures more densely on its own. It also checks that the heightfield's top patch keeps the
  ground's four corners and holds at most 64 triangles; with its rim locked it held 516.
- `surface-distance.test.ts` checks the box tree's distances against every triangle.
