# Porting post-processing

three.js chains full-screen passes, each reading and writing the whole screen. null3D has a built-in chain: an HDR scene buffer, ambient occlusion at half size before the opaque pass, and mip-chain bloom. One final pass then merges bloom, exposure, tone mapping, FXAA, dithering, color grading and the vignette. Per-pixel custom effects join the chain later in 0.2. You port settings, not passes. Engine docs: `porting/threejs-postprocessing`, `api/post`, `concepts/post-processing`, `concepts/backends`.

Versions: the HDR scene buffer, the final pass, `post.set({ toneMapping, exposure })`, `bloom`, `ao`, `lut` and `vignette` (0.2) are built. Every other setting in this file, `post.addEffect` and custom passes come later in 0.2. Until then, a port keeps the tone mapping, the exposure, bloom, ambient occlusion, color grading and the vignette of the three.js chain. The report lists each effect it dropped.

## Contents

1. Porting method
2. three.js EffectComposer passes
3. pmndrs postprocessing effects
4. three.js WebGPU post nodes (TSL)
5. Bloom settings
6. Custom passes (0.2)
7. Traps

## 1. Porting method

1. Write down the original chain in order, with each pass's parameters.
2. Delete `EffectComposer`, `RenderPass`, `OutputPass`, `GammaCorrectionShader` and `composer.render()`.
3. Match tone mapping and exposure first: `post.set({ toneMapping, exposure })` (0.1). `ACESFilmicToneMapping`, `AgXToneMapping` and `NeutralToneMapping` become `'aces'`, `'agx'` and `'neutral'`, with the same formulas. `LinearToneMapping` and `NoToneMapping` both become `'none'`; `NoToneMapping` ignores `toneMappingExposure`, so keep `exposure` at 1 for it. Copy `toneMappingExposure` to `exposure` unchanged: null3D applies it to each light, which gives the same image.
4. Add effects one at a time with `post.set` (0.2), and compare parity images after each.
5. Port custom passes last, as `post.addEffect` (0.2, section 5).

## 2. three.js EffectComposer passes

| Pass and parameters | null3D | Notes |
| --- | --- | --- |
| `RenderPass(scene, camera)` | Nothing | The scene pass is built in |
| `OutputPass` | Nothing | The engine's final pass tone maps and converts to sRGB for the display once |
| `GammaCorrectionShader`, `SRGBShader` in a `ShaderPass` | Delete | Keeping it applies gamma twice |
| `UnrealBloomPass(resolution, strength, radius, threshold)` | `bloom: { intensity, threshold, knee: 0.01, blend: 'add', weights }` (0.2) | A mip chain, so map the settings (section 5). `resolution` is not needed: bloom takes the canvas's size |
| `GTAOPass` with `updateGtaoMaterial({ radius, thickness, distanceExponent, distanceFallOff, scale, samples })` | `ao: { radius, thickness, distanceExponent, distanceFalloff, scale, samples }` (0.2) | `GTAOPass`'s own search and denoise at half size, so keep the numbers; `blendIntensity` becomes `intensity`. Add `quality.set({ aoScale: 0.5 })` where phones and tablets should draw it |
| `SSAOPass` (`kernelRadius`, `minDistance`, `maxDistance`) | `ao: { radius, intensity }` (0.2) | Start with radius in world units about the original kernel radius |
| `SAOPass`, N8AO | `ao: { radius, intensity }` (0.2) | Same |
| `FXAAPass`, `ShaderPass(FXAAShader)` | `createEngine({ antialias: 'fxaa' })` on the page | FXAA runs inside the final pass; the Low preset uses it |
| `SMAAPass`, `SSAARenderPass` | MSAA, which the presets from Medium use, or `createEngine({ antialias: 'fxaa' })` | No SMAA or SSAA |
| `TAARenderPass` | Not in 1.0 | MSAA meanwhile |
| `OutlinePass` (`visibleEdgeColor`, `hiddenEdgeColor`, `edgeThickness`, `selectedObjects`) | `outline: { color, hiddenColor, width }` and `mesh.setOutlined(true)` (0.2) | A crisp line, with no blur. `visibleEdgeColor` becomes `color` and `hiddenEdgeColor` becomes `hiddenColor`. `OutlinePass` draws its edge at half size, so `width` is about 2 × `edgeThickness`. three.js draws a dark brown hidden line by default; keep it with `hiddenColor: [0.1, 0.04, 0.02]`, as null3D draws none by default. `edgeStrength` has no setting, as the line is opaque. `edgeGlow` above 0, `pulsePeriod` and the pattern texture have no setting: list the soft look as a visible difference. To pulse the line, change its color or width every frame. Select a model with `setOutlined` on its copy from `scene.instantiate`. One style covers every outlined mesh |
| `LUTPass` with `LUTCubeLoader` or `LUT3dlLoader` | `lut: await assets.loadLut(url)`, `lutIntensity` (0.2) | `intensity` becomes `lutIntensity`. The table grades after the tone mapping, as after `OutputPass`. `LUTImageLoader` strips: export a `.cube` file |
| `ShaderPass(VignetteShader)` (`offset`, `darkness`) | `vignette: { offset, darkness }` (0.2) | Same meanings, so keep the two numbers |
| `BokehPass` (depth of field) | Not in 1.0 | Custom `hdr` effect with `sampleDepth` (0.2), or skip |
| `SSRPass`, `ReflectorForSSRPass` | Not in 1.0 | Environment reflections (0.2) |
| `FilmPass`, `GlitchPass`, `HalftonePass`, `DotScreenPass`, `RenderPixelatedPass`, `AfterimagePass` | `post.addEffect` (0.2) | Cookbook recipes cover film grain, pixelation and afterimage |
| `ShaderPass(customShader)` | `post.addEffect({ name, wgsl, uniforms })` (0.2) | GLSL to WGSL: `references/shaders.md` |
| `ClearPass`, `MaskPass`, `TexturePass` | A custom pass (0.2), if still needed | Masks usually become layers |

## 3. pmndrs postprocessing effects

| Effect | null3D |
| --- | --- |
| `EffectComposer`, `RenderPass`, `EffectPass` | Nothing: settings go in `post.set` (tone mapping now, effects in 0.2) |
| `BloomEffect` (`intensity`, `luminanceThreshold`, `luminanceSmoothing`, `radius`, `levels`, `mipmapBlur`) | `bloom: { intensity, threshold: luminanceThreshold, knee: luminanceSmoothing, blend: 'screen', weights }` (0.2), mapped (section 5). `mipmapBlur: false` (Kawase) has no match: map it as the mip blur and list the difference |
| `ToneMappingEffect` (`mode`) | `toneMapping` |
| `SMAAEffect`, `FXAAEffect` | MSAA, which the presets from Medium use, or `createEngine({ antialias: 'fxaa' })` |
| `VignetteEffect` (`offset`, `darkness`) | `vignette: { offset, darkness }` (0.2): the `ESKIL` technique's meanings; tune the numbers for the default technique |
| `SSAOEffect`, N8AO | `ao` (0.2) |
| `LUT3DEffect` | `lut: await assets.loadLut(url)` (0.2) |
| `ChromaticAberrationEffect`, `NoiseEffect`, `ScanlineEffect`, `PixelationEffect` | `post.addEffect` (0.2; per-pixel, so they merge into the final pass) |
| `DepthOfFieldEffect`, `GodRaysEffect`, `SSREffect` | Not in 1.0; custom `hdr` effects (0.2) where essential |
| `OutlineEffect` (`visibleEdgeColor`, `hiddenEdgeColor`, `xRay`, `resolutionScale`, `blur`, `pulseSpeed`) | `outline: { color, hiddenColor, width }` (0.2): a crisp line. `visibleEdgeColor` becomes `color` and `hiddenEdgeColor` becomes `hiddenColor`; `xRay: false` becomes `hiddenColor: false`. The edge is one texel of the effect's mask, so `width` is about 1 / `resolutionScale` (2 at the default 0.5). `blur` and `pulseSpeed` have no setting: list them as visible differences |
| `SelectiveBloomEffect` | Selective bloom through emissive strength and the bloom threshold (0.2) |

## 4. three.js WebGPU post nodes (TSL)

| three.js | null3D |
| --- | --- |
| `new PostProcessing(renderer)`, `pass(scene, camera)`, `postProcessing.outputNode = ...` | `post.set` (tone mapping now, effects in 0.2) |
| `bloom(node, strength, radius, threshold)` | `bloom: { ..., blend: 'add' }` (0.2), mapped as `UnrealBloomPass` at a third of the intensity (section 5) |
| `fxaa(node)`, `smaa(node)` | `createEngine({ antialias: 'fxaa' })`, or MSAA, which the presets from Medium use |
| `ao(...)`, `gtao(...)` | `ao` (0.2) |
| `dof(...)`, `ssr(...)` | Not in 1.0 |
| Custom node graphs on the scene color | `post.addEffect` in WGSL (0.2) |

## 5. Bloom settings

null3D's bloom is a chain of 10 mip levels sized on the canvas's shorter side, so its glow is a share of the screen (`concepts/post-processing`). three.js's glow spans a number of pixels. No setting carries over one to one: map them. The match holds at one canvas size; on a larger screen null3D's glow looks wider, and on a smaller one narrower. Say so in the port's report.

1. Ask for the app's usual canvas: its shorter side in device pixels (CSS pixels times the pixel ratio that the preset allows). Use 1080 when unknown.
2. At 1080, read the tables below. Otherwise run the script, which fits the same way at any size and prints the settings as JSON:

```sh
node <this-skill-dir>/scripts/map-bloom.mjs unreal --strength 1.5 --radius 0.4 --threshold 0.85 --canvas 1440
node <this-skill-dir>/scripts/map-bloom.mjs node --strength 1 --radius 0.5 --threshold 0
node <this-skill-dir>/scripts/map-bloom.mjs pmndrs --intensity 1 --luminance-threshold 0.9 --radius 0.85 --canvas 720
```

3. Between table rows, interpolate the weights linearly by radius.
4. Keep the source's threshold. Keep `blend`: `'add'` for `UnrealBloomPass` and `bloom()`, `'screen'` for pmndrs. The engine's default, `'mix'`, keeps the image's light; offer it to the user as an option, not as the port.

<!-- null3d:bloom-table:start -->
`UnrealBloomPass`, for a canvas whose short side is 1080 device pixels. Set `blend: 'add'` and `knee: 0.01`, and keep the threshold. Multiply the intensity by `strength`.

| `radius` | Intensity per unit of `strength` | `weights` |
| --- | --- | --- |
| 0 | 8.809 | `[0.06, 0.268, 0.161, 0.156, 0.144, 0.1, 0.084, 0.026, 0, 0]` |
| 0.25 | 8.788 | `[0.048, 0.215, 0.14, 0.14, 0.152, 0.106, 0.143, 0.056, 0, 0]` |
| 0.5 | 8.766 | `[0.05, 0.132, 0.135, 0.132, 0.138, 0.135, 0.189, 0.089, 0, 0]` |
| 0.75 | 8.744 | `[0.039, 0.082, 0.107, 0.116, 0.131, 0.177, 0.219, 0.128, 0, 0]` |
| 1 | 8.723 | `[0.024, 0.041, 0.061, 0.096, 0.153, 0.221, 0.243, 0.151, 0.01, 0]` |

pmndrs `BloomEffect` with `mipmapBlur` and 8 levels, for the same canvas. Set `blend: 'screen'`. The threshold is `luminanceThreshold` and the knee is `luminanceSmoothing`. Multiply the intensity by `intensity`.

| `radius` | Intensity per unit of `intensity` | `weights` |
| --- | --- | --- |
| 0.6 | 1 | `[0.386, 0.256, 0.15, 0.083, 0.049, 0.03, 0.024, 0.022, 0, 0]` |
| 0.7 | 1 | `[0.29, 0.219, 0.153, 0.099, 0.066, 0.055, 0.058, 0.048, 0.013, 0]` |
| 0.85 | 1.001 | `[0.143, 0.13, 0.12, 0.101, 0.058, 0.038, 0.149, 0.24, 0.021, 0]` |
| 0.95 | 1.001 | `[0.051, 0.045, 0.043, 0.057, 0.038, 0, 0.115, 0.652, 0, 0]` |
<!-- null3d:bloom-table:end -->

For the `bloom()` node, take `UnrealBloomPass`'s row and divide the intensity by 3: the node returns the glow alone, and the port adds it.

## 6. Custom passes (0.2)

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

## 7. Traps

- Double gamma: a leftover gamma or sRGB pass washes the image out. Delete them all.
- Background: null3D tone maps the background color with the scene, as three.js's WebGPURenderer does. WebGLRenderer does not, so with `'aces'` or `'agx'` a dark background comes out darker. Where the exact color matters, use `toneMapping: 'none'` or a transparent canvas over a CSS background.
- Tone mapping twice: `renderer.toneMapping` and a tone-mapping pass in the same three.js app means the original was tone-mapped twice. Decide with the user which look to keep. null3D tone-maps once.
- Order: three.js lets you tone-map before bloom. null3D always blooms in HDR before tone mapping, as `UnrealBloomPass` before `OutputPass` does. An original that tone-mapped first looks weaker; raise `intensity` to match.
- Threshold: null3D's default threshold is 0, so all light glows a little, and its default intensity is low. A port always sets `threshold` from the source, which defaults to 1 in `UnrealBloomPass` and 0.9 in pmndrs `BloomEffect`. The threshold is in color before the exposure, as in three.js, at any exposure.
- Bloom's size: the quality setting `bloomSize` (128 on Low, 512 elsewhere) changes the glow's detail, not its size. Do not map `resolution` or `resolutionScale` onto it.
- Compatibility mode: in WebGPU's compatibility mode with MSAA, bloom moves the engine to HDR color with FXAA, so edges there look as with FXAA (`concepts/post-processing`).
- Ambient occlusion: `GTAOPass` darkens the whole image, and null3D only the ambient light. A sunlit corner keeps its sunlight, so the port looks lighter where direct light falls. On the Low and Medium presets `aoScale` is 0, so it draws nothing there until the sketch sets the scale.
- Pixel ratio: many three.js composers render at the full device pixel ratio. Compare at a fixed pixel ratio.
