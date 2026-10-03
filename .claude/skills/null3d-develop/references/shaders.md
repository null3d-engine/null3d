# Custom shaders in null3D

All engine shaders are WGSL. The build translates them to GLSL for the WebGL2 path, so one source serves both backends. The null3D Vite plugin compiles the WGSL in your code: `.wgsl` files that you import, and template literals tagged `/* wgsl */`. The WebGL2 build sets the shader def `WEBGL2`. Engine docs: `guides/custom-shaders`, `shaders/surface-functions`, `shaders/builtins`, `shaders/wgsl-rules`, `shaders/library`.

Custom materials with surface functions, uniforms, vertex offsets, the built-in values and full shaders are built. Sections 1 to 5 and 8 to 10 apply now, apart from the parts marked (0.2). Do not ship code that uses those until their docs pages say they are built.

## Contents

1. Choose the kind of shader
2. Surface functions
3. Built-in values
4. Uniforms, textures and per-instance data
5. Vertex offsets and full shaders
6. Custom post effects (0.2)
7. Custom passes (0.2)
8. Portable WGSL rules
9. Imports from the shader library
10. Debugging shaders

## 1. Choose the kind of shader

| Goal | Kind | Keeps lights, shadows, fog and instancing |
| --- | --- | --- |
| Change how a surface looks (color, roughness, patterns, dissolve, water) | Surface function | Yes |
| Move vertices (waves, wind, swelling) | Vertex offset, alone or with a surface function | Yes (shadows use the unmoved vertices) |
| Something the lighting model cannot express (holograms, custom lighting) | Full shader | No: you write everything |
| A full-screen image effect | Post effect (section 6) | Not applicable |
| An extra render or compute step | Custom pass (section 7) | Not applicable |

Choose the first row that works. Surface functions keep working when the engine's lighting, shadows or backends change. The docs pages' status says what is built: `shaders/surface-functions`, `shaders/builtins`, `guides/custom-shaders`.

A custom material takes one `wgsl` option: WGSL that the Vite plugin compiled, from a template literal right after a `/* wgsl */` comment or from a `.wgsl` import. That one WGSL holds every function of the material (`fn surface`, and later `fn vertexOffset`), because the plugin compiles each literal on its own at build time. WGSL as plain text throws E1215.

## 2. Surface functions

The engine calls your function once per pixel and lights the result.

```wgsl
// Declared by the engine (do not declare these yourself):
struct SurfaceInput {
  relativePosition: vec3f, // position relative to the camera; always precise
  worldPosition: vec3f,    // absolute world position; fewer digits far from the origin
  normal: vec3f,           // unit normal, or the face's with flatShading; faces the camera on double-sided back faces
  viewDirection: vec3f,    // unit direction from the surface toward the camera
  vertexColor: vec4f,      // vertex color with vertexColors on a mesh that has colors, else (1, 1, 1, 1)
  uv: vec2f,               // first UV set; meshes need UVs to draw with a custom material
  frontFacing: bool,
};
struct Surface {
  baseColor: vec3f,        // linear RGB
  alpha: f32,              // with alphaMode: 'mask', pixels below alphaCutoff draw nothing
  metalness: f32,
  roughness: f32,          // perceptual roughness, as in glTF and three.js
  normal: vec3f,           // world space, unit length
  emissive: vec3f,         // linear RGB, added after lighting
  occlusion: f32,          // ambient occlusion, 0 to 1; darkens the ambient light and irradiance
  irradiance: vec3f,       // baked light added to the ambient light, zero by default
};
fn defaultSurface(input: SurfaceInput) -> Surface;  // the material's own options
```

Your function, with exactly this signature (the build rejects another):

```wgsl
fn surface(input: SurfaceInput) -> Surface {
  var s = defaultSurface(input);
  // change fields of s here
  return s;
}
```

`defaultSurface` applies the material's standard options: color times vertex color, metalness, roughness, emissive and flat shading. A surface function therefore adjusts a standard look instead of rebuilding it. `set()` changes those options at any time.

```ts
const stripes = materials.shader({
  color: '#c0c4cc', roughness: 0.7,
  wgsl: /* wgsl */ `
    #import null3d::math::{remap}

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let stripe = step(0.5, fract(input.uv.x * 12.0));
      s.baseColor = mix(s.baseColor, vec3f(0.05), stripe);
      s.emissive += vec3f(1.0, 0.35, 0.05) * stripe * remap(input.uv.y, 0.0, 1.0, 0.2, 1.0);
      return s;
    }`,
});
stripes.set({ roughness: 0.4 });
```

Materials from the same WGSL share one shader and its pipelines. Make one WGSL per look, and many materials from it.

`s.alpha` works with the material's `alphaMode`: `'mask'` draws nothing below `alphaCutoff`, and `'blend'` blends the surface over what lies behind it, in the transparent pass. `uv1`, `fragCoord` and `instance` in `SurfaceInput` come in 0.2.

Names: your WGSL shares a file with the engine's standard material. Do not declare a name that the standard material declares or imports. The build stops at your line with a redefinition error. The names are `SurfaceInput`, `Surface`, `VertexInput`, `defaultSurface`, `shade`, `light_surface`, `frame`, `camera`, `object`, `material`, `FrameValues`, `CameraValues`, `ObjectValues`, `fill_builtins`, `engine_frame`, `material_row`, `load_material_uniforms`, `custom_value`, `VertexIn`, `VertexOut`, `vs`, `fs` and `FLAT_SHADING`. They also include the library items it imports: `Material`, `InstanceIn`, `find_instance`, `clip_of`, `relative_position`, `world_normal`, `finish`, `fogged`, `fragment_color`, `material_of`, `PbrMaterial`, `pbr_material`, `dfg_lut`, `direct_light`, `indirect_diffuse`, `multiscatter_compensation`, `clustered_light` and `sun_shadow`. Other library names, such as `brdf_ggx` or `PI`, stay free. Import library items by name (`#import null3d::noise::{fbm2}`), because a whole-module import reserves the module's name. No `enable` directives.

## 3. Built-in values

Globals that the vertex offset and the surface function both read (`shaders/builtins`):

| Name | Fields | Notes |
| --- | --- | --- |
| `frame` | `time`, `deltaTime` (seconds), `index` (u32, from 1), `resolution` (vec2f, pixels at the render scale, as `@builtin(position)` counts them) | The sketch's `time`; the held time in hold mode |
| `camera` | `position` (absolute world position), `viewProjection` (`mat4x4f`, from positions relative to the camera to clip space) | |
| `object` | `position` (the object's or instance's origin in the world) | Gives each object a look of its own from one material |
| `material` | Your uniforms, as `struct Uniforms` declares them | See section 4 |

In 0.2: `camera.view`, `projection`, `near` and `far`, and `object.worldMatrix`, `normalMatrix` and `id`.

The engine renders relative to the camera. `input.relativePosition` is therefore exact near the camera, even in very large worlds. Use it for distances, fades and view-dependent effects. The world position of the input, `camera.position` and `object.position` are absolute. Far from the origin they hold fewer digits (1 mm steps at 10 km), so keep world-space patterns coarse there.

## 4. Uniforms, textures and per-instance data

Uniforms are built. Textures and per-instance data come in 0.2, and custom materials take no texture maps until then. The WGSL declares the uniforms once, as `struct Uniforms`, and reads them from `material`. The `uniforms` option gives their first values by field name, and a uniform without one starts at 0:

```ts
materials.shader({
  uniforms: {
    speed: 1.5,                 // f32
    tint: '#88ccff',            // vec3f, converted from sRGB to linear
    offset: [0, 0],             // vec2f
  },
  wgsl: /* wgsl */ `
    struct Uniforms { speed: f32, tint: vec3f, offset: vec2f }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      s.baseColor *= material.tint;
      return s;
    }`,
});
```

Example: a dissolve effect, which needs alpha modes too.

```ts
const dissolve = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  uniforms: { progress: 0, edgeColor: '#ff6a00' },
  wgsl: /* wgsl */ `
    #import null3d::noise::{fbm2}

    struct Uniforms { progress: f32, edgeColor: vec3f }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let n = fbm2(input.uv * 8.0, 4u) * 0.5 + 0.5;
      s.alpha = step(material.progress, n);
      let edge = 1.0 - smoothstep(0.0, 0.05, n - material.progress);
      s.emissive = material.edgeColor * edge * 4.0;
      return s;
    }`,
});
// later: dissolve.set({ progress: 0.6 });
```

- `set()` changes only the uniforms you pass, cheaply at any time, and the others keep their values. It takes standard values in the same call.
- (0.2) TypeScript types the `uniforms` option and `set()` from the struct. A misspelled name or a value of the wrong kind fails the type check, so run it after you edit the WGSL. For tagged WGSL, keep the literal in a `const` or write it in the call: a variable typed `string` hides the struct, and then any name passes. A `.wgsl` file gets its types from the `.wgsl.d.ts` declaration that the Vite plugin writes beside it, so commit that file. Type a list of values with `UniformValues<typeof wgsl>`, or `ShaderValues<typeof wgsl>` for `set()`, because a plain array literal widens `[0, 1]` to `number[]`. (`guides/custom-shaders`, Typed uniforms)
- Field types: `f32`, `i32`, `u32` (numbers; whole numbers for the integers), `vec2f`, `vec3f`, `vec4f` (arrays). A `vec3f` also takes a color string or hex number, converted from sRGB to linear. Arrays are used as given.
- The fields fit in 32 numbers; each `vec3f` and `vec4f` starts a group of four. The build rejects other types and fields past the limit.
- No field may be named as a standard value (`color`, `opacity`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`). A wrong name or value in `uniforms` or `set()` throws E1216.
- Textures in custom materials come in 0.2, with a `textures` option.
- Per-instance data: `createInstances(mesh, count, { material, attributes: { tint: 4 } })` (0.2).

## 5. Vertex offsets and full shaders

Vertex offsets and full shaders are built. A vertex offset moves vertices in the mesh's own space before the engine applies transforms and instancing. It goes in the same WGSL as the surface function, and reads the same uniforms:

```wgsl
struct Uniforms { height: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
  // VertexInput: position, normal, uv, in the mesh's own space
  let w = sin(input.position.x * 2.0) * material.height;
  return vec3f(0.0, w, 0.0);
}
```

- Exactly this signature; the build rejects another.
- Normals stay the mesh's own. Use `flatShading: true` to light faces by their moved positions, or bend `s.normal` in the surface function.
- Shadows use the unmoved vertices.
- Vertices that move outside the mesh's bounding sphere can be culled wrongly. Give the object a sphere that holds them with `mesh.setBounds(center, radius)`, at setup, because the call rebuilds the draw tables.

A full shader is WGSL with one `@vertex` entry point that takes an `InstanceIn`, and one `@fragment` entry point:

```wgsl
#import null3d::builtins::{fill_builtins, frame}
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, world_normal}
#import null3d::vertex::{mesh_position}

struct Varyings { @builtin(position) clip: vec4f, @location(0) normal: vec3f }

@vertex
fn vs(@location(0) position: vec3f, @location(1) normal: vec3f, i: InstanceIn) -> Varyings {
  let found = find_instance(i);   // works on both GPU paths, for objects and instances
  let p = mesh_position(position); // the mesh's own value on every path, integer meshes too
  return Varyings(clip_position(found, p), world_normal(found, normal));
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  fill_builtins(vec3f(0.0));      // fills frame, camera and object for this stage
  let pulse = 0.5 + 0.5 * sin(frame.time);
  return finish(abs(normalize(in.normal)) * pulse, in.clip.xy);  // linear color in, output out
}
```

- Mesh locations: 0 position, 1 normal, 2 uv, 3 uv1, 4 tangent, 5 color, 6 joints (`vec4u`), 7 weights (0.2). A mesh draws only with every attribute the shader reads.
- Read the position through `mesh_position`, and texture coordinates through `mesh_uv` and `mesh_second_uv` (`null3d::vertex`, 0.2). WebGPU reads a mesh's plain integer attributes as fractions, and these scale them back.
- `null3d::mesh` gives `find_instance`, `clip_position`, `relative_position`, `world_normal` and `finish`; positions are relative to the camera.
- Full shaders get no lighting, shadows or fog, no standard values and no uniforms. Import `null3d::lighting` or `null3d::fog` helpers for your own.

## 6. Custom post effects (0.2)

```ts
post.addEffect({
  name: 'vignette-pulse',
  stage: 'final',           // 'final': after tone mapping, merged into the final pass
                            // 'hdr': before tone mapping, own pass, may read neighbors freely
  uniforms: { strength: 0.35 },
  wgsl: /* wgsl */ `
    fn effect(input: EffectInput) -> vec4f {
      // EffectInput: uv, fragCoord, resolution; helpers: sampleScene(uv), sampleDepth(uv)
      let c = sampleScene(input.uv);
      let d = distance(input.uv, vec2f(0.5));
      let v = 1.0 - effect.strength * (0.8 + 0.2 * sin(frame.time * 2.0)) * d * d * 2.0;
      return vec4f(c.rgb * v, c.a);
    }`,
});
```

Effects in the `final` stage share one pass with the others. So they should read the scene at their own pixel, or at most a few nearby pixels. Blurs and other wide filters belong in the `hdr` stage.

## 7. Custom passes (0.2)

```ts
render.addPass({
  name: 'Heatmap',
  kind: 'fullscreen',
  reads: ['sceneDepth'],
  writes: 'heat', size: 'screen/2',
  wgsl: /* wgsl */ `fn pass(input: PassInput) -> vec4f { let d = readDepth(input.uv); return vec4f(d, 0.0, 0.0, 1.0); }`,
  before: 'Post',
});
const heat = textures.fromPass('heat');   // use it in a material or effect
```

- `kind: 'scene'` draws objects with a camera and a layer mask, optionally with a `materialOverride`.
- `kind: 'compute'` exists on WebGPU only; check `ctx.engine.capabilities.tier` and give WebGL2 users a fallback.
- The graph checks every declaration and reports each problem as an error with a code. See `concepts/render-graph` for the checks. `render.dumpGraph()` prints the compiled graph as Graphviz DOT text.

## 8. Portable WGSL rules

These rules come from the capabilities browsers report; `shaders/wgsl-rules` lists them in full. The build rejects a shader that breaks rule 1, 2 or 4, with the file, line and column. It cannot check rules 3, 5 and 6, so test on each GPU path.

1. Use only these WGSL language features: `packed_4x8_integer_dot_product`, `pointer_composite_access`, `readonly_and_readwrite_storage_textures`. They are the three that Chrome, Safari and Firefox all report.
2. Write flat interpolation as `@interpolate(flat, either)`; compatibility mode accepts no other flat form.
3. Stay within these limits unless you check capabilities first. Vertex shaders: 16 attributes, built-ins included in compatibility mode, and no storage buffers. Fragment shaders: 4 storage buffers. Each stage: 16 sampled textures and 16 samplers, and 15 values passed between stages. Uniform data: 16 KB per binding. Compute: workgroups of at most 128 invocations, and 16 KB of workgroup memory. Textures: up to 4096 pixels.
4. Do not use `f16`. The build rejects it, as it rejects every optional WebGPU feature, such as `enable subgroups;`. Write the math in `f32`.
5. Do not read 32-bit float textures with filtering. Filtering them is an optional GPU feature, and some devices, such as iPads, lack it. Use `textureLoad`, or 16-bit float textures.
6. Keep `textureSample` in uniform control flow, or use `textureSampleLevel` inside branches that differ between pixels. Chrome rejects the shader otherwise.
7. WGSL's `%` on floats keeps the sign of the left operand, like C, so `-1.5 % 1.0` is `-0.5`, on both backends. For GLSL-style `mod`, write `x - y * floor(x / y)`. On integers, keep both values zero or more, or use `u32`: WebGL2 leaves `%` undefined for negative values.
8. No storage buffers or storage textures in vertex shaders: per-instance data arrives as vertex attributes.

## 9. Imports from the shader library

```wgsl
#import null3d::noise::{simplex3, fbm3}
#import null3d::color::{srgb_to_linear}
```

The build resolves imports before translating, and adds only the functions the shader calls. Names are snake_case, as in WGSL. `shaders/library` lists every function with its signature. The modules:

- `null3d::math`: constants such as `PI`, `modulo` with GLSL's sign rule, `remap` and rotations.
- `null3d::noise`: integer hashes, `random`, and value, Perlin, simplex, Worley and fractal noise. Each noise has a 2D and a 3D form, such as `simplex2` and `fbm3(p, octaves)`. The hashes give the same bits on every GPU, so a pattern looks the same everywhere.
- `null3d::color`: `srgb_to_linear`, `linear_to_srgb`, `luminance`, HSV, and the tone mapping curves `tone_map_aces`, `tone_map_agx` and `tone_map_neutral`.
- `null3d::lighting`: `lambert`, and three.js's physically based functions, such as `brdf_ggx`, `pbr_material` and `direct_light`.
- `null3d::fog`: `fog_linear` and `fog_exp2`, with three.js's formulas.
- `null3d::vertex`: instance transforms, `transform_normal` for uneven scale, and `to_clip`.
- `null3d::depth`: `linear_depth` and the view-z conversions for the engine's reversed depth, which hold on both GPU paths.
- `null3d::sdf`: signed distances of shapes, and ways to combine them.

Importing a module whole reserves its name. After `#import null3d::color`, no variable, parameter or field can be called `color`. Import items by name, as above, to keep the name free.

## 10. Debugging shaders

- A shader error stops Vite with the file, line and column. It shows in Vite's overlay and the terminal on the dev server, and in the output of `vite build`. Fix the WGSL; never edit generated GLSL. (`guides/custom-shaders`)
- A surface function's error names its own line in your file. An error that says it is in the engine's standard material usually comes from a name clash or a whole-module import.
- Output an intermediate value as color: `s.emissive = vec3f(n); s.baseColor = vec3f(0.0);` shows `n` directly.
- `debug.view('normals')` and `debug.view('overdraw')` show normals and overdraw for the whole scene, in development builds. A debug view ignores custom shaders.
- Shader hot reload: the null3D Vite plugin reloads WGSL files and inline WGSL strings without reloading the page (0.2). Until then, editing a shader reloads the page.
- Check both backends: `?gpu=webgl2` runs the translated shaders.
