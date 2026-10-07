# D-53: Technique defaults from the October 2026 review

Status: decided by the owner on 2026-10-04. Rulings 6, 11, 12, 17 and 24 are rules that the owner agreed. A prototype sets their settings. It stops them only if they cost more than they give on phones. Rulings 1, 4, 9, 14, 15, 16, 18 and 28 wait on their prototypes, as the consequences table says. Date: 2026-10-04. Task: M2-N1.

Summary: 28 rulings under D-52's best-default rule. Mip-chain bloom, crisp outlines, the vignette in HDR, AgX, native radial fog, AO on indirect light, specular anti-aliasing, exposure in the lights and a `three-next` baseline for r187. AO stays off on phones until it fits: Filament measured 7.5 to 14.4 ms on a Pixel 7 Pro. GPU occlusion culling stays off on Android until the GPUs that Bevy and Unity block pass. Phone tests run on BrowserStack Automate, and Brave is no longer tested.

## Question

On 4 October 2026 the team compared each area of the engine with the source of eight engines. Then it checked the open facts by web search ([Technique review, October 2026](../technique-review-2026-10.md)). Under [D-52](D-52-intent-parity.md), each look uses the best technique as its default. Which default does each area take, how do three.js ports reach it, and which prototype must confirm it first?

## Rule

- The best technique is the default ([D-52](D-52-intent-parity.md) part 2). A default that a phone cannot afford stays off on the presets that phones run, until a prototype shows that it fits.
- Intent stays strict: glTF, materials, color, units and animation. A change there must keep three.js's meaning, and its pixel tests stay strict.
- No three.js-look mode stays in the core. A look that a port truly needs, where no setting comes close, goes to the opt-in `three-compat` add-on.
- The owner decides each question. Where a ruling waits on a prototype, the prototype's pass rule is part of the ruling.

## Data

The technique review holds the evidence. It gives the ranked changes, the porting verdicts, the prototypes with their pass rules and devices, and the web search results with their sources. The figures that decide the rulings:

| Fact | Figure | Source |
| --- | --- | --- |
| Texels that bloom reads per pixel | About 8.3 for a mip chain, 10.8 for `UnrealBloomPass`'s steps | D-52; the review's post-processing findings |
| AO on a phone at half size | 7.5 ms (SAO Medium) to 14.4 ms (GTAO) on a Pixel 7 Pro, Mali-G710 | S-03, [Filament PR #8688](https://github.com/google/filament/pull/8688) |
| AO on the Mac today | +2.42 ms of GPU time at scale 1, +1.18 ms at 0.5; `GTAOPass` +5.27 ms | The `ao` device plan, 4 October 2026 |
| GPU occlusion culling | Saves 37% on a quiet Mac (1.64 to 1.04 ms); costs 19 to 40% more with another program on the GPU | The room scene of the GPU occlusion page |
| Phone GPUs whose drivers break GPU culling | Adreno 730 and older, Mali drivers before r48, the Pixel 10 and 11 (PowerVR) in Bevy; Adreno with Vulkan in Unity | S-26 |
| Shadow comparison on Adreno with WebGPU | Wrong results with no error; Dawn works around it from Chrome 149 for 2D and 2D-array depth textures | S-02, [three.js PR #32548](https://github.com/mrdoob/three.js/pull/32548) |
| One 16-bit depth step in S4's last cascade | 14.4 mm, above both 10 mm biases | The review's shadow findings |
| GGX peak at the roughness floor | About 42,000 times the light's irradiance at 0.0525; about 1.85 times more at 0.045 | R7-01; 1 / (π r⁴) |
| three.js r187 | Not released; due on 21 October 2026. Its `dev` branch reads the environment at `maxLod · r · (2 − r)`, floors roughness at 0.045, and reads diffuse light from the roughest level | S-04 |
| The run-time prefilter | three.js r187's took 10.4 to 13.0 ms for a 1K HDRI on an Apple M1, reading 53 million texels; the asset tool's filter reads 98 million | S-10, [three.js PR #34585](https://github.com/mrdoob/three.js/pull/34585) |
| Shader files at a page's start | 1.7 to 3.4 MB raw, about 24 KB after Brotli; 378 to 496 KB with gzip; 15 to 20 ms to parse on the Mac | R6-03, R8-02 |
| Morph texture | 64 MiB as RGBA32F at 2,048 x 2,048; 32 MiB as half floats | M2-C5's branch |
| Skinned memory in S5 | 69 MB at 500 knights; about 49 MB with 8-bit normals and tangents | The review's animation findings |

## Decision

The owner's rulings of 4 October 2026. Rulings 1 to 4, 13, 14, 19 and 27 follow from D-52. The owner accepted the rest on the decisions page at 18:55, ruling 22 at 19:00, and ruling 28 as recommended.

| # | Area | Ruling | Reason |
| --- | --- | --- | --- |
| 1 | Bloom | The mip chain becomes the default, after prototype P2 sets its settings: a base of 512 rows (384 on Low), a 13-tap downsample with a Karis average, a 9-tap tent upsample, an energy-conserving mix. `UnrealBloomPass`, `bloom()` and pmndrs `BloomEffect` are rewritten in the port with their settings mapped. `UnrealBloomPass`'s halo goes to `three-compat` only if P2 shows the mapping cannot reach it | Every engine read uses a mip chain, apart from three.js and Babylon.js. It reads about 8.3 texels per pixel against 10.8, keeps the glow's size and cost the same at any pixel ratio or render scale, and its Karis average stops bright points from flickering |
| 2 | Outlines | A crisp outline: D-36's mask pass, then an edge test of 4 to 8 reads in the final pass, with no blur. #280 is reworked that way before it merges. `OutlinePass`'s glow and pulse go to `three-compat` | A crisp line costs less and stays sharp at any pixel ratio. No engine has a better mask step than D-36's. No setting reaches a blurred glow |
| 3 | Vignette | Multiply in HDR before the tone curve, as Filament, URP, Bevy and Babylon.js do. `VignetteShader`'s settings map onto it. three.js's vignette does not go to `three-compat` | Darkening before the curve keeps highlights from turning gray. The port's difference is small, so the add-on would carry a look nobody needs |
| 4 | Tone curve | AgX for new scenes, Neutral in product templates. Prototype L7 picks AgX's look (plain or punchy). ACES, Reinhard and Cineon go to `three-compat`. AgX and Neutral are shared with three.js, so their pixels compare strictly | ACES shifts hues in bright colors: blues turn purple and oranges yellow. model-viewer defaults to Khronos PBR Neutral, and three.js, Filament, Babylon.js and Blender ship it (S-09). Color is strict, so a port that set ACES keeps it through `three-compat` |
| 5 | three.js r187 | Add three.js main as a second package, `three-next`, now, and run the lighting-term fits against it. Move the pin to r187 in one change when it is released | r187 changes three lighting terms: the 0.045 floor, the lookup at the material's own roughness with no base-level offset, and diffuse light from the roughest level. Against r186 the own-roughness lookup cannot pass the strict rule. r187's EON diffuse is Lambert at its default, so default materials still compare strictly |
| 6 | Contact shadows | On for the sun on High and Ultra, inline, 8 steps over 0.3 m, reading AO's half-size depth. Ports get them too. S3 times them on the iPad and the S25 | They close the lit line at casters' bases (0.020 pixels near the camera, 0.077 in the last cascade, [D-16](D-16-moving-casters-and-bias.md)). No phone timing is published (S-03) |
| 7 | Physics | `@null3d/rapier`, an add-on module, in M3 | Games need collisions, and M3's third-person template needs them. three.js 0.186 ships `RapierPhysics.js`, so ports need a target. Rapier's WebAssembly can write poses straight into the scene's shared arrays, with no call per object |
| 8 | HDR files at load | M2-E4 moves to P0 and builds on the room's generator: the asset tool's filter run in the browser, with a limit on bright texels | The same filter serves both. HDR files can hold a sun above 65,504 |
| 9 | The built-in room | The engine's package drops `room.ktx2`. The engine makes the room in the browser with the asset tool's filter. Prototype L1 measures its first-use cost. [D-19](D-19-environment-maps.md) records the method | The owner's rule: built-in assets are made at run time. The tool's filter takes more samples than r187's, so its map is at least as good. Under D-52 the room is a look: null3D's own references, and a sanity comparison with `RoomEnvironment` |
| 10 | Phone tests | BrowserStack Automate phones wherever possible. The Android WebGPU questions go to the Galaxy S25 and the Pixel 9, 10 and 11. Brave is no longer tested. The owner's S24+ serves only checks that need a USB cable. [Device sessions](../devices.md#which-device-runs-a-check) gives the detail | The S24+ has no WebGPU adapter. The cloud phones cover Adreno, Mali and PowerVR. Brave draws as Chrome does |
| 11 | Specular anti-aliasing | On by default: Filament's kernel (variance 0.15, threshold 0.2), roughness clamped after it. Prototype L3 sets the settings. The tool bakes normal variance into roughness mips. No three.js mode | Phones have no temporal anti-aliasing, so shimmer on shiny metal is the most visible material flaw left. Godot ships the same kernel on by default |
| 12 | Exposure | Multiply exposure into every light, ambient, environment, emissive, background and fog color on the CPU, and set the final pass's exposure to 1. Add `intensityUnit: 'lumen' \| 'lux'` and `post.set({ ev100 })`. Inputs keep three.js's units | The picture does not change, but colors stay in range in real-unit scenes: a 100,000 lux sun at EV100 15 stores values near 1. The HDR limit of R7-01 is still needed for scenes at exposure 1 |
| 13 | Fog | One native fog with radial distance, height and sun light, and a curve setting: exponential (default), exp2 or linear. `Fog` and `FogExp2` map onto the linear and exp2 curves | Radial distance does not move at the screen's edges as the camera turns. Bevy offers the same three curves on radial distance |
| 14 | AO | AO darkens indirect light only. M2-F2 finishes as built: its read of depth as `unfilterable-float` is allowed in compatibility mode (S-01). S3 picks the method, with the bitmask variant if it costs little more on the iPad. AO stays off on phone presets until S3 meets its pass rules. `GTAOPass` maps onto a `lightAffect` setting; M2-F2's 0.036 to 0.040% against `GTAOPass` becomes a sanity comparison | The bitmask variant removes the dark halos behind thin objects, and Filament's version runs in fragment shaders on OpenGL ES 3. AO on a Pixel 7 Pro took 7.5 to 14.4 ms at half size (S-03) |
| 15 | GPU occlusion culling | On for High and Ultra on desktops only if a second quiet Mac run saves time, and a run with another program loading the GPU loses no more than 5%. Off on Android until prototype G1 passes on the GPUs that Bevy and Unity block. No CPU-buffer fallback before that | A quiet Mac saves 37%. Bevy blocks GPU culling for driver crashes on Adreno 730 and older, Mali drivers before r48, and the Pixel 10 and 11; Unity for missing objects on Qualcomm (S-26) |
| 16 | Cascade depth | `depth16unorm` cascades with a bias floor of 1.5 depth steps per cascade, after prototype S1. Point and spot tiles stay 32-bit | It halves cascade memory: Ultra from 256 to 128 MiB, Medium and High from 48 to 24 MiB. One 16-bit step in S4's last cascade is 14.4 mm, above both 10 mm biases, so it needs the floor |
| 17 | Shadow distance | Follows the farthest visible receiver when a sketch names no distance, if S2 passes. A port that names a distance keeps it | In a 15 m room the near texels get about 10 times finer |
| 18 | Animation fades | Inertial transitions become the default for switching what a layer plays in new scenes, if prototype A4 passes. Ports map `crossFadeTo` to the native `blend` transition | Animation is strict under D-52, so ported code keeps a cross-fade. Holden's dead blending code (MIT) is the reference (S-21) |
| 19 | Detail levels | Godot's screen-error rule: the coarsest level under 1 pixel of error, times the render scale. `LOD.addLevel` distances convert in the port. No three.js mode | Detail then follows the governor's render scale with no new governor step. D-52 gives this mapping as its example |
| 20 | Area lights | After 1.0. The two fitted tables ship as half-float data in a first-use file, a recorded exception to the rule that built-in assets are made at run time ([D-14](D-14-js-budget.md)) | Every engine with rectangle lights uses fitted tables. They cannot be made at load at a sensible cost |
| 21 | Gap features | In M3: MSDF text, the physics add-on, a GLSL-to-WGSL port command on three.js's transpiler, Gaussian splats reading `KHR_gaussian_splatting`, planar reflections, particles, decals, per-object light maps reading `NEEDLE_lightmaps` first, IK and box-projected probes. Splats, physics, particles and `three-compat` are add-ons; text too if its glyph tools are large | The review ranks them by value per effort. Each needs per-feature shader files first. `KHR_gaussian_splatting` was ratified on 3 September 2026 (S-32). naga cannot read GLSL ES (S-33) |
| 22 | Add-ons and CDNs | [D-54](D-54-addon-modules.md) | |
| 23 | Download size on gzip hosts | The size report adds gzip and uncompressed columns. The size is fixed at its cause: per-feature shader files, and one copy of each shader stage. [D-14](D-14-js-budget.md) records it | On a gzip host a WebGL2 page downloads 496 KB at its start, against 106 KB with Brotli |
| 24 | Still-camera accumulation | On by default, after M2's P0 work. Off in hold mode and image tests | Still frames gain sharper edges and detail, then drawing stops, which saves power. Moving scenes look as now |
| 25 | Color grading controls | Not in M2. `.cube` and `.3dl` tables stay after the tone curve. When controls come, a job worker bakes them with the tone curve into one 32³ table on each change, as Filament does | One table read per pixel beats per-pixel controls, which add ALU and shader builds |
| 26 | `three-compat` | ACES, Reinhard and Cineon; `OutlinePass`'s glow and pulse; `UnrealBloomPass`'s halo only if P2 fails. Each candidate gets its own decision, as D-52 asks. Built in M3 with the porting skill, after M2-F5 and M2-F6 make the extension points public | It must add nothing to pages that do not import it, and it tests the public extension points as a user's code would |
| 27 | Tests and benchmarks | Strict pixel tests against three.js for shared building blocks. Improved techniques get null3D's own references and a looser sanity comparison. Benchmarks compare equal work, with quality notes | D-52 parts 4 and 5 |
| 28 | Shadow comparison on Adreno before Chrome 149 | Run the shadow image tests on the S25 with Chrome 149 or later, and with an older Chrome if BrowserStack offers one. Add no guard if the older Chrome draws correctly, or if none is offered: Chrome on Android updates itself. If it draws wrong shadows, add a guard: on a Qualcomm adapter with Chrome before 149, compare in the shader, as three.js does on every Android browser | Dawn's workaround covers 2D and 2D-array depth textures, which are all that null3D's cascades and tiles use. No driver fix is known, so the workaround stays in Dawn (S-02) |

### Shared building blocks and improved techniques

Pixel tests against three.js stay strict for:

- glTF: geometry, vertex types, node transforms, texture transforms, skins, clips and morph targets;
- materials: the BRDF, the lighting table, every glTF map, alpha modes and the transparency fixes;
- color: sRGB encoding, AgX and Neutral, and `.cube` and `.3dl` tables (ACES, Reinhard and Cineon in `three-compat`);
- units: light intensity, falloff, spot cones and exposure;
- animation: sampled poses, blends and morph weights;
- raycast hits, and `Line2`'s geometry.

Improved techniques get null3D's own references and a looser sanity comparison. It shows that the effect is in the same place and of the same size. These techniques are:

- bloom, AO, outlines, the vignette and fog;
- shadows: cascades, the filter and contact shadows;
- anti-aliasing, accumulation and upscaling;
- detail-level switching, probe grids, the built-in room, and a sky that is not Preetham's model. D-21's bloom (0.000%), M2-F2's AO (0.036 to 0.040%) and D-36's outlines (0.015% or less) become sanity figures.

Benchmarks set each three.js twin to do the work null3D does, where both can. Examples are S6's `GTAOPass` at the same AO resolution, and S5's cascades at the same count and map size. Where null3D's default does other work, each engine runs its own technique. The summary then carries a quality note: a side-by-side at the twin's settings, mapped by the porting verdicts, with the differences named.

## Options rejected

- Keep each three.js look as the core's default, as the first round advised for bloom, outlines, the vignette, ACES, fog and the environment lookup. D-52 rules it out.
- A CPU depth buffer for occlusion culling on desktops. A quiet Mac saves 37% with the GPU method; the slowdown came from other programs' GPU work.
- A separate half-size depth pass into an `r16float` color target for AO. Its two reasons were wrong by the specification (S-01). It returns only if S5's multisampled read fails on OpenGL ES, or if S3 shows it costs less on tile GPUs.
- ACES 2.0 in the core. A user can load a baked table as a `.cube` file (S-07).
- naga for the GLSL port command: it rejects `#version 300 es` (S-33).

## Consequences

Each ruling becomes work in M2 or later. The tasks marked "proposed" need the coordinator's breakdown entry.

| Ruling | Task | Prototype first |
| --- | --- | --- |
| 1 | Proposed M2-F7; reopens [D-21](D-21-effect-chain.md) | P2 (also gives D-21's iPad and phone timings) |
| 2 | M2-F4: rework #280 before it merges; keep its soft steps on a branch for `three-compat` | P4 sets the default width |
| 3 | Proposed M2-F9 with the dither and the WebGL2 scene format; [D-33](D-33-color-grading.md)'s vignette changes | P3, P5 |
| 4, 11 | Proposed M2-E7: floor 0.045 (HALF 0.089), specular anti-aliasing, horizon fading, AgX | L3, L7 |
| 5 | The parity tools add `three-next` | L2 |
| 6 | Proposed M2-F12 (P1 priority) | S3 |
| 7, 21, 26 | M3 | X1, X2, X3 for splats, text and the port command |
| 8, 9 | M2-E4 at P0; M2-E2 (#283) | L1 |
| 10 | The device plans, [Device sessions](../devices.md#which-device-runs-a-check) | |
| 12 | Proposed M2-E6, with R7-01's HDR limit in fix group E | L6 |
| 13 | Proposed M2-E8 | |
| 14 | M2-F2 | S3, S5 |
| 15 | M2-I1, with D-22 and D-40 on its branch | G1, G2 |
| 16 | Proposed M2-R8 | S1 |
| 17 | Proposed M2-R10 (P1 priority) | S2 |
| 18 | Proposed M2-C10 (P1 priority); D-28 gains the transition | A4 |
| 19 | M2-I4 | A3, G6 |
| 23 | M2-R11, with its own record, D-56: per-feature shader files; the size report's columns | |
| 24 | Proposed M2-F11 (P1 priority) | |
| 27 | M2-L4, the M2 gate's item 5, `bench/lib/parity.ts`, the S5 and S6 twins, the porting skill's `verification.md` | |
| 28 | The shadow image tests on the cloud S25 | S1 |

Other consequences:

- Per-feature shader files that load on first use (M2-R11, D-56) come before any new feature that adds shader code. Branches already built move their shaders into first-use files in a follow-up.
- Color morph targets (glTF's `COLOR_n` morph targets) are a parity gap under D-52's strict glTF intent. A follow-up task closes it in M2, after morph targets (M2-C5) merge. Closed on 5 October 2026 by M2-C11 for `COLOR_0`: [D-51](D-51-morph-targets.md#color-targets).
- The parity list keeps only shared building blocks. Bloom, AO, outlines and the vignette leave it when their defaults change.
- The porting skill, the port tools and the three.js mapping change with each feature as it ships, as D-52 says. Until then they describe what the engine does now: ACES as the default curve, and `UnrealBloomPass`'s steps.
- The review's other changes need no owner ruling, and follow the best-default rule:
  - the lookup at the material's own roughness, and one filtered read of the lighting table;
  - Lagarde's specular occlusion with horizon fading;
  - the two-step output below scale 1 with GSR 1 (P1);
  - lean WebGPU skinning (A1), and half-float morph deltas;
  - the clip step in the tool (A2), the texture budget's drop order (A6), and the transparency fixes (G3).
- [D-19](D-19-environment-maps.md) on #283 still reads each roughness from the table fitted to three.js r186. Under ruling 5 and the review, the lookup moves to the material's own roughness, `lod = (n − 1) r (2 − r)`, and the fitted table goes, in #283 or right after it.
- The record is in the table in [README.md](README.md).
