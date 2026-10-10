---
id: shaders/surface-functions
title: Surface functions
status: experimental
since: "0.1"
summary: "The surface record; uniforms and textures; reflections; transmission; vertex-offset functions; values per row of a batch."
---

# Surface functions

> Ships in null3D 0.1, with typed uniforms, textures and values per row of a batch in 0.2. The API is experimental, so it can still change between versions.

A surface function changes how a material's surface looks, and keeps the engine's lighting. You write it in WGSL. For each pixel, the engine gives it a `SurfaceInput`, and it returns a `Surface`: the base color, roughness, metalness, normal and light of that point. The engine then lights the surface with the scene's lights and shadows, as it lights a standard material. The function works on every GPU path, because the null3D Vite plugin builds it into the standard material's shader for WebGPU and WebGL2.

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

`materials.shader(options)` makes a custom material. Its `wgsl` option holds the WGSL. Its `uniforms` and `textures` options give the values of the WGSL's [uniforms](#uniforms) and [textures](#textures). Its other options are those of `materials.standard`, but the texture maps, which a custom material samples as textures of its own. [Materials](../api/materials.md) lists them.

- Write the WGSL in a template literal right after a `/* wgsl */` comment, or in a `.wgsl` file that your sketch imports. The plugin compiles it while Vite serves or builds the project. [Custom shaders](../guides/custom-shaders.md) says how.
- The WGSL declares `fn surface(input: SurfaceInput) -> Surface`, `fn vertexOffset(input: VertexInput) -> vec3f` ([vertex offsets](#vertex-offsets)), or both, and no `@vertex` or `@fragment` entry point. For a look that the engine's lighting cannot give, write a [full shader](../guides/custom-shaders.md#full-shaders) instead.
- `set()` changes the standard values, such as `color` and `roughness`, as it does for a standard material. The surface function sees them through `defaultSurface`.
- Materials made from the same WGSL share one shader. Make one material for each look, as you do for standard materials.
- A mesh needs texture coordinates to draw with a custom material. The geometry generators give every mesh texture coordinates. For a mesh from `geometry.fromArrays`, pass `uvs`.

## The surface input

The engine fills a `SurfaceInput` for each pixel. Positions and directions are in world space, relative to the camera. The engine draws everything relative to the camera, so these values stay precise far from the origin of the world.

| Field | Type | What it holds |
| --- | --- | --- |
| `relativePosition` | `vec3f` | The position of the point, relative to the camera |
| `worldPosition` | `vec3f` | The position of the point in the world, with fewer digits far from the origin ([Built-in shader inputs](builtins.md#positions-relative-to-the-camera)) |
| `normal` | `vec3f` | The unit normal of the mesh, or of the triangle's face with `flatShading`. On the back face of a double-sided material, it faces the camera |
| `viewDirection` | `vec3f` | The unit direction from the point toward the camera |
| `vertexColor` | `vec4f` | The mesh's vertex color when the material has `vertexColors` and the mesh has colors, else white |
| `uv` | `vec2f` | The mesh's first texture coordinates |
| `frontFacing` | `bool` | True on the front face of a triangle |

## The surface

A `Surface` holds the values that the engine lights. Colors are linear, as the engine's lighting works in linear color.

| Field | Type | What it holds |
| --- | --- | --- |
| `baseColor` | `vec3f` | The base color: the color of diffuse light, and of a metal's reflections |
| `alpha` | `f32` | The opacity, from 0 to 1. With `alphaMode: 'mask'`, the point draws only where it reaches `alphaCutoff`, and with `alphaMode: 'blend'`, it blends with what lies behind |
| `metalness` | `f32` | 0 for a surface such as paint or plastic, and 1 for a metal |
| `roughness` | `f32` | The perceptual roughness: 0 is a mirror, and 1 is fully matte |
| `normal` | `vec3f` | The unit normal that lights the point, in world space |
| `emissive` | `vec3f` | Light that the point gives off itself, added after lighting |
| `occlusion` | `f32` | How much of the ambient light and the irradiance reaches the point, from 0 to 1 |
| `irradiance` | `vec3f` | Baked light that reaches the point, such as a light map's, added to the ambient light |
| `reflection` | `vec4f` | Light from the mirror direction in `rgb`, such as a reflection pass's color, and in `a` how much of it takes the place of the environment's reflection, from 0 to 1 ([Reflections](#reflections)) |
| `transmission` | `f32` | How much of the light behind the point passes through it, from 0 to 1, in a material that lets light through ([Transmission](#transmission)) |
| `thickness` | `f32` | The thickness of the volume under the point, in the mesh's own units, which bends the light that passes through |

`defaultSurface(input)` returns the surface that the material's own options make. The base color is `color` times the vertex color. `metalness`, `roughness` and the emissive light come from the options too. The normal is the input's normal, the occlusion is 1, and the irradiance and the reflection are zero. The transmission and the thickness are the material's. Start from it, and change only the fields that your look needs:

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
- The uniforms fit in 32 numbers, less one for each texture. Each `vec3f` and `vec4f` starts a group of four, and each `vec2f` starts at an even place, so order small fields after large ones to fit more.
- A field cannot have the name of a standard value, such as `color` or `roughness`, because `set()` takes those too.
- Each material made from the WGSL has its own values, so one WGSL serves many looks.
- In TypeScript, the `uniforms` option and `set()` take only the struct's names, each with a value of its kind. A wrong name fails the type check, as [Typed uniforms](../guides/custom-shaders.md#typed-uniforms) explains.

`set()` throws E1216 for a name that is not a uniform, and for a value of the wrong kind. The build stops at a field of another type, or at the first field past the 32 numbers.

## Textures

A custom material samples textures of your own, such as a matcap, a mask or a height map. Declare each one in the WGSL as a variable of type `texture_2d<f32>`, without `@group` or `@binding`. The engine binds it, and declares its sampler as the texture's name followed by `Sampler`. Then give the textures by name in the `textures` option:

```ts
// sketch.ts
const worn = /* wgsl */ `
var detail: texture_2d<f32>;
var wear: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= textureSample(detail, detailSampler, input.uv * 4.0).rgb;
    let worn = textureSample(wear, wearSampler, input.uv).r;
    s.roughness = mix(s.roughness, 0.25, worn);
    return s;
}
`;

// In the setup:
const detail = await assets.loadTexture('/textures/detail.ktx2', { colorSpace: 'srgb', wrap: 'repeat' });
const wear = await assets.loadTexture('/textures/wear.png', { colorSpace: 'linear' });
const metal = materials.shader({ wgsl: worn, color: '#b0b4b8', textures: { detail, wear } });
```

- Sample a texture with the WGSL texture functions: `textureSample`, `textureSampleLevel`, `textureSampleBias`, `textureSampleGrad`, `textureGather` and `textureLoad`. `textureDimensions` and `textureNumLevels` work too. Pass the texture straight to the function. The engine keeps each texture as a layer of a texture array, so it adds the layer to each such call. A texture cannot go to a function of your own, so sample it where you need it.
- A vertex offset samples textures too, with `textureSampleLevel` or `textureLoad`, as WGSL allows in a vertex shader. A height map then moves each vertex.
- Each texture's sampler takes the `wrap` and `filter` options of the texture. The `colorSpace` option says whether sampling turns sRGB colors into linear ones, as for the maps of a standard material.
- Until a texture's image is on the GPU, sampling it gives white: `vec4f(1.0)`. So does a texture that the WGSL declares and the `textures` option does not give. Multiply by a texture, and the material draws with its own values until the image arrives.
- A material samples up to 6 textures. Each texture takes one of the 32 numbers of the uniforms, so a material with 2 textures has 30 numbers for its uniforms.
- The textures are fixed when the material is created. Make a second material for another set of textures.
- A texture is 2D, with one layer: an image, a KTX2 file or data with a depth of 1. Data textures of `rgba16float` sample with filtering too.
- In TypeScript, the `textures` option takes only the names that the WGSL declares. A wrong name fails the type check.

`materials.shader` throws E1216 for a texture name that the WGSL does not declare, and for a value that is not a texture of one layer. The build stops at these problems:

- A texture of another type, or a texture with `@group` or `@binding`.
- A sampler that the WGSL declares itself.
- A seventh texture.
- A texture that does not go straight to a texture function.

Full shaders take no textures in this version.

## Reflections

A [reflection pass](../api/render.md#reflection-passes) draws the camera's view mirrored across a plane, such as water or a polished floor. A surface function reads its texture where the surface shows on the screen, and puts the color in the surface's `reflection`:

```wgsl
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    // A tilted normal moves the place where the surface reads the reflection.
    let uv = reflection_uv(clip, s.normal.xz * 0.05);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 1.0);
    return s;
}
```

Give the pass's texture to the material with `textures: { mirror: textures.fromPass(pass) }`.

- The engine lights `reflection.rgb` as the light that arrives from the mirror direction. It takes the place of that share of the environment's reflection. The material's Fresnel, metalness, specular values and roughness weigh it as they weigh the environment. Water then reflects little when you look straight down at it, and much at a low angle. A metal with roughness 0 is a perfect mirror.
- With `a` at 1, the reflection replaces the environment's reflection. Values between 0 and 1 mix the two. The environment's diffuse light stays.
- The reflection works with or without an environment.
- `reflection_uv(clip, offset)` gives the texture coordinates of the point whose clip position is `clip`. The texture holds the mirrored image, so the function turns the screen's x around. `offset` moves the place in texture coordinates. A ripple's tilt, such as `s.normal.xz * 0.05`, makes the reflection waver.
- Roughness does not blur the reflection, which keeps the pass's resolution. A reflection at a quarter of the render size looks soft.

## Transmission

A surface that lets light through shows what lies behind it, bent by its normal and its volume, as [Transmission](../api/materials.md#transmission) on the Materials page describes. A surface function sets how much light passes with the surface's `transmission`, and how deep the volume is with its `thickness`. Water whose ripples bend the stones on its bed only needs a normal:

```wgsl
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let slope = vec2f(cos(p.x * 3.1 + frame.time), cos(p.y * 4.7 + frame.time * 1.3)) * 0.1;
    s.normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    s.transmission = 1.0;
    return s;
}
```

```ts
const water = materials.shader({
  wgsl: rippled, ior: 1.33, roughness: 0.05, transmission: 1, thickness: 0.6,
  attenuationColor: '#6fc4b8', attenuationDistance: 1.2,
});
```

- Only WGSL that sets or reads the surface's `transmission` builds the shaders that let light through. The material also needs the `transmission` option at creation. Without the WGSL, the option throws E1217.
- The engine bends the light by the surface's normal, so ripples move what shows through.
- The light from behind takes the place of that share of the diffuse light, times the base color, and the reflections stay.

## Vertex offsets

A vertex offset moves each vertex of the mesh before the engine places the object in the world. You write `fn vertexOffset`, which returns how far to move the vertex, in the mesh's own space. The engine then applies the object's transform and instancing, and lights the moved surface:

```wgsl
struct Uniforms { height: f32, waves: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    let phase = input.uv.x * material.waves * 6.2831853;
    return vec3f(0.0, 0.0, sin(phase) * material.height);
}
```

The engine calls the function once for each vertex, with a `VertexInput`:

| Field | Type | What it holds |
| --- | --- | --- |
| `position` | `vec3f` | The vertex's position, in the mesh's own space |
| `normal` | `vec3f` | The vertex's unit normal, in the mesh's own space |
| `uv` | `vec2f` | The vertex's first texture coordinates |

- One WGSL can hold a vertex offset and a surface function. They share the uniforms, and functions of your own that both call.
- The engine keeps the mesh's normals, so a moved surface lights as the unmoved one did. Give the material `flatShading: true` to light each face by its moved position, or bend `s.normal` in a surface function.
- Culling tests the mesh's bounding sphere. Vertices that move out of it can make the object vanish at the edge of the view. Give the object a sphere that holds them with `setBounds(center, radius)`, at setup, as [Objects and transforms](../api/objects.md) describes.
- Shadows follow the moved vertices. The material's shadow casters run the vertex offset too, with the same `frame`, `object` and `material` values, so a swaying surface casts a swaying shadow. Such casters draw again in every frame that a shadow map draws, as moving objects do.

## Built-in values

Besides its inputs, a custom material reads the built-in values `frame`, `camera`, `object` and `material` anywhere in its WGSL. The sketch time, `frame.time`, animates a look. The origin of each object, `object.position`, gives each object its own look from one material. On the rows of an instance batch made with `values: true`, `object.values` holds the row's four numbers, such as a phase of the wind or a tint ([Instances and batching](../concepts/instances.md#per-row-values)). [Built-in shader inputs](builtins.md) lists every field.

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

- Do not declare a name that the engine declares. The build stops at your line when a name clashes. The engine's names are `SurfaceInput`, `Surface`, `VertexInput`, `defaultSurface`, `shade`, `light_surface`, `frame`, `camera`, `object`, `material`, `FrameValues`, `CameraValues`, `ObjectValues`, `fill_builtins`, `engine_frame`, `material_row`, `load_material_uniforms`, `custom_value`, `custom_texture_layers`, `load_custom_texture_layers`, `VertexIn`, `VertexOut`, `vs`, `fs` and `FLAT_SHADING`. They also include the library items that the standard material imports: `Material`, `InstanceIn`, `find_instance`, `clip_of`, `relative_position`, `world_normal`, `finish_exposed`, `fogged`, `fragment_color`, `material_of`, `PbrMaterial`, `pbr_material`, `with_specular`, `dfg_lut`, `direct_light`, `indirect_diffuse`, `multiscatter_compensation`, `clustered_light` and `sun_shadow`.
- Import library items by name, as in `#import null3d::noise::{fbm3}`. An import of a whole module reserves the module's name. After `#import null3d::color`, no name in the file can be `color`.
- The WGSL cannot hold directives such as `enable`.
- Do not declare a name that ends in `Sampler` after a texture's name, such as `detailSampler` beside `detail`. The engine declares it.
- Call `dpdx`, `dpdy`, `fwidth` and `textureSample` in uniform control flow, outside branches that differ between pixels. Chrome rejects the shader otherwise.

When the WGSL breaks a rule, the build stops with the file, line and column of the problem, as for any WGSL in your code.

## Related pages

- [Custom shaders](../guides/custom-shaders.md): WGSL in sketch code, and how the Vite plugin compiles it.
- [Built-in shader inputs](builtins.md): `frame`, `camera`, `object` and `material`.
- [Materials](../api/materials.md): `materials.shader` and the standard options.
- [Materials and pipelines](../concepts/materials.md): why materials share shaders.
- [Shader library and imports](library.md): the functions that a surface function can import.
- [Render graph API](../api/render.md#reflection-passes): reflection passes.
