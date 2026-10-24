# D-239: Custom WGSL samples texture arrays by the layer that the shader picks

Status: decided. Date: 24 October 2026. Task: M3-A3.

Summary: A custom material or effect may declare `var name: texture_2d_array<f32>;` and give its `textures` slot a texture of several layers, and the WGSL then picks the layer in each texture function. The engine binds the texture's own array in the map slot, as it binds a 2D texture's, and its build keeps the layer that the shader wrote; the engine's layer value only says whether the array is on the GPU. One slot, one number of the uniforms and no new bind group layout serve every layer, so a facade shader picks among 6 or more layers per pixel on both GPU paths.

## Question

A custom material samples a texture as a layer of the engine's texture array, and the engine's build writes that layer into every texture function. How can one declaration serve a set of same-size images, such as a facade or window set, and let the shader choose the layer for each pixel?

## Rule

- One way to sample, the same on WebGPU and WebGL2 and in both shader stages, as D-47 set for textures.
- No new bind group layout, no new permutation bit, no new map slot and no new uniform room.
- The shader's layer is the texture's own layer, with no table the engine keeps and no index it remaps.
- A texture that is not on the GPU still samples white, as a 2D texture does.

## Data

The engine already keeps a texture of several layers in an array of its own, with exactly its layers ([the texture store](../../crates/null3d-render/src/textures.rs)), so its first layer is 0. A custom material's map slot binds that array, and its layer value is 0 once the texture's texels are on the GPU; until then the slot binds the white texel and the layer value is -1.

`crates/null3d-shaders/src/textures.rs` rewrites each declaration into a `texture_2d_array<f32>` binding in a map slot. A call of a texture array keeps the layer that the shader wrote, and the build wraps it in the same white-check as a 2D texture's call, so the white rule holds without a second code path.

The first picture run of the image test failed on the WebGL2 tiers: `textureGather` has no form in GLSL ES 3.00, so a custom material that gathers failed to link. The docs had listed it for both paths. The test draws its third plane with `textureSampleBias` instead, and the docs and the develop skill now say that gather draws on WebGPU alone.

Tests:

- `crates/null3d-shaders/src/textures.rs`: a unit test reads a declaration of `texture_2d_array<f32>` beside a 2D one, checks that each call keeps what the shader wrote, and checks the readiness wrapper and the bindings. Another checks that `textureNumLayers` of a 2D declaration names the fix.
- `crates/null3d-shaders/tests/material.rs`: a material with a texture array and an `i32` uniform builds into every variant; the built WGSL declares the array in group 1 and its sampled call takes the coordinates, the shader's layer and the level, and nothing the engine added.
- `crates/null3d-render/tests/custom_materials.rs`: both frame builders bind a texture of six layers in a custom material's slot and read layer 0 for it once its texels are on the GPU.
- The image test `custom-texture-array` draws a plane whose bands sample a layer each, a sphere that loads two layers in one surface function, and a plane that samples with a bias from a layer that its height picks, in every thread mode and on every GPU tier.

## Options

### A declaration of the texture array, with the texture's own layers

Chosen. The WGSL declares `var facades: texture_2d_array<f32>;`, the `textures` option gives a texture of `depth` layers, and every texture function takes the layer after the coordinates. The binding, the slot count, the uniform room and the white rule all stay as D-47 set them. The shader clamps or wraps its layer index itself; a layer outside the array reads an undefined texel without a device fault on either path, as any out-of-bounds texture access does.

### A list of separate textures that the engine packs into one binding

Rejected. The render store shares an array between textures of one size and format, so two textures of a list need not sit in one array, and each texture has its own sampler. Packing would need a copy into a new array, a rebuild of every material's bind group when a layer arrives, and one sampler for images that may ask for different filters.

### An option that names the layers, with the engine mapping indices

Rejected. Each array would take one number of the uniforms per layer, and a texture of 6 layers would leave the row with less room than six separate textures do today. The engine would also keep a table to remap the shader's index, for no gain over the texture's own layers.

### Raise the 6-texture limit

Not needed for this task and not measured: it would let 6 separate textures sample white-instead-of-missing beside each other, but it cannot let one binding serve a set of layers, and each slot costs a WebGL2 texture unit. D-47's room measurement stands.

## Consequences

- `docs/shaders/surface-functions.md`, `docs/guides/custom-shaders.md`, `docs/guides/custom-passes.md` and `docs/api/materials.md` describe the declaration, the layer the shader picks and the texture of several layers that the option takes.
- `skills/null3d-develop/references/shaders.md` gives the rule and an example.
- E1216's cause and fix name both declarations, and the error page is generated again.
- No engine API signature changes: `textures` takes a `Texture`, which may have several layers, and a slot that the WGSL declares as a 2D texture still refuses one.
