# D-135: Contact shadows

Status: decided by the helper of M2-F12 on 11 October 2026, for the owner's review. It changes where [D-53](D-53-technique-defaults.md) ruling 6 runs the march: at ambient occlusion's half size, not in the lit shader. Built: contact shadows are on main (`60fe5ef01`). The owner's review is pending. Date: 2026-10-11. Task: M2-F12.

Summary: The main directional light draws contact shadows: short shadows found in the camera's depth, which close the lit gap that the cascades leave where small objects meet the ground. Ambient occlusion's half-size horizon step marches them toward the sun through its depth copy, and its denoise blurs them by depth and normal into the fourth channel of its screen texture. The opaque pass reads that channel with the four reads it already makes for ambient occlusion, and multiplies the sun's light by it. `shadow: { contactDistance }` sets the reach (0.3 m by default), and the `contactShadowSteps` quality setting sets the steps: 8 on High, 16 on Ultra, 4 on WebGL2's Medium, none on Low.

## Question

The showcase scenes need small, sharp shadows where objects touch the ground: stones in a creek bed, grass roots, feet, wheels and crates (D-132). The cascades cannot draw them. Their texels are centimeters wide, their filter blurs over 3 or 5 texels, and their biases move each receiver toward the light. The `shadows-contact` checks of [D-16](D-16-moving-casters-and-bias.md) measure a lit gap at casters' bases of 0.020 pixels near the camera and 0.077 in the last cascade. Small casters lose their whole shadow. Which technique draws contact shadows, where does it run, and what may it cost?

## Rule

- Equivalent or better than three.js ([D-52](D-52-intent-parity.md)). three.js draws no contact shadows, so this adds to its look.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Prototype S3's rule: under 0.5 ms of GPU time on the Galaxy S25 at High.
- Zero cost while they draw nothing: no pass, no prepass, no texture read in the opaque pass ([design principle 8](../../AGENTS.md#design-principles)).
- No new texture binding in the opaque pass. Its WebGPU fragment stage reads 15 of the 16 textures that every device allows, and lit fog takes the last.
- No allocation per frame ([hard rule 1](../../AGENTS.md#hard-rules)).

## Prototype S3

Prototype S3 (4 and 5 October 2026) timed contact shadows inside the lit pass: 8 steps over 0.3 m through ambient occlusion's half-size depth, at every pixel of the render size. Its scene had no shadow map, so every pixel that faced the sun marched. That is the worst case.

| Device | Render size | Cost of contact shadows |
| --- | --- | --- |
| Mac (Apple M5 Max), WebGPU, batches | 3,024 x 1,520 | +0.41 to +0.48 ms |
| Mac, WebGPU, batches | 1,512 x 760 | +0.12 ms |
| Galaxy S25 (Adreno 830), WebGPU, timestamps | 720 x 1,242 | +2.2 to +2.3 ms |
| Galaxy S25, WebGPU, timestamps | 360 x 621 | +0.64 to +0.73 ms |

The S25 failed the rule at both sizes. The prototype's pictures showed a dotted line at the base of each caster: 8 jittered steps with no filter leave visible noise. The iPad did not run. S3's advice: march only where the cascade says lit, and fix the noise.

## Options

### Where the march runs

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: in the lit shader, at every pixel, as D-53 ruling 6 said | Filament | Rejected. It failed S3's rule on the S25 by 30 to 50%. A gate on the cascade helps only where shadows already fall. Each pixel also pays the steps' reads in the heaviest shader of the frame |
| B: in ambient occlusion's half-size steps, into a channel of its screen texture | This design | Chosen. A quarter of the marches. The opaque pass reads the result with reads it makes already, so the lit shader gains one multiply |
| C: Bend Studio's compute pass, which marches along the light's lines on the screen with shared memory | Days Gone, Unreal Engine 5 | Rejected for now. It needs compute shaders, so WebGL2 needs a second technique. It also needs a resolved full-size depth, which costs a resolve on tile GPUs |

Option B marches at half the render size each way. The depth-aware read that ambient occlusion uses takes the result to the full size, so a contact shadow keeps to its own surface at depth edges. The march starts from the depth copy's own surface at each texel, so it agrees with the depth it steps through. That leaves fewer false hits than a march from the full-size pixel.

The cascade gate of option A cannot run in option B: the half-size step does not know the shadow map's result. The march runs at every texel instead, at a quarter of the pixels.

### The depth

Contact shadows read ambient occlusion's depth step: the depth prepass's depth, copied at half size into `r32float`. WebGL2 draws the depth prepass on every preset already ([D-43](D-43-webgl2-prepass.md)). On WebGPU, contact shadows turn it on while they draw, as ambient occlusion does. Prototype S3 recommends a separate depth pass at half size for ambient occlusion. If that pass replaces the copy, contact shadows read it the same way.

### The steps that run

| Ambient occlusion | Contact shadows | Steps |
| --- | --- | --- |
| On | On or off | Depth copy, horizon search, denoise. The horizon step also marches, or writes 1 when contact shadows are off. The denoise blurs both |
| Off | On | The same three steps. The horizon step skips its search and writes no occlusion. The denoise blurs the contact shadows alone |
| Off | Off | None, and no prepass on WebGPU |

The contact-only mode needs no new pipeline: the steps' shaders skip the occlusion by a value in their uniform block. The horizon step's target holds the occlusion, the normal's x and y, and the contact shadows. The normal faces the camera, so the denoise rebuilds its z from x and y.

A first version marched in the denoise, and ran only the depth copy and the denoise without ambient occlusion. Its shadows had ragged, noisy edges, as the march's noise had no blur after it ([The noise](#the-noise)).

### The shared screen texture

The coordinator ruled on 11 October 2026 how the features share ambient occlusion's screen texture. D-134 holds the same rule.

| Channel | Value | Neutral value |
| --- | --- | --- |
| x | Ambient occlusion | 1 |
| y | The depth of the texel's surface | 0 |
| z | The length of the reflected ray of screen-space reflections | 0, no hit |
| w | The share of the sun's light that contact shadows let through | 1 |

- The trace step of screen-space reflections runs first and writes z. It passes x, y and w through, or writes their neutral values.
- Ambient occlusion's denoise runs last, also when only contact shadows draw. It writes x, y and w, and copies z through unchanged. Before reflections merge, it writes z = 0.
- When ambient occlusion and contact shadows are off, the reflections' step writes last and leaves x, y and w neutral.
- The blank texture, which the opaque pass binds while the steps draw nothing, holds the neutral values. A frame that reads it before the steps' pipelines build keeps every light.
- The frame's `occlusion` values keep their meaning: x is ambient occlusion's strength, 0 when it is off. z and w describe the texture's grid while any step draws, and the opaque pass reads the texture only then.

### The march

From the surface at each texel, a ray goes toward the sun for `contactDistance` meters. A ray toward the camera stops short of the camera's plane. The ray's two ends project onto the screen. The march takes its steps between them, where the depth value changes linearly, so each step's depth is exact.

- A step is in shadow when the ray lies behind the depth copy's surface by more than a bias and less than a thickness. The bias is 0.4% of the surface's distance from the camera. The thickness is half the reach, so a ray behind a thin pole does not stay in shadow.
- The depth copy holds each texel's depth at one point, its center. A step between two centers compares the ray with the depth that the start texel's slope predicts at the step's own point. The slope comes from the start's nearer neighbour on each axis, so an object's edge does not bend it. Without this, flat ground seen at a low angle shaded itself in rows of dots: on the Mac, the walking demo's far ground changed in 31% to 49% of its pixels, and the morph test's eggs gained dots along their sides.
- Interleaved gradient noise jitters each texel's steps. The denoise then blurs them ([The noise](#the-noise)).
- A hit's shadow fades over the last half of the reach, so each shadow ends softly.
- Shadows fade over the last 5% of the screen at each edge, where rays leave the depth copy.
- Every texel runs the same steps. A loop whose count differs between the pixels of a work group runs wrongly on Adreno 830's driver, as the cascades' code notes.

### The noise

Each texel starts its march at its own jittered point. Without a blur, the edges of the shadows are ragged: in the stone garden demo's low sun, each pebble's long contact shadow had a fringe of dots along its sides (12 October 2026). The four depth-aware reads of the opaque pass blend only neighbouring texels, which is too little.

| Option | Verdict |
| --- | --- |
| Leave the noise | Rejected by the coordinator on 12 October 2026. The engine's default must be the best technique, and the noise shows in every scene that uses contact shadows |
| More steps, or no jitter | Rejected. Without jitter, the shadows' ends step in bands one step long. 16 steps cost 0.2 ms more than 8 on the Mac at 1080p, and their jitter still needs a blur |
| A wider read in the opaque pass | Rejected. Every pixel of the render size would pay the reads, in the heaviest shader of the frame |
| Blur in ambient occlusion's denoise | Chosen. The horizon step marches, and the denoise's 16 taps, which three.js's denoise reads already, blur the result |

The blur keeps to the surface: a tap counts by its distance from the surface's plane, within 1% of the surface's distance from the camera, and by its normal. A pebble's taps then stay off the ground around it, so the shadow does not bleed onto the pebble or its edge onto the ground. It uses none of the occlusion's other weights, as those keep the noise. Without ambient occlusion, the frame runs the horizon step too, which costs one more pass over half the render size ([Cost](#cost)).

### Spot lights

Contact shadows draw for the main directional light alone. A spot light needs its own march, from each surface toward its position, and its own channel in the screen texture. The opaque pass would then need to tie that channel to one light in the clustered loop. The texture has no channel left. Rejected for now.

## API

- `shadow: { contactDistance }` on directional lights, and `setShadow({ contactDistance })`: the reach in meters, at least 0. 0 turns them off for that light. The default is 0.3, Filament's default.
- The `contactShadowSteps` quality setting: 0, 4, 8 or 16 steps per march. It changes during play.

| Preset | WebGPU | WebGL2 |
| --- | --- | --- |
| Low | 0 | 0 |
| Medium | 0 | 4 |
| High | 8 | 8 |
| Ultra | 16 | 16 |

WebGL2 draws the depth prepass on every preset, so its Medium pays only the copy and the march. On WebGPU, Medium would also pay the prepass. Phones start at Low and take none, unless a page asks for a heavier preset. Desktops on WebGL2 stop at Medium, so they take 4 steps there. WebGPU's compatibility mode stops at Medium too, and takes none.

## The governor

The governor's last step lowers the steps to 4. It comes after the steps of ambient occlusion and screen-space reflections, and only while the main directional light casts shadows. Contact shadows cost less than ambient occlusion, and they show more where they draw.

## Cost

The contact cost spec (`tests/image/contact-cost.spec.ts`) times the effect cost page's contact scene with contact shadows off and on, in turns, three times each. It ran on the Mac (Apple M5 Max, Chrome) in a quiet window on 13 October 2026, with the blur, at 1920 x 1080 with a pixel ratio of 1, at loads of 3.4 to 6.1. The figures are the medians of the GPU time per frame, in ms. The scene is small, so the prepass costs almost nothing in it.

| GPU path | Steps | Off, scale 1 | On, scale 1 | Off, scale 0.5 | On, scale 0.5 |
| --- | --- | --- | --- | --- | --- |
| WebGPU | 4 | 1.245 | 2.163 (+0.92) | 1.049 | 1.573 (+0.52) |
| WebGPU | 8 (High) | 1.245 | 2.228 (+0.98) | 1.049 | 1.638 (+0.59) |
| WebGPU | 16 (Ultra) | 1.245 | 2.425 (+1.18) | 1.049 | 1.638 (+0.59) |
| Compatibility mode | 4 | 1.114 | 2.097 (+0.98) | 0.786 | 1.311 (+0.53) |
| WebGL2 | 4 (Medium) | 2.691 | 3.640 (+0.95) | 1.750 | 2.286 (+0.54) |
| WebGL2 | 8 (High) | 2.688 | 3.709 (+1.02) | 1.751 | 2.328 (+0.58) |
| WebGL2 | 16 (Ultra) | 2.724 | 3.867 (+1.14) | 1.751 | 2.403 (+0.65) |

- Most of the cost is fixed: the depth copy, the horizon step and the denoise, each a pass over half the render size. 16 steps add 0.2 ms to 8 at scale 1.
- The blur costs about 0.4 ms at scale 1 and 0.2 ms at scale 0.5. The same spec without the blur, on 12 October 2026 at loads of 5 to 8, gave +0.52 ms for 4 and 8 steps on WebGPU at scale 1 and +0.33 ms at scale 0.5. That version ran one pass less without ambient occlusion, and its denoise did not blur.
- With ambient occlusion on, contact shadows add no pass: the horizon step marches and the denoise blurs within the passes that ambient occlusion runs anyway.
- With the prepass kept on for both sides (`?prepass=on`), WebGPU gave the same figures, except 8 steps at scale 1: +1.05 ms. So in this scene the prepass costs nothing that the timer sees. In a scene of many vertices, it costs a second pass over them ([quality presets](../../docs/concepts/quality-presets.md#the-depth-prepass)).
- The CPU time did not change: under 0.03 ms either way.
- `bun run bench:gpu-check` passed on the same day: S4 at High went from 3.97 to 4.79 ms of GPU time (+21%), under the check's limit of 25%. S4 at Medium and S6 at both presets did not change.
- Prototype S3's inline march cost 0.41 to 0.48 ms on the same Mac at 3,024 x 1,520, without a blur. On the S25 the inline march cost 2.2 ms at scale 1, so the march is dear there. Only the S25's figure can show what the half-size steps cost there.
- Medium on WebGPU stays at 0 steps (the coordinator's request of 11 October). Even 4 steps cost 0.92 ms on the Mac at 1080p, which is over the 0.5 ms that S3's rule allows on the S25, before the prepass of a heavy scene.
- The S25 figure at High follows the next cloud sitting.

## Budgets

The figures compare this branch's build with main's (be8606696), on 12 October 2026, after Brotli.

- JavaScript: one light option, one quality setting and one governor step. The sketch runner grows by 175 bytes, the page by 29 and the core's glue by 23.
- WebAssembly: the steps' mode and their uniform values. The threaded core grows by 290 bytes and the single-threaded core by 638 (1.7 KB before compression).
- Shaders: the march sits in ambient occlusion's first-use shader file, which loads only when ambient occlusion or contact shadows first draw. It grows by 982 bytes in WGSL, to 4.2 KB, and by 956 in GLSL, to 4.4 KB. A first-use shader file may take 32 KB. The lit shader's start files gain the read of the fourth channel: 94 bytes in WGSL and 114 in GLSL.
- No file passed its budget. The two ambient occlusion shader files grew by 28% and 31%, more than the size check allows without a reason. A `Size-Growth` trailer names them, with the march as the reason.

## Allocation

The engine's code allocates nothing per frame for contact shadows. On WebGPU, though, the browser makes an encoder object for each render pass. With ambient occlusion off, contact shadows add four render passes: the depth prepass's own pass, the depth copy, the horizon step and the denoise. `bench/allocation.ts` allows 5 x 64 bytes more in scenes whose sun casts shadows, at bloom's allowance per pass, from the figures below. With ambient occlusion on, contact shadows add no pass. WebGL2 makes no such objects.

On 13 October 2026, `bun run bench:allocation --scene s4` ran on this branch and on main in turns, at loads of 22 to 27. The WebGPU replay allocated 656 to 674 bytes per frame on the branch, and 344 to 353 on main. So contact shadows add 310 to 330 bytes per frame. The first allowance, 4 x 64, came from a version without the blur, whose contact-only mode ran one pass less. Main itself is over its budget of 320 in that sample, and with `--ao` alone it allocates 508 to 509 bytes per frame against 320. The coordinator made main's replay excess a task of its own (M2-R32). S4 on WebGL2 and S1 with `--batch-shadows --ao` on both paths passed.

The same check found that `post.set` boxed ambient occlusion's intensity on every call, on main as well. It read each group's numbers by keys from a list. It now reads each setting by its own name ([the implementation notes](../implementation-notes.md#hot-paths-without-allocation)).

## three.js

three.js draws no contact shadows. Ports get them on High and Ultra with no change, as D-53 ruling 6 says. drei's `ContactShadows` component is another technique: a blurred shadow on a ground plane, drawn from below. It has no null3D equivalent, and the sun's contact shadows do not replace it.

## Tests

- Image tests: `contact-shadows`, `-ao`, `-steps-4`, `-off` and the stone garden demo, on all three GPU paths, with references in both sets. On 12 October 2026, after the blur, the full runs gave 981 passes on the Mac's GPU and 991 on SwiftShader. The changed images were the garden demo, the creek demo's grass and the grass rows, where objects meet the ground. Each was checked by eye and accepted, and a rerun of those tests passed 40 of 40 in each set.
- The frame graph's unit tests check that contact shadows alone run ambient occlusion's three steps.
- The governor's unit tests check its step that lowers the steps.
- `cargo test --workspace`: 1,195 pass, 0 fail. `bun run test`: all pass once the Mac's load allowed the timed tests to finish.

### Checks before landing on 13 October 2026

The branch merged main through `8055ac743`. Its build, size check, lint and type check passed. Unit tests passed 2,823 cases and skipped 33.

The affected image tests passed all 71 cases on the Mac's GPU and all 71 on SwiftShader. This includes every changed reference and S5. S5's Mac references still matched, so only its SwiftShader reference changed.

The quality and stats browser tests passed 76 cases on the Mac's GPU. SwiftShader passed 73 and skipped three pipeline warm-up cases. The stats checks included the production build.

## Addendum, 20 October 2026: masked surfaces and the screen texture

The owner saw dark, blocky streaks on the Creek's flower petals. The petals are masked, double-sided cards (a cutoff of 0.5). The depth prepass leaves out every draw that discards by its alpha or by a fading level's dither (`DrawKey::prepass`). So the half-size screen texture of ambient occlusion and contact shadows holds the grass behind each petal, with the grass's contact shadows. The petal still read that texture. No texel lay within 3% of the petal's depth, so the nearest texel in depth spoke for it ([D-21](D-21-effect-chain.md#ambient-occlusion)), and the petal took the grass's darkening in blocks of the texture's texels. A petal against the sky read empty texels and looked clean.

The rule now: a surface that the prepass leaves out, the ALPHA_MASK builds (the hashed and covered builds carry that bit) and the LOD_FADE builds, takes no screen values and no reflection hit where no texel lies at its depth. A masked surface that lies at a texel's depth, such as a leaf on the ground, still takes the texel's values. Surfaces in the prepass keep the nearest texel for their thin edges. Surfaces that let light through count as blended and take none, as before. The cost is a choice in `screen_read` (`lib/gtao.wgsl`), fixed by the build.

The image test `alpha-mask-ao` guards it. A masked card stands 0.35 m to 0.65 m in front of thin blades, about 2 m from the camera, with ambient occlusion and contact shadows on. The gap is 15% or more of the card's depth, past the 3% within which a texel speaks for it. Its references show the card evenly lit, with no blocks. No other image test moved with this rule, on the Mac's GPU or on SwiftShader: the `alpha-*`, `ao-*`, `contact-shadows*`, `shadows-contact*` and `lod-fade*` tests kept their pictures.
