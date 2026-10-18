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

## Addendum, 15 October 2026 (later): the joins return, and the target stays

The review's joins cost is fixed. Its cause is not the one the split's own fix named. The target
cost stays, and the next two sections say why.

### The joined effects never built on WebGL2

d740587b6 said the two-step pass reads a joined group's target differently on WebGL2. It then made
each effect run alone while the scale can drop. The difference is real, but it is in the
shader. The engine writes the joined chain into the host's built GLSL at run time
(`packages/engine/src/gpu/effect-joiner.ts`), and that chain named the structure:
`EffectInput link = start; link.color = run(link, 0u);`. The WebGL2 build turns every structure
parameter into one parameter for each member, so it has no `EffectInput` at all. The Adreno 619
keeps a structure's values at 16 bits ([driver bugs](../driver-bugs.md)). The host's pieces take the
members, so the chain's calls fitted no function, and no group's shader compiled on WebGL2. The full
image run of 15 October 2026 recorded it: "a shader of joined custom effects failed to build, so
those effects draw one pass each: Fragment shader is not compiled". The driver said
"'fx74470501_effect_piece_main' : no matching overloaded function found".

When a joined build fails, the engine falls back to a pass for each effect. The fault is therefore
invisible in an image that looks right. The fallback declares the passes again. Until it runs, a
frame draws the target as the clear left it, which reads as a flat frame. That is the "flat frame"
d740587b6 blamed on the rows. The four `effects*` WebGL2 failures at scale 1 in that run were the
same fallback at another moment.

The chain now carries the members, in the order both hosts declare them: `color`, `uv`, `pixel`,
`size`, `time`. A GLSL call passes its arguments by position, so the chain's own names serve. The
shader crate's `check_glsl` now refuses a call that does not fit the function it calls. That is the
check that would have caught this, and a test pins both hosts' chains to those five members. So the
joins run at every render scale again, and `plan_effects` no longer drops them for the two-step. A
group draws one pass, and the two steps read its target as the one final pass reads it.

Folding stays off while the render scale can drop. An effect may fold only while the frame draws at
the whole canvas (`may_fold`). The declarations hold the two-step pass for the whole time the scale
can drop, so a fold would declare the passes again at each crossing. A crossing allocates nothing,
as the next section shows. A sketch that sets `minRenderScale: 1` folds as it did.

### The target: the plan's shape cannot follow the frame for free

`outputColor` stays in the plan while the render scale can drop. The first step draws nothing at the
whole canvas's scale, so its cost there is the memory and no work. That cost cannot go while a
crossing keeps its promise. Three facts hold the reason:

- The final pass declares a read of `outputColor` in both shapes, since its second step reads the
  first step's target. That pass runs in both shapes, and the compiler places a frame target that a
  running pass uses. So the target is in the plan for the whole time the two-step shape is declared,
  and the bloom test pins its presence at the whole canvas's scale.
- A target shares another's texture only where the two lifetimes do not touch. Below the whole
  canvas the first step writes the target in the step that reads the color it draws from. So the
  target's lifetime begins where that color's ends, and no other target can hold it.
- Freeing it therefore means declaring the passes again at a whole-canvas crossing. No frame may do
  that: `render_scale.rs` (`check_scaled_frames`, `check_bloom_while_scaling`) refuses any GPU
  object in a frame that changes the scale, and `no_alloc.rs` refuses the CPU allocation that
  declaring again costs. That promise is what keeps dynamic resolution free. The governor moves the
  scale in steps of 50 thousandths (`SCALE_STEP`), so a scene on a threshold crosses back and forth.

So this record keeps the target and its cost. It is 4 bytes for each canvas pixel: about 33 MB at
3840x2160, and 8 MB at 1920x1080. An owner who wants that memory back must choose between the two.
The crossing promise would have to give way. The target would be made when a frame first draws
below the whole canvas, and released once the scale has stayed whole. That changes `render_scale.rs`
and the no-allocation promises in several guides.
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

### Addendum: prototype P1 has no code

17 October 2026. Prototype P1 compares four upscalers: GSR 1, a bilinear upscale, an EASU with
RCAS, and today's path. No branch holds any of the four, and no page draws them or measures their
cost. So the comparison cannot run on the iPad, the Mac or the cloud phones until someone builds
that page. The split still ships on the Mac's GPU check alone, and GSR 1 and `sharpen` wait for
the page and its run.

## Addendum, 18 October 2026: prototype P1 measured on the Mac

Status: measured on the Mac; the iPad and the cloud phones remain. Task: M2-F10.

Prototype P1 now has a page. The probe is one file of raw WebGL2, in the
`bench/probes/f10-upscalers/` folder. It runs from any static server and needs no engine build.
The runner beside it serves the page and opens it in the Mac's installed Chrome on the real GPU.
The runner writes the figures to a JSON file beside the page.

### What the page draws

The page draws one scene at the canvas size. That image is the reference. It draws the same scene
at render scale 0.5 into 16-bit float color. Step 1 runs the output transform and FXAA at the
render size into an 8-bit target, which is the shape that ships. Each candidate then draws that
target at the canvas size:

- Today's one pass reads high dynamic range color with the four-tap loop and runs the output
  transform on every tap.
- A bilinear upscale draws today's second step.
- A nearest upscale is the baseline at scale 0.5.
- GSR 1 comes from Qualcomm's BSD-3-Clause GLSL. The port uses explicit texel fetches, because
  WebGL2 exposes GLSL ES 3.00 and has no `textureGather`.
- FSR 1's EASU runs, then RCAS from the MIT header. RCAS keeps its denoise step, and its sharpness
  is 0.2 stops.

Every image gets the engine's dither at its canvas pixel, so the dither cancels in the comparison.
The reference runs the same output transform, FXAA and dither, which the shipped final pass draws at
scale 1.

### How the page measures

Each candidate's whole output sequence runs inside one GPU timer query. Each round writes a
different target of a pair. The render pass then ends and its tiles leave tile memory, as a frame's
target switch does. A tight loop of one draw stays in tile memory and reads far too cheap. Every
candidate takes a turn in every round, and the order rotates. A drift of the GPU clock or of the
machine's load then reaches all of them alike. One query is in flight at a time.

The comparison reads every canvas pixel. It gives mean absolute error, peak signal to noise ratio
and structural similarity over 8 by 8 luma windows. It also gives the mean luma gradient against
the reference. Pixel error penalizes a sharpened edge that lands in the right place, so SSIM is the
closer judge of how the image looks.

### Image figures

The run used Chrome 155 on ANGLE Metal, Apple M5 Max. The canvas column names the whole canvas.
The mip column names the scene texture's bias at the low render size. A bias of 0 is today's
behavior. A bias of -1 samples one level sharper.

| Canvas | Mip bias | Today SSIM / MAE | Bilinear | Nearest | GSR 1 | EASU + RCAS |
| --- | ---: | --- | --- | --- | --- | --- |
| 1920x1080 | 0 | 0.9532 / 1.486 | 0.9529 / 1.596 | 0.9529 / 1.579 | 0.9552 / 1.477 | 0.9562 / 1.671 |
| 1920x1080 | -1 | 0.9655 / 1.197 | 0.9650 / 1.319 | 0.9576 / 1.492 | 0.9586 / 1.336 | 0.9485 / 1.844 |
| 1280x720 | 0 | 0.9529 / 1.779 | 0.9524 / 1.916 | 0.9523 / 1.854 | 0.9559 / 1.740 | 0.9556 / 1.909 |
| 1280x720 | -1 | 0.9629 / 1.496 | 0.9623 / 1.646 | 0.9552 / 1.775 | 0.9580 / 1.598 | 0.9441 / 2.144 |

At mip bias 0, GSR 1 is closer to the scale-1 image than today's path by both measures, at both
canvas sizes. A negative bias improves today's and bilinear's images, but the sharpeners overshoot
more, so GSR 1 then scores below today's path. The engine applies no mip bias today, so the bias-0
rows describe the present behavior. EASU with RCAS recovers the most detail and has the highest
SSIM at bias 0. Its sequence costs 0.563 ms at 1920x1080, against today's 0.184 ms.

### Output cost

Every figure below is the GPU time of a candidate's whole output sequence, in milliseconds. Step 1
is common to every two-step candidate. The Mac figures show the shape of the cost. They do not
decide the S25 rule.

| Canvas | Mip bias | Today | Bilinear | Nearest | GSR 1 | EASU + RCAS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1920x1080 | 0 | 0.184 | 0.066 | 0.075 | 0.137 | 0.563 |
| 1920x1080 | -1 | 0.184 | 0.065 | 0.073 | 0.160 | 0.507 |
| 1280x720 | 0 | 0.164 | 0.074 | 0.080 | 0.140 | 0.424 |
| 1280x720 | -1 | 0.132 | 0.062 | 0.067 | 0.133 | 0.406 |

Step 1 alone costs 0.030 to 0.031 ms at 1920x1080 and 0.026 to 0.031 ms at 1280x720. Every
two-step candidate pays it once.

At 1920x1080 with no mip bias, GSR 1's whole output sequence costs 0.137 ms against today's
0.184 ms. GSR 1 is 0.047 ms faster, which is well inside the 0.2 ms band. At 1280x720 it is
0.024 ms faster. EASU with RCAS costs about 3 times today's pass. The image table above holds that
cost against the closeness of each image.

The rule names the Galaxy S25 with WebGL2 forced. The Mac figures show that the band is not tight
with the engine's present sampling. The phone run decides the rule.

### What remains

The page runs unchanged on the iPad, the cloud S25, Pixel 9 and Pixel 11. It needs a static HTTPS
host for the iPad and a tunnel URL for the phone runner. No engine build is needed. The S25 run
decides the 0.2 ms band. The nearest baseline and the mip bias are in the image table above. A
`gsrSharp` switch shows the softer GSR 1 variant at 1.0.
