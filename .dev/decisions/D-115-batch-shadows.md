# D-115: Instance batches cast and receive shadows

Status: decided. Date: 2026-10-08. Task: M2-R6.

Summary: An instance batch takes `castShadows` and `receiveShadows` for all its rows, as an object does, on both GPU paths. Each cascade and each light's tile culls the rows one by one, with no new GPU binding. Sprite, point and line batches take neither. A dynamic batch that casts counts as a moving caster, row by row.

## Question

Until M2-R6, batch rows neither cast nor received shadows (M1-D6's follow-up). glTF instancing (`EXT_mesh_gpu_instancing`), S6's city and three.js's `InstancedMesh` all need them. How do batches take part in the shadow passes, and what does it cost?

## Rule

- Intent parity ([D-52](D-52-intent-parity.md)): three.js's `castShadow` and `receiveShadow` on an `InstancedMesh` hold for every instance, so a batch takes one pair of options for all its rows. A batch with the options draws the image that the same objects draw.
- A batch without the options costs nothing new, in the GPU or in the frame builder.
- The GPU culling stage binds 8 storage buffers, the limit on every device. No new binding.
- No allocation in the frame loop.

## Data

The two paths already had most of what the shadow passes need:

- On WebGPU, the casters' layout kept a place for every batch row, and each cascade's and tile's culling read the shared matrices, layers and cell order. A batch needed only a bucket in that layout. The cast option chooses the bucket, so the GPU needs no cast bit and no new binding.
- On WebGL2, the casters' layout culled scene rows only. Its index lists now also hold the rows of the batches that cast.
- The receive option picks the pipeline build that reads the shadow maps, as an object's does, in the opaque layouts and in the transparent pass.

Gaps found and closed:

- A blended batch draws in the transparent pass, so it has no bucket in the scene's layout. On WebGL2 its clusters then never reached the cluster texture, and on WebGPU its rows were missing from the cell order that the cascades cull with. Both now count the casters' layout too.
- The far cascades keep their depth between turns unless a moving caster touches them. That list held dynamic scene objects only. A dynamic batch that casts now joins it, and its active rows are tested one by one against each cascade's box, stopping at the first that touches.
- A spot or point light's tile keeps its depth until a caster in its view changes. For a batch that casts, each row that its update changed in the frame marks the tiles that its sphere touched before or after the change. A new active count or new layers marks every tile. A row's reach from each light is found once, not once per tile. The scan of a batch's rows stops once every tile of the frame's lights must draw, so a large batch that moves costs little more in the frame builder than one at rest.

Image tests: `shadows-batches` and `shadows-batches-dynamic` draw the shadows test's objects as batch rows, grouped by mesh, material and options, and compare with the shadows test's references. `spot-shadows-batches` does the same for the spot light's tile with the spot shadows test's references. Rust tests check, on both paths, that a moved row of a casting batch draws its light's tile once within the light's reach and none beyond it.

How the data was produced: <filled after the runs>.

## Decision

Batches take the two options in `scene.createInstances`, and `batch.setCastShadows` and `batch.setReceiveShadows`, which rebuild the draw tables when the value changes. `scene.instantiate`'s options reach the batches of nodes with instancing of their own. The core keeps the bits per batch, and the WebAssembly call `setBatchShadows` sets them.

Sprite, point and line batches take neither option. Their vertex shaders place their own vertices: a depth pass with the mesh's template would cast the flat quad or strip, not what the camera sees.

Options not taken:

- A cast bit per row: rows of one batch share a mesh and a material, and three.js has one pair of flags per `InstancedMesh`. A row that must not cast can sit in a batch of its own.
- Count every dynamic batch that casts as touching every far cascade: simpler, but one moving particle batch would make every far cascade draw in every frame.

## Consequences

- Docs: `concepts/shadows`, `concepts/instances`, `api/scene`, the three.js mapping entries of `castShadow` and `InstancedMesh`, and the develop skill's quick reference.
- [D-37](D-37-sprites.md), [D-23](D-23-index-instances.md) and [D-106](D-106-s6-city.md) note the change.
- A scene whose batches cast draws more in each cascade and tile. Benchmarks that use batches (S1, S1-static) set no shadow options by default, so their figures do not change. Their `batchShadows` switch, with `shadows=<n>`, makes the rows cast and receive the sun's shadows, and `bench:allocation --batch-shadows` samples S1 that way.
