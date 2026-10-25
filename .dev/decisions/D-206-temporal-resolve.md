# D-206: The temporal resolve's second look, and the techniques that waited on it

Status: decided on 21 October 2026 by task M3-A11 from its own measurements, amended on 24 October 2026 and again on 25 October 2026. The two faults that refused the resolve are fixed, and the engine's own paths pass on both GPU paths with MSAA and one sample. The quality bar of D-129 was then measured on both paths at each preset, and the resolve did not beat the presets, so it does not ship. [D-179](D-179-technique-rulings-2026-10-15.md) leaves TAA to this task, and leaves the many-lights prototype (M3-F3) and the temporal upscaler (M3-F10) to the same answer. The owner may change the ruling. Date: 2026-10-21, amended 2026-10-24 and 2026-10-25. Task: M3-A11, then the capture fix, then the quality measurement.

Summary: The temporal resolve does not ship for 0.1.0. Its two engine-path faults are fixed: a captured frame holds the live image, and the setting turns off and on while the engine runs. The quality bar of D-129 is now measured on both GPU paths at every preset. The resolve adds temporal noise to still thin lines, smears grass that moves by itself, and draws softer and farther from a 64-sample reference than the presets. It costs about 1 ms on WebGPU in light scenes, and 9.1 ms in the Creek on WebGL2. TAA is dropped, not deferred, and with it the shipping of many lights and the temporal upscaler.

## Question

[D-129](D-129-temporal-anti-aliasing.md) refused temporal anti-aliasing for 1.0. It cut the shimmer of the Creek's far grass by 92%. It also drew the scene at 0.55 to 0.75 of a 64-sample reference's sharpness. It smeared swaying grass and water two to three times as much as MSAA, and made thin lines crawl with a still camera. Its first requirement for another attempt was per-object motion vectors. M2-EX25 built them, the grass's wind among them. With those on main, M3-A11 asks: does a temporal resolve now ship for 0.1.0, and with it TAA, the many-lights prototype that needs its noise cleaned up, and the temporal upscaler that keeps MSAA?

## Rule

The resolve ships only if it passes on the engine's real paths and beats what the presets draw today, at a cost that a shipping feature may pay:

- **Shimmer, smear, sharpness and error:** the frames against a 64-sample reference, with the camera still and moving, as D-129 measured them.
- **Cost:** GPU time per frame at each preset tier on both GPU paths, in a busy scene and a light one.
- **The engine's own paths:** a captured frame holds the image the screen shows, so image tests, hold mode and a screenshot see it. A setting may turn on and off while the engine runs.
- The engine's rules for a feature that ships: no allocation per frame, nothing costs anything while it is off, and its shaders load on first use ([AGENTS.md](../../AGENTS.md#hard-rules)).

A "no" drops TAA, M3-F3's shipping and M3-F10, as [D-179](D-179-technique-rulings-2026-10-15.md) rules.

## The prototype

The prototype follows the shape that D-129 described, on the engine's real passes:

- **Offsets.** The camera's projection moves by a part of a pixel each recorded frame, from the Halton sequence of bases 2 and 3 over eight samples.
- **Reprojection.** The motion target gives each surface's own move since the last frame, the grass's wind among it. The camera's part comes from the pixel's depth and the last frame's camera. The pixel's jitter comes off its clip position first, so a still camera reprojects each pixel onto itself.
- **History.** Two kept targets of 16-bit floats take turns by frame number. A copy writes the resolve's result into the history of this frame's parity.
- **Rejection.** The history's alpha holds its surface's distance, and a history from another distance is dropped. Its color is clamped in YCoCg to a box around this frame's 3 x 3 neighborhood. A pixel keeps 90% of the history, less where the brightness changed much.
- **Order.** The resolve runs after the opaque, transparent and subsurface passes and before the fog, the effects, depth of field, bloom and the final pass. The chain after it reads its target in place of the scene color. It reads a multisampled depth as it is on WebGPU, and the copy of one depth sample that WebGL2 keeps. It turns off the still-camera accumulation.
- **Off costs nothing.** The setting was an internal `post.set({ taa: true })`, off on every preset. While off, no pass was declared, no texture was made and its shaders were not downloaded.

In code: `crates/null3d-render/src/taa.rs`, `crates/null3d-shaders/wgsl/taa.wgsl` and `taa_copy.wgsl`, the render graph's three passes, pipeline templates 78 to 80, and two study pages. A "no" lands the measurement and the record alone, so the prototype's code and its pages were not committed.

## How the figures were made

**Cost.** A study page at 1920 x 1080, render scale 1, at Low, Medium, High and Ultra on both GPU paths, in the Creek showcase and in a thin-geometry scene. It played the scene with the resolve off and on in turns, three rounds of 2 seconds each, and reported the medians of GPU time per frame. The WebGL2 path caps its preset at Medium, so its High and Ultra rows ran at Medium.

**Images.** The thin-geometry scene had a near fence, a far fence of 801 pickets, wires, a one-pixel line mesh and two moving boxes. The camera took the pose that the page named, so every run drew the same frames. The page captured 32 poses and read the last 16. The reference drew the same poses at 3840 x 2160 with MSAA, which is 64 samples per pixel. It was shrunk by averaging 4 x 4 blocks in linear light.

## Data

### GPU time per frame, the Creek, 1920 x 1080, on the Mac

The difference of the medians, resolve off and on, in one page:

| Preset | WebGPU | WebGL2 |
| --- | --- | --- |
| Low | 5.77 to 6.49 ms, +0.72 | 8.75 to 11.56 ms, +2.81 |
| Medium | 11.21 to 12.52 ms, +1.31 | 25.29 to 34.40 ms, +9.11 |
| High | 10.75 to 11.93 ms, +1.18 | medium's ceiling: 26.32 to 34.60 ms, +8.28 |
| Ultra | 6.75 to 7.01 ms, +0.26 | medium's ceiling: 22.00 to 26.97 ms, +4.97 |

The thin-geometry scene: WebGL2 0.48 to 1.26 ms, +0.78; WebGPU 0.66 to 0.72 ms, +0.06. Every WebGPU run except Low raised E1305 while the setting toggled, so its figures come from the frames between faults and are a guide, not a clean timing.

### Captured frames

Every captured frame with the resolve on was black, under both MSAA and one sample. A live screenshot of the same page with the resolve on showed the scene. The resolve read the scene color, its depth and its motion target. A build that drew the depth showed the fence, the wires, the boxes and the ground. A build that drew a red placeholder showed that color. Only the scene color came back as its clear color and its alpha, when the engine captured a frame.

The figures that the page computed from those frames are therefore no measure of the resolve, and are not listed.

### Faults that block a release

- **A captured frame is black.** Image tests, hold mode and `bunx @null3d/cli shot` capture a frame, so a resolve that captures black cannot be tested or screenshotted.
- **A live toggle faults on WebGPU.** Turning the resolve off and on while the engine ran destroyed a motion target of 16-bit floats, or the scene depth, in a frame whose submit still used it (E1305). The WebGL2 path toggled without a fault.

## Trade-offs

What the prototype showed:

- **Cost.** On WebGPU it costs about as D-129 expected: 0.3 to 1.3 ms in a busy scene. On WebGL2 at Medium it costs 9.1 ms, far above what a phone can pay.
- **Live image.** The live frame with the resolve looked like the scene, with the fences, the wires and the boxes in place.
- **Off.** With the setting off, no pass, texture or shader downloads.

What it did not show, and why the answer is no:

- **Its own output does not survive a capture**, which is how the engine tests, holds and screenshots an image. That is a fault of the resolve's place in the engine, not of a measurement, and it leaves the D-129 quality bar unmeasured.
- **Its setting cannot be toggled while the engine runs on WebGPU** without a GPU validation fault.
- **The quality bar of D-129 is unmet by measurement.** The blur, the smear and the still-camera crawl may all be better now that the motion vectors exist. This attempt could not show it.

## Decision

1. **The temporal resolve does not ship for 0.1.0.** It does not pass the engine's own paths: a captured frame is black, and a live toggle faults on WebGPU.
2. **TAA is dropped, not deferred.** The mapping says that null3D has no temporal anti-aliasing and that no version plans it. The presets keep FXAA on Low and MSAA 4x from Medium up.
3. **M3-F3 does not ship.** The many-lights prototype is dropped with the resolve that its noise needed ([D-179](D-179-technique-rulings-2026-10-15.md), ruling 15).
4. **M3-F10 is dropped.** There is no temporal upscaler, and the governor's render scale with the final pass's scaling stays the phone speed path (ruling 16).
5. **Motion vectors stay.** They serve the motion debug view and any later attempt, and they cost nothing while nothing reads them.

## Consequences

- **Engine:** no change. The prototype and its study pages were not committed, as a "no" lands the measurement and the record alone.
- **Technique review:** the TAA row and the temporal upscaler rows say dropped.
- **Three.js mapping:** the anti-aliasing rows say that TAA is not planned and that `TRAANode`, `TAAUNode` and `TemporalReprojectNode` have no equivalent. The generated porting guide and the porting skill follow.
- **D-129** carries an addendum that points here. **D-179's** rulings 15, 16 and 24 are settled.
- **A later attempt** starts from three faults before it measures anything: the captured frame, the live toggle on WebGPU, and the quality bar against the material that D-129 defined.

## Addendum, 24 October 2026: the captured frame and the live toggle are fixed

The two faults of this record are fixed, and the engine's own paths pass. The quality bar of D-129 is still unmeasured, and the cost figures stand, so the resolve is reopened for measurement, not yet shipped.

### The cause

The sketch thread records each frame's draw list in one of two slots, by the frame's parity, and the thread that draws replays that slot. A setting that changes the render graph changes the plan's texture list, so the plan makes some targets again. One parity's slot then still holds a list recorded under the older plan while the other parity already holds the newer one. The older list was replayed after the newer plan had made its targets again, so its passes read targets that the plan had cleared or reused. In a capture that is the scene color's clear color and alpha; in the live toggle it was a target, such as the motion target or the scene depth, that the plan had just destroyed in flight.

### The fix

The engine now publishes the plan's texture generation beside each parity's list (`planEpoch`). The frame loop and a capture replay a list only while its generation equals the plan's newest. A list from an older generation is taken without drawing, as the engine already does for a list from an older GPU device, and the canvas keeps its last image until the sketch records that parity again. The engine no longer submits any list recorded for a plan it has replaced.

### The proof

The prototype's code was not kept, as this record's "no" landed the record alone. The fix task rebuilt it from the resolve shader kept with the task and this record's description, on the engine of 24 October 2026. It then ran five browser tests in Chrome on the Mac's GPU:

| Test | Path | Samples | Result |
| --- | --- | --- | --- |
| Captured frame holds the live canvas | WebGPU | MSAA | pass: mean distance 0.00 levels |
| Captured frame holds the live canvas | WebGPU | one sample | pass: mean distance 0.00 levels |
| Captured frame holds the live canvas | WebGL2 | MSAA | pass: mean distance 0.00 levels |
| Captured frame holds the live canvas | WebGL2 | one sample | pass: mean distance 0.00 levels |
| Captured frame holds the live canvas, resolve off | WebGPU | MSAA | pass |

Each test compares the pixels that `captureFrame` read with a screenshot of the live canvas, requires neither to be black, and requires the mean distance of the two to stay under 16 levels of 255. The four resolve-on tests also turn the setting off and on again six times while the engine runs, and each reports no failure: no E1305. The captured frames are pixel-identical to the live canvas.

With the guard removed, the rebuilt prototype still captured correctly on this base, so a later engine change may already hide the original timing. The guard is what makes the result hold by construction, and a unit test (`waits for a list that the plan that draws now recorded, after its targets were made again`) keeps it.

### What stands

- **Cost:** the figures above stand. On WebGL2 at Medium the resolve still costs 9.1 ms, far above what a phone can pay.
- **Quality:** the shimmer, smear and sharpness figures of D-129 are still unmeasured. The engine paths no longer block them.
- **The decision:** TAA, the many lights and the temporal upscaler remain unshipped until the quality bar passes and the owner rules. This addendum reverses the refusal's engine-path clause only.

## Addendum, 24 October 2026: the quality bar is measured, and the resolve does not ship

The engine-path clause passes. This addendum measures the rest of the rule: shimmer, smear, sharpness and error against a 64-sample reference, with the camera still and moving, on both GPU paths at each preset. The resolve does not beat what the presets draw today, so it does not ship.

### How the figures were made

The method is D-129's. Two scenes were drawn:

- **Thin geometry:** a near picket fence of 3 cm pickets, a far fence of 2 cm pickets that are narrower than a pixel, three 1 cm wires, and a line mesh one pixel wide. Two boxes move by themselves when the camera does not.
- **Grass:** 6,000 tufts of curved blades on a bank, with rocks. Each blade bends in its vertex shader from the sketch's frame number.

Each run drew 16 consecutive frames at 960 x 540, frames 12 to 27, at four frames a second so each capture finishes before the next frame. The camera held still, orbited at 0.1 radians per second, or orbited at 0.3. The reference was the same 16 frames at 3840 x 2160 with MSAA 4x, which is 64 samples per pixel, shrunk by averaging 4 x 4 blocks in linear light. Each preset drew its own reference, so its shadow and texture quality could not count as error. Every motion came from the frame number, not the clock, so every run drew the same pictures. Each sequence's record shows the frames consecutive, and a skipped frame failed the run.

The figures are in 8-bit levels of the luma of the displayed color, over the 15 steps between the 16 frames. Shimmer is the change beyond the reference's. Smear is true change that the frames lack. Error is the mean distance from the reference. Sharpness is the frames' mean gradient over the reference's, where 1 is as sharp. Still is the frame-to-frame change where nothing but the resolve moves. The resolve ran on top of each preset's own anti-aliasing: FXAA at Low, and MSAA 4x from Medium up. WebGL2 caps its preset at Medium, so its High and Ultra rows drew at Medium.

Cost ran at 1920 x 1080, render scale 1, at each preset, with the resolve off and on in turns: three rounds of 2 seconds each side, and the medians of GPU time per frame. The Mac had no other heavy job while a figure was taken, and the loads of 4.8 to 8.5 are on each run's line.

### The thin scene, WebGPU

Shimmer / smear / sharpness / error with the camera on its slow orbit, and the still camera's change. The left value is the preset alone, and the right value is with the resolve:

| Preset | Slow orbit, preset | Slow orbit, resolve | Still change |
| --- | --- | --- | --- |
| Low | 1.690 / 0.707 / 1.581 / 3.189 | 3.021 / 0.796 / 1.518 / 3.837 | 0.000 to 4.142 |
| Medium | 0.689 / 0.294 / 1.360 / 1.758 | 1.989 / 0.832 / 1.241 / 3.053 | 0.000 to 2.663 |
| High | 0.736 / 0.309 / 1.364 / 1.892 | 2.044 / 0.844 / 1.245 / 3.176 | 0.000 to 2.704 |
| Ultra | 0.775 / 0.312 / 1.374 / 1.934 | 2.055 / 0.869 / 1.225 / 3.259 | 0.000 to 2.720 |

The brisk orbit tells the same story. At High, the preset's 1.156 / 0.359 / 1.365 / 1.886 became 2.315 / 1.280 / 1.252 / 3.161. The resolve is worse on every measure at every tier.

### The grass bank, WebGPU

| Preset | Slow orbit, preset | Slow orbit, resolve | Still change |
| --- | --- | --- | --- |
| Low | 0.844 / 0.331 / 1.270 / 1.285 | 0.865 / 0.524 / 1.052 / 1.873 | 0.232 to 1.420 |
| Medium | 0.481 / 0.208 / 1.192 / 0.815 | 0.625 / 0.601 / 0.931 / 1.704 | 0.198 to 1.076 |
| High | 0.947 / 0.397 / 1.138 / 1.614 | 0.843 / 0.700 / 0.858 / 2.232 | 0.402 to 1.477 |
| Ultra | 1.149 / 0.484 / 1.117 / 2.035 | 0.950 / 0.850 / 0.812 / 2.668 | 0.507 to 1.694 |

The resolve cuts shimmer only at High and Ultra with the camera moving: 11% at High and 17% at Ultra. At Low and Medium it adds shimmer. It smears 58% to 189% more, draws 17% to 27% softer, and sits farther from the reference in every case. With a still camera it adds 0.9 to 1.2 levels of change where the grass's own wind is the only motion.

### WebGL2

The path caps at Medium, so these rows cover both tiers:

| Scene | Preset | Slow orbit, preset | Slow orbit, resolve | Still change |
| --- | --- | --- | --- | --- |
| Thin | Low | 1.693 / 0.708 / 1.583 / 3.194 | 3.114 / 0.712 / 1.527 / 3.752 | 0.000 to 4.087 |
| Thin | Medium | 0.715 / 0.306 / 1.357 / 1.856 | 2.351 / 0.653 / 1.360 / 3.253 | 0.000 to 2.989 |
| Grass | Low | 0.842 / 0.331 / 1.292 / 1.270 | 0.906 / 0.487 / 1.123 / 1.861 | 0.231 to 1.465 |
| Grass | Medium | 0.784 / 0.319 / 1.195 / 1.277 | 0.782 / 0.600 / 0.946 / 1.931 | 0.324 to 1.337 |

The path's order matches WebGPU's.

### Cost

The GPU time per frame that the resolve adds, in milliseconds, in each scene at 1920 x 1080:

| Scene | Preset | WebGPU | WebGL2 |
| --- | --- | --- | --- |
| Thin | Low | 0.98 | 0.84 |
| Thin | Medium | 1.18 | 1.27 |
| Thin | High | 1.18 | 1.25, drawn at Medium |
| Thin | Ultra | 1.18 | 0.33, drawn at Medium |
| Grass | Low | 0.98 | 0.77 |
| Grass | Medium | 1.18 | 0.41 |
| Grass | High | 1.25 | 0.74, drawn at Medium |
| Grass | Ultra | 1.18 | 0.80, drawn at Medium |

These scenes are light, and their WebGL2 figures vary with the passes that write depth. The Creek's 9.1 ms at Medium stands, and it is the figure that a phone cannot pay. On WebGPU the cost is about 1 ms, which a shipping feature could pay.

### What failed, and by how much

- **Shimmer:** the resolve adds it on the thin scene at every tier and camera. With a still camera the presets change nothing, and the resolve changes 2.66 to 4.14 levels each frame. On the slow orbit it adds 1.8 to 2.9 times the presets' shimmer. On the grass it cuts 11% to 17% at High and Ultra with a moving camera, and adds shimmer at Low and Medium. D-129's bar wanted the large cuts that motion vectors were to bring.
- **Smear:** it rises in every moving case. The thin scene's High row goes from 0.309 to 0.844 on the slow orbit, and the grass's Medium row from 0.208 to 0.601. The grass's wind is a vertex-shader offset, and the per-object motion target does not carry it, so the resolve reads the wrong history where the blades bend. The thin scene's own moving boxes are covered by the motion target, but the geometry's sub-pixel detail still smears.
- **Sharpness:** 0.81 to 1.25 of the reference against the presets' 1.11 to 1.64. The grass loses 15% to 25% of its sharpness.
- **Error:** worse in every one of the 24 thin cases and every grass case. At High on the grass's slow orbit it is 2.23 against 1.61, and on the thin scene 3.18 against 1.89.
- **Still scenes:** the crawl that D-129 refused is still there. On the thin scene the presets draw exactly the same image every frame, and the resolve changes it by 2.7 levels at High.

### Faults found and fixed while measuring

- **The history was sampled in the wrong place.** Each frame's projection moves by a part of a pixel, and the history's pixels hold the surfaces that the last frame's offset put there. The resolve took this frame's offset off the pixel and did not add the last frame's. It read the history a fraction of a pixel from its surface, in a new direction each frame. The frame now carries the last frame's offset and moves its sample by it. The fix cut the thin scene's still change at High from 2.88 to 2.70 levels, but did not remove the crawl.
- **The motion target does not carry a custom material's vertex wind.** D-206's first description said the grass's wind was among the motion vectors. It is not: the motion pass draws the mesh's rest positions, instances, skin and morph, and not the material's vertex offset. The grass's smear is the result. A later attempt needs the motion pass to run the same vertex offset for this frame and the last, or a wind that moves instances instead.
- **The engine paths still pass.** The capture proof (`tests/image/taa-capture.spec.ts`) passes on both paths with MSAA and one sample, and the setting turns off and on while the engine runs.

### Decision

1. **The temporal resolve does not ship.** It loses on shimmer, smear, sharpness and error against what the presets draw today, at every tier on both paths. The presets keep FXAA on Low and MSAA 4x from Medium up, and the preset table is unchanged.
2. **TAA is dropped, not deferred.** The mapping says that null3D has no temporal anti-aliasing and that no version plans it. The three.js rows follow.
3. **M3-F3 and M3-F10 stay dropped.** The many-lights prototype and the temporal upscaler wait on a resolve that does not ship.
4. **The prototype stays behind the internal setting.** It is off on every preset, so it costs nothing while off. The measurement page and the capture proof stay with it, so a later attempt can repeat the figures.
5. **The capture and plan-generation fixes stay.** They serve every feature that records draw lists, not only the resolve.

### What a later attempt needs

1. Motion for vertex-shader wind, either in the motion pass or by moving wind to instance transforms.
2. A rejection that does not drop the history at sub-pixel edges, so still thin lines settle. The neighborhood clamp alone holds them better, but the depth rejection that replaces it is what crawls.
3. A sharper resolve: the grass loses a fifth of its sharpness, and the preset's MSAA is already sharp.
4. Figures from phones, where the WebGL2 cost is the worry.

## Addendum, 25 October 2026: the study's six fixes are built and tested

[D-199](D-199-m4-features-and-study-tasks-in-m3.md) made the study's answers to the D-129 faults into this task's test cases. A review of the branch found one of the six built, five missing, and neither of the jittered effects tested. This addendum records each fix, how it is built, its test, and the figures.

### The six fixes

| Fix | Before | Built in | Test |
| --- | --- | --- | --- |
| Per-object motion exactly 0 for still content | Built by M2-EX25, with no exact proof | `lib/motion_math.wgsl`, `surface_motion` | The shader library's `motion_math::surface_motion` cases, which hold a still surface's motion within a millionth of a pixel; the target clears to zero and still objects draw nothing, which is the exact part |
| A variance box widened to hold the center pixel, against banding | Missing | `lib/temporal.wgsl`, `temporal_widen` | The shader library's `temporal::temporal_widen` cases, which require the center to lie inside the box |
| The history rescaled by the exposure ratio | Missing | `crates/null3d-render/src/frame.rs`, `taa_frame`, and `taa.wgsl` | `tests/image/taa-fixes.spec.ts`, the `exposure` case |
| A reactive mask from the transparent alpha | Missing | `taa.wgsl`, from the scene color's alpha, with `Reactive`'s bits | `taa-fixes.spec.ts`, the `alpha` case |
| An opaque-only color target for the transparency mask | Missing | The `TaaOpaque` copy pass in `crates/null3d-render/src/frame_graph.rs` | `taa-fixes.spec.ts`, the `opaque` case |
| A separate phone variant | Missing | The phone path of `taa.wgsl`, `Taa::phone`, which `post.set({ taa: { phone } })` picks | `taa-fixes.spec.ts`, the `phone` case |

Why each fix is right:

- **Exact zero motion.** A still surface computes this frame's image place less the same place of the last frame, which is zero bit for bit. The motion target clears to zero and the cull keeps only the objects that moved, so a still surface draws nothing at all. Without this, a resolve smears every still pixel.
- **The widened box.** The history is clamped to a box around the neighborhood's mean and spread, inside its smallest and largest values. That box can leave out the pixel's own color, and the clamp then pulls the history away from this frame each frame, which shows as banding on a lit gradient. The box now grows to hold the center color, and no edge moves otherwise.
- **The exposure ratio.** The lit pass scales every color by the camera's exposure, so a history written under one exposure holds other numbers than this frame's colors. The frame now carries this frame's exposure over the last frame's, and the resolve scales the history by it before the blend.
- **The transparent alpha.** The scene color's alpha holds a blended surface where the canvas shows through. The resolve lowers the history there, shaped as FSR2 shapes it: the history's share falls by the mask's value.
- **The opaque-only copy.** A blended surface over an opaque one leaves the scene alpha at one, so the alpha carries nothing. A copy of the scene color after the opaque pass, and before the blended pass, gives the comparison that finds it: where the composited color differs from the copy beyond a small threshold, a blended surface drew, and the history falls. The copy draws whenever the resolve does, not only while a scene blends, so the texture that the resolve reads is always the copy. A unit test (`the_resolve_copies_the_opaque_color_before_a_blend_draws`) holds the copy before the blended pass and the resolve after it.
- **The phone path.** It reads one depth sample where the scene depth is multisampled, samples the history with four `textureLoad` taps rather than the linear sampler, and skips both transparency signals and the brightness weighting: the shader masks the signal bits with the phone flag. It keeps the same pipelines, so turning it on builds nothing of its own. The prototype turns it on with a setting. A shipping version would pick it at the Low preset that a phone's measured speed selects, never from a device name (hard rule 14). The phone test proves the skip: it draws the phone path with the masks off and on, and requires the same picture.

null3D keeps one scene color target. The study's engine writes a transparent surface's alpha into a second attachment, which null3D does not have. The two transparency signals here therefore read the alpha where the canvas shows through and the opaque-only copy everywhere else. The two tests cover the two signals apart.

### Fog jitter and thin rain

Both effects already exist. The volumetric fog moves its grid by a sub-pixel offset each frame, and the rain's streaks are thinner than a pixel. Neither had a test with the resolve. `tests/pages/sketches/taa-fixes-sketch.ts` draws both at 320x180, and `taa-fixes.spec.ts` measures the frame-to-frame change with the resolve off and on. The figures are below.

The quality figures of the previous addendum were taken before these five fixes. They still describe the prototype as it stood, and the fixes may move them, most of all the still camera's crawl and the grass's smear. The decision stands, because it rests on the cost of the WebGL2 path and on the resolve losing on shimmer, smear and sharpness before these fixes were in.

### The tests

| Test | What it proves |
| --- | --- |
| `cargo test -p null3d-render` | The crate's own tests pass: 463 in the lib unit target, 2 of them ignored, and 915 across its 61 test binaries |
| `tests/lib/shader-library.test.ts` | The numbered cases, the variants and the references agree |
| `tests/image/shader-library.spec.ts`, on WebGPU, compatibility mode and WebGL2 | `motion_math::surface_motion` gives exactly zero for a still surface, and `temporal_widen` holds the center pixel |
| `tests/image/taa-fixes.spec.ts`, `a history follows a change of the exposure` | A resolved frame holds the scene at a doubled exposure |
| `tests/image/taa-fixes.spec.ts`, `the scene's alpha lowers the history` | The alpha signal keeps the background out of a blended surface's history |
| `tests/image/taa-fixes.spec.ts`, `the opaque-only copy lowers the history` | The opaque-only comparison's figure on the transparent-canvas scene, recorded rather than required |
| `tests/image/taa-fixes.spec.ts`, `the phone path draws the full path's picture` | The phone path draws the same still image, and the mask setting changes it by 0.00 levels, which proves the skip |
| `tests/image/taa-fixes.spec.ts`, `the resolve over rain` and `over fog` | The frame-to-frame change of each effect with the resolve off and on |

### How the figures were made

`tests/pages/sketches/taa-fixes-sketch.ts` draws six scenes at 320 x 180, with one world unit per pixel:

- `exposure`: fine noise across the view, lit by one ambient light. The camera is still and the resolve runs with its offsets. The page lets the history settle at an exposure of 1, then doubles it and captures the next frame. The same scene with the resolve off, at the doubled exposure, is the reference.
- `alpha`: a transparent canvas with no background, and a blended noise plane at half opacity. A blended noise square jumps from one side of the view to the other.
- `opaque`: the same square over a flat opaque background, which a page can open by hand. The opaque-only figure in the table comes from the `alpha` scene, where the copy differs from the composited color wherever a blended surface draws.
- `phone`: a still textured scene, drawn once by the full path and once by the phone path, both with no offsets.
- `rain`: 6,000 thin additive streaks, thinner than a pixel.
- `fog`: a volumetric fog over towers, whose grid the engine moves by a sub-pixel offset each frame.

Each figure is the mean over the whole frame, or over a stated region, in 8-bit levels of the displayed color's luma. The exposure error is the resolved frame's mean less the reference's. The transparency figures are the mean distance from the reference over the square's new place, so a history that kept the background shows as a large figure. The phone figure is the mean distance between the two paths. The effect figures are the mean frame-to-frame change over 16 consecutive frames, each drawn by its own capture.

### Figures

Levels of the displayed color, on the Mac's GPU in Chrome 155. Each row compares one setting with its own baseline.

| Measure | WebGPU | WebGL2 |
| --- | --- | --- |
| Exposure: the resolved frame's mean against the reference's | 91.3 against 80.6, error 10.7 | 91.6 against 80.8, error 10.7 |
| The scene's alpha: error with the mask, without it | 9.5, 24.1 | 9.7, 24.1 |
| The opaque-only copy, on the `alpha` scene: error with the signal, without it | 24.4, 24.1 | 24.4, 24.2 |
| The phone path against the full one: mean distance | 2.84 | 3.00 |
| Thin rain: frame-to-frame change without the resolve, with it | 2.617, 13.575 | 2.606, 13.702 |
| The volumetric fog: frame-to-frame change without the resolve, with it | 0.421, 0.456 | 0.671, 0.742 |

What the figures say:

- **The exposure ratio.** With the ratio, a resolved frame holds the scene at the doubled exposure. The resolve's smoothing moves its mean about a tenth above the plain frame's, which the tone curve makes visible on fine noise. The figure moves with the frame that a capture lands on, so the test holds the resolved mean above 60% of the reference's and the error within 30 levels. Arithmetic puts a history without the ratio at about half the old exposure, about 36 levels low here; that figure is arithmetic, not a run, because the resolve has no switch that turns the ratio off.
- **The scene's alpha.** The alpha signal cuts the background that a blended square keeps in its history from 24.1 levels to 9.5, and to 9.7 on WebGL2. It works on both paths.
- **The opaque-only copy.** The signal does not change the transparent-canvas scene: 24.4 levels against 24.1. The copy's place, before the blended pass, and its bind group are held by a unit test, but the comparison's effect is not measured here. This is owed.
- **The phone path.** It draws the full path's picture within 3 levels, and the mask setting changes its picture by 0.00 levels on both paths, because it reads neither transparency signal.
- **Thin rain.** The resolve makes the frame-to-frame change five times larger. The streaks are a blended draw with no motion target, so the resolve reads their history from the wrong place. The comparison is not confounded by the offsets: the engine jitters the camera only while the resolve draws, and the page runs the resolve off with the offset request on as well, whose figure matches the off run within a hundredth of a level (the test asserts it).
- **The volumetric fog.** The resolve changes almost nothing: the fog's own grid offset moves too little for the resolve to help or hurt. The fog's figure is a recorded observation; the test does not require its direction.

### The GPU time

`bun run bench:gpu-check` compared the branch with main's merge base, commit 9369b1380, in Chrome on the Mac's GPU. It did not judge the comparison, because the benchmark pages differ between the two commits. Its figures: S4 at medium 4.26 to 4.28 ms (+0.6%), S6 at medium 4.74 to 4.52 ms (-4.9%), S4 at high 4.44 to 4.44 ms (-2.3%) and S6 at high 4.79 to 5.14 ms (+7.3%). The resolve is off on every preset, so a page draws it only where a sketch turns it on, which no benchmark scene does. The figures are therefore noise in the comparison rather than the resolve's cost, and all four sit under the 25% GPU gate.

### The silent stand-in

The resolve binds a stand-in texture when the opaque-only copy has no planned id. `crates/null3d-render/src/frame_graph.rs:4966` takes the copy's sampled id and falls back to zero, and `crates/null3d-render/src/taa.rs:385-391` binds the parity-0 history in its place. The shader compares the composited color with whatever sits at binding 7, and `wgsl/taa.wgsl:243` reads only the signal bits, so a missing copy does not fail: the resolve quietly compares the frame with its own history and returns a small, plausible figure. The block's second signal field was meant to report whether the copy is bound, but `crates/null3d-render/src/taa.rs:464` writes it as one and no shader reads it.

The copy is declared whenever the resolve draws (`frame_graph.rs:3035`), so its id should exist on every frame that reads it. The stand-in is a leftover from when the copy depended on a blended surface drawing, and the comment above it still says so. It should refuse to draw rather than substitute: `upload_taa` should fail when the signals ask for the comparison and no copy is planned, because a figure taken from a fallback is exactly the failure that the rules against silent failures exist to prevent. The third of a level that the transparent scene moved may be such a figure, and the opaque-wall test decides.

### The decision

The 21 October ruling stands: the resolve does not ship for 0.1.0, TAA is dropped rather than deferred, and the many-lights prototype (M3-F3) and the temporal upscaler (M3-F10) stay dropped with it. These fixes do not change that ruling. They answer the D-129 faults and make a later attempt cheaper to measure. The ruling rests on cost first: the WebGL2 path costs several times what a phone can pay in a busy scene, and this addendum adds one more cost it does not measure, the phone path's own GPU time, which stays the open figure.

### What a later attempt still needs

The fixes answer the faults of the prototype. They do not answer the three that the previous addendum named: motion for a vertex-shader wind, a rejection that keeps sub-pixel edges, and a sharper resolve. The figures of this addendum also do not include phones, and the resolve is still off on every preset.

Two things are owed here. The opaque-only comparison's effect is not measured: its test records the figure and asserts only that the run drew the scene. The copy's order and its bind group are held by the unit test `the_resolve_copies_the_opaque_color_before_a_blend_draws`, so the remaining work is a scene in which the comparison's effect shows. The task's finish line does not name that comparison, so the signal stays as it is. The rain also needs motion for a blended draw before a resolve can help it.

A later attempt starts from the measured figures above and from these items.
