# D-27: The trees behind raycasts and spatial queries

Status: decided. Date: 2026-10-03. Task: M2-D1.

Summary: Four-child nodes tested four boxes at a time. Mesh trees and the static objects use the SAH build, which answers rays twice as fast in a city block; dynamic objects use the Morton build in each frame that queries. One subtree per grid cell keeps rays precise 6,378 km out. Builds cost 0.20 to 0.30 µs per triangle in WebAssembly.

## Question

Raycasts, overlap queries, pointer events and picking need to find the objects and triangles a ray or a volume meets, without testing each one. How should the engine build and store those trees?

The question has five parts:

1. How many children a node has, and how its boxes are laid out.
2. Which build each kind of tree uses: the trees over each mesh's triangles, the tree over static objects, and the tree over dynamic objects.
3. How queries stay precise far from the origin.
4. How skinned characters are tested.
5. How the asset tool stores a mesh's tree in a model file, so that the engine loads it instead of building it.

## Rule

- Every query gives the answer of testing each triangle and each object in turn. The distances match to the bit, and so do the sets of hits.
- A frame that syncs the trees and runs queries allocates nothing once the scene stops growing.
- The format that the asset tool writes and the engine reads has one source: the engine's Rust core, which the tool runs as WebAssembly. Two builds of one mesh give the same bytes on every machine. The reader refuses a damaged file.
- Build times stay within these budgets, on one thread of the MacBook Pro:
  - A mesh's tree: at most 1 µs per triangle in WebAssembly. A triangle of a model compressed with meshopt takes about 6 bytes, which download in about 5 µs at 10 Mbit/s. So a job worker builds a model's trees faster than the model downloads.
  - The tree over dynamic objects, rebuilt in each frame that queries: at most 0.1 µs per object.
  - The tree over static objects: at most 0.5 µs per object to rebuild after objects are created or destroyed. At most 0.05 µs per object to refit after static objects move.

## Data

All figures come from the Rust benchmarks on the MacBook Pro (18 cores), with the release profile. Several other helpers were building and testing on the machine at the same time, at load averages of 28 to 230. The tables give the run at the lowest load, a load average of about 30, which still had more threads waiting than cores. Earlier runs at higher loads were up to four times slower. Under load, the speedup from more threads is smaller than on an idle machine.

### Mesh trees

A height field of random heights, built with the SAH build on one thread. "Brute force" tests every triangle.

| Triangles | Build, native | Build, WebAssembly | Refit | Nodes | Bytes per triangle | One closest-hit ray | Brute force |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,082 | 1.95 ms | 2.05 ms | 0.072 ms | 1,423 | 19.8 | 0.40 µs | 80 µs |
| 100,352 | 23.9 ms | 26.2 ms | 0.76 ms | 15,691 | 21.5 | 0.56 µs | |
| 999,698 | 250 ms | 298 ms | 6.2 ms | 130,894 | 18.7 | 0.65 µs | |

So a mesh's tree costs 0.20 to 0.30 µs per triangle in WebAssembly, within the budget of 1 µs. A phone's core is slower than the Mac's, and nobody has measured its build times yet.

The first version of the build read each primitive's box through its index on every pass. It took 1.07 s for a million triangles at a load of about 180. The build now copies the boxes once into a packed array, which each split bins and partitions in order. Parts of up to 16 primitives split by sorting along each axis instead of by bins. With both changes, the same build took 0.29 s at a load of about 120.

### The top level

Items of 1 to 3 m in a cube of 1 km, one item per leaf. Each ray tests the item's box when the tree reaches it.

| Items | SAH build, 1 thread | SAH build, 8 threads | Refit | One ray, SAH tree | Morton build, 1 thread | Morton build, 8 threads | One ray, Morton tree |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.17 ms | 0.063 ms | 0.010 ms | 0.20 µs | 0.032 ms | 0.020 ms | 0.17 µs |
| 10,000 | | | | | 0.35 ms | 0.16 ms | 0.39 µs |
| 20,000 | 7.0 ms | 2.2 ms | 0.23 ms | 0.51 µs | | | |
| 100,000 | 31 ms | 12.9 ms | 1.3 ms | 0.88 µs | 3.9 ms | 2.1 ms | 1.6 µs |

In WebAssembly on one thread, the Morton build took 0.058 ms for 1,000 items, 0.66 ms for 10,000 and 7.0 ms for 100,000.

Random boxes of similar size flatter the Morton build. A city block is closer to a real scene. It has 2,000 buildings of 10 to 40 m on a grid, and 18,000 props of 0.3 to 2 m. Half the rays run along the streets at eye height, and half look down from above.

| City block of 20,000 objects | SAH | Morton |
| --- | --- | --- |
| Build, one thread | 6.9 ms | 1.1 ms |
| One ray | 0.29 µs | 0.56 µs |

The Morton build sorts objects by their centres alone, so a building's box shares nodes with the small props around it. The SAH build weighs each box's size, and keeps buildings and props apart.

### A frame that queries

A scene of 20,000 static objects and some dynamic objects, in a frame where only the dynamic objects moved. The sync refits nothing and rebuilds the dynamic tree.

| Dynamic objects | 1 thread | 4 threads | 8 threads |
| --- | --- | --- | --- |
| 1,000 | 0.054 ms | 0.040 ms | 0.043 ms |
| 10,000 | 0.47 ms | 0.26 ms | 0.22 ms |
| 50,000 | 2.7 ms | 1.3 ms | 1.0 ms |

The dynamic rebuild costs 0.03 to 0.06 µs per object on one thread, within the budget of 0.1 µs. The static rebuild costs 0.17 to 0.35 µs per object, within 0.5 µs, and the refit 0.010 to 0.013 µs, within 0.05 µs.

### How the data was produced

- Native: `cargo test -p null3d-core --release --test bench -- --ignored --nocapture --test-threads=1 bench_bvh`, on 3 October 2026, three runs. The benchmarks are `bench_bvh_mesh`, `bench_bvh_top_level`, `bench_bvh_city` and `bench_bvh_scene_sync`.
- WebAssembly: a small crate exports the mesh build and the Morton build over the same inputs. It is built for `wasm32-unknown-unknown` with SIMD, as the engine is. Node 24 ran it, and each figure is the fastest of 3 to 101 builds.
- Answers: `crates/null3d-core/tests/bvh.rs` compares every query with brute force. Its inputs are random meshes, soups of long thin triangles, a terrain grid and spheres. Its scenes span many cells, near the origin and 6,378 km from it. `tests/bvh_no_alloc.rs` counts allocations in 57 frames of syncs and queries.

## Decision

### Nodes

Every tree uses one node of four children. A node stores its children's boxes by axis, four floats per bound, so one SIMD operation tests a ray against four boxes. The four child words follow, so a node takes 112 bytes. A child word names another node, a leaf, or nothing.

- A mesh tree's leaf holds up to 4 triangles. A mesh tree then takes 19 to 22 bytes per triangle, about as much as the mesh's own indices and positions. Leaves of one triangle would need about three times the nodes.
- A top-level leaf holds one object, so each object's box takes one lane of the four-box test. A ray then reaches only objects whose boxes it meets. The caller's test for an object costs much more than a box test. It moves the ray into the object's space and walks the object's mesh tree.

Rejected: nodes of two children. They need twice the nodes and one box test per child. Also rejected for now: child boxes quantized to 8 bits, as Ylitie and others did for GPUs in 2017. They would halve the node memory, but each test would decode the boxes first, and a quantized box must round outward to stay exact. The mesh trees' memory is already about that of the meshes they serve.

### Builds

| Tree | Build | When |
| --- | --- | --- |
| A mesh's triangles | SAH, one thread, nodes in one block with no gaps | When the mesh loads, on a job worker, or in the asset tool |
| Static objects | SAH, subtrees of up to 1,024 objects on the job workers | After objects are created or destroyed, change between static and dynamic, or a static object changes cell. A static object that moves in its cell only refits the boxes |
| Dynamic objects | Morton codes and the radix sort that clusters already use; subtrees of up to 1,024 objects on the job workers | In each frame that runs a query, and only then |

The SAH build bins box centres into 16 bins along each axis, and splits where the expected cost of a ray is least. Parts of up to 16 primitives sort along each axis and test every split, which is exact and cheaper than binning at that size. From 32 levels down, parts split in the middle of their run instead, so no input can make a tree deeper than 48 levels.

The static tree keeps the SAH build because it answers rays twice as fast in the city block. Queries run many times between changes to static objects. The build costs 2.2 ms for 20,000 objects on 8 threads, and runs only in a frame that queries after a structural change. Such a frame already rebuilds the renderer's tables. A refit costs at most a tenth of a build, so static objects that move only refit.

Both builds that run on the job workers give each subtree its own slots in the node array. So the trees are the same for any number of threads, and no lock is needed. A subtree of `m` objects reserves `m - 1` slots and empties the slots it does not use. The array holds at most one slot per object and one per cell.

### Precise rays

Object bounds are relative to the centres of their grid cells, as the renderer keeps them. The top level builds one subtree per cell, in that cell's frame. A query takes its origin in 64-bit floats, and moves it into each cell's frame in 64-bit floats before it rounds to 32 bits. The test `far_rays_are_as_precise_as_near_ones` builds the same 200 objects at the origin and 6,378 km away. 300 rays at each place find the same objects at the same distances, to the bit.

The ray-box test follows Ize's "Robust BVH Ray Traversal" (2013). It widens the far end of each slab by 4 float steps, the most its rounding can lose. Every stored box is also widened by one float step on each side. A ray that runs exactly in a box's face then still enters it. Without the widening, a ray straight down a grid line of a terrain could skip the boxes on one side.

The triangle test is Möller and Trumbore's. Edges and corners count as inside. A tree and a loop over every triangle call the same test, so they agree to the bit.

### Skinned characters

Queries test a skinned character as one capsule per bone. Its triangles move in every frame, so a triangle tree would need a refit, and a CPU copy of the skinned vertices, before each query. A capsule follows the bone's two ends, and a character of 60 bones costs 60 capsule tests once the ray meets its box. The capsule test finds where the ray enters the capsule's side or the sphere around either end. A ray that starts inside a capsule does not hit it, as a ray that starts behind a front face does not.

### The stored format

A stored mesh tree is a 48-byte header, the nodes, and one 32-bit triangle index per triangle. The header holds the bytes `N3BV`, the format version, the triangle count, the node count, the leaf size and the mesh's box. Every number is little-endian, and every record size is a multiple of 4, as a glTF buffer view needs. `crates/null3d-core/src/bvh/format.rs` gives the layout. The asset tool writes `MeshBvh::to_bytes()`, and the loader reads `MeshBvh::from_bytes()`.

The reader checks each child word and the depth. It checks that each node has one parent, which comes before it, and that the leaves name every triangle once. It also checks that every stored box is finite and holds what lies under it, and that every empty slot holds the empty box ([D-59](D-59-file-limits.md)). A tree that passes gives the same hits as a tree the engine builds, though its shape may differ. A test damages a stored tree 2,000 times at random. The reader refuses each damaged tree, or the tree still answers 20 random rays as brute force does.

### How three.js handles it

three.js's `Raycaster` tests each object's bounding sphere and box, then each triangle of each object that the ray meets, in JavaScript. The `three-mesh-bvh` add-on builds a binary tree per mesh in JavaScript, and refits it for skinned meshes after it skins their vertices on the CPU. Neither builds a tree over objects, so a scene of 20,000 objects tests 20,000 spheres per ray. null3D builds the trees in WebAssembly with SIMD. It adds the tree over objects, and keeps it current only in frames that query.

## Consequences

- `crates/null3d-core/src/bvh/` holds the trees, the queries, the capsules and the stored format. `SceneBvh` keeps the scene's two top-level trees. `SceneStorage` gained `structure_epoch()` and `created()`. The trees follow structural changes through them, and leave the renderer's flag alone.
- M2-D2 builds the public queries on `SceneBvh`, `TopTree` and `MeshBvh`, and adds instance batch rows to the top level. It writes the "how queries find objects" part of the `api/raycast` docs page from this record. [D-30](D-30-scene-queries.md) records those queries. It also gives each item the box of its mesh, moved by its world matrix, in place of the box around its bounding sphere.
- M2-A2 keeps the CPU copy of a mesh's positions and indices when queries need them, and builds its tree on a job worker at load.
- The asset tool stores trees for large meshes with `MeshBvh::to_bytes()` ([D-50](D-50-blockers-and-stored-trees.md)). When the reader refuses a stored tree, the mesh builds one instead.
- The skinning tasks give the capsules from the joint matrices.
- The benchmarks in `crates/null3d-core/tests/bench.rs` measure the budgets again after any change to the builds.
