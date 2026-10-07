# D-87: Indirect argument copies only in Apple's WebKit, an exception to hard rule 14

Status: decided by the owner on 2026-10-06, until a Safari release with WebKit's fix. Date: 2026-10-06. Task: fix/indirect-copies-gpu (an M1 gate blocker).

Summary: Chrome checks each indirect draw with a compute pass for each buffer that a render pass reads, so D-85's buffer per draw doubled S4's GPU time in Chrome. The copies run only when the user agent names Apple's WebKit, and go once Safari ships the fix.

## Question

[D-85](D-85-safari-indirect-arguments.md) gives each indexed indirect draw of a render pass its own copy of its arguments, in every browser, since Safari 26 hangs the GPU without them. In Chrome on the Mac, that doubled S4's GPU time at Low. Can the engine keep Safari's protection without that cost elsewhere?

## Rule

- No GPU reset, and the right image, in Safari 26 on WebGPU and in compatibility mode.
- Chrome and Firefox get back the GPU time they had before D-85.
- No feature test may hang the GPU, and any choice by browser stays small, in one place, with unit tests for the user agents, and goes once Safari has the fix.

## Data

Chrome 154 on the owner's Mac (M5 Max), S4 at Low on WebGPU, governor off, GPU time per frame. Each comparison ran its builds in turns, 10 s per run.

| Build | GPU ms | Runs |
| --- | --- | --- |
| Main before D-85 (2aa1447f1) | 1.415 (mean of means) | gpu-regress, 3 rounds, 144 Hz, mains power |
| Main without D-85 | 1.419 | The same rounds |
| Main with D-85 | 2.711 | The same rounds |
| D-85 with all of a frame's copies moved before its first render pass | 2.678, against main's 2.737 in the same rounds (medians) | 4 rounds, 144 Hz, load 9.6 |

Each pass took the same time in all these builds. With D-85, the GPU timer's "between passes" part grew from 0 to about 0.7 ms, and the passes no longer overlapped. Moving the copies did not change that, so the cost was not the copies' place in the frame.

Chrome's WebGPU layer, Dawn, checks each indexed indirect draw on the GPU before its render pass (`IndirectDrawValidationEncoder.cpp`). For each render pass it adds one small compute pass for each indirect buffer that the pass's draws read, with an upload and a bind group of its own. Before D-85, a pass's draws read one buffer, so each render pass got one such compute pass. With D-85, each draw reads a buffer of its own, so a pass of 10 draws gets 10. Two builds checked this, in a quiet window (Mac on battery at 120 Hz, so every figure is about twice the figure at 144 Hz on mains):

| Build | GPU ms, median of each run |
| --- | --- |
| No copies | 3.38, 3.39, 3.46, 3.25 |
| Copies made each frame, every draw reading one shared copy buffer | 3.28, 3.50, 3.44, 3.46 |
| No copies, a second comparison | 2.03, 3.42, 3.44, 3.40 |
| A copy buffer for each draw (D-85) | 3.32, 4.82, 4.38, 4.64 |

The copies cost nothing. Separate buffers cost 1.0 to 1.4 ms. Safari needs exactly the separate buffers: Safari 26 keeps one clamp slot per buffer, and it skips the clamp only for pipelines with no vertex buffers, which the engine's meshes always have (WebKit's `computeMininumVertexInstanceCount`). Safari 26's native render bundles clamp into a slot for each draw, but they cost 9.6 ms of CPU per frame (see the implementation notes on Safari's frame path).

The fix against main 41e6dffbf, on mains power, with the Mac's own 120 Hz screen, at Low, governor off, 4 rounds of 10 s.

| Scene | Main, GPU ms (median of each run) | The fix | Change |
| --- | --- | --- | --- |
| S4 (shadow cascades) | 4.65, 4.80, 4.82, 5.13 | 3.36, 3.52, 3.70, 3.73 | About 1.2 ms less, or a quarter |
| S2 (about 100 buckets) | 3.20, 3.27, 3.16, 3.29 | 0.77, 0.72, 0.73, 0.75 | About 2.5 ms less, or three quarters |

S2's many buckets show the cost of a buffer for each draw best. The CPU time of the busiest thread stayed within the runs' spread: S4 0.10 to 0.14 ms in main and 0.12 to 0.14 ms with the fix; S2 0.15 ms in main and 0.14 to 0.16 ms with the fix. Half the runs measured 60 Hz, so the tool compared none; the GPU figures are from every run. Runs 20261006-084408-compare (S4) and 20261006-084702-compare (S2), in `target/bench` of the fix's worktree.

After this record's change, on main 367ffac2c: Mac Safari 26.6.2 passed 14 of 14 pages, the two `sprites-100k` pages included, on WebGPU and in compatibility mode, with no GPU reset (run 20261006-083923-checks). Chrome's image tests of the areas the change touches passed 126 of 126 on the Mac's GPU and 126 of 126 on SwiftShader.

## Options

1. D-85 as it is, in every browser. It keeps Chrome's cost.
2. All of a frame's copies before its first render pass. Measured above: no gain.
3. Fewer buffers, such as two taken in turn. D-85 rejects them: no Metal barrier orders a draw's fetch of its arguments.
4. A feature test for the fault. Only a GPU hang shows the fault, so no test can find it safely.
5. Copies only in Apple's WebKit, from the user agent. Chosen by the owner, as a narrow exception to hard rule 14.

## Decision

Option 5. The WebGPU backend copies each draw's arguments, as D-85 describes, only when the user agent names Apple's WebKit: Safari on the Mac, and every browser on iPhone and iPad, all of which run WebKit. Everywhere else every draw reads the buffer that the culling pass writes, as before D-85. `needsOwnArguments()` in `gpu/webgpu/indirect-arguments.ts` makes the choice, from `shared/webkit.ts`, which the start check of the minimum Safari also uses. A WebKit user agent with no version copies.

`FIRST_FIXED_WEBKIT` holds the first Safari version with WebKit's fix (bug 321876, commit 6dca6330 of August 2026). No release had it in October 2026, so every version copies. Browsers on iOS give a frozen version, 18, so they copy until the exception goes.

## Consequences

- Chrome, Edge and Firefox draw indirect from the shared buffer again, as before D-85. In Chrome that takes back the GPU time measured above.
- AGENTS.md notes the exception under hard rule 14, and links here.
- To remove it: when a Safari release ships the fix, set `FIRST_FIXED_WEBKIT` to its version. When the minimum Safari ([D-64](D-64-minimum-browsers.md)) reaches that version, delete the copies, the user agent check and the note under rule 14.
