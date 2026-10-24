# D-255: a depth-reading material carries textures

Status: decided. Date: 24 October 2026. Task: M3-E4a.

Summary: A custom material that reads the copy of the scene's depth takes a maps' group of seven
slots, under a layout of its own, which leaves the fragment stage's sixteenth sampled texture for
the copy. The material may declare up to seven textures, and the eighth is refused with a message
that names how many to drop. A material that reads neither keeps its group, binding for binding.

## Question

A material may read the scene's depth or carry textures of its own, not both: the frame group holds
eight sampled textures and the maps' group eight, which is WebGPU's limit of sixteen in the
fragment stage. Which binding does the engine give up, and what does that cost?

## Rule

- A material declares the scene depth and at least two textures, and draws the same image on WebGPU,
  compatibility mode and WebGL2.
- Each stage's sampled textures, samplers and storage textures stay within the default limits that
  every device offers, and the figures are written down.
- A material that reads neither the depth nor a map pays nothing measurable: the same bindings, the
  same GPU objects and the same draw list words as before.
- A material that still cannot fit is refused with a message that names what to drop.

## Data

The count in each GPU path's fragment stage:

| Resource | WebGPU core | WebGPU compatibility | WebGL2 |
| --- | --- | --- | --- |
| `LAYOUT_FRAME` sampled textures | 8 (bindings 2, 3, 4, 9, 10, 11, 12, 15) | 8 | reads only what it uses |
| `LAYOUT_MATERIAL_MAPS` sampled textures | 8 | 8 | 8 slots, units only for reads |
| `LAYOUT_MATERIAL_SCENE` sampled texture | 1 | 1 | 1 |
| A material with the depth and the maps, today | 17 | 17 | 3 units |
| The limit that binds | `maxSampledTexturesPerShaderStage` 16 | 16 | 16 texture units per stage |
| Option A: the copy as a read-only storage texture | 16 sampled, 1 storage | 16 sampled, 1 of 4 storage | 3 units |
| Option B: a maps' group of seven slots | 16 sampled | 16 sampled | 3 units |
| Option C: a frame group without the probe grid | 16 sampled | 16 sampled | 3 units |

The counted bindings, by option:

- **A** moves the copy out of the sampled budget into `maxStorageTexturesPerShaderStage` (4, and
  `maxStorageTexturesInFragmentStage` 4 in compatibility mode). It keeps all eight map slots and
  leaves the sampled count at sixteen. It needs the depth copy's texture to carry
  `STORAGE_BINDING`, which the render graph gives only to targets that a compute pass writes, so the
  graph's usage model changes; and the copy is a render target on both paths, so the read-only
  storage form would reach compatibility mode, where no device in the project has run one yet.
- **B** leaves out the maps' last slot, which no material needs for the depth alone, and the
  displacement map, which only a standard material reads. The shader numbers its textures from the
  group's first binding and its samplers from the slot count, so the group keeps those numbers and
  takes out bindings 7 and 15 alone.
- **C** binds, for a depth-reading material, the frame group without the light probe grid, which no
  custom material build reads. It keeps all eight map slots, and it needs a third frame group for
  each view in both frame builders, plus the bucket that selects it, which is the machinery that
  parallax uses.

How the data was produced: the layouts in `packages/engine/src/gpu/webgpu/pipelines.ts`, the slot
count in `crates/null3d-gpu/src/drawlist.rs`, and the limits in the plan's table of the devices'
reported limits (24 October 2026). A stage's count includes every entry of every group's layout
whether or not the shader reads it, as `null3d-gpu`'s mock and
`packages/engine/src/gpu/webgpu/pipelines.test.ts` judge.

## Decision

**B.** All three options reach sixteen sampled textures, so none leaves the fragment stage a spare;
B reaches it with no new bind group for each view, no shader variant, no change to a texture's
usages, and no dependency on a storage texture in compatibility mode. It confines the change to the
maps' group, which already varies per material, so the draw path is untouched.

The cost: a material that reads the depth takes at most seven textures. That is a limit the engine
can name and check, and the water add-on that needs the feature wants two.

## Consequences

- **Code:** `MATERIAL_MAPS_SCENE` in `crates/null3d-gpu/src/drawlist.rs` with its layout in
  `packages/engine/src/gpu/webgpu/pipelines.ts`; the group's key and creation in
  `crates/null3d-render/src/textures.rs`, chosen by the material's feature in
  `crates/null3d-render/src/frame.rs`; the refusal in `checkSceneInputs` in
  `packages/engine/src/scene/resources.ts`; and the joint texture's group after both the maps' and
  the depth's, `JOINTS_AFTER_SCENE`, in `crates/null3d-shaders`.
- **Cost on a material that reads neither:** its maps' group keeps the same layout, the same
  eighteen entries and the same ninety-three words in the draw list, and its pipelines, shader
  builds and draws are unchanged. No GPU object is added.
- **Tests:** `crates/null3d-render/tests/custom_materials.rs` counts the two groups' bindings and
  words on both frame builders; `crates/null3d-shaders/tests/material.rs` checks the joint
  texture's group in the shading and culled builds; `pipelines.test.ts` counts the fragment stage's
  sampled textures; `materials.test.ts` checks the refusal; the image test `depth-textures` draws a
  water sheet with the depth and two textures on every GPU tier and thread mode.
- **Docs:** `docs/api/materials.md` and `docs/shaders/surface-functions.md` name the limit of seven
  textures beside a scene input.
