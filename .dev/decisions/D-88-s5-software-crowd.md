# D-88: S5's image test draws a smaller crowd on SwiftShader

Status: decided. Date: 2026-10-06. Task: s5-flake (M1 gate).

## Question

S5's image test on WebGPU timed out in three CI merge queue runs, at its limit of 90 s for each page. Should the test get a longer limit, or a lighter scene on CI's software GPU?

## Rule

The test must pass on CI's slowest machines with a clear margin, at least 2 times the measured time. It must still check what S5 is for: skinned characters that blend two clips, under a sun that casts shadows. The full crowd must still draw somewhere in CI.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Failed runs | 3 of 101, all on WebGPU, for pull requests #345, #359 and #366. One page sent its image back at 90.0 s | CI runs of the browser shard that held S5, 5 October 06:45 to 6 October 09:20 UTC |
| S5's test, two pages, on SwiftShader | 58.8 s to 174 s on WebGPU and in compatibility mode, median 138 s. 58.7 s to 138 s on WebGL2 | The same 101 runs |
| S4's test on the same machines | 8.0 s to 21.4 s. S5 took 5.3 to 8.9 times as long as S4 in every run | The same 101 runs |
| One S5 page on the slowest machines | 84 s to 90 s | The 9 runs whose WebGPU test took 168 s or more |
| One S5 page on the Mac, SwiftShader, by crowd size | 500: 10.5 to 11.9 s. 250: 8.0 to 8.5 s. 100: 4.3 to 6.2 s. 1: 3.3 s | A script that opened each S5 image run's page on the dev server with `CI=1`'s SwiftShader flags, 6 October 2026 |
| Where a page's time goes on the Mac, 500 characters | Pipelines 0.6 s. The held frame's GPU work 5.2 to 7.2 s. The second draw for the readback 2.9 to 4.1 s | The same, with temporary timing logs in the hold loop and the capture |
| Where it goes with 1 character | The held frame 2.2 s. The second draw 0.03 s | The same |
| Shadow cascades | 1 cascade or 4: the same time | The same |
| S5's test, two pages, 100 characters, Mac, 2 workers | 30 of 30 passed, 9.1 to 10.8 s each | `CI=1 bun run test:images -g "s5 on" --project chromium-swiftshader --repeat-each 10 --workers 2` |
| S5's test, two pages, 6 at once on the Mac | 100 characters: 18 of 18 passed, 13.4 to 18.0 s each. 500 characters: 31.3 to 43.6 s each | The same with `--repeat-each 6 --workers 6`, and again with `NULL3D_SWITCHES=n=500`, whose 18 tests failed only because their images showed the full crowd |

CI's browser shards run 2 Playwright workers on machines with 2 processor cores. The two workers often ran S5 on WebGPU and in compatibility mode at the same time. The machines' speed varied about 2.7 times between runs, and S5 followed it.

## Decision

On SwiftShader, S5's image test draws 100 characters instead of 500. The manifest gives S5 `swiftShaderSwitches: ['n=100']`, and the harness adds those switches only to runs in the `chromium-swiftshader` environment. S5's SwiftShader references were made again with 100 characters. The limit stays at 90 s.

The time grows with the crowd. Each draw of the held frame skins and shades every character, and hold mode draws it twice: on the canvas, then offscreen for the readback. With 100 characters a page took about half its time with 500 on the Mac. On the slowest CI machines a page should take about 40 s, more than 2 times under the limit.

A longer limit alone was rejected. The slowest machines already took 84 s to 90 s for one page. A limit with a clear margin would then be over 3 minutes a page, and the shard would stay the slowest one. The crowd of 100 still fills the frame in five rings, and every character still skins, blends its clips and casts its shadow.

## Consequences

- The SwiftShader images no longer show 500 characters. The Mac's real-GPU references still do. In the merge queue, the Safari and Firefox jobs draw S5 with 500 characters on WebGL2 and compare with those references. The devices and the M1 gate's real-GPU runs draw 500 too.
- `swiftShaderSwitches` is open to other heavy tests, but each use needs a record like this one.
- The engine draws a held frame twice for its readback. Drawing it once would save about a third of S5's time on SwiftShader. That changes hold mode on every device, so it is not part of this fix.
