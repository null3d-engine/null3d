# D-167: Two-step output below render scale 1, with GSR 1

Status: decided and built. The two steps ship, with GSR 1 as the upscaler
([D-195](D-195-gsr-as-the-render-scale-upscaler.md)) and the `sharpen` value in the second step
([D-205](D-205-sharpening.md)). Task: M2-F10.

Summary: Below render scale 1 the final pass splits in two. Step 1 runs the output transform and
FXAA at the render size into an 8-bit target. Step 2 scales that up to the canvas with GSR 1, then
applies the color table, the vignette, the dither and the outline. At the whole canvas's scale the
frame draws the one final pass. The 8-bit target stays in the plan while the scale can drop: about
33 MB at 3840x2160.

## Question

Below scale 1, the one final pass runs four tone curves, four sRGB encodes and four dither hashes
for each canvas pixel. It draws no FXAA. How does the final pass below scale 1 avoid its
work per canvas pixel, and gain anti-aliasing? Which upscaler runs in its second step, and how does
scale 1 stay unchanged?

## Rule

M2-F10's rule, from prototype P1: GSR 1 is within 0.2 ms of the one pass at scale 0.5 on the
Galaxy S25 with WebGL2 forced. The upscaled image must also be closer to the scale-1 image than the
one pass's is. The prototype compares GSR 1, a bilinear upscale, an EASU with RCAS, and the one
pass. It runs with the mip bias on and off, and with a nearest baseline at 0.5. The devices are the
iPad, the Mac and the cloud S25, Pixel 9 and Pixel 11. Design principle 1 adds the engine's rule:
nothing ships without the measurement.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| Tone curves, sRGB encodes and dither hashes that a canvas pixel runs in the one pass below scale 1 | 4, 4 and 4 | `final.wgsl`, the `fs` four-tap loop below `whole` |
| FXAA in the one pass below scale 1 | Not drawn | the same, the `whole` test skips the smoothing path |
| Low's lowest render scale | 0.5 | `packages/engine/src/quality/presets.ts` |
| GSR 1 over a bilinear upscale | 0.14 to 0.23 ms | Qualcomm, `snapdragon-gsr`, `sgsr/v1/README.md`, recorded as S-15 |
| FSR 1 EASU and RCAS | 1.8 ms and 0.9 ms, iPhone 12, 1772x819 to 2532x1170 | atyuwen, recorded as S-15 |
| GPU time of S4 and S6 on the Mac, the split against its base | within the check's noise band on every page | `bun run bench:gpu-check`, c22b14aec..f1b9a07d0 |

How the data was produced: the final pass's four-tap loop and the preset table were read from the
code. The upscaler figures come from Qualcomm's `snapdragon-gsr` repository at
`sgsr/v1/README.md` (SGSR 1.0.0) and atyuwen's note on optimizing FSR. The post-processing study
records both as S-15. The GPU check ran in Chrome 155 on the Mac's M5 Max. The benchmark pages there
draw at the whole canvas's scale, where the split is off. Prototype P1's Mac figures are
[below](#prototype-p1-on-the-mac), and [D-195](D-195-gsr-as-the-render-scale-upscaler.md) holds the
phone figures that chose GSR 1.

## Decision

The two steps ship, as follows.

1. Step 1 is a full-screen pass that draws at the render size, one texel for each render pixel.
   It runs the output transform, which is the tone curve and the sRGB encode. It also runs FXAA and
   bloom. It writes an 8-bit display-color target named `outputColor`. The pass is `final.wgsl` with
   the `RESOLVE` settings flag. That flag makes the shader use the render size as its frame, so its
   `whole` test holds. The four-tap loop is then skipped, and the dither waits for step 2.
2. Step 2 is the plain final pass. It reads `outputColor` as display color, under `DISPLAY_COLOR`,
   and scales it up to the canvas with GSR 1. Then it applies the color table, the vignette, the
   dither and the outline, in that order. The `DITHER` flag makes it dither when step 1 reads high
   dynamic range color, which would otherwise dither in step 1. The vignette darkens high dynamic
   range color in step 1 and display color in step 2. The outline keeps its canvas-space frame and
   stays in step 2.
3. The split runs only when the render scale can drop below the whole canvas and the frame draws
   below it. While the render scale can drop, which the default presets allow, the declarations
   hold both shapes, and every frame keeps the bind groups of both ready. A crossing then only picks
   which passes draw: it declares nothing, allocates nothing and makes no GPU object. At the whole
   canvas's scale the frame draws exactly the one final pass, bloom build included. Until the second
   step's pipeline is built, a frame below the whole canvas keeps to the one pass, which scales the
   image up by itself.
4. `FrameGraph::two_step_wanted` holds the wish for the two steps: the render scale's range, or the
   sharpening. Both the declaration and the pipeline request read it. A sketch with neither builds
   no pipeline for them.
5. Effects join at every render scale. They do not fold into the final pass while the render scale
   can drop, since step 2 reads display color. A custom tone curve runs in step 1.

## Design questions

1. **Per-frame scale routing.** The declarations hold the two-step pass whenever the render scale
   can drop, so the first step's target exists at scale 1 too. Declaring again at each crossing
   would allocate in the frame loop, which dynamic resolution runs every frame, so the frame picks
   the passes that draw instead.
2. **Where the outline draws.** Step 2, in its canvas-space frame. The line's width is in canvas
   pixels.
3. **Bloom's frame.** Bloom draws in step 1. Its base covers the same corner, so its read is the one
   pass's.
4. **Coverage against luma in alpha.** The alpha channel holds premultiplied coverage, for a
   transparent canvas and the outline. The upscaler computes luma from the color channels.
5. **RCAS fused into the upscale.** No. The `sharpen` value draws its own RCAS in the second step,
   over the four texels that cross each pixel, after the upscale and before the color table, the
   outline and the dither. It draws only at the whole canvas's render scale, so no scaling against
   the upscale is needed: below scale 1 the upscale's own GSR 1 sharpening runs, and the value adds
   nothing. A sketch that sets the value draws these two steps at the whole scale too, so the
   sharpening reads display color after one tone curve for each pixel
   ([D-205](D-205-sharpening.md)).

## The cost of holding the two-step shape

### The target stays in the plan

`outputColor` stays in the plan while the render scale can drop, whether or not a frame draws below
the whole canvas. The first step draws nothing at the whole canvas's scale, so its cost there is the
memory and no work. It is 4 bytes for each canvas pixel: about 33 MB at 3840x2160, and 8 MB at
1920x1080. That cost cannot go while a crossing keeps its promise. Three facts hold the reason:

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

An owner who wants that memory back must choose between the two. The crossing promise would have to
give way. The target would be made when a frame first draws below the whole canvas, and released
once the scale has stayed whole. That changes `render_scale.rs` and the no-allocation promises in
several guides.

A sketch that sets `quality.set({ minRenderScale: 1 })` gives up the drop and with it the target.
The two-step shape is then not declared, so no `outputColor` target exists, and effects join and
fold.

### Folding stays off while the scale can drop

An effect may fold only while the frame draws at the whole canvas (`may_fold`). The declarations
hold the two-step pass for the whole time the scale can drop, so a fold would declare the passes
again at each crossing. A sketch that sets `minRenderScale: 1` folds.

### Joined effects on WebGL2

A group of joined effects draws one pass at every render scale, and the two steps read its target as
the one final pass reads it. The engine writes the joined chain into the host's built GLSL at run
time (`packages/engine/src/gpu/effect-joiner.ts`). The WebGL2 build turns every structure parameter
into one parameter for each member, so it has no `EffectInput` at all. The Adreno 619 keeps a
structure's values at 16 bits ([driver bugs](../driver-bugs.md)). A chain that names the structure
(`EffectInput link = start; link.color = run(link, 0u);`) therefore fits no host function, and no
group's shader compiles on WebGL2. The driver says "no matching overloaded function found".

The chain carries the members, in the order both hosts declare them: `color`, `uv`, `pixel`, `size`,
`time`. A GLSL call passes its arguments by position, so the chain's own names serve. The shader
crate's `check_glsl` refuses a call that does not fit the function it calls, and a test pins both
hosts' chains to those five members.

When a joined build fails, the engine falls back to a pass for each effect, so the fault is
invisible in an image that looks right. The fallback declares the passes again. Until it runs, a
frame draws the target as the clear left it, which reads as a flat frame. A flat frame from joined
effects on WebGL2 therefore points at a failed joined build, not at the rows the two steps read.

## FXAA below the whole canvas

FXAA below the whole canvas's scale is intended (T-4, M-41). The one pass skips the FXAA smoothing
path below scale 1, so the edges of an upscaled frame are never smoothed. Step 1 runs FXAA at the
render size. The three compatibility-mode scale-0.5 references differ from the one pass's on edges
alone (14661f028, 1528a0feb).

Step 1 writes the render-size corner of the scene color, and it runs FXAA over that corner. Its
taps clamp to the corner's own first and last texel. Taps clamped to the scene color's whole size
read up to four texels outside the corner at its right and bottom edges. Those hold the clear color,
or an earlier frame at another scale, and leave a fringe on the image's last rows and columns. At
the whole canvas's scale the corner is the whole texture, so those frames are unchanged.
`final.wgsl`'s `pixel_color`, `tap` and `texel_at` take the bounds from `fs`. That step knows them
from the corner's origin, the render size and the RESOLVE flag. The image test
`render-scale-75-fxaa` draws that case.

## The first frame of a held picture

Hold mode draws one frame, and that frame asks for the two steps' pipelines before it declares its
passes. So the pipeline request reads the wish (`two_step_wanted`), never the declaration's flag
(`two_step_declared`). The declaration sets that flag later in the same frame. A request that read
it would find the steps undeclared on the first frame of every hold-mode picture, and draw the final
pass alone. That frame then has no FXAA below the whole canvas's scale, and no sharpening at any
scale.

`render_scale.rs`'s
`fxaa_draws_the_two_step_pass_on_the_first_frame_below_the_whole_canvas` and
`the_sharpening_draws_the_two_step_pass_on_the_first_frame` pin the passes of the first frame. Both
fail when the request reads the declaration's flag.

## Prototype P1 on the Mac

Prototype P1's page is one file of raw WebGL2, in the `bench/probes/f10-upscalers/` folder. It runs
from any static server and needs no engine build. The runner beside it serves the page and opens it
in the Mac's installed Chrome on the real GPU. The runner writes the figures to a JSON file beside
the page.

### What the page draws

The page draws one scene at the canvas size. That image is the reference. It draws the same scene
at render scale 0.5 into 16-bit float color. Step 1 runs the output transform and FXAA at the
render size into an 8-bit target, which is the shape that ships. Each candidate then draws that
target at the canvas size:

- The one pass reads high dynamic range color with the four-tap loop and runs the output transform
  on every tap.
- A bilinear upscale draws the second step.
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
The mip column names the scene texture's bias at the low render size. A bias of 0 is the engine's
sampling. A bias of -1 samples one level sharper.

| Canvas | Mip bias | One pass SSIM / MAE | Bilinear | Nearest | GSR 1 | EASU + RCAS |
| --- | ---: | --- | --- | --- | --- | --- |
| 1920x1080 | 0 | 0.9532 / 1.486 | 0.9529 / 1.596 | 0.9529 / 1.579 | 0.9552 / 1.477 | 0.9562 / 1.671 |
| 1920x1080 | -1 | 0.9655 / 1.197 | 0.9650 / 1.319 | 0.9576 / 1.492 | 0.9586 / 1.336 | 0.9485 / 1.844 |
| 1280x720 | 0 | 0.9529 / 1.779 | 0.9524 / 1.916 | 0.9523 / 1.854 | 0.9559 / 1.740 | 0.9556 / 1.909 |
| 1280x720 | -1 | 0.9629 / 1.496 | 0.9623 / 1.646 | 0.9552 / 1.775 | 0.9580 / 1.598 | 0.9441 / 2.144 |

At mip bias 0, GSR 1 is closer to the scale-1 image than the one pass by both measures, at both
canvas sizes. A negative bias improves the one pass's and bilinear's images, but the sharpeners
overshoot more, so GSR 1 then scores below the one pass. The engine applies no mip bias, so the
bias-0 rows describe its sampling. EASU with RCAS recovers the most detail and has the highest SSIM
at bias 0. Its sequence costs 0.563 ms at 1920x1080, against the one pass's 0.184 ms.

### Output cost

Every figure below is the GPU time of a candidate's whole output sequence, in milliseconds. Step 1
is common to every two-step candidate. The Mac figures show the shape of the cost. They do not
decide the S25 rule.

| Canvas | Mip bias | One pass | Bilinear | Nearest | GSR 1 | EASU + RCAS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1920x1080 | 0 | 0.184 | 0.066 | 0.075 | 0.137 | 0.563 |
| 1920x1080 | -1 | 0.184 | 0.065 | 0.073 | 0.160 | 0.507 |
| 1280x720 | 0 | 0.164 | 0.074 | 0.080 | 0.140 | 0.424 |
| 1280x720 | -1 | 0.132 | 0.062 | 0.067 | 0.133 | 0.406 |

Step 1 alone costs 0.030 to 0.031 ms at 1920x1080 and 0.026 to 0.031 ms at 1280x720. Every
two-step candidate pays it once.

At 1920x1080 with no mip bias, GSR 1's whole output sequence costs 0.137 ms against the one pass's
0.184 ms. GSR 1 is 0.047 ms faster, which is well inside the 0.2 ms band. At 1280x720 it is
0.024 ms faster. EASU with RCAS costs about 3 times the one pass. The image table above holds that
cost against the closeness of each image.

The rule names the Galaxy S25 with WebGL2 forced. The Mac figures show that the band is not tight
with the engine's sampling. The phone runs decide the rule, and
[D-195](D-195-gsr-as-the-render-scale-upscaler.md) records them.

### Running the page elsewhere

The page runs unchanged on the iPad, the cloud S25, Pixel 9 and Pixel 11. It needs a static HTTPS
host for the iPad and a tunnel URL for the phone runner. No engine build is needed. A `gsrSharp`
switch shows the softer GSR 1 variant at 1.0.

## Consequences

- `concepts/quality-presets` describes the render scale's upscale, and `api/post` describes
  `sharpen`. The mapping's `SharpenNode` row names `sharpen`.
- The frames below the whole canvas's scale can change by up to one step of the 8-bit target, since
  step 1 rounds before step 2 blends. The image manifest's tolerance should cover that.
