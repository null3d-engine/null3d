# D-153: Light through thin surfaces, and subsurface light for skin

Status: decided by the helper of M2-EX36 on 12 October 2026, for the owner's review of the look. The timings follow. The screen-space blur of skin is not built, and waits for the coordinator's decision. Date: 2026-10-12. Task: M2-EX36.

Summary: The standard material takes glTF's diffuse transmission: light that reaches a thin surface from behind, such as the sun through a leaf, a petal or an ear, shows on its front through a color of its own. The glTF loader reads `KHR_materials_diffuse_transmission` into it, and `KHR_materials_volume` dims it over the surface's thickness. One permutation bit, `TRANSLUCENCY`, gives it shader builds that load on first use. Its two maps take the slots of the specular maps, which read the same channels, so no GPU path binds a texture more.

## Question

The showcase scenes need sunlit leaves, grass and flowers in Creek, and soldiers whose ears and hands glow red against the light in Battle ([D-132](D-132-showcase-look-and-features-2026-10-11.md), [D-142](D-142-more-techniques-before-1-0.md)). Today a leaf lit from behind shows only its ambient light, so a forest against the low sun looks dark and flat. How does a material let light through a thin surface? How do files and sketches ask for it, and what does a material without it pay? Does skin need more than that?

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

Shadows fall on the light from behind too. The lookup moves the point off the surface along `-n`, toward the light, as it moves a lit face's point along `n`. Today a surface that faces away from the sun skips its shadow lookup. Surfaces that let light through must do it.

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

One permutation bit, `TRANSLUCENCY`, in the standard material's two templates. Its builds load on first use, in the shader set `translucency`, which claims the builds it shares with skinning and morph targets. It is kept apart from transmission, from casters and from the test switch that reads instances by index. It goes with masks, alpha to coverage, the alpha hash, skinning, morph targets and row values: leaf cards, grass batches and soldiers need them.

A leaf card with alpha to coverage has two bits whose features claim shared builds: coverage and `TRANSLUCENCY`. Until now a build went to the feature of its lowest such bit, so those builds would have grown the coverage file, which every page with a masked material downloads. No build had two such bits before. So the rule changed: a build goes to the feature of its highest claiming bit, the rarer feature. Every existing build stays where it was, and the coverage and hash files keep their sizes. The shader manifest and the [implementation notes](../implementation-notes.md) state the rule.

The material row grows by one `vec4f`: the color and the transmission. Only the `TRANSLUCENCY` builds read it, with the transmission's row for the volume.

### Skin

Diffuse transmission gives ears and fingers their glow against the light. It does not soften the light across a face, which a screen-space subsurface blur does. That blur is not part of this record's build. The findings that its design starts from:

- A blur must know which pixels are skin, and with what radius. The scene color has no spare channel for that. Many WebGPU devices draw it as `rg11b10ufloat`, which has no alpha, and elsewhere its alpha is the canvas's alpha. No GPU path has a stencil buffer.
- So the skin needs a pass that draws it again: either into a mask, which a blur of the image reads, or as its diffuse light alone into a target, which each skin pixel blurs around itself. The Khronos sample renderer does the second, which keeps the highlights sharp. A blur of the whole image smears them.
- The outline's mask is the engine's model of such a pass. It has a view of its own, a culling pass of its own on WebGPU, and a layout of the outlined objects in both frame builders. A skin pass needs the same parts, plus its blur passes, a texture binding in the skin's builds and a quality setting for High and Ultra.
- Battle's soldiers fill few pixels each, so the blur would change little there. Diffuse transmission already gives their ears and hands the glow against the light.

The coordinator decides whether the blur becomes a task of its own.

## Data

**Checks of the look.** `tests/image/translucency.spec.ts` measures the `translucency` test's image on all three tiers, on the Mac's GPU and on SwiftShader, on 12 October 2026. Four panels with the low sun behind them let 0, 1/3, 2/3 and all of their diffuse light through. Each panel must show more light than the one before, by 0.03 of full brightness, and the last 0.2 more than the first. The box's shadow on the last panel's back must show through at most 0.6 of the lit part's brightness. The lamp behind the second panel must make its lower half redder by 0.1. The thick red volume and the striped maps change the last panel as they should. Both runs pass on every tier.

**Image tests.** Five new tests have references in both sets: `translucency`, `translucency-maps`, `translucency-volume`, `translucency-leaves` and the demo's. `translucency-custom` draws the panels with a custom material and matches the first test's references. The whole manifest passed on the Mac's GPU (961 of 961) and on SwiftShader (961 of 961) with this branch, so no other image changed. On SwiftShader, with six tests at once, four of the eighteen runs took more than 30 s for the first use of the new shaders, so the tests take 60 s.

**First use.** The page of the `translucency` test downloads one shader file that loads on first use, the `translucency` file, on WebGPU and on WebGL2. A leaf card with alpha to coverage builds with two bits whose features claim shared builds. Those builds go into the `translucency` file, so the coverage and hash files keep their sizes.

**Allocation.** `bun run bench:allocation --translucency` on the Mac's GPU on 12 October 2026: S1's 100,000 boxes let half their diffuse light through. Both paths pass. On WebGPU the sketch worker allocated 219.1 bytes per frame and the render worker 556.4. On WebGL2 they allocated 212.3 and 165.6.

**Size.** `bun run build:check-size` against main at ec8f5cca7, after Brotli, on 12 October 2026. The pipelined start grew from 133.0 to 133.4 KB on WebGPU, and from 130.2 to 130.5 KB on WebGL2, of 140 KB. The material options and their checks make most of it. The glTF worker grew by 1.7%, since it reads one more extension. The WebAssembly files kept their sizes. The twelve new shader files of the `translucency` feature take 24,530 to 29,589 bytes, under their 32 KB limit, and 1,428 KB at most before compression, under 1,536 KB. They load only with the first material that lets light through to its other side. The other shader files grew by at most 0.4%: the material row's new field shows in every build's declaration of the row.

## Decision

Options A throughout, for light through thin surfaces: glTF's diffuse transmission as the Khronos sample renderer draws it, with glTF's names, its maps in the specular maps' slots, and one permutation bit whose builds load on first use. The screen-space blur of skin waits for the coordinator's decision ("Skin" above).

## Consequences

- Code: `materials.rs` (the feature, the row and the slots), `frame.rs` (the variant), the shaders `lib/translucency.wgsl`, `lit.wgsl` and `lib/lights.wgsl`, the shader manifest's `translucency` set, the shader compiler's custom material check, `resources.ts` and the glTF reader.
- Docs: `api/materials`, `shaders/surface-functions`, `concepts/materials`, `api/assets` and `concepts/assets`, and a mapping entry for three.js's subsurface material.
- Skills: the develop skill's task table, quick reference and shaders reference, and the port skill's materials notes.
- Tests: Rust and unit tests, the image tests `translucency` and `translucency-custom`, the first-use download test, and `--translucency` in `bench:allocation`.
