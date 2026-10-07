---
id: shaders/wgsl-rules
title: WGSL rules for portable shaders
status: experimental
since: "0.1"
summary: "The three shared language features; optional features; flat interpolation; no atomic compare-exchange; limits budget; rules the build cannot check."
---

# WGSL rules for portable shaders

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The engine draws custom materials with [surface functions](surface-functions.md) and [full shaders](../guides/custom-shaders.md#full-shaders). It draws no other shader of your own yet, so coding agents must not write one.

One WGSL shader runs on every null3D path: WebGPU, WebGPU's compatibility mode and WebGL2. For WebGL2, null3D's shader build translates it to GLSL ES 3.00. A shader can therefore use only what every path and every target browser supports.

The build checks the engine's own shaders against most rules on this page. It checks the WGSL that [the Vite plugin compiles](../guides/custom-shaders.md) from your code too. When a shader breaks one of these rules, the build fails and gives the file, line and column, with a fix. [Rules the build cannot check](#rules-the-build-cannot-check) lists the others, so test those on each path.

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

## Optional features

The build allows only what every WebGPU device supports. Each WGSL extension needs an optional WebGPU feature that some devices lack. The build therefore rejects an `enable` directive for any extension, such as `f16`, `subgroups`, `clip_distances`, `dual_source_blending` or `primitive_index`.

16-bit floats need the optional feature `shader-f16`. The build therefore rejects the `f16` type, the vector and matrix types that end in `h`, such as `vec3h`, and values such as `1.0h`. Write the math in `f32` types and values, such as `vec3f` and `1.0`.

## Code that WebGL2 cannot run

For WebGL2, the build rejects code that GLSL ES 3.00 cannot express, such as a storage buffer. The message names the pipeline and the shader stage.

The build also rejects a copy of an array out of a uniform buffer. Such a copy is an array, or a struct that holds one, read whole into a `let` or passed to a function. Some phone GPUs leave such a copy's arrays empty on WebGL2. Read one element at a time, such as `params.weights[i]`, or hold the vectors in named fields. The message names the function.

## Flat interpolation

Write flat interpolation as `@interpolate(flat, either)`, so that any vertex of a triangle can give the value. `@interpolate(flat)` means `flat, first`: the first vertex of each triangle gives the value. WebGL2 and WebGPU's compatibility mode cannot provide that, so the build rejects `@interpolate(flat)` and `@interpolate(flat, first)`.

## Atomic compare-exchange

The build rejects `atomicCompareExchangeWeak`. Safari 27.0 cannot compile a shader that calls it, on atomics in any address space, so the shader fails to load on every Apple device with that version. WebKit has fixed the fault, but no Safari release that has the fix is out yet.

To claim a slot, use `atomicLoad` and `atomicStore` between barriers: store your value into a free slot, call `workgroupBarrier()`, and then read which value the slot holds. `atomicExchange`, `atomicMin` and `atomicMax` also compile on every target browser.

## Directives

WGSL directives, such as `requires` and `diagnostic`, go on the first lines of a file, above every `#import` line. The build reads directives only from the top of a file, so it rejects a directive below other code.

## Rules the build cannot check

The build does not check these rules, so test your shaders on each path. [Choosing a tier for testing](../concepts/backends.md#choosing-a-tier-for-testing) shows how to force each one.

### Limits

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

### 32-bit float textures

Read 32-bit float textures, such as `r32float` and `rgba32float`, without filtering: use `textureLoad`. A filtering sampler on such a texture needs the optional WebGPU feature `float32-filterable`, and some devices lack it, such as iPads. For float data that you filter, use a 16-bit float texture. A WGSL texture type does not say how many bits each texel has, so the build cannot check this rule.

### Sampling in branches

`textureSample` chooses a mip level from the texture coordinates of neighboring pixels. It must therefore run where every pixel of a triangle takes the same path. The same holds for `textureSampleBias`, `textureSampleCompare`, and derivatives such as `dpdx` and `fwidth`.

In a branch that depends on a value that differs between pixels, sample before the branch, or use `textureSampleLevel` with a mip level. Chrome rejects a shader that breaks this rule when the engine creates it on WebGPU. On WebGL2, the sample gives an undefined value there. The shader translator that the build uses does not check this rule.

```wgsl
// Chrome rejects this: the branch depends on the pixel's position.
if in.uv.x > 0.5 {
    color = textureSample(pattern, patternSampler, in.uv);
}

// This runs everywhere.
let sampled = textureSample(pattern, patternSampler, in.uv);
if in.uv.x > 0.5 {
    color = sampled;
}
```

### The remainder operator

WGSL's `%` on floats keeps the sign of the left value, as in C: `-1.5 % 1.0` is `-0.5`. GLSL's `mod` gives `0.5` there. When you port GLSL, write `mod(x, y)` as `x - y * floor(x / y)`. The build keeps WGSL's meaning in the GLSL that it writes for WebGL2.

On integers, give `%` values of zero or more, or use `u32`. GLSL ES 3.00 leaves the result undefined when a value is negative, so WebGL2 can give another result than WebGPU.

## Related pages

- [GPU tiers and backends](../concepts/backends.md): the three paths and the capability flags.
- [Shader library and imports](library.md): the engine's modules that a shader can import.
- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the build reports its errors.
