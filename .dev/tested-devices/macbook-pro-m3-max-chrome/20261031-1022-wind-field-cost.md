Plans: wind-field-cost 2026-10-31, the fluid wind field's own cost at every grid shape. Each run
also sweeps the pressure count and the field rate. The branch is `feat/m3-v14-wind-budget` at
`5e29e392c`, after a rebase onto the landing head. The first run, at `c4504a038`, was repeated
because the rebase removed that commit and its output was not kept. The harness files are
byte-identical at `c4504a038`, at `5e29e392c` and at `8e74d0dec`, where the audit checked them.
There are three runs of `NULL3D_WIND_FIELD_COST=1 bun run test:browser -- wind-field-cost.spec.ts`,
one for each value of `NULL3D_WIND_GPU` (webgpu, compat, webgl2). Each run went through the heavy
queue with its own dev server on port 6173 and `NULL3D_PRODUCTION_PAGES=skip`. The browser is the
installed Chrome 156 on this Mac's Apple M3 Max, at macOS 26.2. The window is 640 by 400 at a device
pixel ratio of 1. The WebGPU run began at a 1-minute load of 7.9 and ended between 3.6 and 13.9.
Compatibility mode ran from 8.0 to between 8.0 and 19.7, and WebGL2 from 7.6 to between 5.5 and
9.7. The raw logs are `target/v14-logs/field-webgpu.log`, `field-compat.log` and `field-webgl2.log`
in the helper checkout.

Result: 3 passed, 0 skipped, 0 failed, in 11.5, 12.5 and 12.8 minutes. Each page plays the field
off, the add-on's shipped solver cycle, and a chain of damped Jacobi steps. The shipped cycle is 22
runs at 20 pressure steps. The chain runs at 1, 8, 16, 24, 40 and 80 runs, with three rounds of each
side in turn. WebGPU and compatibility mode time each pass. WebGL2 has no per-pass timer, so its
figure is the frame with the field less the frame without it.

WebGPU, GPU milliseconds of the field's own pass.

| Shape | Cells | Real cycle | One step at 80 runs | 80 steps | Drag adds |
| --- | --- | --- | --- | --- | --- |
| flat 32x32 | 1,024 | 0.220 | 0.0065 | 0.523 | +0.054 |
| flat 64x64 | 4,096 | 0.226 | 0.0067 | 0.538 | +0.051 |
| flat 128x128 | 16,384 | 0.241 | 0.0077 | 0.613 | +0.055 |
| flat 256x256 | 65,536 | 0.361 | 0.0109 | 0.874 | +0.112 |
| 4 layers of 64x64 | 16,384 | not built | 0.0085 | 0.677 | +0.053 |
| 8 layers of 64x64 | 32,768 | not built | 0.0102 | 0.815 | +0.066 |
| 4 layers of 128x128 | 65,536 | not built | 0.0131 | 1.048 | +0.122 |
| 8 layers of 128x128 | 131,072 | not built | 0.0201 | 1.605 | +0.196 |
| volume 32x32x32 | 32,768 | not built | 0.0112 | 0.894 | +0.120 |
| volume 48x16x48 | 36,864 | not built | 0.0105 | 0.843 | +0.078 |
| volume 64x24x64 | 98,304 | not built | 0.0161 | 1.287 | +0.146 |

The least-squares line through the flat shapes' single steps is 0.013 ms of fixed cost a step and
0.059 nanoseconds a cell. Compatibility mode matches within about 3 per cent: its real cycle is
0.225, 0.227, 0.243 and 0.362 ms on the four flat grids, and its line is 0.013 ms and 0.075 ns a
cell. A 16 by 16 region of the real pass read back through `render.readPass` in 47.1 to 51.3 ms on
the two WebGPU paths, 3 frames late.

WebGL2, the frame with the field less the frame without it.

| Shape | 1 step | 8 steps | 16 steps | 24 steps | 40 steps | 80 steps | Real cycle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flat 32x32 | 0.073 | 1.261 | 2.956 | 6.553 | 12.238 | 27.364 | 4.836 |
| flat 64x64 | 0.128 | 1.327 | 3.007 | 6.364 | 12.495 | 23.625 | 4.466 |
| flat 128x128 | 0.113 | 1.289 | 2.618 | 5.851 | 12.563 | 23.920 | 4.371 |
| flat 256x256 | 0.177 | 1.376 | 3.103 | 6.272 | 12.123 | 23.620 | 5.050 |

## What the figures say

The field's cost follows the pressure count and the field rate, not the grid's size. WebGPU's step
is 0.013 ms of fixed cost plus 0.059 ns a cell, so the cells make 0.004 ms of the 0.011 ms step at
256x256 and almost nothing below 128x128. The real cycle shows the same floor: 0.220 ms at 32x32
against 0.361 at 256x256, where five times the cells add 0.14 ms and the advection and projection
work grows from about 0.09 to 0.14 ms.

On WebGL2 the cost is fixed per run. Eight runs cost 1.26 to 1.38 ms at every shape from 1,024 to
65,536 cells, about 0.16 to 0.17 ms a run, and the add-on's 22-run cycle costs 4.4 to 5.1 ms a
frame. Past 16 runs in a frame the work passes the display's interval and the GPU queues, so the
24, 40 and 80-run rows are saturation points. The single-step rows scatter between 0.073 and 0.177
ms.

The canopy drag is measured as one more read a cell a step. It adds 0.051 to 0.055 ms on the flat
grids up to 128x128, 0.112 at 256x256, and 0.053 to 0.196 ms on the tiled shapes. It is not the
scatter's own grid, which M3-V17 gives the wind.

The layered and the volume shapes are tiled into one 2D texture and run by the chain. The solver
builds only the flat square grid, so their real cycles are not measured. D-283 models the volume's
Ultra row at about 0.73 ms from the floor and its forty steps.

D-283 carries these figures and the rows and budgets they propose.
