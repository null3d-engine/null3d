# Porting post-processing

three.js chains full-screen passes, each reading and writing the whole screen. null3D has a built-in chain: an HDR scene buffer, ambient occlusion at half size before the opaque pass, and mip-chain bloom. Custom effects (0.2) run after the scene and before bloom, on HDR color; the engine joins per-pixel effects into few passes. One final pass then merges bloom, tone mapping, FXAA, dithering, outlines, color grading and the vignette. You port settings, and custom shaders as effects. Engine docs: `porting/threejs-postprocessing`, `api/post`, `concepts/post-processing`, `concepts/backends`.

Versions: the HDR scene buffer, the final pass and `post.set({ toneMapping, exposure })` are built. So are `bloom`, `ao`, `outline`, `lut`, `vignette`, custom effects with `post.addEffect` and custom tone curves (0.2). Scene passes that render into a texture (`render.addPass({ kind: 'scene' })` with `textures.fromPass`) are built in 0.2, so `WebGLRenderTarget` render-to-texture ports. Full-screen passes of your own WGSL with `render.addPass` come later in 0.2: port a `ShaderPass` as a custom effect. The port's report lists each effect it dropped.

## Contents

1. Porting method
2. three.js EffectComposer passes
3. pmndrs postprocessing effects
4. three.js WebGPU post nodes (TSL)
5. Bloom settings
6. Custom effects (0.2)
7. Tone curves (0.2)
8. Traps

## 1. Porting method

1. Write down the original chain in order, with each pass's parameters.
2. Delete `EffectComposer`, `RenderPass`, `OutputPass`, `GammaCorrectionShader` and `composer.render()`.
3. Match tone mapping and exposure first: `post.set({ toneMapping, exposure })` (0.1). `ACESFilmicToneMapping`, `AgXToneMapping` and `NeutralToneMapping` become `'aces'`, `'agx'` and `'neutral'`, with the same formulas. `LinearToneMapping` and `NoToneMapping` both become `'none'`; `NoToneMapping` ignores `toneMappingExposure`, so keep `exposure` at 1 for it. Copy `toneMappingExposure` to `exposure` unchanged: null3D applies it to each light, which gives the same image. `ReinhardToneMapping`, `CineonToneMapping` and `CustomToneMapping` become a custom tone curve (0.2, section 7).
4. Add effects one at a time with `post.set` (0.2), and compare parity images after each.
5. Port each custom `ShaderPass` last, as a custom effect with `post.addEffect` (0.2, section 6).

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
| `ShaderPass(VignetteShader)` (`offset`, `darkness`) | `vignette: { size: offset, intensity: darkness }` (0.2) | null3D darkens HDR color before the tone curve, so bright corners darken instead of turning gray. The default `falloff` of 2 gives a close match. With `darkness` below 1, three.js also lifts dark corners toward a gray: list that as a visible difference |
| `BokehPass` (depth of field) | A custom effect that reads `effectDepth` (0.2), or skip | Section 6. A wide blur reads many pixels for each pixel, so check its cost on phones |
| `SSRPass`, `ReflectorForSSRPass` | Not in 1.0 | Environment reflections (0.2) |
| `FilmPass`, `GlitchPass`, `HalftonePass`, `DotScreenPass`, `RenderPixelatedPass` | `post.addEffect` (0.2), one effect each | Port the shader as in section 6. Grain sized for display color looks weaker on HDR color: tune it by eye. Effects take no textures, so `GlitchPass`'s random texture becomes `null3d::noise` |
| `AfterimagePass` | No port | It blends in the frame before, which an effect cannot read. List it as dropped |
| `ShaderPass(customShader)` | `post.addEffect({ wgsl, uniforms, order })` (0.2) | Section 6; GLSL to WGSL: `references/shaders.md` |
| `ClearPass`, `MaskPass`, `TexturePass` | A custom pass (0.2), if still needed | Masks usually become layers |

## 3. pmndrs postprocessing effects

| Effect | null3D |
| --- | --- |
| `EffectComposer`, `RenderPass`, `EffectPass` | Nothing: settings go in `post.set`, and custom effects in `post.addEffect` (0.2) |
| `BloomEffect` (`intensity`, `luminanceThreshold`, `luminanceSmoothing`, `radius`, `levels`, `mipmapBlur`) | `bloom: { intensity, threshold: luminanceThreshold, knee: luminanceSmoothing, blend: 'screen', weights }` (0.2), mapped (section 5). `mipmapBlur: false` (Kawase) has no match: map it as the mip blur and list the difference |
| `ToneMappingEffect` (`mode`) | `toneMapping`. `REINHARD`, `REINHARD2`, `CINEON`, `OPTIMIZED_CINEON` and `UNCHARTED2` become a custom tone curve (0.2, section 7), with their settings as constants |
| `SMAAEffect`, `FXAAEffect` | MSAA, which the presets from Medium use, or `createEngine({ antialias: 'fxaa' })` |
| `VignetteEffect` (`offset`, `darkness`) | `vignette: { size: offset, intensity: darkness }` (0.2) for the `ESKIL` technique; for the default technique, tune `intensity` and `size` by eye |
| `SSAOEffect`, N8AO | `ao` (0.2) |
| `LUT3DEffect` | `lut: await assets.loadLut(url)` (0.2) |
| `ChromaticAberrationEffect`, `NoiseEffect`, `ScanlineEffect`, `PixelationEffect` | `post.addEffect` (0.2), section 6. Effects that read only their own pixel join into one pass, so each can stay an effect of its own |
| `DepthOfFieldEffect`, `GodRaysEffect` | A custom effect (0.2) that reads `effectDepth`, where essential |
| `SSREffect` | Not in 1.0 |
| `OutlineEffect` (`visibleEdgeColor`, `hiddenEdgeColor`, `xRay`, `resolutionScale`, `blur`, `pulseSpeed`) | `outline: { color, hiddenColor, width }` (0.2): a crisp line. `visibleEdgeColor` becomes `color` and `hiddenEdgeColor` becomes `hiddenColor`; `xRay: false` becomes `hiddenColor: false`. The edge is one texel of the effect's mask, so `width` is about 1 / `resolutionScale` (2 at the default 0.5). `blur` and `pulseSpeed` have no setting: list them as visible differences |
| `SelectiveBloomEffect` | Selective bloom through emissive strength and the bloom threshold (0.2) |

## 4. three.js WebGPU post nodes (TSL)

| three.js | null3D |
| --- | --- |
| `new PostProcessing(renderer)`, `pass(scene, camera)`, `postProcessing.outputNode = ...` | `post.set`, and `post.addEffect` (0.2) for custom nodes |
| `bloom(node, strength, radius, threshold)` | `bloom: { ..., blend: 'add' }` (0.2), mapped as `UnrealBloomPass` at a third of the intensity (section 5) |
| `fxaa(node)`, `smaa(node)` | `createEngine({ antialias: 'fxaa' })`, or MSAA, which the presets from Medium use |
| `ao(...)`, `gtao(...)` | `ao` (0.2) |
| `dof(...)` | A custom effect (0.2) that reads `effectDepth` |
| `ssr(...)` | Not in 1.0 |
| Custom node graphs on the scene color | A custom effect in WGSL (0.2), section 6. The pass's color node becomes `input.color` or `effectColor(uv)`, and its depth node `effectDepth(uv)` |

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

## 6. Custom effects (0.2)

A custom effect is WGSL that declares `fn effect(input: EffectInput) -> vec4f`. The engine runs it once for each pixel, in a full-screen pass that it shares with the per-pixel effects after it. Engine docs `porting/threejs-postprocessing` hold a worked `RGBShiftShader` port and a depth fog. Port a `ShaderPass` in these steps:

1. Translate the fragment shader (`references/shaders.md`). `texture2D(tDiffuse, vUv)` becomes `input.color`. A read at another place becomes `effectColor(uv)`, and an exact texel `effectPixel(vec2i(p))`. `resolution` and `time` uniforms become `input.size` and `input.time`.
2. Depth reads become `effectDepth(uv)`, which is reversed: 1 at the near plane, 0 at the far plane and where nothing drew. `perspectiveDepthToViewZ(...)` becomes `effectViewPosition(uv).z`, and `-viewZ` becomes `effectDistance(uv)`.
3. Flip vertical math: `input.uv` and `input.pixel` start at the top left. `vUv.y` becomes `1.0 - input.uv.y`, and `gl_FragCoord.y` becomes `input.size.y - input.pixel.y`.
4. Declare the uniforms once, as `struct Uniforms { ... }`, and read them as `uniforms.name`. Types: `f32`, `i32`, `u32`, `vec2f`, `vec3f`, `vec4f`, up to 32 floats. A `vec3f` takes a `'#rrggbb'` color too. Effects take no textures: replace a noise texture with `null3d::noise`.
5. Pass the WGSL to `post.addEffect({ wgsl, uniforms, order })`. It must be a template literal after `/* wgsl */`, or a `.wgsl` import; plain text throws E1215. A wrong uniform name fails the type check, and throws E1216 at run time.
6. `pass.uniforms.x.value = v` becomes `post.setEffectUniform(fx, 'x', v)`, which allocates nothing. `pass.enabled = false` becomes `post.removeEffect(fx)`.
7. Keep the chain's order with `order`: effects run from the lowest to the highest, and ties in the order they were added. At most 8 run at once; a ninth throws E1213.
8. Keep each look an effect of its own: the engine joins the ones that read only their own pixel. Put an effect that reads other pixels, such as a blur, first in its chain, since it starts a new pass. Add the effects before the first frame: on WebGL2 in Chrome on Android, effects added later stay a pass each.

```ts
// three.js ShaderPass: uniform float amount; tDiffuse; vUv
// gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb * (1.0 - amount * length(vUv - 0.5)), 1.0);
const darken = post.addEffect({
  wgsl: /* wgsl */ `
    struct Uniforms { amount: f32 }

    fn effect(input: EffectInput) -> vec4f {
      let c = input.color;
      return vec4f(c.rgb * (1.0 - uniforms.amount * length(input.uv - vec2f(0.5))), c.a);
    }`,
  uniforms: { amount: 0.6 },
});
post.setEffectUniform(darken, 'amount', 0.8);   // pass.uniforms.amount.value = 0.8
```

This example is symmetric, so the uv flip does not matter here. It keeps the alpha: `input.color` holds color multiplied by its coverage, which alpha holds.

## 7. Tone curves (0.2)

`post.set({ toneMapping: wgsl })` takes a custom tone curve: WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`. It gets the exposed linear color after bloom. The engine clamps the result to 0 to 1, then encodes sRGB, dithers and grades. A tone curve takes no uniforms, so write settings as constants. `post.set({ toneMapping: 'aces' })` returns to a built-in curve.

three.js's curves multiply by `toneMappingExposure` first. Leave that out, and copy the exposure to `exposure`, as null3D's color arrives exposed:

```ts
// ReinhardToneMapping
const reinhard = /* wgsl */ `
  fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
  }`;

// CineonToneMapping
const cineon = /* wgsl */ `
  fn toneCurve(color: vec3f) -> vec3f {
    let c = max(vec3f(0.0), color - vec3f(0.004));
    return pow((c * (6.2 * c + vec3f(0.5))) / (c * (6.2 * c + vec3f(1.7)) + vec3f(0.06)), vec3f(2.2));
  }`;

post.set({ toneMapping: reinhard, exposure: 1.5 });   // toneMappingExposure = 1.5
```

For `CustomToneMapping`, copy the body of the app's patched `CustomToneMapping` GLSL function into `toneCurve`, translated to WGSL.

## 8. Traps

- Double gamma: a leftover gamma or sRGB pass washes the image out. Delete them all.
- Background: null3D tone maps the background color with the scene, as three.js's WebGPURenderer does. WebGLRenderer does not, so with `'aces'` or `'agx'` a dark background comes out darker. Where the exact color matters, use `toneMapping: 'none'` or a transparent canvas over a CSS background.
- Tone mapping twice: `renderer.toneMapping` and a tone-mapping pass in the same three.js app means the original was tone-mapped twice. Decide with the user which look to keep. null3D tone-maps once.
- Order: three.js lets you tone-map before bloom. null3D always blooms in HDR before tone mapping, as `UnrealBloomPass` before `OutputPass` does. An original that tone-mapped first looks weaker; raise `intensity` to match.
- Threshold: null3D's default threshold is 0, so all light glows a little, and its default intensity is low. A port always sets `threshold` from the source, which defaults to 1 in `UnrealBloomPass` and 0.9 in pmndrs `BloomEffect`. The threshold is in color before the exposure, as in three.js, at any exposure.
- Bloom's size: the quality setting `bloomSize` (128 on Low, 512 elsewhere) changes the glow's detail, not its size. Do not map `resolution` or `resolutionScale` onto it.
- HDR targets: in WebGPU's compatibility mode with MSAA, bloom, the first effect or a custom tone curve moves the engine to HDR color with FXAA. Edges there look as with FXAA (`concepts/post-processing`). On a WebGL2 device with no float targets, all three stay off, and development builds warn once.
- HDR input: effects read linear HDR color after the exposure, before bloom and the tone curve. A `ShaderPass` before `OutputPass` read the same kind of color, unexposed. One after `OutputPass` read display color from 0 to 1. Retune what assumed display color, such as thresholds, grain amounts and sRGB color math: clamp, convert with `null3d::color`'s `linear_to_srgb` and `srgb_to_linear`, or tune by eye.
- Exposure in effects: with an exposure other than 1, scale a ported effect's thresholds by the exposure.
- Effect order: effects run before bloom. A three.js pass after `UnrealBloomPass` now runs before it, so bloom spreads its result.
- Debug views turn effects and the custom tone curve off.
- Ambient occlusion: `GTAOPass` darkens the whole image, and null3D only the ambient light. A sunlit corner keeps its sunlight, so the port looks lighter where direct light falls. On the Low and Medium presets `aoScale` is 0, so it draws nothing there until the sketch sets the scale.
- Pixel ratio: many three.js composers render at the full device pixel ratio. Compare at a fixed pixel ratio.
