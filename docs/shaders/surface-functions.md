---
id: shaders/surface-functions
title: Surface functions
status: experimental
since: "0.1"
summary: "The surface record; vertex-offset functions; per-instance attributes."
---

# Surface functions

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Textures, vertex offsets, per-instance attributes and the built-in values `frame`, `camera` and `object` are not built yet. Coding agents must not use them in a surface function.

A surface function changes how a material's surface looks, and keeps the engine's lighting. You write it in WGSL. For each pixel, the engine gives it a `SurfaceInput`, and it returns a `Surface`: the base color, roughness, metalness, normal and light of that point. The engine then lights the surface with the scene's lights, as it lights a standard material. The function works on every GPU path, because the null3D Vite plugin builds it into the standard material's shader for WebGPU and WebGL2.

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

const stripes = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let stripe = step(0.5, fract(input.uv.x * 12.0));
    s.baseColor = mix(s.baseColor, vec3f(0.05), stripe);
    s.emissive += vec3f(1.0, 0.35, 0.05) * stripe;
    return s;
}
`;

export default defineSketch(({ scene, geometry, materials }) => {
  // A camera and lights, as on the Scene page, go here.
  const glowing = materials.shader({ wgsl: stripes, color: '#c0c4cc', roughness: 0.7 });
  scene.createMesh({ mesh: geometry.sphere(), material: glowing });
});
```

## Make a custom material

`materials.shader(options)` makes a custom material. Its `wgsl` option holds the WGSL, and its other options are those of `materials.standard`. [Materials](../api/materials.md) lists them.

- Write the WGSL in a template literal right after a `/* wgsl */` comment, or in a `.wgsl` file that your sketch imports. The plugin compiles it while Vite serves or builds the project. [Custom shaders](../guides/custom-shaders.md) says how.
- The WGSL declares `fn surface(input: SurfaceInput) -> Surface`, and no `@vertex` or `@fragment` entry point. WGSL with entry points is a whole shader, which custom materials do not take yet.
- `set()` changes the standard values, such as `color` and `roughness`, as it does for a standard material. The surface function sees them through `defaultSurface`.
- Materials made from the same WGSL share one shader. Make one material for each look, as you do for standard materials.
- A mesh needs texture coordinates to draw with a custom material. The geometry generators give every mesh texture coordinates. For a mesh from `geometry.fromArrays`, pass `uvs`.

## The surface input

The engine fills a `SurfaceInput` for each pixel. Positions and directions are in world space, relative to the camera. The engine draws everything relative to the camera, so these values stay precise far from the origin of the world.

| Field | Type | What it holds |
| --- | --- | --- |
| `relativePosition` | `vec3f` | The position of the point, relative to the camera |
| `normal` | `vec3f` | The unit normal of the mesh. On the back face of a double-sided material, it faces the camera |
| `viewDirection` | `vec3f` | The unit direction from the point toward the camera |
| `vertexColor` | `vec4f` | The mesh's vertex color when the material has `vertexColors` and the mesh has colors, else white |
| `uv` | `vec2f` | The mesh's first texture coordinates |
| `frontFacing` | `bool` | True on the front face of a triangle |

## The surface

A `Surface` holds the values that the engine lights. Colors are linear, as the engine's lighting works in linear color.

| Field | Type | What it holds |
| --- | --- | --- |
| `baseColor` | `vec3f` | The base color: the color of diffuse light, and of a metal's reflections |
| `alpha` | `f32` | The opacity, from 0 to 1. With `alphaMode: 'mask'`, the point draws only where it reaches `alphaCutoff`. This version blends no materials, so other alpha modes draw opaque |
| `metalness` | `f32` | 0 for a surface such as paint or plastic, and 1 for a metal |
| `roughness` | `f32` | The perceptual roughness: 0 is a mirror, and 1 is fully matte |
| `normal` | `vec3f` | The unit normal that lights the point, in world space |
| `emissive` | `vec3f` | Light that the point gives off itself, added after lighting |
| `occlusion` | `f32` | How much light from all directions reaches the point, from 0 to 1 |

`defaultSurface(input)` returns the surface that the material's own options make. The base color is `color` times the vertex color. `metalness`, `roughness` and the emissive light come from the options too. The normal is the mesh's normal, or the face's normal with `flatShading`. Start from it, and change only the fields that your look needs:

```wgsl
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // A darker, glossier surface toward the bottom of the texture.
    s.baseColor *= mix(0.3, 1.0, input.uv.y);
    s.roughness = mix(0.2, s.roughness, input.uv.y);
    return s;
}
```

To show a value while you work on a function, put it in the emissive light and make the base color black: `s.emissive = vec3f(value); s.baseColor = vec3f(0.0);`.

## Uniforms

Uniforms are values of your own that a surface function reads, and that `set()` changes at any time. Declare them once in the WGSL, as the fields of `struct Uniforms`, and read them from `material`:

```ts
// sketch.ts
const rings = /* wgsl */ `
struct Uniforms {
    tint: vec3f,
    width: f32,
    count: u32,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let t = fract(input.uv.y * f32(material.count));
    s.baseColor = mix(s.baseColor, material.tint, step(1.0 - material.width, t));
    return s;
}
`;

// In the setup:
const banded = materials.shader({
  wgsl: rings,
  roughness: 0.6,
  uniforms: { tint: '#ff6a00', width: 0.5, count: 4 },
});
// Later, from any frame: a cheap change.
banded.set({ count: 6, roughness: 0.3 });
```

- The `uniforms` option gives each uniform its first value. A uniform without one starts at 0.
- `set()` takes uniforms and standard values in one call. It changes only what you pass, and it checks every value before it changes any.
- A field can be an `f32`, an `i32` or a `u32`, which take a number, or a `vec2f`, `vec3f` or `vec4f`, which take an array of numbers. A `vec3f` also takes a color, as `color` takes it, and converts it from sRGB to linear. An `i32` or a `u32` holds whole numbers up to 16,777,216 in size.
- The uniforms fit in 32 numbers. Each `vec3f` and `vec4f` starts a group of four, and each `vec2f` starts at an even place, so order small fields after large ones to fit more.
- A field cannot have the name of a standard value, such as `color` or `roughness`, because `set()` takes those too.
- Each material made from the WGSL has its own values, so one WGSL serves many looks.

`set()` throws E1216 for a name that is not a uniform, and for a value of the wrong kind. The build stops at a field of another type, or at the first field past the 32 numbers.

## Library functions

A surface function can import the engine's [shader library](library.md), such as its noise and color functions. Import the items that you use by name:

```wgsl
#import null3d::noise::{fbm3}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let n = fbm3(input.relativePosition * 2.0, 4u) * 0.5 + 0.5;
    s.baseColor *= n;
    return s;
}
```

## Rules

Your WGSL shares one file with the engine's standard material, so a few rules apply besides the [WGSL rules for portable shaders](wgsl-rules.md):

- Do not declare the names that the engine declares: `SurfaceInput`, `Surface`, `defaultSurface`, `shade`, `light_surface`, `material`, `material_row`, `load_material_uniforms`, `custom_value`, `VertexIn`, `VertexOut`, `vs` and `fs`. The build stops at your line when a name clashes.
- Import library items by name, as in `#import null3d::noise::{fbm3}`. An import of a whole module reserves the module's name. After `#import null3d::color`, no name in the file can be `color`.
- The WGSL cannot hold directives such as `enable`.
- Call `dpdx`, `dpdy`, `fwidth` and `textureSample` in uniform control flow, outside branches that differ between pixels. Chrome rejects the shader otherwise.

When the WGSL breaks a rule, the build stops with the file, line and column of the problem, as for any WGSL in your code.

## Related pages

- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the Vite plugin compiles it.
- [Materials](../api/materials.md): `materials.shader` and the standard options.
- [Materials and pipelines](../concepts/materials.md): why materials share shaders.
- [Shader library and imports](library.md): the functions that a surface function can import.
