# D-88: Lighter loads on SwiftShader for S5 and the moving shadow test

Status: decided. Date: 2026-10-06. Task: s5-flake (M1 gate).

Summary: On CI's slowest machines, S5's image pages took 84 s to 90 s of their 90 s, and browser shard 5 reached its 15 minutes in 9 of 14 queue runs, through the moving shadow tests. On SwiftShader alone, S5 now draws 100 characters, not 500, and each preset's moving shadow run reads 24 frames, not 60. Both still catch their faults. The moving shadow tests run in parallel, and new shard weights model the slowest shard at under 10 minutes. The real GPU, Safari, Firefox and the devices keep the full loads.

## Question

Two browser tests outgrew CI's slowest machines. S5's image test on WebGPU timed out in three merge queue runs, at its limit of 90 s for each page. Browser shard 5 reached its job limit of 15 minutes in most merge queue runs after #359, and that took #365 out of the queue. Should these tests get longer limits, or lighter work on CI's software GPU?

## Rule

Each test must pass on CI's slowest machines with a clear margin, at least 2 times its measured time. It must still catch the faults it is for. The full load must still run somewhere in CI or on the release gate's devices. Each browser shard must finish well inside its 15 minutes.

## Data

### S5's image test

| Measure | Figure | Source |
| --- | --- | --- |
| Failed runs | 3 of 101, all on WebGPU, for pull requests #345, #359 and #366. One page sent its image back at 90.0 s | CI runs of the browser shard that held S5, 5 October 06:45 to 6 October 09:20 UTC |
| S5's test, two pages, on SwiftShader | 58.8 s to 174 s on WebGPU and in compatibility mode, median 138 s. 58.7 s to 138 s on WebGL2 | The same 101 runs |
| S4's test on the same machines | 8.0 s to 21.4 s. S5 took 5.3 to 8.9 times as long as S4 in every run | The same 101 runs |
| One S5 page on the slowest machines | 84 s to 90 s | The 9 runs whose WebGPU test took 168 s or more |
| One S5 page on the Mac, SwiftShader, by crowd size | 500: 10.5 to 11.9 s. 250: 8.0 to 8.5 s. 100: 4.3 to 6.2 s. 1: 3.3 s | A script that opened each S5 image run's page on the dev server with the SwiftShader flags of `CI=1`, 6 October 2026 |
| Where a page's time goes on the Mac, 500 characters | Pipelines 0.6 s. The held frame's GPU work 5.2 to 7.2 s. The second draw for the readback 2.9 to 4.1 s | The same, with temporary timing logs in the hold loop and the capture |
| Where it goes with 1 character | The held frame 2.2 s. The second draw 0.03 s | The same |
| Shadow cascades | 1 cascade or 4: the same time | The same |
| S5's test, 100 characters, 2 at once, as in CI | 30 of 30 passed, 9.1 to 10.8 s each. Beside the moving shadow tests, at a load of up to 17 on the Mac: 30 of 30, 9.0 to 14.6 s | `CI=1 bun run test:images -g "s5 on" --project chromium-swiftshader --repeat-each 10 --workers 2` |
| S5's test, 6 at once on the Mac | 100 characters: 18 of 18 passed, 13.4 to 18.0 s each. 500 characters: 31.3 to 43.6 s each | The same with `--repeat-each 6 --workers 6`, and again with `NULL3D_SWITCHES=n=500`, whose 18 tests failed only because their images showed the full crowd |

CI's browser shards run 2 Playwright workers on machines with 2 processor cores. The two workers often ran S5 on WebGPU and in compatibility mode at the same time. The machines' speed varied about 2.7 times between runs, and S5 followed it.

### Browser shard 5

| Measure | Figure | Source |
| --- | --- | --- |
| Shard 5's job | 10.2 to 15.3 minutes in the 14 merge queue runs of 6 October from 05:42 UTC. 11 of them ran 13 minutes or more, and 9 stopped at the limit. The other shards took 4.9 to 10.3 minutes | The browser jobs of those runs |
| The moving shadow tests in shard 5 | 6.4 minutes in all on a fast machine, 11.1 to 11.8 minutes on slow ones. Each preset's test on WebGPU took 72 s to 192 s of its 240 s limit, so each of its two pages took about 96 s of its 100 s | Shard 5's logs of runs 37433272175, 37438661882, 37440864741, 37443973865 and 37445248821 |
| Before #359 | The moving shadow file took about 1 minute, with no preset tests | Run 37424382337 |
| The file's grouping | It ran its tests in order, so the shards could not split it, and its 10 tests ran on one worker | `tests/image/moving-shadow.spec.ts` before this change |
| One preset test on the Mac, SwiftShader, 2 at once | 60 reads: 11.0 to 11.6 s on WebGPU, 8.3 to 9.8 s on WebGL2. 24 reads: 5.1 to 5.8 s | `CI=1 bun run test:browser moving-shadow.spec.ts --project chromium-swiftshader --workers 2` |
| 24 reads with the fault | With Low's `followMovingCasters` turned off in the engine, the Low test failed 6 of 6 runs, on both GPU paths | The same with `-g "at low" --repeat-each 3` |
| 24 reads without the fault | 40 of 40 passed. On the Mac's GPU, with 60 reads, 8 of 8 passed | `--repeat-each 5`, and the `chrome-real-gpu` project |
| Modelled shard times, the 5 runs above, the old and the new weights | Old weights: slowest shard 15.5 minutes at the median times, up to 19.9 in one run. New weights 255:366:168:131:136:132:170: 9.3 at the median, 9.0 to 9.8 in each run. With savings a quarter smaller than measured: 9.8 at the median and 10.8 at most | A copy of `tools/shard-weights.ts` that scales the CI times of S5's tests by 0.45 and of the preset tests by 0.5, and again by 0.55 and 0.65 |

## Decision

On SwiftShader, S5's image test draws 100 characters instead of 500. The manifest gives S5 `swiftShaderSwitches: ['n=100']`, and the harness adds those switches only to runs in the `chromium-swiftshader` environment. S5's SwiftShader references were made again with 100 characters. The limit stays at 90 s.

The time grows with the crowd. Each draw of the held frame skins and shades every character, and hold mode draws it twice: on the canvas, then offscreen for the readback. With 100 characters a page took about half its time with 500 on the Mac. On the slowest CI machines a page should take about 40 s, more than 2 times under the limit. The crowd of 100 still fills the frame in five rings. Every character still skins, blends its clips and casts its shadow.

The moving shadow test's preset runs read 24 frames on SwiftShader instead of 60: three cycles of the far cascades' 8 frames. Each read draws a frame and draws it again for the readback, so the reads set the test's time. A far cascade that keeps its layer shows the lag in 7 frames of each cycle. So 24 reads still hold 21 such frames, and the test still failed every run with the fault. The tests now run in parallel, so the shards can split them. The shard weights were worked out again for the new times.

A longer limit alone was rejected for both tests. The slowest machines already took 84 s to 90 s for one S5 page, and 96 s of 100 s for one moving shadow page. Limits with a clear margin would make the slowest shards longer than their 15 minutes.

## Consequences

- The SwiftShader images of S5 no longer show 500 characters. The Mac's real-GPU references still do. In the merge queue, the `real-browsers (Safari 1/2)` and `real-browsers (Firefox 1/2)` jobs draw S5 with 500 characters on WebGL2, in both thread modes, and compare with those references. They passed in queue runs 37438661882, 37445248821 and 37445348078 on 6 October 2026. A page with 100 characters would differ from them in about 20% of its pixels. The devices and the release gate's real-GPU runs draw 500 too.
- On the Mac's GPU and on devices, the moving shadow test still reads 60 frames.
- `swiftShaderSwitches` is open to other heavy tests, but each use needs a record like this one.
- The engine draws a held or captured frame twice for its readback. Drawing it once would save about a third of S5's time on SwiftShader. That changes hold mode and captures on every device, so it is not part of this fix.
- The model of the new shard weights takes the measured savings as estimates. After a few merge queue runs, run `bun run test:browser-weights` again with their real times.
