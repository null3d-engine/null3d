---
id: shaders/wgsl-rules
title: WGSL rules for portable shaders
status: experimental
since: "0.1"
summary: "The three shared language features; limits budget; flat interpolation; what the build rejects."
---

# WGSL rules for portable shaders

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Custom shaders in sketch code are not built yet, so coding agents must not write them.

One WGSL shader runs on every null3D path: WebGPU, WebGPU's compatibility mode and WebGL2. For WebGL2, null3D's shader build translates it to GLSL ES 3.00. A shader can therefore use only what every path and every target browser supports. The build checks each shader against the rules on this page. When a shader breaks a rule, the build fails and gives the file, line and column, with a fix.

## Language features

WGSL language features are additions to the language, such as assignment to part of a vector. Each browser reports the features it supports, and the lists differ. null3D shaders may use only the three features that Chrome, Safari and Firefox all report:

- `packed_4x8_integer_dot_product`
- `pointer_composite_access`
- `readonly_and_readwrite_storage_textures`

A shader can use a feature without a `requires` directive, so the build looks for the code that each other feature allows. It rejects this code:

| Feature | What the build rejects | What to write instead |
| --- | --- | --- |
| `swizzle_assignment` | An assignment to a swizzle, such as `color.rgb *= 2.0;` | Assign each component on its own, or assign the whole vector |
| `texture_and_sampler_let` | A `let` that holds a texture or a sampler | Use the texture or sampler variable directly |
| `unrestricted_pointer_parameters` | A pointer parameter into the `storage`, `uniform` or `workgroup` address space, and a pointer to part of a variable as an argument | Pass a pointer to a whole `function` or `private` variable, or use the global variable directly |
| `uniform_buffer_standard_layout` | A uniform buffer that breaks the uniform layout rules, such as one that holds an `array<f32, 4>` | Give arrays a 16-byte stride, such as `array<vec4f, 4>`, and align nested structs to 16 bytes |
| `immediate_address_space` | `var<immediate>` | A uniform buffer |
| `linear_indexing` | `@builtin(global_invocation_index)` and `@builtin(workgroup_index)` | Compute the index from `global_invocation_id` or `workgroup_id` and the workgroup size |
| `subgroup_id` | `@builtin(subgroup_id)` and `@builtin(num_subgroups)` | Code that does not need subgroups, which are optional in WebGPU |
| `fragment_depth` | A depth mode in `@builtin(frag_depth, ...)` | `@builtin(frag_depth)` without a depth mode |
| `buffer_view` | The `buffer` type, and `bufferView`, `bufferArrayView` and `bufferLength` | Declare each variable with the type it holds |
| `texture_formats_tier1` | A storage texture in a newer texel format, such as `r8unorm` or `rg16float` | A core storage texel format, such as `rgba8unorm`, `rgba16float`, `r32float` or `rgba32float` |
| `atomic_vec2u_min_max` | `atomicStoreMin` and `atomicStoreMax` | 32-bit atomics, such as `atomicMin` on `atomic<u32>` |

A `requires` directive that names any feature outside the three also fails the build.

## Other code the build rejects

- The build allows only what every WebGPU device supports. It rejects code that needs an optional feature, such as the `f16` type or `enable subgroups;`.
- For WebGL2, the build rejects code that GLSL ES 3.00 cannot express, such as a storage buffer. The message names the pipeline and the shader stage.

## Flat interpolation

Write flat interpolation as `@interpolate(flat, either)`, so that any vertex of a triangle can give the value. `@interpolate(flat)` means `flat, first`: the first vertex of each triangle gives the value. WebGL2 and WebGPU's compatibility mode cannot provide that, so the build rejects `@interpolate(flat)` and `@interpolate(flat, first)`.

## Limits

A shader stays within WebGPU's default limits, and within the lower limits of compatibility mode. [The portable budget](../concepts/backends.md#the-portable-budget) gives the engine's limits for bind groups, buffers and textures. The budget for shaders is:

| Limit | Budget |
| --- | --- |
| Vertex attributes | 16, with `vertex_index` and `instance_index` counted |
| Values that the vertex stage passes to the fragment stage | 15 |
| Sampled textures in a stage | 16 |
| Samplers in a stage | 16 |
| Uniform buffers in a stage | 12 |
| Storage buffers in a stage | 8, but 4 in the fragment stage and none in the vertex stage |
| Storage textures in a stage | 4, and none in the vertex stage |
| Compute workgroup size | 128 invocations in all: at most 128 in x and in y, and 64 in z |
| Workgroup memory | 16 KB |

The build does not check these limits, so test on each path. [Choosing a tier for testing](../concepts/backends.md#choosing-a-tier-for-testing) shows how to force each one.

## Directives

WGSL directives, such as `enable`, `requires` and `diagnostic`, go on the first lines of a file, above every `#import` line. The build reads directives only from the top of a file, so it rejects a directive below other code.

## Related pages

- [GPU tiers and backends](../concepts/backends.md): the three paths and the capability flags.
- [Shader library and imports](library.md): the engine's modules that a shader can import.
- [Custom shaders](../guides/custom-shaders.md): surface functions and full shaders.
