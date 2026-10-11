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

WebGL2 draws the depth prepass on every preset, so its Medium pays only the copy and the march. On WebGPU, Medium would also pay the prepass. Phones start at Low and take none, unless a page asks for a heavier preset. Desktops on WebGL2 and WebGPU's compatibility mode stop at Medium, so they take 4 steps there.

## The governor

The governor's last step lowers the steps to 4. It comes after ambient occlusion's step, and only while the main directional light casts shadows. Contact shadows cost less than ambient occlusion, and they show more where they draw.

## Cost

To be filled from this branch's quiet-window runs: the GPU time per frame on the Mac at each preset, with contact shadows on and off, on WebGPU and WebGL2; `bench:gpu-check`; the allocation check; and the size check. The S25 figure at High follows the next cloud sitting.

## Budgets

- JavaScript: one light option, one quality setting and one governor step. To be filled from the size check.
- WebAssembly: the steps' mode and their uniform values. To be filled from the size check.
- Shaders: the march sits in ambient occlusion's first-use shader file, which loads only when ambient occlusion or contact shadows first draw. The lit shader's start file gains the read of the fourth channel.

## three.js

three.js draws no contact shadows. Ports get them on High and Ultra with no change, as D-53 ruling 6 says. drei's `ContactShadows` component is another technique: a blurred shadow on a ground plane, drawn from below. It has no null3D equivalent, and the sun's contact shadows do not replace it.

## Tests

To be filled: the contact checks of D-16 with contact shadows on, image tests on all three GPU paths in both reference sets, the frame graph's unit tests of the steps that run, and the governor's unit tests.
