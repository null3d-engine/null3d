# Benchmark results

This page gathers every benchmark figure of null3D against three.js, one table per scene. Each row is one device, browser, GPU path and run. [Benchmarks](benchmarks.md) says how the runs work, and [Device sessions](devices.md) covers phones and tablets.

The figures come from the archive in `bench/results`. Each file there is the record of one run, named after the run. The run folders themselves stay on the machine that ran them.

## Whole frame and own work

Both engines run the same scene code each frame: the code that moves S1's boxes, for example. The tables give two measures of CPU time per frame, on the busiest thread.

- Whole frame is all the CPU time of the busiest thread in a frame, scene code included.
- Own work is the engine's part of that time, with the scene code taken away. null3D times the scene code itself on each thread, so its own work is exact. three.js runs the scene code inside its own loop. So its own work is its whole frame less the time of the scene-code page, which runs the same code with no engine.
- The scene-code page's loop compiles to slightly slower code than an engine's loop. So three.js's own work here is a slight underestimate, and the comparison leans against null3D.

The targets use them as follows ([D-06](decisions/D-06-success-targets.md)):

- The desktop target uses own work: S1's own work at most 50% of three.js's, in Chrome on the Mac on WebGPU. The scene code alone takes more than that budget, so the whole frame would measure the scene code, not the engine.
- The phone target uses the whole frame. S1 at phone scale takes at most 100% of three.js's CPU time per frame, on the S24+ and the iPad.
- S3, S1-cells and S4 are measured against three.js and recorded. S4 also has a frame rate target, which its traces show.

## How to read the tables

- Date is the date in the run's name, in UTC.
- Device and browser names the device runner's runner, or the Mac for runs of `bun run bench:run`:
  - `ipad-safari` and `ipad-brave`: the iPad Pro 11-inch, over the local network.
  - `sm-s926b-chrome` and `sm-s926b-brave`: the Galaxy S24+, over USB.
  - `mac-safari` and `mac-firefox`: the MacBook Pro M5 Max's browser apps, through the device runner.
  - `Apple M5 Max, Chrome`: the MacBook Pro M5 Max in Chrome, through Playwright.
- GPU path is null3D's path, and its variant where it has one, such as low latency.
- three.js is the renderer with the lower median in that run, named in brackets. It can differ between the two measures. "failed" means that no three.js page drew the scene.
- Share is null3D's median as a percentage of three.js's.
- fps is the frames per second that each engine presented. three.js's pages did not report it before 29 September.
- GPU ms is null3D's GPU time per frame, where the browser gives a GPU timer. Chrome on the Mac has none on WebGL2.
- Commit is the engine commit that the run measured. The gate and comparisons record it. For other runs it is the commit that the checkout held when the run started, from git's reflog. Edits that were not committed do not show.
- Source is the run's name, and its record is `bench/results/<run>.json`. A row from a guide links to it.
- Figures are medians of the runs of each page, usually 3 or 5 runs.

## S1

S1 moves 100,000 boxes every frame with the same scene code in both engines. It is the scene of the desktop target: own work at most 50% of three.js, in Chrome on the Mac on WebGPU ([D-06](decisions/D-06-success-targets.md)).

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.77 / 3.24 (WebGL) | 86% | 0.16 / n/a | n/a | n/a / n/a | 2.12 | ef71a8ae | 20260927-105635-bench |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.77 / 3.25 (WebGL) | 85% | 0.15 / n/a | n/a | n/a / n/a | 2.10 | 43247b37 | 20260927-105728-bench |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.50 / 3.17 (WebGL) | 79% | 0.14 / n/a | n/a | n/a / n/a | 1.60 | b1226fda | 20260927-111433-bench |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.50 / 3.02 (WebGL) | 83% | 0.14 / n/a | n/a | n/a / n/a | 1.61 | b1226fda | 20260927-113300-bench |
| 2026-09-27 | mac-firefox, Firefox 156.0 | WebGPU | 100,000 | 4.38 / 5.70 (WebGPU) | 77% | 0.40 / n/a | n/a | n/a / n/a | 0.35 | b1226fda | 20260927-113819-bench |
| 2026-09-27 | mac-safari, Safari 26.6.2 | WebGPU | 100,000 | 1.76 / 4.24 (WebGL) | 42% | 0.46 / n/a | n/a | n/a / n/a | 1.58 | b1226fda | 20260927-113819-bench |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.31 / 3.08 (WebGL) | 75% | 0.14 / 0.56 (WebGL) | 26% | n/a / n/a | 1.60 | 86a2b2d1 | 20260927-150048-bench |
| 2026-09-28 | mac-firefox, Firefox 156.0 | WebGPU | 30,000 | 2.90 / 3.78 (WebGPU) | 77% | 0.24 / 1.10 (WebGPU) | 22% | n/a / n/a | 0.12 | 3a3c0caa | 20260928-020422-bench |
| 2026-09-28 | mac-safari, Safari 26.6.2 | WebGPU | 30,000 | 1.48 / 2.74 (WebGL) | 54% | 1.48 / 1.40 (WebGL) | 106% | n/a / n/a | 0.56 | 3a3c0caa | 20260928-020422-bench |
| 2026-09-28 | mac-firefox, Firefox 156.0 | WebGPU | 30,000 | 2.84 / 3.82 (WebGPU) | 74% | 0.26 / 0.66 (WebGPU) | 39% | n/a / n/a | 0.12 | a681858a | 20260928-030331-bench |
| 2026-09-28 | mac-safari, Safari 26.6.2 | WebGPU | 30,000 | 0.56 / 2.64 (WebGPU) | 21% | 0.12 / 1.54 (WebGPU) | 8% | n/a / n/a | 0.56 | a681858a | 20260928-030331-bench |
| 2026-09-28 | mac-firefox, Firefox 156.0 | WebGPU | 100,000 | 4.42 / 5.68 (WebGL) | 78% | 0.42 / 1.56 (WebGL) | 27% | n/a / n/a | 0.35 | a681858a | 20260928-031804-bench |
| 2026-09-28 | mac-safari, Safari 26.6.2 | WebGPU | 100,000 | 1.74 / 4.74 (WebGL) | 37% | 0.46 / 1.18 (WebGL) | 39% | n/a / n/a | 1.60 | a681858a | 20260928-031804-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 100,000 | 2.53 / 3.19 (WebGL) | 79% | 0.17 / 0.63 (WebGL) | 28% | 144.0 / n/a | n/a | 99af952b | 20260929-030148-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.35 / 3.19 (WebGL) | 74% | 0.15 / 0.63 (WebGL) | 25% | 144.0 / n/a | 1.70 | 99af952b | 20260929-030148-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 100,000 | 2.58 / 3.02 (WebGL) | 85% | 0.18 / 0.46 (WebGL) | 40% | 144.0 / n/a | n/a | 99af952b | 20260929-031330-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 2.50 / 3.02 (WebGL) | 83% | 0.15 / 0.46 (WebGL) | 33% | 144.0 / n/a | 1.61 | 99af952b | 20260929-031330-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 4.04 / 5.64 (WebGL) | 72% | 0.35 / 3.25 (WebGL) | 11% | 142.6 / 132.0 | 1.92 | 265a118a | 20261003-053621-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 2.31 / 2.97 (WebGL) | 78% | 0.15 / 0.78 (WebGL) | 20% | 144.0 / 144.0 | 1.95 | 3b79b9da | 20261003-123340-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 1.67 / 2.81 (WebGL) | 59% | 0.14 / 1.50 (WebGL) | 10% | 144.0 / 144.0 | 1.94 | 21de365f | 20261003-171051-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 2.10 / 2.98 (WebGL) | 70% | 0.15 / 1.07 (WebGL) | 14% | 143.9 / 144.0 | 1.94 | 21de365f | 20261003-173411-bench |

- The rows of 27 and 28 September name the engine by its earlier name in their run folders. The archive gives their pages null3D's names.
- Rows without three.js's own work come from runs that had no scene-code page yet.
- The gate rehearsal's desktop target is 20261003-053621-bench: 0.35 ms against 3.25 ms of own work, 11%. Other work loaded the Mac in that run ([Releases](releases.md#rehearsal-on-the-mac-3-october-2026)).
- A later full run of `bun run gate`, on 3 October at 21de365f, measured the desktop target in 20261003-173411-bench: 14%. That commit was not on main.

## S1 at phone scale

S1 at the count where three.js holds about 30 frames per second on a phone or a tablet: 240,000 to 300,000 boxes. It is the scene of the phone target: whole frame at most 100% of three.js, on the S24+ and the iPad.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 250,000 | 13.42 / 23.32 (WebGL) | 58% | 2.67 / 9.58 (WebGL) | 28% | 59.6 / n/a | n/a | a5e55231 | 20260929-080341-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 250,000 | 20.54 / 22.17 (WebGL) | 93% | 5.92 / 8.45 (WebGL) | 70% | 34.4 / n/a | n/a | a5e55231 | 20260929-081111-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 250,000 | 21.22 / 25.14 (WebGL) | 84% | 8.11 / 9.82 (WebGL) | 83% | 30.3 / n/a | n/a | a5e55231 | 20260929-082540-bench |
| 2026-09-29 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 250,000 | 23.06 / 25.32 (WebGL) | 91% | 6.79 / 10.00 (WebGL) | 68% | 29.5 / n/a | n/a | a5e55231 | 20260929-083448-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 300,000 | 24.89 / 39.52 (WebGL) | 63% | 6.31 / 20.67 (WebGL) | 31% | 29.1 / 24.7 | n/a | a5e55231 | 20260929-090632-bench |
| 2026-09-29 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 300,000 | 21.22 / 34.98 (WebGL) | 61% | 5.62 / 19.99 (WebGL) | 28% | 30.4 / 28.7 | n/a | 51fb3c3f | 20260929-093023-bench |
| 2026-09-29 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 300,000 | 26.18 / 38.17 (WebGL) | 69% | 7.23 / 19.78 (WebGL) | 37% | 28.5 / 25.8 | n/a | 51fb3c3f | 20260929-094743-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGPU | 240,000 | 15.52 / 22.56 (WebGL) | 69% | 2.36 / 9.44 (WebGL) | 25% | 26.8 / 18.3 | 27.78 | f7bf1dc3 | 20260929-155111-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGL2 | 240,000 | 15.60 / 22.56 (WebGL) | 69% | 1.86 / 9.44 (WebGL) | 20% | 28.9 / 18.3 | n/a | f7bf1dc3 | 20260929-155111-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGPU, low latency | 240,000 | 18.58 / 22.56 (WebGL) | 82% | 3.47 / 9.44 (WebGL) | 37% | 18.3 / 18.3 | 27.88 | f7bf1dc3 | 20260929-155111-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGL2, low latency | 240,000 | 17.40 / 22.56 (WebGL) | 77% | 2.98 / 9.44 (WebGL) | 32% | 29.0 / 18.3 | n/a | f7bf1dc3 | 20260929-155111-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 240,000 | 21.08 / 22.20 (WebGL) | 95% | 7.14 / 7.07 (WebGL) | 101% | 32.5 / 44.1 | n/a | 419fff4b | 20260929-164448-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2, low latency | 240,000 | 21.60 / 22.20 (WebGL) | 97% | 6.89 / 7.07 (WebGL) | 98% | 40.4 / 44.1 | n/a | 419fff4b | 20260929-164448-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 240,000 | 22.15 / 22.11 (WebGL) | 100% | 7.57 / 8.96 (WebGL) | 84% | 30.0 / 44.2 | n/a | 419fff4b | 20260929-171803-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 240,000 | 16.84 / 28.11 (WebGL) | 60% | 4.90 / n/a | n/a | 40.0 / 34.8 | n/a | 0d47b896 | 20260929-172838-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 240,000 | 22.13 / 21.62 (WebGL) | 102% | 7.02 / n/a | n/a | 30.1 / 46.0 | n/a | 394bafb2 | 20260929-190716-bench |
| 2026-09-30 | ipad-brave, Brave | WebGPU | 240,000 | 15.80 / 28.92 (WebGPU) | 55% | 2.42 / 15.80 (WebGPU) | 15% | 26.8 / 30.4 | 27.74 | 104ea318 | 20260930-010518-bench |
| 2026-09-30 | ipad-brave, Brave | WebGL2 | 240,000 | 16.02 / 28.92 (WebGPU) | 55% | 1.86 / 15.80 (WebGPU) | 12% | 29.0 / 30.4 | n/a | 104ea318 | 20260930-010518-bench |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 300,000 | 19.00 / 37.47 (WebGL) | 51% | 3.46 / 23.39 (WebGL) | 15% | 35.5 / 25.6 | n/a | 9cc39e8c | 20261002-065107-bench |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2, low latency | 300,000 | 20.54 / 37.47 (WebGL) | 55% | 5.08 / 23.39 (WebGL) | 22% | 37.1 / 25.6 | n/a | 9cc39e8c | 20261002-065107-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 300,000 | 24.24 / 46.91 (WebGL) | 52% | 5.60 / 29.60 (WebGL) | 19% | 29.6 / 20.7 | n/a | 9cc39e8c | 20261002-070947-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 300,000 | 33.09 / 46.91 (WebGL) | 71% | 10.21 / 29.60 (WebGL) | 34% | 28.9 / 20.7 | n/a | 9cc39e8c | 20261002-070947-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 300,000 | 20.62 / 38.81 (WebGL) | 53% | 5.13 / 24.59 (WebGL) | 21% | 34.7 / 25.0 | n/a | 3d265d6c | 20261002-090506-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 300,000 | 24.52 / 38.81 (WebGL) | 63% | 8.43 / 24.59 (WebGL) | 34% | 36.1 / 25.0 | n/a | 3d265d6c | 20261002-090506-bench |
| 2026-10-03 | sm-s926b-brave, Brave 154.0.0.0 | WebGL2 | 300,000 | 19.45 / 30.31 (WebGL) | 64% | 7.13 / 19.50 (WebGL) | 37% | 32.2 / 32.0 | n/a | 3b79b9da | 20261003-143100-bench |
| 2026-10-03 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 300,000 | 24.64 / 37.67 (WebGL) | 65% | 7.62 / 21.37 (WebGL) | 36% | 29.9 / 25.9 | n/a | 3b79b9da | 20261003-143100-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGPU | 256,000 | 16.40 / 31.22 (WebGPU) | 53% | 2.42 / 17.48 (WebGPU) | 14% | 28.0 / 28.4 | 27.95 | 3b79b9da | 20261003-160710-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGL2 | 256,000 | 17.10 / 31.22 (WebGPU) | 55% | 4.14 / 17.48 (WebGPU) | 24% | 27.3 / 28.4 | n/a | 3b79b9da | 20261003-160710-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGL2 | 256,000 | 17.12 / 31.30 (WebGPU) | 55% | 4.16 / 17.56 (WebGPU) | 24% | 27.5 / 28.4 | n/a | 21de365f | 20261003-185749-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGPU | 256,000 | 16.40 / 31.34 (WebGPU) | 52% | 2.42 / 17.60 (WebGPU) | 14% | 27.9 / 28.3 | 28.11 | 5309dba5 | 20261004-042305-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGL2 | 256,000 | 17.16 / 31.34 (WebGPU) | 55% | 4.20 / 17.60 (WebGPU) | 24% | 26.9 / 28.3 | n/a | 5309dba5 | 20261004-042305-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGPU | 256,000 | 16.48 / 29.59 (WebGPU) | 56% | 2.48 / 15.92 (WebGPU) | 16% | 27.9 / 29.0 | 27.70 | 5309dba5 | 20261004-085744-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGL2 | 256,000 | 17.22 / 29.59 (WebGPU) | 58% | 4.22 / 15.92 (WebGPU) | 27% | 27.5 / 29.0 | n/a | 5309dba5 | 20261004-085744-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGPU | 256,000 | 16.44 / 31.32 (WebGPU) | 52% | 2.40 / 17.56 (WebGPU) | 14% | 28.0 / 28.4 | 28.03 | 5309dba5 | 20261004-125547-bench |
| 2026-10-04 | ipad-safari, Safari 26.6.2 | WebGL2 | 256,000 | 17.18 / 31.32 (WebGPU) | 55% | 4.14 / 17.56 (WebGPU) | 24% | 27.3 / 28.4 | n/a | 5309dba5 | 20261004-125547-bench |

- Heat moves the S24+'s figures a lot. The controlled rerun of 29 September measured 100%, and the sustained run 60% ([D-06](decisions/D-06-success-targets.md#addendum-2026-09-30-the-controlled-rerun-on-the-s24)).
- The rows of 4 October on the iPad are the gate commit, 5309dba5. 20261004-125547-bench is the gate's item 3 on the iPad.
- On the iPad the GPU limits null3D's frame rate at this count, at about 28 ms of GPU time per frame.

## S1-static

S1-static draws S1's boxes standing still, so only the camera moves.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 0.08 / 0.06 (WebGL) | 146% | 0.08 / n/a | n/a | n/a / n/a | 0.41 | b1226fda | 20260927-111433-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 100,000 | 0.36 / 0.10 (WebGL) | 379% | 0.34 / 0.09 (WebGL) | 383% | 143.9 / n/a | n/a | 99af952b | 20260929-030705-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 100,000 | 0.26 / 0.09 (WebGL) | 300% | 0.23 / 0.09 (WebGL) | 271% | 144.0 / n/a | n/a | 99af952b | 20260929-031133-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 100,000 | 0.33 / 0.08 (WebGL) | 413% | 0.30 / 0.08 (WebGL) | 381% | 144.0 / n/a | n/a | 99af952b | 20260929-031330-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGPU | 100,000 | 0.13 / 0.08 (WebGL) | 156% | 0.13 / 0.08 (WebGL) | 156% | 144.0 / n/a | 0.41 | 99af952b | 20260929-031330-bench |

- These rows are from the WebGL2 path's first branch, before its upload changes. three.js's WebGL renderer draws still boxes very cheaply, and the owner accepted ties or small losses there on 29 September ([D-06](decisions/D-06-success-targets.md#addendum-2026-09-29-faster-than-threejs-in-every-kind-of-scene)). The final sweep of that branch is 20260929-055234-sweep.

## S1-cells

S1-cells spreads S1-static's boxes over 8 x 8 grid cells, and the camera flies low over them ([Benchmarks](benchmarks.md#grid-cell-culling)). The gate measures it against three.js and records the figures.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-30 | Apple M5 Max, Chrome 154 | WebGL2 | n/a | 0.07 / 0.07 (WebGL) | 100% | n/a | n/a | n/a | n/a | unknown | [Benchmarks](benchmarks.md#grid-cell-culling) |
| 2026-09-30 | Apple M5 Max, Chrome 154 | WebGPU | n/a | 0.10 / 0.07 (WebGL) | 143% | n/a | n/a | n/a | 0.11 | unknown | [Benchmarks](benchmarks.md#grid-cell-culling) |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 100,000 | 0.07 / 0.03 (WebGL) | 250% | 0.06 / 0.03 (WebGL) | 200% | 144.0 / 144.0 | n/a | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 0.06 / 0.03 (WebGL) | 200% | 0.06 / 0.03 (WebGL) | 183% | 144.0 / 144.0 | 0.23 | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 100,000 | 0.06 / 0.06 (WebGL) | 109% | 0.05 / 0.06 (WebGL) | 91% | 143.9 / 144.0 | n/a | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 0.08 / 0.06 (WebGL) | 146% | 0.08 / 0.06 (WebGL) | 146% | 144.0 / 144.0 | 0.23 | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGPU | 100,000 | 0.20 / 0.72 (WebGL) | 28% | 0.20 / 0.72 (WebGL) | 28% | 60.0 / 60.0 | 1.55 | 3b79b9da | 20261003-162541-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGL2 | 100,000 | 0.78 / 0.72 (WebGL) | 108% | 0.78 / 0.72 (WebGL) | 108% | 60.0 / 60.0 | n/a | 3b79b9da | 20261003-162541-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 100,000 | 0.07 / 0.07 (WebGL) | 108% | 0.06 / 0.07 (WebGL) | 92% | 144.0 / 144.0 | n/a | 21de365f | 20261003-174604-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 100,000 | 0.08 / 0.07 (WebGL) | 123% | 0.08 / 0.07 (WebGL) | 123% | 144.0 / 144.0 | 0.22 | 21de365f | 20261003-174604-bench |

- Every figure here is under 0.15 ms, near the browser timer's step of 5 microseconds. The two rows of 30 September come from the benchmarks guide. Their run folder is no longer on disk, so the archive has no record of them.

## S2

S2 is a forest of 5,096 nodes in a hierarchy of 6 levels.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 5,096 | 0.20 / 3.02 (WebGL) | 7% | 0.20 / n/a | n/a | n/a / n/a | 0.17 | b1226fda | 20260927-111433-bench |
| 2026-09-27 | Apple M5 Max, Chrome 153 | WebGPU | 5,096 | 0.26 / 3.02 (WebGL) | 8% | 0.24 / n/a | n/a | n/a / n/a | 0.22 | 4aa431c8 | 20260927-123759-bench |
| 2026-09-29 | Apple M5 Max, Chrome 153 | WebGL2 | 5,096 | 0.38 / 3.33 (WebGL) | 11% | 0.36 / 3.33 (WebGL) | 11% | 144.0 / n/a | n/a | 99af952b | 20260929-030705-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGPU | 5,096 | 0.32 / 10.62 (WebGL) | 3% | 0.30 / 10.62 (WebGL) | 3% | 60.6 / 55.8 | 2.19 | 419fff4b | 20260929-165718-bench |
| 2026-09-29 | ipad-safari, Safari 26.6.2 | WebGL2 | 5,096 | 0.38 / 10.62 (WebGL) | 4% | 0.32 / 10.62 (WebGL) | 3% | 57.8 / 55.8 | n/a | 419fff4b | 20260929-165718-bench |
| 2026-09-29 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 5,096 | 1.72 / 10.62 (WebGL) | 16% | 1.65 / n/a | n/a | 59.9 / 59.9 | n/a | 394bafb2 | 20260929-192015-bench |

## S3

S3 lights 20,000 still boxes with 256 moving point lights ([Benchmarks](benchmarks.md#many-point-lights)). three.js's WebGL renderer cannot build the shader for 256 point lights on most GPUs, so those rows say failed.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 20,000 | 1.81 / failed | n/a | 1.49 / failed | n/a | 59.9 / failed | n/a | 9cc39e8c | 20261002-054912-bench |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2, low latency | 20,000 | 0.95 / failed | n/a | 0.86 / failed | n/a | 59.9 / failed | n/a | 9cc39e8c | 20261002-054912-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 20,000 | 3.60 / failed | n/a | 3.31 / failed | n/a | 59.9 / failed | n/a | 3d265d6c | 20261002-094753-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 20,000 | 1.49 / failed | n/a | 1.39 / failed | n/a | 59.9 / failed | n/a | 3d265d6c | 20261002-094753-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 20,000 | 3.81 / failed | n/a | 3.51 / failed | n/a | 59.9 / failed | n/a | bdf035ed | 20261002-130920-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 20,000 | 1.48 / failed | n/a | 1.39 / failed | n/a | 59.9 / failed | n/a | bdf035ed | 20261002-130920-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGPU | 20,000 | 0.34 / 2.00 (WebGPU) | 17% | 0.28 / 1.94 (WebGPU) | 14% | 60.0 / 60.0 | 9.54 | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGL2 | 20,000 | 25.86 / 2.00 (WebGPU) | 1293% | 25.86 / 1.94 (WebGPU) | 1333% | 35.5 / 60.0 | n/a | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGPU, low latency | 20,000 | 0.44 / 2.00 (WebGPU) | 22% | 0.38 / 1.94 (WebGPU) | 20% | 58.6 / 60.0 | 14.26 | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGL2, low latency | 20,000 | 30.49 / 2.00 (WebGPU) | 1524% | 30.43 / 1.94 (WebGPU) | 1569% | 30.2 / 60.0 | n/a | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | Apple M5 Max, Chrome 154 | WebGPU | 20,000 | 0.09 / 0.44 (WebGPU) | 19% | 0.08 / 0.43 (WebGPU) | 18% | 144.0 / 144.0 | 3.08 | c6e483bc | 20261002-215250-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 20,000 | 0.20 / 0.28 (WebGPU) | 70% | 0.18 / 0.28 (WebGPU) | 65% | 144.0 / 144.0 | n/a | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 20,000 | 0.13 / 0.28 (WebGPU) | 46% | 0.11 / 0.28 (WebGPU) | 40% | 144.0 / 144.0 | 3.00 | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 20,000 | 0.21 / 0.56 (WebGPU) | 38% | 0.20 / 0.56 (WebGPU) | 36% | 143.8 / 144.0 | n/a | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 20,000 | 0.12 / 0.56 (WebGPU) | 20% | 0.10 / 0.56 (WebGPU) | 17% | 144.0 / 144.0 | 2.97 | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGPU | 20,000 | 0.20 / 3.10 (WebGPU) | 6% | 0.16 / 3.00 (WebGPU) | 5% | 59.9 / 60.0 | 9.35 | 3b79b9da | 20261003-162541-bench |
| 2026-10-03 | ipad-safari, Safari 26.6.2 | WebGL2 | 20,000 | 0.70 / 3.10 (WebGPU) | 23% | 0.70 / 3.00 (WebGPU) | 23% | 49.8 / 60.0 | n/a | 3b79b9da | 20261003-162541-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 20,000 | 0.17 / failed | n/a | 0.17 / failed | n/a | 144.0 / failed | n/a | 21de365f | 20261003-172244-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 20,000 | 0.07 / failed | n/a | 0.06 / failed | n/a | 144.0 / failed | 2.96 | 21de365f | 20261003-172244-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 20,000 | 0.27 / 0.57 (WebGPU) | 47% | 0.25 / 0.56 (WebGPU) | 44% | 143.8 / 144.0 | n/a | 21de365f | 20261003-174604-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 20,000 | 0.12 / 0.57 (WebGPU) | 21% | 0.10 / 0.56 (WebGPU) | 17% | 143.9 / 144.0 | 2.99 | 21de365f | 20261003-174604-bench |

- The iPad's WebGL2 rows of 2 October are from before the WebGL2 path stopped waiting for the GPU ([#212](https://github.com/null3d-engine/null3d/pull/212)). The rows of 3 October measure after it.

## S4

S4 is the phone scene: a town of 5,000 still objects and 200 cars, with shadows, street lights and fog ([Benchmarks](benchmarks.md#the-phone-scene)). Its frame rate target is in each record's traces, and [D-06](decisions/D-06-success-targets.md#addendum-2026-10-02-s3-s4-and-s1-at-phone-scale-on-each-device) gives the seconds that held it.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2 | 5,000 | 4.35 / 6.42 (WebGL) | 68% | 4.17 / 6.33 (WebGL) | 66% | 59.9 / 59.9 | n/a | 9cc39e8c | 20261002-053620-bench |
| 2026-10-02 | sm-s926b-chrome, Chrome 154.0.8037.57 | WebGL2, low latency | 5,000 | 1.51 / 6.42 (WebGL) | 24% | 1.45 / 6.33 (WebGL) | 23% | 59.9 / 59.9 | n/a | 9cc39e8c | 20261002-053620-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 5,000 | 3.65 / 6.45 (WebGL) | 57% | 3.44 / 6.36 (WebGL) | 54% | 59.9 / 59.9 | n/a | 3d265d6c | 20261002-094753-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 5,000 | 1.71 / 6.45 (WebGL) | 26% | 1.64 / 6.36 (WebGL) | 26% | 59.9 / 59.9 | n/a | 3d265d6c | 20261002-094753-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2 | 5,000 | 4.30 / 6.36 (WebGL) | 68% | 4.15 / 6.27 (WebGL) | 66% | 59.9 / 59.9 | n/a | bdf035ed | 20261002-130920-bench |
| 2026-10-02 | sm-s926b-brave, Brave 153.0.0.0 | WebGL2, low latency | 5,000 | 1.64 / 6.36 (WebGL) | 26% | 1.57 / 6.27 (WebGL) | 25% | 59.9 / 59.9 | n/a | bdf035ed | 20261002-130920-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGPU | 5,000 | 0.18 / 7.74 (WebGL) | 2% | 0.16 / 7.72 (WebGL) | 2% | 59.9 / 15.5 | 8.20 | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGL2 | 5,000 | 15.18 / 7.74 (WebGL) | 196% | 15.18 / 7.72 (WebGL) | 197% | 54.2 / 15.5 | n/a | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGPU, low latency | 5,000 | 0.40 / 7.74 (WebGL) | 5% | 0.36 / 7.72 (WebGL) | 5% | 52.8 / 15.5 | 13.39 | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | ipad-safari, Safari 26.6.2 | WebGL2, low latency | 5,000 | 21.30 / 7.74 (WebGL) | 275% | 21.26 / 7.72 (WebGL) | 275% | 41.8 / 15.5 | n/a | fdc9e303 | 20261002-151739-bench |
| 2026-10-02 | Apple M5 Max, Chrome 154 | WebGPU | 5,000 | 0.07 / 2.38 (WebGL) | 3% | 0.07 / 2.38 (WebGL) | 3% | 144.0 / 144.0 | 1.41 | c6e483bc | 20261002-215250-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 5,000 | 0.24 / 1.68 (WebGL) | 14% | 0.23 / 1.68 (WebGL) | 13% | 144.0 / 144.0 | n/a | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 5,000 | 0.10 / 1.68 (WebGL) | 6% | 0.09 / 1.68 (WebGL) | 5% | 144.0 / 144.0 | 1.45 | 265a118a | 20261003-054756-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 5,000 | 0.24 / 1.78 (WebGL) | 13% | 0.23 / 1.78 (WebGL) | 13% | 143.9 / 144.0 | n/a | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 5,000 | 0.13 / 1.78 (WebGL) | 7% | 0.10 / 1.78 (WebGL) | 6% | 143.9 / 144.0 | 1.60 | 3b79b9da | 20261003-124533-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGL2 | 5,000 | 0.33 / 1.77 (WebGL) | 19% | 0.32 / 1.76 (WebGL) | 18% | 143.9 / 144.0 | n/a | 21de365f | 20261003-174604-bench |
| 2026-10-03 | Apple M5 Max, Chrome 154 | WebGPU | 5,000 | 0.13 / 1.77 (WebGL) | 7% | 0.10 / 1.76 (WebGL) | 5% | 144.0 / 144.0 | 1.74 | 21de365f | 20261003-174604-bench |

- The iPad's WebGL2 rows of 2 October are from before [#212](https://github.com/null3d-engine/null3d/pull/212), as in S3.

## S5

S5 draws animated characters, 500 by default, with shadows. Its scene and pages are on a branch that has not merged yet, so these rows measure that branch.

| Date | Device and browser | GPU path | Objects | Whole frame, ms: null3D / three.js | Share | Own work, ms: null3D / three.js | Share | fps: null3D / three.js | GPU ms, null3D | Commit | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGL2 | 500 | 0.70 / 48.75 (WebGL) | 1% | 0.66 / 48.74 (WebGL) | 1% | 8.4 / 20.4 | n/a | 2b72afe2 | 20261004-101139-bench |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGPU | 500 | 1.94 / 48.75 (WebGL) | 4% | 1.94 / 48.74 (WebGL) | 4% | 118.4 / 20.4 | 4.35 | 2b72afe2 | 20261004-101139-bench |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGL2 | 100 | 0.30 / 9.87 (WebGL) | 3% | 0.28 / n/a | n/a | 120.0 / 99.7 | n/a | 2b72afe2 | 20261004-102009-bench |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGL2 | 25 | 0.21 / 3.39 (WebGL) | 6% | 0.19 / n/a | n/a | 120.0 / 120.0 | n/a | 2b72afe2 | 20261004-102052-bench |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGL2 | 500 | 1.25 / 54.02 (WebGL) | 2% | 1.20 / 54.00 (WebGL) | 2% | 120.0 / 18.4 | n/a | 5711b3b4 | 20261004-112928-bench |
| 2026-10-04 | Apple M5 Max, Chrome 154 | WebGPU | 500 | 2.32 / 54.02 (WebGL) | 4% | 2.32 / 54.00 (WebGL) | 4% | 60.0 / 18.4 | 7.38 | 5711b3b4 | 20261004-112928-bench |

## Feature GPU costs on phones

These tables give what single features cost on cloud phones, from BrowserStack Automate. They are not comparisons with three.js. Each figure is GPU time from the browser's GPU timer, on WebGPU, unless a row says otherwise. Chrome on these phones has no GPU timer for WebGL2. The Galaxy S25's screen ran at 30 Hz in these runs, so the device runner marks its frame figures unreliable. Its GPU times do not depend on the screen. The archive in `bench/results` keeps no runs of these plans, so the run folders' names are the sources.

### Bloom by base size

Bloom's cost is the GPU time per frame with bloom on, less the time with it off, on the same page. The base is the height of the mip chain's first level, in rows ([D-21](decisions/D-21-effect-chain.md)). Commit fb9d0b1d, on the branch `feat/m2-f7-mip-bloom`, on 5 October 2026. Sources: the `bloom-sizes` plan's runs 20261005-010104-bloom-sizes (Galaxy S25, Pixel 9) and 20261005-010847-bloom-sizes (Pixel 11).

| Device and browser | Render scale | Base 512 | Base 256 | Base 128 | Base 64 |
| --- | --- | --- | --- | --- | --- |
| Galaxy S25 (Adreno 830), Chrome 149 | 1 | 1.57 ms | 1.57 ms | 1.25 ms | 0.92 ms |
| Galaxy S25 (Adreno 830), Chrome 149 | 0.5 | 1.67 ms | 1.64 ms | 1.25 ms | 1.11 ms |
| Pixel 9 (Mali-G715), Chrome 149 | 1 | 0.79 ms | 0.72 ms | 0.66 ms | 0.79 ms |
| Pixel 9 (Mali-G715), Chrome 149 | 0.5 | 0.79 ms | 0.98 ms | 0.79 ms | 0.59 ms |
| Pixel 11 (PowerVR C-Series), Chrome 149 | 1 | 4.59 ms | 4.26 ms | 3.80 ms | 3.28 ms |
| Pixel 11 (PowerVR C-Series), Chrome 149 | 0.5 | 4.26 ms | 4.39 ms | 3.80 ms | 3.21 ms |

The presets' chains: Low has a base of 128 rows; Medium, High and Ultra 512. The `bloom` plan runs each phone's own preset. Its runs, 20261005-011315-bloom (Galaxy S25, Pixel 9) and 20261005-011736-bloom (Pixel 11), gave:

| Device and browser | Render scale 1 | Render scale 0.5 |
| --- | --- | --- |
| Galaxy S25 (Adreno 830), Chrome 149 | 1.25 ms | 1.21 ms |
| Pixel 9 (Mali-G715), Chrome 149 | 0.85 ms | 0.85 ms |
| Pixel 11 (PowerVR C-Series), Chrome 149 | 3.87 ms | 3.60 ms |

The Galaxy S25's and the Pixel 11's figures match the 128-row base of Low. The Pixel 9's figures vary by about 0.3 ms between runs of one size, so they do not show its chain. With WebGL2, every page held the screen's frame rate with bloom on and off.

### The room's prefilter

The prototype of M2-E2's built-in room makes the room's environment map on the GPU, in steps across frames. The table gives the first map of the packed path (`rgb9e5ufloat` packed into RGBA8), with steps sized by the kind of draw. The limits that the prototype tests are under 8 ms for each step and under 200 ms in all. Commit 0a0a7d90, on the branch `proto/l1-room`, on 5 October 2026. Sources: runs 20261005-004323-prefilter (Galaxy S25), 20261005-004623-prefilter (Pixel 9), 20261005-005022-prefilter (Pixel 10) and 20261005-005528-prefilter (Pixel 11). With WebGL2 the times are wall times from the call to the finish, because there is no GPU timer.

| Device and browser | GPU path | Total | Steps | Largest step | Steps over 8 ms | Map matches the asset tool's file |
| --- | --- | --- | --- | --- | --- | --- |
| Galaxy S25 (Adreno 830), Chrome 149 | WebGPU | 377.5 ms | 61 | 12.06 ms | 24 | yes |
| Galaxy S25 (Adreno 830), Chrome 149 | Compatibility mode | 244.4 ms | 48 | 8.72 ms | 8 | yes |
| Galaxy S25 (Adreno 830), Chrome 149 | WebGL2, wall time | 498.3 ms | 64 | 101.18 ms | 11 | yes |
| Pixel 9 (Mali-G715), Chrome 149 | WebGPU | 651.4 ms | 96 | 12.19 ms | 16 | yes |
| Pixel 9 (Mali-G715), Chrome 149 | Compatibility mode | 622.7 ms | 96 | 12.19 ms | 12 | yes |
| Pixel 9 (Mali-G715), Chrome 149 | WebGL2, wall time | 464.4 ms | 75 | 9.96 ms | 11 | yes |
| Pixel 10 (PowerVR D-Series), Chrome 149 | WebGPU | 399.4 ms | 59 | 14.75 ms | 24 | yes |
| Pixel 10 (PowerVR D-Series), Chrome 149 | Compatibility mode | 400.8 ms | 59 | 14.81 ms | 24 | yes |
| Pixel 10 (PowerVR D-Series), Chrome 149 | WebGL2, wall time | 1307.3 ms | 136 | 143.58 ms | 51 | yes |
| Pixel 11 (PowerVR C-Series), Chrome 149 | WebGPU | 367.8 ms | 57 | 12.85 ms | 24 | yes |
| Pixel 11 (PowerVR C-Series), Chrome 149 | Compatibility mode | 364.1 ms | 57 | 12.71 ms | 24 | yes |
| Pixel 11 (PowerVR C-Series), Chrome 149 | WebGL2, wall time | 716.0 ms | 67 | 256.20 ms | 20 | yes |

The whole map in one step took this GPU time:

- Galaxy S25: 81.9 ms
- Pixel 9: 106.0 ms
- Pixel 10: 83.6 ms
- Pixel 11: 38.7 ms

The largest WebGL2 steps of 101 to 256 ms are single stalls. The same runs found two faults. The 11-11-10 format misses D-19's tolerance on every path. WebGL2 cannot write half floats straight into the cube (GL error 0x502).

The second run of the prototype, at commit c0c104e4 on 5 October 2026, timed the design that M2-E9 takes. The engine makes the whole map in one step at load (`load=1`), right after the warm-up draws. Sources: runs 20261005-024553-prefilter (Galaxy S25, Pixel 9, Pixel 10) and 20261005-025041-prefilter (Pixel 11). WebGL2 gives wall time from the call to the finish. The pipelines build first, in the background.

| Device and browser | Map at load, WebGPU | Map at load, WebGL2 | Pipelines, WebGPU | Pipelines, WebGL2 |
| --- | --- | --- | --- | --- |
| Galaxy S25 (Adreno 830), Chrome 149 | 66.7 ms | 76.6 ms | 92.7 ms | 109.3 ms |
| Pixel 9 (Mali-G715), Chrome 149 | 99.7 ms | 107.3 ms | 128.7 ms | 173.6 ms |
| Pixel 10 (PowerVR D-Series), Chrome 149 | 87.2 ms | 57.7 ms | 128.2 ms | 225.5 ms |
| Pixel 11 (PowerVR C-Series), Chrome 149 | 47.8 ms | 72.5 ms | 111.5 ms | 100.3 ms |

The same day, held sessions timed the engine's generator on the branch `feat/m2-e9-room-at-load` (commit 0d49786c). On the Galaxy S25 its first map at load took 92.7 ms on WebGPU, 89.7 ms in compatibility mode and 94.3 ms with WebGL2. On the Pixel 9 it took 126.2, 120.6 and 127.1 ms. Its map matched the asset tool's on every path.

### Two commits on one cloud device

Each comparison ran in one held Automate session, which moved between two dev servers, one per commit, in turns A, B, A, B. Each turn measured 30 s of S4 at Low with the governor off.

The gate fix's GPU time on the cloud iPad (iPad 10th, Safari 27.0, WebGPU, screen at 60 Hz), 5 October 2026:

| Turn | Commit | Run | GPU ms | Draw calls | fps |
| --- | --- | --- | --- | --- | --- |
| A | 1533939f (main) | 20261005-031515-bench | 13.02 | 63 | 22.1 |
| B | 84e2bd47 (`fix/gate-ab-regression`) | 20261005-031849-bench | 12.58 | 56 | 22.7 |
| A | 1533939f (main) | 20261005-032203-bench | 13.40 | 63 | 22.2 |
| B | 84e2bd47 (`fix/gate-ab-regression`) | 20261005-032547-bench | 12.14 | 56 | 22.8 |

The cloud iPad draws S4 at about 22 fps on WebGPU and 33 fps with WebGL2. Its screen runs at 60 Hz, and its video recording makes no difference. The page's GPU work takes 12 to 15 ms a frame, but each frame waits 44 to 60 ms for the GPU. So its frame rates do not compare with the owner's iPad. Its GPU times do compare between commits in one session.

The shadow fix's cost with WebGL2 on the Galaxy S25 (Chrome 149, screen at 24 to 30 Hz, no GPU timer), 5 October 2026:

| Turn | Commit | Run | fps, seconds at 30 fps | Frame interval p95 | CPU ms per frame, median / p95 |
| --- | --- | --- | --- | --- | --- |
| A | fd681ea5 (main) | 20261005-034131-bench | 30.0, 30 of 30 | 33.33 ms | 0.77 / 1.84 |
| B | c1a764dc (`fix/shadow-contact-gap`) | 20261005-034457-bench | 30.0, 30 of 30 | 33.34 ms | 0.81 / 1.79 |
| A | fd681ea5 (main) | 20261005-034842-bench | 30.0, 30 of 30 | 33.34 ms | 0.83 / 1.86 |
| B | c1a764dc (`fix/shadow-contact-gap`) | 20261005-035202-bench | 30.0, 30 of 30 | 33.33 ms | 0.77 / 1.79 |

Both commits held the screen's rate, so the fix's extra shadow reads fit in the frame there. The screen's low rate hides a GPU cost below about 33 ms.

## The other runs in the archive

The archive also keeps runs that compare no engine with three.js. Their records hold the figures that the guides and decision records cite.

- Comparisons of two builds (`-compare`): each page's medians in both builds, the change, the verdict, and each run.
- Sweeps (`-sweep`): one run of each page at each object count. [D-06](decisions/D-06-success-targets.md#addendum-2026-09-29-faster-than-threejs-in-every-kind-of-scene) gives their tables.
- Scale searches (`-scale`): the counts that each three.js renderer held, step by step.
- Governor, soak and startup runs: the device runner's report of each runner, and each page's result without images and long lists.
- Gate runs (`-gate`): each step's figure and verdict, and the benchmark runs that the timing steps made.
- Runs of null3D's pages alone, such as the WebGL call timing pages and the depth prepass pages. The runs of S4 with the band between shadow cascades on and off are of this kind ([D-73](decisions/D-73-cascade-blend.md)): `20261005-094430-bench` to `20261005-095758-bench`.

## Add a run

After every benchmark, scale, governor, soak, startup or gate run, archive it and add its rows here:

1. Run `bun run bench:archive <run folder or run name>`. It writes `bench/results/<run>.json` and prints the run's rows, by table.
2. Paste the rows into the tables above, in date order. Add a note where a figure needs one, such as heat or a known fault.
3. Commit the record and this page together.

`bun run bench:archive --rows` prints the rows of every record, for a check of the tables.
