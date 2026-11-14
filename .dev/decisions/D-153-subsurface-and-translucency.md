# D-153: Light through thin surfaces, and subsurface light for skin

Status: decided by the helper of M2-EX36, for the owner's review of the look. Built: both parts are on main (PR #548). Not measured yet: a judged timing of both parts. Task: M2-EX36.

Summary: Light from behind a thin surface, such as a leaf or an ear, shows on its front through glTF's diffuse transmission and its color. One permutation bit, `TRANSLUCENCY`, gives it first-use shader builds, and its two maps take the specular maps' slots, so no GPU path binds a texture more. For skin, wax and marble, a skin pass and two separable steps blur a material's diffuse light with Burley's profile, on High and Ultra.

## Question

The showcase scenes need sunlit leaves, grass and flowers in Creek, and soldiers whose ears and hands glow red against the light in Battle ([D-132](D-132-showcase-look-and-features.md), [D-142](D-142-more-techniques-before-1-0.md)). Without it, a leaf lit from behind shows only its ambient light, so a forest against the low sun looks dark and flat. How does a material let light through a thin surface? How do files and sketches ask for it, and what does a material without it pay? Does skin need more than that?

## Rule

- The intent of glTF's `KHR_materials_diffuse_transmission` ([D-52](D-52-intent-parity.md)). Files that use it look as the Khronos sample renderer draws them.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Zero cost while no material uses it: no shader download, no row read and no binding.
- No new texture binding in the main pass. WebGPU's maps build reads 15 of its 16 textures already, and WebGL2's 13 of 16.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).

## Options

### The light law

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: glTF's diffuse transmission: a Lambert lobe on the back side, through the transmission color, with the diffuse reflection less by the same share | glTF, the Khronos sample renderer, Babylon.js's translucency, Blender's translucent BSDF | Chosen |
| B: a view-dependent glow toward the light, after Barré-Brisebois and Bouchard (GDC 2011) | three.js's `MeshSSSNodeMaterial` and `SubsurfaceScatteringShader`, many games | Rejected as the default. It adds light that no file describes, with five tuning values. Its ports map onto option A, and the mapping lists the difference |
| C: wrapped diffuse light only | Older games | Rejected. A leaf lit from behind still shows nothing |

Option A per light: the surface's front gets `(1 - t)` of its diffuse light. Where the light comes from behind, the surface adds `t × color / π × dot(-n, l) × light × (1 - F)`. Here `t` is the diffuse transmission, `color` its color, and `F` the specular layer's Fresnel share at the view angle. The ambient, hemisphere and environment light from behind come in the same way, at the normal `-n`. The base color does not tint the light from behind, as glTF says. A sketch gives the color to tint it.

Shadows fall on the light from behind too. The lookup moves the point off the surface along `-n`, toward the light, as it moves a lit face's point along `n`. Other surfaces that face away from the sun skip their shadow lookup, but surfaces that let light through do it.

With `KHR_materials_volume`, the light from behind takes the volume's color by Beer's law over the thickness. The thickness is in the mesh's units, times the object's scale, as transmission measures it ([D-122](D-122-transmission.md)). Where a material has transmission too, transmission wins, as glTF orders them.

### The material API

| Option | Verdict |
| --- | --- |
| A: options of `materials.standard` with glTF's names: `diffuseTransmission`, `diffuseTransmissionColor`, `diffuseTransmissionMap`, `diffuseTransmissionColorMap` | Chosen. three.js has no such option, so glTF's names are the only standard ones |
| B: three.js's `thicknessColor`, `thicknessPower` and so on | Rejected. They name option B's law, which the engine does not draw |
| C: a factory of its own, such as `materials.foliage` | Rejected. It splits one material model, and glTF files need the standard material to take the values |

`diffuseTransmission` picks a shader variant, so the option is fixed at creation, as `transmission` is. Given at all, even as 0, it gives the material the feature, and `set` changes its value. `thickness`, `attenuationColor` and `attenuationDistance` work for it too. A custom material's surface has `diffuseTransmission` and `diffuseTransmissionColor`. Only WGSL that names one of them builds the variants, as for transmission.

### Maps

The diffuse transmission map's alpha scales the transmission, in linear color. The color map's RGB scales the color, in sRGB. The specular intensity map and the specular color map read exactly those channels in those color spaces. So in a material that lets light through, slot 6 holds the transmission map and slot 7 the color map, and the shader reads them in its existing code. Such a material takes no specular maps. Its specular values still work. Rejected: a binding for each map (17 of 16 on WebGPU's maps build), and a switch over shared units on WebGPU, which [D-89](D-89-webgl2-texture-units.md) found many times slower on Apple GPUs.

### Shader variants

One permutation bit, `TRANSLUCENCY`, in the standard material's two templates. Its builds load on first use, in the shader set `translucency`. Its builds with skinning, morph targets, alpha to coverage or the alpha hash go into files of their own, such as `coverage+translucency`, as the first-use rule puts every build that needs several features. It is kept apart from transmission, from casters and from the test switch that reads instances by index. It goes with masks, alpha to coverage, the alpha hash, skinning, morph targets and row values: leaf cards, grass batches and soldiers need them.

A leaf card with alpha to coverage has two bits of first-use features: coverage and `TRANSLUCENCY`. A build that needs several features goes into a file of its own for that set, which a page loads only when it draws with all of them ([implementation notes](../implementation-notes.md)). So those builds do not grow the coverage file, which every page with a masked material downloads, and the coverage and hash files keep their sizes. Rejected: a build that goes to the feature of its lowest bit, which grows the coverage file, and a priority for each claiming feature, which the file per set makes needless.

Clear coat and sheen (`COAT_SHEEN`) and weighted blending (`WEIGHTED`) sit in the same templates. `TRANSLUCENCY` is kept apart from both, which gives the WebGPU `lit` template 2,208 builds, against 1,632 without the bit (+35%). Free beside them, the bit would give 2,976 builds, and the shader build output would grow from 467 MB to 901 MB, nearly doubling the shader build's time. A layered material's maps take the slots of the diffuse transmission maps anyway, and a weighted surface lets no light through, as for transmission. The layers win: such a material draws without diffuse transmission. Development builds throw E1217 for `diffuseTransmission` beside a clear coat, a sheen or the `weighted` blending, and the glTF loader drops a file's diffuse transmission beside its layers, with a note.

The material row grows by one `vec4f`: the color and the transmission. Only the `TRANSLUCENCY` builds read it, with the transmission's row for the volume.

### Skin: the screen-space blur

Diffuse transmission gives ears and fingers their glow against the light. It does not soften the light across a face: a shadow's edge, the light at the side of a nose and the pores of a skin map stay as sharp as on plaster. Light that enters skin leaves it a few millimeters away, redder the further it went. A screen-space blur of the skin's diffuse light draws that. The owner asked for it together with the light through thin surfaces.

What the design starts from:

- The blur must know which pixels are skin, with what reach. The scene color has no spare channel. Many WebGPU devices draw it as `rg11b10ufloat`, which has no alpha, and elsewhere its alpha is the canvas's alpha. No GPU path has a stencil buffer.
- A blur of the finished color smears the highlights, which must stay sharp. So the blur reads the skin's diffuse light alone.
- The scene's render pass cannot write a second color target for the skin builds alone: every pipeline of a render pass declares the same targets, so every pipeline of the camera's opaque pass would change.

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: a skin pass draws the skin objects again, their scattered diffuse light alone, into a target of their own; a two-step separable blur then adds the blurred light less the sharp light to a copy of the scene color | Jimenez et al. 2015 (separable subsurface scattering), Unity HDRP and Unreal Engine (diffuse light apart, then a screen-space blur) | Chosen |
| B: the skin pass first, then each skin pixel of the camera's opaque pass blurs that target over a disk of taps around itself | The Khronos sample renderer for the draft `KHR_materials_volume_scatter`: 55 taps | Rejected. The skin builds of the opaque pass need one more texture binding, and WebGPU's maps build reads 15 of its 16 already. The skin pass needs a depth target of its own anyway |
| C: a mask pass of the skin objects, then a blur of the finished image within the mask | Older games | Rejected. It smears the highlights and the specular light of the eyes and lips |
| D: a blur of the skin's lighting in texture space | Offline renderers, early real-time faces | Rejected. A pass per skinned object and its unwrapped texture, at a cost that grows with the objects, not the pixels |

How option A runs:

1. **The skin view.** The objects whose material has a subsurface radius form a layout of their own, as outlined objects do ([D-36](D-36-outlines.md)). A view of its own, the subsurface view, culls it with the camera's frustum and layers: on WebGPU in a culling pass of its own, on WebGL2 on the job workers. Instance batches take no blur, as they take no outline.
2. **The skin pass.** It draws that layout with the standard material's skin builds (templates `SUBSURFACE` and `SUBSURFACE_MAPS`, from `lit.wgsl` with the `SUBSURFACE` def), with the camera's frame bindings: its lights, shadows, ambient occlusion and environment. It writes into a target of the render size with one sample, `rgba32float`, with a depth target of its own. Red, green and blue hold the diffuse light that scatters, after the fog, as the opaque pass added it to the scene color. Alpha holds the view depth. The low 8 bits of each color channel's float hold the material's scatter distance of that channel, on a log scale from 0.06 mm to 64 m, so the steps need no material table. The skin pass runs after the transparent passes, beside the outline's mask.
3. **The steps.** Two full-screen passes at the render size. The first blurs the skin target across, into an `rgba16float` target. The second blurs that down, and writes the scene color plus the blurred light less the sharp light, into a copy that the custom effects, depth of field, bloom and the final pass then read, as they read an effect's target. Each tap's weight is Burley's diffusion profile of each channel's distance, at the distance in the world between the tap's surface and the pixel's, from the view depths. So light never crosses from a nose to the cheek behind it. Taps without skin take no weight. The taps reach the largest channel's distance, spread more densely near the pixel. Where that distance covers less than a pixel, the pixel keeps its color at once. The second step changes only pixels whose skin is in front: it compares the skin's depth with the scene's.
4. **The quality setting.** `subsurfaceSamples` gives each step 0, 11, 17 or 25 taps: 0 on Low and Medium, 17 on High and 25 on Ultra. WebGL2 and compatibility mode run Medium at most, so they draw no blur unless the page sets the setting. 0 draws no skin pass or steps even where materials ask for the blur. The blur needs HDR color. Compatibility mode with MSAA starts on the 8-bit path. A setting above 0 that the page's options or `quality.set` give moves it to HDR color with FXAA for the engine's life, as bloom does. A preset's taps alone never move it: High and Ultra pages with skin keep their path. A unit test of the sketch runner guards this.

The material API: `subsurfaceRadius`, how far light spreads under the surface in world units (meters), and `subsurfaceColor`, each channel's share of that radius, white by default; skin takes about `[1, 0.4, 0.25]`. Giving `subsurfaceRadius` at creation, even as 0, gives the material the feature, as `diffuseTransmission` does, and `set` changes both values. The glTF loader reads the draft `KHR_materials_volume_scatter`: each channel's distance is `attenuationDistance × multiscatterColor`, as the Khronos sample renderer finds it. Where the sample renderer scatters only the diffuse transmission's share, null3D blurs all of the diffuse light: the record lists the difference in the mapping. Blended materials and custom materials take no blur.

Cost: nothing while no material has a radius or the setting is 0: no pass, target, binding or shader download. While it draws: the skin objects draw once more, and their pixels are shaded once more; the two steps read their taps only at skin pixels whose blur covers a pixel or more, and every other pixel reads one texel and copies the scene color. Targets per pixel of the render size: 16 bytes of skin light, 4 of its depth, 8 of the blurred light and 8 of the copy.

### The candlelight demo's lighting

The `subsurface` demo shows wax, jade and soap by candlelight. These choices keep the blur in view:

- **The flames cast no shadows.** With shadows, each flame's point light throws hard diagonal bands across the other candles, and only flames without shadows remove them. A point light's shadow edge is sharp. A real flame is a wide light a few centimeters from the wax, so its shadows are soft. Hard bands read as the opposite of what the blur shows. So only the tea light that the pointer moves casts shadows, and the blur softens their edges on the wax.
- **A light inside each lit candle.** A flame's light enters the pool of melted wax and leaves through the wall, brightest just under the flame. A small shadowless point light inside the candle, at a fifth of the flame's intensity and with a range of 12 cm, stands for it. The wax's diffuse transmission lets it through the wall, and the blur reddens it with depth. The unlit candle glows only from the others' light.
- **Exposure 0.25.** The flames' lights sit 4 cm above the wax, so the wax under them takes far more light than the rest. At an exposure of 2.2, the tone curve turns the upper half of each candle white. At 0.25, the wax keeps its amber color, and the falloff down each candle shows.
- **The soap egg lets 35% of its light through**, so its dark side glows a little. The room has a plaster wall close behind the candles, so their light fades across it.
- **The wall's grain comes from an integer hash** of each pixel's place. A hash from the fraction of a large sine differs from machine to machine, and the repository's rule against sine hashes forbids it in code that ships.

## Data

**Checks of the look.** `tests/image/translucency.spec.ts` measures the `translucency` test's image on all three tiers, on the Mac's GPU and on SwiftShader. Four panels with the low sun behind them let 0, 1/3, 2/3 and all of their diffuse light through. Each panel must show more light than the one before, by 0.03 of full brightness, and the last 0.2 more than the first. The box's shadow on the last panel's back must show through at most 0.6 of the lit part's brightness. The lamp behind the second panel must make its lower half redder by 0.1. The thick red volume and the striped maps change the last panel as they should. Both runs pass on every tier.

The checks pass with the current shading: the `translucency`, `translucency-volume` and `translucency-maps` checks of part A, and the two part B checks. The part B checks measure the blur: skin light spreads into the box's shadow and turns redder there, the lit skin keeps its level, a box in front takes no blur, and a base color map's stripes soften.

**References.** The ten part A and part B tests hold references in both sets, drawn with the current lit shading after the look checks passed.

**Image tests.** Five tests have references in both sets: `translucency`, `translucency-maps`, `translucency-volume`, `translucency-leaves` and the demo's. `translucency-custom` draws the panels with a custom material and matches the first test's references. With the feature, the whole manifest of 961 tests passes on the Mac's GPU and on SwiftShader, so no other image changes. On SwiftShader, with six tests at once, the first use of the new shaders can take more than 30 s (four of eighteen runs), so the tests have 60 s.

**First use.** The page of the `translucency` test downloads one shader file that loads on first use, the `translucency` file, on WebGPU and on WebGL2. A leaf card with alpha to coverage builds with the bits of two first-use features. Those builds go into the file of both, so the coverage and hash files keep their sizes.

**Allocation.** `bun run bench:allocation --translucency` on the Mac's GPU: S1's 100,000 boxes let half their diffuse light through. Both paths pass. On WebGPU the sketch worker allocated 219.1 bytes per frame and the render worker 556.4. On WebGL2 they allocated 212.3 and 165.6.

**Size.** `bun run build:check-size` against main at `ec8f5cca7`, after Brotli. The feature takes the pipelined start from 133.0 to 133.4 KB on WebGPU, and from 130.2 to 130.5 KB on WebGL2, of 140 KB. The material options and their checks make most of it. The glTF worker grows by 1.7%, since it reads one more extension. The WebAssembly files keep their sizes. The twelve new shader files of the `translucency` feature take 24,530 to 29,589 bytes, under their 32 KB limit, and 1,428 KB at most before compression, under 1,536 KB. They load only with the first material that lets light through to its other side. The other shader files grow by at most 0.4%: the material row's field shows in every build's declaration of the row.

### Part B, the skin blur

**The blur's own checks.** `tests/image/subsurface.spec.ts` measures the blur against the plain panel beside it, on every tier of both sets. Both of its checks pass on the Mac's GPU and on SwiftShader. The box's shadow on the skin lifts by more than 0.01 of full brightness and turns redder by more than 0.02, while the lit skin away from the shadow stays within 0.03 of the plain panel. With no taps the two panels draw alike within 0.01. A box in front of the skin takes no blur. A base color map's stripes soften to less than 0.8 of their sharp edge energy, and half the render scale blurs the same way.

**Image tests.** Five tests cover the blur: `subsurface`, `subsurface-off`, `subsurface-maps`, `subsurface-scale-50` and `demo-subsurface`. Their references, in both sets, were drawn after the checks above passed.

**The skin view's frame group on WebGL2.** The reflection probes' lists hold one slot for each camera view. The skin view has no slot of its own, so its frame group reads the camera's list, as it reads the camera's light textures. A group that used the skin view's own index would bind a range past the end of the list buffer, and the driver would refuse every draw of the skin pass. `tests/subsurface.rs` of the render crate checks that every buffer range that a WebGL2 frame's bind groups make lies inside its buffer.

**First use.** The builds of the blur are the `subsurface` set of the shader manifest: the skin pass's standard material with and without maps, and the blur's two steps. A page downloads them with its first material that gives `subsurfaceRadius`. Their files take 14,075 to 33,549 bytes after Brotli, under the 49 KB limit for a first-use shader file.

**Allocation.** `bun run bench:allocation --subsurface` and `--translucency` on the Mac's GPU, both paths: every run passes. With the blur on S1's 64 scattered spheres, the sketch worker allocated 215.4 bytes per frame on WebGPU and the render worker 564.4; on WebGL2 they allocated 208.6 and 176.2. With S1's boxes letting half their light through, they allocated 224.7 and 487.7 on WebGPU, and 220.4 and 166.1 on WebGL2. The figures for the blur differ from part A's because the two switches add different objects.

**The builds.** With the translucency bit and the blur's templates, the shader manifest has 21,907 GLSL and 8,668 WGSL builds, against 14,994 and 6,170 without them.

**GPU check.** `bun run bench:gpu-check --measure` on the Mac's GPU, over `a616befb6..2e93cbf5b`. The tool did not judge the run, because the benchmark pages changed between the two commits: the feature adds the `--subsurface` and `--translucency` switches to them. Its line reads: `GPU-Checked: a616befb6..2e93cbf5b not judged: s4 medium 4.08 to 4.09 ms (-0.0%); s6 medium 5.25 to 4.93 ms (-5.6%); s4 high 4.84 to 3.74 ms (-14.3%); s6 high 7.17 to 10.30 ms (+43.7%); the benchmark pages changed between the commits`. Both builds drew the same quality steps in every run.

**What the blur costs.** With the blur off, a page draws exactly as without the feature and holds no blur layout. With it on, High draws 17 taps in each step and Ultra 25, over 11 for the lightest setting. The skin pass and its culling pass are one extra draw per scattering object per frame, and the two full-screen steps cost the render size. The render scale bounds all of it.

## Decision

Options A throughout, for light through thin surfaces: glTF's diffuse transmission as the Khronos sample renderer draws it, with glTF's names, its maps in the specular maps' slots, and one permutation bit whose builds load on first use. For skin, option A of "Skin: the screen-space blur": a skin pass of the subsurface view, two separable steps with Burley's profile, and the quality setting `subsurfaceSamples`, on High and Ultra.

## Consequences

- Code: `materials.rs` (the features, the row and the slots), `frame.rs` (the variant and the blur's settings), the shaders `lib/translucency.wgsl`, `lit.wgsl` and `lib/lights.wgsl`, the shader manifest's `translucency` and `subsurface` sets, the shader compiler's custom material check, `resources.ts` and the glTF reader.
- The skin blur's code: `subsurface.rs` (the skin pass's keys and the steps), the subsurface view (`ViewId::SUBSURFACE`), the subsurface layouts of both frame builders, the frame graph's skin pass and steps, whose copy the custom effects, depth of field, bloom and the final pass read, `subsurface.wgsl`, `lib/subsurface.wgsl` and the `SUBSURFACE` builds of `lit.wgsl`, the core call `setSubsurfaceTaps` and the quality setting `subsurfaceSamples`.
- Docs: `api/materials`, `api/quality`, `shaders/surface-functions`, `concepts/materials`, `api/assets` and `concepts/assets`, and a mapping entry for three.js's subsurface material.
- Skills: the develop skill's task table, quick reference, shaders reference and performance notes, and the port skill's materials notes.
- Tests: Rust and unit tests, the image tests `translucency`, `translucency-custom` and the four `subsurface` tests with their spec, the first-use download tests, and `--translucency` and `--subsurface` in `bench:allocation`.
- Demos: `examples/translucency` (light through leaves) and `examples/subsurface` (wax, jade and soap by candlelight).

The check for an explicit setting accepts the settings that a sketch can choose. It excludes the memory maximum, which is fixed when the engine starts. This keeps the check within the keys of the sketch's options.

The benchmark page forwards `subsurface` to its sketch, and the switch guard checks that it does. Without it, the sketch runs without the requested effect.
