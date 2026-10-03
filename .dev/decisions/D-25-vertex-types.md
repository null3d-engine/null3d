# D-25: Vertex attribute types, and plain integers on WebGPU

Status: decided. Date: 2026-10-03. Task: M2-A1.

## Question

Meshes from glTF files often keep their vertices in 8-bit and 16-bit integers, as the `KHR_mesh_quantization` extension allows. Which types does each vertex attribute take, and how does a vertex format record them? And how do shaders read plain integers, which glTF reads as whole numbers, on WebGPU, which has no vertex format that reads them so?

## Rule

- Take every type that glTF allows for an attribute, and no other, so a file loads without a conversion.
- A mesh keeps its integers on the GPU: no type grows on its way there, on either path.
- The engine's prebuilt shaders stay one set (D-13): no new permutation bit, and no shader variant for each type.
- An integer mesh draws its float twin's image within one step of 255, on all three tiers.

## Options for plain integers on WebGPU

WebGPU reads unsigned 8-bit and 16-bit integers into a float input only as normalized fractions (`unorm8x4`, `unorm16x4` and the signed `snorm` ones). Its `uint` and `sint` formats need an integer input in the shader. Metal lacks the "scaled" formats that read whole numbers as floats, so WebGPU left them out. WebGL2 has them: `vertexAttribPointer` with `normalized` false reads an integer as its whole value.

| Option | Memory on WebGPU | Shader cost | Code |
| --- | --- | --- | --- |
| (a) Convert plain integers to floats on WebGPU only, as some engines do | Positions and coordinates grow back to floats | None | A second layout for each mesh on WebGPU |
| (b) A shader variant for each kind of input: float, unsigned or signed integer | Kept | Up to 3 x 3 x 3 = 27 variants of each template that reads positions and both coordinate sets | D-13's budget |
| (c) Fold the scale into the object's matrix | Kept for positions | None | Every object's matrix and bounds need the mesh's factor; texture coordinates are not covered |
| (d) Read plain integers as their normalized twins, and multiply them back in the vertex shader by a pipeline constant | Kept | One multiply, which the compiler drops for floats, as the constant is then 1 | One constant for each of three attributes |

three.js builds each shader for its geometry, so its WebGPU renderer can declare an integer input where a geometry has one. null3D ships prebuilt shaders, so it cannot.

## Data

| Measure | Value | Where |
| --- | --- | --- |
| Bytes per vertex, float position, normal and coordinates | 32 | `vertex::stride` |
| The same with 16-bit plain positions, 8-bit normals and 16-bit coordinates | 16 | Rust test `a_quantized_mesh_uploads_half_the_vertex_bytes_of_its_float_twin_on_both_paths` |
| Upload of a grid of 4,225 vertices, floats against integers | 135,200 against 67,600 bytes, on both paths | the same test |
| The image test `vertex-types` against its float twin, Chrome on the Mac's GPU, WebGPU, compatibility mode and WebGL2 | No pixel differs, at a threshold of 0 | `bun run test:images -g vertex-types`, 2026-10-03 |
| The same with SwiftShader, the software GPU of CI | 0 of 129,600 pixels differ, on each tier | `CI=1 bun run test:images -g vertex-types`, 2026-10-03 |
| The same test with the WebGPU constants left out | 7.3% of the pixels differ, and the test fails | a run with the constants removed |
| The engine's JavaScript of a pipelined page, after Brotli | 84.9 KB before, 86.8 KB after. The checks and copies of typed arrays take about 1 KB, and the type tables of both GPU paths about 0.5 KB | `bun run build:check-size` against main, 2026-10-03 |
| The core's WebAssembly, after Brotli | 148.2 KB before, 150.2 KB after (+1.4%) | the same run |

## Decision

Option (d). Each pipeline already serves one vertex format, so a pipeline constant fits it. The shader library's `null3d::vertex` declares three constants, `position_scale`, `uv_scale` and `second_uv_scale`, whose ids are 1000 plus their attribute's location. Its functions `mesh_position`, `mesh_uv` and `mesh_second_uv` multiply by them, and every engine template that reads those attributes calls them. On WebGPU the engine sets a constant to the type's largest value for a plain integer attribute, and only where the shader module declares it. The GLSL build gives each constant its default of 1, since WebGL2 reads plain integers as whole numbers itself.

The types each attribute takes follow glTF:

| Attribute | Types |
| --- | --- |
| Position, first and second texture coordinates | Floats, and 8-bit and 16-bit integers, signed or unsigned, normalized or plain |
| Normal, tangent | Floats, normalized signed 8-bit and 16-bit integers |
| Color, joint weights | Floats, normalized unsigned 8-bit and 16-bit integers |
| Joints | Plain unsigned 8-bit and 16-bit integers, which shaders read as whole numbers |

A format keeps the six bits that say which optional attributes a vertex has. Above them, each attribute has a type field that holds the place of its type in its own list. Each list starts with the default type, so a format of floats keeps the number it had before types existed. The fields fit in 27 bits. Every attribute takes whole 4-byte words, as glTF lays them out. The GPU reads the whole slot, padding included, so three 16-bit values read as `unorm16x4`. WebGPU has no three-component 8-bit or 16-bit formats. ANGLE on Direct3D converts such formats on the CPU. glTF files already hold this padding, so whole words take no more memory than the file does, and they avoid both problems.

On WebGL2, joints go through `vertexAttribIPointer` and every other integer through `vertexAttribPointer`, normalized or not. The `vertex-types` test reads both kinds on every tier.

## Consequences

- On WebGPU, the most negative plain signed value reads one step high: -128 reads as -127, and -32768 as -32767. A normalized read clamps at -1. glTF exporters write plain positions as unsigned integers, so files rarely hold it.
- A custom full shader reads raw attributes. It passes positions and texture coordinates through the `mesh_` functions to draw plain integer meshes the same on both paths. The custom shaders guide and the develop skill say so.
- Formats now split buckets and pipelines by type, as they split them by attribute.
- The GPU skinning tasks read joints at location 6 and weights at location 7, which the formats already place.
