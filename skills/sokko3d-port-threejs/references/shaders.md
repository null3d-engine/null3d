# Porting shaders: GLSL, onBeforeCompile and TSL

sokko3d shaders are WGSL. The build translates them to GLSL for the WebGL2 path, so you write each shader once. The sokko3d-develop skill's `references/shaders.md` defines the surface-function contract used below. Engine docs: `porting/threejs-shaders`, `shaders/surface-functions`, `shaders/builtins`, `shaders/wgsl-rules`.

## Contents

1. Choose the target form
2. GLSL to WGSL
3. three.js built-ins and their sokko3d equivalents
4. Coordinate, depth and color conventions
5. ShaderMaterial and RawShaderMaterial
6. onBeforeCompile patterns
7. TSL and node materials
8. Vertex displacement and displacement maps
9. Worked examples
10. Pitfalls checklist

## 1. Choose the target form

Read what the original shader does, then pick the smallest sokko3d form that can do it:

| The original shader... | Port it as |
| --- | --- |
| Changes color, roughness, emission or alpha of a lit surface | Surface function |
| Moves vertices | `vertexOffset`, plus a surface function if needed |
| Ignores lighting (unlit effects, holograms, fresnel glows) | Surface function that writes `emissive` and sets `baseColor` to zero |
| Replaces three.js lighting | Full shader with `sokko3d::lighting` helpers; rare, so confirm it is needed |
| Is a full-screen pass | `post.addEffect` (`references/post-processing.md`) |
| Renders to a texture for another material | Custom pass (`render.addPass`) |

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
| `#include <chunk>` | `#import sokko3d::...` from the engine library, or delete (section 3) |

## 3. three.js built-ins and their sokko3d equivalents

| three.js (ShaderMaterial adds these) | sokko3d |
| --- | --- |
| `position`, `normal`, `uv`, `uv1` (older: `uv2`), `color` attributes | `VertexInput.position`, `normal`, `uv`, `color` in `vertexOffset`; `SurfaceInput.uv`, `uv1`, `color` in surface functions |
| `modelMatrix` | `object.worldMatrix` |
| `viewMatrix`, `projectionMatrix` | `camera.view`, `camera.projection` |
| `modelViewMatrix * vec4(position, 1.0)` | Nothing: the engine transforms vertices; in full shaders use `sokko3d::vertex::toClip` |
| `normalMatrix` (view space in three.js) | `input.worldNormal` is already world space; for view space: `(camera.view * vec4f(n, 0.0)).xyz` |
| `cameraPosition` | `camera.position` |
| Varyings such as `vWorldPosition`, `vViewDir`, `vNormal` | `input.worldPosition`, `input.relativePosition`, `input.viewDirection`, `input.worldNormal` |
| `instanceMatrix`, `instanceColor` | Handled by the engine; `input.color` includes the instance color |
| Uniform `time` passed by the app | `frame.time` |
| `#include <fog_fragment>` and fog uniforms | Nothing: fog is applied after the surface function |
| `#include <tonemapping_fragment>`, `<colorspace_fragment>` | Delete: the final pass does both, once |
| `#include <common>`, `<packing>` helpers | `sokko3d::math`, `sokko3d::depth` |
| `#include <lights_...>` and light uniforms | The engine lights surface functions; full shaders import `sokko3d::lighting` |

## 4. Coordinate, depth and color conventions

- Fragment coordinates: `input.fragCoord` has its origin at the top left with y pointing down; GLSL `gl_FragCoord` starts at the bottom left with y pointing up. For screen-space code ported from GLSL, use `frame.resolution.y - input.fragCoord.y` wherever the original used `gl_FragCoord.y`.
- Screen UVs in post effects: `input.uv` is (0, 0) at the top left. three.js full-screen passes use a `vUv` that is (0, 0) at the bottom left. Replace `vUv.y` with `1.0 - input.uv.y` where direction matters (gradients, top-of-screen effects).
- Texture UVs: textures loaded with `flipY: true` sample the same as three.js's `TextureLoader` default. glTF textures use `flipY: false` in both engines. Keep the original's setting, and the ported shader's UV math stays the same.
- Depth: WebGPU uses a clip-space depth range of 0 to 1 and the engine uses reversed depth there (near is 1, far is 0); WebGL2 uses the standard range. Do not port three.js depth formulas such as `perspectiveDepthToViewZ` or `readDepth`; use `sokko3d::depth::linearDepth(d)` and `sokko3d::depth::viewZ(d)`, which are correct on both backends.
- Color output: engine surfaces are linear, and the final pass converts to the display once. A three.js `ShaderMaterial` without `<colorspace_fragment>` writes its values straight to the screen, so its colors were effectively sRGB. Convert such constants with `sokko3d::color::srgbToLinear`, or pass them as `'#rrggbb'` uniforms, which the engine converts.
- Matrices are column-major in both, and `matrix * vector` keeps its order.

## 5. ShaderMaterial and RawShaderMaterial

1. List the uniforms. Each becomes an entry in `uniforms` (numbers, `'#rrggbb'` colors, arrays) or `textures`. Updates such as `material.uniforms.uSpeed.value = 2` become `material.set({ speed: 2 })`.
2. Read the vertex shader. If it only applies `projectionMatrix * modelViewMatrix * vec4(position, 1.0)` and passes varyings along, drop it: the engine does both. If it moves vertices, port that part as `vertexOffset`.
3. Read the fragment shader. Map its varyings to `SurfaceInput` fields and its output to `Surface` fields: lit look to `baseColor`, `roughness` and `metalness`; unlit look to `emissive` with `baseColor` set to zero; transparency to `alpha` plus the right `alphaMode`.
4. Set the material options that were ShaderMaterial flags: `transparent` becomes `alphaMode: 'blend'`, `side: DoubleSide` becomes `doubleSided: true`, `blending: AdditiveBlending` becomes `blending: 'additive'`, `depthWrite: false` stays `depthWrite: false`.
5. Compare parity images on WebGPU and WebGL2.

A `RawShaderMaterial` adds nothing automatically, so all its matrices and attributes are explicit; the same steps apply.

## 6. onBeforeCompile patterns

| What the patch does | sokko3d form |
| --- | --- |
| Changes `transformed` after `#include <begin_vertex>` | `vertexOffset` returning the change (new position minus old) |
| Changes `diffuseColor` after `<map_fragment>` or `<color_fragment>` | Surface function: `s.baseColor`, `s.alpha` |
| Changes `roughnessFactor` or `metalnessFactor` | `s.roughness`, `s.metalness` |
| Adds glow in `<emissivemap_fragment>` | `s.emissive` |
| Adds `discard` for dissolves or cut-outs | `alphaMode: 'mask'` and `s.alpha` |
| Adds a varying such as a world position | Use `input.worldPosition` or `input.relativePosition` |
| Replaces a lighting chunk | Full shader with `sokko3d::lighting`; confirm the need first |
| Stores `shader.uniforms` to update them later | `material.set({ ... })`, or `frame.time` for time |

Keep the original's standard options (color, maps, roughness) on the new material: `materials.shader` accepts every `materials.standard` option and feeds them to `defaultSurface()`.

## 7. TSL and node materials

| TSL | WGSL surface function |
| --- | --- |
| `uniform(0.5)`, and `u.value = x` | `uniforms: { name: 0.5 }`, and `material.set({ name: x })` |
| `texture(map, uv())` | `textureSample(map, mapSampler, input.uv)` |
| `uv()`, `uv(1)` | `input.uv`, `input.uv1` |
| `positionLocal` | `VertexInput.position` in `vertexOffset` |
| `positionWorld`, `normalWorld` | `input.worldPosition`, `input.worldNormal` |
| `normalView` | `(camera.view * vec4f(input.worldNormal, 0.0)).xyz` |
| `cameraPosition`, `time` | `camera.position`, `frame.time` |
| `vertexColor()`, `instanceIndex` | `input.color`, `input.instance` |
| `screenUV` | `input.fragCoord.xy / frame.resolution` in surfaces, `input.uv` in effects |
| `add`, `sub`, `mul`, `div`, `.add()` chains | `+`, `-`, `*`, `/` |
| `oneMinus(x)`, `saturate(x)` | `1.0 - x`, `saturate(x)` |
| `mx_noise_float(p)` and other MaterialX noise | `sokko3d::noise::simplex3(p)`, `fbm3` (values differ; tune) |
| `Fn(() => { ... })`, `If`, `Loop`, `.toVar()` | `fn`, `if`, `for`, `var` |
| `material.colorNode`, `opacityNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `aoNode` | `s.baseColor`, `s.alpha`, `s.roughness`, `s.metalness`, `s.normal`, `s.emissive`, `s.occlusion` |
| `material.positionNode` | `vertexOffset` returning `newPosition - input.position` |
| `material.fragmentNode`, `outputNode`, `mrtNode` | Full shader or post effect; `mrtNode` has no equivalent |

## 8. Vertex displacement and displacement maps

```ts
const terrain = materials.shader({
  map: groundColor, normalMap: groundNormal,        // standard options still apply
  uniforms: { scale: 2.0, bias: 0.0 },
  textures: { height: heightMap },                  // linear color space
  vertexOffset: /* wgsl */ `
    fn vertexOffset(input: VertexInput) -> vec3f {
      let h = textureSampleLevel(height, heightSampler, input.uv, 0.0).r;
      return input.normal * (h * material.scale + material.bias);
    }`,
});
terrainMesh.setBounds([0, 1, 0], 60);  // include the highest displaced point
```

Vertex shaders must use `textureSampleLevel`: implicit mip selection does not exist in the vertex stage. Normals are not recomputed after displacement, so keep the original's normal map, or compute a normal from neighboring height samples in the surface function.

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
// sokko3d
const glow = materials.shader({
  alphaMode: 'blend', blending: 'additive', depthWrite: false,
  uniforms: { color: '#44aaff', power: 3 },
  surface: /* wgsl */ `
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let f = pow(1.0 - max(dot(input.worldNormal, input.viewDirection), 0.0), material.power);
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
// sokko3d: the standard options of the original material stay
const foliage = materials.shader({
  map: leafColor, alphaMode: 'mask', alphaCutoff: 0.5, doubleSided: true,
  uniforms: { strength: 0.1 },
  vertexOffset: /* wgsl */ `
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

The sokko3d version is the dissolve example in the sokko3d-develop skill's `references/shaders.md` (section 2). The mapping is one to one: `opacityNode` becomes `s.alpha`, `emissiveNode` becomes `s.emissive`, and `alphaTest` becomes `alphaMode: 'mask'` with `alphaCutoff`.

## 10. Pitfalls checklist

- `textureSample` inside a branch that differs between pixels fails to compile in WGSL (GLSL allowed it). Sample before the branch, or use `textureSampleLevel`.
- `%` is not `mod`: negative inputs give different results.
- No swizzle assignment (`v.xy = ...`): write the whole vector.
- Flip y for `gl_FragCoord` and full-screen UV math (section 4).
- Replace depth formulas with `sokko3d::depth` helpers.
- Convert raw sRGB color constants from ShaderMaterials (section 4).
- three.js `normalMatrix` is view space; sokko3d normals are world space.
- WGSL does not mix `f32` and `i32` in arithmetic: cast explicitly.
- Avoid `mat3x3f` uniforms: their layout pads each column. Pass three `vec3f` values or a `mat4x4f`.
- Use only the three WGSL language features every browser shares, and `@interpolate(flat, either)` for flat values (sokko3d-develop `references/shaders.md`, section 8).
- Test on WebGL2 (`?gpu=webgl2`): the translated GLSL can hit limits the WGSL did not.
