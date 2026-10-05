# D-63: Specular and index of refraction in the standard material

Status: decided. Date: 2026-10-05. Task: M2-J5.

## Question

glTF's `KHR_materials_specular` and `KHR_materials_ior` change how strongly a non-metal reflects light. Under [D-52](D-52-intent-parity.md), materials are strict: a file must draw as its author meant, with three.js as the reference. The extensions give five values: an index of refraction, a specular intensity and color, and their two maps. How does the standard material take them with no new lighting lobe, and where do they live in the material table?

## Rule

- Both extensions draw like three.js's `GLTFLoader` and `MeshPhysicalMaterial`, by three.js's image rule, on all three GPU tiers and on both GPU sets.
- A material without them draws exactly as before: the same bits, not only the same image within a tolerance.
- No new lobe, no new shader variant, and the material table grows as little as it can.

## What three.js does

`GLTFLoader` (r186) makes a `MeshPhysicalMaterial` when a material has either extension:

| glTF | three.js |
| --- | --- |
| `KHR_materials_ior.ior`, default 1.5 | `ior`. An `ior` of 0, which the extension allows, becomes 1000 (three.js issue 26167) |
| `specularFactor`, default 1 | `specularIntensity` |
| `specularTexture` (alpha) | `specularIntensityMap`, linear |
| `specularColorFactor`, default white, linear, may exceed 1 | `specularColor` |
| `specularColorTexture` (RGB) | `specularColorMap`, sRGB |

Its shader (`lights_physical_fragment`) then sets, for the existing BRDF:

- the dielectric reflectance at normal incidence, `F0 = min(((ior - 1) / (ior + 1))^2 * specularColor * colorMap.rgb, 1) * specularIntensity * intensityMap.a`;
- the reflectance at grazing angles, `F90 = mix(specularIntensity * intensityMap.a, 1, metalness)`;
- and the blended reflectance, `mix(F0, baseColor, metalness)`.

Every later term already takes `F0`, `F90` and the blended value. These terms are the direct GGX lobe, the diffuse weight `1 - F`, the environment's multiple scattering and its energy compensation. With the defaults, `F0` is 0.04 and `F90` is 1, which is what `MeshStandardMaterial` uses. So a physical material with no other feature draws as a standard one.

## Data

### Parity with three.js

Two scenes make their files in code, as small equivalents of the Khronos test models: `specularBuilder` and `iorBuilder` in `tests/pages/lib/gltf-files.ts`. SpecularTest (223 KB, CC BY 4.0) shows its spheres only through the reflection of an environment map. IORTestGrid (2.6 MB) needs transmission and volume, which the engine does not read yet. The equivalents keep the rows and values of the originals. A directional light and a point light behind the grid light them, so the reflection shows head on and at grazing angles:

- `gltf-specular`: the specular factor, and the same values in a texture's alpha whose purple color must not show. Then gray and yellow color factors and textures, and color factors up to 25.
- `gltf-ior`: indices of 1, 1.25, 1.5, 2, 3 and 0, at three roughnesses, half metal with a specular factor and color, and a color of 2.

Pixels that differ, by three.js's rule, on 5 October 2026. The first rows come from `bun run parity` in Chrome on the Mac's GPU, and the SwiftShader rows from the parity test of `bun run test:bench`:

| Scene | WebGPU | Compatibility | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| `gltf-specular` | 0.040% | 0.043% | 0.004% | 0.087% |
| `gltf-ior` | 0.008% | 0.006% | 0.008% | 0.059% |
| `gltf-specular`, SwiftShader | 0.039% | 0.043% | 0.003% | 0.087% |
| `gltf-ior`, SwiftShader | 0.008% | 0.007% | 0.009% | 0.061% |
| `gltf-specular`, loader ignoring both extensions | 0.523% | | | |
| `gltf-ior`, loader ignoring both extensions | 1.781% | | | |

The last two rows show that the scenes catch a loader or shader that drops the values.

### Files without the extensions

With the defaults, the shader computes `min(0.04 * 1, 1) * 1` and `1 + (1 - 1) * metalness`. These give 0.04 and 1 exactly, and the blend takes the same inputs as before. The CPU writes `((1.5 - 1) / (1.5 + 1))^2` in doubles, which rounds to the same 32-bit float as 0.04. On the Mac's GPU, the image tests of every glTF model drew their references unchanged. So did the standard material scenes, custom materials, textures, sprites, lines, shadows and ambient occlusion.

## Decision

### The material row

The row grows from eight `vec4f` to nine (128 to 144 bytes):

| Floats | Before | After |
| --- | --- | --- |
| 19 (`uv_u.w`) | Spare | The reflectance `((ior - 1) / (ior + 1))^2`, which TypeScript computes when `ior` is set |
| 30, 31 (`more_maps.zw`) | Spare | The layers of the specular intensity and specular color maps |
| 32 to 34 (`specular.xyz`) | | The specular color, linear, which may exceed 1 |
| 35 (`specular.w`) | | The specular intensity |

The row held four spare floats, and the values and layers take seven, so one more `vec4f` is the least growth. The row stores the reflectance, not the index. So the CPU computes it once, in doubles, where three.js's shader does a division and a square for each pixel. The rows of custom values keep 32 floats for uniforms, as [D-47](D-47-custom-material-textures.md) decided. They have the row's width, and the last four floats stay unused. 1,024 materials take 16 KB more on the GPU.

### The maps

The standard material's map slots grow from six to eight, so the map bind group has eight texture arrays and eight samplers. The maps are fixed when a material is created, as the others are. They need no shader variant, because each samples behind a check of its layer.

WebGPU allows 16 sampled textures and 16 samplers per stage by default. The fragment stage of the maps build now sees 12 textures and 9 samplers, and the vertex stage of a custom material 9 textures.

WebGL2 needed a change. Each texture's binding slot was its texture unit, and the eight maps with the environment map's planned slots would have reached unit 32. Each program now numbers its own textures from unit 0, as the [implementation notes](../implementation-notes.md#textures-on-both-gpu-paths) describe. The busiest stage read 15 of the 16 units that WebGL2 guarantees to a stage, and 16 once the environment map landed. A unit test fails above 16.

### The shader

`null3d::lighting` gains `with_specular(m, reflectance, color, intensity)`, which sets a `PbrMaterial`'s `specular`, `specular_blended` and `specular_grazing` with three.js's formulas. The standard material's `shade` and the lit lines call it on every material. The maps build multiplies the values by the two maps' texels first. The values are not fields of the surface record of custom materials. So a custom material takes them from its standard values, and cannot change them per pixel yet.

`F90` is written `intensity + (1 - intensity) * metalness`, not with `mix`. GPUs may evaluate `mix(a, b, t)` as `a * (1 - t) + b * t`, which does not give exactly 1 when both ends are 1. Written this way, the default gives 1 bit for bit.

### Rejected options

| Option | Why not |
| --- | --- |
| Fold the index into the specular color on the CPU | `set({ ior })` alone would need the last color, and the clamp at 1 comes before the intensity, so the fold would also need the clamp on the CPU, which the maps then break |
| One specular map slot for both maps | The intensity map is linear and the color map sRGB, so they sit in arrays of different formats. A file whose two maps differ in size or format could not draw |
| Specular fields in the surface record | Custom WGSL that builds a surface without `defaultSurface` would get an intensity of 0 and lose all reflection. The surface record can gain them when a port needs per-pixel values |
| A shader variant for the specular maps | Doubles the maps builds for two texture reads that run behind a layer check |

## Consequences

- `crates/null3d-render/src/materials.rs` has `param::REFLECTANCE`, `SPECULAR_COLOR` and `SPECULAR_INTENSITY`, `MapSlot::SpecularIntensity` and `SpecularColor`, and `CUSTOM_FLOATS`. `sizes::MATERIAL_BYTES` is 144 and `sizes::MAP_SLOTS` is 8.
- `materials.standard` takes `ior`, `specularIntensity`, `specularColor`, `specularIntensityMap` and `specularColorMap`, with three.js's names and ranges. `set` throws E1108 for an `ior` below 1.
- The glTF parser reads both extensions, and refuses values outside their ranges with E1416.
- The docs pages `api/materials`, `api/assets` and `concepts/assets`, the mapping entries `mat-physical` and `mat-specular-ior`, and both skills describe the values.
- Clearcoat and sheen come later, in shader files that load on first use. They add lobes, which this record does not.
