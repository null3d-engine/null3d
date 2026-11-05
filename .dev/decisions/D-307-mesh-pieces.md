# D-307: Pieces of a large mesh, culled per copy

Status: decided and built on every GPU path. Built: the asset tool's pieces (`NULL3D_pieces`), the culling shader on WebGPU, the CPU culling of the direct-draw path, the job workers' culling on WebGL2, and the pieces of meshes made in code, which their level plan gives them ([D-310](D-310-runtime-levels.md#pieces-of-meshes-made-in-code)). Task: none.

Summary: Each level of 32,768 triangles or more holds its triangles in 8 to 16 pieces, each facing about one way, with a sphere and a cone of facings. A smaller list that many copies draw gets up to six facing pieces and one for the rest. It keeps them where their cones drop a quarter of its triangles or more, as a building kit's walls do. Each copy picks its level as before, then culls each piece by the frustum, by the cone where it holds, and by the depth pyramid in the late occlusion phase. The desert's figures of their gain are void. Their build drew null3D at four times the page's pixels, and the GPU refused its frames at Medium. A run on a build with both fixes remains to be taken.

## Question

A copy of a large mesh that the view cuts through, or that turns half its surface away, draws every triangle of its level. three.js r187's meshlet pipeline culls each 64-triangle meshlet of a copy's level by frustum, normal cone and occlusion. How does null3D cull below the copy, without vertex pulling and within the hard rules?

## Rule

- The picture equals the picture without pieces, on every GPU path. The cone test is conservative.
- Per-instance data stays in vertex buffers (hard rule 7), and first instance stays 0 (hard rule 8). The culling stage keeps its eight storage buffers (hard rule 6), and no frame allocates (hard rule 1).
- Few extra indirect draws: Safari pays about 8.5 µs for each indexed indirect draw in each pass ([D-174](D-174-apple-gpu-direct-draws.md)).
- Levels keep their rules ([D-137](D-137-lod-groups.md), [D-213](D-213-cluster-levels.md)). Pieces only order a level's triangles, and every level keeps sharing the base's vertices.
- The material shaders do not change, so the shader set and its download stay as they are.

## The pieces

`packages/engine/levels/pieces.js` (`@null3d/engine/pieces-planner`) plans the pieces from plain typed arrays and imports nothing. So the engine's job workers can run it too. A list of 32,768 triangles or more gets one piece for each 4,096 triangles, from 8 to 16.

The planner groups the triangles by facing first. Spherical k-means, weighted by area, starts from directions spread evenly over the sphere and makes one group per piece, up to 14. Past 14 pieces, each group splits at the median of its triangles' middles along their longest side. A piece's sphere holds its corners. Its cone's axis is the mean facing, and its cutoff is the sine of the widest facing's angle, as meshoptimizer's `computeClusterBounds` gives it. Each number is a 32-bit float, rounded so that it culls no more than the exact bounds.

The tool's step (`pieces-extension.js`) runs with `--lod`, after the levels are stored. It sorts each list of a mesh with levels that the rule gives pieces, and orders each piece for the vertex cache. It then writes `NULL3D_pieces` on the primitive: each piece's triangles and its eight bounds. The extension is not required, so other loaders draw the same triangles. A mesh with a skin or morph targets keeps its lists. A mesh with a tree of cluster patches gets pieces too: its whole levels draw where no patch pass runs, such as on the direct-draw path, and its tree keeps its own indices.

### Smaller lists that many copies draw

A list under 32,768 triangles drawn once gains nothing. The view seldom cuts a small copy, and its pieces face too many ways (the rejected floor of 8,192 below). Many copies of a list that faces a few ways are another case. A building kit's walls face four sides, up and down, and each copy turns about half of them away. The Island's house walls hold 1,652 to 4,905 triangles, and 705 copies of 13 kinds stand in its towns.

So `listPieces` holds one rule, which the tool and the engine share:

- A list of 32,768 triangles or more gets 8 to 16 pieces, as above.
- A list of 1,024 to 32,767 triangles gets `facingPieces` where its copies hold 65,536 triangles or more together. A list under 1,024 triangles saves less than a draw per piece. The floor of the copies' triangles is the one that plans automatic levels for a batch ([D-310](D-310-runtime-levels.md)).
- `facingPieces` groups the triangles into up to six facing groups. The groups start from the six ways along the list's own axes, since a kit builds square to them. Each group keeps the triangles within the angle of its mean facing that lets its cone drop the most of them. The triangles past that angle, such as a pot's, a louvre's or a sloped cap's, draw in one more piece, which seldom culls. A group that keeps fewer than 64 triangles joins that piece.
- The list keeps its pieces only where `coneShare` reaches 0.25: the share of its triangles that the cones drop over eyes spread evenly around each piece. A cone of cutoff `s` drops its piece for `(1 - s) / 2` of the directions, so a flat piece scores a half.
- A material that draws both faces or blends gets no facing pieces: their cone test never holds.
- A list that faces one way by 0.7 or more, as `meanFacing` measures it, gets none either. A view sees a ground from above, so the cone share over eyes all around overrates it. The cluster test's heightfield passed the share on its lower levels. The same number splits a large list by space alone, and `ONE_WAY_FACING` in the planner holds it for both.
- The tool stores a smaller list's facing pieces whatever copies the file places. A file of one prop that a page copies many times holds one copy, and only the scene knows the copies. In the file the list is in piece order already, so the pieces cost only their table of eight numbers each.
- The engine decides at run time. It counts the copies that the scene draws of each mesh. Each object and instance batch counts whose material draws the mesh's own shape in buckets. The loader gives a large list's pieces to the core at once. It holds a smaller list's pieces, of the mesh and of each of its levels. They go to the core once the base's copies hold 65,536 of that list's triangles together. Until then the list draws whole as one range, with no draw more. The count only grows: a scene that destroys copies keeps the pieces, and the check during play draws the mesh whole where they stop paying.
- A file's mesh whose smaller list holds no pieces, as an older file's, plans facing pieces of its base list once its copies pay. The job workers plan them over a sorted copy of its indices, as for a mesh made in code ([D-310](D-310-runtime-levels.md#pieces-of-meshes-made-in-code)). Its levels' lists stay whole: they share the base's vertices, and the plan reads only the base. A list that the tool found too rough plans again at run time and finds no pieces again, once per mesh.
- The sketch thread decides with its own copy of the rule's numbers (`facingCopiesPay`), so it loads no planner code to decide. A unit test keeps it equal to `facingPiecesPay`.

The Island's 13 wall kinds, as the rule plans them, with their copies on the island. The cone share is that of the plan that many copies would give:

| Walls | Triangles | Copies | Pieces | Cone share |
| --- | --- | --- | --- | --- |
| Kind 0 | 1,776 | 39 | 7 | 35.0% |
| Kind 1 | 4,218 | 3 | none: 12,654 together | 37.9% |
| Kind 2 | 3,337 | 4 | none: 13,348 together | 38.1% |
| Kind 3 | 3,050 | 45 | 7 | 35.4% |
| Kind 4 | 2,589 | 9 | none: 23,301 together | 37.4% |
| Kind 5 | 2,036 | 2 | none | 37.9% |
| Kind 6 | 4,905 | 6 | none: 29,430 together | 37.1% |
| Kind 7 | 2,468 | 97 | 7 | 40.5% |
| Kind 8 | 1,668 | 105 | 7 | 35.8% |
| Kind 9 | 1,804 | 58 | 7 | 38.9% |
| Kind 10 | 4,469 | 96 | 7 | 37.7% |
| Kind 11 | 1,652 | 131 | 7 | 35.5% |
| Kind 12 | 1,906 | 110 | 7 | 36.2% |

The desert benchmark's props gain nothing. Their files hold 40 lists of 1,024 to 32,767 triangles: levels of the columns, the arches, the boulders and the pebbles, and the pebbles' bases. None passes the cone share. The rocks are rough, and the fluted columns and curved arches face every way, so no facing group keeps a tight cone.

Each kind's seventh piece holds 8% to 26% of its triangles. Without it, six facing groups gave a cone share of 13% to 15% on six of the kinds. There a few pots and chimney caps widened every group's cone to about 44 degrees. Groups that start from directions spread over the sphere found the same groups on the houses. On a plain box they put two sides into one group.

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

`MeshStorage::set_pieces` gives a live mesh pieces of its own list, at any time after the mesh is made. A new list or new vertices drop them. `MeshStorage::set_piece_list` gives a mesh pieces over a list of their own. That list shares the mesh's vertices, as a level does, part by part for a mesh split into parts, so a mesh made in code keeps its own triangle order for raycasts and vertex updates. The loader calls `setMeshPieces`, and the level plan of a mesh made in code calls `setMeshPieceList`. Either marks the scene's structure changed, so the next rebuild draws the pieces in place.

On WebGPU the scene's layout gives a bucket with pieces no draws of its own. Each piece gets a bucket after every other bucket. It takes the bucket's pipeline and material, a slice of the bucket's size, and a draw for each range of the mesh's parts that the piece covers. A pass draws the pieces' buckets in the bucket's place. A level's pieces take the level's copy count from `Layout::fit_copies`, so their slices move with the level's. The bucket's record names its pieces in its word of index reads, under a bit of its own, since such a bucket never reads by index. A piece's record holds its sphere where a bucket holds its local sphere, and its cone where a level holds its links.

The culling shader picks a copy's level as before. A copy whose level has pieces then waits in its workgroup's queue. Once every thread has culled its own copy, all 128 threads of the workgroup share the queued (copy, piece) pairs, and append each copy to the slice of each piece that shows. One thread that walked a copy's pieces in turn would wait on a round trip to memory for each one. A piece shows when its sphere reaches into the frustum. In the camera's own view with a perspective lens, a copy whose matrix keeps angles also needs a cone that lets some triangle face the eye. In the late occlusion phase the pyramid must not hide the piece's sphere.

The direct-draw path and WebGL2's job workers run the same tests in Rust (`crate::pieces::CopyFrame`). WebGL2 lists each copy again in each piece's bucket, after the culled entries (`BucketedCull::list_kept`).

The cone test is skipped where it may not hold: a material that draws both faces, a mirrored or stretched copy, shadow views, mirrors, probes and orthographic lenses. Shadow views place their instances relative to the camera, not the light, and a shadow pipeline may draw front faces or both.

### The check during play

Pieces pay only where the view leaves out enough of a mesh or enough of it faces away, and each costs a draw in every pass that draws its mesh. So, as the occlusion check does for its passes ([D-40](D-40-gpu-occlusion.md)), a check during play draws a mesh whole while its pieces do not pay (`crate::piece_check`). It counts, for the camera's own view, the triangles that each pieced mesh's copies would draw whole and those that its pieces draw:

- On the CPU paths, WebGL2's job workers and WebGPU's direct draws, the culling has the counts already: the copies that each pieced bucket listed, and those that each piece kept.
- On WebGPU's indirect path, the pieced bucket's own draw, which no pass draws, becomes a tally: the culling shader adds one to its instance count for each copy that waits for its pieces' tests. Every 10 frames the camera's counts copy, with the pieces' draws and the tallies, into the occlusion check's read ring, which lands them in engine memory a few frames later with no wait. Those reads go with the frame's own submit, so they add no submit inside a frame, which would end the frame's GPU timing there. Every view's indirect draws keep the 16 bytes of counts, also in a view that culls in one phase: after its one set of draws there, after both sets and the history in a view that culls in two. The read stamps and copies the counts where the view's phases put them. A view in one phase, as in compatibility mode or at Medium, once kept no counts, so the read wrote and copied past the end of its buffer, and the GPU refused the frame's work with E1305.

Each mesh with pieces runs with them or whole. With pieces, each window of 60 frames that brought 3 counts or more gives a verdict: the pieces stay while they leave out at least 20% of the triangles that the copies in view would draw whole. A window with no copy in view says nothing. Every 600 frames each mesh drawn whole takes its pieces again for a window. Each change rebuilds the draw tables, as a change of the scene's structure does, so the probes of every mesh drawn whole fall on the same frame. `MeshStorage::pieces` gives none for a mesh drawn whole, so every layout and path follows the check.

The threshold comes from the runs below. The desert's arches cut 43% to 64% of their triangles in view and keep their pieces. Its columns cut 0% to 17%, and its code-made ground 0%: a split mesh's pieces follow its parts, and the ground's 16 parts are strips across the whole map. The Island's roads cut 0% to 18%, and its stone walls 0% to 3%. In the benchmark's files, pieces that cut 23% of the walking view's triangles drew in the same GPU time as none, and above that they paid. Those timings come from the void desert runs below. The threshold rests on them until a run with both fixes repeats them.

With the check, the Island drew its frames in 7.54 and 6.42 ms of GPU time, against 8.26 ms without pieces in a run on the same build whose timer read true; another run without pieces read 2,972 ms, a timer fault that this Mac's load brings with pieces or without. The roads drew whole while the camera route flew high, and took their pieces back when it came low, where they cut 37% to 62%. The desert made in code drew its walk in 2.49 ms with the check and 2.52 ms without pieces, and its aerial view in 3.08 ms against 3.41 ms. Those desert figures come from parked windows on a build that drew null3D at four times the page's pixels. So they are skewed against null3D ([D-322](D-322-benchmark-against-threejs-meshlets.md#the-canvas-size-fault)).

## Data

### The desert benchmark

These figures are void. Their build drew null3D at 3840 x 2160 for a page of 1920 x 1080, with culling spheres off center ([D-322](D-322-benchmark-against-threejs-meshlets.md#the-canvas-size-fault)). At Medium a view culls in one phase. On that build the counts' read wrote past the end of its buffer there, so the GPU refused the frame's work with E1305 ([The check during play](#the-check-during-play)). The table stays as the record of the run that set the threshold. [D-322](D-322-benchmark-against-threejs-meshlets.md#results-of-the-fair-rematch) gives the desert with pieces on a build with both fixes. Walking, it draws 3.64 M triangles in 1.17 ms of GPU time, and from above 3.33 M in 1.15 ms (runs 20261104-151905-bench and 20261104-152824-bench). The engine has no switch that draws without pieces, so those runs cannot give the second column.

Medians of 3 runs in turns, in the Mac's Chrome on WebGPU at Medium, 1920 by 1080, with `direct=off`. The same engine build draws both model sets: the files with pieces, and the files that the same tool wrote before pieces existed. The Mac ran other agents' builds throughout, at a load of 60 to 105 on 18 cores.

| View | GPU ms, pieces / none | Triangles a frame, M | Draws | Culling pass ms | Main pass ms |
| --- | --- | --- | --- | --- | --- |
| Walk | 4.49 / 4.47 | 11.94 / 15.49 | 658 / 201 | 0.259 / 0.035 | 3.85 / 4.04 |
| Aerial | 4.32 / 5.65 | 14.12 / 16.90 | 658 / 201 | 0.270 / 0.066 | 3.80 / 5.26 |
| Walk, arches alone | 4.25 / 4.24 | 4.56 / 6.01 | 262 / 55 | 0.053 / 0.028 | 3.68 / 3.62 |

How the data was produced: `bun bench/meshlets/run.ts --runs 3` in the meshlet comparison's workspace, against `bun run build:cdn --url-switches`, after this branch merged `perf/beat-meshlets` at 43cb2186. The pieces models came from `MESHLETS_CLI=<this checkout> bun bench/meshlets/build.ts`. The run records are not kept in the repository.

From above, the cones drop the back of each column and arch, and the main pass saves 1.46 ms. Walking, most of the cut is copies that the view crosses: the triangles outside the frustum cost the main pass little, so its 0.19 ms saving and the culling pass's 0.22 ms more cancel. A boulder gains nothing: only its two finest levels hold 32,768 triangles or more, and only the few nearest boulders draw them.

On WebGPU's direct-draw path in the walk view, the pieces cut the triangles from 15.51 to 13.00 M, with 763 draws in place of 201, and GPU time of 4.81 against 4.56 ms in 2 runs while another build ran. That run had the canvas fault too, so its figures are skewed in the same way.

### Changes that the runs ruled on

| Change | Walk, GPU ms pieces / none | Aerial | Finding |
| --- | --- | --- | --- |
| Pieces on lists of 8,192 triangles or more, at most 32 | 5.22 / 5.04 | 5.08 / 4.53 | 1,053 draws; lists of 10,000 to 20,000 triangles had 4 or 5 pieces that cull nothing |
| Lists of 32,768 or more, at most 32 | 5.17 / 5.00 | 5.25 / 5.74 | Same triangles, 1,007 draws |
| At most 16 | 4.79 / 4.79 | 4.79 / 5.44 | Same triangles again, 658 draws |
| Pieces by space alone | 5.14 / 4.85 | not comparable | Walking cuts as many triangles: the cut there is the frustum's |
| Each thread walking its copy's pieces in turn | culling pass 0.30 to 0.35 ms | 0.32 to 0.48 ms | The shared queue brings it to 0.26 and 0.27 ms |

The rows before the last come from the engine before the merge, with the same method. The pebbles alone, which have no pieces, keep their culling pass at 0.062 ms with the pieces' shader, so the shader slows only the copies that have pieces.

Pieces by facing part neighbouring triangles on a rough rock. A model of a 32-entry vertex cache counts 0.86 misses per triangle on the arch's first level against 0.62 before, and pieces by space keep 0.62. The GPU runs above show no such loss: the facing pieces draw the main pass as fast as space pieces walking, 4.40 against 4.38 ms, and far faster from above. So the tool keeps facing pieces.

### The Island's house walls

Two production builds of the Island drew its sketch with the camera held still. One had no facing pieces and one had them, and both planned the run-time levels. Each visit to a build waited 60 s for its plans to land, then took three windows of 5 s. The visits alternated between the builds, six to each. They ran in the Mac's Chrome for Testing on WebGPU at High, uncapped, in a 1,600 by 900 window at a pixel ratio of 1. Each visit waited for a load below 8, and ran at a load of 2.5 to 6.3. The shadow cascades and ambient occlusion are passes that pieces do not touch. A window counted only where they read within 15% of the median of every window: 15 and 14 of 18 in the town, 15 and 13 of 18 in the opening view. The busiest other process was often Spotlight's indexer, at about 100% of a core. Medians, with the lowest quartile after the slash:

| View | GPU ms, no facing pieces | GPU ms, facing pieces | Frame interval ms | Triangles a frame, M | Draws |
| --- | --- | --- | --- | --- | --- |
| Town | 23.13 / 22.98 | 22.42 / 18.92 | 14.15 / 13.77 | 9.01 / 8.68 | 5,591 to 5,691 / 5,879 |
| Opening, from 800 m | 16.19 / 14.22 | 16.22 / 15.99 | 10.67 / 10.77 | 5.62 / 5.62 | 4,741 / 5,029 |

In the town the walls' pieces drop 0.33 M triangles a frame, and the passes that draw them fall. The depth prepass falls from 0.85 to 0.79 ms, the view copy from 0.77 to 0.65 ms and the later passes from 11.07 to 10.70 ms. The shadow cascades read the same in both builds. A model of the culling at the same view counts 432,060 wall triangles in the camera's own view, and 279,384 with the pieces.

From the opening view every house draws its hand-made far level, so the pieces of the walls' full mesh hold no copy and save nothing. They still cost their 288 draws a frame, with no instance, and the later passes read 0.12 ms more. The check during play leaves such a mesh in pieces, since a window with no copy in view says nothing. So the frame's count of each level's copies, which sizes the levels' slices, now also leaves out the draws of a level that holds no copy. A level whose bucket no view has placed a copy in for 30 frames turns idle, with its pieces, and the views' bundles leave out its draws. A copy that picks it again draws it at once, and each change records the bundles again. The direct-draw path leaves out a level's bucket whose own count is 0, and WebGL2 already skips a draw with no copy. With it, the opening view draws 4,107 to 4,207 draws a frame against 4,741 without facing pieces: the idle levels of other meshes leave out their empty draws too. In four visits to each build at a load of 3.8 to 7.8, the GPU frame read 15.85 ms with the change against 15.48 ms without, and its visits spread from 10.2 to 17.0 ms, so that run cannot show a 0.1 ms change either way.

The facing pieces stay. They save about 0.7 ms of 23 ms in the town, and cost about 0.1 ms of 16 ms from far away.

How the data was produced: a temporary page held the Island's camera at a pose and measured windows with `engine.measure`. It was built with `NULL3D_BUILD_PAGE` against this branch and against its base at `e61ad018b`, and a script visited the two in turn. The pages and the script are not kept in the repository.

## Look

Pieces draw the same picture as the whole list. `tests/image/mesh-pieces.spec.ts` compares the two pixel for pixel in four views, on WebGPU, on the direct-draw path, in compatibility mode and on WebGL2. Each has 0 differing pixels. No option changes the look.

The same test draws a village of one house made in code: a box of separate quads with a round pot, a far level set by hand, and 64 copies, one mirrored and one stretched. Its facing pieces plan at its first draw. Every view draws 0 differing pixels on every path, and the pieces cut the first view's triangles from 186,535 to 106,287 on WebGPU. In compatibility mode on this Mac both scenes also fail with E1305 from the GPU, on the base of this change too; their pixels still match.

## Decision

Build pieces as above, with at most 16 pieces in a list of 32,768 triangles or more, and facing pieces on a smaller list of 1,024 triangles or more whose copies hold 65,536 triangles together and whose cones drop a quarter of its triangles.

Rejected:

- Meshlets of 64 to 128 triangles, with a compute pass that copies each copy's visible meshlets' indices, as the cluster pass does for one copy ([D-213](D-213-cluster-levels.md)). A list per view of every visible meshlet of every copy needs a work list that the GPU sizes, and a readback or a second pass. The copy of the indices also costs per triangle what null3D's indirect draw does not.
- Vertex pulling of meshlets, as three.js does. Every material would need a build that reads its vertices from storage, and three.js pays more per triangle for it.
- A new word in the bucket record. Every material's vertex shader includes the record's structure, so the whole shader set would build again and every shader file would grow.
- Pieces on every list of 8,192 triangles or more. A copy draws such a list far away, where the view seldom cuts it, and its 4 or 5 pieces face too many ways to cull. They cost a draw each and cut nothing. The facing rule gives pieces only to a list whose cones drop a quarter of it, and only where many copies draw it.
- Drawing facing pieces whatever the copies. A list that a few copies draw saves a few thousand triangles a pass for its draws.
- The tool counting the copies that a file places. Pages copy a file's mesh in code, as the desert benchmark copies each of its props thousands of times from one copy in its file.
- Six facing groups without a piece for the rest. A few odd triangles widen each group's cone, as the Island's walls show above.
- 32 pieces on a list. They cut no more triangles than 16 and add half again as many draws.
- Each copy starting its walk of the pieces at another piece. It did not shorten the culling pass, since its cost is each thread's chain of round trips, not threads that add to one count.
- Pieces by space alone, or by facing only where a vertex cache model allows. Walking they cull as many triangles, but from above they drop no back faces, and the cache model's loss did not show on the GPU.
- Merging the draws of pieces that every copy shows into one draw. A view's bundle records its draws once, and which pieces show changes with the camera, so a merge would record the bundle again in many frames.

## Consequences

- The culling parameters' second debug word is 1 for the camera's own view, where the cone test holds.
- The bucket record keeps its 17 words, and only `cull.wgsl` changes. The shader build compiles the culling shader's three entries and reuses the other 94.
- Meshes made in code plan pieces with `planPieces` and `facingPieces` on the job workers, with their levels ([D-310](D-310-runtime-levels.md#pieces-of-meshes-made-in-code)). A mesh takes `setMeshPieceList(mesh, count, indices)`, with the pieces' nine words each and then the sorted indices in the staging words. A level, whose list the plan may sort, takes `setMeshPieces(mesh, count)`, or its pieces with `createSplitLevel` where its base is split. A list that faces mostly one way, such as a ground that wraps the camera, plans spatial pieces with one facing group.
