# D-135: Contact shadows

Status: decided by the helper of M2-F12 on 11 October 2026, for the owner's review. It changes where [D-53](D-53-technique-defaults.md) ruling 6 runs the march: at ambient occlusion's half size, not in the lit shader. Date: 2026-10-11. Task: M2-F12.

Summary: The main directional light draws contact shadows: short shadows found in the camera's depth, which close the lit gap that the cascades leave where small objects meet the ground. Ambient occlusion's last half-size step marches them toward the sun through its depth copy and writes them in the fourth channel of its screen texture. The opaque pass reads that channel with the four reads it already makes for ambient occlusion, and multiplies the sun's light by it. `shadow: { contactDistance }` sets the reach (0.3 m by default), and the `contactShadowSteps` quality setting sets the steps: 8 on High, 16 on Ultra, 4 on WebGL2's Medium, none on Low.

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
| B: in ambient occlusion's last half-size step, into a channel of its screen texture | This design | Chosen. A quarter of the marches. The opaque pass reads the result with reads it makes already, so the lit shader gains one multiply |
| C: Bend Studio's compute pass, which marches along the light's lines on the screen with shared memory | Days Gone, Unreal Engine 5 | Rejected for now. It needs compute shaders, so WebGL2 needs a second technique. It also needs a resolved full-size depth, which costs a resolve on tile GPUs |

Option B marches at half the render size each way. The depth-aware read that ambient occlusion uses takes the result to the full size, so a contact shadow keeps to its own surface at depth edges. The march starts from the depth copy's own surface at each texel, so it agrees with the depth it steps through. That leaves fewer false hits than a march from the full-size pixel.

The cascade gate of option A cannot run in option B: the half-size step does not know the shadow map's result. The march runs at every texel instead, at a quarter of the pixels.

### The depth

Contact shadows read ambient occlusion's depth step: the depth prepass's depth, copied at half size into `r32float`. WebGL2 draws the depth prepass on every preset already ([D-43](D-43-webgl2-prepass.md)). On WebGPU, contact shadows turn it on while they draw, as ambient occlusion does. Prototype S3 recommends a separate depth pass at half size for ambient occlusion. If that pass replaces the copy, contact shadows read it the same way.

### The steps that run

| Ambient occlusion | Contact shadows | Steps |
| --- | --- | --- |
| On | On or off | Depth copy, horizon search, denoise. The denoise also marches, or writes 1 when contact shadows are off |
| Off | On | Depth copy and the last step. The last step writes no occlusion, and binds the depth copy in place of the horizon target |
| Off | Off | None, and no prepass on WebGPU |

The contact-only mode needs no new pipeline: the denoise's shader skips its blur by a value in its uniform block.

### The shared screen texture

The coordinator ruled on 11 October 2026 how the features share ambient occlusion's screen texture. D-134 holds the same rule.

| Channel | Value | Neutral value |
| --- | --- | --- |
| x | Ambient occlusion | 1 |
| y | The depth of the texel's surface | 0 |
| z | The length of the reflected ray of screen-space reflections | 0, no hit |
| w | The share of the sun's light that contact shadows let through | 1 |

- The trace step of screen-space reflections runs first and writes z. It passes x, y and w through, or writes their neutral values.
- Ambient occlusion's denoise, or the contact-only step, runs last. It writes x, y and w, and copies z through unchanged. Before reflections merge, it writes z = 0.
- When ambient occlusion and contact shadows are off, the reflections' step writes last and leaves x, y and w neutral.
- The blank texture, which the opaque pass binds while the steps draw nothing, holds the neutral values. A frame that reads it before the steps' pipelines build keeps every light.
- The frame's `occlusion` values keep their meaning: x is ambient occlusion's strength, 0 when it is off. z and w describe the texture's grid while any step draws, and the opaque pass reads the texture only then.

### The march

From the surface at each texel, a ray goes toward the sun for `contactDistance` meters. A ray toward the camera stops short of the camera's plane. The ray's two ends project onto the screen. The march takes its steps between them, where the depth value changes linearly, so each step's depth is exact.

- A step is in shadow when the ray lies behind the depth copy's surface by more than a bias and less than a thickness. The bias is 0.4% of the surface's distance from the camera. The thickness is half the reach, so a ray behind a thin pole does not stay in shadow.
- The depth copy holds each texel's depth at one point, its center. A step between two centers compares the ray with the depth that the start texel's slope predicts at the step's own point. The slope comes from the start's nearer neighbour on each axis, so an object's edge does not bend it. Without this, flat ground seen at a low angle shaded itself in rows of dots: on the Mac, the walking demo's far ground changed in 31% to 49% of its pixels, and the morph test's eggs gained dots along their sides.
- Interleaved gradient noise jitters each texel's steps. The depth-aware read blends four texels, which softens the jitter's dots.
- A hit's shadow fades over the last half of the reach, so each shadow ends softly.
- Shadows fade over the last 5% of the screen at each edge, where rays leave the depth copy.
- Every texel runs the same steps. A loop whose count differs between the pixels of a work group runs wrongly on Adreno 830's driver, as the cascades' code notes.

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

The governor's last step lowers the steps to 4. It comes after ambient occlusion's step, and only while the main directional light casts shadows. Contact shadows cost less than ambient occlusion, and they show more where they draw.

## Cost

The contact cost spec (`tests/image/contact-cost.spec.ts`) times the effect cost page's contact scene with contact shadows off and on, in turns, three times each. It ran on the Mac (Apple M5 Max, Chrome) in a quiet window on 12 October 2026, at 1920 x 1080 with a pixel ratio of 1, at loads of 5 to 8. The figures are the medians of the GPU time per frame, in ms. The scene is small, so the prepass costs almost nothing in it.

| GPU path | Steps | Off, scale 1 | On, scale 1 | Off, scale 0.5 | On, scale 0.5 |
| --- | --- | --- | --- | --- | --- |
| WebGPU | 4 | 1.245 | 1.769 (+0.52) | 1.049 | 1.376 (+0.33) |
| WebGPU | 8 (High) | 1.245 | 1.769 (+0.52) | 1.049 | 1.376 (+0.33) |
| WebGPU | 16 (Ultra) | 1.245 | 1.966 (+0.72) | 1.049 | 1.442 (+0.39) |
| Compatibility mode | 4 | 1.114 | 1.638 (+0.52) | 0.786 | 1.114 (+0.33) |
| WebGL2 | 4 (Medium) | 2.703 | 3.190 (+0.49) | 1.750 | 2.120 (+0.37) |
| WebGL2 | 8 (High) | 2.684 | 3.266 (+0.58) | 1.748 | 2.142 (+0.39) |
| WebGL2 | 16 (Ultra) | 2.696 | 3.450 (+0.75) | 1.749 | 2.203 (+0.45) |

- Most of the cost is fixed: the depth copy and the contact step, each a pass over half the render size. On WebGPU, 4 and 8 steps cost the same. 16 steps add 0.2 ms at scale 1.
- With the prepass kept on for both sides (`?prepass=on`), WebGPU gave the same figures, except 16 steps at scale 0.5: +0.46 ms. So in this scene the prepass costs nothing that the timer sees. In a scene of many vertices, it costs a second pass over them ([quality presets](../../docs/concepts/quality-presets.md#the-depth-prepass)).
- The CPU time did not change: under 0.03 ms either way.
- Prototype S3's inline march cost 0.41 to 0.48 ms on the same Mac at 3,024 x 1,520. On the Mac, the half-size step costs about as much at less than half those pixels: its two passes cost more than the march saves there. On the S25 the inline march cost 2.2 ms at scale 1, so the march is dear there. Only the S25's figure can show whether the half-size step saves that time.
- Medium on WebGPU stays at 0 steps (the coordinator's request of 11 October). Even 4 steps cost 0.52 ms on the Mac at 1080p, which is over the 0.5 ms that S3's rule allows on the S25, before the prepass of a heavy scene.
- The S25 figure at High follows the next cloud sitting.

## Budgets

The figures compare this branch's build with main's (be8606696), on 12 October 2026, after Brotli.

- JavaScript: one light option, one quality setting and one governor step. The sketch runner grows by 175 bytes, the page by 29 and the core's glue by 23.
- WebAssembly: the steps' mode and their uniform values. The threaded core grows by 290 bytes and the single-threaded core by 638 (1.7 KB before compression).
- Shaders: the march sits in ambient occlusion's first-use shader file, which loads only when ambient occlusion or contact shadows first draw. It grows by 982 bytes in WGSL, to 4.2 KB, and by 956 in GLSL, to 4.4 KB. A first-use shader file may take 32 KB. The lit shader's start files gain the read of the fourth channel: 94 bytes in WGSL and 114 in GLSL.
- No file passed its budget. The two ambient occlusion shader files grew by 28% and 31%, more than the size check allows without a reason. A `Size-Growth` trailer names them, with the march as the reason.

## Allocation

The engine's code allocates nothing per frame for contact shadows. On WebGPU, though, the browser makes an encoder object for each render pass. With ambient occlusion off, contact shadows add render passes: the depth prepass's own pass, the depth copy and the contact step. In `bun run bench:allocation --scene s4` on the Mac, at a load of 11, the WebGPU replay allocated 595 bytes per frame with contact shadows and 342 with every preset's steps at 0. So `bench/allocation.ts` allows 4 x 64 bytes more in scenes whose sun casts shadows, at bloom's allowance per pass. That covers the 253 bytes measured. With ambient occlusion on, contact shadows add no pass: S1 with `--batch-shadows --ao` allocated 652 bytes per frame in the replay with them and 671 without. WebGL2 makes no such objects, and S4 on WebGL2 passed.

## three.js

three.js draws no contact shadows. Ports get them on High and Ultra with no change, as D-53 ruling 6 says. drei's `ContactShadows` component is another technique: a blurred shadow on a ground plane, drawn from below. It has no null3D equivalent, and the sun's contact shadows do not replace it.

## Tests

To be filled: the contact checks of D-16 with contact shadows on, image tests on all three GPU paths in both reference sets, the frame graph's unit tests of the steps that run, and the governor's unit tests.
