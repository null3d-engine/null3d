# D-179: Technique and deferral rulings

Status: decided by the owner. M3-A11 refused the temporal resolve, so TAA, the shipping of many lights and the temporal upscaler are dropped. WebXR, OpenPBR, distance-field shadows and hair wait until after 1.0. Built: hook H4 with car paint's glints ([D-252](D-252-material-lobes.md)), spot-light cookies (M3-K3) and the `three-compat` add-on (M3-F7); the other rulings are M3 tasks. A few smaller items got no ruling ("Items not ruled on"). Task: M3-plan.

Summary: M3's global illumination is a leak-free probe volume on the L1 probe grid, and splats get detail levels, streaming, a budget and depth mixing. Glints, directional light maps, video textures, `three-compat`, the water add-on with its FFT ocean, the glTF gaps, six API features, the script-tag build, screen-space bounce light, moment transparency and GPU grass come in M3, and ACES stays in the core. TAA, many lights and the temporal upscaler are dropped with the temporal resolve, and WebXR, OpenPBR, distance-field shadows and hair come after 1.0.

## Question

A research session asked which rendering techniques three.js lacks. It read three.js r186 and the r187 branch, recent talks and papers, six engines and the browsers' GPU features. [Technique review](../technique-review.md#techniques-threejs-lacks) records what it found.

The owner asked to settle every item that the records, the mapping and the plans set for after 1.0: build it before 1.0, or drop it.

## Rule

- Intent parity is strict; looks are "equivalent or better" ([D-52](D-52-intent-parity.md)). What a glTF file means is intent, so a gap there is a bug.
- Build before 1.0 what changes the shape of the frozen API, or what a glTF file means.
- Core or add-on follows [D-54](D-54-addon-modules.md) and [D-173](D-173-addon-hooks.md): one place per feature.
- A technique that no planned demo needs is dropped, not left for later.

## Data

The research found that three.js has caught up on screen effects. Its r186 release and r187 branch hold a basic SSGI, a temporal upscaler (`TAAUNode`), FSR 1, TRAA and SSR. They also hold weighted blended transparency, screen-space shadows, clustered point lights, an L2 probe grid and a splat renderer. So null3D leads on quality, detail levels and phone speed, not on having a feature. The inventory, the 17 ranked techniques and the sources are in [Technique review](../technique-review.md#techniques-threejs-lacks).

Costs are in helper-weeks (hw), the coordinator's estimates from the size of similar tasks on main. The new work comes to about 50 to 60 helper-weeks.

| # | Item | Cost | Phone cost |
| --- | --- | --- | --- |
| 12 | Leak-free probe volume | About 3 hw | About 0.1 to 0.3 ms (estimate); 32 to 48 bytes per probe |
| 14 | Splats' wider scope | About 3 hw beyond the add-on | Spark ships 0.5 to 2.5 million splats per device budget |
| 15 | Many lights at a fixed cost | 1.5 hw to prototype, 2 more to ship | Published: +0.66 ms on an Adreno 610 at one sample per pixel, about 1.5 ms at 50 lights |
| 16 | Temporal upscaler that keeps MSAA | About 3 hw | Snapdragon GSR 2 targets under 2 ms on a Snapdragon 8 Gen 3 |
| 17 | Glints | Part of M3-B5 | About 0.3 to 1 ms on a full screen (estimate) |
| 18 | Directional light maps, `NEEDLE_lightmaps` | About 1.5 hw | About 0.1 ms; twice the light-map memory (estimate) |
| 19 | Water: river and lake; FFT ocean | About 2 hw each | Ocean about 0.5 ms for 3 bands at 128² (estimate) |
| 21 | glTF gaps | About 6 hw | Iridescence and anisotropy need WebGL2 texture units |
| 22 | Video textures | About 2 hw | Upload cost per frame, within the upload budget |
| 23 | `three-compat` | About 1 hw | None in the core |
| 25 | Script-tag build | About 2 hw | None |
| 26 | Six API features; `CubeCamera` | About 4 to 6 hw; 0.5 hw | Per feature |
| 28 | WebXR | 4 to 6 hw, after 1.0 | |

## Decision

The owner ruled on the coordinator's list. "Adjusted" marks a ruling where the coordinator moved a "1.x" recommendation before 1.0, as the owner asked.

### Techniques from the three.js comparison

12. **M3's global illumination is a leak-free probe volume** on M2-EX29's grid ([D-146](D-146-light-probe-grid.md)). Each probe gains a validity mask, so light does not leak through walls. A separate sky-occlusion term holds how much sky each probe sees. The live sky color multiplies it, so time of day needs no new bake. This follows Unity 6's adaptive probe volumes, which ship to phones. three.js's grid has neither. The volume runs on WebGL2 too.
13. **Probe detail stays L1** ([D-146](D-146-light-probe-grid.md)). L2 needs seven reads per pixel against three. three.js's L2 `LightProbeGrid` is a look under D-52, so the port maps it and lists the difference.
14. **Splats in M3** get detail levels, streaming, a splat budget, depth mixing with meshes, and `KHR_gaussian_splatting` and SPZ files. three.js's splats have none of the first four.
15. **Many lights at a fixed cost** (HypeHype's stochastic tile lighting) do not ship. Their noise needs temporal cleanup, and M3-A11 refused the temporal resolve ([D-206](D-206-temporal-resolve.md)).
16. **A temporal upscaler that keeps MSAA** is dropped, because M3-A11 refused the temporal resolve. three.js's `TAAUNode` needs MSAA off.
17. **Glints** (Deliot and Belcour, 2023) make M3-B5's car-paint flakes, through hook H4 ([Glints and hook H4](#glints-and-hook-h4)). No web engine checked has them, and the flakes stop shimmering far away.
18. **Directional light maps and reading `NEEDLE_lightmaps`** come in M3, in the core. Light maps that a glTF file carries are intent.
19. **The water add-on** gets river and lake water in M3, after splats. Adjusted: the FFT ocean comes in M3 too (M3-F9), about 2 hw. It is H1's first user ([D-173](D-173-addon-hooks.md)).
20. **Six techniques that no planned demo needed:** GPU grass, OpenPBR, hair, distance-field shadows, moment transparency and screen-space bounce light. The owner rules on them with the engine's aim in mind, an engine for demanding games rather than for demos:
    - **Screen-space bounce light is an M3 core task (M3-F12)**, after M3-A11, at half resolution and on High and above. It is core because it feeds the lighting model; an add-on pass could only tint the final picture.
    - **Moment transparency is an M3 core task (M3-F13)**, off by default and turned on by a scene's setting. It resolves once per pixel, and MSAA stays on for opaque geometry. The surfaces it resolves take the post-process anti-alias the setting names rather than MSAA's samples, because per-sample OIT multiplies its bandwidth by the sample count.
    - **GPU grass comes in M3, inside the vegetation foundation add-on** ([D-241](D-241-vegetation-foundation.md)). Creek's hills are the vegetation-heavy ground that is its trigger. WebGPU makes and culls the blades in a compute pass and draws them through H2. WebGL2 draws grass tiles that the CPU builds into instance batches.
    - **OpenPBR is on the post-1.0 roadmap**, and waits for the file formats to carry it: glTF and MaterialX shipping OpenPBR is the signal.
    - **Distance-field shadows are on the post-1.0 roadmap**, behind a future hook that lets an add-on or a core path own the shadow term. Until then cascades and contact shadows carry the ground.
    - **Hair is on the post-1.0 roadmap** as a content pack. Its trigger is a groomed character asset, and it also needs an asset path for grooming before the renderer is worth building.

    Other developers may build the ones that fit an add-on.

### Other items that were set for after 1.0

21. **glTF intent gaps come in M3 (M3-G1 to M3-G4),** before 1.0: `KHR_animation_pointer` with property animation, iridescence, anisotropy, and transmission and thickness maps. A file that uses one draws wrong without it. About 6 hw.
22. **Video textures come in M3,** with the in-world screens, which share M3-A2's upload path.
23. **ACES stays in the core.** It is one curve, tested strictly, so it is a shared building block like flat clouds. The `three-compat` add-on comes in M3 with Reinhard, Cineon, and `OutlinePass`'s glow, pulse and blurred edge ([The three-compat add-on](#the-three-compat-add-on)). This overrides [D-53](D-53-technique-defaults.md)'s ruling 4 and settles [D-79](D-79-lighting-defaults.md)'s ruling 5.
24. **TAA is dropped, not deferred.** M3-A11 refused the temporal resolve ([D-206](D-206-temporal-resolve.md)): its prototype did not pass the engine's capture and live-toggle paths, and its WebGL2 cost was too high. The three.js mapping says that TAA, `TRAANode`, `TAAUNode` and `TemporalReprojectNode` have no equivalent ([D-129](D-129-temporal-anti-aliasing.md)).
25. **The script-tag build** (test T-32) comes in M3 (M3-O1). It lets people try null3D in CodePen-style pages before the 1.0 launch.
26. **Adjusted: six API features come in M3 (M3-K1 to M3-K6),** about 4 to 6 hw. They are multiple views, gizmos, spot-light cookies and CSS3D labels. The others are a material override for a whole pass and a tone-mapping flag per material. They are built early in M3, not last: they cost little, but they add public surface just before the API freezes, and time to use them is what makes that surface safe to freeze. `CubeCamera` maps to a reflection-probe update in M3.
27. **Browser-gated items are adopted as browsers ship them,** with no date: multi-draw indirect, 64-bit atomics, mesh clusters, the visibility buffer, ray tracing and subgroups. The GPU layer keeps their capability flags.
28. **WebXR is not in 1.0.** It comes after 1.0, as its own milestone, beside the post-1.0 roadmap items of ruling 20. The main-thread draw mode keeps working, so WebXR can arrive without a redesign.
29. **The research findings are recorded** in [Technique review](../technique-review.md#techniques-threejs-lacks) and in the three.js mapping, its docs page and the porting skill.

### Items not ruled on

The brief also listed smaller items with a recommendation. The owner's rulings above do not name them, so they stay open. The owner ruled on three of them in [D-137](D-137-lod-groups.md): cluster culling for large static meshes, the impostors' three-view blend and follow-ups 1, 4 and 5 of levels of detail come in M3. The rest stay open:

- rooms and portals; virtual texturing;
- the impostors' bake helper and `assets impostor` command;
- lit fog for transparent surfaces and particles;
- follow-ups 2 and 3 of levels of detail, and the follow-ups of outlines, of transmission's back faces and of MSAA with FXAA;
- surface functions that read the scene's lights, for toon shading;
- the memory items of [D-130](D-130-memory-toward-threejs.md): exact upload arenas and tables, and the two always-on threads.

## Spot-light cookies (M3-K3)

A spot-light cookie, three.js's `SpotLight.map`, takes a layer of the light tables' array, so it costs no GPU binding at all.

**What it does.** `map` and `setMap` take the sRGB pixels that a rectangle light's `image` takes, or an engine texture, and the engine resamples them to linear half floats with every mip level, in the layer that a light's image occupies. "A cookie keeps its detail" below gives the sizes and the texture copy. The shader projects the picture over the cone: it takes the uv from the direction to the surface and the cone's half angle, as three.js projects `light.map` through its spot light's shadow camera. Three.js turns that camera with the light's target and the world's up axis, not with the light's own roll, so the cookie follows the direction alone. A light that points straight down takes the same small tilt that three.js's `lookAt` gives it, so the frame stays defined there. The image's layer has a field of the record of its own, so a frame's shadow tiles and a light's image never share one.

**Cost per light.** None in texture units: the light tables' array is at binding 3 of the frame group in every lit pipeline, on both GPU paths, and the cookie adds no binding to it. A visible light's record is 80 bytes (five vectors) so that it can hold the map's layer and the up axis its projection needs, against 64 bytes without them. On WebGL2 that is one more texel per record in the light data texture, so the light grid takes 2,048 words per row rather than 4,096. That keeps the texture 1,792 texels wide, inside the 2,048 that every WebGL2 device allows. The frame's light records take 80 KiB at the engine's 1,024-light cap, per camera view and ring slot. A map's own layer costs about 175 KB with its mip levels at 128 x 128, 699 KB at 256 and 2.8 MB at 512, and the 32 places for light images are shared with rectangle lights' pictures. A scene with one detailed picture takes about 11 MB of the shared array.

**Consequences.** The three.js mapping's `spot-light` entry names `map`, the API page has a "Spot light maps" section, and the develop skill's quick reference lists it. An image test draws a gobo on both GPU paths and in compatibility mode. The GPU's light clustering test fixture follows the 80-byte record.

## A cookie keeps its detail (M3-K3)

A spot light's picture covers the square around its cone. Take a light with a half angle of 0.4
radians and a wall six meters away. There a texel of a 128 x 128 picture spans three centimeters, so
a viewer near the wall sees the mip chain blur before the screen's own pixels run out. A gobo of one
color reads well; a projected photograph, a stained-glass window or a slide does not.

**The size.** An image's size follows its picture. The engine rounds the picture's longer side up to
a power of two and keeps that size between 128 and 512 texels a side. A picture up to 128 pixels
costs what it did, and each step up keeps four times the texels a side. A larger picture is
box-filtered down to 512. Each image keeps its own size in the corner of its layer. The tables'
layers take the size of the largest image in the scene, or the probes' size where that is larger.

**Why 512.** A 1,024 x 1,024 image takes 11 MB with every level, and the room for four pictures
would take 44 MB for a scene with one cookie. A phone's memory budget does not carry that. 512 keeps
a projected photograph sharp on a wall at the distances that scenes show it. The cap is the engine's
choice, not a preset's. The owner did not take the uncapped route for those figures.

**The record.** A light's record keeps the image's layer plus one in six low bits of one float. The
number of the image's size sits above those bits. The shader decodes both, so the record stays 80
bytes and the WebGL2 light data texture stays 1,792 texels wide. The level that ends an image's mip
chain follows from its size by whole-number arithmetic, and the shader clamps the level it reads to
that.

**A texture's picture.** A sketch gives a spot light an engine texture as its map, and the engine
copies it into the light's image once the texture's texels are on the GPU, at up to 512 texels a
side. The copy is a GPU pass shaped like the mip pass: it draws the source into the image's corner
and makes its levels. A texture that changes every frame, such as a video's or a render pass's,
throws E1112, because the copy shows one frame; a 3D or cube texture throws it too, because a cookie
projects one image. The copy adds no binding and no sampler to the lit shaders, which stay inside
the 16 sampled textures that a fragment stage allows.

**A probe moves the pictures.** A probe's layers come before the pictures' in the shared array. A
probe that a scene adds after a picture therefore moves every picture along. A frame rewrites the
records when the probes' layers change and uploads the pictures again into their new layers, so a
light never reads a probe's map or an empty layer. A picture larger than the probes' maps makes the
array larger, and a map copied into a larger layer would show only a corner of itself. Every probe
therefore captures again when the array's size changes.

**Cost.** A picture of 128 x 128 texels takes 175 KB with every level, 256 takes 699 KB, and 512
takes 2.8 MB. The tables keep room for four pictures once a scene has one. A scene with one
detailed picture therefore takes 11 MB of the shared array. A scene that uses no picture pays
nothing. Resampling runs once per picture: on the Mac at a load near 85, a 512 x 512 source took
12.5 ms at its fastest and a 1,024 x 1,024 source took 25.0 ms. A texture that a sketch gives the
light costs one GPU copy at the same time. The shader gains two integer operations per mapped
light, and it samples the light tables as it did.

**Tests.** The `spot-map` picture draws a small gobo at the smallest image size, which shows a small
picture's look. The `spot-map-probe` picture moves a light's picture along the array with a
reflection probe that arrives after it. The `spot-map-texture` picture draws that scene's picture
from an engine texture instead of pixels, against the pixel form's reference, so the copy's corner,
row order and layer move must draw the same image. The `demo-spot-cookies` demo draws a 512 x 512
rose window beside a 128 x 128 window frame. The pictures cover every GPU path.

## The three-compat add-on

Ruling 23 gives `@null3d/three-compat` Reinhard, Cineon and `OutlinePass`'s glow, pulse and blurred
edge. It ships as a foundation add-on (M3-F7) with this shape:

- **Tone curves.** The add-on exports `reinhard` and `cineon` as compiled tone curves, which
  `post.set({ toneMapping })` takes through the core's own setting. Both use three.js 0.186.1's
  formulas from `tonemapping_pars_fragment.glsl.js`, and leave out the exposure that three.js
  multiplies in, because the engine's color arrives exposed. ACES stays in the core.
- **Tests.** `tests/image/tone-mapping.spec.ts` compares the bright scene's tile colors against
  three.js's `ReinhardToneMapping` and `CineonToneMapping` at two exposures, on every GPU tier.
  The maximum difference is the same 4 steps of 255 that the built-in curves use. A custom curve
  moves compatibility mode to HDR color with FXAA, as the effects do, so the curves draw there
  too. The forced 8-bit path keeps the built-in curve, so the curves have no 8-bit copy.
- **Outline.** `createOutlinePass(ctx, options)` reads the core outline's mask, with the crisp line
  at a width of 0. It runs five full-screen passes, three at half the render size and two at a
  quarter, and one custom effect that adds the edges before bloom and the tone curve. Together they
  shade about 0.88 of the canvas's pixels and read about nine texels for each screen pixel, plus two
  in the effect. The settings are `OutlinePass`'s `edgeStrength`, `edgeThickness`, `edgeGlow` and
  `pulsePeriod`, with `visibleEdgeColor` and `hiddenEdgeColor` as `color` and `hiddenColor`. The
  pattern texture and `downSampleRatio` have no setting, and the mask reads at half size. Each blur
  pass names the scene's color as its input: the graph places a full-screen pass with no input
  before the camera's passes, so a chain after the mask needs that marker, or the graph reports a
  cycle (E1504). `guides/custom-passes` records the rule for users.
- **Why an add-on.** The add-on extends the outline only through the core feature's own settings and
  the public passes and effects ([D-173](D-173-addon-hooks.md) ruling 11), so another developer
  could build it. The engine's start code is unchanged.

## Glints and hook H4

Ruling 17 asks for Deliot and Belcour's glints. A model that resolves to one random normal tilt per
cell does not meet it, and a custom material's surface function cannot do better alone, for two
reasons:

- The glint model multiplies the continuous specular of each light by `b(N, p) / (N p)`. `b` is a
  binomial count over the `N` facets in the pixel footprint, and `p` is the share of facets whose
  normals reflect that light toward the eye. `p` is a function of the half vector, so the model runs
  inside a light's shading, not on the surface alone.
- A custom material's `surface` function sees no light, and the engine computes each light's
  specular after the surface function returns. So a surface function can bend the normal and change
  the roughness, and nothing more.

[Hook H4](D-173-addon-hooks.md) is the place this belongs. The clear-coat check (F6) closed it for
the hashed-normal model, but that model does not meet ruling 17, so H4 is needed. H4 is built as a
material's own specular lobe ([D-252](D-252-material-lobes.md)), and car paint's glints declare it.

## Options rejected

- **Leave additive features for 1.x minor releases.** The brief recommended it for H1, H2, H8, the ocean and the six API features, since adding to the API breaks nobody. The owner wanted every item settled before 1.0.
- **L2 probes, for strict comparison with three.js.** Seven reads per pixel on phones, for a difference that is a look under D-52.
- **ACES moved to `three-compat`.** Every port that set ACES would need an install, for one curve with no hook.
- **A bake add-on.** The bake stays in the core, as D-146 built it.
- **Particle collision with the depth buffer.** The particles add-on has no simulation pass ([D-131](D-131-particles.md)).
- **A spot-light cookie in one texture unit per light.** WebGL2's lit fragment stage has no unit to spare, and a scene with many mapped lights would exceed its count.
- **A spot-light cookie from an engine texture handle per light.** It needs a sampled binding of its own for each light, or a copy of its texels into the layer for each format, compressed ones included. The accepted route copies an engine texture into the light's shared image once, rather than binding it per light.
- **A spot-light cookie in a tile of the shadow atlas.** A spot light that casts shadows needs its tile for depth, so a mapped light that casts them would need two, and a light that casts none still needs a projection frame.
- **A spot-light cookie in a separate atlas and binding.** It takes a second unit of the frame group on WebGL2 for one feature, where the light tables' array holds layers with mips.
- **Keeping the hashed normal for the car paint and amending ruling 17.** It drops a feature the owner approved.
- **A model that still resolves to one tilt per cell, called glints.** The code and the task's promise would disagree.

## Consequences

- **Records:** [D-52](D-52-intent-parity.md), [D-53](D-53-technique-defaults.md), [D-79](D-79-lighting-defaults.md), [D-129](D-129-temporal-anti-aliasing.md), [D-142](D-142-more-techniques-before-1-0.md) and [D-146](D-146-light-probe-grid.md) point here.
- **Technique review:** a section of its own holds the research. It gives what three.js gained and still lacks, the browsers' GPU features, the 17 techniques with their verdicts, and the sources. It also gives the `three-compat` contents, the ACES porting verdict, and the gap rows for TAA, light maps, water and WebXR.
- **The three.js mapping:** entries for `TAAUNode`, `TRAANode`, `FSR1Node`, `SSGINode`, `LightProbeGrid`, the clustered lights, `GaussianSplat`, `SunLight` and the screen-space shadows. Entries give the version that brings each feature. WebXR says "not in version 1", and TAA says "no equivalent". The porting skill and the develop skill follow.
- **README:** the roadmap's 0.3 and 1.0 steps hold the features of these rulings.
- **Plans:** the tasks of these rulings are in M3's task list.
