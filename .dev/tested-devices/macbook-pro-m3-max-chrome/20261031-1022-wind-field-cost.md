Plans: wind-field-cost 2026-10-31, the fluid wind field's own cost at every grid shape. Each run
also sweeps the pressure count and the field rate. The branch is `feat/m3-v14-wind-budget` at
`c4504a038`, which a rebase removed from the branch. The harness files are byte-identical at
`8e74d0dec`, where the audit checked them, and at this head. There are three runs of
`NULL3D_WIND_FIELD_COST=1 bun run test:browser -- wind-field-cost.spec.ts`, one for each value of
`NULL3D_WIND_GPU` (webgpu, compat, webgl2). Each run went through the heavy queue with its own dev
server on port 6173 and `NULL3D_PRODUCTION_PAGES=skip`. The browser is the installed Chrome 156 on
this Mac's Apple M3 Max, at macOS 26.2. The window is 640 by 400 at a device pixel ratio of 1. Each
run began at a 1-minute load below 8. The WebGPU run saw 7.4 before and 2.2 to 6.3 after.
Compatibility mode saw 6.9 before and 22 to 43 after. WebGL2 saw 7.2 before and 5.0 to 21.2 after.

Result: 3 passed, 0 skipped, 0 failed, in 12.0, 11.3 and 11.7 minutes. Each page plays the field
off, the add-on's shipped solver cycle, and a chain of damped Jacobi steps. The shipped cycle is 22
runs at 20 pressure steps. The chain runs at 1, 8, 16, 24, 40 and 80 runs, with three rounds of each
side in turn. WebGPU and compatibility mode time each pass. WebGL2 has no per-pass timer, so its
figure is the frame with the field less the frame without it.

WebGPU, GPU milliseconds of the field's own pass.

| Shape | Cells | Real cycle | One step at 80 runs | 80 steps | Drag adds |
| --- | --- | --- | --- | --- | --- |
| flat 32x32 | 1,024 | 0.226 | 0.0067 | 0.532 | +0.091 |
| flat 64x64 | 4,096 | 0.230 | 0.0076 | 0.610 | noise |
| flat 128x128 | 16,384 | 0.244 | 0.0089 | 0.711 | noise |
| flat 256x256 | 65,536 | 0.369 | 0.0114 | 0.910 | +0.126 |
| 4 layers of 64x64 | 16,384 | not built | 0.0086 | 0.688 | +0.060 |
| 8 layers of 64x64 | 32,768 | not built | 0.0103 | 0.822 | +0.068 |
| 4 layers of 128x128 | 65,536 | not built | 0.0105 | 0.841 | +0.013 |
| 8 layers of 128x128 | 131,072 | not built | 0.0137 | 1.095 | noise |
| volume 32x32x32 | 32,768 | not built | 0.0102 | 0.815 | +0.067 |
| volume 48x16x48 | 36,864 | not built | 0.0105 | 0.838 | +0.081 |
| volume 64x24x64 | 98,304 | not built | 0.0162 | 1.292 | +0.139 |

The least-squares line through the flat shapes' single steps is 0.013 ms of fixed cost a step and
0.079 nanoseconds a cell. Compatibility mode matches within about 3 per cent: its real cycle is
0.220, 0.225, 0.242 and 0.358 ms on the four flat grids, and its line is 0.013 ms and 0.059 ns a
cell. A 16 by 16 region of the real pass read back through `render.readPass` in 44.8 to 52.4 ms on
the two WebGPU paths, 3 frames late.

WebGL2, the frame with the field less the frame without it.

| Shape | 1 step | 8 steps | 16 steps | 24 steps | 40 steps | 80 steps | Real cycle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flat 32x32 | 0.919 | 1.513 | 3.359 | 5.864 | 12.638 | 25.716 | 5.781 |
| flat 64x64 | 0.102 | 1.251 | 3.080 | 6.031 | 12.187 | 22.739 | 4.306 |
| flat 128x128 | 0.079 | 1.279 | 3.019 | 6.263 | 11.731 | 23.303 | 4.315 |
| flat 256x256 | 0.087 | 1.326 | 2.864 | 6.438 | 12.028 | 27.385 | 4.717 |

## What the figures say

The field's cost follows the pressure count and the field rate, not the grid's size. WebGPU's step
is 0.013 ms of fixed cost plus 0.079 ns a cell, so the cells make less than a hundredth of a
millisecond below 128x128 and 0.005 ms of the 0.011 ms step at 256x256. The real cycle shows the
same floor: 0.226 ms at 32x32 against 0.369 at 256x256, with about 0.09 ms of advection that
evaluates the analytic field.

On WebGL2 the cost is fixed per run. Eight runs cost 1.25 to 1.51 ms at every shape from 1,024 to
65,536 cells, and the add-on's 22-run cycle costs 4.3 to 5.8 ms a frame. Past 16 runs in a frame
the work passes the display's interval and the GPU queues, so the 24, 40 and 80-run rows are
saturation points. The 32x32 one-step row, 0.919 ms, is an outlier against the other grids' 0.08 to
0.10 ms.

The canopy drag is measured as one more read a cell a step. It is inside the run-to-run spread on
the middle grids and shows only where the cells dominate: +0.126 ms of the 256x256 chain's 0.910,
and +0.139 of the volume's 1.292. It is not the scatter's own grid, which M3-V17 gives the wind.

The layered and the volume shapes are tiled into one 2D texture and run by the chain. The solver
builds only the flat square grid, so their real cycles are not measured.

D-283 carries these figures and the rows and budgets they propose.
