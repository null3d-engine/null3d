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

## Addendum: the second step at the pinned half scale, and the earlier pair

The first addendum measured at High with the governor on. The frame therefore held High's floor of
0.75, and the pass it called the second step was the seventh the timer named. This addendum holds
the render scale at one value with the governor off, at 0.5 or at the whole scale, so no step moves
it. It reads the second step by name, where the frame times every pass of itself.

**Method.** S5's benchmark page on null3D's WebGPU path, with `?renderScale=`. That switch sets the
lowest and highest render scale both to the value it names, and turns the governor off. Each
reading is three timed runs of 10 s warm-up and 10 s measured. The device is BrowserStack
Automate's iPad Pro 13 2025, in Safari 26.6.1, on a display of 60 Hz. The page canvas is 1,032 by
1,241 CSS pixels. Eight of the ten sessions hold 0.5. The other two hold the whole scale, at Low and
at Medium, as the other side of each preset's pair. Every run that asked for 0.5 reported a lowest
render scale of 0.5, with no quality step in every second, so the pin held.

**What the per-pass figures are.** The engine times seven passes one by one, and folds every later
pass into the seventh. A tile GPU also runs the passes over one another, as `frame-stats.ts` says.
Each pass's figure is therefore its own span. The parts do not add up to the frame's own GPU time.
The second step carries the name `final` where the frame draws few enough passes to be timed whole,
which on this device is Low and Medium. Only Low's span reads as a cost: at Medium it runs with the
frame's own, as the paragraph after the table says.

| Preset, canvas | Frame GPU ms | First step | Second step | Presented fps |
| --- | --- | --- | --- | --- |
| Low, 2.88 megapixels | 6.14 to 6.23 | 2.08 to 2.11 | 2.96 to 2.99 | 60 |
| Low, 5.12 megapixels | 6.33 to 7.09 | 2.37 to 2.63 | 3.71 to 4.16 | 49.6 to 60 |
| Medium, 5.12 megapixels | 23.80 to 34.07 | 19.02 to 27.58 | not separable | 23.2 to 30.2 |
| High, 5.12 megapixels | 16.30 to 23.16 | not named | not named | 29.4 to 39.7 |

At Medium and High every heavy pass's own span runs near the frame's. Those cells of the table are
bounds, not costs. At High the seventh timed pass read 14.8 to 19.8 ms. It is named for ambient
occlusion's last step or for screen-space bounce. It holds the final pass and every pass after it.
At Medium the second step's own span was 8.6 to 10.8 ms in a light frame. In a full frame it was
20.3 to 29.5 ms. Their frames were 9.6 to 11.9 and 23.8 to 34.1 ms.

**The price of the upscale.** At half the render scale the second step costs about 3 ms on a
2.88-megapixel canvas. On a 5.12-megapixel canvas it costs 3.7 to 4.2 ms. It is 48% of a 6.1 ms Low
frame. Its own loop for the sharpening adds 0.18 ms when the sharpening is on
([the sharpen run](../tested-devices/ipad-pro-13-safari/20261027-000612-sharpen.md)). The canvas
grows by 78% between the two rows. The second step grows by 25 to 39%, so its cost grows more slowly
than the pixel count. At the Low preset the two-step frame at half scale costs 6.14 to 6.23 ms. The
one frame at the whole canvas costs 6.52 to 7.78 ms. At Medium the same pair is 23.80 to 34.07
against 35.25 to 48.94. The second step is cheaper than the whole-canvas final pass it replaces on
this device. Nothing in the reading calls for a change to the pass.

**The earlier pair.** The pair this task was asked to compare with is 34.6 against 29.7 frames a
second, and 22.56 against 27.56 ms of GPU time. No run file stands behind it. At High with the pin
at 0.5 the three runs read 36.2, 35.7 and 29.6 frames a second. Their GPU times were 18.42, 18.51
and 22.83 ms. Against the pair's faster side this reading is 1.6 frames a second higher and 4.14 ms
lower. Against its slower side it is 0.1 frames a second lower and 4.73 ms lower. At Medium with
the pin at 0.5 the three runs read 30.2, 28.7 and 23.2 frames a second. Their GPU times were 23.80,
23.99 and 34.07 ms, which straddles both of the pair's GPU figures. The pair names no scene,
canvas or preset, so it cannot be reproduced frame for frame. By value its two sides fall between
this reading's High and Medium cells. The rates it gives lie inside this reading's own spread.

**Correction to the first addendum.** Its reading called the seventh timed pass the frame's last
pass. The seventh pass was the last one the timer named. Every pass after it adds its time to that
one, the second step among them. On a saturated frame a pass's own span also approaches the frame's
whole GPU time. The 20.5 to 34.9 ms it reported was therefore the frame's tail, not the second step
alone. That run does not measure the second step's own cost at this preset and canvas.

**S5's gap.** The M2 gate's timed rows put S5's WebGPU page at 29.0 frames a second. The gate
commit gave 36.1 on the same device. This reading, at one code state with the pin at 0.5, read
36.2, 35.7 and 29.6 frames a second. The three runs came in succession as the device warmed, with
18.42, 18.51 and 22.83 ms of GPU time. The gate commit's 36.1 lies inside that spread, and the
head's 29.0 sits 0.6 below its floor. The drop is therefore not separable from the device's own
run-to-run variation at this precision. The second
step is not its cause: at Low the whole two-step frame costs 6.1 ms and holds 60 frames a second.
Even at High the frame keeps within 18.3 to 23.2 ms, and the second step is a few milliseconds of
it. What would separate the gate's two rows is the showcase plan, run back to back at the gate
commit and at this head. This reading does not do that.

**The GPU check's medium rows repeat and its high rows do not.** Measured on the owner's Mac across
five runs at two heads, each against the same prepared baseline of `9369b1380`. The baseline is the
control, one binary that was never rebuilt, and its own readings moved further than any change the
check is meant to catch.

| row | baseline readings across the runs | the build's readings | spread |
| --- | --- | --- | --- |
| s4 medium | 2.68, 2.84, 2.89 ms | 2.77, 2.94, 3.25 ms | a few hundredths on three of four runs |
| s6 medium | 3.62, 3.72 ms | 3.94, 4.02 ms | one outlier at 9.93 |
| s4 high | 3.15, 3.36, 4.79 ms | 3.96, 15.47, 3.96 ms | half again to four times |
| s6 high | 6.47, 11.84, 15.96 ms | 11.01, 13.35, 18.66 ms | two and a half times on one binary |

Two runs seven minutes apart, with nothing rebuilt between them, called the same pair of builds
`+70.2 per cent slower` on s6 high and `same` on that row, and moved the failure to s4 high at
`+222.7 per cent` instead. Every failure in that night fell on a high row, and the high rows are the
least repeatable the check has.

**The rule.** The check runs twice on a machine that has drawn nothing for ten minutes, and the two
runs must agree on the medium rows before any verdict is read from either. A high row may not fail a
range until the high rows are steadier than they are, whether by a pinned clock state or a
cheaper and shorter scene. More rounds is not a remedy and was measured against: at six rounds
the same builds read 27.6 to 28.4 ms on s4 high and 49.8 to 57.3 ms on s6 high, eight times
the figures an hour earlier, because a longer run spends longer in whatever state the machine
drifts into. The medium rows stayed steady through that run, which is why the rule leans on
them. Until then a high-preset failure is a note, not a verdict.

**What to write down beside each run.** The baseline's own four figures before the ratios, the load
average at the start and the end, whether a browser was drawing, and the phases' spread. A reader who
finds four contradictory lines needs those conditions more than the lines.

**What a run of the check should do, step by step.** Let the machine sit with nothing drawn for ten
minutes. Take one run and read the baseline's figures first: near 2.8 and 3.7 for the medium rows is
the regime the check is usable in, and near 9.9 is not. Take a second run and compare the two on the
medium rows only. If they agree, read the high rows as a note. If they do not, write down that the
check did not measure anything, rather than a passed or failed line.

The runs are the ten bench files whose names begin `20261101` in the iPad's folder, two of them at
the whole scale. The
pinned-half-scale reading with the passes named is
[the Low run](../tested-devices/ipad-pro-13-safari/20261101-061916-bench.md).

## Addendum: `presentedFps` counts frames from before the measure window

Status: recorded for the task that owns `engine.measure`; the tables that quote it need re-deriving. The second step's reading above stands on it, so its rates are wrong here. Task: M3-C1 for the finding; M3-R19 for this record's rows.

**The fault.** `presentedFps` is a mean over the render thread's whole interval ring. That ring
holds frames from before the measure window. The module is
`packages/engine/src/page/frame-stats.ts`. In `summarizeFrames`, `intervals` is
`render.intervals.filter((ms) => ms > 0)`, with no frame range. `ratePerSecond` then divides
`1000 × count` by the intervals' sum. The render thread's ring holds 1,024 records, several
seconds of frames. So it carries the page's start, the pipeline warm-up and the first frames after
the load. `intervalMs` percentiles come from the same pool.

**What the window holds.** The measure counts its own frames and length in `frames` and
`seconds`. Their quotient is the window's rate, and the pages already carry both.

| Page | Ring intervals and their sum | Window | Ring's rate | Window's rate |
| --- | --- | --- | --- | --- |
| Galaxy S24, chosen preset, WebGPU path absent | 241 intervals, 12.04 s | 240 frames in 8.17 s | 20.0 | 29.4 |
| Galaxy S24, whole scene at Low | 239 intervals, 12.29 s | 238 frames in 8.18 s | 19.4 | 29.1 |
| iPad Pro 13, whole scene at Low, WebGPU | 489 intervals, 10.06 s | 488 frames in 8.52 s | 48.6 | 57.3 |

The gap reaches a third of the figure. A ring sum longer than the window means frames from before
it are counted. One interval per frame is the ring's own start, so a rate from it can never be the
window's rate. The median hides the fault, because a handful of long early frames moves a median
little and a mean a lot. That is why a 33.3 ms median on a 30 Hz display sat beside a published
20.0, and 30 is what the display allows.

**What to quote.** The window's `frames ÷ seconds`, which every page already records. Until the
engine changes, a page that quotes `presentedFps` says which statistic it is.

**Which tables move.** Only the Skyway rows do. Every run page on this machine that holds both
figures was compared, 110 of them, the pages whose figures sit under `stats` among them. The 17
that differ by more than 1.5 frames a second are all Skyway. The largest difference elsewhere is
0.69 frames, on the vegetation plan's forest page at Low.

The others do not move because their rings carry no frame much longer than their windows'. The
bench page's window is 500 frames over 30 seconds, and the 30 bench pages on this machine differ
by at most 0.06 frames. The widest is 30.15 published against 30.09 in the window. The six rows quoted for the second
step are `20261101-061301-bench`'s three pages, at 36.20, 35.67 and 29.55 against windows of
36.18, 35.63 and 29.51, and `20261101-063755-bench`'s three, at 30.15, 28.70 and 23.23 against
30.09, 28.67 and 23.20. Warm-up frames of the window's own length leave a mean unchanged. The wind field's rows quote intervals and pass times,
not a rate column, so nothing there needs re-deriving.

The Skyway rows differ because the demo's start sits inside the ring. Its first seconds load the
city's textures and build its pipelines, and those frames are many times longer than the ones the
window counts.

**Tables to re-derive from the run files:** the Skyway rows, task M3-C1. Its own run records now
carry the window's figure.

**The engine change** is the measure page's to place: restrict `intervals`, and the percentiles
with them, to the window's frames, by frame number. Or publish the window's rate alone and drop
the ring's. The Skyway runs also serve as the acceptance case, since their pages carry both figures.
