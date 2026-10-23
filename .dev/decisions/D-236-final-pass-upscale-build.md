# D-236: The final pass's upscale and sharpening take a build of their own

Status: decided for the branch, pending the full picture run on the Mac before it lands. Date: 24 October 2026. Task: none.

Summary: The final pass's upscale and sharpening sit in loops that run no rounds at the whole canvas's scale, and CI's software GPU still paid for their code in every frame: S1 drew 4.1 times faster on WebGL2 and 6.2 times faster on WebGPU on one runner without the two loops. They now live only in the pass's UPSCALE builds, which the two-step pass's second step draws. Every other build reads the texel under each pixel. The start shader files lost 0.9 KB after Brotli in all.

## Question

The allocation jobs' 1,200-frame warm-up of S1 on SwiftShader took a mean of 330 s before 20 October 2026, and a mean of 797 s after; the WebGPU job ran into its 20-minute limit. The benchmark shards' S1 pages fell from about 1.45 frames a second to about 0.35 right after the GSR 1 upscale landed (4b7882f9a). Why, and what removes the cost without moving a picture?

## Rule

- No picture may change: the upscale and the sharpening ran no rounds wherever they leave the shader.
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

| Allocation warm-up of 1,200 frames, 17 to 23 October 2026 | Before 4b7882f9a | After |
| --- | --- | --- |
| WebGL2 | 41 jobs, mean 330 s, 183 to 392 | 22 jobs, mean 797 s, 461 to 1,030 |
| WebGPU | 43 jobs, mean 349 s, 199 to 436 | 3 jobs that finished, mean 839 s; the others ran out of time |

How the data was produced: the first table from the job logs of run 40004372878; the second from the logs of every allocation job of CI runs from 17 to 23 October 2026, through `gh api repos/{owner}/{repo}/actions/jobs/<job>/logs`, by the "Warmed up" line. Runs 39997019327 and 40000657532 on the same branch found that pinning the render scale at 0.99, sharpening at 0.5, and half the pixel ratio changed nothing, each within 1% on one runner.

## Findings

- The cost is per frame, not per pixel: a quarter of the pixels saved 2 to 5%. It follows how much code the shader holds, so a loop that runs no rounds is not free on SwiftShader. CI's x86-64 runners compile SwiftShader's shaders with Subzero, which leaves such a loop in place; the Mac's arm64 SwiftShader compiles with LLVM, and there the same change cost about 25% of the GPU time.
- The same code runs 2 to 3.6 times faster on one runner than on another, by the runner, not by the image: every job of these runs had image ubuntu-24.04 20261012.334.1. A comparison of two builds therefore runs both on one runner, in one job.
- A test of a setting reads what the page applied, not what it asked for. The benchmark scenes pin the lowest render scale at 1 and keep the governor off, so a later request for a lower scale proves nothing until the page reports the scale it drew at.

## Decision

- A permutation bit `UPSCALE` shares `CASTER_OFFSET`'s value (D-156): only the final pass lists it, and only the shadow casters' and the depth templates list the caster offset. `APART` keeps it from FXAA and bloom, since the second step draws with neither; so no build combines them, and no module of bloom and the upscale together exists. Vertex colors' value was the first choice, but `APART` works by value, and a pair of it with FXAA's value would have dropped the lit templates' builds with vertex colors and area lights.
- `final.wgsl` keeps the sharpening loop and the GSR loop in `#ifdef UPSCALE`, and the final pass's permutations gain the bit. The UPSCALE builds stay in the start files. The folded effects' host builds with `UPSCALE` in every build, as it held the code before. A custom tone curve builds no UPSCALE build, as it builds no HALF build: a curve's pipelines take neither bit.
- A `[first_use.upscale]` table was measured and set aside. With it, the twelve start modules fell from 540.7 KB to 520.8 KB after Brotli, about 1.6 KB each. But a page that drops below the whole scale, as the governor does on a slow phone, then downloaded `shaders-upscale-<target>[-half].js`, 5.1 to 5.8 KB, and with it the kind's paragraph table, 17.4 to 17.5 KB for WebGPU and 34.5 to 34.8 KB for WebGL2, unless another feature had loaded that table already. With the builds at the start, the modules fell to 539.8 KB, and such a page downloads nothing more. The cure for the software GPU is the same either way: the builds that draw at the whole scale lose the loops.
- The two-step pass's second step is the one pipeline with the bit. The frame draws at the whole canvas's scale, and does not sharpen, until that pipeline is built (`FrameGraph::prepare`). A device's first frame counts every pipeline as built and waits for them, so a page that starts below the whole scale, or sharpens from its setup, draws its first frame and every held picture as before. A page that drops later, or turns the sharpening on, draws at the whole scale for the frames while the new pipeline builds. Before, the second step shared the plain build, which the pass had built already.

## Consequences

- The first frame that lets the scale drop, or turns the sharpening on, now makes the second step's pipeline and draws at the whole scale; the next frame draws the two steps. `tests/render_scale.rs` and `tests/sharpen.rs` check that frame.
- `.dev/image-tests.md` tells how to time a change on CI's software GPU.
