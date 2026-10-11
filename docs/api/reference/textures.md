---
id: api/reference/textures
title: "Textures: API reference"
status: generated
since: "0.1"
summary: "Every export of the Textures API, from the engine's doc comments."
---

# Textures: API reference

> [Textures](../textures.md) explains these exports. The engine's doc comments make this page.

## `CompressedTextureFormat`

```ts
type CompressedTextureFormat =
	| 'astc-4x4-unorm'
	| 'bc6h-rgb-ufloat'
	| 'bc7-rgba-unorm'
	| 'etc2-rgb8unorm'
	| 'etc2-rgba8unorm';
```

A compressed format, which stores blocks of 4 x 4 texels in a quarter or an eighth of the GPU memory of `rgba8unorm`. A texture from a KTX2 file takes the one that the device supports: `astc-4x4-unorm`, `bc7-rgba-unorm`, `etc2-rgb8unorm` without alpha or `etc2-rgba8unorm` with it. A KTX2 file of high dynamic range data becomes `bc6h-rgb-ufloat`, which holds three half floats per texel and no alpha, where the device has BC formats. The names are WebGPU's, and a texture's `colorSpace` says whether sampling decodes sRGB.

## `Texture`

Class `Texture`.

A texture: an image or data on the GPU, which materials sample. Its texels upload in the frames after the call that makes it, a band of rows per frame. A material draws with its color alone until they are on the GPU.

| Member | Description |
| --- | --- |
| `readonly depth: number` | Layers: 1, or more for a texture from data with a depth. |
| `readonly format: TextureFormat \| CompressedTextureFormat \| EnvironmentFormat` | How the texture stores its texels on the GPU. A texture from a KTX2 file has the compressed format that the device supports, or `rgba8unorm` where it supports none. |
| `readonly colorSpace: TextureColorSpace` | Whether sampling turns the texels from sRGB into linear values, or reads them as they are. |
| `readonly uvSet: 0 \| 1` | The set of texture coordinates that materials read the texture at. |
| `readonly width: number` | Texels in each row. An update with an image of another size changes it. |
| `readonly height: number` | Rows in each layer. An update with an image of another size changes it. |
| `readonly bytes: number` | The GPU bytes of the texture: its layers, with every mip level that the GPU holds. A texture whose largest levels the memory budget dropped takes less. |
| `readonly droppedLevels: number` | The largest mip levels that the GPU does not hold, which the texture memory budget dropped: 0 to 3. `width` and `height` stay the texture's own size. |
| `update(source: ImageBitmap \| TextureDataArray): void` | Gives the texture new texels, which upload in their turn. An image may have another size, and the texture then takes that size; the image moves to the thread that draws, so this thread can use it no more. Data must fit the texture's size and format. Until the new texels are on the GPU, materials draw with their colors alone. A texture from a KTX2 file takes no updates, and throws E1208: load the file again. |
| `destroy(): void` | Frees the texture's GPU memory. Materials that map it draw with their colors alone. Calls on the texture after this throw E1101. |

## `TextureColorSpace`

```ts
type TextureColorSpace = 'srgb' | 'linear';
```

`srgb` for colors, which sampling turns into linear values, or `linear` for data such as normals, roughness and metalness, which sampling reads as they are.

## `TextureData`

Interface `TextureData`, which extends `TextureOptions`.

A texture's size and texels for `textures.fromData`, with its options.

| Member | Description |
| --- | --- |
| `width: number` | Texels in each row, from 1 up to `textures.maxSize`. |
| `height: number` | Rows in each layer, from 1 up to `textures.maxSize`. |
| `depth?: number` | Layers, from 1 to 256. The default is 1. |
| `format?: TextureFormat` | The default is `rgba8unorm`. |
| `data: TextureDataArray` | Four numbers per texel, in rows from the first to the last, layer after layer. The first row is at v = 0, the bottom of a plane. |

## `TextureDataArray`

```ts
type TextureDataArray = Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array;
```

Texel data: bytes for `rgba8unorm`, and for `rgba16float` either half floats as 16-bit words or 32-bit floats, which the engine turns into half floats. A 32-bit float outside the half float range of -65,504 to 65,504 takes the nearer end of it, because an infinite texel would draw black.

## `TextureFilter`

```ts
type TextureFilter = 'linear' | 'nearest';
```

How texels are read between their centers and between mip levels: blended (`linear`), or the nearest one (`nearest`), which keeps pixel art sharp.

## `TextureFormat`

```ts
type TextureFormat = 'rgba8unorm' | 'rgba16float';
```

How a texture stores its texels on the GPU: `rgba8unorm`, four 8-bit channels, or `rgba16float`, four 16-bit floats for values outside 0 to 1.

## `TextureOptions`

Interface `TextureOptions`.

How a texture stores and samples its texels. Every call that makes a texture takes them.

| Member | Description |
| --- | --- |
| `colorSpace?: TextureColorSpace` | `srgb` for color maps, such as a base color, and `linear` for data maps, such as normal, roughness, metalness and occlusion maps. The default is `srgb` for images and `linear` for data. |
| `wrap?: TextureWrap \| readonly [TextureWrap, TextureWrap]` | Along u, then v, or one value for both. The default is `clamp`, as in three.js. |
| `filter?: TextureFilter` | The filter of magnified and minified texels and between mip levels. The default is `linear`. |
| `mipmaps?: boolean` | True to make mip levels on the GPU after each upload, so the texture does not shimmer where it covers few pixels. The default is true for images and false for data. `rgba16float` textures have no mip levels. |
| `anisotropy?: number` | Samples along the direction of steepest change, a whole number from 1 to 16, which keeps a texture sharp on a surface seen at a slant. The quality preset caps it, and a `nearest` filter turns it off. The default is 1, which is off. |
| `uvSet?: 0 \| 1` | The set of texture coordinates that materials read the texture at: 0 for the first, 1 for the second, as three.js's `texture.channel`. The default is 0. |

## `Textures`

Class `Textures`.

Makes textures from decoded images and from data, and reads what the GPU holds. A sketch finds it as `ctx.textures`. `ctx.assets.loadTexture` loads and decodes image files into textures.

| Member | Description |
| --- | --- |
| `fromPass(pass: RenderPass): Texture` | The texture that a render pass draws into, which materials and sprites take as a map, as three.js's render target textures are. It holds linear color, after the exposure and before the tone curve: high dynamic range color where the device draws it. The image stands upright on a plane, with v = 0 at its bottom row. It samples as no texture until the pass first draws, and keeps the last image while the pass is switched off. `render.removePass` destroys it. Throws E1101 for a pass that was removed. |
| `fromImageBitmap(image: ImageBitmap, options: TextureOptions = {}): Texture` | A texture from a decoded image. The image's first row goes to v = 0, the bottom of a plane. Decode images with `imageOrientation: 'flipY'`, as `assets.loadImageBitmap` does by default, so that they stand upright as three.js shows them. The image moves to the thread that draws, so this thread can use it no more. Throws E1208 for an image without pixels, one larger than `maxSize`, and options the engine does not know. |
| `fromData(texture: TextureData): Texture` | A texture from data: four numbers per texel, in rows from the bottom up, layer after layer. A texture of several layers is a texture array of its own. Throws E1208 when the data does not fit the size and format, and for options the engine does not know. |
| `readonly memoryBytes: number` | The GPU bytes that every texture holds, with the free layers of their texture arrays. It counts what the GPU holds already, so it grows as uploads finish. |
| `readonly maxSize: number` | The widest and tallest texture this device takes: 4096 texels, or less on a WebGL2 device that allows less. |

## `TextureWrap`

```ts
type TextureWrap = 'clamp' | 'repeat' | 'mirror';
```

What texture coordinates outside 0 to 1 read. `clamp` reads the texel at the edge, `repeat` repeats the texture, and `mirror` repeats it with every other copy mirrored.
