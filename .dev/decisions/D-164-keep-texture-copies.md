# D-164: Textures keep their maps after the GPU is lost on phones and tablets

Status: decided. Date: 13 October 2026. Task: M2-R6.

Summary: After a GPU loss the engine uploads a texture's texels again where it still holds a copy. It now keeps a copy of each image and of each data texture after their upload on a phone and a tablet. Keeping the copies costs about one more copy of each image in memory. The `keepTextureCopies` option of `createEngine` turns that on or off on any device, and desktops free the copies as before.

## Question

A WebGPU device or a WebGL2 context can be lost, and the engine then starts a new device and redraws the scene. A texture from a KTX2 file comes back, because the engine loads its file again. A texture that maps an image from `loadTexture` or `textures.fromImageBitmap` draws without its map instead. So does one from `textures.fromData`. The engine freed its copy of their texels once the upload was done (#76). The owner ruled on 8 October 2026 at 14:34 that the engine keeps a CPU copy of each texture's image. It does so on phones and tablets only, with a setting to turn it off. How is that offered, and what does it cost?

## Rule

- Intent parity: a texture draws the same after a loss as before it, where the engine can afford the copy.
- Pay only for what you use: a desktop, which rarely loses its GPU and has room for no extra copies, frees them.
- The frame loop stays free of allocation: the store keeps a reference to texels it already holds. The frame that uploads them also does one less command.

## Data

**What the copy is.** For a texture from an image, it is the decoded image that the engine holds during its upload. For a texture from data, it is the store's own copy of those texels. So the change turns a peak that load already paid into a steady cost. Its size is the decoded size of each image, four bytes a texel before any mip level. A data texture adds its own bytes.

| Image | One copy |
| --- | --- |
| 512 x 512, as the two in the `texture-budget` image test | 1.0 MiB each |
| 1,024 x 1,024 | 4.0 MiB |
| 2,048 x 2,048 | 16.0 MiB (with a mip chain, 21.3 MiB) |

The two 512 x 512 PNG textures of the `texture-budget` image test hold 2.7 MiB on the GPU with their mip levels. Keeping their copies adds 2.0 MiB, so the cost is comparable to the GPU memory of the textures themselves. A texture from a KTX2 file keeps no such copy: its texels are the file's blocks, and the engine loads the file again instead ([D-69](D-69-texture-budget.md)).

How the data was produced: the worked sizes follow from the image sizes, which the `texture-budget` image test page sets on 2026-10-07 and [D-69](D-69-texture-budget.md) records. No new device run was needed, because the copy is the engine's own data, not a GPU figure.

## Decision

The texture store keeps each texture's texels after its upload while a `keep_copies` flag is set. A new GPU device then re-uploads them, exactly as it re-uploads an image whose upload had not finished. The flag is off by default in the core, and `createEngine` sets it from the device. It is on for a phone and a tablet, and off for a desktop, unless the page's `keepTextureCopies` option names a value. A phone or a tablet is the likeliest to lose its GPU, and its page is the one a user cannot reload at will. The copies are not GPU texels, so `quality.textureMemoryMiB` does not count them. They still count in the tab's memory, which is why a desktop frees them.

## Consequences

- `crates/null3d-render/src/textures.rs` holds the flag and re-uploads a kept source after a reset; a kept copy is released when the texture is destroyed or gets other texels.
- `texture_option::KEEP_COPIES` joins the texture store's options in `crates/null3d-wasm/src/constants.rs`, and `Textures.setKeepCopies` sets it.
- `keepTextureCopies` joins the `createEngine` options and `engine.mode`, with its default from `deviceKind`. [Page API](../../docs/api/engine.md#options), [Backends](../../docs/concepts/backends.md#when-the-gpu-goes-away) and [Textures](../../docs/api/textures.md#when-the-browser-takes-the-gpu-away) describe it.
- Unit tests cover both settings. A freed copy leaves the map off after a reset once the upload is done. A kept copy uploads again, and goes when its texture is destroyed.
