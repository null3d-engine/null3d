# Porting post-processing

three.js chains full-screen passes, each reading and writing the whole screen. null3D has a built-in chain: an HDR scene buffer, then one final pass that merges exposure, tone mapping, FXAA and dithering. Half-resolution bloom and ambient occlusion, color grading and per-pixel custom effects join the chain in 0.2. You port settings, not passes. Engine docs: `porting/threejs-postprocessing`, `api/post`, `concepts/post-processing`, `concepts/backends`.

Versions: the HDR scene buffer, the final pass and `post.set({ toneMapping, exposure })` are built. Every other setting in this file, `post.addEffect` and custom passes come in 0.2. Until then, a port keeps only the tone mapping and the exposure of the three.js chain, and the report lists each effect it dropped.

## Contents

1. Porting method
2. three.js EffectComposer passes
3. pmndrs postprocessing effects
4. three.js WebGPU post nodes (TSL)
5. Custom passes (0.2)
6. Traps

## 1. Porting method

1. Write down the original chain in order, with each pass's parameters.
2. Delete `EffectComposer`, `RenderPass`, `OutputPass`, `GammaCorrectionShader` and `composer.render()`.
3. Match tone mapping and exposure first: `post.set({ toneMapping, exposure })` (0.1). `ACESFilmicToneMapping`, `AgXToneMapping` and `NeutralToneMapping` become `'aces'`, `'agx'` and `'neutral'`, with the same formulas. `LinearToneMapping` and `NoToneMapping` both become `'none'`; `NoToneMapping` ignores `toneMappingExposure`, so keep `exposure` at 1 for it.
4. Add effects one at a time with `post.set` (0.2), and compare parity images after each.
5. Port custom passes last, as `post.addEffect` (0.2, section 5).

## 2. three.js EffectComposer passes

| Pass and parameters | null3D | Notes |
| --- | --- | --- |
| `RenderPass(scene, camera)` | Nothing | The scene pass is built in |
| `OutputPass` | Nothing | The engine's final pass tone maps and converts to sRGB for the display once |
| `GammaCorrectionShader`, `SRGBShader` in a `ShaderPass` | Delete | Keeping it applies gamma twice |
| `UnrealBloomPass(resolution, strength, radius, threshold)` | `bloom: { strength, radius, threshold }` (0.2) | `resolution` is not needed: bloom runs at half resolution |
| `SSAOPass` (`kernelRadius`, `minDistance`, `maxDistance`) | `ao: { radius, intensity }` (0.2) | GTAO on High and Ultra presets; start with radius in world units about the original kernel radius |
| `SAOPass`, `GTAOPass`, N8AO | `ao: { radius, intensity }` (0.2) | Same |
| `FXAAPass`, `ShaderPass(FXAAShader)` | `createEngine({ antialias: 'fxaa' })` on the page | FXAA runs inside the final pass; the Low preset uses it |
| `SMAAPass`, `SSAARenderPass` | MSAA, which the presets from Medium use, or `createEngine({ antialias: 'fxaa' })` | No SMAA or SSAA |
| `TAARenderPass` | Not in 1.0 | MSAA meanwhile |
| `OutlinePass` (`edgeStrength`, `edgeThickness`, `visibleEdgeColor`, `hiddenEdgeColor`, `pulsePeriod`, `selectedObjects`) | `outline: { color, thickness }` and `obj.setOutlined(true)` (0.2) | Hidden-edge color and pulsing: custom effect or after 1.0 |
| `LUTPass` with `LUTCubeLoader` or `LUT3dlLoader` | `lut: await assets.loadLut(url)` (0.2) | |
| `BokehPass` (depth of field) | Not in 1.0 | Custom `hdr` effect with `sampleDepth` (0.2), or skip |
| `SSRPass`, `ReflectorForSSRPass` | Not in 1.0 | Environment reflections (0.2) |
| `FilmPass`, `GlitchPass`, `HalftonePass`, `DotScreenPass`, `RenderPixelatedPass`, `AfterimagePass` | `post.addEffect` (0.2) | Cookbook recipes cover film grain, pixelation and afterimage |
| `ShaderPass(customShader)` | `post.addEffect({ name, wgsl, uniforms })` (0.2) | GLSL to WGSL: `references/shaders.md` |
| `ClearPass`, `MaskPass`, `TexturePass` | A custom pass (0.2), if still needed | Masks usually become layers |

## 3. pmndrs postprocessing effects

| Effect | null3D |
| --- | --- |
| `EffectComposer`, `RenderPass`, `EffectPass` | Nothing: settings go in `post.set` (tone mapping now, effects in 0.2) |
| `BloomEffect` (`intensity`, `luminanceThreshold`, `luminanceSmoothing`, `mipmapBlur`) | `bloom: { strength: intensity, threshold: luminanceThreshold }` (0.2); smoothing and mip blur are built in |
| `ToneMappingEffect` (`mode`) | `toneMapping` |
| `SMAAEffect`, `FXAAEffect` | MSAA, which the presets from Medium use, or `createEngine({ antialias: 'fxaa' })` |
| `VignetteEffect` (`offset`, `darkness`) | `vignette: { amount }` (0.2); tune until it matches |
| `SSAOEffect`, N8AO | `ao` (0.2) |
| `LUT3DEffect` | `lut` (0.2) |
| `ChromaticAberrationEffect`, `NoiseEffect`, `ScanlineEffect`, `PixelationEffect` | `post.addEffect` (0.2; per-pixel, so they merge into the final pass) |
| `DepthOfFieldEffect`, `GodRaysEffect`, `SSREffect` | Not in 1.0; custom `hdr` effects (0.2) where essential |
| `OutlineEffect`, `SelectiveBloomEffect` | `outline` (0.2); selective bloom through emissive strength and the bloom threshold (0.2) |

## 4. three.js WebGPU post nodes (TSL)

| three.js | null3D |
| --- | --- |
| `new PostProcessing(renderer)`, `pass(scene, camera)`, `postProcessing.outputNode = ...` | `post.set` (tone mapping now, effects in 0.2) |
| `bloom(node, strength, radius, threshold)` | `bloom: { strength, radius, threshold }` (0.2) |
| `fxaa(node)`, `smaa(node)` | `createEngine({ antialias: 'fxaa' })`, or MSAA, which the presets from Medium use |
| `ao(...)`, `gtao(...)` | `ao` (0.2) |
| `dof(...)`, `ssr(...)` | Not in 1.0 |
| Custom node graphs on the scene color | `post.addEffect` in WGSL (0.2) |

## 5. Custom passes (0.2)

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
- Background: null3D tone maps the background color with the scene, as three.js's WebGPURenderer does. WebGLRenderer does not, so with `'aces'` or `'agx'` a dark background comes out darker. Where the exact color matters, use `toneMapping: 'none'` or a transparent canvas over a CSS background.
- Tone mapping twice: `renderer.toneMapping` and a tone-mapping pass in the same three.js app means the original was tone-mapped twice. Decide with the user which look to keep. null3D tone-maps once.
- Order: three.js lets you tone-map before bloom. null3D will always bloom in HDR before tone mapping (0.2), which is physically correct but can look stronger. Lower `strength` to match.
- Resolution: three.js bloom set to full resolution looks sharper than null3D's half-resolution bloom (0.2). Compare at the target resolution, not zoomed in.
- Pixel ratio: many three.js composers render at the full device pixel ratio. Compare at a fixed pixel ratio.
