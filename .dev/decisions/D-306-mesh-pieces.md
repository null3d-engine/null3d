# D-306: Pieces of a large mesh, culled per copy

Status: decided and built on every GPU path. Built: the asset tool's pieces (`NULL3D_pieces`), the culling shader on WebGPU, the CPU culling of the direct-draw path and the job workers' culling on WebGL2. Pending: the runtime planner that gives a mesh made in code its pieces. It calls the entry points below. Task: none.

Summary: Each level of 32,768 triangles or more holds its triangles in 8 to 16 pieces, each facing about one way, with a sphere and a cone of facings. Each copy picks its level as before, then culls each piece by the frustum, by the cone where it holds, and by the depth pyramid in the late occlusion phase. In the desert benchmark the pieces cut a frame's triangles by about a quarter. SUMMARY-FIGURES

## Question

A copy of a large mesh that the view cuts through, or that turns half its surface away, draws every triangle of its level. three.js r187's meshlet pipeline culls each 64-triangle meshlet of a copy's level by frustum, normal cone and occlusion. How does null3D cull below the copy, without vertex pulling and within the hard rules?

## Rule

- The picture equals the picture without pieces, on every GPU path. The cone test is conservative.
- Per-instance data stays in vertex buffers (hard rule 7), and first instance stays 0 (hard rule 8). The culling stage keeps its eight storage buffers (hard rule 6), and no frame allocates (hard rule 1).
- Few extra indirect draws: Safari pays about 8.5 µs for each indexed indirect draw in each pass ([D-174](D-174-apple-gpu-direct-draws.md)).
- Levels keep their rules ([D-137](D-137-lod-groups.md), [D-213](D-213-cluster-levels.md)). Pieces only order a level's triangles, and every level keeps sharing the base's vertices.
- The material shaders do not change, so the shader set and its download stay as they are.

## The pieces

`packages/cli/src/assets/pieces.js` plans the pieces from plain typed arrays and imports nothing. So the engine's job workers can run it too. A list of 32,768 triangles or more gets one piece for each 4,096 triangles, from 8 to 16.

The planner groups the triangles by facing first. Spherical k-means, weighted by area, starts from directions spread evenly over the sphere and makes one group per piece, up to 14. Past 14 pieces, each group splits at the median of its triangles' middles along their longest side. A piece's sphere holds its corners. Its cone's axis is the mean facing, and its cutoff is the sine of the widest facing's angle, as meshoptimizer's `computeClusterBounds` gives it. Each number is a 32-bit float, rounded so that it culls no more than the exact bounds.

The tool's step (`pieces-extension.js`) runs with `--lod`, after the levels are stored. It sorts each large list of a mesh with levels and orders each piece for the vertex cache. It then writes `NULL3D_pieces` on the primitive: each piece's triangles and its eight bounds. The extension is not required, so other loaders draw the same triangles. A mesh with a skin or morph targets keeps its lists. A mesh with a tree of cluster patches gets pieces too: its whole levels draw where no patch pass runs, such as on the direct-draw path, and its tree keeps its own indices.

### Facing groups or space

| Split of a list | Arch, 1,023,360 triangles | Boulder, 81,920 | Column, 518,688 |
| --- | --- | --- | --- |
| Each triangle tested on its own | 49.2% | 41.9% | 52.6% |
| 16 pieces: 6 facing groups split by space | 2.1% | 1.0% | 10.8% |
| 16 pieces: 16 facing groups | 8.6% | 7.2% | 4.5% |
| 32 pieces: 32 facing groups | 15.3% | 14.0% | 14.7% |
| 32 pieces: 14 facing groups split by space | 9.7% | 5.7% | 21.6% |

The table gives the share of each list's triangles that the cone and frustum tests drop. It covers 300 views around the first mesh of each kind in the desert benchmark's raw props file. The eye is 1.1 to 31 radii from the mesh's center, and looks within 35 degrees of it with a 60-degree lens. The rocks are rough: any small patch holds triangles that face many ways, so a cone over a patch of space is wide. Narrow facing groups cull more back faces than compact patches do. The script lives outside the repository.

## The engine

`MeshStorage::set_pieces` gives a live mesh pieces of its own list, at any time after the mesh is made. A new list or new vertices drop them. `MeshStorage::set_piece_list` gives a mesh in one part pieces over a list of their own. That list shares the mesh's vertices, as a level does, so a mesh made in code keeps its own triangle order for raycasts and vertex updates. The loader calls `setMeshPieces`, and a runtime planner calls `setMeshPieceList`. Either marks the scene's structure changed, so the next rebuild draws the pieces in place.

On WebGPU the scene's layout gives a bucket with pieces no draws of its own. Each piece gets a bucket after every other bucket. It takes the bucket's pipeline and material, a slice of the bucket's size, and a draw for each range of the mesh's parts that the piece covers. A pass draws the pieces' buckets in the bucket's place. A level's pieces take the level's copy count from `Layout::fit_copies`, so their slices move with the level's. The bucket's record names its pieces in its word of index reads, under a bit of its own, since such a bucket never reads by index. A piece's record holds its sphere where a bucket holds its local sphere, and its cone where a level holds its links.

The culling shader picks a copy's level as before. It then appends the copy to the slice of each piece that shows. A piece shows when its sphere reaches into the frustum. In the camera's own view with a perspective lens, a copy whose matrix keeps angles also needs a cone that lets some triangle face the eye. In the late occlusion phase the pyramid must not hide the piece's sphere. A copy wholly inside the frustum skips the pieces' frustum tests.

The direct-draw path and WebGL2's job workers run the same tests in Rust (`crate::pieces::CopyFrame`). WebGL2 lists each copy again in each piece's bucket, after the culled entries (`BucketedCull::list_kept`).

The cone test is skipped where it may not hold: a material that draws both faces, a mirrored or stretched copy, shadow views, mirrors, probes and orthographic lenses. Shadow views place their instances relative to the camera, not the light, and a shadow pipeline may draw front faces or both.

## Data

FINAL-DATA

## Look

Pieces draw the same picture as the whole list. `tests/image/mesh-pieces.spec.ts` compares the two pixel for pixel in four views, on WebGPU, on the direct-draw path, in compatibility mode and on WebGL2. Each has 0 differing pixels. No option changes the look.

## Decision

Build pieces as above, with at most 16 pieces in a list and only on lists of 32,768 triangles or more.

Rejected:

- Meshlets of 64 to 128 triangles, with a compute pass that copies each copy's visible meshlets' indices, as the cluster pass does for one copy ([D-213](D-213-cluster-levels.md)). A list per view of every visible meshlet of every copy needs a work list that the GPU sizes, and a readback or a second pass. The copy of the indices also costs per triangle what null3D's indirect draw does not.
- Vertex pulling of meshlets, as three.js does. Every material would need a build that reads its vertices from storage, and three.js pays more per triangle for it.
- A new word in the bucket record. Every material's vertex shader includes the record's structure, so the whole shader set would build again and every shader file would grow.
- Pieces on lists of 8,192 triangles or more. A copy draws such a list far away, where the view seldom cuts it, and its 4 or 5 pieces face too many ways to cull. They cost a draw each and cut nothing.
- 32 pieces on a list. They cut no more triangles than 16 and add half again as many draws.
- Each copy starting its walk of the pieces at another piece, and taking every piece's slot before writing any copy. Neither shortened the culling pass.

## Consequences

- The culling parameters' second debug word is 1 for the camera's own view, where the cone test holds.
- The bucket record keeps its 17 words, and only `cull.wgsl` changes. The shader build compiles the culling shader's three entries and reuses the other 94.
- The runtime follow-up plans pieces with `planPieces` on the job workers. It calls `setMeshPieceList(mesh, count, indices)`, with the pieces' nine words each and then the sorted indices in the staging words. A mesh whose own list it may sort takes `setMeshPieces(mesh, count)` instead. A ground mesh that wraps the camera may plan spatial pieces with one facing group, `planPieces(positions, indices, count, 1)`, whose cones never cull.
