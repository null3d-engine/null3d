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
   It runs the output transform, which is the tone curve and the sRGB encode. It also runs FXAA and
   bloom. It writes an 8-bit display-colour target named `outputColor`. The
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
   below it. While the render scale can drop, the declarations hold both shapes, and every frame
   keeps the bind groups of both ready. A crossing then only picks which passes draw: it declares
   nothing, allocates nothing and makes no GPU object. At the whole canvas's scale the frame draws
   exactly the one final pass, bloom build included. Until the second step's pipeline is built, a
   frame below the whole canvas keeps to the one pass, which scales the image up by itself.
4. The two steps ask for their pipelines only while the render scale can drop. A sketch whose
   scale cannot drop builds no pipeline for them.
5. Effects that may fold into the final pass no longer fold while the render scale can drop, since
   step 2 reads display color. A custom tone curve runs in step 1.

The upscaler is today's bilinear scale-up, which step 2 already draws. GSR 1, the EASU choice and
the `sharpen` RCAS value follow, once prototype P1 measures them on the phones.

## What the questions were

1. **Per-frame scale routing.** The declarations hold the two-step pass whenever the render scale
   can drop, so the first step's target exists at scale 1 too. Declaring again at each crossing
   allocated in the frame loop, which dynamic resolution runs every frame, so the frame picks the
   passes that draw instead (15 October 2026).
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

## Addendum, 15 October 2026: the shape is held for the whole time the scale can drop

Item 3 was written as if the declarations followed the frame: the two-step shape existing only while
a frame draws below the whole canvas. The code that shipped (011310ee7) holds the two-step shape
whenever the render scale *can* drop, which the default presets allow. A crossing of the whole
canvas's scale then declares nothing, allocates nothing and makes no GPU object, as item 3 wants.
Two costs come with that, and the code review of 15 October 2026 (M-1, R-09, N-02) asked for them
here:

- The plan keeps `outputColor`, an 8-bit target the size of the canvas, while the frame draws at the
  whole canvas's scale and nothing writes it. That is 4 bytes for each canvas pixel, about 33 MB at
  3840x2160. The target enters the plan as soon as the render scale can drop, whether or not a frame
  draws below the whole canvas.
- While the scale can drop, no effect joins and none folds into either step (frame_graph's
  `plan_effects`). A sketch whose per-pixel effects would join into one pass therefore runs each of
  them in a pass of its own, at every scale. Step 1 reads the effects' own passes' output, and over it
  runs the output transform and FXAA. No folded effect reaches either step, which is what item 1's
  earlier wording got wrong.

A sketch that sets `quality.set({ minRenderScale: 1 })` gives up the drop and with it both costs. The
two-step shape is then not declared, so no `outputColor` target exists, and effects join and fold as
they did before this change.

Prototype P1 has still not run, so the split ships on the Mac's GPU check alone.

The code review also asked this record to say that FXAA below the whole canvas's scale is intended
(T-4, M-41). It is: before the split the pass skipped the FXAA smoothing path below scale 1, so the
edges of an upscaled frame were never smoothed. Step 1 now runs FXAA at the render size, and the
three compatibility-mode scale-0.5 references that move with it were remade in both sets
(14661f028, 1528a0feb), with the diffs on edges alone.

### Addendum: FXAA's taps stay inside the step's corner

17 October 2026. Step 1 writes the render-size corner of the scene color, and it runs FXAA over
that corner. Its taps clamped to the scene color's whole size. So at the corner's right and bottom
edges they read up to four texels outside it. Those hold the clear color, or an earlier frame at
another scale. That left a fringe on the image's last rows and columns whenever the render scale
was below 1 with FXAA on.

The taps now clamp to the corner's own first and last texel. At the whole canvas's scale the corner
is the whole texture, so those frames are unchanged. `final.wgsl`'s `pixel_color`, `tap` and
`texel_at` take the bounds from `fs`. That step knows them from the corner's origin, the render size
and the RESOLVE flag. The image test `render-scale-75-fxaa` draws that case.
