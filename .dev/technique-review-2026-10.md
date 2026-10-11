# Technique review, October 2026

On 4 October 2026 the team compared null3D's techniques with the source code of eight engines. They were three.js, Filament, Bevy, Godot, Unity's URP and HDRP, Babylon.js, PlayCanvas and Wicked Engine. A first round of five reports covered lighting, shadows, post-processing, geometry and animation. Six deeper reports then read each engine's source per area and scanned for missing features. A web search session checked 35 facts that the reports could not check (S-01 to S-35 below). The same day, a review read all the engine's shipping code ([Code review, October 2026](code-review-2026-10.md)).

This page keeps the results that a later reader needs:

- the ranked changes and the porting verdicts;
- the contents of the `three-compat` add-on;
- the prototypes and their pass rules, and the gaps;
- the web search results with their sources;
- the places where the earlier reports were wrong.

The owner decided every question on 4 October 2026. The decisions and their reasons are records:

- [D-52](decisions/D-52-intent-parity.md): intent parity, the `three-compat` add-on, built-in assets made at run time, and add-on modules.
- [D-53](decisions/D-53-technique-defaults.md): the 28 technique rulings of this review.
- [D-54](decisions/D-54-addon-modules.md): add-on modules, the one on-demand loader, and CDN delivery.
- [D-14](decisions/D-14-js-budget.md): the budget for first-use shader files, Draco's exception and the gzip columns.
- [Device sessions](devices.md#which-device-runs-a-check): real phones on BrowserStack Automate first.

## Rules the review applied

- The best technique is the default ([D-52](decisions/D-52-intent-parity.md)).
- Intent stays strict: glTF, materials, color, units and animation behave as the glTF specification and three.js say.
- Looks are "equivalent or better". The porting skill rewrites three.js code onto null3D's technique and maps its settings. No three.js-look mode stays in the core. The few that survive go to the opt-in `three-compat` add-on.
- Benchmarks compare equal work, with quality notes. Pixel tests against three.js run only for shared building blocks.
- Built-in assets are made at run time. Heavy or niche features are add-on modules.
- Real-phone tests run on BrowserStack Automate where they can. The owner's Galaxy S24+ serves only checks that need a USB cable. Brave is no longer tested.

Terms on this page:

- HDR color: color values above 1, before the tone curve turns them into screen color.
- Shader file: the generated file that holds every shader build a page can need on one GPU path. A page downloads one at its start ([D-13](decisions/D-13-shader-variants.md)).
- Texture unit: a slot through which a WebGL2 shader reads a texture. Every device gives a fragment shader at least 16.
- Phone cost: the extra time or memory on a phone. "Measured" names the measurement. "Estimate" is arithmetic or judgement, and a prototype must confirm it.

## The ranked changes

Ranked by value to users per unit of effort. Effort is S, M or L.

| # | Change | Default it sets | three.js ports | Effort | Phone cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Limit HDR color where it is written and read; apply exposure to the lights on the CPU | No black pixels or lost bloom above 65,504; lux, lumen and EV100 inputs | None: bloom's threshold is rescaled, so ported numbers keep their meaning | S | None: one `min` per pixel; the exposure multiply runs on the CPU (estimate) |
| 2 | Per-feature shader files that load on first use | A page downloads and parses only the shaders it uses | n/a | M | Saves start time. One shader file takes 15 to 20 ms to parse on the Mac today; phones take several times longer (estimate) |
| 3 | Generate the built-in room in the browser with the asset tool's filter; the same generator prefilters HDR files at load | No 2 MB file in the package | A look: null3D's own references, and a sanity comparison with three.js's `RoomEnvironment` | M | Once at load. The tool's filter reads about 98 million texels. three.js r187's reads 53 million and took 10.4 to 13.0 ms on an Apple M1 (S-10), so the tool's takes about 19 to 24 ms there (estimate), sliced into steps of 8 ms or less. 4 MiB as `rgba16float`, 2 MiB as `rg11b10ufloat` |
| 4 | Read the environment at each material's own roughness, with a roughness floor of 0.045, one filtered read of the lighting table, and the roughest level as diffuse light | A rough material's reflection is as blurred as its own highlight | A lighting term, so strict tests. r187 uses the same formula, Filament's `maxLod · r · (2 − r)` (S-04) | S | Fewer reads: the table read goes from 4 loads to 1. The diffuse read must stay under 1% of a GPU-bound frame (L2) |
| 5 | AgX as the default tone curve | Hues stay true in bright color; Neutral for product templates | AgX by default; ACES, Reinhard and Cineon go to `three-compat` | S | None |
| 6 | WebGPU skinning skips unchanged poses and writes 8-bit normals and tangents | A still character costs no GPU work | None | S + S | Saves. S5's skinned memory falls from 69 MB to about 49 MB: 28 to 20 bytes per vertex (estimate) |
| 7 | Animator start time and per-clip weight | Characters start out of step; idle, walk and run blend by weight | None | S | None |
| 8 | A clip step in the asset tool: resample to the core's grid, 16-bit rotations | Smaller files that load with a copy, not a resample | None | S to M | Saves. Target: the Knight's binary from 846 KB to about 435 KB after Brotli, with 38 to 190 ms less parse time |
| 9 | Specular anti-aliasing on by default (Filament's kernel), with the tool baking normal variance into roughness | Less shimmer on shiny, normal-mapped surfaces | Rewrite, no mode | S + M | Pass rule: under 1% of GPU time (L3) |
| 10 | Mip-chain bloom as the default | Fixed-size base, Karis average, energy-conserving mix | Rewrite with settings mapped; `UnrealBloomPass`'s halo to `three-compat` only if P2 fails | M | Falls: about 8.3 texels read per pixel against 10.8 today. The final pass reads 1 texture, not 5 (estimate) |
| 11 | Final pass order and formats: vignette in HDR, triangle dither last, `R11F_G11F_B10F` scene color on WebGL2 | No gray corners; no bands; half the scene-color bytes on WebGL2 | Rewrite, settings mapped | S | Saves 4 bytes per pixel of scene color on WebGL2. Mali GPUs from Valhall up to the G710 also compress the 32-bit format, and not `RGBA16F` (S-14) |
| 12 | Count survivors per workgroup in the culling shader | One shared counter add per workgroup, not per object | None | S | Keep it if it is faster on one device and slower on none (G2). Qualcomm, Arm and Apple advise this pattern (S-27) |
| 13 | 16-bit cascade depth with a bias floor per cascade | Half the cascade memory and bandwidth | None | S | Saves: Ultra from 256 to 128 MiB, Medium and High from 48 to 24 MiB |
| 14 | Cascade blend, each cascade fitted from the start of the previous band, with the fix for narrow cameras (R5-06) | No seam line; no lit holes at the screen's sides | None | M | A second filtered read on band pixels only (estimate) |
| 15 | Crisp outlines as the default | A sharp line in one pass | Rewrite; `OutlinePass`'s glow and pulse go to `three-compat` | M | Falls: 4 to 8 reads in place of 6.6, and one pass and target fewer (estimate) |
| 16 | Transparency parity: double-sided blended surfaces in two draws, alpha to coverage, alpha hash | Closes three port gaps | Native: three.js's technique | 3 x S | One more draw per double-sided blended run; under 5% of GPU time (G3) |
| 17 | Detail levels picked by screen error (Godot's rule), with a reworked simplifier in the tool | Detail follows the governor's render scale | Rewrite: `LOD` distances converted | M + S | One division per instance on the GPU (estimate) |
| 18 | Morph deltas as half floats, with weights in their own texture | Half the morph memory | None | S | Saves: a full morph texture falls from 64 MiB to 32 MiB |
| 19 | Native fog with height and sun light | Fog that stays put when the camera turns | Rewrite onto the linear and exp2 curves | S | About 15 ALU operations and one `exp` per pixel (estimate) |
| 20 | AO on the existing half-size depth copy, with the bitmask variant of GTAO and a plain bilinear upsample | No dark halos behind thin objects | Rewrite: `GTAOPass` maps to a `lightAffect` setting | M | 2.42 ms on the Mac at scale 1. Filament measured 7.5 to 14.4 ms on a Pixel 7 Pro at half size (S-03), so phones get AO only where S3 shows it fits |

Ranked below 20 are the two-step output below render scale 1 with GSR 1, and contact shadows. So are GPU occlusion culling per device class, still-camera accumulation, inertial transitions, the texture budget's drop order and the smaller port gaps.

## Porting verdicts

| three.js feature | null3D's technique | Verdict | What the porting skill does | How visible the difference is |
| --- | --- | --- | --- | --- |
| `UnrealBloomPass`, `bloom()` node | Mip-chain bloom | Rewrite; `three-compat` only if P2 fails | Maps `strength` to intensity, `radius` to the upsample mix, and `threshold` to the threshold divided by exposure | Moderate on strong bloom: the glow's falloff differs. Equivalent on mild bloom |
| pmndrs `BloomEffect`, R3F `<Bloom>` | Mip-chain bloom | Rewrite | Maps `luminanceThreshold`, `luminanceSmoothing`, `intensity`, `radius` and pmndrs's level weights. SCREEN blending becomes the energy-conserving mix | Small |
| `OutlinePass`, pmndrs `OutlineEffect` | Crisp outline | Rewrite; glow and pulse to `three-compat` | Maps `edgeThickness` to width and the visible and hidden edge colors. With `edgeGlow` above 0 or `pulsePeriod`, it imports `three-compat`'s soft outline | Small without glow; large with glow or pulse |
| `VignetteShader`, pmndrs `Vignette` | HDR vignette | Rewrite | Maps `offset` to size and `darkness` to intensity | Small: corners darken a little more in highlights. three.js's lift of dark corners at `darkness` below 1 is lost |
| `Fog`, `FogExp2` | Native fog | Rewrite | `Fog(near, far)` becomes the linear curve, `FogExp2(density)` the exp2 curve | Small: corners get a little thicker fog, because distance is radial |
| ACES filmic, Reinhard, Cineon | AgX by default | Move to `three-compat` | Imports `three-compat` and sets the same curve | Large: the scene's colors were chosen under that curve |
| AgX, Neutral, no tone mapping | The same curves | Native | One to one. null3D's AgX is three.js's polynomial | None |
| `GTAOPass`, `SSAOPass`, `SAOPass` | AO on indirect light, with `lightAffect` | Rewrite | Maps radius and intensity, and sets `lightAffect` to 1 for passes that darken the whole image | Moderate; the bitmask variant removes dark halos |
| `LightProbeGrid` | A probe grid that replaces the environment's diffuse light | Rewrite | Sets `environmentWeight` to 1 where the scene kept the environment at full strength | Small to moderate indoors |
| `CSM`, `SunLight` | Native cascades | Rewrite | Maps lambda to the split lean, `maxFar` to the distance, and the cascade count | None for the split; slight at band edges |
| `shadow.radius`, `PCFSoftShadowMap`, `VSMShadowMap` | Castaño 3x3 and 5x5 | Rewrite | Maps the radius to the nearer kernel | Small: the penumbra loses three.js's grain |
| `LOD.addLevel(object, distance, hysteresis)` | Screen-error rule | Rewrite | Converts each distance at the source camera's field of view and a reference screen height, written into a code comment | Small at the reference size |
| `crossFadeTo`, `crossFadeFrom` | Weighted cross-fade | Rewrite onto `transition: 'blend'`, never inertial | One to one | None: animation is strict |
| Specular anti-aliasing term, horizon fading off, r186's environment blur | Filament's kernel, horizon fading, own-roughness lookup | Rewrite | Nothing to map | Very small at rest; less shimmer in motion |
| `RoomEnvironment` with `PMREMGenerator.fromScene`; `RGBELoader` or `HDRLoader` with `PMREMGenerator` | The room generator and HDR loading on the tool's filter | Rewrite | Maps to `assets.builtinEnvironment('room')` and `assets.loadEnvironment(url)` | Small |
| `TAARenderPass`, `SSAARenderPass` | Still-camera accumulation | Rewrite | Maps `sampleLevel` to the frames accumulated | None at rest |
| `FXAAShader`, `FXAANode`, `SharpenNode` | The same algorithms | Rewrite | One to one | None |
| `Line2`, double-sided blended surfaces, alpha to coverage, alpha hash | The same techniques | Native | One to one; `forceSinglePass` maps to one draw | None |

The native techniques gain settings that ports can map onto. They are bloom's upsample mix and level weights, AO's `lightAffect`, the probe grid's `environmentWeight`, and the fog's curve. Each is a uniform, with no new shader build.

A mode kept in the core would cost:

- shader text in every page's start file, until per-feature shader files exist. Today's `UnrealBloomPass` steps are 11 passes, and the final pass reads 5 levels for them;
- image tests on three GPU paths in two reference sets, and a parity scene;
- docs, mapping entries and skill text for two ways to do one task;
- the work of keeping the mode alive through every later change to the native effect.

Under D-52 the core loses four look modes. They are three.js's vignette formula (#261), `UnrealBloomPass`'s steps (#251), the `OutlinePass` steps of #280, and ACES as the default.

## The three-compat add-on

Contents:

1. three.js's tone curves: ACES filmic (three.js's fit, with its 1/0.6 scale), Reinhard and Cineon. Color is strict, so ports keep them.
2. `OutlinePass`'s glow, pulse and blurred edge, from #280's steps.
3. Only if prototype P2 fails: `UnrealBloomPass`'s steps, from #251.

D-52's candidates also named three.js's vignette. The review found the rewrite close enough, so the add-on leaves it out.

Extension points it needs. Each is public, so other add-ons can use it:

- A tone-curve hook: a WGSL function that the final pass calls in place of the curve. It must also reach the scene shaders on the 8-bit path, where they apply the curve.
- Custom passes with targets at half and quarter size, with the outline mask as a pass input.
- Custom effects.
- First-use shader files, so the add-on adds nothing to pages that do not import it.

It comes in M3, with the porting skill and the port tool, after custom effects and custom passes make the extension points public.

## Findings by area

### Lighting, materials and environment light

- Base BRDF: keep it. It is the most complete in the sources. It has exact correlated Smith, energy compensation, and a (1 − F) diffuse weight that Filament still lists as a to-do. Floor 0.045, as r187 and Filament have.
- Environment lookup: today a table fitted to three.js r186's atlas maps roughness to a level. That atlas blurred each level less than its own GGX lobe. So a rough metal reflects a sharper sky than its own sun highlight. Reading the cube at `lod = (n − 1) r (2 − r)` makes the two lobes agree, as Filament does. three.js r187 makes the same change with the same formula. Its first version subtracted the base level's own blur, and [three.js PR #34645](https://github.com/mrdoob/three.js/pull/34645) removed that offset.
- Diffuse environment light: the roughest level times π, if L2 shows it costs under 1%. r187 reads the roughest level too. Filament filters its last level extra smooth for that reason.
- Material extensions: `KHR_materials_specular` and `KHR_materials_ior` now. Clearcoat and sheen come later, in first-use shader files. Transmission moved before 1.0 and reads a copy of the opaque color (S-06, [D-122](decisions/D-122-transmission.md)). r187's EON rough diffuse (`diffuseRoughness`) is Lambert at its default of 0, so default materials still compare strictly.
- Falloff: keep three.js's formulas. No engine derives a light's range from its intensity.
- Clustered lights: keep. Measure the WebGL2 listing time in S3 before any redesign.
- Specular occlusion: Lagarde's formula plus horizon fading, always on. Cone occlusion from GTAO's bent normal needs a bent normal, which the bitmask variant does not give.
- Half precision: off, as [D-09](decisions/D-09-half-precision.md) measured. The HALF builds need a roughness floor of 0.089, because 0.045⁴ is below the smallest normal 16-bit float.
- The room: the asset tool's filter runs in the browser, in steps of 8 ms or less. The GPU time of the first step on the device sizes the steps. On WebGL2 each level writes through a spare 2D texture. Filament and Wicked Engine write `R11F_G11F_B10F`, which halves the memory where that format renders.
- The tool's `rgb9e5ufloat` files stay ([D-19](decisions/D-19-environment-maps.md)): half the memory of half floats, filterable on every path. Bevy ships its maps the same way (S-25).
- UASTC HDR files from other tools: transcode to BC6H, else `rgb9e5ufloat`. The shipped Basis 2.50 transcoder already reads them (S-18), so this costs no transcoder size.

### HDR overflow and exposure

Review finding R7-01: color above 65,504, the largest 16-bit float, becomes infinity or NaN on SwiftShader. Chrome on Android draws WebGPU through Vulkan, which may do the same. The tone curves then draw black, and bloom vanishes. A smooth metal floor under a sun of intensity 30 shows a black hole at the highlight's center. The GGX peak at the floor of 0.0525 is about 42,000 times the light's irradiance.

- The peak is 1 / (π r⁴), so a floor of 0.045 raises it about 1.85 times. The same floor then overflows at a sun of about 16. The limit must land with the floor change or before it.
- Exposure in the lights keeps real-unit scenes in range: a 100,000 lux sun at EV100 15 stores values near 1. It does not help a scene with exposure 1, which most ports have, so the limit stays.
- HDR files prefiltered into an `rgba16float` cube can hold a sun above 65,504. Limit or compress bright texels on upload, as Filament does.
- Limit bloom's input too, as URP does (65,472). The Karis average damps bright pixels but does not stop infinity.
- Never write `f32::MAX` as a WGSL literal: Bevy found that it breaks Chrome. Use 65,504 or 32,768.

### Output and post-processing

- Bloom: a mip chain with a base of 512 rows (384 on Low). A 13-tap downsample with a Karis average on the first step, a 9-tap tent upsample and an energy-conserving mix follow, with a threshold of 0. Filament's mobile kernels on Low. The governor's step halves the base. Every engine read uses a mip chain, except three.js and Babylon.js.
- FXAA: add an edge search with three.js's 6-step schedule, on the squeezed HDR color. P3 must show that it costs under 0.1 ms more on the cloud phones. three.js's FXAA is Catlike Coding's version; null3D's is the FXAA 3.11 console path.
- MSAA: keep 4x on Medium and up. P3 decides Low. On WebGL2, resolve with a blit right after the last draw, at the same size and format, with one draw buffer. Then call `invalidateFramebuffer`. ANGLE's Vulkan backend can then resolve in tile memory (S-13).
- Below render scale 1: today each canvas pixel runs 4 tone curves, 4 sRGB encodes and 4 dither hashes. FXAA is off, so Low at scale 0.5 has no anti-aliasing (`final.wgsl`). The fix has two steps. First the tone curve, sRGB and FXAA run at render size into an 8-bit target with luma in alpha. Then GSR 1 draws into the canvas. Qualcomm measures GSR 1 at 0.14 to 0.23 ms more than a bilinear upscale (S-15).
- Sharpening: RCAS after EASU only, off by default.
- Dither: static triangle noise of one step, last, after the table and the vignette, as Filament and URP do. Today white noise of half a step runs before the vignette.
- Scene color on WebGL2: `R11F_G11F_B10F` where the canvas is opaque and the probe passes. Keep the accumulation history in `rgba16float`, since R11G11B10 has 6 or 5 mantissa bits against 10.
- Fog: three.js's `WebGPURenderer`, and `WebGLRenderer` with a half-float output, mix fog before tone mapping as null3D does. Only `WebGLRenderer`'s 8-bit default mixes after.
- Grading controls: none in M2. Later, a job worker bakes them with the tone curve into one 32³ table, as Filament does. `.cube` and `.3dl` tables stay after the tone curve.
- HDR output to the display: SDR by default; an `output: 'hdr'` option on WebGPU after M2. No browser ships an HDR WebGL2 canvas (S-08).
- ACES 2.0 stays out of the core. OCIO's "3 to 8 times slower" is CPU time (S-07). A user can load a baked ACES 2.0 table as a `.cube` file.

### Shadows and ambient occlusion

- Cascades: keep the fit, snap and pick. Picking by distance from the camera beats every engine's pick by view depth when the camera turns ([D-16](decisions/D-16-moving-casters-and-bias.md)).
- One 16-bit depth step in S4's last cascade is 14.4 mm, above both 10 mm biases. So the format change needs a bias floor of 1.5 depth steps per cascade.
- Cameras of 45 degrees or narrower get lit holes at the screen's sides (R5-06, up to 0.44% of the ground). The cascade blend's fit has the same cause: each cascade's sphere fits only its slice along the view. Fit slice k from the nearest point whose distance reaches its start.
- Shadow distance from the farthest visible receiver: in a 15 m room the near texels get about 10 times finer. On WebGPU the farthest receiver comes back from the GPU two frames late.
- Point and spot tiles: keep the 2D tiles. Mark only the faces that a moved caster touches. Widen the tile margin to the filter's reach, 3 texels (today 1). Cap shadow redraws per frame, as Godot does at 512 passes.
- No PCSS before 1.0. Filament no longer has PCSS or DPCF filters of its own. Godot 4 has contact shadows again in Forward+.
- AO: keep the built half-size depth copy, which compatibility mode can read (S-01). Use Filament's separable bilateral denoise and a plain bilinear upsample: Filament measured its depth-aware upsample at about 2 ms on a Pixel 4. Bevy's bitmask AO does not run in browsers: it needs 5 storage textures per stage, where WebGPU gives 4. It has 6 sectors, not 32. Copy Filament's fragment-shader version.
- AO on the Mac today: +2.42 ms of GPU time at scale 1 and +1.18 ms at 0.5, at 3,024 x 1,518. `GTAOPass` costs +5.27 ms. Parity with `GTAOPass` is 0.036 to 0.040% at its defaults.
- Probe grids: L1 in one 3D texture, 3 reads per pixel on High and Ultra. three.js's `LightProbeGrid` adds to the environment's light; it does not replace it.
- Reflection probes: box-projected octahedral maps in one 2D array. To match a 256 cube a probe needs about 512² plus a border, about 2.7 MiB with mips, so 16 probes take about 43 MiB.

### WebGL2 texture units

The lit shader's fragment stage reads 13 of the 16 units once environment light lands, and AO makes 14. Transmission's copy of the opaque color makes 15 in the builds that let light through ([D-122](decisions/D-122-transmission.md)). Area lights, a probe grid, reflection probes, decals and light maps would take it to 18 or more. Rules for every new per-pixel input:

1. AO and any other screen-space result share one RG8 texture. Contact shadows run inline and need none.
2. All probe grids share one 3D texture.
3. Reflection probes are octahedral maps in one 2D array. Compatibility mode has no cube arrays.
4. The two LTC tables of area lights are one 2-layer array.
5. Decals and light maps take layers of the shared texture arrays.
6. The shader build counts the units of each build and fails at 16.

### Geometry, culling and drawing

- GPU occlusion culling saves 37% on a quiet Mac (1.64 to 1.04 ms in the room scene). With another program on the GPU it costs 19 to 40% more. The case for a CPU buffer on desktops is gone; phones still decide.
- Software occlusion culling on WebGL2: keep it. Its buffer is about 9 times finer than Godot's on 8 threads, and about 18 times on a 4-thread phone pool. Godot ray casts; it does not rasterize.
- Render bundles: keep the TypeScript replay. Revisit native bundles when Safari 27.2 is the oldest supported and WebKit bug 325413 is fixed in a release (S-31).
- Multi-draw indirect and 64-bit atomics: not before 1.0 (S-28, S-29).
- Detail levels: the engine picks the coarsest level under 1 pixel of error, times the render scale, with about 10% hysteresis. Use the viewport height with P[1][1], because null3D's cameras take a vertical field of view. Shadow views pick with the camera's position. `discard` turns off hidden-surface removal on Apple and PowerVR tile GPUs, and early depth on Mali. So G3 measures fades and alpha hash on the iPad.
- Transparency: double-sided blended runs draw back faces, then front faces. Alpha to coverage needs a multisampled target, and PlayCanvas reads the specification as needing a format with alpha. null3D's opaque WebGPU target is `rg11b10ufloat`, which has none, so check before building.
- The render graph's merge check reads the device's limits (S-30). Core WebGPU allows 8 color attachments, compatibility mode 4, and WebGL2 at least 4, with 32 bytes per sample.
- three.js's `WebGPURenderer` builds the model-view matrix on the GPU in 32-bit floats. Only `WebGLRenderer` builds it on the CPU in doubles. null3D's cells are more precise than the WebGPU renderer's default.

### Animation

- Keep compute skinning on WebGPU, with three changes: skip unchanged poses, write 8-bit normals and tangents, and later read UVs and colors from the mesh. Mali and Adreno run a vertex shader's position work twice in some cases (S-16), which favors compute skinning on Android.
- Keep linear blend skinning: no engine read has dual quaternions, and glTF characters are weighted for linear blend.
- The skinned region is 28 bytes per vertex for the Knight (no tangents) and 44 to 48 with tangents. S5 at 500 knights takes 69 MB, against Low's 256 MiB for all GPU memory ([D-12](decisions/D-12-memory-budgets.md)).
- The skinning dispatch can run 65,535 workgroups of 64 threads, about 4.19 million vertices per mesh page per frame. S5 at 500 knights (2.48 million) fits; 1,000 knights do not.
- Inertial transitions: Holden's dead blending code (MIT) is the reference, 13 to 17 floats per joint (S-21).
- Morph targets: one shared 2,048 x 2,048 RGBA32F texture takes 64 MiB, a quarter of Low's budget. Half floats give 32 MiB. The tool should warn on deltas of meters, which half floats round.
- Crowds use baked joint textures, not vertex animation textures. A 2-second clip of the Knight's 51 joints at 30 fps is 147 KB, against about 4.75 MB of baked vertices.

### Assets

- Simplifier: weld for planning, `simplifyWithAttributes` with normals, `Prune` on every level, `Regularize` for skinned meshes, a cascade by error, absolute error stored. Today 122 of 213 Kenney models get no levels, and S5's knights stay at about 4,950 vertices.
- Transcode targets: keep BC7 before BC1 on desktops. Keep ETC1S to ASTC: three.js uses RGBA32 there, 4 times the memory. Add three.js's desktop Linux guard: Mesa offers ETC and ASTC and decodes them in software on the main thread.
- Textures whose sizes are not a multiple of 4 load as RGBA8, 4 to 8 times the memory. The tool should pad or resize to whole blocks.
- S6's textures take 100 MiB with ETC2 or ASTC, 156 MiB with BC7 only, and 624 MiB as RGBA8.
- UASTC RDO saves about 0 to 25% on normal maps after Zstandard (S-19).
- `EXT_texture_webp` and `EXT_texture_avif` now: a dedicated worker decodes both (S-17).
- Draco: the owner's decision stands. Draco's glTF-only build is 59 KB after Brotli: 49 KB of WebAssembly and 10 KB of JavaScript. The 66 KB first quoted is the full build's `.wasm` alone. It loads in the glTF worker with `compileStreaming`, once per page. Decoded normals, tangents and UVs quantize into [D-25](decisions/D-25-vertex-types.md)'s types in the worker.
- Draco against meshopt, after Brotli: Draco is 14 to 27% smaller on static meshes. It is 3.2 to 3.7 times larger on animated or morphed files, because it leaves clips and morph targets raw. Sizes must be compared after transport compression.

## Per-feature shader files

Today every template's builds sit in one shader file per GPU path and device bits ([D-13](decisions/D-13-shader-variants.md)).

- Each file is 1.7 to 3.4 MB raw and about 24 KB after Brotli.
- Parsing one file takes 15 to 20 ms for GLSL and 7.5 to 11 ms for WGSL on the M5 Max. D-13 recorded 2.2 ms.
- 35 of the 164 GLSL stage sources are exact copies, 543 KB in all.
- On a gzip host, a WebGL2 page downloads 496 KB at its start and a WebGPU page 378 KB, against 106 KB with Brotli.
- M2's features each grow every start file. GPU occlusion culling adds 8.7 to 8.9%, although it is off by default. AO adds 9 to 15%, wide lines 2.0 to 2.9 KB, and sprites and outlines 0.7 KB each.

The task M2-R11, with its own record D-56, comes before any new feature that adds shader code. Branches already built move their shaders in a follow-up. It does four things:

1. Store each unique stage source once per file, with variants as indexes into that table. This saves about 20% of the parse.
2. Move each feature's templates into a file of its own that loads when the feature first runs. Each such file may take about 24 KB after Brotli ([D-14](decisions/D-14-js-budget.md)).
3. Measure `bench:startup` on BrowserStack's Galaxy S25 and Pixel 9, then decide whether the `standard_maps` builds (1.72 MB, 32 builds) split by a second fixed bit.
4. Write the new figures into D-13 and D-14.

It is also the prerequisite of add-on modules ([D-54](decisions/D-54-addon-modules.md)).

## New tasks proposed

| Task | What | After |
| --- | --- | --- |
| M2-E6 | Exposure in the lights and light units, with the HDR limit of R7-01 | |
| M2-E7 | Lighting defaults: floor 0.045 (HALF 0.089), specular anti-aliasing, horizon fading, AgX | L3, L7 |
| M2-E8 | Native fog | |
| M2-B6 | The tool bakes normal variance into roughness mips | |
| M2-B7 | Clip step in the tool | A2 |
| M2-B8 | Godot-style level planning | A3 |
| M2-J5 | `KHR_materials_specular` and `KHR_materials_ior` | |
| M2-J6 | Transparency parity | G3 |
| M2-F7 | Mip-chain bloom default | P2 |
| M2-F8 | Crisp outline, folded into M2-F4 | P4 |
| M2-F9 | Final pass order and formats | P3 |
| M2-F10 | Two-step output with GSR 1 (P1 priority) | P1 |
| M2-F11 | Still-camera accumulation (P1 priority) | |
| M2-F12 | Contact shadows (P1 priority) | S3 |
| M2-R8 | 16-bit cascades | S1 |
| M2-R9 | Point and spot tiles: per-face marks, 3-texel margin, a redraw cap | |
| M2-R10 | Automatic shadow distance (P1 priority) | S2 |
| M2-R11 | Per-feature shader files | |
| M2-I5 | Culling shader counters | G2 |
| M2-D7 | Raycasts against sprite, point and line rows | |
| M2-C8 | Lean WebGPU skinning | A1 |
| M2-C9 | Animator start time, clip weight, phase-synced 1D blend | |
| M2-C10 | Inertial transitions (P1 priority) | A4 |
| M2-A7 | WebP, AVIF and UASTC HDR in the loader, and the Linux guard | |

M2-E4 (HDR files at load) moves to P0 and builds on the room's generator.

## Prototypes

IDs: L lighting, S shadows and AO, P post, G geometry, A animation and assets, X gaps. "Cloud" means BrowserStack Automate.

| ID | Experiment | Devices | What it decides, and the pass rule |
| --- | --- | --- | --- |
| L1 | The room generator in the browser, sliced into steps; WebGL2 writes through a spare texture against direct writes; an `rg11b10ufloat` output; a WebGL2 device that cannot draw half floats | Mac (Chrome, Safari), iPad, cloud S25, Pixel 9, 10 and 11, each on WebGPU and with WebGL2 forced | The room's first-use cost and M2-E4. Pass: matches the tool's file within D-19's tolerance on all three paths, no step over 8 ms, and under 200 ms in all on the slowest cloud phone. Expect about 20 to 25 ms on the Mac |
| L2 | Own-roughness lookup against the fitted table on the sphere grid; the strict lighting fit against three.js main as `three-next`; spherical harmonics against the roughest level | Mac; iPad, cloud Pixel 9 and S25 for cost | Delete the fitted table; drop the coefficients if the roughest level costs under 1% |
| L3 | Specular shimmer: three.js's term, Filament's kernel, Godot's kernel, the tool's bake, bake plus kernel | iPad, cloud Pixel 9 and S25 | The kernel and its settings. Pass: shimmer halved for under 1% of GPU time |
| L4 | WebGL2 clustered-light listing time and texture reads | Cloud Pixel 9 and S25, WebGL2 forced | Depth binning if listing passes 0.3 ms |
| L5 | Half precision with the half math written as vectors; repeat the shadow test that failed at 0.508% on the S24+. Low priority | Cloud Pixel 9 | Whether D-09 changes |
| L6 | A 100,000 lux sun at EV100 15 with bloom; an emissive above 65,504 with bloom | CI (SwiftShader), Mac | R7-01 and the exposure change. SwiftShader fails today |
| L7 | Look test: AgX, AgX punchy, Neutral on S4, S6 and the sphere grid | Mac | The default curve's look |
| L8 | A baked grading table against the analytic curve on a ramp | Mac; iPad, cloud S25 | Grading controls, after M2 |
| S1 | 16-bit cascades with a bias floor, behind `shadowdepth=16`; all bias in the shader | All three paths in CI; Mac, iPad, cloud S25 and Pixel 9. On the S25, Chrome 149 or later and an older Chrome if offered | 16-bit cascades, and the Adreno guard of decision 28 |
| S2 | Shadow distance from the farthest visible receiver, on a 1.25x ladder with one step of hysteresis | Mac | The automatic shadow distance |
| S3 | AO's depth input (the half-size copy against an `r16float` pass, on cost only); Filament SAO 7 reads, GTAO 2 x 3, GTAO 2 x 3 with the bitmask, Filament's 4 x 3; each with bilinear and depth-aware upsample; then contact shadows | Mac; iPad at High and Medium, scales 1 and 0.5; cloud S25 at High | AO's method and tiers. Pass: the iPad's Medium gets AO under 1.5 ms; a phone at High under 2 ms at scale 0.5, else the quarter size, else off; contact shadows under 0.5 ms on the S25 |
| S4 | Cascade blend at 0% and 10% | Cloud S25 and Pixel 9 (Low), iPad (Medium) | The blend's cost |
| S5 | Compatibility mode reading depth as unfilterable float with `textureLoad`, single-sample and multisampled | A compatibility-only device (cloud Galaxy Tab A9 Plus, Adreno 619), and a Mali one if offered | Whether the direct read holds on OpenGL ES drivers. If the multisampled read fails, that tier reads a prepass without MSAA |
| S6 | Point shadow seams with the wider tile margin | CI, Mac | The margin change |
| S7 | Probe grid on and off | iPad, cloud S25 | The grid's tiers |
| P1 | Two-step output below scale 1: GSR 1, bilinear, EASU with RCAS, today's path; mip bias on and off; a nearest baseline at 0.5 | iPad, Mac, cloud S25, Pixel 9 and Pixel 11, WebGL2 forced as well | The upscaler. Pass: GSR 1 within 0.2 ms of today at 0.5 on the S25 with WebGL2, and closer to the scale-1 image |
| P2 | Mip-chain bloom with settings mapped from three.js and pmndrs, against today's steps, with a side-by-side | iPad, cloud S25, Pixel 9 and Pixel 11; Mac for looks | The port mapping, whether the halo needs `three-compat`, and D-21's device timings |
| P3 | Anti-aliasing and scene format on Low: FXAA, FXAA with edge search, MSAA 4x, `RGBA16F` against `R11F_G11F_B10F`; the WebGL2 resolve's CPU time | Cloud S25, Pixel 9, 10 and 11, WebGPU and WebGL2; iPad; a Valhall Mali older than the G710 if offered | MSAA on Low (under 0.5 ms more than FXAA), the edge search (under 0.1 ms more), the WebGL2 format. Record whether Chrome draws WebGL2 through ANGLE on Vulkan |
| P4 | Outline styles, crisp and soft | iPad, cloud S25 | The default width |
| P5 | Dark vignette over a flat color | CI | The dither change |
| G1 | GPU occlusion culling quiet and with a load page in a second tab; a quarter-size first level; an image check on two Adreno and two Mali phones, an Adreno 730 or older, a Mali driver before r48, and the Pixel 10 and 11 | iPad, cloud S25, Pixel 9, 10 and 11, older GPUs where offered; the Mac again | Desktops: on for High and Ultra only if a second quiet Mac run saves time, and a run with another program loading the GPU loses no more than 5%. Other device classes: on if it saves 10% quiet and loses no more than 5% loaded. Off on Android for any GPU that fails the image check |
| G2 | Per-workgroup counters in the culling shader | Mac (10 rounds), iPad, an Android WebGPU phone | Keep if faster on one device and slower on none |
| G3 | Transparency parity: glass with `DoubleSide`, foliage with alpha to coverage and with alpha hash | All three paths; iPad, cloud S25 for cost | Each change ships if it passes parity; the double-sided draw costs under 5% |
| G4 | Sphere survivors that an oriented-box test would reject in S6 | Rust test | Add the box test if it drops more than 10% |
| G5 | Native render bundles with an indirect draw | Mac Chrome; Safari 27.2 when out | Revisit when Safari 27.2 is the oldest supported |
| G6 | Detail levels on and off | Cloud S25 and Pixel 9 | The detail-level preset rows |
| G7 | GPU picking against raycasts on thin and masked objects | iPad, cloud S25 | GPU picking |
| G8 | Software occlusion culling; Godot's walk to finer data; buffers of 256 x 144 and 384 x 216 | Cloud S25 and Pixel 9, iPad, WebGL2 forced | D-22's WebGL2 rows |
| G9 | Shadows drawing the main view's detail level against the base level | iPad, cloud S25 | Shadow pops and shadow-pass time |
| A1 | Lean WebGPU skinning in S5: main, pose stamp, 8-bit, both; S5 with `?skinning=vertex` | Mac (Chrome, Safari), iPad, cloud S25 and Pixel 9 | [D-20](decisions/D-20-webgpu-skinning.md) and the skinning changes |
| A2 | Clip step in the tool against today and gltfpack | Mac; iPad, cloud S25 for parse time | Pass: the Knight's binary near 435 KB after Brotli, poses within D-35's tolerance |
| A3 | Godot-style level planning over the 213 Kenney models and the Knight | Mac | More models with levels than 91 |
| A4 | Inertial transitions against cross-fade on S5's walk-to-run switches | iPad | The default fade for new scenes |
| A5 | WebGL2 morph targets summed once per frame into a target, against the vertex loop, with 52 targets and 3 cascades | Cloud S25 and Pixel 9, iPad, WebGL2 forced | Whether the weight cap can go |
| A6 | Texture budget in Godot's order, need estimated on the CPU | iPad, cloud S25 | The texture budget's drop order |
| A7 | Skinned memory at 500 and 1,000 characters, with a cap and a vertex-shader path past it | iPad | Whether to cap skinned memory |
| X1 | Splat sorting on the job workers, 1 and 3 million splats; 1 million against PlayCanvas | Mac, iPad, cloud S25 and Pixel 9 | Whether the splats add-on goes ahead. Pass: sort under 4 ms on the S25 |
| X2 | MSDF text on the sprite path, 100 to 10,000 labels, against HTML labels and troika | Mac, iPad, cloud S25 and Pixel 9 | Text. Pass: 1,000 labels within 0.5 ms of GPU time on the S25 |
| X3 | three.js's GLSL-to-WGSL transpiler over its 52 example shaders and the porting corpus | Mac | Whether a shader port command is worth building. Pass: 70% compile with no hand edits |

Next in line: a WebGL2 depth-sampling image test before any pass samples depth through GLSL, where Bevy found a naga fault. Then a check of the jitter's Y sign on WebGPU against WebGL2, for still-camera accumulation.

Five prototypes give the most decisions per sitting: L1, S3, P2, A1 and G1.

## Gaps, ranked

| Rank | Gap | Who ships it | Effort | Where |
| --- | --- | --- | --- | --- |
| 1 | WebP and AVIF textures in glTF | three.js, Babylon.js, Godot | S | M2: such files fail with E1417 today |
| 2 | Animator start time and clip weight | Every engine read | S | M2 |
| 3 | Transparency parity | three.js | 3 x S | M2 |
| 4 | Color morph targets: a parity gap under D-52's strict glTF intent | three.js, glTF | S | M2, in a follow-up after morph targets merge |
| 5 | Raycasts against sprites, points and lines | three.js | M | M2 |
| 6 | UASTC HDR files | three.js | S | M2, with M2-E4 |
| 7 | MSDF and SDF text in the scene | PlayCanvas, Godot, Babylon.js; drei's `Text` | S to M | M3; add-on if its tools are large |
| 8 | Physics adapter | three.js add-ons, Babylon.js, PlayCanvas, Godot | M | M3 add-on |
| 9 | GLSL-to-WGSL port command | three.js's transpiler | S to M | M3, command line only |
| 10 | Gaussian splats, on WebGL2 too | PlayCanvas, Babylon.js; three.js on WebGPU only | M to L | M3 add-on |
| 11 | Planar reflections and linked views | three.js add-ons, Babylon.js | M | M3; planar reflections in M2-EX15 for the showcase scenes ([D-117](decisions/D-117-showcase-features-before-1-0.md)) |
| 12 | Particles on the job workers | Babylon.js, PlayCanvas, Godot | M | M3 add-on |
| 13 | Projected decals | three.js's `DecalGeometry` | S | M2 or M3 |
| 14 | Per-object light maps, reading `NEEDLE_lightmaps` first | Bevy, PlayCanvas, Godot | S to M | M3 |
| 15 | IK (two-bone, aim, CCD) | Godot, Babylon.js, a three.js add-on | S to M | M3; add-on if large |
| 16 | Box-projected reflection probes | Godot, PlayCanvas, Babylon.js | M | M3 |
| 17 | `KHR_materials_specular` and `ior`; then clearcoat and sheen | three.js, Filament, Babylon.js | S, M, M | M2 (first two), M3 |
| 18 | `KHR_materials_variants` | Babylon.js, PlayCanvas | M | M3 |
| 19 | Root motion | Godot, Babylon.js | M | M3 |
| 20 | Shape casts and closest-point queries | three-mesh-bvh | M | M3, with physics |
| 21 | Probe grid | three.js, Bevy, Unity, Godot | M to L | M3 |
| 22 | Area lights | three.js, Babylon.js, Bevy, PlayCanvas, Godot | M | After 1.0 |
| 23 | Transmission | three.js, Filament, Babylon.js | L | Before 1.0, M2-EX16 ([D-117](decisions/D-117-showcase-features-before-1-0.md), [D-122](decisions/D-122-transmission.md)) |
| 24 | Physical sky and atmosphere | Babylon.js, Bevy, Godot | M | After 1.0 |
| 25 | Automatic exposure | Godot, Unity, Filament | M | After 1.0 |
| 26 | Depth of field and motion blur | Most engines | M | Depth of field built in M2-EX17 ([D-119](decisions/D-119-depth-of-field.md)); motion blur after 1.0 |
| 27 | Weighted blended transparency | | M | After 1.0, opt-in for particle scenes |
| 28 | Volumetric light | Godot, Bevy, PlayCanvas, Babylon.js | M | After 1.0; god rays as a custom-effect recipe in M3 |
| 29 | Temporal anti-aliasing with motion, screen-space reflections | Most engines | L | A temporal anti-aliasing prototype before 1.0, M2-EX18 ([D-117](decisions/D-117-showcase-features-before-1-0.md)); screen-space reflections after 1.0 |
| 30 | WebXR | Babylon.js, PlayCanvas, three.js | L | After 1.0. XR needs the thread mode that draws on the main thread, so keep that mode working |
| 31 | Terrain | No engine core | L | After 1.0 |

Water is a recipe on planar reflections. Navigation meshes, CSG, trails, exporters and gizmos block no user segment in 1.0.

## Web search results

The reports ran out of web searches, so 35 facts stayed unchecked. A later session checked them on 4 October 2026: 25 held, 10 were wrong, and 1 is still unknown. Each item gives the finding, the verdict and the main sources.

### Shadows and ambient occlusion

- S-01, depth reads in compatibility mode (corrected). Compatibility mode refuses only the `texture_depth_*` shader types with `textureLoad`. A depth format bound as `unfilterable-float` and read as `texture_2d<f32>` is allowed, and a multisampled one as `texture_multisampled_2d<f32>` too. Dawn's OpenGL ES backend turns the read into `texelFetch` with compare mode off. Chrome's compatibility tests run the single-sample read on the Pixel 6 (Mali-G78). They skip every `textureLoad` test on the Pixel 10 for device crashes. They skip the multisampled read on the Pixel 6 for a driver crash (crbug.com/373670502). No Adreno device runs them. Firefox and Safari give core adapters only. Chrome shipped compatibility mode in Chrome 146, starting with Android on OpenGL ES 3.1. Sources: [WebGPU specification, validating GPUProgrammableStage](https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpuprogrammablestage), [the compatibility mode proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md), [gpuweb issue 4970](https://github.com/gpuweb/gpuweb/issues/4970), [Dawn's Pipeline.cpp](https://dawn.googlesource.com/dawn/+/32f77c02294310054a660c393feded4bcb3f203c/src/dawn/native/Pipeline.cpp), [OpenGL ES 3.1 specification](https://registry.khronos.org/OpenGL/specs/es/3.1/es_spec_3.1.pdf), [New in WebGPU 146](https://developer.chrome.com/blog/new-in-webgpu-146), [Firefox bug 1905951](https://bugzilla.mozilla.org/show_bug.cgi?id=1905951).
- S-02, why three.js turns off shadow comparison on Android WebGPU (confirmed). Adreno phones (Galaxy S23, S25, Fold7, Xiaomi 10T Pro) gave wrong shadow results with no error; WebGL2 was right. Nobody reported Mali, PowerVR or Xclipse. Chrome's bug never found the root cause. Dawn commit 829f73d077 (first in Chrome 149) replaces 2D and 2D-array `textureSampleCompare` with `textureGatherCompare` and bilinear weights on every Qualcomm Vulkan driver. Cube depth textures get no workaround, and no driver fix is known. Sources: [three.js PR #32548](https://github.com/mrdoob/three.js/pull/32548), [three.js PR #33050](https://github.com/mrdoob/three.js/pull/33050), [Chromium issue 469328925](https://issues.chromium.org/issues/469328925), [Dawn change 300095](https://dawn-review.googlesource.com/c/dawn/+/300095).
- S-03, phone timings for AO and contact shadows (corrected). The only published phone timings are Filament's, on a Pixel 7 Pro (Mali-G710, OpenGL ES, Sponza, AO at half size). SAO Medium took 7.5 ms, SAO High 9.5 ms and GTAO 14.4 ms, blur included. The reports had estimated 0.5 to 1.5 ms. Filament's depth-aware upsample took about 2.0 ms on a Pixel 4 at 250 MHz. No phone timing exists for bitmask AO or contact shadows. Unity HDRP gives contact shadows 0.5 to 1.3 ms on a base PS4 at 1080p. Sources: [Filament PR #8688](https://github.com/google/filament/pull/8688), [Filament commit 62ff7b7](https://github.com/google/filament/commit/62ff7b7d0a23788757ff8816894090abf4ce124a), [Filament PR #9101](https://github.com/google/filament/pull/9101), [HDRP contact shadows](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Override-Contact-Shadows.html).

### Lighting, materials and color

- S-04, three.js r187 (confirmed). Not released: the latest is r186 (24 September 2026, npm 0.186.1). Milestone r187 is due on 21 October 2026. `dev` keeps all four changes. They are cube targets with `roughnessToMip`, the 0.045 floor, diffuse light from the roughest level, and the EON rough diffuse. The base-level blur offset was removed, and the layout is unchanged (256 cube, levels down to 8 x 8). Sources: [r186 release](https://github.com/mrdoob/three.js/releases/tag/r186), [PR #34585](https://github.com/mrdoob/three.js/pull/34585), [PR #34645](https://github.com/mrdoob/three.js/pull/34645), [PR #34379](https://github.com/mrdoob/three.js/pull/34379).
- S-05, half precision rates (corrected for Apple). The Mali-G715 runs 256 FP16 FMAs per clock against 128 FP32, but explicit FP16 gains only as vectors. Adreno's double rate is a family claim, measured on the Adreno 730, not the 830. The Xclipse 940 (RDNA 3) gains only through packed math. The Pixel 10's DXT-48-1536 gives 3,072 FP16 against 1,536 FP32 FLOPs per clock. Apple GPUs run FP16 at twice the FP32 rate up to the A14, and at the same rate from the A15 and M1. So D-09 already measured a double-rate GPU, the iPad's A12X. Sources: [Arm Immortalis-G715 overview](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/arm-immortalis-g715-developer-overview), [Arm GPU Best Practices 3.4](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695), [Qualcomm mobile best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html), [Chips and Cheese on RDNA 3](https://chipsandcheese.com/p/microbenchmarking-amds-rdna-3-graphics-architecture), [Metal benchmarks](https://github.com/philipturner/metal-benchmarks/blob/main/README.md).
- S-06, transmission sources (corrected for Babylon.js). Filament copies the opaque color and builds a Gaussian mip chain. Babylon.js draws the opaque meshes again into a 1,024 x 1,024 half-float target with mips, as three.js's `WebGLRenderer` does. `WebGPURenderer` copies with mips. Sources: [Filament RendererUtils.cpp](https://github.com/google/filament/blob/70d2da5e9b7014e1a4207d737aa8dc41b59880a2/filament/src/RendererUtils.cpp), [Babylon.js transmissionHelper.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/loaders/src/glTF/2.0/Extensions/transmissionHelper.ts), [three.js WebGLRenderer.js](https://github.com/mrdoob/three.js/blob/1dd13e0419ae3c5d3af1c6bca1b1639e60c29e81/src/renderers/WebGLRenderer.js).
- S-07, the cost of ACES 2.0 (corrected). OCIO's "3 to 8 times slower than ACES 1" is CPU time. For the GPU, OCIO 2.4.2 says only "somewhat slower". No engine read has ACES 2.0. The one real-time port found bakes it into a 3D table. Sources: [OCIO ACES 2.0 optimization](https://github.com/AcademySoftwareFoundation/OpenColorIO/wiki/ACES-2.0-optimization), [OCIO v2.4.2](https://github.com/AcademySoftwareFoundation/OpenColorIO/releases/tag/v2.4.2), [a URP ACES 2 tonemapper](https://github.com/SNIELSEL/UnityURP-ACES2-Tonemapper).
- S-08, HDR canvases (corrected for Android). WebGPU's `rgba16float` canvas with `toneMapping: { mode: 'extended' }` ships in Chrome 129 on desktop, Android and WebView, and in Safari 26 on every Apple platform with an HDR display. Firefox lacks it. No browser ships an HDR WebGL2 canvas. Sources: [Chrome Platform Status](https://chromestatus.com/feature/6196313866895360), [New in WebGPU 129](https://developer.chrome.com/blog/new-in-webgpu-129), [WebKit features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
- S-09, Khronos PBR Neutral (confirmed). model-viewer's default since v4.0.0. three.js, Filament, Babylon.js and Blender 4.2 ship it. Sources: [model-viewer v4.0.0](https://github.com/google/model-viewer/releases/tag/v4.0.0), [three.js PR #27668](https://github.com/mrdoob/three.js/pull/27668), [Filament PR #7597](https://github.com/google/filament/pull/7597), [Babylon.js PR #15054](https://github.com/BabylonJS/Babylon.js/pull/15054).
- S-10, the device behind Filament's prefilter figure (still unknown). Filament's "100 to 300 ms for a 5-level 256 cube with 1,024 samples" names no device. The only measured figures are three.js r187's: 10.4 ms with WebGL and 13.0 ms with WebGPU for a 1K HDRI on an Apple M1. No phone timing is published. Sources: [Filament iblprefilter README](https://github.com/google/filament/blob/main/libs/iblprefilter/README.md), [three.js PR #34585](https://github.com/mrdoob/three.js/pull/34585).
- S-11, PlayCanvas's Smith term (confirmed). The isotropic GGX chunk squares alpha twice. Reported in issue #9510; the fix is open. Sources: [PlayCanvas issue #9510](https://github.com/playcanvas/engine/issues/9510), [PlayCanvas PR #9513](https://github.com/playcanvas/engine/pull/9513).
- S-12, two Godot oddities (confirmed). GLES3 filters 7 radiance levels but reads only 6 (`RADIANCE_MAX_LOD 5.0`). Forward+'s DFG table has a +1/128 roughness offset. Neither is reported. Source: [Godot scene.glsl at e7cfa29](https://github.com/godotengine/godot/blob/e7cfa294a0b81bed7986be04a848cc1832a3f083/drivers/gles3/shaders/scene.glsl).

### Post-processing

- S-13, MSAA resolves on Android (confirmed for ANGLE on Vulkan). ANGLE adds a resolve attachment when a color resolve blit follows the draws in the open render pass. An `invalidateFramebuffer` right after makes the samples never reach memory. Conditions: no draw between, no flip, the same formats, one draw buffer and one layer, and a blit area equal to the render area. Chrome uses ANGLE on Vulkan for WebGL only where its field trial turns it on. Sources: [ANGLE commit dff47d5](https://chromium.googlesource.com/angle/angle/+/dff47d5fdaac04d1eb9343308c903157203467ce), [ANGLE commit 9475ac4](https://chromium.googlesource.com/angle/angle/+/9475ac4094664b3fef2d709911553abde7c1e305).
- S-14, Mali frame buffer compression (confirmed). From Valhall (Mali-G57, G68, G77, G78 and later), any format of 32 bits or less; `RGBA16F` only from the Mali-G710. Bifrost has no float formats. Only single-sample images, and Arm states these rules for Vulkan only. Sources: [Arm, AFBC textures for Vulkan](https://developer.arm.com/documentation/101897/latest/Buffers-and-textures/AFBC-textures-for-Vulkan), [Vulkan Samples AFBC](https://github.com/KhronosGroup/Vulkan-Samples/blob/main/samples/performance/afbc/README.adoc).
- S-15, GSR 1 and FSR 1 on phones (corrected). From a 1240 x 576 input, GSR 1 takes 0.48, 0.36 and 0.30 ms on the Snapdragon 888, 8 Gen 1 and 8 Gen 2. A bilinear upscale takes 0.25, 0.20 and 0.16 ms. FSR 1 has one phone figure, on an iPhone 12: optimised EASU 1.8 ms and RCAS 0.9 ms. Sources: [Snapdragon GSR 1 README](https://github.com/SnapdragonGameStudios/snapdragon-gsr/blob/main/sgsr/v1/README.md), [Optimizing FSR](https://atyuwen.github.io/posts/optimizing-fsr/).

### Animation and assets

- S-16, repeated vertex work on Mali and Adreno (confirmed). Mali compiles a position shader and a varying shader, and duplicate position work may repeat. Adreno's binning pass runs a position-only vertex shader. No vendor advises compute or vertex skinning. Qualcomm advises keeping graphics submits apart from compute dispatches. Sources: [Mali Offline Compiler guide](https://documentation-service.arm.com/static/648aeb7f153eb247a5450a90), [Qualcomm mobile best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html).
- S-17, AVIF and WebP in a worker (confirmed on desktops). A dedicated worker decoded both with `createImageBitmap` in Safari 26.6.2, Chrome 154 and Firefox 157 on the Mac. AVIF floors: Chrome 85, Firefox 93, iOS Safari 16.1, macOS Safari 16.4. Source: [MDN browser compatibility data](https://github.com/mdn/browser-compat-data).
- S-18, UASTC HDR in Basis 2.50 (confirmed). The shipped transcoder is the prebuilt v2.50 build with HDR on. It transcoded UASTC HDR 4 x 4 and 6 x 6 and ASTC HDR 6 x 6 to BC6H, half floats, RGB9E5 and ASTC HDR. HDR cannot be compiled out of v2.50. The file is 1,060,846 bytes (361 KB after Brotli). Source: [Basis transcoder CMakeLists.txt](https://github.com/BinomialLLC/basis_universal/blob/v2_50/webgl/transcoder/CMakeLists.txt).
- S-19, UASTC RDO on normal maps (corrected). RDO came with UASTC in March 2020. A test of basisu 2.50 on four 2,048² normal maps saved 0.6 to 21.8% at λ 0.5, and 2.9 to 26.1% at λ 1.0. The reports had said 30 to 40%. Sources: [basis_universal commit 5b6eb56](https://github.com/BinomialLLC/basis_universal/commit/5b6eb56), [KTX artist guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/subpages/KTXArtistGuide_toktx.md).
- S-20, Blender and meshopt (confirmed). Blender 5.2 LTS imports and exports meshopt. Blender 5.1 and older refuse files that require it. Draco imports since Blender 2.92. Sources: [glTF-Blender-IO PR #2701](https://github.com/KhronosGroup/glTF-Blender-IO/pull/2701), [Blender 5.2 release notes](https://developer.blender.org/docs/release_notes/5.2/pipeline_io/).
- S-21, dead blending (confirmed). Holden's article and code are public under MIT. Per joint: position, velocity, rotation, angular velocity and a slerp direction, 13 to 17 floats. Sources: [Dead Blending](https://theorangeduck.com/page/dead-blending), [deadblending.c](https://github.com/orangeduck/Spring-It-On/blob/main/deadblending.c).
- S-22, XUASTC in KTX2 (confirmed). Still a draft: KTX-Specification PR #216 adds supercompression scheme 5 and color model 169. Neither glTF nor three.js reads it. Source: [KTX-Specification PR #216](https://github.com/KhronosGroup/KTX-Specification/pull/216).
- S-23, KTX2 level order and range requests (confirmed). Levels run from the smallest to the largest. Browsers send `Accept-Encoding: identity` with any `Range` request, and servers that compress on the fly drop ranges. So ranged KTX2 fetches get uncompressed bytes, and the file's own Zstandard is the only compression. Sources: [KTX 2.0 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html), [RFC 9110 section 14.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2), [Fetch standard](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch).
- S-24, Unreal and Unity references (confirmed, one correction). Unity's manual does not say that its texture streamer drops the least needed levels first. It gives the smallest level that fits and a per-texture priority. ACL is Unreal 5.3's default animation codec. Sources: [Unreal texture streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/texture-streaming-overview-for-unreal-engine), [Unity streamingMipmapsPriority](https://docs.unity3d.com/ScriptReference/Texture2D-streamingMipmapsPriority.html), [ACL in UE 5.3](https://nfrechette.github.io/2023/09/17/acl_in_ue/).
- S-25, Bevy's environment maps (confirmed). `rgb9e5` KTX2 with Zstandard. Source: [Bevy's environment_maps folder](https://github.com/bevyengine/bevy/tree/844390b279c6ef252d10df2a17912761325db7f2/assets/environment_maps).

### Geometry, culling and architecture

- S-26, why Bevy and Unity turn off GPU culling on some phones (confirmed). Bevy's blocks are driver crashes. Adreno 730 and older crash at shader compile. Mali drivers before r48 report "Parent device is lost". The Pixel 10's PowerVR driver aborts, and the Pixel 11 Pro still crashes. Unity: missing objects on Adreno with Vulkan (UUM-82677). Dawn has related workarounds. On Qualcomm it splits a command buffer where a compute pass follows a render pass. On Imagination GPUs, zeroed workgroup memory is unreliable, and mip sizes of depth textures whose size is not a power of two come out wrong. Sources: [Bevy issue 14146](https://github.com/bevyengine/bevy/issues/14146), [Bevy issue 17591](https://github.com/bevyengine/bevy/issues/17591), [Bevy issue 23754](https://github.com/bevyengine/bevy/issues/23754), [Unity 6000.0.23f1 notes](https://unity.com/releases/editor/whats-new/6000.0.23f1).
- S-27, same-address atomics on phones (confirmed). No phone measurement is published. Qualcomm says atomics on one address are serialized and advises a local atomic first, then one global update. Arm and Apple give the same advice. Sources: [Qualcomm OpenCL guide](https://docs.qualcomm.com/bundle/publicresource/80-NB295-11_REV_C_Qualcomm_Snapdragon_Mobile_Platform_Opencl_General_Programming_and_Optimization.pdf), [Arm GPU Best Practices 3.4](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695).
- S-28, 64-bit atomic min and max (confirmed). Chrome 156 ships it on 20 October 2026 where hardware allows. Safari and Firefox have not. Apple GPUs need the Apple9 family, so the iPad's A12X and every M1 or M2 iPad can never have it. Sources: [gpuweb PR 5610](https://github.com/gpuweb/gpuweb/pull/5610), [Metal feature set tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf).
- S-29, multi-draw indirect (confirmed). Flag-only in Chrome, off on Metal, absent from the specification, Safari and Firefox. Sources: [gpuweb issue 1354](https://github.com/gpuweb/gpuweb/issues/1354), [gpuweb PR 2315](https://github.com/gpuweb/gpuweb/pull/2315).
- S-30, Bevy in browsers and WebGPU's limits (corrected in part). WebGPU added immediates on 7 May 2026, and Chrome shipped them in 149 and 150. wgpu's browser backend does not use them. So Bevy still runs no GPU culling in a browser. Both levels allow 8 storage buffers and 4 storage textures per stage, and 32 bytes per sample. Core allows 8 color attachments, compatibility mode 4. Compatibility mode allows no storage buffers or textures in the vertex stage. Sources: [WebGPU limits](https://gpuweb.github.io/gpuweb/#limits), [New in WebGPU 149 and 150](https://developer.chrome.com/blog/new-in-webgpu-149-150).
- S-31, Safari's render bundle fix (confirmed). WebKit bug 320490 is fixed in Safari 27.2, in beta on 16 September 2026. A later bug, 325413 (a reused bundle loses dynamic offsets), is in no release yet. Sources: [WebKit bug 320490](https://bugs.webkit.org/show_bug.cgi?id=320490), [Safari 27.2 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-27_2-release-notes), [WebKit bug 325413](https://bugs.webkit.org/show_bug.cgi?id=325413).

### Gaps

- S-32, `KHR_gaussian_splatting` (confirmed). Ratified on 3 September 2026. Its compression extensions (SPZ and others) are still drafts. three.js, Babylon.js and PlayCanvas read the base extension. Sources: [the extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting), [glTF PR #2642](https://github.com/KhronosGroup/glTF/pull/2642).
- S-33, naga's GLSL reader (confirmed). It accepts only `#version 440` (partial), 450 and 460 core, and rejects `#version 300 es`. Source: [naga's GLSL front end](https://github.com/gfx-rs/wgpu/blob/14685942a11755e4581c40729dd44591d1d73680/naga/src/front/glsl/mod.rs).
- S-34, light-map extensions (confirmed). Only the Hubs Blender add-on writes `MOZ_lightmap`, and no major engine reads it. Khronos has no light-map extension. Needle's `NEEDLE_lightmaps` is the one in real use. Sources: [Hubs Blender exporter 1.8.0](https://github.com/Hubs-Foundation/hubs-blender-exporter/releases/tag/1.8.0), [glTF issue 1017](https://github.com/KhronosGroup/glTF/issues/1017).
- S-35, WebXR with WebGPU (corrected). Safari on visionOS ships it by default since Safari 26.2. Chrome has it behind a flag, and the specification is an Editor's Draft. Sources: [WebKit features in Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [WebXR/WebGPU binding](https://immersive-web.github.io/webxr-webgpu-binding/).

## Where the earlier reports were wrong

Facts:

1. GPU occlusion culling pays on a quiet GPU: 37% in the room scene on the Mac (1.64 to 1.04 ms). D-40's slowdown came from other programs' GPU work between null3D's passes.
2. The S24+ has no WebGPU adapter. Every "WebGPU phone" check needs a cloud phone.
3. null3D has no native render bundles since #49; the backend replays bundles in TypeScript. The note that Safari pays twice for the occluders' bundle does not apply.
4. three.js r187's prefilter reads about 53 million texels, against the asset tool's 98 million. It has a 256 cube with 6 levels down to 8 x 8.
5. A run-time prefilter costs tens of milliseconds, not 5 to 10 ms (S-10).
6. three.js's `LightProbeGrid` adds to the environment's light; it does not replace it.
7. Bevy's bitmask AO does not run in browsers, and has 6 sectors, not 32.
8. The Draco decoder is 59 KB after Brotli in its glTF-only build, not 66 KB.
9. Draco loses to meshopt on animated and morphed files by 3.2 to 3.7 times after Brotli, and wins by 14 to 27% on static meshes.
10. A spot light in lumens divides by π in three.js and Filament, not 4π.
11. No engine derives a light's range from its intensity.
12. Filament no longer has PCSS or DPCF filters of its own; Godot 4 has contact shadows again in Forward+.
13. One 16-bit depth step in S4's last cascade is 14.4 mm, not 1 cm.
14. three.js's FXAA is Catlike Coding's version, not quality preset 28.
15. The phone traffic figures used about 2.2 million pixels for the S24+. At Low it draws about 0.63 million, so those GB/s estimates were about 3.5 times too high. The iPad at Medium, about 4.0 million pixels, is where those costs are largest.
16. Godot ray casts for software occlusion culling; it does not rasterize.
17. three.js's `WebGPURenderer` builds the model-view matrix on the GPU in 32-bit floats.

From the web search:

18. Compatibility mode can read a depth texture with `textureLoad` (S-01). The case for a separate depth pass into a color target, and the compatibility-mode argument against PCSS, lose their reasons.
19. three.js gives a reason for its Android shadow switch, and Chrome 149 works around it (S-02).
20. AO on phones at half size costs 7.5 to 14.4 ms, not 0.5 to 1.5 ms (S-03).
21. Babylon.js draws the opaque objects again for transmission (S-06).
22. The Pixel 9's double rate holds only for vector math, and the S25's is not measured. The iPad's A12X runs FP16 at twice the rate, so D-09 measured a double-rate GPU (S-05).
23. UASTC RDO saves about 0 to 25% on normal maps (S-19).
24. Browser WebGPU now has immediates (S-30).
25. Nothing supports "phones have fewer atomic units"; the vendors' advice to add per workgroup does (S-27).
26. `MOZ_lightmap` is not the light-map extension in use; `NEEDLE_lightmaps` is (S-34).
27. Safari on visionOS ships WebXR with WebGPU (S-35).
28. OCIO's ACES 2.0 figure is CPU time (S-07). Chrome on Android has the WebGPU HDR canvas (S-08). Qualcomm publishes GSR 1 timings (S-15). Range requests fail through on-the-fly content encoding, not transfer encoding (S-23). Unity does not say that it drops the least needed levels first (S-24).

Rulings that changed under the best-default rule:

29. Each "keep three.js's way by default" became the better default. That covers bloom, outlines, the vignette, the tone curve, specular anti-aliasing and specular occlusion. It also covers fog, the environment lookup, diffuse environment light, exposure, contact shadows and the probe grid's mode.
30. Inertial transitions become the default fade if A4 passes; the first round kept cross-fade because three.js uses it.
31. Reading UASTC HDR files reverses the first round's "do not adopt yet", because three.js projects load them.
32. BC7 stays before BC1 on desktops, reversing the first round.

The deep reports dropped some items without saying so, and they still matter:

- the D-41 buffer-size and pixel-rule runs (now G8), and the shadow-pass detail-level check (G9);
- point-light face culling, and the render-scale controller's check that a step down helped;
- automatic exposure, depth of field and weighted blended transparency.
