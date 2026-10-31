# D-236: The final pass's upscale and sharpening take a build of their own

Status: decided. Built: the final pass's UPSCALE builds, and the second step's own pipeline. The second step's cost on the cloud iPad is measured, and it calls for no change. Task: M3-R19 for that reading; none for the build.

Summary: The final pass's upscale and sharpening loops live only in the pass's UPSCALE builds, which only the two-step pass's second step draws. Every other build reads the texel under each pixel. Without the two loops, S1 draws 4.1 times faster on WebGL2 and 6.2 times faster on WebGPU on CI's software GPU, and the start shader files are 0.9 KB smaller after Brotli.

## Question

With the GSR 1 upscale (4b7882f9a) in the final pass, the allocation jobs' 1,200-frame warm-up of S1 on SwiftShader takes a mean of 797 s, against 330 s without it. The WebGPU job runs into its 20-minute limit. The benchmark shards' S1 pages draw about 0.35 frames a second, against about 1.45 without the upscale. Why, and what removes the cost without moving a picture?

## Rule

- No picture may change: the upscale and the sharpening run no rounds wherever they leave the shader.
- The start files may not grow, and a page that drops below the whole scale should not pay a download for it.
- A frame must never show the canvas without its picture while a build loads (`FrameGraph::request_pipelines`, as for bloom).

## Data

S1 with 1,000 objects on SwiftShader, the allocation check's warm-up cut to 150 frames, every variant on one runner, in diagnostic run 40004372878 (branch `diag/s1-final-pass`, which never lands). The job rebuilt the shader modules and the pages for each variant.

| Final pass | WebGL2 (eastus) | WebGPU (centralus) |
| --- | --- | --- |
| As on `m3-start` at 8748fa707 | 172 s | 230 s |
| The same, in a 700 by 400 window: a quarter of the pixels | 163 s | 226 s |
| The GSR round put back to the bilinear loop of four taps | 82 s | 105 s |
| Neither loop: no upscale and no sharpening | 42 s | 37 s |
| As on `m3-start`, rebuilt in the job | 171 s | 218 s |

| Allocation warm-up of 1,200 frames, CI runs of 17 to 23 October 2026 | Before 4b7882f9a | After |
| --- | --- | --- |
| WebGL2 | 41 jobs, mean 330 s, 183 to 392 | 22 jobs, mean 797 s, 461 to 1,030 |
| WebGPU | 43 jobs, mean 349 s, 199 to 436 | 3 jobs that finished, mean 839 s; the others ran out of time |

How the data was produced: the first table from the job logs of run 40004372878. The second from the logs of every allocation job of the CI runs that its header names, through `gh api repos/{owner}/{repo}/actions/jobs/<job>/logs`, by the "Warmed up" line. Runs 39997019327 and 40000657532 on the same branch pinned the render scale at 0.99, the sharpening at 0.5, and the pixel ratio at half. None of them changed the time by more than 1% on one runner.

## Findings

- The cost is per frame, not per pixel: a quarter of the pixels saved 2 to 5%. It follows how much code the shader holds, so a loop that runs no rounds is not free on SwiftShader. CI's x86-64 runners compile SwiftShader's shaders with Subzero, which leaves such a loop in place; the Mac's arm64 SwiftShader compiles with LLVM, and there the same change cost about 25% of the GPU time.
- The same code runs 2 to 3.6 times faster on one runner than on another, by the runner, not by the image: every job of these runs had image ubuntu-24.04 20261012.334.1. A comparison of two builds therefore runs both on one runner, in one job.
- A test of a setting reads what the page applied, not what it asked for. The benchmark scenes pin the lowest render scale at 1 and keep the governor off, so a request for a lower scale proves nothing until the page reports the scale it drew at.

## Decision

- A permutation bit `UPSCALE` shares `CASTER_OFFSET`'s value (D-156): only the final pass lists it, and only the shadow casters' and the depth templates list the caster offset. `APART` keeps it from FXAA and bloom, since the second step draws with neither; so no build combines them, and no module of bloom and the upscale together exists.
- `final.wgsl` keeps the sharpening loop and the GSR loop in `#ifdef UPSCALE`, and the final pass's permutations hold the bit. The UPSCALE builds stay in the start files. The folded effects' host builds with `UPSCALE` in every build, so it keeps both loops. A custom tone curve builds no UPSCALE build, as it builds no HALF build: a curve's pipelines take neither bit.
- The two-step pass's second step is the one pipeline with the bit. The frame draws at the whole canvas's scale, and does not sharpen, until that pipeline is built (`FrameGraph::prepare`). A device's first frame counts every pipeline as built and waits for them. So a page that starts below the whole scale, or sharpens from its setup, draws its first frame and every held picture with both steps. A page that drops later, or turns the sharpening on, draws at the whole scale for the frames while the new pipeline builds.

## Options rejected

- Vertex colors' value for the bit. `APART` works by value, and a pair of it with FXAA's value would drop the lit templates' builds with vertex colors and area lights.
- A `[first_use.upscale]` table. With it, the twelve start modules come to 520.8 KB after Brotli, against 540.7 KB with the loops in every build, about 1.6 KB each. But a page that drops below the whole scale, as the governor does on a slow phone, then downloads `shaders-upscale-<target>[-half].js`, 5.1 to 5.8 KB. With it comes the kind's paragraph table, 17.4 to 17.5 KB for WebGPU and 34.5 to 34.8 KB for WebGL2, unless another feature loaded that table already. With the builds at the start, the modules come to 539.8 KB, and such a page downloads nothing more. The cure for the software GPU is the same either way: the builds that draw at the whole scale lose the loops.

## Consequences

- The full picture set on the Mac passed at the head that landed: 1,448 pictures, every tier, against unchanged references, in 14.4 minutes with none failing.
- The GPU check on the Mac (`bun run bench:gpu-check`) compared with the merge base with main, 9369b1380. It judged nothing, since the benchmark pages differ between the two commits. S4 drew faster at both presets, by 1.9% at Medium and 12.2% at High. S6 read +2.5% at Medium and +50.1% at High. But its baseline at High alone ran from 4.95 to 12.81 ms between rounds, a spread of 92%. No round took a quality step, so the render scale held, and that reading is noise between rounds.
- The first frame that lets the scale drop, or turns the sharpening on, makes the second step's pipeline and draws at the whole scale; the next frame draws the two steps. `tests/render_scale.rs` and `tests/sharpen.rs` check that frame.
- `.dev/image-tests.md` tells how to time a change on CI's software GPU.

## The second step's cost on the cloud iPad

Task M3-R19 measures the second step's cost on the cloud iPad, per pass. A pair of figures for it has no run file or record behind it: 34.6 against 29.7 frames a second, and 22.56 against 27.56 ms of GPU time. So this reading stands on its own.

**Method.** The method is S5's benchmark page on null3D's WebGPU path, at `preset=high` with the
quality governor on. It ran three times on BrowserStack Automate's iPad Pro 13 2025, in Safari
26.6.1 with a display of 59 Hz, through BrowserStack Local. The page's result holds the frame's GPU
time and each pass's GPU time, as `gpuPassMs`.

**What the frame held.** At High the governor's floor is a render scale of 0.75, and the trace held
that floor in every second of all three runs. So the two-step pass drew in every frame, and no run
reached the 0.5 scale of the untraced pair. The frame's GPU median rose through the session:

| Run | GPU ms per frame | Presented fps | Frame interval p95 / p99 |
| --- | --- | --- | --- |
| 1 | 23.12 | 30.06 | 37.4 / 39.6 ms |
| 2 | 28.28 | 25.41 | 49.6 / 50.8 ms |
| 3 | 39.31 | 20.64 | 62.4 / 97.7 ms |

**Per pass.** The engine timed seven render passes and left no time between them, so each pass
stands alone. The seventh is the frame's last pass, which draws the second step below the whole
render scale.

| Run | Pass 1 | 2 | 3 | 4 | 5 | 6 | 7, the last |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.67 | 1.15 | 0.68 | 2.32 | 1.47 | 1.65 | 20.52 |
| 2 | 0.78 | 1.18 | 0.69 | 2.64 | 1.61 | 1.84 | 25.69 |
| 3 | 0.92 | 1.66 | 0.94 | 3.42 | 2.00 | 2.37 | 34.92 |

Medians in milliseconds per frame. The first three passes are the sun's shadow cascades. Passes 1
to 6 cost 0.7 to 3.4 ms each and add up to 7.95 to 11.30 ms. The seventh costs 20.5 to 34.9 ms,
which is 72 to 76% of the passes' medians added up and close to the whole frame's median.

**The price of the upscale.** Every other pass of the frame is a few milliseconds or less. The
second step's pass holds the rest, and that is where the gap sits. This reading cannot divide that
time between the upscale's shading and the wait that ends the frame. The last pass is the one whose
completion the engine times as the frame's end. On a cloud session, work outside the page holds the
GPU ([Device sessions](../devices.md#where-automate-differs-from-live)). The price is recorded as
"the second step's pass, 20 to 35 ms at 0.75 scale on this cloud session". An iPad that is not
streamed is needed to split it. Nothing in this reading calls for a change to the pass.

The three.js twin's three runs failed: each gave no result within its 95 s limit, after the KTX2
loader began transcoding the scene's textures. So no three.js side exists for the pair.

The run is [the iPad's bench run](../tested-devices/ipad-pro-13-safari/20261024-081826-bench.md).
