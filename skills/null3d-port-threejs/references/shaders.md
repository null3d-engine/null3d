# Porting shaders: GLSL, onBeforeCompile and TSL

null3D shaders are WGSL. The build translates them to GLSL for the WebGL2 path, so you write each shader once. The null3d-develop skill's `references/shaders.md` defines the surface-function contract used below. Engine docs: `porting/threejs-shaders`, `shaders/surface-functions`, `shaders/builtins`, `shaders/wgsl-rules`, `shaders/library`, `guides/custom-shaders`.

Versions: custom materials come later in 0.1. That covers `materials.shader`, surface functions, `vertexOffset`, full shaders, and the built-in values `frame`, `camera`, `object` and `material`. Post effects come in 0.2. Until then, the null3D Vite plugin compiles WGSL in sketch code and the engine's library modules, but the engine cannot draw with custom shaders (`guides/custom-shaders`). The GLSL to WGSL table, the conventions in section 4 and the `null3d::` library modules apply now. Tell the user that a port which depends on custom shaders must wait for them.

## Contents

1. Choose the target form
2. GLSL to WGSL
3. three.js built-ins and their null3D equivalents
4. Coordinate, depth and color conventions
5. ShaderMaterial and RawShaderMaterial (later in 0.1)
6. onBeforeCompile patterns (later in 0.1)
7. TSL and node materials (later in 0.1)
8. Vertex displacement and displacement maps (later in 0.1)
9. Worked examples (later in 0.1)
10. Pitfalls checklist

## 1. Choose the target form

Read what the original shader does, then pick the smallest null3D form that can do it:

| The original shader... | Port it as |
| --- | --- |
| Changes color, roughness, emission or alpha of a lit surface | Surface function (later in 0.1) |
| Moves vertices | `vertexOffset` (later in 0.1), plus a surface function if needed |
| Ignores lighting (unlit effects, holograms, fresnel glows) | Surface function (later in 0.1) that writes `emissive` and sets `baseColor` to zero |
| Replaces three.js lighting | Full shader (later in 0.1) with `null3d::lighting` helpers; rare, so confirm it is needed |
| Is a full-screen pass | `post.addEffect` (0.2, `references/post-processing.md`) |
| Renders to a texture for another material | Custom pass (`render.addPass`, 0.2) |

Surface functions keep instancing, skinning, shadows, fog and both backends working, which full shaders do not.

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
| `gl_FragCoord` | `input.fragCoord` (origin at the top left; section 4) |
| `gl_VertexID`, `gl_InstanceID` | Not in surface functions; `input.instance` gives the instance row |
| `precision highp float;` | Delete |
| `#define NAME value` | `const NAME = value;` |
| `#ifdef`, `#if` | `if` on a `const` (the compiler removes the dead branch), or two materials |
| `#include <chunk>` | `#import null3d::...` from the engine library, or delete (section 3) |

## 3. three.js built-ins and their null3D equivalents

The inputs and built-in values in this table come with custom materials, later in 0.1. The `null3d::` library modules exist now.

| three.js (ShaderMaterial adds these) | null3D |
| --- | --- |
| `position`, `normal`, `uv`, `uv1` (older: `uv2`), `color` attributes | `VertexInput.position`, `normal`, `uv` in `vertexOffset`; `SurfaceInput.uv`, `uv1`, `vertexColor` in surface functions |
| `modelMatrix` | `object.worldMatrix` |
| `viewMatrix`, `projectionMatrix` | `camera.view`, `camera.projection` |
| `modelViewMatrix * vec4(position, 1.0)` | Nothing: the engine transforms vertices; in full shaders use `null3d::vertex::to_clip` |
| `normalMatrix` (view space in three.js) | `input.normal` is already world space; for view space: `(camera.view * vec4f(n, 0.0)).xyz` |
| `cameraPosition` | `camera.position` |
| Varyings such as `vWorldPosition`, `vViewDir`, `vNormal` | `input.worldPosition`, `input.relativePosition`, `input.viewDirection`, `input.normal` |
| `instanceMatrix`, `instanceColor` | Handled by the engine; `input.vertexColor` includes the instance color |
| Uniform `time` passed by the app | `frame.time` |
| `#include <fog_fragment>` and fog uniforms | Nothing: fog is applied after the surface function |
| `#include <tonemapping_fragment>`, `<colorspace_fragment>` | Delete: the final pass does both, once |
| `#include <common>`, `<packing>` helpers | `null3d::math`, `null3d::depth` |
| `#include <lights_...>` and light uniforms | The engine lights surface functions; full shaders import `null3d::lighting` |

## 4. Coordinate, depth and color conventions

- Fragment coordinates: `input.fragCoord` has its origin at the top left with y pointing down; GLSL `gl_FragCoord` starts at the bottom left with y pointing up. For screen-space code ported from GLSL, use `frame.resolution.y - input.fragCoord.y` wherever the original used `gl_FragCoord.y`.
- Screen UVs in post effects (0.2): `input.uv` is (0, 0) at the top left. three.js full-screen passes use a `vUv` that is (0, 0) at the bottom left. Replace `vUv.y` with `1.0 - input.uv.y` where direction matters (gradients, top-of-screen effects).
- Texture UVs: textures loaded with `flipY: true` sample the same as three.js's `TextureLoader` default. glTF textures use `flipY: false` in both engines. Keep the original's setting, and the ported shader's UV math stays the same.
- Depth: the engine uses reversed depth on both GPU paths, where near is 1 and far is 0. A vertex shader writes clip-space depth in WebGPU's range of 0 to 1, and the engine moves it where WebGL2 needs that. Do not port three.js depth formulas such as `perspectiveDepthToViewZ` or `readDepth`; use `null3d::depth::linear_depth(d, near, far)` and `null3d::depth::perspective_depth_to_view_z(d, near, far)`, which are correct on both backends.
- Color output: engine surfaces are linear, and the engine encodes them as sRGB for the canvas once. A three.js `ShaderMaterial` without `<colorspace_fragment>` writes its values straight to the screen, so its colors were effectively sRGB. Convert such constants with `null3d::color::srgb_to_linear`, or pass them as `'#rrggbb'` uniforms, which the engine converts.
- Matrices are column-major in both, and `matrix * vector` keeps its order.

## 5. ShaderMaterial and RawShaderMaterial (later in 0.1)

1. List the uniforms. Each becomes a field of `struct Uniforms` in the WGSL, with its first value in `uniforms` (numbers, `'#rrggbb'` colors, arrays), or an entry in `textures`. Updates such as `material.uniforms.uSpeed.value = 2` become `material.set({ speed: 2 })`.
2. Read the vertex shader. If it only applies `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` and passes varyings along, drop it: the engine does both. If it moves vertices, port that part as `vertexOffset`.
3. Read the fragment shader, and map its varyings to `SurfaceInput` fields. Map its output to `Surface` fields: lit look to `baseColor`, `roughness` and `metalness`; unlit look to `emissive` with `baseColor` set to zero; transparency to `alpha` plus the right `alphaMode`.
4. Set the material options that were ShaderMaterial flags: `transparent` becomes `alphaMode: 'blend'`, `side: DoubleSide` becomes `doubleSided: true`, `blending: AdditiveBlending` becomes `blending: 'additive'`, `depthWrite: false` stays `depthWrite: false`.
5. Compare parity images on WebGPU and WebGL2.

A `RawShaderMaterial` adds nothing automatically, so all its matrices and attributes are explicit; the same steps apply.

## 6. onBeforeCompile patterns (later in 0.1)

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

Keep the original's standard options (color, maps, roughness) on the new material: `materials.shader` accepts every `materials.standard` option and feeds them to `defaultSurface()`.

## 7. TSL and node materials (later in 0.1)

| TSL | WGSL surface function |
| --- | --- |
| `uniform(0.5)`, and `u.value = x` | `uniforms: { name: 0.5 }`, and `material.set({ name: x })` |
| `texture(map, uv())` | `textureSample(map, mapSampler, input.uv)` |
| `uv()`, `uv(1)` | `input.uv`, `input.uv1` |
| `positionGeometry` | `VertexInput.position` in `vertexOffset` |
| `positionLocal` | `VertexInput.position` in `vertexOffset`, except inside `positionNode` on an `InstancedMesh` (see below) |
| `positionWorld`, `normalWorld` | `input.worldPosition`, `input.normal` |
| `normalView` | `(camera.view * vec4f(input.normal, 0.0)).xyz` |
| `cameraPosition`, `time` | `camera.position`, `frame.time` |
| `vertexColor()`, `instanceIndex` | `input.vertexColor`, `input.instance` |
| `screenUV` | `input.fragCoord.xy / frame.resolution` in surfaces, `input.uv` in effects (0.2) |
| `add`, `sub`, `mul`, `div`, `.add()` chains | `+`, `-`, `*`, `/` |
| `oneMinus(x)`, `saturate(x)` | `1.0 - x`, `saturate(x)` |
| `mx_noise_float(p)` and other MaterialX noise | `null3d::noise::simplex3(p)`, `fbm3(p, octaves)` (values differ; tune) |
| `Fn(() => { ... })`, `If`, `Loop`, `.toVar()` | `fn`, `if`, `for`, `var` |
| `material.colorNode`, `opacityNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `aoNode` | `s.baseColor`, `s.alpha`, `s.roughness`, `s.metalness`, `s.normal`, `s.emissive`, `s.occlusion` |
| `material.positionNode` | `vertexOffset` returning `newPosition - input.position` |
| `material.fragmentNode`, `outputNode`, `mrtNode` | Full shader, or a post effect (0.2); `mrtNode` has no equivalent |

On an `InstancedMesh`, three.js r186 applies the instance matrix before `positionNode` runs, so `positionLocal` there already holds the instanced vertex. In null3D, `input.position` is always the mesh's own vertex, and the engine applies the instance transform after `vertexOffset`. A displacement that three.js scaled by that `positionLocal` changes size after the port. Write it from `input.position` and the instance's own data, and check the project's three.js version before you port a `positionNode`.

## 8. Vertex displacement and displacement maps (later in 0.1)

```ts
const terrain = materials.shader({
  map: groundColor, normalMap: groundNormal,        // standard options still apply
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

Vertex shaders must use `textureSampleLevel`: implicit mip selection does not exist in the vertex stage. Normals are not recomputed after displacement, so keep the original's normal map, or compute a normal from neighboring height samples in the surface function.

## 9. Worked examples (later in 0.1)

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
  uniforms: { color: '#44aaff', power: 3 },
  wgsl: /* wgsl */ `
    struct Uniforms { color: vec3f, power: f32 }

    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let f = pow(1.0 - max(dot(input.normal, input.viewDirection), 0.0), material.power);
      s.baseColor = vec3f(0.0);
      s.emissive = material.color * f;
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
// null3d: the standard options of the original material stay
const foliage = materials.shader({
  map: leafColor, alphaMode: 'mask', alphaCutoff: 0.5, doubleSided: true,
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
- Avoid `mat3x3f` uniforms: their layout pads each column. Pass three `vec3f` values or a `mat4x4f`.
- Use only the three WGSL language features every browser shares, and `@interpolate(flat, either)` for flat values (null3d-develop `references/shaders.md`, section 8).
- Test on WebGL2 (`?gpu=webgl2`): the translated GLSL can hit limits the WGSL did not.
- Until custom materials come later in 0.1, the build checks a ported shader, but no material can draw it.
