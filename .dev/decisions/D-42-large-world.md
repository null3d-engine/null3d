# D-42: Large-world mode and batch origins

Status: decided. Date: 2026-10-04. Task: M2-H1.

Summary: `largeWorld: true` stores whole cells beside each 32-bit position, so setters keep 64-bit precision: the cells scene at the Earth's radius draws the origin's image within 5 of 57,600 pixels, and raycasts there match three.js. Batches take an origin in both modes. 512 cells stay: a scene as dense as S6 fills its object budget first.

## Question

Grid cells keep world matrices precise far from the origin ([Large worlds and precision](../../docs/concepts/large-worlds.md)). But sketch code writes positions into the core's arrays of 32-bit floats. So a position rounds before any cell sees it: in steps of 6 cm at 1,000 km and 0.5 m at the Earth's radius. The question has three parts:

1. How a 64-bit position from a setter reaches the core without losing digits.
2. How instance rows, which sketch code writes straight into 32-bit arrays, stay precise far out.
3. Whether 512 cells in use (`CELL_BITS` 9) is enough for a planet-scale scene as dense as S6, or whether the index needs more bits.

## Rule

- A scene at the Earth's radius draws the image of the same scene at the origin, on all three GPU tiers. The tolerance is the one that the 100 km cells test already uses.
- Raycasts, overlap queries and `worldToScreen` far out give the answers that three.js computes in 64-bit numbers.
- Scenes that do not use the mode pay nothing in their frames and nothing in memory.
- No per-frame allocation (hard rule 1), and the transform update stays one pass over flat arrays.

## Data

| Measure | Result | How |
| --- | --- | --- |
| A 64-bit split at the Earth's radius and at 4 × 10⁹ m | The 32-bit rest is at most half a cell; whole cells plus rest give the position within 3e-5 m | `cells.rs` tests |
| A root at (1,234.5678, 6,378,137.3, -98,765.4321) | Large-world mode: world position within 1e-4 m. Without it: off by more than 0.1 m | `scene.rs` tests |
| A root moved in 600 steps of 1 mm across a cell boundary, with a child 600.25 m away | Every step moves both by 1 mm, within 1e-4 m | `scene.rs` tests |
| `setParent(..., { keepWorld: true })` at 2,000 km and back to a root | Place kept within 1e-4 m; the root takes its whole cells back | `scene.rs` tests |
| Nine batch rows 1 mm apart around an origin at the Earth's radius | Each row within 1e-4 m of its place; the four-lane and one-row paths agree bit for bit | `instances.rs` tests |
| The cells scene at 6,378,137.3 m with large-world mode and batch origins, against the scene at the origin, Mac GPU | 0.009% of pixels differ on WebGPU, 0.002% in compatibility mode, 0.005% on WebGL2: at most 5 of 57,600 pixels, with any change of color counted | `cells-6378km` image test, 2026-10-04 |
| The same scene without large-world mode | 3.5% of pixels differ on WebGPU, 2.5% in compatibility mode, 3.5% on WebGL2 | A temporary manifest entry, 2026-10-04 |
| The raycast scene at the Earth's radius, 600 rays and a batch of 10,000, large-world mode | 271 closest hits and 442 hits in all, every one as three.js's `Raycaster` finds it, on WebGPU and WebGL2. Hit points taken to the screen and back as rays pass within 2.3e-14 m | `raycast.spec.ts`, Chrome on the Mac, 2026-10-04 |
| The same rays without large-world mode | 710 mismatches with three.js | Same test |
| `bun run bench:allocation`, S1, both GPU paths | Passes: no new allocation in the sketch worker or the render worker | 2026-10-04 |

## Decision

### Positions: whole cells beside the 32-bit rest

`createEngine({ largeWorld: true })` gives the scene a second array with three 32-bit integers per slot. They hold the whole cells of each position. Each setter splits each number in JavaScript's 64-bit numbers. The nearest whole number of cells goes into the new array, and the rest of at most half a cell into the existing 32-bit positions. The rest keeps 0.03 mm or better. In the transform update, a root's cell is its whole cells plus the cell of its rest. Its translation is the rest relative to that cell. A child adds its whole cells back to its position in 64 bits. They are zero unless a child sits 512 m or more from its parent. Every other reader and writer of positions goes through the same split: `getPosition`, `translate`, `lookAt`, `clone`, `instantiate` and `setParent` with `keepWorld`.

Options that were rejected:

- 64-bit positions in the core, a `Float64Array` view in TypeScript. Every reader of positions would take two view types. And in every scene, the transform update would read 24 bytes per object in place of 12.
- The split in every engine, with no option. Every setter of every small scene would pay a division and a rounding per axis, and every engine 12 bytes per slot. Most scenes fit in one cell and gain nothing.
- The split in the core, from a 64-bit array that TypeScript writes. It costs the same memory as the rejected 64-bit positions, plus a pass that copies them.

The mode costs 12 bytes for each of the scene's 16,384 slots, 192 KB, whether or not the slot holds an object. Without the mode the array is empty. The update then adds only a bounds check on the empty array and three additions of zero for each root.

### Batch origins

Instance rows stay 32-bit floats that sketch code writes directly, in both modes. `createInstances` takes an `origin` option. The core splits it as a setter does, into a cell and a 32-bit position in it. The update adds that position to each row, four rows at a time. Then it adds the origin's cell to the cell that it finds. A row near its origin therefore keeps a 32-bit float's precision at any distance. Origins need no mode, because they cost nothing per row beyond one addition per axis. A model's own instancing (`EXT_mesh_gpu_instancing`) takes its node's world position as its batch's origin. So its rows stay precise wherever the copy stands.

### 512 cells stay

`CELL_BITS` stays 9. The GPU paths pack a cell index above a 23-bit row or bucket number, and WebGPU draws up to 8,388,480 objects and rows. A tenth bit would halve that to about 4.2 million.

S6 is a city block of about 20,000 objects. Take that many objects per square kilometer. A scene's budget of objects and rows is 1,048,576 to 8,388,480, by device. At that density it covers 52 km² to about 420 km² of ground. Flat ground takes one layer of cells, so that is 52 to about 420 cells. So a dense scene fills its object budget before it fills 512 cells, at any distance from the origin. Only the largest budget, on ground that straddles a vertical cell boundary over most of its area, could need more.

Content spread thin can reach the limit: one marker in each of 1,000 towns takes 1,000 cells. The table then puts each source that enters a new cell into the origin's cell, at 32-bit precision, as it always has. The docs give the remedy: parents that hold far objects, as children share their root's cell, or content that streams with the camera.

### How three.js handles it

three.js keeps `Object3D` positions in JavaScript's 64-bit numbers, and multiplies each object's world matrix by the camera's on the CPU in every frame. That keeps meshes precise far out, at the cost of a matrix product and an upload per object per frame. Its `InstancedMesh` rows are 32-bit floats relative to their mesh, as batch rows are relative to their origin. three.js offers logarithmic depth for large views, which the engine leaves out ([D-08](D-08-webgl2-depth.md), and the large worlds page's section on depth).

## Consequences

- Code: `split64` and `offset_cell` in `crates/null3d-core/src/cells.rs`; `SceneStorage::with_large_world`, `position_cells` and `set_position64` in `scene.rs`; `InstanceBatch::set_origin` in `instances.rs`; `initEngine`'s `large_world` argument, the `POSITION_CELLS` scene field and `setBatchOrigin` in the WebAssembly entry point; `writePosition` and `readPosition` in `packages/engine/src/scene/scene.ts`.
- Tests: the `cells-6378km` image test borrows the `cells` references; the raycast page takes `?far` and `?largeWorld`.
- Docs: `concepts/large-worlds` is written; `api/engine`, `api/objects`, `api/scene` and `concepts/instances` name the option and the origin; the mapping entry for `logarithmicDepthBuffer / reverseDepthBuffer` points to the large worlds page.
- Skills: the large worlds recipe and the API reference of `null3d-develop`.
- M2-H2 measures stability during a flight with this mode: the large-world jitter test, T-35.
