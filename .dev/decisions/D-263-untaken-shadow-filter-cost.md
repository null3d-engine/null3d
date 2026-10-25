# D-263: What the untaken wide shadow filter costs

Status: measured on 25 October 2026 for M3-R7, in one direct run on the Mac. The wide path stays in
every build. At the Low preset the filter's square is 3, so the wide path never runs there. The build
that compiles it measured 4.084 ms of GPU time per frame. A build without it measured 4.004 ms. The
round-by-round differences change sign, so the run does not tell a gap of 0.08 ms from its own
scatter. Date: 2026-10-25. Task: M3-R7.

Summary: On S4 at the Low preset, the wide shadow filter is compiled but never taken. That build
measured 4.084 ms of GPU time per frame, and the build without it measured 4.004 ms. The 0.08 ms
difference is about two per cent, and it sits inside the run's scatter. The study's 0.75 ms figure is
an unconfirmed code comment, so it gives order-of-magnitude context only. The wide path stays.

## Question

The shadow filter reads its square from a uniform at run time. So the shader carries the wide square
even on a preset that never takes it. The Low preset's filter is 3 texels, and Medium, High and Ultra
take 5.

Does the compiled but untaken wide path cost anything at Low? The engine study removed its 9-fetch
branch from WGSL, and its source gives one reason. A code comment says the untaken branch cost about
0.75 ms. The study calls that figure unconfirmed, and it names no device, resolution, browser, scene
or test (chapter 05).

## Rule

The wide path leaves a build only when its cost is larger than the run's own scatter. It is also the
better-looking choice wherever it is used. The `shadowFilter` setting is live on every preset, so a
removal may not cost the look that Medium and above draw ([hard rule 40](../../AGENTS.md#hard-rules)).

## Data

Two production builds of the same tree, differing only in the shadow filter's code:

- **With the wide path**, commit 1c76d6c. The wide 5 x 5 square sits in the sun cascade filter
  (`sun_filtered`) and in the shadow atlas filter (`filtered`) of `null3d::shadows`. It is compiled
  there and never taken at Low.
- **Without it**, commit d4abe39. Both functions lose the wide square.

The sun cascade filter then runs the same arithmetic at a width of 3. The atlas filter also replaces
its run-time sample loop and its three-element arrays with a fixed 2 x 2 loop and two-element arrays.
So its code differs by more than the removed square, and at a width of 3 it computes the same result.
S4 at Low never calls the atlas filter. The scene has no hero shadow, its street lights cast none,
and Low turns point-light shadows off. So both builds run the same shading arithmetic on every pixel
of this measurement.

S4 ran at the Low preset on WebGPU. The canvas was 1,400 by 778 pixels at a pixel ratio of 1. The
quality governor was off, with no step in any run. Three rounds ran, and the two builds took turns in
them. Each run had 5 s of warm-up and 5 s measured. The browser was Chrome 155 on the MacBook Pro's
Apple M5 Max.

| Build | GPU time per round, ms | Median, ms |
| --- | --- | --- |
| With the wide path (1c76d6c) | 1.673, 4.135, 4.084 | 4.084 |
| Without it (d4abe39) | 1.614, 4.004, 4.152 | 4.004 |

Round by round, the build without the wide path against the one with it: -3.5%, -3.2% and +1.7%. In
milliseconds those differences are -0.059, -0.130 and +0.068. The median of the three rounds' changes
is -3.2 per cent. The medians themselves differ by 0.080 ms, or 2.0 per cent. The comparison's
reported noise, 0.4%, comes from the median absolute deviation. That figure sets aside the one round
that disagrees. Read the scatter of all three rounds instead, about 2.5% each way. Two rounds put the
build without the wide path about 3% faster, and one puts it 1.7% slower. So the round-by-round
differences change sign, and the run does not resolve a difference of this size. The benchmark's own
GPU rule allows a quarter of the baseline's 4.084 ms here, 1.02 ms, with a 0.3 ms floor and twice the
noise. It calls the page "same".

The machine and what it means for the figure. The run went directly, not through the job queue. The
queue kept recreating a drain marker that held the job back. Other work kept the 1-minute load above
the 8 that a queued timing run waits for, mostly Spotlight indexing. The wrapper printed the load with
`sysctl -n vm.loadavg`: `load start: { 11.13 21.70 26.83 } 23:00:17` and
`load end: { 9.12 18.51 25.15 } 23:01:39`. The archived record keeps the runs alone, with no load
figures. The 1-minute load was therefore 11.1 at the start and 9.1 at the end. The 5-minute load was
21.7 and then 18.5. The first round read about 1.6 ms in both builds, against about 4.1 ms in the
later rounds. So the machine and the GPU had not settled when it ran. The run's resolution is
therefore about 0.1 ms, or 2.5% of the frame.

That leaves the question answerable. The two builds ran in the same rounds, so a change of the
machine's speed reaches both alike. The figure to look for, the study's 0.75 ms, is far larger than
this run's resolution.

What removing the wide path would save in shader size. The build's size report gives the same twelve
files in both builds. They hold the engine's shaders for each GPU path and each value of the device
bits.

| Files | With the wide path | Without it | Saved in each |
| --- | --- | --- | --- |
| 4 WGSL modules | 408.4 to 447.1 KiB raw | 401.4 to 440.1 KiB raw | 6.99 to 7.00 KiB raw, 0.3 to 0.4 KiB Brotli |
| 8 WebGL2 modules | 1,261.3 to 1,350.8 KiB raw | 1,247.2 to 1,336.7 KiB raw | 14.08 to 14.11 KiB raw, 0.4 to 0.6 KiB Brotli |

The twelve together save 140.75 KiB raw, 22.66 KiB after gzip and 5.34 KiB after Brotli. That is
about one per cent of each file. At Low the removal costs no picture, since that preset never runs
the code. A removal from the whole build would take the wide filter from Medium, High and Ultra,
which draw it.

How the data was produced: `bun run bench:run -- --compare <prepared baseline of 1c76d6c>,.
--scenes s4 --pages null3d-webgpu --runs 3 --seconds 5 --switches preset=low`. The run was in Chrome
on the Mac on 25 October 2026. It went directly rather than through the job queue. The archived
record is [`bench/results/20261025-150017-compare.json`](../../bench/results/20261025-150017-compare.json).
The run folder is `target/bench/20261025-150017-compare`.

## Look

The two builds look the same at Low. The wide square is never executed there, so removing it cannot
change the image. This measurement took no pictures. The wide square stays wherever it is used, so
the look of Medium and above does not change ([hard rule 40](../../AGENTS.md#hard-rules)).

## Decision

The wide path stays in the build at every preset. Its untaken cost at Low is 0.08 ms, or about two
per cent, and the round-by-round differences change sign. That is inside the run's scatter, so the
run does not establish a cost. The study's comment puts its own engine's untaken branch at about
0.75 ms. That is an order of magnitude above the figure here, and the study itself calls the number
unconfirmed. It is context, not evidence about this engine.

A removal would need a second shader variant for each filter width. `shadowFilter` is live on every
preset, and the governor lowers it. The 5.34 KiB after Brotli that the removal would save does not
pay for that.

## Consequences

No engine change, no picture change and no budget change. The measurement build is kept as branch
`fix/m3-r7-shadow-branch-absent`, commit d4abe39. It removes the wide square from `sun_filtered` and
`filtered` in `crates/null3d-shaders/wgsl/lib/shadows.wgsl`, so this comparison can be run again.

The measurement covers S4 alone, at the Low preset, on WebGPU, on the Mac's Apple GPU. A larger
scene, the WebGL2 path or a phone's driver could show a different cost. Any of those would reopen
this decision.
