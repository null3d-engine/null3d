# Porting post-processing

three.js chains full-screen passes, each reading and writing the whole screen. null3D has a built-in chain: an HDR scene buffer, optional half-resolution bloom and ambient occlusion, then one final pass that merges tone mapping, grading, per-pixel custom effects, FXAA and dithering. You port settings, not passes. Engine docs: `porting/threejs-postprocessing`, `api/post`, `concepts/post-processing`.

## Contents

1. Porting method
2. three.js EffectComposer passes
3. pmndrs postprocessing effects
4. three.js WebGPU post nodes (TSL)
5. Custom passes
6. Traps

## 1. Porting method

1. Write down the original chain in order, with each pass's parameters.
2. Delete `EffectComposer`, `RenderPass`, `OutputPass`, `GammaCorrectionShader` and `composer.render()`.
3. Match tone mapping and exposure first: `post.set({ toneMapping, exposure })` (0.1).
4. Add effects one at a time with `post.set` (0.2), and compare parity images after each.
5. Port custom passes last, as `post.addEffect` (section 5).

## 2. three.js EffectComposer passes

| Pass and parameters | null3D | Notes |
| --- | --- | --- |
| `RenderPass(scene, camera)` | Nothing | The scene pass is built in |
| `OutputPass` | Nothing | Tone mapping and sRGB output happen once, in the final pass |
| `GammaCorrectionShader`, `SRGBShader` in a `ShaderPass` | Delete | Keeping it applies gamma twice |
| `UnrealBloomPass(resolution, strength, radius, threshold)` | `bloom: { strength, radius, threshold }` | `resolution` is not needed: bloom runs at half resolution |
| `SSAOPass` (`kernelRadius`, `minDistance`, `maxDistance`) | `ao: { radius, intensity }` | GTAO on High and Ultra presets; start with radius in world units about the original kernel radius |
| `SAOPass`, `GTAOPass`, N8AO | `ao: { radius, intensity }` | Same |
| `FXAAPass`, `ShaderPass(FXAAShader)` | `fxaa: true` | The preset uses MSAA where it can |
| `SMAAPass`, `SSAARenderPass` | MSAA (preset) or `fxaa: true` | No SMAA or SSAA |
| `TAARenderPass` | Not in 1.0 | MSAA meanwhile |
| `OutlinePass` (`edgeStrength`, `edgeThickness`, `visibleEdgeColor`, `hiddenEdgeColor`, `pulsePeriod`, `selectedObjects`) | `outline: { color, thickness }` and `obj.setOutlined(true)` | Hidden-edge color and pulsing: custom effect or after 1.0 |
| `LUTPass` with `LUTCubeLoader` or `LUT3dlLoader` | `lut: await assets.loadLut(url)` | |
| `BokehPass` (depth of field) | Not in 1.0 | Custom `hdr` effect with `sampleDepth`, or skip |
| `SSRPass`, `ReflectorForSSRPass` | Not in 1.0 | Environment reflections |
| `FilmPass`, `GlitchPass`, `HalftonePass`, `DotScreenPass`, `RenderPixelatedPass`, `AfterimagePass` | `post.addEffect` | Cookbook recipes cover film grain, pixelation and afterimage |
| `ShaderPass(customShader)` | `post.addEffect({ name, wgsl, uniforms })` | GLSL to WGSL: `references/shaders.md` |
| `ClearPass`, `MaskPass`, `TexturePass` | A custom pass, if still needed | Masks usually become layers |

## 3. pmndrs postprocessing effects

| Effect | null3D |
| --- | --- |
| `EffectComposer`, `RenderPass`, `EffectPass` | Nothing: settings go in `post.set` |
| `BloomEffect` (`intensity`, `luminanceThreshold`, `luminanceSmoothing`, `mipmapBlur`) | `bloom: { strength: intensity, threshold: luminanceThreshold }`; smoothing and mip blur are built in |
| `ToneMappingEffect` (`mode`) | `toneMapping` |
| `SMAAEffect`, `FXAAEffect` | MSAA (preset) or `fxaa: true` |
| `VignetteEffect` (`offset`, `darkness`) | `vignette: { amount }`; tune until it matches |
| `SSAOEffect`, N8AO | `ao` |
| `LUT3DEffect` | `lut` |
| `ChromaticAberrationEffect`, `NoiseEffect`, `ScanlineEffect`, `PixelationEffect` | `post.addEffect` (per-pixel, so they merge into the final pass) |
| `DepthOfFieldEffect`, `GodRaysEffect`, `SSREffect` | Not in 1.0; custom `hdr` effects where essential |
| `OutlineEffect`, `SelectiveBloomEffect` | `outline`; selective bloom through emissive strength and the bloom threshold |

## 4. three.js WebGPU post nodes (TSL)

| three.js | null3D |
| --- | --- |
| `new PostProcessing(renderer)`, `pass(scene, camera)`, `postProcessing.outputNode = ...` | `post.set` |
| `bloom(node, strength, radius, threshold)` | `bloom: { strength, radius, threshold }` |
| `fxaa(node)`, `smaa(node)` | `fxaa: true`, or MSAA |
| `ao(...)`, `gtao(...)` | `ao` |
| `dof(...)`, `ssr(...)` | Not in 1.0 |
| Custom node graphs on the scene color | `post.addEffect` in WGSL |

## 5. Custom passes

Port a custom `ShaderPass` in three steps:

1. Translate the fragment shader to an `effect` function (`references/shaders.md`). `tDiffuse` becomes `sampleScene(uv)`; depth reads become `sampleDepth(uv)` with `null3d::depth` helpers.
2. Choose the stage. Per-pixel effects that read the scene at their own pixel, or a few neighbors, use `stage: 'final'` and cost almost nothing. Effects that blur or read many neighbors use `stage: 'hdr'` and get their own pass.
3. Flip vertical UV math: null3D effect UVs start at the top left (`references/shaders.md`, section 4).

```ts
// three.js ShaderPass: uniform float amount; tDiffuse; vUv
// gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb * (1.0 - amount * length(vUv - 0.5)), 1.0);
post.addEffect({
  name: 'darken-edges',
  stage: 'final',
  uniforms: { amount: 0.6 },
  wgsl: /* wgsl */ `
    fn effect(input: EffectInput) -> vec4f {
      let c = sampleScene(input.uv);
      return vec4f(c.rgb * (1.0 - effect.amount * length(input.uv - vec2f(0.5))), c.a);
    }`,
});
```

This example is symmetric, so the UV flip does not matter here.

## 6. Traps

- Double gamma: a leftover gamma or sRGB pass washes the image out. Delete them all.
- Tone mapping twice: `renderer.toneMapping` and a tone-mapping pass in the same three.js app means the original was tone-mapped twice. Decide with the user which look to keep; null3D tone-maps once.
- Order: three.js lets you tone-map before bloom. null3D always blooms in HDR before tone mapping, which is physically correct but can look stronger; lower `strength` to match.
- Resolution: three.js bloom set to full resolution looks sharper than null3D's half-resolution bloom; compare at the target resolution, not zoomed in.
- Pixel ratio: many three.js composers render at the full device pixel ratio. Compare at a fixed pixel ratio.
