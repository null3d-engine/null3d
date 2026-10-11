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

Allocation: `bench:allocation --batch-shadows` passes on both GPU paths, alone and with `--tile-shadows`. The sun's 3 cascades then draw in every frame, so the WebGPU replay's budget grows by their pass encoders, 102 bytes per frame. These runs also found that the job workers' busy time made a number object per busy worker in each frame, now fixed ([benchmarks guide](../benchmarks.md)).

How the data was produced: on 10 October 2026, on the Mac at a load below 3, `bench:run --scenes s1,s1-static --pages null3d-webgpu,null3d-webgl2 --runs 3 --seconds 10`. The first run used `--switches shadows=3`, and the second `shadows=3&batchShadows`. Each scene has 100,000 rows, which then cast and receive the sun's shadows in 3 cascades. Each figure is the median of 3 runs, without and then with the rows in the shadows.

| Scene | Page | CPU ms per frame | All threads, ms | GPU ms | Draw calls |
| --- | --- | --- | --- | --- | --- |
| S1 | WebGPU | 1.62 to 1.62 | 2.18 to 2.19 | 2.86 to 3.49 | 2 to 5 |
| S1 | WebGL2 | 2.39 to 2.51 | 3.36 to 3.96 | 4.31 to 4.57 | 3 to 6 |
| S1-static | WebGPU | 0.04 to 0.04 | 0.06 to 0.07 | 1.44 to 4.07 | 2 to 4 |
| S1-static | WebGL2 | 0.10 to 0.12 | 0.15 to 0.19 | 3.09 to 4.22 | 3 to 5 |

The CPU cost is small. On WebGPU the GPU culls the rows for each cascade, and the busiest thread's time did not change. On WebGL2 the job workers cull them, so all threads together took 0.6 ms more on S1. Most of the cost is the GPU's, which draws the 100,000 boxes into the cascades: up to 2.6 ms more per frame. Every page held 120 frames a second.

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
