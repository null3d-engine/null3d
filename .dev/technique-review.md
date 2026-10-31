# Technique review

This page compares null3D's techniques with the source code of eight engines. They are three.js, Filament, Bevy, Godot, Unity's URP and HDRP, Babylon.js, PlayCanvas and Wicked Engine. The page holds the changes, prototypes and gaps that are still open, each with its reason. It also holds the reference that lasts:

- the porting verdicts and the contents of the `three-compat` add-on;
- what other engines and three.js do, by area;
- the rules for WebGL2 texture units;
- the techniques that three.js lacks, and the browsers' GPU features;
- the web search results with their sources (S-01 to S-35).

The [code review](code-review.md) lists the open findings in the engine's code.

The owner decides each question. The decisions and their reasons are records:

- [D-52](decisions/D-52-intent-parity.md): intent parity, the `three-compat` add-on, built-in assets made at run time, and add-on modules.
- [D-53](decisions/D-53-technique-defaults.md): the 28 technique rulings.
- [D-54](decisions/D-54-addon-modules.md): add-on modules, the one on-demand loader, and CDN delivery.
- [D-14](decisions/D-14-js-budget.md): the budget for first-use shader files, Draco's exception and the gzip columns.
- [D-173](decisions/D-173-addon-hooks.md): one place per feature, public API only for add-ons, the foundation add-ons and the hooks.
- [D-179](decisions/D-179-technique-rulings.md): the newer techniques, and every item that was set for after 1.0.
- [Device sessions](devices.md#which-device-runs-a-check): real phones on BrowserStack Automate first.

## Rules

- The best technique is the default ([D-52](decisions/D-52-intent-parity.md)).
- Intent stays strict: glTF, materials, color, units and animation behave as the glTF specification and three.js say.
- Looks are "equivalent or better". The porting skill rewrites three.js code onto null3D's technique and maps its settings. The core keeps no three.js-look mode. A look that a port truly needs goes to the opt-in `three-compat` add-on.
- Benchmarks compare equal work, with quality notes. Pixel tests against three.js run only for shared building blocks.
- Built-in assets are made at run time. Heavy or niche features are add-on modules.
- Real-phone tests run on BrowserStack Automate where they can. The owner's Galaxy S24+ serves only checks that need a USB cable. Brave is not tested.

Terms on this page:

- HDR color: color values above 1, before the tone curve turns them into screen color.
- Shader file: a generated file of shader builds. A page downloads its GPU path's start file when it starts, and a feature's own file when the feature first runs ([D-13](decisions/D-13-shader-variants.md), [D-56](decisions/D-56-first-use-shader-files.md)).
- Texture unit: a slot through which a WebGL2 shader reads a texture. Every device gives a fragment shader at least 16.
- Phone cost: the extra time or memory on a phone. A figure names its measurement, or says "estimate": arithmetic or judgment that a prototype must confirm.

## Open changes

### Lighting and color

- The environment lookup at each material's own roughness. The lit shader maps roughness to a level of the environment cube through a table fitted to three.js r186's atlas (`lib/ibl.wgsl`). That atlas blurs each level less than its own GGX lobe. So a rough metal reflects a sharper sky than its own sun highlight. Read the cube at `lod = (n − 1) r (2 − r)`, as Filament and three.js r187 do, and delete the fitted table. Read the lighting table with one filtered read in place of 4 loads. Prototype L2 checks the change.
- Diffuse environment light from the roughest level times π. Diffuse light comes from nine spherical harmonic coefficients. three.js r187 reads the roughest level, and Filament filters its last level extra smooth for that reason. Take the roughest level, and drop the coefficients, if L2 shows that the read costs under 1% of a GPU-bound frame.
- The three.js pin. Move it to r187 in one change, and drop its patch of the roughness floor ([D-79](decisions/D-79-lighting-defaults.md), [D-53](decisions/D-53-technique-defaults.md) ruling 5). Release r187 changes three lighting terms: the 0.045 floor, the own-roughness lookup with no base-level offset, and diffuse light from the roughest level. Against release r186, the own-roughness lookup cannot pass the strict pixel tests. Until r187 is released, the lighting-term fits need three.js main as a second package, `three-next`, which the repository does not have.
- Product templates take the Neutral tone curve ([D-53](decisions/D-53-technique-defaults.md) ruling 4). The command-line tool has no product template yet.

### Output and post-processing

- FXAA's edge search. null3D's FXAA is the FXAA 3.11 console path, which takes two or four taps along an edge. Add an edge search with three.js's 6-step schedule, on the squeezed HDR color, for long and shallow edges. Prototype P3 must show that it costs under 0.1 ms more on the cloud phones.
- MSAA on Low. Medium and up take MSAA 4x, and Low takes FXAA. Prototype P3 decides Low: MSAA if it costs under 0.5 ms more than FXAA.
- HDR output to the display. The engine draws SDR, and it needs an `output: 'hdr'` option on WebGPU for HDR screens. Chrome 129 and Safari 26 ship WebGPU's `rgba16float` canvas with extended tone mapping. No browser ships an HDR WebGL2 canvas (S-08).

### Shadows and ambient occlusion

- AO's method. AO runs three.js's GTAO horizon search and Poisson denoise at a fraction of the render size (`ao.wgsl`). The lit pass reads it with a depth-weighted read of 4 texels. The bitmask variant of GTAO removes the dark halos behind thin objects. At the same slices and steps it costs no more than the horizon search. That holds on both GPU paths, at half and at quarter size. Filament's fragment form needs no storage texture ([D-280](decisions/D-280-bitmask-ambient-occlusion.md)). The engine change that replaces the search is not built. Two changes remain:
  - Filament's separable bilateral denoise.
  - A plain bilinear upsample. Filament measured its depth-aware upsample at about 2 ms on a Pixel 4 (S-03).
- AO on phones. AO stays off on Low and Medium until prototype S3 meets its pass rules ([D-53](decisions/D-53-technique-defaults.md) ruling 14). Filament measured 7.5 to 14.4 ms for AO at half size on a Pixel 7 Pro (S-03).

### Shader files

- The outline mask builds into every start file (`crates/null3d-shaders/shaders.toml`). It needs a first-use table, as AO, morph targets and GPU occlusion culling have, so that pages without outlines skip its builds ([D-56](decisions/D-56-first-use-shader-files.md)).
- `bench:startup` on BrowserStack's Galaxy S25 and Pixel 9. Phones parse the start file on the drawing thread before the first frame. The run decides whether the `standard_maps` builds split by a second fixed bit.

### Animation

- The default fade. Inertial transitions are built, and a sketch opts in with `transition: 'inertial'` ([D-165](decisions/D-165-inertial-transitions.md)). They become the default for switching what a layer plays in new scenes if prototype A4 passes. The owner then picks the default by eye ([D-53](decisions/D-53-technique-defaults.md) ruling 18). Ports keep three.js's cross-fade.
- Baked joint textures for crowds. Crowds share instanced draws that read each frame's joint texture, and no baked path exists. A crowd that plays baked clips takes baked joint textures, not vertex animation textures. A 2-second clip of the Knight's 51 joints at 30 fps is 147 KB, against about 4.75 MB of baked vertices.
- Large morph deltas. Half-float deltas round a delta of several meters, so the asset tool needs to warn on such deltas ([D-51](decisions/D-51-morph-targets.md)).

## Porting verdicts

| three.js feature | null3D's technique | Verdict | What the porting skill does | How visible the difference is |
| --- | --- | --- | --- | --- |
| `UnrealBloomPass`, `bloom()` node | Mip-chain bloom | Rewrite | Maps `strength` to intensity and `radius` to the level weights, and keeps the threshold | Moderate on strong bloom: the glow's falloff differs. Equivalent on mild bloom |
| pmndrs `BloomEffect`, R3F `<Bloom>` | Mip-chain bloom | Rewrite | Maps `luminanceThreshold`, `luminanceSmoothing`, `intensity`, `radius` and pmndrs's level weights. SCREEN blending stays, as `blend: 'screen'` | Small |
| `OutlinePass`, pmndrs `OutlineEffect` | Crisp outline | Rewrite; glow and pulse to `three-compat` | Maps `edgeThickness` to width and the visible and hidden edge colors. With `edgeGlow` above 0 or `pulsePeriod`, it imports `three-compat`'s soft outline | Small without glow; large with glow or pulse |
| `VignetteShader`, pmndrs `Vignette` | HDR vignette | Rewrite | Maps `offset` to size and `darkness` to intensity | Small: corners darken a little more in highlights. three.js's lift of dark corners at `darkness` below 1 is lost |
| `Fog`, `FogExp2` | Native fog | Rewrite | `Fog(near, far)` becomes the linear curve, `FogExp2(density)` the exp2 curve | Small: corners get a little thicker fog, because distance is radial |
| ACES filmic | AgX by default | Native: ACES stays in the core ([D-179](decisions/D-179-technique-rulings.md)) | Sets `'aces'` | None |
| Reinhard, Cineon | AgX by default | Move to `three-compat` | Imports `three-compat` and sets the same curve | Large: the scene's colors were chosen under that curve |
| AgX, Neutral, no tone mapping | The same curves | Native | One to one. null3D's AgX is three.js's polynomial | None |
| `GTAOPass`, `SSAOPass`, `SAOPass` | AO on indirect light | Rewrite | Maps `GTAOPass`'s settings by name. AO darkens only the ambient light, where `GTAOPass` darkens the whole image | Moderate |
| `LightProbeGrid` | A probe grid that replaces the environment's diffuse light | Rewrite | Sets `environmentWeight` to 0 where the grid must add to the environment's light, as three.js's grid does | Small to moderate indoors |
| `CSM`, `SunLight` | Native cascades | Rewrite | Maps the cascade count, `maxFar` and `shadowMapSize`. The split mode has no equivalent | Slight: the near cascade is shorter, and bands blend at their edges |
| `shadow.radius`, `PCFSoftShadowMap`, `VSMShadowMap` | Castaño 3x3 and 5x5 | Rewrite | Maps the shadow type to the `shadowFilter` setting. VSM has no equivalent | Small: the penumbra loses three.js's grain |
| `LOD.addLevel(object, distance, hysteresis)` | Levels by error, distance or screen coverage | Rewrite | Keeps each distance in `setLevels`, where it holds on every screen height. A dithered band replaces hysteresis | Small: a large object switches later |
| `crossFadeTo`, `crossFadeFrom` | Weighted cross-fade | Rewrite onto `transition: 'blend'`, never inertial | One to one | None: animation is strict |
| Specular anti-aliasing term, horizon fading off, r186's environment blur | Filament's kernel, horizon fading, own-roughness lookup | Rewrite | Nothing to map | Very small at rest; less shimmer in motion |
| `RoomEnvironment` with `PMREMGenerator.fromScene`; `RGBELoader` or `HDRLoader` with `PMREMGenerator` | The room generator and HDR loading on the tool's filter | Rewrite | Maps to `assets.builtinEnvironment('room')` and `assets.loadEnvironment(url)` | Small |
| `TAARenderPass`, `SSAARenderPass` | Still-camera accumulation | Rewrite | Drops the pass: a view that holds still blends jittered frames by itself. `sampleLevel` has no counterpart | None at rest |
| `FXAAShader`, `FXAANode`, `SharpenNode` | The same algorithms | Rewrite | One to one | None |
| `Line2`, double-sided blended surfaces, alpha to coverage, alpha hash | The same techniques | Native | One to one; `forceSinglePass` maps to one draw | None |

The native techniques have settings that ports map onto: bloom's blend and level weights, the probe grid's `environmentWeight`, and the fog's curve. Each is a uniform, with no new shader build.

A three.js-look mode kept in the core would cost:

- a shader file and the builds in it;
- image tests on three GPU paths in two reference sets, and a parity scene;
- docs, mapping entries and skill text for two ways to do one task;
- the work of keeping the mode alive through every later change to the native effect.

So the core has no copy of three.js's vignette formula, `UnrealBloomPass`'s steps or `OutlinePass`'s steps, and ACES is not the default.

## The three-compat add-on

`@null3d/three-compat` holds the three.js looks that a port needs and the core leaves out ([D-179](decisions/D-179-technique-rulings.md#the-three-compat-add-on)):

1. three.js's tone curves Reinhard and Cineon. Color is strict, so ports keep them. ACES stays in the core as a shared building block ([D-179](decisions/D-179-technique-rulings.md), ruling 23).
2. `OutlinePass`'s glow, pulse and blurred edge, through `createOutlinePass`.

The add-on has no `UnrealBloomPass` steps, because the mip chain's mapped settings reach their look ([D-21](decisions/D-21-effect-chain.md)). It has no three.js vignette either, because the rewrite is close enough.

The extension points it uses are public, so other add-ons can use them too:

- The tone-curve setting: a WGSL curve that the final pass calls in place of the built-in one. The forced 8-bit path keeps the built-in curve, so the add-on's curves have no 8-bit copy.
- Custom passes at half and quarter size, with the outline mask as a pass input.
- Custom effects.
- First-use shader files, so the add-on adds nothing to pages that do not import it.

## What other engines and three.js do

### Lighting, materials and environment light

- null3D's base BRDF is the most complete in the sources read. It has exact correlated Smith, energy compensation, and a (1 − F) diffuse weight that Filament still lists as a to-do. three.js r187 and Filament floor roughness at 0.045, as null3D does.
- three.js r186's environment atlas blurs each level less than its own GGX lobe. Filament and three.js r187 read the cube at `lod = (n − 1) r (2 − r)`. r187 adds no offset for the base level's own blur ([three.js PR #34645](https://github.com/mrdoob/three.js/pull/34645)).
- r187's EON rough diffuse (`diffuseRoughness`) is Lambert at its default of 0, so default materials still compare strictly.
- null3D keeps three.js's falloff formulas. No engine derives a light's range from its intensity.
- Cone occlusion from GTAO's bent normal needs a bent normal, which the bitmask variant does not give. null3D uses Lagarde's specular occlusion with horizon fading.
- Filament and Wicked Engine write prefiltered maps as `R11F_G11F_B10F`. Bevy ships its maps as `rgb9e5` KTX2 files with Zstandard (S-25), as null3D's asset tool does ([D-19](decisions/D-19-environment-maps.md)).
- The shipped Basis 2.50 transcoder reads UASTC HDR files (S-18), so null3D reads them with no extra transcoder size.

### HDR overflow and exposure

- Color above 65,504, the largest 16-bit float, becomes infinity or NaN on SwiftShader. Chrome on Android draws WebGPU through Vulkan, which may do the same. The tone curves then draw black, and bloom vanishes.
- The GGX peak is 1 / (π r⁴). At a roughness floor of 0.0525 it is about 42,000 times the light's irradiance, and a floor of 0.045 raises it about 1.85 times.
- Exposure in the lights keeps real-unit scenes in range: a 100,000 lux sun at EV100 15 stores values near 1. Scenes at exposure 1, as most ports are, still need the color limit.
- URP limits bloom's input at 65,472. Filament limits or compresses bright texels of HDR files on upload. A Karis average damps bright pixels, but it does not stop infinity.
- Bevy found that the largest 32-bit float as a WGSL literal breaks Chrome.

### Output and post-processing

- Every engine read draws bloom through a mip chain, except three.js and Babylon.js.
- three.js's FXAA is Catlike Coding's version. null3D's is the FXAA 3.11 console path.
- ANGLE's Vulkan backend can resolve MSAA in tile memory (S-13). A resolve blit must follow the last draw, at the same size and format, with one draw buffer. Then `invalidateFramebuffer` follows. The engine's WebGL2 backend resolves that way.
- Qualcomm measures GSR 1 at 0.14 to 0.23 ms more than a bilinear upscale (S-15).
- Filament and URP dither with static triangle noise of one step, last, after the color table and the vignette, as null3D does.
- R11G11B10 has 6 or 5 mantissa bits against 10, so accumulation history stays `rgba16float`.
- three.js's `WebGPURenderer`, and `WebGLRenderer` with a half-float output, mix fog before tone mapping, as null3D does. Only `WebGLRenderer`'s 8-bit default mixes after.
- Filament bakes grading controls with the tone curve into one 32³ table. null3D's grading table follows the tone curve instead, so a custom curve still works ([D-214](decisions/D-214-grading-controls.md)).
- No engine read has ACES 2.0. OCIO's "3 to 8 times slower" is CPU time (S-07). A user can load a baked ACES 2.0 table as a `.cube` file, so it stays out of the core.

### Shadows and ambient occlusion

- null3D picks a cascade by distance from the camera. Every other engine read picks by view depth, which moves when the camera turns ([D-16](decisions/D-16-moving-casters-and-bias.md)).
- Godot caps shadow redraws at 512 passes per frame. null3D caps shadow tile redraws at 12 tiles per frame ([D-61](decisions/D-61-shadow-tile-redraws.md)).
- Filament has no PCSS or DPCF filters of its own. Godot 4 has contact shadows in Forward+. null3D has no PCSS before 1.0.
- Bevy's bitmask AO does not run in browsers: it needs 5 storage textures per stage, where WebGPU gives 4. It has 6 sectors, not 32.
- three.js's `LightProbeGrid` adds to the environment's light. null3D's grid replaces the environment's diffuse light by default.

### Geometry, culling and drawing

- Godot ray casts for software occlusion culling; it does not rasterize. null3D's buffer is about 9 times finer than Godot's on 8 threads, and about 18 times on a 4-thread phone pool.
- `discard` turns off hidden-surface removal on Apple and PowerVR tile GPUs, and early depth on Mali.
- Alpha to coverage needs a multisampled target, and PlayCanvas reads the specification as needing a format with alpha. null3D's WebGPU target has no alpha, so its shader writes the sample mask ([D-82](decisions/D-82-transparency-parity.md)).
- Core WebGPU allows 8 color attachments, compatibility mode 4, and WebGL2 at least 4, with 32 bytes per sample (S-30).
- three.js's `WebGPURenderer` builds the model-view matrix on the GPU in 32-bit floats. Only `WebGLRenderer` builds it on the CPU in doubles. null3D's cells are more precise than the WebGPU renderer's default.
- The engine adopts multi-draw indirect and 64-bit atomics as browsers ship them ([D-179](decisions/D-179-technique-rulings.md) ruling 27; S-28, S-29).

### Animation

- Mali and Adreno run a vertex shader's position work twice in some cases (S-16).
- No engine read has dual quaternion skinning, and glTF characters are weighted for linear blend.
- Holden's dead blending code (MIT) is the reference for inertial transitions, at 13 to 17 floats per joint (S-21).

### Assets

- three.js transcodes ETC1S to RGBA32 where null3D takes ASTC, which is 4 times the memory. null3D takes BC7 before BC1 on desktops.
- Mesa offers ETC2 and ASTC on desktop Linux GPUs that lack them, and decodes them in software on the main thread. three.js guards against it. null3D takes BC first on WebGL2 instead, with no platform check ([D-72](decisions/D-72-image-formats.md)).
- S6's textures take 100 MiB with ETC2 or ASTC, 156 MiB with BC7 only, and 624 MiB as RGBA8.
- UASTC RDO saves about 0 to 25% on normal maps after Zstandard (S-19).
- Draco's glTF-only decoder is 59 KB after Brotli: 49 KB of WebAssembly and 10 KB of JavaScript.
- After Brotli, Draco is 14 to 27% smaller than meshopt on static meshes. It is 3.2 to 3.7 times larger on animated or morphed files, because it leaves clips and morph targets raw. Compare sizes after transport compression.

## WebGL2 texture units

On WebGL2 the lit shader's fragment stage reads at most 16 textures. The unit test in `gpu/webgl2/programs.test.ts` keeps 3 units spare in each stage for later features. A build that samples the opaque color's copy, scene depth or the light tables uses one of them. Rules for every new per-pixel input:

1. AO and every other screen-space result share one texture. Occlusion, depth, the reflected ray's length and contact shadows sit in it, and contact shadows march at AO's half size ([D-135](decisions/D-135-contact-shadows.md)).
2. All probe grids share one 3D texture.
3. Reflection probes are octahedral maps in one 2D array. Compatibility mode has no cube arrays.
4. The two LTC tables of area lights are two layers of the split-sum table's array. The lights' images and the reflection probes' maps share it too ([D-145](decisions/D-145-area-lights.md), [D-149](decisions/D-149-reflection-probes.md)).
5. Light maps take a layer of the material's shared arrays. A decal takes one unit, for scene depth ([D-144](decisions/D-144-projected-decals.md)).
6. The unit test counts the units of every shipped GLSL stage, and fails past 16 less the spare units. A custom material that needs more units than the device has fails with E1209.

## Prototypes

IDs: L lighting, S shadows and AO, P post, G geometry, A animation and assets, X gaps. "Cloud" means BrowserStack Automate. Each prototype below is still open.

| ID | Experiment | Devices | What it decides, and the pass rule |
| --- | --- | --- | --- |
| L2 | Own-roughness lookup against the fitted table on the sphere grid; the strict lighting fit against three.js main as `three-next`; the roughest level against spherical harmonics | Mac; iPad, cloud Pixel 9 and S25 for cost | Delete the fitted table. Drop the coefficients if the roughest level costs under 1% |
| L3 | Specular shimmer: the tool's bake against the shader's kernel, and bake plus kernel; the kernel's GPU time | iPad, cloud Pixel 9 and S25 | The kernel's settings ([D-101](decisions/D-101-roughness-bake.md)). Pass: shimmer halved for under 1% of GPU time |
| L4 | WebGL2 clustered-light listing time and texture reads | Cloud Pixel 9 and S25, WebGL2 forced | Depth binning if listing passes 0.3 ms. It runs before any redesign of the light clusters |
| L5 | Half precision with the half math written as vectors; repeat the shadow test that failed at 0.508% on the S24+. Low priority | Cloud Pixel 9 | Whether [D-09](decisions/D-09-half-precision.md) changes |
| S3 | AO's depth input (the half-size copy against an `r16float` pass, on cost only); Filament SAO 7 reads, GTAO 2 x 3, GTAO 2 x 3 with the bitmask, Filament's 4 x 3; each with bilinear and depth-aware upsample; the half-size contact shadows | Mac; iPad at High and Medium, scales 1 and 0.5; cloud S25 at High | AO's method and phone tiers. Pass: the iPad's Medium gets AO under 1.5 ms; a phone at High under 2 ms at scale 0.5, else the quarter size, else off; contact shadows under 0.5 ms on the S25 at High |
| S4 | Cascade blend at 0% and 10%; 16-bit cascades against their 32-bit twin | Cloud S25 and Pixel 9 (Low), iPad (Medium) | The blend's cost ([D-73](decisions/D-73-cascade-blend.md)), and the 16-bit cascades' cost on the iPad ([D-76](decisions/D-76-16-bit-cascades.md)) |
| S5 | Compatibility mode reading depth as unfilterable float with `textureLoad`, single-sample and multisampled | A compatibility-only device (cloud Galaxy Tab A9 Plus, Adreno 619), and a Mali one if offered | Whether the direct read holds on OpenGL ES drivers. If the multisampled read fails, that tier reads a prepass without MSAA |
| S7 | Probe grid on and off | iPad, cloud S25 | The grid's tiers |
| P3 | Anti-aliasing on Low: FXAA, FXAA with the edge search, MSAA 4x | Cloud S25, Pixel 9, 10 and 11, WebGPU and WebGL2; iPad | MSAA on Low (under 0.5 ms more than FXAA), and the edge search (under 0.1 ms more). Record whether Chrome draws WebGL2 through ANGLE on Vulkan |
| P4 | Outline styles, crisp and soft | iPad, cloud S25 | The line's GPU time and the default width ([D-36](decisions/D-36-outlines.md)) |
| G1 | GPU occlusion culling's image check on two Adreno and two Mali phones, an Adreno 730 or older, a Mali driver before r48, and the Pixel 10 and 11 | Cloud phones, older GPUs where offered | The Android rows. On for a GPU that passes the image check, saves 10% quiet and loses no more than 5% loaded. Off for any GPU that fails the image check |
| G4 | Sphere survivors that an oriented-box test would reject in S6 | Rust test | Add the box test if it drops more than 10% |
| G5 | Native render bundles with an indirect draw | Mac Chrome; Safari 27.2 | Revisit when Safari 27.2 is the oldest supported and WebKit bug 325413 is fixed in a release (S-31) |
| G7 | The GPU pick's depth test against raycasts on thin and masked objects | Mac, iPad, an Adreno phone | The device proof of GPU picking ([D-166](decisions/D-166-gpu-picking.md)) |
| A4 | Inertial transitions against cross-fade on S5's walk-to-run switches | iPad | The default fade for new scenes |
| A5 | WebGL2 morph targets summed once per frame into a target, against the vertex loop, with 52 targets and 3 cascades | Cloud S25 and Pixel 9, iPad, WebGL2 forced | Whether the WebGL2 weight cap can go ([D-51](decisions/D-51-morph-targets.md)) |
| A6 | Texture budget in Godot's order, need estimated on the CPU | iPad, cloud S25 | The texture budget's drop order ([D-69](decisions/D-69-texture-budget.md)) |
| X2 | MSDF text on the sprite path, 100 to 10,000 labels, against HTML labels and troika | Mac, iPad, cloud S25 and Pixel 9 | Text. Pass: 1,000 labels within 0.5 ms of GPU time on the S25 |
| X3 | three.js's GLSL-to-WGSL transpiler over its 52 example shaders and the porting corpus | Mac | Whether a shader port command is worth building. Pass: 70% compile with no hand edits |

GPU occlusion culling stays off on desktops ([D-22](decisions/D-22-occlusion-presets.md)). Its stall between passes under another program's GPU load is open for the owner ([D-40](decisions/D-40-gpu-occlusion.md)).

## Gaps, ranked

Rank is the value to users per unit of effort, among every gap that the comparison found. The ranks that the table leaves out belong to gaps that the engine fills. Effort is S, M or L.

| Rank | Gap | Who ships it | Effort | Where |
| --- | --- | --- | --- | --- |
| 7 | MSDF and SDF text in the scene | PlayCanvas, Godot, Babylon.js; drei's `Text` | S to M | M3; an add-on if its tools are large |
| 8 | Physics adapter | three.js add-ons, Babylon.js, PlayCanvas, Godot | M | M3 add-on, `@null3d/rapier` ([D-53](decisions/D-53-technique-defaults.md) ruling 7) |
| 9 | GLSL-to-WGSL port command | three.js's transpiler | S to M | M3, command line only. naga cannot read GLSL ES (S-33) |
| 15 | IK (two-bone, aim, CCD) | Godot, Babylon.js, a three.js add-on | S to M | M3; an add-on if large |
| 18 | `KHR_materials_variants` | Babylon.js, PlayCanvas | M | M3. The loader refuses such a file with E1417 |
| 19 | Root motion | Godot, Babylon.js | M | M3 |
| 20 | Shape casts and closest-point queries | three-mesh-bvh | M | M3, with physics |
| 26 | Motion blur | Most engines | M | M3 ([D-132](decisions/D-132-showcase-look-and-features.md)) |
| 30 | WebXR | Babylon.js, PlayCanvas, three.js | L | After 1.0, as its own milestone ([D-179](decisions/D-179-technique-rulings.md) ruling 28). XR needs the thread mode that draws on the main thread, so that mode stays working |

Global illumination is M3's leak-free probe volume on the light probe grid ([D-179](decisions/D-179-technique-rulings.md) ruling 12, [D-146](decisions/D-146-light-probe-grid.md)). Each probe gains a validity mask and a sky-occlusion term, and the volume runs on phones and WebGL2.

The water add-on has river and lake water ([D-257](decisions/D-257-water-addon.md)). Its FFT ocean comes in M3 ([D-179](decisions/D-179-technique-rulings.md) ruling 19).

Navigation meshes, CSG, trails and exporters block no user segment in 1.0.

## Techniques three.js lacks

The facts below come from three.js's r186 tag and its r187 development branch, and from the talks of SIGGRAPH Advances 2024 to 2026 and HPG. They also come from the browsers' GPU feature status. The engines' releases are Unreal 5.7, Unity 6, Godot 4.6, Bevy 0.17 to 0.20, Babylon.js 9 and PlayCanvas 2.23. The owner's rulings on them are [D-179](decisions/D-179-technique-rulings.md) and [D-173](decisions/D-173-addon-hooks.md).

### What three.js has

three.js has basic versions of most screen effects, so a basic version does not set null3D apart. null3D leads on quality, detail levels and phone speed.

| three.js feature | Where | What it does and lacks | null3D's answer |
| --- | --- | --- | --- |
| `SSGINode` | r187 branch, display nodes | Bounce light from what is on screen, with visibility bitmasks. Needs TRAA or a denoiser, and loses all light whose source is off screen | Screen-space bounce light at half size on High and above, an M3 core task; the probe volume of D-179 ruling 12 gives bounce light from off screen |
| `VXGINode` | Example only, WebGPU only | Voxel cone tracing in one 64³ volume, diffuse only | No equivalent; too heavy for phones |
| `LightProbeGrid` | Add-on, WebGPU and WebGL | A baked L2 probe grid with several bounces. No validity mask, no sky term, so light leaks through walls | The L1 probe grid ([D-146](decisions/D-146-light-probe-grid.md)), with a validity mask and a sky-occlusion term in M3 |
| `TAAUNode` | r187 branch, display nodes | A temporal upscaler: Halton jitter, variance clipping, a hand-tuned lock. Needs MSAA off | No equivalent: the temporal resolve does not ship, so the upscaler is dropped ([D-206](decisions/D-206-temporal-resolve.md); D-179 rulings 16 and 24) |
| `TRAANode`, `FSR1Node` | Display nodes | Temporal anti-aliasing; FSR 1's spatial upscale and RCAS sharpening | MSAA from Medium up; below render scale 1, the two-step output with GSR 1 ([D-167](decisions/D-167-two-step-output.md)) |
| `SSRNode` | Display nodes | Reflections from what is on screen, with a denoiser example | Screen-space reflections ([D-134](decisions/D-134-screen-space-reflections.md)) |
| `OITPassNode` | Display nodes | Weighted blended transparency, for plain blended materials only | The `weighted` blending ([D-150](decisions/D-150-weighted-blended-transparency.md)) |
| `SSSNode` | Display nodes | Screen-space shadows of the main directional light, about 1 m long | Contact shadows ([D-135](decisions/D-135-contact-shadows.md)) |
| `ClusteredLighting` | Add-on, WebGPU only | Clustered point lights, built with compute. No shadows, no spot lights | Clustered point and spot lights with shadows on both GPU paths |
| `SunLight`, `SunShadowNode` | Add-on, r186 | Two shadow cascades fitted to the view, in one atlas | Native cascades, with a blend between them |
| `GaussianSplat` | Add-on, r186 | Splats with a GPU counting sort and spherical harmonics up to degree 3. No detail levels, no streaming; on WebGL2 it sorts on the main thread | The splats add-on, `@null3d/splats`, with detail levels, streaming, a budget and depth mixing |
| `webgpu_compute_rasterizer` | Example only | A software rasterizer in compute with a visibility buffer, for over a billion triangles | Waits for 64-bit atomics in browsers (D-179 ruling 27) |

three.js lacks:

- probe grids that do not leak through walls, and probes that store how much sky they see;
- a way to keep the cost of many lights fixed;
- a baker for light maps or probes inside the engine;
- light maps that store the light's direction;
- soft shadows from distance fields, and cached shadow pages;
- automatic exposure;
- an ocean with real wave simulation;
- hair strands, and skin light scattering with real diffusion profiles;
- a full OpenPBR material;
- grass made on the GPU;
- splats with detail levels and streaming.

null3D has these in its core, and three.js does not: GPU and CPU occlusion culling, large-world precision and clustered lights with shadows. It also has compute skinning, built-in raycasts and the worker threads.

### Other web engines

- **Babylon.js 9**: shadows from the environment's light on voxelized casters, OpenPBR as an alpha, and a frame graph. It also has clustered lights on both GPU paths, textured area lights, and splats with shadows and SOG and SPZ files.
- **PlayCanvas 2.23**: clustered lights on WebGL2 with shadows, cookies and area lights, and lit fog for clustered lights. Its splats stream, with detail levels and a global splat budget.
- **Needle Engine**, on three.js: light maps baked in Unity and Blender, and progressive loading of textures and meshes.
- **Spark 2**, a splat renderer for three.js: detail trees, streaming in its own format, and 0.5 to 2.5 million splats per device budget.

### Browser GPU features

| Feature | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| WebGPU | Desktop since 113, Android 12 and up since 121 | Windows since 141, Apple silicon since 145; Android behind a flag | 26 and up, on every Apple platform |
| Subgroups | 134 | No | No |
| `shader-f16` | 120 desktop, 121 Android | No | 26 |
| Compatibility mode (OpenGL ES 3.1) | 146 | No | No |
| Immediates | 149 and 150 | No | No |
| Subgroup size control | 151 and 152 | No | No |
| 64-bit atomic min and max | 156, where hardware allows (S-28) | No | No |
| Bindless resources, multi-draw indirect, mesh shaders, ray queries | Draft proposals or experiments only | No | No |
| WebNN | Origin trial | No | No |
| WebXR with WebGPU | Behind a flag | No | visionOS since 26.2 |

So subgroups can only be an optional speed-up, because iPhones lack them. Anything that needs ray tracing, bindless resources or 64-bit atomics stays off phones.

### Planned techniques

A phone cost is a published figure unless it says "estimate".

| Technique | Why | Phone cost | Where |
| --- | --- | --- | --- |
| Leak-free probe volume, after Unity 6's adaptive probe volumes: a validity mask, leak-reduced sampling, and a baked sky term times the live sky color | Fixes the main flaw of three.js's grid; time of day keeps working; Unity ships it to phones | 0.1 to 0.3 ms (estimate) | Core, on the probe grid: M3's global illumination (D-179 ruling 12) |
| A bake on WebGPU compute: a progressive path tracer | No complete version in the three.js world | Seconds to a minute; desktop first | Core, beside the ray-cast bake of [D-146](decisions/D-146-light-probe-grid.md), with the reflection probes' capture |
| Grass made on the GPU with wind | Not in three.js | 1 to 2 ms for 200,000 blades (estimate) | M3, inside the vegetation add-on ([D-241](decisions/D-241-vegetation-foundation.md)) |
| An ocean with real waves (FFT, 2 to 3 bands) | Not in three.js; its `webgpu_ocean` is a normal map | About 0.5 ms (estimate) | The water add-on, in M3 (D-179 ruling 19) |
| Smoke lit from six baked directions; ribbons | Cheap on phones | Very small (estimate) | The particles add-on, with no ruling yet. Collision with the depth buffer is out, because the add-on has no simulation pass ([D-131](decisions/D-131-particles.md)) |
| Moment transparency; per-pixel linked lists on desktops | Better order where layers overlap | About twice weighted blending's bandwidth (estimate) | An M3 core task, off by default (D-179 ruling 20) |
| Bounce light from the screen at half size | Matches three.js's `SSGINode` | 1.5 to 3 ms (estimate) | An M3 core task, on High and above (D-179 ruling 20) |

After 1.0 come OpenPBR, once glTF and MaterialX carry it, and distance-field shadows, behind a hook that lets an add-on own the shadow term. Hair comes as a content pack, and WebXR as its own milestone ([D-179](decisions/D-179-technique-rulings.md) rulings 20 and 28).

Not planned: many lights at a fixed cost, and a temporal upscaler that keeps MSAA. Both need a temporal resolve, which the engine does not ship ([D-206](decisions/D-206-temporal-resolve.md)). Volumetric clouds are left to add-on developers ([D-173](decisions/D-173-addon-hooks.md) ruling 2). Cached shadow pages are not a separate item, because shadow tiles redraw only what moved.

Watch list, with no work planned:

- 3D radiance cascades and surfel lighting: the papers give no phone figures.
- Stochastic light sampling per pixel (ReSTIR, Unreal's MegaLights) and Bevy's Solari: they need ray queries.
- Neural texture compression, neural materials and learned upscalers: they need subgroup matrices or WebNN.
- Lumen, Godot's distance-field lighting and voxel cone tracing: even native engines leave them off phones.

### Sources

- three.js: [releases](https://github.com/mrdoob/three.js/releases), [examples/files.json](https://github.com/mrdoob/three.js/blob/dev/examples/files.json), [display nodes](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/tsl/display), [TAAUNode.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/tsl/display/TAAUNode.js), [GaussianSplat.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/GaussianSplat.js), [LightProbeGrid.js](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/lighting/LightProbeGrid.js), [the L2 grid, PR #33125](https://github.com/mrdoob/three.js/pull/33125), [SSGINode](https://threejs.org/docs/pages/SSGINode.html), [SunLight](https://threejs.org/docs/pages/SunLight.html).
- Global illumination: [Unity 6's probe volumes](https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6), [their changing light at run time](https://docs.unity3d.com/Manual/urp/probevolumes-understand-changing-lighting-at-runtime.html), [visibility bitmasks](https://arxiv.org/abs/2301.11376), [EA's GIBS, Advances 2024](https://advances.realtimerendering.com/s2024/content/EA-GIBS2/Apers_Advances-s2024_Shipping-Dynamic-GI.pdf), [Split Radiance Cascades](https://arxiv.org/abs/2607.20384).
- Many lights: [HypeHype's stochastic tile lighting, Advances 2025](https://www.advances.realtimerendering.com/s2025/content/s2025_stb_lighting_v1.1_notes.pdf), [Arm on MegaLights](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/lighting-at-scale-bringing-hundreds-of-dynamic-lights-to-mobile-with-unreal-megalights).
- Upscaling: [Snapdragon GSR 2](https://www.qualcomm.com/developer/blog/2024/10/introducing-snapdragon-game-super-resolution-2), [@pmndrs/upscaler](https://github.com/pmndrs/upscaler).
- Splats: [Spark 2.0](https://www.worldlabs.ai/blog/spark-2.0), [PlayCanvas splat streaming](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/lod-streaming/), [Babylon.js 9 splats](https://radiancefields.com/babylon.js-v9.0-3dgs-gets-shadows-sogs-and-triangle-splatting-support-announced).
- Materials: [glints, Deliot and Belcour 2023](https://diglib.eg.org/items/d3e19c8a-e9e3-424b-be75-8b984153b39b/full), [OpenPBR](https://arxiv.org/abs/2512.23696).
- Effects: [takram's volumetric clouds](https://cdn.jsdelivr.net/npm/@takram/three-clouds@0.7.4/README.md), [frostbitten hair on WebGPU](https://github.com/Scthe/frostbitten-hair-webgpu), [six-way lit smoke](https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph), [Ghost of Tsushima's grass](https://gdcvault.com/play/1027214/Advanced-Graphics-Summit-Procedural-Grass), [Unity's FFT water](https://unity.com/blog/engine-platform/new-hdrp-water-system-in-2022-lts-and-2023-1).
- Browsers: [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [MDN GPUSupportedFeatures data](https://github.com/mdn/browser-compat-data/blob/main/api/GPUSupportedFeatures.json), [web3dsurvey](https://web3dsurvey.com/webgpu), [New in WebGPU 146](https://developer.chrome.com/blog/new-in-webgpu-146), [New in WebGPU 149 and 150](https://developer.chrome.com/blog/new-in-webgpu-149-150), [the bindless proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md), [the 64-bit atomics proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/atomic-64-min-max.md).
- Other engines: [Babylon.js 9.0](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/), [PlayCanvas releases](https://github.com/playcanvas/engine/releases), [Needle Engine features](https://engine.needle.tools/docs/explanation/core-concepts/features-overview).

## Web search results

Each item gives the finding and its main sources. Records cite the items by number.

### Shadows and ambient occlusion

- S-01, depth reads in compatibility mode. Compatibility mode refuses only the `texture_depth_*` shader types with `textureLoad`. A depth format bound as `unfilterable-float` and read as `texture_2d<f32>` is allowed, and a multisampled one as `texture_multisampled_2d<f32>` too. Dawn's OpenGL ES backend turns the read into `texelFetch` with compare mode off. Chrome's compatibility tests run the single-sample read on the Pixel 6 (Mali-G78). They skip every `textureLoad` test on the Pixel 10 for device crashes. They skip the multisampled read on the Pixel 6 for a driver crash (crbug.com/373670502). No Adreno device runs them. Firefox and Safari give core adapters only. Chrome ships compatibility mode from Chrome 146, starting with Android on OpenGL ES 3.1. Sources: [WebGPU specification, validating GPUProgrammableStage](https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpuprogrammablestage), [the compatibility mode proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md), [gpuweb issue 4970](https://github.com/gpuweb/gpuweb/issues/4970), [Dawn's Pipeline.cpp](https://dawn.googlesource.com/dawn/+/32f77c02294310054a660c393feded4bcb3f203c/src/dawn/native/Pipeline.cpp), [OpenGL ES 3.1 specification](https://registry.khronos.org/OpenGL/specs/es/3.1/es_spec_3.1.pdf), [New in WebGPU 146](https://developer.chrome.com/blog/new-in-webgpu-146), [Firefox bug 1905951](https://bugzilla.mozilla.org/show_bug.cgi?id=1905951).
- S-02, why three.js turns off shadow comparison on Android WebGPU. Adreno phones (Galaxy S23, S25, Fold7, Xiaomi 10T Pro) gave wrong shadow results with no error; WebGL2 was right. Nobody reported Mali, PowerVR or Xclipse. Chrome's bug names no root cause. Dawn commit 829f73d077 (first in Chrome 149) replaces 2D and 2D-array `textureSampleCompare` with `textureGatherCompare` and bilinear weights on every Qualcomm Vulkan driver. Cube depth textures get no workaround, and no driver fix is known. Sources: [three.js PR #32548](https://github.com/mrdoob/three.js/pull/32548), [three.js PR #33050](https://github.com/mrdoob/three.js/pull/33050), [Chromium issue 469328925](https://issues.chromium.org/issues/469328925), [Dawn change 300095](https://dawn-review.googlesource.com/c/dawn/+/300095).
- S-03, phone timings for AO and contact shadows. The only published phone timings are Filament's, on a Pixel 7 Pro (Mali-G710, OpenGL ES, Sponza, AO at half size). SAO Medium took 7.5 ms, SAO High 9.5 ms and GTAO 14.4 ms, blur included. Filament's depth-aware upsample took about 2.0 ms on a Pixel 4 at 250 MHz. No phone timing exists for bitmask AO or contact shadows. Unity HDRP gives contact shadows 0.5 to 1.3 ms on a base PS4 at 1080p. Sources: [Filament PR #8688](https://github.com/google/filament/pull/8688), [Filament commit 62ff7b7](https://github.com/google/filament/commit/62ff7b7d0a23788757ff8816894090abf4ce124a), [Filament PR #9101](https://github.com/google/filament/pull/9101), [HDRP contact shadows](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Override-Contact-Shadows.html).

### Lighting, materials and color

- S-04, three.js r187. Its `dev` branch holds four changes. They are cube targets with `roughnessToMip`, the 0.045 floor, diffuse light from the roughest level, and the EON rough diffuse. The base-level blur offset is removed, and the layout is unchanged (256 cube, levels down to 8 x 8). r186 is on npm as 0.186.1. Sources: [r186 release](https://github.com/mrdoob/three.js/releases/tag/r186), [PR #34585](https://github.com/mrdoob/three.js/pull/34585), [PR #34645](https://github.com/mrdoob/three.js/pull/34645), [PR #34379](https://github.com/mrdoob/three.js/pull/34379).
- S-05, half precision rates. The Mali-G715 runs 256 FP16 FMAs per clock against 128 FP32, but explicit FP16 gains only as vectors. Adreno's double rate is a family claim, measured on the Adreno 730, not the 830. The Xclipse 940 (RDNA 3) gains only through packed math. The Pixel 10's DXT-48-1536 gives 3,072 FP16 against 1,536 FP32 FLOPs per clock. Apple GPUs run FP16 at twice the FP32 rate up to the A14, and at the same rate from the A15 and M1. So D-09 measured a double-rate GPU, the iPad's A12X. Sources: [Arm Immortalis-G715 overview](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/arm-immortalis-g715-developer-overview), [Arm GPU Best Practices 3.4](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695), [Qualcomm mobile best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html), [Chips and Cheese on RDNA 3](https://chipsandcheese.com/p/microbenchmarking-amds-rdna-3-graphics-architecture), [Metal benchmarks](https://github.com/philipturner/metal-benchmarks/blob/main/README.md).
- S-06, transmission sources. Filament copies the opaque color and builds a Gaussian mip chain. Babylon.js draws the opaque meshes again into a 1,024 x 1,024 half-float target with mips, as three.js's `WebGLRenderer` does. `WebGPURenderer` copies with mips. Sources: [Filament RendererUtils.cpp](https://github.com/google/filament/blob/70d2da5e9b7014e1a4207d737aa8dc41b59880a2/filament/src/RendererUtils.cpp), [Babylon.js transmissionHelper.ts](https://github.com/BabylonJS/Babylon.js/blob/4236dc62d9fe4baa3d35336704e8248f707f3cc4/packages/dev/loaders/src/glTF/2.0/Extensions/transmissionHelper.ts), [three.js WebGLRenderer.js](https://github.com/mrdoob/three.js/blob/1dd13e0419ae3c5d3af1c6bca1b1639e60c29e81/src/renderers/WebGLRenderer.js).
- S-07, the cost of ACES 2.0. OCIO's "3 to 8 times slower than ACES 1" is CPU time. For the GPU, OCIO 2.4.2 says only "somewhat slower". No engine read has ACES 2.0. The one real-time port found bakes it into a 3D table. Sources: [OCIO ACES 2.0 optimization](https://github.com/AcademySoftwareFoundation/OpenColorIO/wiki/ACES-2.0-optimization), [OCIO v2.4.2](https://github.com/AcademySoftwareFoundation/OpenColorIO/releases/tag/v2.4.2), [a URP ACES 2 tonemapper](https://github.com/SNIELSEL/UnityURP-ACES2-Tonemapper).
- S-08, HDR canvases. WebGPU's `rgba16float` canvas with `toneMapping: { mode: 'extended' }` ships in Chrome 129 on desktop, Android and WebView, and in Safari 26 on every Apple platform with an HDR display. Firefox lacks it. No browser ships an HDR WebGL2 canvas. Sources: [Chrome Platform Status](https://chromestatus.com/feature/6196313866895360), [New in WebGPU 129](https://developer.chrome.com/blog/new-in-webgpu-129), [WebKit features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
- S-09, Khronos PBR Neutral. model-viewer's default since v4.0.0. three.js, Filament, Babylon.js and Blender 4.2 ship it. Sources: [model-viewer v4.0.0](https://github.com/google/model-viewer/releases/tag/v4.0.0), [three.js PR #27668](https://github.com/mrdoob/three.js/pull/27668), [Filament PR #7597](https://github.com/google/filament/pull/7597), [Babylon.js PR #15054](https://github.com/BabylonJS/Babylon.js/pull/15054).
- S-10, the device behind Filament's prefilter figure. Filament's "100 to 300 ms for a 5-level 256 cube with 1,024 samples" names no device. The only measured figures are three.js r187's: 10.4 ms with WebGL and 13.0 ms with WebGPU for a 1K HDRI on an Apple M1. No phone timing is published. Sources: [Filament iblprefilter README](https://github.com/google/filament/blob/main/libs/iblprefilter/README.md), [three.js PR #34585](https://github.com/mrdoob/three.js/pull/34585).
- S-11, PlayCanvas's Smith term. The isotropic GGX chunk squares alpha twice. Issue #9510 reports it, and PR #9513 holds the fix. Sources: [PlayCanvas issue #9510](https://github.com/playcanvas/engine/issues/9510), [PlayCanvas PR #9513](https://github.com/playcanvas/engine/pull/9513).
- S-12, two Godot oddities. GLES3 filters 7 radiance levels but reads only 6 (`RADIANCE_MAX_LOD 5.0`). Forward+'s DFG table has a +1/128 roughness offset. Neither is reported. Source: [Godot scene.glsl at e7cfa29](https://github.com/godotengine/godot/blob/e7cfa294a0b81bed7986be04a848cc1832a3f083/drivers/gles3/shaders/scene.glsl).

### Post-processing

- S-13, MSAA resolves on Android. ANGLE adds a resolve attachment when a color resolve blit follows the draws in the open render pass. An `invalidateFramebuffer` right after makes the samples never reach memory. Conditions: no draw between, no flip, the same formats, one draw buffer and one layer, and a blit area equal to the render area. Chrome uses ANGLE on Vulkan for WebGL only where its field trial turns it on. Sources: [ANGLE commit dff47d5](https://chromium.googlesource.com/angle/angle/+/dff47d5fdaac04d1eb9343308c903157203467ce), [ANGLE commit 9475ac4](https://chromium.googlesource.com/angle/angle/+/9475ac4094664b3fef2d709911553abde7c1e305).
- S-14, Mali frame buffer compression. From Valhall (Mali-G57, G68, G77, G78 and later), any format of 32 bits or less; `RGBA16F` only from the Mali-G710. Bifrost has no float formats. Only single-sample images, and Arm states these rules for Vulkan only. Sources: [Arm, AFBC textures for Vulkan](https://developer.arm.com/documentation/101897/latest/Buffers-and-textures/AFBC-textures-for-Vulkan), [Vulkan Samples AFBC](https://github.com/KhronosGroup/Vulkan-Samples/blob/main/samples/performance/afbc/README.adoc).
- S-15, GSR 1 and FSR 1 on phones. From a 1240 x 576 input, GSR 1 takes 0.48, 0.36 and 0.30 ms on the Snapdragon 888, 8 Gen 1 and 8 Gen 2. A bilinear upscale takes 0.25, 0.20 and 0.16 ms. FSR 1 has one phone figure, on an iPhone 12: optimized EASU 1.8 ms and RCAS 0.9 ms. Sources: [Snapdragon GSR 1 README](https://github.com/SnapdragonGameStudios/snapdragon-gsr/blob/main/sgsr/v1/README.md), [Optimizing FSR](https://atyuwen.github.io/posts/optimizing-fsr/).

### Animation and assets

- S-16, repeated vertex work on Mali and Adreno. Mali compiles a position shader and a varying shader, and duplicate position work may repeat. Adreno's binning pass runs a position-only vertex shader. No vendor advises compute or vertex skinning. Qualcomm advises keeping graphics submits apart from compute dispatches. Sources: [Mali Offline Compiler guide](https://documentation-service.arm.com/static/648aeb7f153eb247a5450a90), [Qualcomm mobile best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html).
- S-17, AVIF and WebP in a worker. A dedicated worker decoded both with `createImageBitmap` in Safari 26.6.2, Chrome 154 and Firefox 157 on the Mac. AVIF floors: Chrome 85, Firefox 93, iOS Safari 16.1, macOS Safari 16.4. Source: [MDN browser compatibility data](https://github.com/mdn/browser-compat-data).
- S-18, UASTC HDR in Basis 2.50. The shipped transcoder is the prebuilt v2.50 build with HDR on. It transcoded UASTC HDR 4 x 4 and 6 x 6 and ASTC HDR 6 x 6 to BC6H, half floats, RGB9E5 and ASTC HDR. HDR cannot be compiled out of v2.50. The file is 1,060,846 bytes (361 KB after Brotli). Source: [Basis transcoder CMakeLists.txt](https://github.com/BinomialLLC/basis_universal/blob/v2_50/webgl/transcoder/CMakeLists.txt).
- S-19, UASTC RDO on normal maps. A test of basisu 2.50 on four 2,048² normal maps saved 0.6 to 21.8% at λ 0.5, and 2.9 to 26.1% at λ 1.0. Sources: [basis_universal commit 5b6eb56](https://github.com/BinomialLLC/basis_universal/commit/5b6eb56), [KTX artist guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/subpages/KTXArtistGuide_toktx.md).
- S-20, Blender and meshopt. Blender 5.2 LTS imports and exports meshopt. Blender 5.1 and older refuse files that require it. Draco imports since Blender 2.92. Sources: [glTF-Blender-IO PR #2701](https://github.com/KhronosGroup/glTF-Blender-IO/pull/2701), [Blender 5.2 release notes](https://developer.blender.org/docs/release_notes/5.2/pipeline_io/).
- S-21, dead blending. Holden's article and code are public under MIT. Per joint: position, velocity, rotation, angular velocity and a slerp direction, 13 to 17 floats. Sources: [Dead Blending](https://theorangeduck.com/page/dead-blending), [deadblending.c](https://github.com/orangeduck/Spring-It-On/blob/main/deadblending.c).
- S-22, XUASTC in KTX2. A draft: KTX-Specification PR #216 adds supercompression scheme 5 and color model 169. Neither glTF nor three.js reads it. Source: [KTX-Specification PR #216](https://github.com/KhronosGroup/KTX-Specification/pull/216).
- S-23, KTX2 level order and range requests. Levels run from the smallest to the largest. Browsers send `Accept-Encoding: identity` with any `Range` request, and servers that compress on the fly drop ranges. So ranged KTX2 fetches get uncompressed bytes, and the file's own Zstandard is the only compression. Sources: [KTX 2.0 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html), [RFC 9110 section 14.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2), [Fetch standard](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch).
- S-24, Unreal and Unity references. Unity's manual does not say that its texture streamer drops the least needed levels first. It gives the smallest level that fits and a per-texture priority. ACL is Unreal 5.3's default animation codec. Sources: [Unreal texture streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/texture-streaming-overview-for-unreal-engine), [Unity streamingMipmapsPriority](https://docs.unity3d.com/ScriptReference/Texture2D-streamingMipmapsPriority.html), [ACL in UE 5.3](https://nfrechette.github.io/2023/09/17/acl_in_ue/).
- S-25, Bevy's environment maps. `rgb9e5` KTX2 with Zstandard. Source: [Bevy's environment_maps folder](https://github.com/bevyengine/bevy/tree/844390b279c6ef252d10df2a17912761325db7f2/assets/environment_maps).

### Geometry, culling and architecture

- S-26, why Bevy and Unity turn off GPU culling on some phones. Bevy's blocks are driver crashes. Adreno 730 and older crash at shader compile. Mali drivers before r48 report "Parent device is lost". The Pixel 10's PowerVR driver aborts, and the Pixel 11 Pro crashes too. Unity: missing objects on Adreno with Vulkan (UUM-82677). Dawn has related workarounds. On Qualcomm it splits a command buffer where a compute pass follows a render pass. On Imagination GPUs, zeroed workgroup memory is unreliable, and mip sizes of depth textures whose size is not a power of two come out wrong. Sources: [Bevy issue 14146](https://github.com/bevyengine/bevy/issues/14146), [Bevy issue 17591](https://github.com/bevyengine/bevy/issues/17591), [Bevy issue 23754](https://github.com/bevyengine/bevy/issues/23754), [Unity 6000.0.23f1 notes](https://unity.com/releases/editor/whats-new/6000.0.23f1).
- S-27, same-address atomics on phones. No phone measurement is published. Qualcomm says atomics on one address are serialized and advises a local atomic first, then one global update. Arm and Apple give the same advice. Sources: [Qualcomm OpenCL guide](https://docs.qualcomm.com/bundle/publicresource/80-NB295-11_REV_C_Qualcomm_Snapdragon_Mobile_Platform_Opencl_General_Programming_and_Optimization.pdf), [Arm GPU Best Practices 3.4](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695).
- S-28, 64-bit atomic min and max. Chrome 156 ships it where hardware allows. Safari and Firefox do not. Apple GPUs need the Apple9 family, so the iPad's A12X and every M1 or M2 iPad can never have it. Sources: [gpuweb PR 5610](https://github.com/gpuweb/gpuweb/pull/5610), [Metal feature set tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf).
- S-29, multi-draw indirect. Flag-only in Chrome, off on Metal, absent from the specification, Safari and Firefox. Sources: [gpuweb issue 1354](https://github.com/gpuweb/gpuweb/issues/1354), [gpuweb PR 2315](https://github.com/gpuweb/gpuweb/pull/2315).
- S-30, Bevy in browsers and WebGPU's limits. WebGPU has immediates, and Chrome ships them in 149 and 150. The browser backend of wgpu does not use them, so Bevy runs no GPU culling in a browser. Both levels allow 8 storage buffers and 4 storage textures per stage, and 32 bytes per sample. Core allows 8 color attachments, compatibility mode 4. Compatibility mode allows no storage buffers or textures in the vertex stage. Sources: [WebGPU limits](https://gpuweb.github.io/gpuweb/#limits), [New in WebGPU 149 and 150](https://developer.chrome.com/blog/new-in-webgpu-149-150).
- S-31, Safari's render bundle fix. Safari 27.2 fixes WebKit bug 320490. Bug 325413 (a reused bundle loses dynamic offsets) has no fix in a release. Sources: [WebKit bug 320490](https://bugs.webkit.org/show_bug.cgi?id=320490), [Safari 27.2 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-27_2-release-notes), [WebKit bug 325413](https://bugs.webkit.org/show_bug.cgi?id=325413).

### Gaps

- S-32, `KHR_gaussian_splatting`. The extension is ratified. Its compression extensions (SPZ and others) are drafts. three.js, Babylon.js and PlayCanvas read the base extension. Sources: [the extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting), [glTF PR #2642](https://github.com/KhronosGroup/glTF/pull/2642).
- S-33, naga's GLSL reader. It accepts only `#version 440` (partial), 450 and 460 core, and rejects `#version 300 es`. Source: [naga's GLSL front end](https://github.com/gfx-rs/wgpu/blob/14685942a11755e4581c40729dd44591d1d73680/naga/src/front/glsl/mod.rs).
- S-34, light-map extensions. Only the Hubs Blender add-on writes `MOZ_lightmap`, and no major engine reads it. Khronos has no light-map extension. Needle's `NEEDLE_lightmaps` is the one in real use. Sources: [Hubs Blender exporter 1.8.0](https://github.com/Hubs-Foundation/hubs-blender-exporter/releases/tag/1.8.0), [glTF issue 1017](https://github.com/KhronosGroup/glTF/issues/1017).
- S-35, WebXR with WebGPU. Safari on visionOS ships it by default from Safari 26.2. Chrome has it behind a flag, and the specification is an Editor's Draft. Sources: [WebKit features in Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [WebXR/WebGPU binding](https://immersive-web.github.io/webxr-webgpu-binding/).
