# D-206: The temporal resolve's second look, and the techniques that waited on it

Status: decided by task M3-A11 from its own measurements. The engine's own paths pass on both GPU paths with MSAA and one sample. The six fixes that D-199 made test cases are built, and each has a test that fails without it. Against D-129's quality bar the resolve still loses, at every preset on both paths, so it does not ship. TAA, the many-lights prototype (M3-F3) and the temporal upscaler (M3-F10) are dropped with it ([D-179](D-179-technique-rulings.md), rulings 15, 16 and 24). The owner has ruled that the engine carries on without them, and no scene that ships depends on any of the three. Task: M3-A11.

Summary: The temporal resolve does not ship for 0.1.0. It adds noise to still thin lines and smears grass that moves by itself. It draws softer and farther from a 64-sample reference than the presets. It neither cleans up thin rain nor reaches the fog. It adds 1.4 to 2.0 ms on WebGPU in the thin scene and 5.1 to 5.8 ms at WebGL2's Medium. TAA is dropped with the shipping of many lights and the temporal upscaler.

## Question

[D-129](D-129-temporal-anti-aliasing.md) refused temporal anti-aliasing for 1.0. It cut the shimmer of the Creek's far grass by 92%. It also drew the scene at 0.55 to 0.75 of a 64-sample reference's sharpness. It smeared swaying grass and water two to three times as much as MSAA, and made thin lines crawl with a still camera. Its first requirement for another attempt was per-object motion vectors. M2-EX25 built them, and M2-F11 built still-camera accumulation. With them on main, M3-A11 asks whether a temporal resolve now ships for 0.1.0. It also asks whether TAA, the many-lights prototype that needs its noise cleaned up, and the temporal upscaler that keeps MSAA ship with it.

## Rule

The resolve ships only if it passes on the engine's real paths and beats what the presets draw. It also needs a cost that a shipping feature may pay:

- **Shimmer, smear, sharpness and error:** the frames against a 64-sample reference, with the camera still and moving, as D-129 measured them.
- **Cost:** GPU time per frame at each preset tier on both GPU paths, in a busy scene and a light one.
- **The engine's own paths:** a captured frame holds the image the screen shows, so image tests, hold mode and a screenshot see it. A setting may turn on and off while the engine runs.
- The engine's rules for a feature that ships: no allocation per frame, and nothing costs anything while it is off. Its shaders load on first use ([AGENTS.md](../../AGENTS.md#hard-rules)).

A "no" drops TAA, M3-F3's shipping and M3-F10, as [D-179](D-179-technique-rulings.md) rules.

## The prototype

The prototype follows the shape that D-129 described, on the engine's real passes:

- **Offsets.** The camera's projection moves by a part of a pixel each recorded frame, from the Halton sequence of bases 2 and 3 over eight samples.
- **Reprojection.** The motion target gives each surface's own move since the last frame: its rest positions, instances, skin and morph. It carries a custom material's vertex offset that reads the frame's clock, the grass's wind among it ([D-140](D-140-motion-vectors.md)). The camera's part comes from the pixel's depth and the last frame's camera. The pixel's jitter comes off its clip position first, and the frame carries the last frame's offset and moves the history sample by it. So a still camera reprojects each pixel onto the surface that the history holds there.
- **History.** Two kept targets of 16-bit floats take turns by frame number. A copy writes the resolve's result into the history of this frame's parity.
- **Rejection.** The history's alpha holds its surface's distance, and a history from another distance is dropped. Its color is clamped in YCoCg to a box around this frame's 3 x 3 neighborhood. A pixel keeps 90% of the history, less where the brightness changed much.
- **Order.** The resolve runs after the opaque, transparent and subsurface passes and before the fog, the effects, depth of field, bloom and the final pass. The chain after it reads its target in place of the scene color. It reads a multisampled depth as it is on WebGPU, and the copy of one depth sample that WebGL2 keeps. It turns off the still-camera accumulation.
- **Off costs nothing.** The setting is an internal `post.set({ taa: true })`, off on every preset. While off, no pass is declared, no texture is made and its shaders are not downloaded.

In code: `crates/null3d-render/src/taa.rs`, `crates/null3d-shaders/wgsl/taa.wgsl` and `taa_copy.wgsl`, the render graph's four passes, pipeline templates 80 to 82, the measurement pages (`tests/pages/taa-quality.html`, `taa-fixes.html` and `taa-creek-cost.html`) and the capture proof (`tests/image/taa-capture.spec.ts`).

## The six fixes of D-199

[D-199](D-199-m4-features-and-study-tasks-in-m3.md) made the study's answers to the D-129 faults into this task's test cases. Each is built and each has a test that fails without it.

| Fix | What it does | Test | Result |
| --- | --- | --- | --- |
| Exact zero motion for still content | A still surface's motion is the difference of two equal places, and the target clears to zero, so nothing smears a still pixel | The shader library's `motion_math::surface_motion` cases, on WebGPU, compatibility mode and WebGL2 | Passes: the difference stays within a millionth of a pixel |
| A history box widened to hold the center pixel | The neighborhood clamp cannot pull the history away from this frame, which shows as banding on a lit gradient | The shader library's `temporal::temporal_widen` cases | Passes: the center lies inside the box |
| The history scaled by the exposure ratio | A history written under one exposure matches this frame's colors | `taa-fixes.spec.ts`, the exposure case | The resolved mean is 88.8 against 80.6 on WebGPU and 89.1 against 80.8 on WebGL2; without the ratio, 66.4 and 66.7. The switch moves the frame 22.4 levels |
| A transparency mask from the scene's alpha | A blended surface over the canvas lowers its history | `taa-fixes.spec.ts`, the alpha case | 24.4 levels of kept background without the mask on WebGPU and 24.3 on WebGL2; 7.1 with it on both paths |
| An opaque-only color copy | A blended surface over an opaque surface is found by comparing this frame's color with the copy from before the blended pass | `taa-fixes.spec.ts`, the opaque case | 18.6 levels with the comparison against 30.8 without on WebGPU, and 18.8 against 30.9 on WebGL2 |
| A cheaper phone path | One depth sample, four history taps, no transparency signals and no brightness weighting | `taa-fixes.spec.ts`, the phone case | The two paths differ by 0.85 levels on WebGPU and 0.77 on WebGL2; the mask moves the full path 10.26 and 10.02 levels and the phone path 0.00 |

The first two fixes are functions of the shader library, so their tests hold the functions rather than the resolve's use of them. The other four are measured through the resolve.

The opaque-only copy's test needed a scene where the square draws in front of the wall. The copy's comparison then cuts the kept wall from 30.8 levels to 18.6. The phone path's test moves a blended square across a transparent canvas from the frame number. It compares 16 consecutive frames that both runs hold. The signal changes the full path's picture by about 10 levels and the phone path's by 0.00. The skip is therefore proven where the scene would react.

null3D keeps one scene color target. The study's engine writes a transparent surface's alpha into a second attachment, which null3D does not have. The two transparency signals here therefore read the alpha where the canvas shows through and the opaque-only copy everywhere else. The two cases cover the signals apart.

## How the figures were made

Two scenes drew D-129's quality figures at 960 x 540, frames 12 to 27. Each run drew four frames a second, so each capture finishes before the next frame:

- **Thin geometry:** a near picket fence of 3 cm pickets and a far fence of 2 cm pickets that are narrower than a pixel. There are three 1 cm wires and a line mesh one pixel wide. Two boxes move by themselves when the camera does not, from the frame number. The motion target records their motion.
- **Grass:** 6,000 tufts of curved blades on a bank, with rocks. Each blade bends in its vertex shader from the sketch's frame number.

The camera held still, orbited at 0.1 radians per second, or orbited at 0.3. The reference was the same 16 frames at 3840 x 2160 with MSAA 4x. That is 64 samples per pixel, shrunk by averaging 4 x 4 blocks in linear light. Each preset drew its own reference, so its shadow and texture quality could not count as error. Every motion came from the frame number, not the clock, so every run drew the same pictures. Each sequence's record shows the frames consecutive, and a skipped frame failed the run. The resolve ran on top of each preset's own anti-aliasing: FXAA at Low, and MSAA 4x from Medium up. WebGL2 caps its preset at Medium, so its rows cover Low and Medium. Its High and Ultra presets draw the same as Medium.

The grass scene's blade sway comes from a uniform that the sketch sets from the frame number. That is the condition D-129 measured. The engine does carry a custom material's `frame.time` sway in its motion target ([D-140](D-140-motion-vectors.md)). `tests/image/motion-vectors.spec.ts`'s `a custom material's vertex offset shows its motion` holds that. A quad moved by the clock shows its motion in the debug view. This scene does not use that path. A 64-sample reference is a second run whose clock cannot line up with the first. The frame-number sway is what D-129 measured. The wind's quality against a reference is therefore not measured here.

The two jittered effects drew at 320 x 180. **Thin rain** is 6,000 additive streaks thinner than a pixel, moved by the frame's clock. **The volumetric fog** is a fog over towers whose grid the engine moves by a sub-pixel offset each frame. Each run captured 16 frames. The page draws at four frames a second, so a sketch frame holds the same picture in every run. The page records the sketch frame that each capture drew, so a slow machine's replayed capture still pairs with the right frame. The figures compare the frame-to-frame change over the frames that all four runs hold. The fog's change alternates from frame to frame. A mean over different frames therefore differs by more than the offset request can move it. The offset request alone was run with the resolve off, to show it changes nothing.

Cost ran at 1920 x 1080, render scale 1, with the resolve off and on in turns. Each side took three rounds of 2 seconds, and the figures are the medians of GPU time per frame. The light scenes ran at each preset on both paths. The busy scene is the Creek showcase, played through a wrapper page that turns only the resolve, at Low, Medium and High. The phone path ran at Medium on both paths. Each timing run started in a quiet window on the Mac, and the load is on each run's line.

The thin and grass tables and the cost tables are the ones that [the 28 October Mac record](../tested-devices/mac-chrome/20261028-2221-taa-study.md) holds. They are at `c014bc0fd`, before `33e52dcf4` made the opaque-only copy a required input. They therefore measure the resolve without that requirement. They ran in a quiet window on the Mac, through the job queue, in Chrome 156 on the Mac's M5 Max GPU. The quality runs started each preset's reference and then its two measured sequences, with one worker. The cost runs waited for the load to fall under the quiet limit before each test. Each run's line carries its load. The queue's window admitted no other run while they ran. The effects table, the fix tests, the capture proof and the shader-library tiers ran at the final head, `add109557`. Its engine is `33e52dcf4`'s. The fix tests passed 12 of 12, the capture proof 5 of 5 and the shader-library tiers 3 of 3. [The 29 October record](../tested-devices/mac-chrome/20261029-0022-taa-tests.md) holds that run. The thin, grass and cost tests have not been rerun at the final head.

The figures are in 8-bit levels of the luma of the displayed color, over the 15 steps between the 16 frames. Shimmer is the change beyond the reference's. Smear is true change that the frames lack. Error is the mean distance from the reference. Sharpness is the frames' mean gradient over the reference's, where 1 is as sharp. Still is the frame-to-frame change where nothing but the resolve moves.

## Data

### The thin scene, WebGPU

Shimmer / smear / sharpness / error with the camera on its slow orbit, and the still camera's change. The left value is the preset alone, and the right value is with the resolve:

| Preset | Slow orbit, preset | Slow orbit, resolve | Still camera, preset | Still camera, resolve |
| --- | --- | --- | --- | --- |
| Low | 1.690 / 0.707 / 1.581 / 3.189 | 2.935 / 0.813 / 1.521 / 3.690 | 0.000 | 4.042 |
| Medium | 0.689 / 0.294 / 1.360 / 1.758 | 1.599 / 0.828 / 1.161 / 2.654 | 0.000 | 2.242 |
| High | 0.736 / 0.309 / 1.364 / 1.892 | 1.648 / 0.841 / 1.166 / 2.754 | 0.000 | 2.277 |
| Ultra | 0.775 / 0.312 / 1.374 / 1.934 | 1.660 / 0.865 / 1.150 / 2.844 | 0.000 | 2.294 |

The brisk orbit tells the same story. At High, the preset's 1.156 / 0.359 / 1.365 / 1.886 is 1.900 / 1.266 / 1.172 / 2.755 with the resolve. The resolve is worse on every measure at every tier.

### The thin scene, WebGL2

The path caps at Medium, so these rows cover both tiers:

| Preset | Slow orbit, preset | Slow orbit, resolve | Still camera, preset | Still camera, resolve |
| --- | --- | --- | --- | --- |
| Low | 1.693 / 0.708 / 1.583 / 3.194 | 2.924 / 0.789 / 1.536 / 3.597 | 0.000 | 3.944 |
| Medium | 0.715 / 0.306 / 1.357 / 1.856 | 1.969 / 0.687 / 1.298 / 2.838 | 0.000 | 2.617 |

The path's order matches WebGPU's: shimmer rises and smear rises with the camera moving. The error rises, and the still camera crawls 2.6 to 3.9 levels where the presets hold the image. Its sharpness falls less than WebGPU's at Medium, from 1.357 to 1.298.

### The grass bank

| Preset | Slow orbit, preset | Slow orbit, resolve | Still camera, preset | Still camera, resolve |
| --- | --- | --- | --- | --- |
| Low | 0.842 / 0.330 / 1.272 / 1.282 | 0.580 / 0.619 / 0.873 / 1.681 | 0.228 | 1.056 |
| Medium | 0.483 / 0.208 / 1.191 / 0.816 | 0.436 / 0.696 / 0.780 / 1.608 | 0.196 | 0.835 |
| High | 0.948 / 0.397 / 1.138 / 1.614 | 0.570 / 0.820 / 0.756 / 2.043 | 0.400 | 1.080 |
| Ultra | 1.156 / 0.487 / 1.115 / 2.046 | 0.660 / 0.996 / 0.719 / 2.516 | 0.512 | 1.268 |

### The grass bank, WebGL2

| Preset | Slow orbit, preset | Slow orbit, resolve | Still camera, preset | Still camera, resolve |
| --- | --- | --- | --- | --- |
| Low | 0.841 / 0.330 / 1.294 / 1.267 | 0.617 / 0.581 / 0.941 / 1.596 | 0.226 | 1.083 |
| Medium | 0.785 / 0.320 / 1.194 / 1.278 | 0.506 / 0.719 / 0.805 / 1.756 | 0.322 | 0.930 |

The resolve cuts the grass's shimmer with the camera moving. It cuts 10% to 43% on WebGPU and 27% to 36% at WebGL2's two tiers. It pays for that with a smear 1.8 to 3.3 times the preset's. Its sharpness is 0.72 to 0.94 against the presets' 1.12 to 1.29. The distance from the reference rises at every tier. With a still camera it adds 0.6 to 0.9 levels of change each frame where the grass sways. The motion target holds no wind for this scene. The resolve therefore reads the history of a blade that has bent.

### What fails, and by how much

- **Shimmer:** the resolve adds it on the thin scene at every tier and camera. On the slow orbit it is 1.7 to 2.8 times the preset's, and on the brisk orbit 1.3 to 1.9 times. With a still camera the presets change nothing. The resolve changes 2.2 to 4.0 levels each frame on WebGPU, and 2.6 to 3.9 on WebGL2.
- **Smear:** it rises at every tier with the camera moving. At High on WebGPU the slow orbit goes from 0.309 to 0.841, and the brisk orbit from 0.359 to 1.266. On WebGL2 at Medium the slow orbit goes from 0.306 to 0.687.
- **Sharpness:** 1.15 to 1.54 of the reference against the presets' 1.36 to 1.65.
- **Error:** worse in every one of the twelve preset-and-camera pairs on WebGPU, and in every pair on WebGL2.
- **Still scenes:** the crawl that D-129 refused is still there. The presets draw exactly the same image every frame, and the resolve changes it each frame.
- **The grass:** with the camera moving, the resolve cuts the shimmer 10% to 43% on WebGPU and 27% to 36% on WebGL2. It pays with a smear 1.8 to 3.3 times the preset's, and a sharpness of 0.72 to 0.94 against 1.12 to 1.29. The error rises at every tier. With a still camera it adds 0.6 to 0.9 levels of change each frame where the grass sways.

### Thin rain and the volumetric fog

The resolve's frame-to-frame change, in levels, over the frames all four runs hold:

| Effect | WebGPU, off / on / signals off | WebGL2, off / on / signals off |
| --- | --- | --- |
| Thin rain | 14.321 / 13.705 / 7.202 | 13.397 / 12.875 / 6.803 |
| The volumetric fog | 0.472 / 0.485 / 0.485 | 0.760 / 0.771 / 0.771 |

The offset request alone moves each figure by under 0.01 levels.

The rain has no motion in the motion target, because it is a blended draw and blended draws write no depth ([D-140](D-140-motion-vectors.md)). The transparency signals explain both figures. With the signals on, the opaque-only comparison finds each streak where the composited color differs from the copy. The history is dropped, so the streak stays as raw as without the resolve: 13.705 against 14.321 on WebGPU, and 12.875 against 13.397 on WebGL2. With the signals off, the history blends the streaks and the change falls by half, to 7.202 and 6.803. That is the streaks' ghost, not a cleaner streak. A resolve cannot both keep a sub-pixel streak sharp and smooth its change without the streak's motion.

The fog draws after the resolve, and its apply step reads the resolve's output. The fog keeps its own two-frame history. The resolve changes the final frame's change by 0.013 on WebGPU and 0.011 on WebGL2, both upward, and the signals make no difference. It cannot clean up fog jitter.

### Cost, the light scenes

The GPU time per frame, in milliseconds at 1920 x 1080, with the median of three rounds of 2 seconds on each side:

| Scene | Preset | WebGPU, off to on | Added | WebGL2, off to on | Added |
| --- | --- | --- | --- | --- | --- |
| Thin | Low | 1.180 to 2.687 | +1.507 | 1.417 to 2.738 | +1.321 |
| Thin | Medium | 1.245 to 2.621 | +1.376 | 3.060 to 8.132 | +5.072 |
| Thin | High | 2.294 to 4.063 | +1.769 | draws at Medium | +5.072 |
| Thin | Ultra | 2.687 to 4.653 | +1.966 | draws at Medium | +5.072 |
| Grass | Low | 2.228 to 3.146 | +0.918 | 2.785 to 4.717 | +1.931 |
| Grass | Medium | 3.867 to 4.391 | +0.524 | 6.146 to 9.126 | +2.979 |
| Grass | High | 4.194 to 6.554 | +2.359 | draws at Medium | same as Medium |
| Grass | Ultra | 5.964 to 6.291 | +0.328 | draws at Medium | same as Medium |

The thin scene pays about 1.4 to 2.0 ms on WebGPU over a frame of 1.2 to 2.7 ms. At WebGL2's Low it pays 1.3 ms. At WebGL2's Medium it pays 5.1 to 5.8 ms over two runs. The frame there is 3.1 to 3.4 ms. In the first run the off rounds were 2.98, 4.71 and 3.06 ms. The on rounds were 7.68, 8.65 and 8.13. Every on round is above every off round. That cost is the depth copy that the path makes after each pass that writes depth. The grass adds 0.3 to 2.4 ms on WebGPU. At WebGL2's Low and Medium it adds 1.9 to 3.0 ms. Its WebGPU rounds spread more than the median difference. The High preset's three on-rounds were 5.44, 6.55 and 6.68 ms against off-rounds of 3.54, 4.19 and 4.26.

At Medium the phone path added 1.311 ms on the thin WebGPU scene, against the full path's 1.901 in the same run. On WebGL2 it added 4.538 against 5.831. On the grass it added 1.638 against 1.507 on WebGPU, and 3.129 against 2.600 on WebGL2. It saves nothing there. In the Creek it added 0.328 against 0.983 on WebGPU, and -4.281 against 6.348 on WebGL2. The scene's own variation there is larger than either figure. The full thin path's own figure moved 1.376 to 1.901 on WebGPU and 5.072 to 5.831 on WebGL2 across runs. The thin saving is about the size of that run-to-run spread. The phone path's picture skip is proven; its cost saving is small and these runs do not separate it from the noise.

### Cost, the Creek

The resolve's GPU time per frame in the Creek showcase, at 1920 x 1080:

| Preset | WebGPU, off to on | Added | WebGL2, off to on | Added |
| --- | --- | --- | --- | --- |
| Medium | 8.913 to 9.110 | +0.197 | 54.360 to 51.844 | -2.516 |
| High | 9.437 to 10.224 | +0.786 | 52.729 to 54.287, drawn at Medium | +1.558 |

On WebGPU the resolve costs 0.2 to 1.0 ms in the Creek's 9 to 10 ms frame. That is much less than in the light scenes. The busy GPU runs at a higher clock, so the fixed full-screen work overlaps with the scene's own work. On WebGL2 the scene drew at 50 to 54 ms. The same work measured -2.5 ms at the Medium preset, and +1.6 ms at High, which draws at Medium too. The phone run's full side measured +6.3 ms. That 9 ms disagreement is the scene's own frame-time variation. It is larger than the resolve's cost. These runs do not measure the resolve in the Creek on WebGL2. The earlier study page's 9.1 ms at WebGL2's Medium is not reproduced. This scene's frame is two to three times longer than that page's. Its rounds also move more than the resolve's cost.

### Memory

The resolve's own targets are two histories, its resolved target and the opaque-only copy. Each is 16-bit color at the canvas's size: 32 bytes per canvas pixel. That is about 66 MB at 1920 x 1080 and 265 MB at 3840 x 2160. They are made only while the resolve draws. The motion target and the WebGL2 depth copy belong to the motion pass. Other readers would need them too.

### The engine paths: captured frames and the live toggle

A captured frame must hold the image that the screen shows. The setting must also turn off and on while the engine runs. The sketch thread records each frame's draw list into one of two slots by parity. The thread that draws replays that list. A setting change remakes the plan's targets. A list recorded under the older plan could therefore read a target that the new plan cleared. That shows as a black capture, or as a destroyed target in flight on WebGPU (E1305). The engine publishes the plan's generation beside each parity's list (`planEpoch`). A capture replays a list only while its generation is the plan's newest. The guard serves every feature that records draw lists. The unit test `waits for a list that the plan that draws now recorded, after its targets were made again` keeps it.

Five browser tests ran in Chrome on the Mac's GPU. Four ran on both paths with MSAA and with one sample per pixel, and one ran with the resolve off. Each compares the pixels that `captureFrame` read with a screenshot of the live canvas, and requires neither to be black. It also requires the mean distance to stay under 16 levels. The four resolve-on tests also turn the setting off and on again six times. Each reports no fault.

| Test | Path | Samples | Distance from the live canvas |
| --- | --- | --- | --- |
| Captured frame holds the live canvas | WebGPU | MSAA | 0.00 levels |
| Captured frame holds the live canvas | WebGPU | one sample | 0.00 levels |
| Captured frame holds the live canvas | WebGL2 | MSAA | 0.00 levels |
| Captured frame holds the live canvas | WebGL2 | one sample | 0.00 levels |
| Captured frame holds the live canvas, resolve off | WebGPU | MSAA | 0.00 levels |

## Look

The presets look better. The resolve trades their shimmer for a softness and a smear that the eye finds first. A still thin line crawls, the grass loses its edge, and the whole frame is softer. D-129's animated crops showed it most in the Creek's near grass. The figures here agree: sharpness falls and the distance from the reference rises wherever the resolve draws. The decision keeps the presets. No cost or schedule argues against them.

## Decision

1. **The temporal resolve does not ship.** On the thin scene it loses on shimmer, smear, sharpness and error at every tier on both paths. On the grass it cuts the shimmer 10% to 43% and loses on smear, sharpness and error. Its still camera crawls where the presets hold still. Its cost does not rescue it. It adds 1.4 to 2.0 ms on WebGPU in the thin scene. At WebGL2's Medium it adds 5.1 to 5.8 ms, on a 3.1 to 3.4 ms frame. The presets keep FXAA on Low and MSAA 4x from Medium up.
2. **TAA is dropped, not deferred.** The mapping says that null3D has no temporal anti-aliasing and that no version plans it. The three.js rows follow.
3. **M3-F3 does not ship.** The many-lights prototype is dropped with the resolve that its noise needed ([D-179](D-179-technique-rulings.md), ruling 15).
4. **M3-F10 is dropped.** There is no temporal upscaler, and the governor's render scale with the final pass's scaling stays the phone speed path (ruling 16).
5. **The prototype and the six fixes stay behind the internal setting.** They are off on every preset, so they cost nothing while off. The measurement pages and the tests stay with them, so a later attempt starts from the measured figures.
6. **The capture and plan-generation fixes stay.** They serve every feature that records draw lists.
7. **Motion vectors stay.** They serve the motion debug view and any later attempt, and they cost nothing while nothing reads them.
8. **The phone path stays a setting of the prototype.** It saves 0.6 to 1.3 ms of the resolve's cost on the thin scene and nothing on the grass. The picture still loses, so no preset turns it on.

## Consequences

- **Technique review:** the TAA row and the temporal upscaler rows say dropped.
- **Three.js mapping:** the anti-aliasing rows say that TAA is not planned and that `TRAANode`, `TAAUNode` and `TemporalReprojectNode` have no equivalent. The generated porting guide and the porting skill follow.
- **D-129** points here. **D-179's** rulings 15, 16 and 24 are settled.
- **The six fixes stay** behind the internal setting with their tests, so a later attempt starts from them.

## What a later attempt needs

1. **A rejection that keeps sub-pixel edges.** The still-camera crawl remains: on the thin scene the presets draw the same image every frame, and the resolve changes it each frame. The depth rejection at a sub-pixel edge is the named cause, and it was not tried.
2. **A sharper resolve.** The grass loses its sharpness against the preset's MSAA, and on the thin scene the resolve is softer at every tier.
3. **Motion for blended draws, or a rain technique that does not need the resolve.** The rain's change falls by half only with the transparency signals off, which leaves the streaks' ghosts. The resolve cannot both keep a sub-pixel streak sharp and smooth its change without its motion.
4. **A WebGL2 path whose depth copies cost what WebGPU's do, and figures from phones.** The depth copy after each pass that writes depth is what a phone cannot pay in a busy scene.
5. **A quality method for the clock-driven wind.** The engine carries a custom material's `frame.time` sway in its motion target, and the motion tests hold it. A 64-sample reference is a second run, and the two runs' clocks cannot line up, so the wind's quality is not measured here.

## a taken frame is judged stale before the sketch is woken

A rule that judged a taken frame stale after it woke the sketch thread fixed one fault and opened another. The sketch could record the next frame during that wake. When the next frame's plan had made its targets again, the loop skipped the frame that it had taken, whole. A skipped list never draws a second time, so the work that only that frame recorded was lost without a word.

The `probe-capture` picture failed twice in 16 full runs, both times on WebGL2. The floor kept the first capture's map, pixel for pixel. The page had asked for a capture after the sphere moved. The plan's texture list changed in the capture frame, and again in the frame after. The capture views' depth target enters it in the capture frame and leaves it in the frame after (`crates/null3d-render/src/graph/compile.rs`, `crates/null3d-render/src/frame.rs`). The wake let the frame after be recorded before the loop drew the capture frame. That skip dropped the six capture passes and the probe's filter, and the probe had cleared its request when the frame was recorded (`crates/null3d-render/src/probes.rs`). Nothing asked for the capture again. WebGL2 ignores a texture that was never made, without an error, so the run still reported success.

### What a skipped list loses

A skipped list never draws again, so everything that only that frame recorded is lost. The fault audit checked each kind of one-shot work against the code. These are lost: texture creates and deletes, picks, probe captures, generated maps, sky fills, texture uploads and canvas regions. Mesh and material edits and shadow tiles are lost too, and so are the compute pipelines that a pass makes once. These are safe: the pipelines that a frame's meshes draw with, timings and the temporal history, because each is rebuilt or replaced by later frames.

Some of those losses reach beyond a picture:

- The render graph records the textures it makes and releases, and remembers them as made at record time (`crates/null3d-render/src/frame_graph.rs`). A skipped list leaves the GPU without them, and the next frame does not make them again.
- The probe array's remake does the same for the probes' maps and their generation (`crates/null3d-render/src/probes.rs`).
- Each pass that makes its compute pipelines once, on its first recorded frame, loses them with a skipped list. The exposure, effects and final passes are among them (`crates/null3d-render/src/exposure.rs`, `effects.rs`, `final_pass.rs`).
- A GPU loss is safe because it forgets all of that bookkeeping (`crates/null3d-render/src/frame_graph.rs`, `crates/null3d-render/src/probes.rs`) and every probe captures again. The plan-generation skip had no such reset.

The frame after a skipped one usually makes or releases the entries that moved, so the GPU's textures commonly converge. That is luck, and nothing guarantees it. A captured map does not converge, and neither does a texture whose entry the next plan leaves as it is.

### The fix

The frame loop now judges the frame before it stores the take and wakes the sketch (`packages/engine/src/render/loop.ts`). The sketch records no frame after one that the loop has not taken, so the answer holds until the frame draws. A frame therefore draws unless its own list was recorded for a GPU device that the browser took away. A plan change never skips a frame in these two loops. Frames draw in the order the sketch recorded them, and each list carries the textures it makes and releases.

The hold loop follows the same rule. It draws the held frames from the first to the published one, in that order. A plan that the second held frame changed then cannot make the first unsafe. A scene with one probe and screen-space reflections draws two held frames. The first creates every object and captures the probe, and the second reads the first. The old rule skipped the first, with its creates and its capture, and the second then named objects that were never made.

A capture still checks the plan's generation, because it replays a list long after its frame was recorded (`packages/engine/src/render/scene-renderer.ts`).

The probe's request had a second way to die with no skip. A draw whose pipeline is still building draws nothing, and the frame loop stops waiting for new pipelines after the first full frame. A capture of an object whose material no camera draw had used yet could therefore filter a map that lacked the object. A capture now keeps its request until a frame draws with every pipeline built. A frame recorded before any frame has been drawn ends the request at once, because each frame waits for its pipelines until then. A held scene records every frame before the thread that draws draws one. So no held frame needs a second capture for that alone. The shadow tiles keep their tile's draw the same way (`crates/null3d-render/src/probes.rs`, `crates/null3d-render/src/shadow_tiles.rs`).

The other repair, a re-arm of the probe whose capture frame was skipped, was rejected. It would repair the probe alone, while a skipped list also loses the render graph's textures and the passes' pipelines. It would also capture twice when the page asks for a capture while a re-arm waits, because both requests reach the same probe. This fix restores the rule that all of that work relies on. Task M3-F8 made it.

The probe page now reports the frames that the thread that draws skipped, as `framesSkipped` in its result. The `probe-capture` test requires it to be 0. The test pages' watch notes the same counter in its trail. A future failure names a skip as its cause. The page does not ask for the capture again, because a retry would hide the fault.

### What this does not fix

A pick in flight across a GPU loss never answers: the loss resets the picking buffers and sends nothing back to the page (`crates/null3d-render/src/pick.rs`). A page waits forever for that answer. It belongs to task M3-R35.

### The proof

`packages/engine/src/render/loop.test.ts` holds two new tests. One records the next frame under a newer plan during the wake, and the taken frame still draws. The other draws two held frames whose plans differ. Both fail on the code before the fix. The probe's unit test, `a_capture_keeps_its_request_until_the_pipelines_it_needs_are_built`, ends the request in a frame recorded before any frame is drawn. It keeps it in a later frame while its pipelines build.

The builder tests hold the rule. `packages/engine/src/render/loop.test.ts` draws both held frames. The later one then records a newer plan. `crates/null3d-render/tests/probes.rs` captures two probes on both builders. It draws the two held frames, starting from the round 26 checker's reproduction. The `probe-capture` picture carries the rule on every tier. The `probe-blend` picture proves it on WebGL2. The `probe-blend` references on WebGPU and compatibility mode were drawn before this fix. They hold the lost-probe fault. Task M3-R36 owns that fault and those references. No reference image changed with this fix.

This rule stands: a list from an older plan is never replayed after a newer plan made its targets again. The change stops the frame loop and the hold loop from applying that rule to frames that draw in the order they were recorded.
