# Custom shaders in null3D

All engine shaders are WGSL. The build translates them to GLSL for the WebGL2 path, so one source serves both backends. Engine docs: `guides/custom-shaders`, `shaders/surface-functions`, `shaders/builtins`, `shaders/wgsl-rules`, `shaders/library`.

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

| Goal | Kind | Keeps lights, shadows, fog, instancing and skinning |
| --- | --- | --- |
| Change how a surface looks (color, roughness, patterns, dissolve, water) | Surface function | Yes |
| Move vertices (waves, wind, swelling) | Vertex offset, alone or with a surface function | Yes |
| Something the lighting model cannot express (holograms, custom lighting) | Full shader | No: you write everything |
| A full-screen image effect | Post effect (section 6) | Not applicable |
| An extra render or compute step | Custom pass (section 7) | Not applicable |

Choose the first row that works. Surface functions keep working when the engine's lighting, shadows or backends change.

## 2. Surface functions

The engine calls your function once per pixel and lights the result.

```wgsl
// Provided by the engine (do not declare these yourself):
struct SurfaceInput {
  worldPosition: vec3f,    // absolute world position; precise near the origin
  relativePosition: vec3f, // position relative to the camera; always precise
  worldNormal: vec3f,      // normalized, facing the camera for double-sided back faces
  uv: vec2f,               // first UV set
  uv1: vec2f,              // second UV set, or zero
  color: vec4f,            // vertex color times instance color, or (1, 1, 1, 1)
  viewDirection: vec3f,    // normalized, from the surface toward the camera
  fragCoord: vec4f,        // pixel position; xy in render-target pixels
  instance: u32,           // row index inside an instance batch, else 0
  frontFacing: bool,
};
struct Surface {
  baseColor: vec3f,        // linear RGB
  alpha: f32,
  metalness: f32,
  roughness: f32,          // perceptual roughness, as in glTF and three.js
  normal: vec3f,           // world space, normalized
  emissive: vec3f,         // linear RGB, added after lighting
  occlusion: f32,          // ambient occlusion, 0 to 1
};
fn defaultSurface(input: SurfaceInput) -> Surface;  // the material's own values
```

Your function:

```wgsl
fn surface(input: SurfaceInput) -> Surface {
  var s = defaultSurface(input);
  // change fields of s here
  return s;
}
```

`defaultSurface` applies the material's options (color, textures, roughness), so a surface function can adjust a standard look instead of rebuilding it. Alpha only has an effect when the material's `alphaMode` is `'mask'` or `'blend'`.

Example: a dissolve effect.

```ts
const dissolve = materials.shader({
  alphaMode: 'mask', alphaCutoff: 0.5,
  uniforms: { progress: 0, edgeColor: '#ff6a00' },
  textures: { noise: await assets.loadTexture('/tex/noise.ktx2', { colorSpace: 'linear' }) },
  surface: /* wgsl */ `
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let n = textureSample(noise, noiseSampler, input.uv).r;
      s.alpha = step(material.progress, n);
      let edge = 1.0 - smoothstep(0.0, 0.05, n - material.progress);
      s.emissive = material.edgeColor * edge * 4.0;
      return s;
    }`,
});
// later: dissolve.set({ progress: 0.6 });
```

## 3. Built-in values

| Name | Fields | Notes |
| --- | --- | --- |
| `frame` | `time`, `deltaTime`, `frameIndex` (u32), `resolution` (vec2f, render-target pixels) | Same values for every draw in a frame |
| `camera` | `position` (absolute world position), `view`, `projection`, `viewProjection`, `inverseView`, `near`, `far` | Matrices are `mat4x4f`; `view` is camera-relative, so its translation is zero |
| `object` | `worldMatrix` (3 x 4 as `mat4x3f`), `normalMatrix` (`mat3x3f`), `id` (u32) | For instances, the instance's values |
| `material` | Your `uniforms`, with the same names | Generated struct; see section 4 |

The engine renders relative to the camera. `input.relativePosition` is therefore exact near the camera even in very large worlds; use it for distances, fades and view-dependent effects. `input.worldPosition` is the absolute position, for world-space patterns such as noise or grid lines; far from the origin it loses precision, as any 32-bit value does.

## 4. Uniforms, textures and per-instance data

```ts
materials.shader({
  uniforms: {
    speed: 1.5,                 // f32
    tint: '#88ccff',            // vec3f, converted from sRGB to linear
    offset: [0, 0],             // vec2f
    params: [1, 2, 3, 4],       // vec4f
    count: { type: 'u32', value: 8 },
  },
  textures: {
    detail: detailTexture,      // WGSL gets `detail` (texture_2d<f32>) and `detailSampler`
  },
  surface,
});
```

- The build reads your WGSL and your `uniforms` and generates a typed `set()`: `mat.set({ speed: 2 })` type-checks in TypeScript (0.2; in 0.1 `set` is untyped).
- `set()` with values is cheap at any time. Adding or removing a texture key changes the shader, so do it before play.
- Color strings and hex numbers are sRGB and are converted to linear. Arrays are used as given.
- Per-instance data: `createInstances(..., { attributes: { tint: 4 } })` (0.2) makes `batch.attributes.tint` in TypeScript and `instanceAttr.tint` (`vec4f`) in the surface function.

## 5. Vertex offsets and full shaders

A vertex offset moves vertices in object space before the engine applies transforms, skinning and instancing:

```wgsl
fn vertexOffset(input: VertexInput) -> vec3f {
  // VertexInput: position, normal, uv, color, instance
  let w = sin(input.position.x * 2.0 + frame.time * 3.0) * 0.1;
  return vec3f(0.0, w, 0.0);
}
```

```ts
materials.shader({ vertexOffset, surface });
```

Vertices that move outside the object's bounds can be culled wrongly; enlarge the bounds with `obj.setBounds(center, radius)`.

A full shader supplies `vertex` and `fragment` functions. Use the engine's vertex input and output structs from the shader library (`#import null3d::vertex`), so instancing and camera-relative positions still work. Full shaders do not receive lighting, shadows or fog unless you import the helpers (`null3d::lighting`, `null3d::fog`).

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

Effects in the `final` stage should read the scene at their own pixel, or a few nearby pixels at most, because they share one pass with the others. Blurs and other wide filters belong in the `hdr` stage.

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

These rules come from the capabilities browsers report; `shaders/wgsl-rules` lists them in full. The build enforces them.

1. Use only these WGSL language features: `packed_4x8_integer_dot_product`, `pointer_composite_access`, `readonly_and_readwrite_storage_textures`. They are the three that Chrome, Safari and Firefox all report.
2. Write flat interpolation as `@interpolate(flat, either)`; compatibility mode accepts no other flat form.
3. Stay within these limits unless you check capabilities first: 16 vertex attributes (including built-ins in compatibility mode), 15 values passed between stages, 16 sampled textures and 16 samplers per stage, 4 storage buffers in fragment shaders and none in vertex shaders, 16 KB of uniform data per binding, compute workgroups of at most 128 invocations, 16 KB of workgroup memory, textures up to 4096 pixels.
4. `f16` needs the `shader-f16` feature: guard it and provide an `f32` fallback.
5. Do not read 32-bit float textures with filtering. Filtering them is an optional GPU feature, and some devices, such as iPads, lack it. Use `textureLoad`, or 16-bit float textures.
6. Keep `textureSample` in uniform control flow, or use `textureSampleLevel` inside branches that differ between pixels.
7. WGSL's `%` on floats keeps the sign of the left operand, like C, so `-1.5 % 1.0` is `-0.5`. For GLSL-style `mod`, write `x - y * floor(x / y)`.
8. No storage buffers or storage textures in vertex shaders: per-instance data arrives as vertex attributes.

## 9. Imports from the shader library

```wgsl
#import null3d::noise::{simplex3, fbm3}
#import null3d::color::{srgbToLinear}
```

The build resolves imports before translating, and includes only the functions you import. Library modules: `null3d::math`, `null3d::noise`, `null3d::color`, `null3d::lighting` (including `mainLightDirection()`, the main directional light's direction of travel), `null3d::fog`, `null3d::vertex`, `null3d::depth` (`linearDepth`, `viewZ`: correct for reversed depth on WebGPU and standard depth on WebGL2), `null3d::sdf`. Their contents are listed in `shaders/library`.

## 10. Debugging shaders

- Build errors show the WGSL line, and the translated GLSL line for WebGL2 errors. Fix the WGSL; never edit generated GLSL.
- Output an intermediate value as color: `s.emissive = vec3f(n); s.baseColor = vec3f(0.0);` shows `n` directly.
- `debug.view('normals')` and `debug.view('overdraw')` show normals and overdraw for the whole scene.
- Shader hot reload: the null3D Vite plugin reloads WGSL files and inline WGSL strings without reloading the page (0.2).
- Check both backends: `?gpu=webgl2` runs the translated shaders.
