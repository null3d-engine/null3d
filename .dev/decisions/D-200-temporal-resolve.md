# D-200: The temporal resolve's second look, and the techniques that waited on it

Status: decided on 21 October 2026 by task M3-A11 from its own measurements. [D-179](D-179-technique-rulings-2026-10-15.md) leaves TAA to this task, and leaves the many-lights prototype (M3-F3) and the temporal upscaler (M3-F10) to the same answer. The owner may change the ruling. Date: 2026-10-21. Task: M3-A11.

Summary: The temporal resolve does not ship for 0.1.0. Its prototype draws the scene live on WebGPU, but a captured frame is black, which breaks the image tests, hold mode and the command-line screenshot. A live toggle on WebGPU also destroys a motion or depth target while a submit still uses it. Its cost in the Creek is 0.3 to 1.3 ms on WebGPU and 2.8 to 9.1 ms on WebGL2 at 1080p. The quality figures of D-129 could not be measured, because the captured frames were black. TAA is dropped, not deferred, and with it the shipping of many lights and the temporal upscaler.

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
