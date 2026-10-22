# D-216: A bounding radius per instance batch, for rows a vertex shader moves

Status: decided on 22 October 2026 for the traffic lanes of Skyway. Built in the engine and used by the traffic-lanes example add-on; the pictures of all three GPU tiers are recorded in [Examples](../examples.md#skyway-m3-c1-22-october-2026).

Summary: `batch.setBoundingRadius(radius)` gives one instance batch's rows a bounding sphere of their own, in place of the mesh's radius. Culling then keeps rows that a vertex shader carries far from their origins. The change writes the batch's local radius in the core and adds one wasm export. It touches neither the culling paths nor the levels of detail.

## Question

A vertex shader may move a row far from the origin it was placed at. Skyway's traffic carries a car up to the length of its lane, 2,400 m, while the car's own hull measures about 2.4 m. The engine culls each row by a sphere around the row's origin, whose radius comes from the mesh. A moved row is then dropped while it is still on the screen. Where should the wider sphere come from?

## Rule

- Data first, and do work once. The rows do not move on the CPU, so their bounds should not move there either ([design principles](../../AGENTS.md), 2 and 4).
- The public API freezes at 1.0, so a hook added now is a promise. Add only what the feature needs.
- A change to a public API updates its docs page, its skill entry and its three.js mapping ([AGENTS.md](../../AGENTS.md), rule 18).

## Data

- The core writes each row's world bounding sphere into the rows' output, from the batch's local radius times the row's largest scale (`crates/null3d-core/src/instances.rs`).
- Both GPU paths cull by that sphere. WebGPU culls in a compute pass, and WebGL2 in the job workers, in groups of nearby rows ([Culling](../../docs/concepts/culling.md)).
- The batch already holds a local radius of its own, which a material with displacement raises. It is per batch, not per mesh, so a per-batch setter needs no new storage.
- Before this change, Skyway stretched its hull's sphere with a zero-area sliver along the lane. That worked, but the bound then belonged to the mesh. Every object that drew that mesh inherited a 2,400 m sphere, and the trick is invisible to a reader of the scene.
- The alternatives and their costs:
  - Turning culling off needs a flag that batches do not have. It would draw every row in every view, including the rows behind the camera, and the GPU's cull would do nothing.
  - Making the batch dynamic uploads every row every frame: about 1.2 MB at 100,000 rows, for rows that never change.
  - A per-row bound upload costs 400 KB a frame at 100,000 rows, for a value that is the same for every row of a lane.

## Decision

1. `batch.setBoundingRadius(radius)` sets that batch's local radius in meters. Each row's sphere stays centered on the row's origin, with the radius times the row's largest scale.
2. The call marks every row for update, so the next frame writes the new spheres. The draw tables stay as they are.
3. It throws E1203 for a value that is not a finite number, and E1108 for 0 or below, which would cull every row.
4. A later change of the mesh's radius, which a displaced material makes, replaces the batch's radius for every batch that uses that mesh. The docs say so.
5. The traffic-lanes example add-on sets each heading's batch to the length of its lane. Skyway therefore draws 30,000 to 100,000 cars with no sliver in the hull.

## Options rejected

- Extending `Object3D.setBounds(center, radius)` to batches. A batch's rows are anchored at their own origins, so a center means nothing there. The radius is the whole choice.
- A `frustumCulled` flag on a batch. It draws rows behind the camera, so it costs more and hides less.
- A material option that widens the mesh. It applies to every batch that draws the mesh, which is the fault this record removes.

## Consequences

- Code: `setBatchBounds` in `crates/null3d-wasm/src/lib.rs` writes the batch's local radius; `setBoundingRadius` in `packages/engine/src/scene/scene.ts`; its declaration in `packages/engine/src/shared/core.ts`.
- Docs: [Instances](../../docs/concepts/instances.md#culling), the [API quick reference](../../skills/null3d-develop/references/api-quickref.md), and the InstancedMesh entry of the three.js mapping.
- Tests: `packages/engine/src/scene/batch-bounds.test.ts` checks that one batch takes the radius and another does not, and both errors. Skyway's image tests draw the lanes on WebGPU, compatibility and WebGL2: a bound that failed would show an empty sky.
- The culling code and the levels of detail are untouched. The cull reads each row's sphere exactly as before.

## Addendum, 23 October 2026: the WebGPU compute cull reads the row's own sphere

The record above says that both GPU paths cull by the row's sphere. WebGL2's job workers and the
direct-draw path do, since they read the batch's world spheres. WebGPU's compute cull did not. Its
shader tested the bucket record's local sphere, scaled by the instance's matrix. A bucket of
batches holds the mesh's sphere, so the batch's widened radius never reached it. A batch whose
vertex shader moved its rows far from their origins was therefore culled by the mesh's radius. That
is the fault this record set out to remove. The instances demo showed it on 23 October 2026. Its
traffic lanes, carried up to 1,300 m from their origins, vanished on WebGPU and compatibility while
WebGL2 kept them.

The ranges texture, which carries each source's distance range, had two spare words in its texel.
Each batch row now writes its batch's local radius in the third word. The culling shader tests that
radius times the row's matrix scale, in place of the bucket's sphere. A scene object leaves the word
0 and keeps its bucket's sphere, which already holds its own radius or the mesh's. The copy counter
reads the same radius, so the level slices still hold whatever the shader picks. The change costs no
new texture and no extra texel, since the word was zero before.

A change of the radius now builds the renderer's tables again, so the texel holds the new value. A
mesh radius that a displaced material grows already did this.

Tests: the renderer's layout tests read the uploaded texel of a batch row. The copy counter's tests
check that its level slices follow the wide bound, and a guard test in the level tests reads the
shader's rule.
