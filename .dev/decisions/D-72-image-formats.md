# D-72: WebP, AVIF and UASTC HDR in the loader, and the desktop Linux format guard

Status: decided. Date: 2026-10-05. Task: M2-A7.

## Question

Three choices in the texture loaders:

1. A glTF texture can name several images: a KTX2 image (`KHR_texture_basisu`), a WebP image (`EXT_texture_webp`), an AVIF image (`EXT_texture_avif`) and its own image, a fallback for other loaders. Which one does the engine take, and does it ship a decoder for browsers that lack one?
2. A KTX2 file of UASTC HDR data holds colors above 1. Which GPU format does it become on each device?
3. Mesa on desktop Linux offers ETC2 and ASTC on GPUs that lack them, and decodes such textures in software on the page's thread. three.js turns both families off when `navigator.platform` says Linux. How does the engine avoid them without reading the platform or the GPU's name (hard rule 14)?

## Rule

- No format adds code that every page downloads. A decoder that some browser lacks ships only if a browser that runs the engine lacks it.
- An HDR texture keeps its values above 1, filters on every path, and takes the least memory that does.
- The format choice reads the device's formats alone, never a GPU name or a user agent.

## Data

The test file `tests/pages/assets/textures/quarters-hdr.ktx2`: 64 x 64 texels of UASTC HDR 4x4, 7 mip levels, 707 bytes with Zstandard. GPU memory of the whole chain in each format, from the transcoder's own counts (`ktx2.test.ts`):

| Format | Bytes per texel | GPU bytes of the test file | Filters on | Needs |
| --- | --- | --- | --- | --- |
| `bc6h-rgb-ufloat` | 1 | 5,488 | Both paths | BC (`texture-compression-bc`, `EXT_texture_compression_bptc`) |
| `rgb9e5ufloat` | 4 | 21,844 | Both paths | Nothing |
| `rgba16float` | 8 | 43,688 | Both paths | Nothing |
| ASTC 4x4 HDR | 1 | 5,488 | Neither path: WebGPU has no ASTC HDR format | |

Browser support of the image formats, against the engine's minimum browsers: Chrome decodes AVIF from 85, Firefox from 93 and Safari from 16.4; WebP everywhere. The engine needs Safari 18 or later (D-64), so every browser that runs it decodes both.

The test pictures (`quadrants.*`, 64 x 64): PNG 510 bytes, WebP 122 bytes, AVIF 552 bytes. All three draw the same image in the `gltf-image-formats` image test.

The KTX2 page check (`tests/image/ktx2.spec.ts`) passed on the Mac's GPU on 2026-10-05, on WebGPU and on WebGL2, in every thread mode and with each `?compression=` family and none: the HDR file took `bc6h-rgb-ufloat` wherever the device reported BC, and `rgb9e5ufloat` elsewhere, with the GPU bytes that each format counts. The `ktx2-hdr` image test draws the file beside the same values as half floats made in code, and both formats draw the half floats' image.

Two cloud devices ran the KTX2 pages and the HDR and image format image tests on 2026-10-05, on 8a5b16ec3 (run 20261005-133629-checks). The iPad (10th generation, Safari 27.0) and the Galaxy S25 (Adreno 830, Chrome 149) each passed 12 of 12. The iPad has no BC formats: its HDR file became `rgb9e5ufloat`, ETC1S became ETC2 and UASTC became ASTC on both paths. The S25 reports BC, ETC2 and ASTC: its HDR file became BC6H on both paths. On WebGPU, ETC1S became ETC2 and UASTC became ASTC; on WebGL2, both became BC7.

## Decision

1. The loader takes the first image a texture names in this order: KTX2, WebP, AVIF, then the texture's own. This is three.js's `GLTFLoader` order, and WebP decodes faster than AVIF. The browser decodes WebP and AVIF with `createImageBitmap` in the glTF worker, as it decodes PNG and JPEG. No decoder ships. An image that does not decode fails with E1412, a model's image whose header claims too many pixels with E1416. The fallback image is never decoded, and never downloaded when the file names it by address.
2. UASTC HDR data becomes BC6H where the device has BC, on both paths, and `rgb9e5ufloat` elsewhere, at half the memory of half floats. A texture whose sides are not whole 4 x 4 blocks also takes `rgb9e5ufloat`. Both formats are new to flat textures: BC6H takes format code 21, and `rgb9e5ufloat`, which only cube maps took before, now makes texture arrays too. Neither can be drawn into or copied, so each texture of them has an array of its own and gets its texels from writes alone. The Basis 2.50 transcoder that the engine ships already reads UASTC HDR, so this adds no transcoder bytes. Basis writes these files with the Vulkan format of ASTC 4x4 HDR in their header, which the header reader accepts for UASTC HDR data alone.
3. On WebGL2, a device with BC takes BC7 for ETC1S and UASTC data, and BC6H for HDR data (M2-R17 built the first part). Mesa reports BC, ETC2 and ASTC together on desktop GPUs, so it never gets the emulated formats. A device whose WebGL2 has no BC, such as the iPad and most phones, keeps ASTC and ETC2. Some phones have BC: the Galaxy S25's Adreno 830 reports it, so it takes BC7 on WebGL2 and BC6H on both paths. WebGPU offers each family only where the GPU has it. A unit test gives the format choice a Mesa desktop's formats and checks that no ETC2 or ASTC format comes back.

## Consequences

- `scene/ktx2.ts` reads UASTC HDR, picks BC6H or `rgb9e5ufloat`, and counts their bytes in `ktx2TooLarge`. `scene/gltf-parse.ts` reads both image extensions. `scene/file-limits.ts` reads WebP and AVIF headers. The GPU layer has the new format code, and `format::writes_only` names the formats that take writes alone.
- A texture from an HDR file is always linear: `colorSpace: 'srgb'` throws E1208 in development builds, as it does for `rgba16float` data.
- A desktop Linux GPU without BC, older than the GPUs that WebGL2 needs in practice, could still get emulated ETC2. No device of the test lists has one.
- When M2-R18's on-demand loader rebuilds the transcoder, its byte comparison must also cover the `cTFBC6H` and `cTFRGB_9E5` targets of `quarters-hdr.ktx2`.
- Docs: `concepts/assets`, `api/assets`, `api/textures`. Skills: the develop skill's texture notes and the port skill's materials notes. Mapping: `tex-ktx2` and `gltf`.
