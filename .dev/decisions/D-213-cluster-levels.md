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
