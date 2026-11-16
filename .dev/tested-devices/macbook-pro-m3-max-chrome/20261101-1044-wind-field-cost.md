Plans: wind-field-cost 2026-11-01, the fluid wind field's own cost at the shapes of the preset rows.
The branch is `feat/m3-v14-wind-costs` at `06e10a77f`, whose working tree also held the plan's new
pages and a docs paragraph, neither of which the page reads. The run repeats the field's figures at
this head with the rows' own shapes, which the run of 2026-10-31 measured on the flat stand-ins. The
command was
`NULL3D_WIND_FIELD_COST=1 NULL3D_WIND_GPU=webgpu,webgl2 NULL3D_WIND_SHAPES=flat-64,layered-4x128,volume-64x24x64 NULL3D_WIND_POINTS=1,8,24,40 bun run test:browser -- wind-field-cost.spec.ts --workers=1`,
through the heavy queue with its own dev server on port 6281 and `NULL3D_PRODUCTION_PAGES=skip`. The
browser is the installed Chrome 156 on this Mac's Apple M3 Max, at macOS 26.2, in a 640 by 400
window at a device pixel ratio of 1. The display ran at 60 Hz. The WebGPU pages began at a 1-minute
load of 4.2 and ended between 3.4 and 3.5. The WebGL2 pages began at 3.4 and ended between 3.8 and
4.0. The raw log is `/tmp/m3v14-mac.log` in the helper worktree.

Result: 2 passed, 0 skipped, 0 failed, in 4.9 minutes. Each page plays the field off, the add-on's
shipped solver cycle, and a chain of damped Jacobi steps at 1, 8, 24 and 40 runs. Three rounds of
each side run in turn, and the drag runs beside the last. The shipped cycle is 22 runs at 20
pressure steps.

WebGPU, GPU milliseconds of the field's own pass.

| Shape | Cells | Real cycle | 1 step | 8 steps | 24 steps | 40 steps | Drag adds at 40 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flat 64x64 | 4,096 | 0.227 | 0.014 | 0.061 | 0.168 | 0.277 | +0.021 |
| 4 layers of 128x128 | 65,536 | not built | 0.019 | 0.111 | 0.321 | 0.530 | +0.056 |
| volume 64x24x64 | 98,304 | not built | 0.022 | 0.137 | 0.395 | 0.648 | +0.074 |

The flat 64x64 grid's 16 by 16 region read back through `render.readPass` in 49.470 ms, 3 frames
late.

WebGL2, the frame with the field less the frame without it.

| Shape | Real cycle | 1 step | 8 steps | 24 steps | 40 steps | Drag adds at 40 |
| --- | --- | --- | --- | --- | --- | --- |
| flat 64x64 | 4.394 | 0.078 | 1.258 | 5.630 | 11.643 | +0.118 |
| 4 layers of 128x128 | not built | 0.083 | 1.235 | 5.975 | 11.883 | +0.376 |
| volume 64x24x64 | not built | 0.081 | 1.318 | 6.057 | 11.896 | +0.152 |

The flat 64x64 grid's 16 by 16 read answered after 62.910 ms, 4 frames late.

## What the figures say

The figures are re-measured against the field's run of 2026-10-31, which swept every shape at
`5e29e392c`. Neither record states a run-to-run spread, so the cells are compared directly. That
run's real cycle at flat 64x64 is 0.226 ms against this run's 0.227. WebGL2's eight steps cost
1.327 ms against 1.258, 5.2 per cent lower. Its single step moved from 0.128 to 0.078 ms, 39 per
cent. The layered shape's 24 steps read 0.321 ms here. This run played the Medium, High and Ultra
rows' shapes; Low's 32x32 grid and the flat 128x128 and 256x256 stand-ins were not played.

The volume's 40 steps cost 0.648 ms on WebGPU, and the advection and projection that its real cycle
would add are about 0.09 ms, so one cycle is about 0.74 ms. Its Ultra row steps once a frame at 60
field steps a second, so that is its frame figure. The layered shape's 24 steps cost 0.321 ms, and
one cycle with the same floor is about 0.41 ms. Its High row runs at 30 field steps a second, which
is half a cycle a frame, so about 0.21 ms.

On WebGL2 the cost is fixed per run: eight runs cost 1.24 to 1.32 ms at 4,096, 65,536 and 98,304
cells, and 24 runs cost 5.6 to 6.1 ms. The shapes do not separate. The medium row's eighteen-run
cycle at 15 cycles a second is 4.5 runs a frame at about 0.16 ms a run, so about 0.7 ms a frame.

The drag is one more read a cell a step. It adds 0.021 to 0.074 ms on WebGPU's shapes at 40 runs,
and 0.118 to 0.376 ms on WebGL2's.

The field's memory is the pass's two states at eight bytes a texel: 64 KiB at flat 64x64, 1.0 MiB at
four layers of 128x128 and 1.5 MiB at the volume.

D-283 carries these rows and the budget that each preset takes.
