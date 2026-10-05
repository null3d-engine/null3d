# D-64: Supported browsers and the minimum Safari

Status: decided by the owner on 2026-10-05. Date: 2026-10-05. Task: M2-N1.

## Question

Which Safari versions does null3D support? Safari 16.4 is the first with WebAssembly SIMD, which the engine's core needs. On 4 October 2026 a cloud iPhone 13 in Safari 17.5 refused the engine's shared memory and failed one WebGL2 shader. Does work go into those faults, or is Safari 17 too old to support?

## Rule

The owner decides. A supported browser gets device runs at each milestone, and its faults get fixes. Work on a browser that few people still run takes time from the browsers that most people run.

## Data

The tier B smoke plan ran on BrowserStack Automate's iPhone 13 on 4 October 2026 (UTC), on main 62add54f.

| Device | System and browser | Memory | Result |
| --- | --- | --- | --- |
| iPhone 13, Apple A15 | iOS 17, Safari 17.5 | 4 GB | 4 of 51 pages passed, 5 skipped (WebGPU and compatibility mode, which the phone lacks), 4 failed and 38 not run |

- Safari refused the engine's shared memory of 1,024 MiB 9 times in 10 seconds. That happened on 3 of the last 5 pages: the preset change, the warm-up and the stats pages on WebGL2. Each refusal is E1109. The out-of-memory guard then ended the session, as the owner's rule says.
- The shaders page failed too. Safari's `createShader` returned null for one WebGL2 program of the standard material. It is the maps build with the draw index, vertex colors, an alpha mask and vertex tangents.
- Safari 18 passed the same plan on 4 October 2026. Safari 18.5 on a cloud iPhone 16 passed all 22 WebGL2 pages, and so did Safari 18.4 on a cloud Mac with macOS Sequoia. Both skipped the 29 other pages.
- Safari ships with its system. Every iPhone that runs iOS 17 can run iOS 18, and Safari 18 runs on macOS Ventura and later. So a user on Safari 17 can update to a supported Safari on the same device, except on a Mac that cannot run macOS Ventura.

## Decision

The owner's decision of 5 October 2026: Safari 17 and older are too old, and null3D does not support them. The minimum is Safari 18 on macOS, iOS and iPadOS. Chrome and Edge 91 and Firefox 89 stay the other minimums, which WebAssembly SIMD sets.

- No work goes into the iPhone 13's two faults: the refused shared memory and the failed WebGL2 shader.
- The engine refuses to start in Safari before 18, with a clear start error that names the minimum. Safari 16.4 to 17 pass the engine's feature tests, so without the check the engine would start there and meet the faults above. The check lands in its own change, on branch `feat/safari-18-minimum`, with the user docs' minimum versions.
- Before Safari 16.4, WebAssembly SIMD is missing, as in Chrome before 91 and Firefox before 89. The engine stops with E1303 there, as before.
- The iPhone 13 run stays in the record of tested devices, marked as an unsupported browser.

## Options rejected

- Fix both faults for Safari 17. The memory fault is the one that the 4 GB iPhone hit at the default maximum of 1,024 MiB ([D-04](D-04-memory-maximum.md)). A fix would need a smaller default memory for some devices, or a retry with less. The shader fault needs a probe of Safari 17's GLSL compiler. Both cost device time on a browser that its users can update.
- Let the engine start in Safari 16.4 to 17 without support. Users there would meet a refused memory or a failed shader with no clear cause. A start error tells them to update.

## Consequences

- The start check's change gives Safari 18 as the minimum in the README, [GPU tiers and backends](../../docs/concepts/backends.md) and the errors' fix texts.
- [Device sessions](../devices.md): the iPhones on the WebGL2 path run iOS 18. Tier B's 4 GB iPhone 13 runs iOS 18 in place of iOS 17. Tier C keeps its old Safari rows as checks that the engine fails clearly there. They are not support.
- [Tested devices](../tested-devices.md): the iPhone 13 row stays, marked as unsupported.
