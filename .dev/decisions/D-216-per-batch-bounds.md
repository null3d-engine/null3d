# D-216: A bounding radius per instance batch, for rows a vertex shader moves

Status: decided for the traffic lanes of Skyway, and built in the engine. The traffic-lanes example add-on uses it, and the pictures of all three GPU tiers are recorded in [Examples](../examples.md#skyway-m3-c1).

Summary: `batch.setBoundingRadius(radius)` gives one instance batch's rows a bounding sphere of their own, in place of the mesh's radius. Culling then keeps rows that a vertex shader carries far from their origins, on every GPU path. The core holds the batch's local radius, and the WebGPU compute cull reads it from a spare word of the ranges texture.

## Question

A vertex shader may move a row far from the origin it was placed at. Skyway's traffic carries a car up to the length of its lane, 2,400 m, while the car's own hull measures about 2.4 m. The engine culls each row by a sphere around the row's origin, whose radius comes from the mesh. A moved row is then dropped while it is still on the screen. Where should the wider sphere come from?

## Rule

- Data first, and do work once. The rows do not move on the CPU, so their bounds should not move there either ([design principles](../../AGENTS.md), 2 and 4).
- The public API freezes at 1.0, so a hook added now is a promise. Add only what the feature needs.
- A change to a public API updates its docs page, its skill entry and its three.js mapping ([AGENTS.md](../../AGENTS.md), rule 18).

## Data

- The core writes each row's world bounding sphere into the rows' output, from the batch's local radius times the row's largest scale (`crates/null3d-core/src/instances.rs`).
- WebGL2's job workers, in groups of nearby rows, and the direct-draw path cull by that sphere ([Culling](../../docs/concepts/culling.md)). WebGPU's compute cull reads the batch's radius from the ranges texture ([below](#the-webgpu-compute-cull-reads-the-rows-own-sphere)).
- The batch holds a local radius of its own, which a material with displacement raises. It is per batch, not per mesh, so a per-batch setter needs no new storage.
- The alternatives and their costs:
  - Turning culling off needs a flag that batches do not have. It would draw every row in every view, including the rows behind the camera, and the GPU's cull would do nothing.
  - Making the batch dynamic uploads every row every frame: about 1.2 MB at 100,000 rows, for rows that never change.
  - A per-row bound upload costs 400 KB a frame at 100,000 rows, for a value that is the same for every row of a lane.

## Decision

1. `batch.setBoundingRadius(radius)` sets that batch's local radius in meters. Each row's sphere stays centered on the row's origin, with the radius times the row's largest scale.
2. The call marks every row for update and builds the renderer's tables again. The next frame then writes the new spheres, and the ranges texture holds the new radius.
3. It throws E1203 for a value that is not a finite number, and E1108 for 0 or below, which would cull every row.
4. A change of the mesh's radius after the call, which a displaced material makes, replaces the batch's radius for every batch that uses that mesh. The docs say so.
5. The traffic-lanes example add-on sets each heading's batch to the length of its lane. Skyway therefore draws 30,000 to 100,000 cars with no sliver in the hull.

## Options rejected

- A zero-area sliver along the lane that stretches the hull's sphere. It works, but the bound then belongs to the mesh. Every object that draws that mesh inherits a 2,400 m sphere, and the trick is invisible to a reader of the scene.
- Extending `Object3D.setBounds(center, radius)` to batches. A batch's rows are anchored at their own origins, so a center means nothing there. The radius is the whole choice.
- A `frustumCulled` flag on a batch. It draws rows behind the camera, so it costs more and hides less.
- A material option that widens the mesh. It applies to every batch that draws the mesh, which is the fault this record removes.

## Consequences

- Code: `setBatchBounds` in `crates/null3d-wasm/src/lib.rs` writes the batch's local radius; `setBoundingRadius` in `packages/engine/src/scene/scene.ts`; its declaration in `packages/engine/src/shared/core.ts`.
- Docs: [Instances](../../docs/concepts/instances.md#culling), the [API quick reference](../../skills/null3d-develop/references/api-quickref.md), and the InstancedMesh entry of the three.js mapping.
- Tests: `packages/engine/src/scene/batch-bounds.test.ts` checks that one batch takes the radius and another does not, and both errors. Skyway's image tests draw the lanes on WebGPU, compatibility and WebGL2: a bound that failed would show an empty sky.
- The WebGPU culling shader and the copy counter read the batch's radius from the ranges texture. The other culling paths and the levels of detail read each row's sphere.

## The WebGPU compute cull reads the row's own sphere

WebGL2's job workers and the direct-draw path read the batch's world spheres. WebGPU's compute cull
reads a bucket record instead. A bucket of batches holds the mesh's sphere, so the batch's radius
reaches the shader another way. A cull by the bucket's sphere, scaled by the instance's matrix,
uses the mesh's radius. It drops rows that a vertex shader moves far from their origins while they
are still on the screen. The instances demo shows that fault. Its traffic lanes, carried up to 1,300 m from their origins,
vanish on WebGPU and compatibility while WebGL2 keeps them.

The ranges texture carries each source's distance range, and its texel has two spare words. Each
batch row writes its batch's local radius in the third word. The culling shader tests that radius
times the row's matrix scale, in place of the bucket's sphere. A scene object leaves the word 0 and
keeps its bucket's sphere, which holds its own radius or the mesh's. The copy counter reads the same
radius, so the level slices hold whatever the shader picks. This costs no new texture and no extra
texel.

A change of the radius builds the renderer's tables again, so the texel holds the new value. A
mesh radius that a displaced material grows does the same.

Tests: the renderer's layout tests read the uploaded texel of a batch row. The copy counter's tests
check that its level slices follow the wide bound, and a guard test in the level tests reads the
shader's rule.
