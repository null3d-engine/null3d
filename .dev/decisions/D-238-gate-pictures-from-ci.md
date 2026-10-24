# D-238: The gate reads CI's browser jobs for the software-renderer pictures

Status: decided. Date: 24 October 2026. Task: M3-R21.

Summary: The gate's software-renderer picture step now reads the gate commit's CI browser jobs. Those jobs draw the image test manifest on Linux SwiftShader, and they make the references that the manifest compares with. On 24 October 2026 the Mac run of the step failed 6 of 1,448 pictures on a commit whose pictures had not moved. Four were the canvas-screen demo's own 2D text, at 0.385% to 0.427% of the pixels. One was the skyway demo at 0.102%, against a limit of 0.100%. Two pages gave no answer within 60 s.

## Question

Which pictures must the gate prove for the commit, and on which machine should it draw them?

## Rule

- The gate passes the SwiftShader pictures where CI passed them, and fails them where CI failed them.
- A check that CI runs may not be weakened to suit another machine. A `swiftShaderTolerance` applies to CI's run too, because `referenceOf` in `tests/lib/images.ts` reads it from the test and the place alone.
- The step fails when the commit's CI run drew no picture. A step that passes without evidence is worse than a red one.

## Data

Gate run on `16628a5dd`, 24 October 2026, in the Mac's SwiftShader. The `images-gpu` step passed 1,448 pictures on the Mac's real GPU in the step before.

| Measure | Mac's SwiftShader, against CI's references |
| --- | --- |
| Pictures | 1,442 passed, 6 failed |
| `demo-canvas-screen`, WebGPU, compatibility and WebGL2 | 0.385% to 0.427% of the pixels, against 0.100% |
| `demo-skyway`, WebGL2 | 0.102%, against 0.100% |
| Pages that gave no answer within 60 s | 2, one of them `row-colors` on WebGL2 pipelined, whose test took 78 s |

The saved diff `test-results/images/chromium-swiftshader/webgpu/demo-canvas-screen-diff.png` shows three clusters on the readings' digits and nothing else. The demo draws those readings into a 2D canvas, and each browser rasterises that text its own way. The manifest's canvas-screen entry records the same fault on other devices: Safari differed in 1.0% of the pixels and Firefox in 1.8%. That is why the test allows 2.5% on a device. The skyway demo's rain and lens marks sit on pixels that each GPU rounds its own way. Its entry allows 1.2% on a device.

The references of the `chromium-swiftshader` set are drawn on CI's Linux machines. A Mac run with `CI=1` draws its own text and runs at its own speed. It therefore tests the Mac against a picture that another machine made.

`tests/lib/images.ts` takes a SwiftShader run's tolerance from `swiftShaderTolerance`. When the test sets none, it takes the test's tolerance, whatever the machine. A tolerance written for this Mac's text would therefore loosen CI's own check of the same pictures.

How the data was produced: the gate's record and log in `target/gate/`, the saved diff, and `tests/lib/images.ts` and `tests/image/manifest.ts`.

## Decision

The step reads the commit's CI browser jobs. It judges the jobs that draw the manifest: every `browser (shard …)` job, whose shards split the manifest, and `browser (the city)`, which draws S6's pictures. Every one of them must have completed with success.

The step counts a run of a push or a run started by hand, as the `workflows` step does. It counts no pull request's run, which tested GitHub's merge of the commit into an older main.

`bun bench/ci-browser-jobs.ts <commit>` finds that run and prints it with its jobs. `browserPictures` in `bench/lib/gate.ts` judges the output.

Two options were rejected:

- A `swiftShaderTolerance` for the canvas-screen and skyway demos. It would apply to CI's Linux run too, which is the run the references come from. It would let a real move of up to 2.5% pass there.
- A third reference set drawn on the Mac's SwiftShader. It would compare the Mac with itself, so a picture that only the Mac draws wrongly would pass. Every look change would also need 1,448 pictures drawn by hand again.

## Consequences

- The gate's record now carries CI's verdict for the SwiftShader pictures. The two slow pages and the text differences no longer fail it.
- The step fails, with the reason in its figure, when the commit has no counted CI run. It fails too when CI skipped the browser jobs, or when any of them did not pass. A branch therefore needs a full CI run started by hand before the gate, as the `workflows` step already needs its runs.
- The step took 36 minutes in that run. It now opens no browser, so it costs the gate seconds and holds nothing that the timing steps wait for.
- `AGENTS.md`, `.dev/releases.md` and `.dev/image-tests.md` describe the step's new evidence, and `bench/lib/gate.test.ts` checks the reader.
