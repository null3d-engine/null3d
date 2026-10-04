# D-50: Blocker meshes and stored trees from the asset tool

Status: decided for the blockers, the file format and the tool's default, 2026-10-04; whether S6's buildings ship with stored trees waits for the owner. Task: M2-B4.

## Question

Software occlusion culling on WebGL2 (D-41) draws each blocker's own mesh, up to 4,096 triangles, and the frame draws at most 16,384 blocker triangles. Raycasts build each mesh's tree on the first query (D-27, D-30). The asset tool can do both jobs once, before a model ships. The question has four parts:

1. How the tool makes a blocker for a mesh, and how it proves that the blocker never hides what the mesh shows.
2. Which meshes get blockers, and how authors override the choice.
3. How the file stores blockers and trees, so the engine reads them and other loaders ignore them.
4. Which meshes get stored trees by default: a stored tree costs download bytes, and a build costs job worker time.

## Rule

- A blocker never hides an object that its mesh does not hide. A randomized Rust test checks this against the mesh itself.
- The tool gives the same bytes on every machine, as D-18 requires.
- A stored tree gives the hits of the tree that the engine builds. A stored tree that does not fit its mesh is refused, and the mesh builds its own.
- A stored tree must save more load time than its bytes cost to download.

## The method

### Making a blocker

`crates/null3d-assets-wasm/src/blocker.rs` makes it in the tool's WebAssembly module:

1. The mesh's box is cut into a grid of cubic cells, 64 along its longest side. A cell that any triangle touches is part of the surface, and each cell's box grows by a thousandth of a cell for that test.
2. A flood from around the box marks the cells outside. The rest are inside: no triangle touches them, and no path leads from them to the outside. Gaps narrower than a cell, such as cracks where a mesh's parts meet without shared corners, do not let the flood in.
3. The largest box of inside cells comes first. A second box comes when it adds at least 2% of the inside cells, up to 2 boxes and 512 triangles.
4. The union of the boxes becomes one closed surface: the faces between inside and outside of a grid whose lines are the boxes' sides. Neighbouring faces share whole edges, so the surface has no cracks.
5. The tool drops a blocker that fills under 5% of the mesh's box. It hides too little to pay for the frames that draw it.

The ground hides a model that stands upright from below. So, for such a model, the flood does not start below the box. A mesh that is open at its bottom, as most buildings are, then still has an inside. The cells of the lowest row never count as inside, so the blocker stops a cell above the mesh's lowest point. The tool turns the ground on only when every node that draws the mesh keeps its vertical axis pointing up.

### Proving a blocker lies inside

The check runs on its own, from the mesh's triangles, after the blocker is made. A blocker that fails it shrinks by a cell and tries again, up to 2 times, and is then dropped:

- The blocker is closed, with every edge joining two triangles that run along it in opposite directions, and it faces outward.
- No blocker triangle comes nearer to a mesh triangle than 1e-5 times the mesh's longest side.
- Each corner lies inside the mesh, and so do points spread over each blocker triangle, 8 per longest side of the mesh. A point is inside when rays toward 48 directions all meet the mesh. The last face that each ray meets must face away from the point. That face faces a camera farther along the ray, so the camera cannot see the point. With the ground on, a ray downward that meets the ground under the mesh's box also passes.

Every value comes from adding, multiplying, dividing, rounding and square roots, so the single-threaded WebAssembly build gives the same blocker on every machine.

### Which meshes get blockers

The tool tries every mesh that a scene's nodes draw. It leaves out:

- Skinned meshes and meshes with morph targets, whose triangles move.
- Primitives that blend or cut holes with an alpha mask, whose drawn shape has gaps. The solid primitives of a mesh make one shape, and the first of them carries the blocker.
- Meshes whose positions are normalized integers, which no output of the tool has.

A mesh's glTF extras override the choice. The extras `"occluder": false` give no blocker. The extras `"occluder": true` make a mesh that gets no blocker block with its own triangles, which the engine allows up to 4,096. In the scene, `instantiate(model, { occluder: false })` clears every copied mesh's flag, and `{ occluder: true }` sets it on every mesh. Later, `setOccluder` changes one object.

The tool marks small props too. Each such blocker takes a few dozen triangles, and the engine skips blockers under 2 buffer pixels in radius. The frame stops at 16,384 blocker triangles, nearest first. So the cost stays small, and the performance guide says how to turn props off.

### The file format

Both extensions sit on a primitive. Neither is required, so other loaders ignore them. The tool writes them after quantization, on the positions that the engine reads, and drops any that an input file already had.

`NULL3D_occluder` makes the primitive block the view:

```json
{ "positions": 12, "indices": 13 }
```

- `positions`: the index of an accessor of `VEC3` and component type 5126 (32-bit floats): the blocker's corners, in the primitive's own space.
- `indices`: the index of an accessor of `SCALAR` and an unsigned integer type (5121, 5123 or 5125), three per triangle, counterclockwise from outside.
- An empty object, `{}`, makes the primitive block with its own triangles.

`NULL3D_mesh_bvh` stores the tree over the primitive's triangles:

```json
{ "tree": 14 }
```

- `tree`: the index of an accessor of `SCALAR` and component type 5125 (unsigned 32-bit integers). Its bytes are the tree in D-27's stored format. A 48-byte header starts with `N3BV` and the format version. The nodes follow, then one triangle index per triangle. The core's `MeshBvh::to_bytes` writes it, and `MeshBvh::from_bytes` reads it.

The loader refuses a file with E1416 when an accessor has another type, or a blocker index names a corner past the last. With meshopt compression on, both extensions' accessors are compressed in meshopt's attribute mode.

### Loading

The loader marks each primitive with `NULL3D_occluder` with the occluder flag (D-41's `OCCLUDER`). It gives the engine's mesh the blocker, which objects with that mesh then draw in place of the mesh. For `NULL3D_mesh_bvh`, the core checks the tree against the mesh's triangles with `MeshBvh::from_bytes`. It checks each child word and the depth, that each triangle is named once, and that each stored box holds what lies under it. A tree that passes takes the place of a build at the next query. One that fails is refused, with a note in development builds, and the mesh builds its own tree.

## Data

All on the MacBook Pro (Apple M5 Max, 18 cores), 4 October 2026, at load averages of 10 to 70 while other helpers built.

### Blockers never hide what shows

The file `crates/null3d-assets-wasm/tests/blocker.rs` holds 8 tests. They cover a box, a U shape, thin and open shapes, a box open at its bottom and a tunnel. One more checks for the same bytes on a second run. Of 60 random shapes, 43 got a blocker that passed the check. Each of those 43 blockers, swollen outward, failed it.

The randomized occlusion test places 24 random shapes and tests 6,400 spheres. A plain depth buffer of the shapes hides 5,022 of them. The shapes drawn as blockers hide 2,417, and their blockers hide 1,500. No sphere is hidden by the blockers that the shapes leave in view.

### S6's city kits

The 213 Kenney city models of the sample assets (commit c52dda2), 217 meshes, 127,253 triangles:

| Measure | Value |
| --- | --- |
| Meshes with a blocker | 121 of 217 |
| Buildings with a blocker | 76 of 76 |
| Meshes without: open at a side or the top, or thin | 49 |
| Meshes without: the blocker would fill under 5% of the box | 47 |
| Blocker triangles, all meshes | 5,420, about 45 per blocker |
| Median share of the mesh's box that a blocker fills | 28% |
| Time to make every blocker, one thread of WebAssembly | 5.4 s |

The buildings have 1,316 triangles each on average. A blocker of 45 triangles lets the frame's 16,384 blocker triangles cover about 360 buildings, where their own meshes would cover 12.

### Stored trees: bytes and time

Native release build, best of 7 runs, height fields of random heights:

| Triangles | Build | Check of a stored tree | Bytes per triangle |
| --- | --- | --- | --- |
| 10,368 | 1.64 ms (0.16 µs per triangle) | 0.19 ms (0.018 µs) | 19.5 |
| 100,352 | 17.4 ms (0.17 µs) | 1.73 ms (0.017 µs) | 21.1 |
| 999,698 | 199 ms (0.20 µs) | 17.0 ms (0.017 µs) | 18.4 |

D-27 measured the build in WebAssembly at 0.20 to 0.30 µs per triangle. The check costs about a tenth of a build.

The city's model files, from the tool with its defaults and with `--bvh 1`, which stores a tree for every part. The sizes are the sums of the `.glb` files; the textures are files of their own and do not change:

| Files | Without trees | With trees | Growth |
| --- | --- | --- | --- |
| All 213, raw | 2,725,140 bytes | 4,400,856 bytes | +61% |
| All 213, gzip -9 | 1,310,413 bytes | 2,577,090 bytes | +97% |
| All 213, Brotli 11 | 1,212,013 bytes | 2,427,058 bytes | +100% |
| 76 buildings, raw | 1,844,424 bytes | 3,133,464 bytes | +70% |
| 76 buildings, Brotli 11 | 845,839 bytes | 1,786,815 bytes | +111% |

The trees take 2,666,484 bytes before compression, 21.0 bytes per triangle. meshopt compresses a tree to about 60% of its bytes. One building's tree of 26,112 bytes became 15,761.

So a stored tree adds about 9.5 bytes per triangle after meshopt and Brotli. At 10 Mbit/s that downloads in about 7.6 µs, where a build takes 0.2 to 0.3 µs on the Mac. The build runs on the job workers at the first query, so a tree pays only where that build would hold up a frame. A mesh of 20,000 triangles builds in 4 to 6 ms on the Mac in WebAssembly, and a phone's core is slower.

Blockers add 2.9% to the city's files after Brotli, 1,178,419 to 1,212,013 bytes, and 2.5% to the buildings'.

### The engine gives the same hits

- `stored_trees_take_the_place_of_builds` in `crates/null3d-core/tests/queries.rs` stores a tree whose boxes are grown, valid but with bytes that no build gives. The sync keeps those bytes, and 400 random rays give brute force's answers. A tree stored after a build leaves the built tree in place.
- The browser test `stored-trees.spec.ts` loads the asset test scene twice, once with a tree for every part, on separate layers. 2,000 seeded rays give the same hits through both, on WebGPU and WebGL2 in Chrome, and the engine refuses no stored tree. With the ball's and the stand's trees swapped, the engine refuses both and still gives the same hits.

How the data was produced: `cargo test -p null3d-assets-wasm --test blocker`, `cargo test -p null3d-core --test queries`, and `NULL3D_PORT=11273 bun run test stored-trees.spec.ts` in `tests/`. A script ran `optimizeModel` on each city model with `bvh: 0`, `bvh: 1` and `blockers: false`, and summed the outputs raw, with gzip and with Brotli. A small native program timed `MeshBvh::build` and `MeshBvh::from_bytes`.

## Decision

- The tool gives blockers by default, made and checked as above, with `--no-blockers` and the extras `"occluder": false` to turn them off, and the Vite plugin's `blockers` option.
- The file holds both in the two extensions above, whose JSON shapes this record fixes. The format of a stored tree stays D-27's, versioned by its header.
- The tool stores a tree for each mesh part of at least 20,000 triangles by default, `--bvh <triangles>` changes the count, and `--bvh 0` stores none. Below that size a stored tree costs more download time than the build it saves.

The task asks that S6's buildings ship with blockers and trees. The buildings have 1,316 triangles each on average, so the default stores no tree for them. With `--bvh 1`, their files double after Brotli, from 846 KB to 1,787 KB. That saves a build of about 100,000 triangles on the job workers, about 25 ms on one thread of the Mac. The owner decides whether S6 builds with `--bvh 1`.

three.js stores no trees: the `three-mesh-bvh` add-on builds one in JavaScript at load, and can serialize it for the page to save. three.js has no occlusion culling.

## Consequences

- The tool: `packages/cli/src/assets/spatial.js` (the step), `spatial-extensions.js` (both extensions for glTF-Transform), the formats module's `blockerMesh` and `meshBvh`, the options `--no-blockers` and `--bvh`, and report lines for blockers and trees.
- The engine: the loader reads both extensions, `setMeshBlocker` and `setMeshBvh` in the core's glue, `SceneQueries::store_mesh_bvh`, and `instantiate`'s `occluder: false`, which now clears the flag that the file set.
- The docs: `guides/assets-pipeline` (blockers and stored trees), `concepts/culling` (blockers from the asset tool), `cli/null3d`, `api/objects` and `guides/performance`. The develop skill names both in its asset step, its performance notes and its raycast section.
- S6 (M2-L3) builds its city with the tool's defaults, or with `--bvh 1` if the owner chooses it.
