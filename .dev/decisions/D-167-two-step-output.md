# D-167: Two-step output below render scale 1, with GSR 1

Status: decided (the split ships; GSR 1 and the sharpen value follow), 14 October 2026. Task:
M2-F10.

Summary: Below render scale 1, today's final pass ran four tone curves for each canvas pixel. It
also ran four sRGB encodes and four dither hashes, and it drew no FXAA. The pass now splits in two
there. The first step runs the output transform and FXAA at the render size into an 8-bit target.
The second step scales that up to the canvas, with the colour table, the vignette, the dither and
the outline last. At the whole canvas's scale the pass is exactly the one pass's, so its image does
not change. The upscaler is today's bilinear scale-up; GSR 1 follows prototype P1. Qualcomm's
figures put GSR 1 at 0.14 to 0.23 ms over a bilinear upscale on Snapdragon 888 to 8 Gen 2 phones.

## Question

How does the final pass below scale 1 avoid its work per canvas pixel, and gain anti-aliasing?
Which upscaler runs in its second step, and how does scale 1 stay unchanged?

## Rule

M2-F10's rule, from prototype P1: GSR 1 is within 0.2 ms of today's pass at scale 0.5 on the
Galaxy S25 with WebGL2 forced. The upscaled image must also be closer to the scale-1 image than
today's is. The prototype compares GSR 1, a bilinear upscale, an EASU with RCAS, and today's path.
It runs with the mip bias on and off, and with a nearest baseline at 0.5. The devices are the
iPad, the Mac and the cloud S25, Pixel 9 and Pixel 11. Design principle 1 adds the engine's rule:
nothing ships without the measurement.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| Tone curves, sRGB encodes and dither hashes a canvas pixel ran below scale 1 | 4, 4 and 4 | `final.wgsl`, the `fs` four-tap loop below `whole` |
| FXAA below scale 1, before this change | Not drawn | the same, the `whole` test skips the smoothing path |
| Low's lowest render scale | 0.5 | `packages/engine/src/quality/presets.ts` |
| GSR 1 over a bilinear upscale | 0.14 to 0.23 ms | Qualcomm, `snapdragon-gsr`, `sgsr/v1/README.md`, recorded as S-15 |
| FSR 1 EASU and RCAS | 1.8 ms and 0.9 ms, iPhone 12, 1772x819 to 2532x1170 | atyuwen, 2021-08-25, recorded as S-15 |
| GPU time of S4 and S6 on the Mac, this change against its base | within the check's noise band on every page | `bun run bench:gpu-check`, c22b14aec..f1b9a07d0, 14 October 2026 |

How the data was produced: the final pass's four-tap loop and the preset table were read from the
code. The upscaler figures come from Qualcomm's `snapdragon-gsr` repository at
`sgsr/v1/README.md` (SGSR 1.0.0) and atyuwen's 2021 note on optimizing FSR. The post-processing
study of 4 October 2026 records both as S-15. The GPU check ran in Chrome 155 on the Mac's M5 Max.
The benchmark pages there draw at the whole canvas's scale, where the split is off. Prototype P1
has not run, so no phone figure exists yet.

## Decision

The two steps ship, as follows.

1. Step 1 is a new full-screen pass that draws at the render size, one texel for each render pixel.
   It runs the output transform, which is the tone curve and the sRGB encode. It also runs FXAA,
   bloom and the folded effects. It writes an 8-bit display-colour target named `outputColor`. The
   pass is today's `final.wgsl` with the new `RESOLVE` settings flag. That flag makes the shader use
   the render size as its frame, so its `whole` test holds. The four-tap loop is then skipped, and
   the dither waits for step 2.
2. Step 2 is the plain final pass. It reads `outputColor` as display color, under `DISPLAY_COLOR`,
   and scales it up to the canvas. Then it applies the colour table, the vignette, the dither and
   the outline, in that order. A new `DITHER` flag makes it dither when step 1 read high dynamic
   range color, which would otherwise have dithered in step 1. The vignette darkens high dynamic
   range color in step 1 and display color in step 2. The outline keeps its canvas-space frame and
   stays in step 2.
3. The split runs only when the render scale can drop below the whole canvas and the frame draws
   below it. A crossing declares the passes again inside the frame's preparation, so no frame mixes
   the two shapes. At the whole canvas's scale the pass is exactly the one pass's again.
4. Effects that may fold into the final pass no longer fold while the render scale can drop, since
   step 2 reads display color.

The upscaler is today's bilinear scale-up, which step 2 already draws. GSR 1, the EASU choice and
the `sharpen` RCAS value follow, once prototype P1 measures them on the phones.

## What the questions were

1. **Per-frame scale routing.** The frame now holds the two-step pass only below the whole canvas's
   scale. It re-declares on a crossing, so the extra target is absent at scale 1.
2. **Where the outline draws.** Step 2, unchanged in its canvas-space frame. The line's width is
   still in canvas pixels.
3. **Bloom's frame.** Bloom draws in step 1. Its base covers the same corner, so its read did not
   change.
4. **Coverage against luma in alpha.** The alpha channel still holds premultiplied coverage, for a
   transparent canvas and the outline. The upscaler computes luma from the colour channels.
5. **RCAS fused into the upscale.** Still open. `sharpen` is designed as a pass over the upscaled
   image, so its strength scaling against the scale ratio needs checking when it is built.

## Consequences

- Two docs pages change when GSR 1 and `sharpen` ship. They are `concepts/quality-presets`, for the
  render scale, and `api/post`, for `sharpen`. The mapping's `SharpenNode` row changes too.
- Prototype P1 runs before the upscaler and `sharpen` ship. It covers the iPad, the Mac and the
  cloud S25, Pixel 9 and Pixel 11, each with WebGL2 forced.
- The frames below the whole canvas's scale can change by up to one step of the 8-bit target, since
  step 1 rounds before step 2 blends. The image manifest's tolerance should cover that. The scale-0.5
  tests are compared against their references before this lands.
