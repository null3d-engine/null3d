# Porting shaders: GLSL, onBeforeCompile and TSL

null3D shaders are WGSL. The build translates them to GLSL for the WebGL2 path, so you write each shader once. The null3d-develop skill's `references/shaders.md` defines the surface-function contract used below. Engine docs: `porting/threejs-shaders`, `shaders/surface-functions`, `shaders/builtins`, `shaders/wgsl-rules`, `shaders/library`, `guides/custom-shaders`.

A custom material takes its WGSL in one `wgsl` option: a template literal tagged `/* wgsl */`, or a `.wgsl` import. That WGSL holds `fn surface`, `fn vertexOffset`, or both, or a full shader's `@vertex` and `@fragment` entry points. It declares its uniforms once, as `struct Uniforms`, and reads them from `material`.

Versions: `materials.shader` is built, with surface functions, `vertexOffset`, uniforms in `struct Uniforms`, and full shaders. So are the built-in values `frame.time`, `frame.deltaTime`, `frame.index`, `frame.resolution`, `camera.position`, `camera.viewProjection`, `object.position` and `material`. Textures in custom materials come in 0.2, with the inputs and built-in values that the tables below mark (0.2). Post effects and custom passes come in 0.2 too. A port that needs a later part waits for it, or keeps its values in the standard options.

## Contents

1. Choose the target form
2. GLSL to WGSL
3. three.js built-ins and their null3D equivalents
4. Coordinate, depth and color conventions
5. ShaderMaterial and RawShaderMaterial
6. onBeforeCompile patterns
7. TSL and node materials
8. Vertex displacement and displacement maps
9. Worked examples
10. Pitfalls checklist

## 1. Choose the target form

Read what the original shader does, then pick the smallest null3D form that can do it:

| The original shader... | Port it as |
| --- | --- |
| Changes color, roughness, emission or alpha of a lit surface | Surface function |
| Moves vertices | `vertexOffset`, plus a surface function if needed |
| Ignores lighting (unlit effects, holograms, fresnel glows) | Surface function that writes `emissive` and sets `baseColor` to zero |
| Replaces three.js lighting | Full shader with `null3d::lighting` helpers; rare, so confirm it is needed |
| Is a full-screen pass | `post.addEffect` (0.2, `references/post-processing.md`) |
| Renders to a texture for another material | Custom pass (`render.addPass`, 0.2) |

Surface functions keep instancing, shadows, fog and both backends working, and skinning when it comes in 0.2. Full shaders keep instancing and both backends, but get no lighting, shadows, fog, uniforms or standard values.

## 2. GLSL to WGSL

| GLSL | WGSL |
| --- | --- |
| `float`, `int`, `uint`, `bool` | `f32`, `i32`, `u32`, `bool` |
| `vec2`, `vec3`, `vec4` | `vec2f`, `vec3f`, `vec4f` |
| `ivec3`, `uvec3`, `bvec3` | `vec3i`, `vec3u`, `vec3<bool>` |
| `mat3`, `mat4` | `mat3x3f`, `mat4x4f` |
| `float x = 1.0;` | `var x = 1.0;` (mutable) or `let x = 1.0;` (immutable) |
| `const float K = 2.0;` at file scope | `const K = 2.0;` |
| `float f(float a) { ... }` | `fn f(a: f32) -> f32 { ... }` |
| `float a[4];` | `var a: array<f32, 4>;` |
| `float(i)`, `int(x)` | `f32(i)`, `i32(x)`; WGSL never converts types implicitly between variables |
| `texture2D(t, uv)`, `texture(t, uv)` | `textureSample(t, tSampler, uv)` |
| `texture2DLod`, `textureLod` | `textureSampleLevel(t, tSampler, uv, lod)` |
| `texelFetch(t, ivec2(p), 0)` | `textureLoad(t, vec2i(p), 0)` |
| `textureCube(c, dir)` | `textureSample(c, cSampler, dir)` with `texture_cube<f32>` |
| `mod(x, y)` | `x - y * floor(x / y)`; WGSL `%` keeps the sign of `x` |
| `atan(y, x)` | `atan2(y, x)` |
| `inversesqrt(x)` | `inverseSqrt(x)` |
| `dFdx`, `dFdy`, `fwidth` | `dpdx`, `dpdy`, `fwidth` |
| `lessThan(a, b)` | `a < b` (component-wise, gives a bool vector) |
| `mix`, `step`, `smoothstep`, `clamp`, `fract`, `pow`, `exp`, `log`, `sqrt`, `length`, `dot`, `cross`, `normalize`, `reflect`, `refract` | Same names |
| `c ? a : b` | `select(b, a, c)`: false value first, condition last |
| `v.xy = w;` (swizzle assignment) | `v = vec3f(w, v.z);`: only Chrome supports swizzle assignment |
| `discard;` | `discard;` |
| `gl_FrontFacing` | `input.frontFacing` |
| `gl_FragCoord` | The pixel from the clip position (section 4); `input.fragCoord` comes in 0.2 |
| `gl_VertexID`, `gl_InstanceID` | Not in surface functions. `object.position` tells instances apart; `input.instance` comes in 0.2 |
| `precision highp float;` | Delete |
| `#define NAME value` | `const NAME = value;` |
| `#ifdef`, `#if` | `if` on a `const` (the compiler removes the dead branch), or two materials |
| `#include <chunk>` | `#import null3d::...` from the engine library, or delete (section 3) |

## 3. three.js built-ins and their null3D equivalents

These exist now: the surface input's `relativePosition`, `worldPosition`, `normal`, `viewDirection`, `vertexColor`, `uv` and `frontFacing`, and `vertexOffset`'s `VertexInput`. So do `frame`, `camera.position`, `camera.viewProjection`, `object.position` and the `null3d::` library modules. These come in 0.2: the surface input's `uv1`, `camera.view`, `camera.projection` and `object.worldMatrix`.

| three.js (ShaderMaterial adds these) | null3D |
| --- | --- |
| `position`, `normal`, `uv`, `uv1` (older: `uv2`), `color` attributes | `VertexInput.position`, `normal`, `uv` in `vertexOffset`; `SurfaceInput.uv` and `vertexColor` in surface functions, and `uv1` (0.2). A full shader reads each attribute at its location (section 5) |
| `modelMatrix` | `object.position` for the origin; `object.worldMatrix` (0.2) |
| `viewMatrix`, `projectionMatrix` | `camera.viewProjection`, which takes positions relative to the camera; `camera.view` and `camera.projection` (0.2) |
| `modelViewMatrix * vec4(position, 1.0)` | Nothing: the engine transforms vertices. A full shader calls `clip_position(found, position)` from `null3d::mesh` |
| `normalMatrix` (view space in three.js) | `input.normal` is already in world space. View space needs `camera.view` (0.2) |
| `cameraPosition` | `camera.position` |
| Varyings such as `vWorldPosition`, `vViewDir`, `vNormal` | `input.worldPosition`, `input.relativePosition`, `input.viewDirection`, `input.normal` |
| `instanceMatrix`, `instanceColor` | The engine applies the instance's transform. Instance batches store colors but draw them only from 0.2 |
| Uniform `time` passed by the app | `frame.time` |
| `#include <fog_fragment>` and fog uniforms | Nothing: fog is applied after the surface function |
| `#include <tonemapping_fragment>`, `<colorspace_fragment>` | Delete: the final pass does both, once |
| `#include <common>`, `<packing>` helpers | `null3d::math`, `null3d::depth` |
| `#include <lights_...>` and light uniforms | The engine lights surface functions; full shaders import `null3d::lighting` |

## 4. Coordinate, depth and color conventions

- Fragment coordinates: a surface function has no `fragCoord` input until 0.2. Compute the pixel from the clip position: `let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);` then `let pixel = (clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5) * frame.resolution;`. Its origin is at the top left with y pointing down, as `@builtin(position)` in a full shader's fragment stage. GLSL `gl_FragCoord` starts at the bottom left with y pointing up. Wherever the original used `gl_FragCoord.y`, use `frame.resolution.y - pixel.y`.
- Screen UVs in post effects (0.2): `input.uv` is (0, 0) at the top left. three.js full-screen passes use a `vUv` that is (0, 0) at the bottom left. Replace `vUv.y` with `1.0 - input.uv.y` where direction matters (gradients, top-of-screen effects).
- Texture UVs: textures loaded with `flipY: true` sample the same as three.js's `TextureLoader` default. glTF textures use `flipY: false` in both engines. Keep the original's setting, and the ported shader's UV math stays the same.
- Depth: the engine uses reversed depth on both GPU paths, where near is 1 and far is 0. A vertex shader writes clip-space depth in WebGPU's range of 0 to 1, and the engine moves it where WebGL2 needs that. Do not port three.js depth formulas such as `perspectiveDepthToViewZ` or `readDepth`; use `null3d::depth::linear_depth(d, near, far)` and `null3d::depth::perspective_depth_to_view_z(d, near, far)`, which are correct on both backends.
- Color output: engine surfaces are linear, and the engine encodes them as sRGB for the canvas once. A three.js `ShaderMaterial` without `<colorspace_fragment>` writes its values straight to the screen, so its colors were effectively sRGB. Convert such constants with `null3d::color::srgb_to_linear`, or pass them as `'#rrggbb'` uniforms, which the engine converts.
- Matrices are column-major in both, and `matrix * vector` keeps its order.

## 5. ShaderMaterial and RawShaderMaterial

1. List the uniforms. Each becomes a field of `struct Uniforms` in the WGSL, with its first value in `uniforms` (numbers, `'#rrggbb'` colors, arrays). Texture uniforms wait for textures in custom materials (0.2). Updates such as `material.uniforms.uSpeed.value = 2` become `material.set({ speed: 2 })`. three.js's `uniforms` record takes any name, and a name that the GLSL does not use changes nothing. In null3D (0.2), a name that `struct Uniforms` lacks fails the type check, and the engine throws E1216 when it runs.
2. Read the vertex shader. If it only applies `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` and passes varyings along, drop it: the engine does both. If it moves vertices, port that part as `vertexOffset`.
3. Read the fragment shader, and map its varyings to `SurfaceInput` fields. Map its output to `Surface` fields: lit look to `baseColor`, `roughness` and `metalness`; unlit look to `emissive` with `baseColor` set to zero; transparency to `alpha` plus the right `alphaMode`.
4. Set the material options that were ShaderMaterial flags: `transparent` becomes `alphaMode: 'blend'`, `side: DoubleSide` becomes `doubleSided: true`, `blending: AdditiveBlending` becomes `blending: 'additive'`, `depthWrite: false` stays `depthWrite: false`.
5. Compare parity images on WebGPU and WebGL2.

A `RawShaderMaterial` adds nothing automatically, so all its matrices and attributes are explicit; the same steps apply.

A shader whose look the engine's lighting cannot give, such as a hologram, becomes a full shader. It has one `@vertex` entry point that takes an `InstanceIn`, and one `@fragment` entry point. It finds its instance with `find_instance` from `null3d::mesh`, places vertices with `clip_position`, and writes its linear color through `finish` (null3d-develop `references/shaders.md`, section 5). Uniforms and standard values do not reach a full shader, so port its uniforms as constants, or keep the look in a surface function.

## 6. onBeforeCompile patterns

| What the patch does | null3D form |
| --- | --- |
| Changes `transformed` after `#include <begin_vertex>` | `vertexOffset` returning the change (new position minus old) |
| Changes `diffuseColor` after `<map_fragment>` or `<color_fragment>` | Surface function: `s.baseColor`, `s.alpha` |
| Changes `roughnessFactor` or `metalnessFactor` | `s.roughness`, `s.metalness` |
| Adds glow in `<emissivemap_fragment>` | `s.emissive` |
| Adds `discard` for dissolves or cut-outs | `alphaMode: 'mask'` and `s.alpha` |
| Adds a varying such as a world position | Use `input.worldPosition` or `input.relativePosition` |
| Replaces a lighting chunk | Full shader with `null3d::lighting`; confirm the need first |
| Stores `shader.uniforms` to update them later | `material.set({ ... })`, or `frame.time` for time |

Keep the original's standard options (color, roughness, metalness, emissive) on the new material: `materials.shader` accepts every `materials.standard` option but the texture maps, and feeds them to `defaultSurface()`. Texture maps on custom materials come in 0.2.

## 7. TSL and node materials

| TSL | WGSL surface function |
| --- | --- |
| `uniform(0.5)`, and `u.value = x` | `uniforms: { name: 0.5 }`, and `material.set({ name: x })` |
| `texture(map, uv())` | A texture sample, once custom materials take textures (0.2) |
| `uv()`, `uv(1)` | `input.uv`; `input.uv1` (0.2) |
| `positionGeometry` | `VertexInput.position` in `vertexOffset` |
| `positionLocal` | `VertexInput.position` in `vertexOffset`, except inside `positionNode` on an `InstancedMesh` (see below) |
| `positionWorld`, `normalWorld` | `input.worldPosition`, `input.normal` |
| `normalView` | `(camera.view * vec4f(input.normal, 0.0)).xyz`, with `camera.view` (0.2) |
| `cameraPosition`, `time` | `camera.position`, `frame.time` |
| `vertexColor()`, `instanceIndex` | `input.vertexColor`; `input.instance` (0.2) |
| `screenUV` | The pixel of section 4 divided by `frame.resolution` in surfaces, `input.uv` in effects (0.2) |
| `add`, `sub`, `mul`, `div`, `.add()` chains | `+`, `-`, `*`, `/` |
| `oneMinus(x)`, `saturate(x)` | `1.0 - x`, `saturate(x)` |
| `mx_noise_float(p)` and other MaterialX noise | `null3d::noise::simplex3(p)`, `fbm3(p, octaves)` (values differ; tune) |
| `Fn(() => { ... })`, `If`, `Loop`, `.toVar()` | `fn`, `if`, `for`, `var` |
| `material.colorNode`, `opacityNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `aoNode` | `s.baseColor`, `s.alpha`, `s.roughness`, `s.metalness`, `s.normal`, `s.emissive`, `s.occlusion` |
| `material.positionNode` | `vertexOffset` returning `newPosition - input.position` |
| `material.fragmentNode`, `outputNode`, `mrtNode` | Full shader, or a post effect (0.2); `mrtNode` has no equivalent |

On an `InstancedMesh`, three.js r186 applies the instance matrix before `positionNode` runs, so `positionLocal` there already holds the instanced vertex. In null3D, `input.position` is always the mesh's own vertex, and the engine applies the instance transform after `vertexOffset`. A displacement that three.js scaled by that `positionLocal` changes size after the port. Write it from `input.position` and the instance's own data, and check the project's three.js version before you port a `positionNode`.

## 8. Vertex displacement and displacement maps

A displacement computed from the vertex, such as wind or waves, works now (section 9 shows one). The example below reads a height map, so it waits for textures in custom materials (0.2).

```ts
const terrain = materials.shader({
  color: '#7a8a5a', roughness: 0.9,                 // standard values still apply
  uniforms: { scale: 2.0, bias: 0.0 },
  textures: { height: heightMap },                  // linear color space
  wgsl: /* wgsl */ `
    struct Uniforms { scale: f32, bias: f32 }

    fn vertexOffset(input: VertexInput) -> vec3f {
      let h = textureSampleLevel(height, heightSampler, input.uv, 0.0).r;
      return input.normal * (h * material.scale + material.bias);
    }`,
});
terrainMesh.setBounds([0, 1, 0], 60);  // include the highest displaced point
```

Vertex shaders must use `textureSampleLevel`: implicit mip selection does not exist in the vertex stage. Normals are not recomputed after displacement. Use `flatShading: true` to light faces by their moved positions, or bend `s.normal` in the surface function.

## 9. Worked examples

Fresnel glow, from ShaderMaterial:

```glsl
// three.js vertex shader
varying vec3 vNormal; varying vec3 vViewDir;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
// three.js fragment shader
uniform vec3 uColor; uniform float uPower;
varying vec3 vNormal; varying vec3 vViewDir;
void main() {
  float f = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), uPower);
  gl_FragColor = vec4(uColor * f, f);
}
```

```ts
// null3d
const glow = materials.shader({
  alphaMode: 'blend', blending: 'additive', depthWrite: false,
  uniforms: { glowColor: '#44aaff', power: 3 },
  wgsl: /* wgsl */ `
    struct Uniforms { glowColor: vec3f, power: f32 }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let f = pow(1.0 - max(dot(input.normal, input.viewDirection), 0.0), material.power);
      s.baseColor = vec3f(0.0);
      s.emissive = material.glowColor * f;
      s.alpha = f;
      return s;
    }`,
});
```

The original works in view space and the port in world space; the dot product is the same in both. The vertex shader disappears because it only transformed positions and passed data along.

Wind sway, from onBeforeCompile:

```js
// three.js
material.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = timeUniform;
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\ntransformed.x += sin(uTime * 2.0 + position.y) * 0.1 * position.y;');
};
```

```ts
// null3d: the standard values of the original material stay; its map waits for texture maps
// on custom materials (0.2)
const foliage = materials.shader({
  color: '#4f7a32', doubleSided: true,
  uniforms: { strength: 0.1 },
  wgsl: /* wgsl */ `
    struct Uniforms { strength: f32 }

    fn vertexOffset(input: VertexInput) -> vec3f {
      let sway = sin(frame.time * 2.0 + input.position.y) * material.strength * input.position.y;
      return vec3f(sway, 0.0, 0.0);
    }`,
});
```

Dissolve, from TSL:

```js
// three.js TSL
const progress = uniform(0);
const n = texture(noiseTex, uv()).r;
material.opacityNode = step(progress, n);
material.emissiveNode = color(0xff6a00).mul(smoothstep(0.05, 0.0, n.sub(progress)).mul(4));
material.alphaTest = 0.5;
```

The null3D version is the dissolve example in the null3d-develop skill's `references/shaders.md` (section 4), which uses `null3d::noise` in place of the noise texture. The mapping is one to one: `opacityNode` becomes `s.alpha`, `emissiveNode` becomes `s.emissive`, and `alphaTest` becomes `alphaMode: 'mask'` with `alphaCutoff`.

## 10. Pitfalls checklist

- `textureSample` inside a branch that differs between pixels breaks a WGSL rule that GLSL did not have. Chrome rejects such a shader, and the null3D build cannot catch it. Sample before the branch, or use `textureSampleLevel`.
- `%` is not `mod`: negative inputs give different results.
- No swizzle assignment (`v.xy = ...`): write the whole vector.
- Flip y for `gl_FragCoord` and full-screen UV math (section 4).
- Replace depth formulas with `null3d::depth` helpers.
- Convert raw sRGB color constants from ShaderMaterials (section 4).
- three.js `normalMatrix` is view space; null3D normals are world space.
- WGSL does not mix `f32` and `i32` in arithmetic: cast explicitly.
- A surface function shares its file with the engine's template. Rename GLSL helpers and variables that clash with its names, such as `frame`, `camera`, `object`, `material`, `shade`, `finish` or `vs`. The null3d-develop skill's `references/shaders.md` (section 2) lists them all.
- Uniforms take `f32`, `i32`, `u32`, `vec2f`, `vec3f` and `vec4f`, 32 numbers in all. Pass a matrix as `vec4f` rows, and rename a uniform called `color`, `roughness` or another standard value.
- Use only the three WGSL language features every browser shares, and `@interpolate(flat, either)` for flat values (null3d-develop `references/shaders.md`, section 8).
- Test on WebGL2 (`?gpu=webgl2`): the translated GLSL can hit limits the WGSL did not.
- A full shader loses the engine's lighting, shadows and fog, and takes no uniforms. Port to a surface function where the look allows it.
