# D-283: The fluid wind's cost, and its budget at each preset

Status: decided by the owner. The owner accepted the rows and budgets that this record proposes:
0.5, 1.2, 4.9 and 6.25 ms from Low to Ultra, with Medium on the flat 64x64 grid, High on four
layers of 128x128, Ultra on the volume 64x24x64, and Low on the formula wind on phones until a
phone measures the small grid. The ruling closes the rows and the budgets. Three clauses of the
task's Done-when stay open: the smallest-tier look, a side-by-side that the owner judges and has not
named; the cost of each tier on the M5 Max, because the machine here is an M3 Max and no M5 Max ran
the plan, while the iPad Pro 13, the Galaxy S25 and the Galaxy Tab A9 Plus now carry their rows; and
the proof that the chosen rows keep Creek and the forest within
D-241's frame ceilings, which waits on M3-V11 and M3-V12. The three devices confirm the rows, with
one cell that the governor must step: the Galaxy S25's 30 Hz display owes two field cycles a frame,
so its Ultra row costs 11.08 ms until Ultra steps at 30 field steps a second there. Built: the wind
add-on's field and its
state-keeping solver
(M3-V13, M3-V15). Built too: the plant material's vertex reader (M3-V7) and the cost pages that
time them. Not built: the preset rows and budgets (M3-V16), the canopy drag and the falling leaves
(M3-V17), branch poses (M3-V10, measured on its own branch), and Creek's and the forest's plants on
the add-on (M3-V11, M3-V12). Task: M3-V14.

Summary: On the Mac's WebGPU path the field costs 0.10 ms a frame at the Medium row and 0.73 ms at
the Ultra row, which is the volume's shape; the flat 256x256 grid that stands in until it is built
costs 0.58. The grid's size moves the cost far less than the pressure count and the field rate do.
WebGL2 pays a fixed cost per solver run, so its row sets the field rate. The owner accepted budgets
of 0.5, 1.2, 4.9 and 6.25 ms from Low to Ultra, one tenth of the vegetation add-on's own budget.

## Question

What does the fluid wind cost a frame at each grid shape and solver setting, on the Mac, the phones
and the tablets? What does each pass that reads the field pay? What budget does the wind take at
each preset?

## Rule

- The wind's budget is its own, and D-241's vegetation budget stands beside it.
- A preset's row must hold on every path and on every device that draws it.
- The planning ceiling for the field alone is one tenth of the vegetation add-on's budget. That is
  0.5 ms at Low, 1.2 at Medium, 4.9 at High and 6.25 at Ultra on the Apple devices. It is a
  planning figure, not a frame ceiling.
- The better look wins where it fits ([hard rule 40](../../AGENTS.md#hard-rules)). A cheaper form of
  the same look keeps it when the full form does not fit.
- Each figure comes from the run that measured it, at the commit that run names. A figure from a
  stand-in shape or a stand-in scene says so.

## Data

### What the cost page measures

`tests/pages/wind-field-cost.html` plays one scene in three modes. In the `off` mode no field pass
runs. In the `real` mode the add-on's own solver runs one history pass. That pass runs a whole
cycle: the advection, the twenty pressure iterations and the projection. In the `step` mode a chain
of damped Jacobi steps runs over the same texels, so the pressure count can sweep. A layered or
volume shape is tiled into one 2D texture. Drag adds one more read a cell a step, which stands in
for the canopy grid.

The real solver on this tree fixes its pressure count at twenty and its field rate at sixty cycles
a second. M3-V16 has not landed the settings. The preset rows are therefore modelled from the
chain's step and the real cycle's floor, as the plan's cost runs allow.

The field's own figures in this section were measured again at `5e29e392c`, after the rebase. Its
harness files are byte-identical to `c4504a038`'s, which no ref reaches now, and to `8e74d0dec`,
which a reader can reach and where the audit checked them. The readers' and the phones' figures
come from the runs at `c4504a038`, whose harness matches this head's byte for byte. Those two runs
were timed on that tree's engine core, not this head's, so the harness matches while the engine
around it does not. The machine is the Mac's installed Chrome 156, on an Apple M3 Max with 36 GB of
memory. The display is 60 Hz and the window is 640 by 400. The field runs began at a 1-minute load
of 7.6 to 7.9 and ended between 3.6 and 19.7. Each side is the median GPU time of three rounds,
alternating the order. WebGPU and compatibility mode time each pass. WebGL2 on a phone has no pass
timer, so its rows give the frame interval and the busiest thread's CPU time.

Each table names its run. The field's tables come from [the field run](../tested-devices/macbook-pro-m3-max-chrome/20261031-1022-wind-field-cost.md),
which was taken again at `5e29e392c`. The readers' table comes from [the readers run](../tested-devices/macbook-pro-m3-max-chrome/20261031-1103-wind-readers.md)
at `c4504a038`. The phone tables come from [the iPhone 17's run](../tested-devices/iphone-17-safari/20261031-104558-wind-field-cost.md)
and [the Galaxy S24's run](../tested-devices/galaxy-s24-sm-s921b-chrome/20261031-104906-wind-field-cost.md),
both at `c4504a038`. The rows' own shapes were measured again at `06e10a77f`
([its run](../tested-devices/macbook-pro-m3-max-chrome/20261101-1044-wind-field-cost.md)), and that
run confirms the earlier figures rather than moving them: every row of the Decision table lands
within the run-to-run spread of the figure it had. The devices' tables come from the plan's run at the same
head, on [the iPad Pro 13](../tested-devices/ipad-pro-13-safari/20261101-025108-wind-field-cost.md),
[the Galaxy S25](../tested-devices/galaxy-s25-sm-s931b-chrome/20261101-025108-wind-field-cost.md)
and [the Galaxy Tab A9 Plus](../tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-030741-wind-field-cost.md).

### Measured, modelled and bounded

Three kinds of figure appear below, and each table says which it holds.

- **Measured:** a time that the device timed itself. The real cycle, the chain steps, the drag, the
  per-pass reader deltas and every field figure on the Mac's WebGPU and WebGL2 paths are measured
  this way.
- **Modelled:** a preset's row, built from a measured floor and a measured step, because the solver
  on this tree fixes twenty pressure steps and sixty cycles a second. The formula is
  `field step(p) = advect and project + p * step`. Medium's, High's and Ultra's WebGPU figures, and
  the WebGL2 figures at 15 and 30 cycles a second, are modelled.
- **Bounded:** a figure that a device cannot time. The phones on WebGL2 have no pass timer, so their
  rows bound the field's cost with the frame interval and the busiest thread. They do not measure
  the 0.5 ms Low ceiling.

### The field on WebGPU

The field's own pass, GPU milliseconds, median of three rounds. `Cells` counts the texels in the
tile. `memory` is the pass's two states at eight bytes a texel.

| Shape | Cells | Memory | Real cycle, 20 pressure (ms) | One chain step at 80 runs (ms) | 80 chain steps (ms) | Drag adds (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| flat 32x32 | 1,024 | 16 KiB | 0.220 | 0.0065 | 0.523 | +0.054 |
| flat 64x64 | 4,096 | 64 KiB | 0.226 | 0.0067 | 0.538 | +0.051 |
| flat 128x128 | 16,384 | 256 KiB | 0.241 | 0.0077 | 0.613 | +0.055 |
| flat 256x256 | 65,536 | 1.0 MiB | 0.361 | 0.0109 | 0.874 | +0.112 |
| 4 layers of 64x64 | 16,384 | 256 KiB | not built | 0.0085 | 0.677 | +0.053 |
| 8 layers of 64x64 | 32,768 | 512 KiB | not built | 0.0102 | 0.815 | +0.066 |
| 4 layers of 128x128 | 65,536 | 1.0 MiB | not built | 0.0131 | 1.048 | +0.122 |
| 8 layers of 128x128 | 131,072 | 2.0 MiB | not built | 0.0201 | 1.605 | +0.196 |
| volume 32x32x32 | 32,768 | 512 KiB | not built | 0.0112 | 0.894 | +0.120 |
| volume 48x16x48 | 36,864 | 576 KiB | not built | 0.0105 | 0.843 | +0.078 |
| volume 64x24x64 | 98,304 | 1.5 MiB | not built | 0.0161 | 1.287 | +0.146 |

The task's pressure sweep comes from the real cycle's floor and the chain's step:
`field step(p) = advect and project + p * chain step`. The floor is the real cycle less the twenty
chain steps that model its pressure iterations. The rows are a cycle a frame at sixty steps a
second. At thirty a second they halve, and at fifteen they quarter.

| Flat grid | 8 pressure | 16 | 20, the real cycle | 24 | 40 | 80 |
| --- | --- | --- | --- | --- | --- | --- |
| 32x32 | 0.142 | 0.194 | 0.220 | 0.246 | 0.351 | 0.612 |
| 64x64 | 0.145 | 0.199 | 0.226 | 0.253 | 0.361 | 0.630 |
| 128x128 | 0.149 | 0.210 | 0.241 | 0.272 | 0.394 | 0.701 |
| 256x256 | 0.227 | 0.314 | 0.361 | 0.402 | 0.577 | 1.014 |

The least-squares line through the flat shapes' single steps gives 0.013 ms of fixed cost a step
and 0.059 nanoseconds a cell. At 256x256 the cells make 0.004 ms of a 0.011 ms step. Below 128x128
the step's fixed cost is nearly all of it.

The real cycle shows the same shape. Its twenty-two runs cost 0.220 ms at 32x32 and 0.361 ms at
256x256. Five times the cells add 0.14 ms. About 0.09 ms at 32x32 is the advection that evaluates
the analytic field with five curl taps, with the projection and the dispatch beside it. At 256x256
the same floor is about 0.14 ms.

Drag, one more read a cell a step, adds 0.051 to 0.055 ms on the flat grids up to 128x128 and 0.112
at 256x256. On the tiled shapes it adds 0.053 to 0.196 ms, the larger figures where the cells
dominate. That is one read against the six or eight that a step already makes.

The volume's Ultra row takes the same floor: about 0.09 ms of advection and projection, plus forty
steps at the volume's 0.0161 ms, is about 0.73 ms. The flat 256x256 grid that stands in until the
volume is built costs 0.58 there, its floor of 0.140 ms plus forty steps at 0.0109 ms.

### Compatibility mode

Compatibility mode runs the same WebGPU backend under the compatibility limits. Its per-pass figures
match WebGPU within about 3 per cent. The real cycle costs 0.225, 0.227, 0.243 and 0.362 ms from
32x32 to 256x256. The least-squares line through the flat shapes is 0.013 ms of fixed cost a step
and 0.075 nanoseconds a cell. The machine's load rose from 6.9 to between 22 and 43 during that run
as other sessions worked. The per-pass figures stand on the GPU's own timestamps, and a frame-level
figure from that run would not.

### WebGL2 on the Mac

The field's whole-frame GPU time less the same frame without it, median of three rounds. WebGL2 has
no per-pass timer, so the figure carries the field's pass as the frame's commands show it.

| Shape | 1 step (ms) | 8 steps (ms) | 16 steps (ms) | 24 steps (ms) | 40 steps (ms) | 80 steps (ms) | Real cycle, 20 pressure (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flat 32x32 | 0.073 | 1.261 | 2.956 | 6.553 | 12.238 | 27.364 | 4.836 |
| flat 64x64 | 0.128 | 1.327 | 3.007 | 6.364 | 12.495 | 23.625 | 4.466 |
| flat 128x128 | 0.113 | 1.289 | 2.618 | 5.851 | 12.563 | 23.920 | 4.371 |
| flat 256x256 | 0.177 | 1.376 | 3.103 | 6.272 | 12.123 | 23.620 | 5.050 |

The cost is fixed per run, not per cell. Eight runs cost 1.26 to 1.38 ms at every shape from 1,024
to 65,536 cells, about 0.16 to 0.17 ms a run. Sixteen runs cost about twice that. From 24 runs a
frame the field's work passes the display's interval, so the GPU queues frames and the per-run
figure climbs. The 24, 40 and 80 run rows are saturation points, not a clean cost. The add-on's
shipped cycle, 22 runs at 60 cycles a second, costs 4.4 to 5.1 ms a frame. The single-step rows
scatter between 0.073 and 0.177 ms, and the least-squares line through them cannot separate a
step's fixed part from its cells. The eight-run rows are the clean measure.

Drag is one read in six and stays inside the run-to-run spread at every count. The 16 by 16 read
answered after 65.5 to 67.0 ms, 4 frames late.

Low's row is a cycle of ten runs at 15 cycles a second. That cycle is eight pressure steps, the
advection and the projection. The rate is 2.5 runs a frame. At the Mac's 0.17 ms a run that is about
0.43 ms. At 30 cycles a second it is 0.85 ms. Medium's eighteen-run cycle is 0.77 ms a frame at 15
cycles a second and 1.53 ms at 30. So Medium takes 15 cycles a second on this path, inside its
1.2 ms ceiling.

### The read of a small summary

The real pass's 16 by 16 region reads back through `render.readPass`'s promise. The wait was 47.1
to 51.3 ms on the two WebGPU paths, and the read answered 3 frames late. The wait covers the GPU
finishing the frame and the buffer mapping, so it is not GPU time. A page still cannot use the
answer in the frame that asked.

### The phones on WebGL2

The iPhone 17's Safari 26.6 and the Galaxy S24's Chrome 152 ran the two flat grids at `c4504a038`.
The page draws 640 by 400 texels. The `real` side is the solver's shipped cycle: 22 runs a frame at
20 pressure steps. WebGL2 on a phone has no pass timer, so the rows give the frame interval and the
busiest thread's CPU time.

| Device, display | Shape | Interval, off (ms) | Interval, real (ms) | CPU, off (ms) | CPU, real (ms) | CPU, 8 steps (ms) | CPU, 1 step (ms) | Read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 17, 60 Hz | 32x32 | 15.52 | 15.54 | 0.88 | 3.65 | 2.14 | 1.18 | 62.3 ms, 4 frames |
| iPhone 17, 60 Hz | 64x64 | 15.52 | 15.54 | 0.86 | 3.39 | 2.10 | 1.10 | 60.9 ms, 4 frames |
| Galaxy S24, 30 Hz | 32x32 | 33.32 | 33.33 | 1.90 | 2.11 | 2.29 | 2.24 | 123.8 ms, 4 frames |
| Galaxy S24, 30 Hz | 64x64 | 33.33 | 33.33 | 1.81 | 1.95 | 1.87 | 1.92 | 117.7 ms, 4 frames |

Every row in this section is a bound, not a measurement of the field's cost. The frame interval and
the busiest thread are what the device reports without a pass timer.

Neither display's interval moves under the shipped cycle. On the iPhone that cycle is 1,320 runs a
second, 8.8 times the 150 runs a second that Low's row asks for. On the S24 it is 660 runs a second,
4.4 times. The iPhone's busiest thread rises by 2.77 ms and stays about 12 ms inside the display's
interval. The S24's busiest thread barely moves, because Chrome submits its WebGL2 work from the GPU
process. Without a timer the 0.5 ms figure itself cannot be read on either phone. These rows
therefore bound Low's row rather than prove it.

### The rows' shapes at this head

A quiet-window run at `06e10a77f` measured the three shapes that the rows take, rather than the flat
stand-ins that stood in for High and Ultra. It read the field at 1, 8, 24 and 40 chain steps, with
the drag beside the last, in three rounds of each side. The load sat at 3.4 to 4.2 through it
([its run](../tested-devices/macbook-pro-m3-max-chrome/20261101-1044-wind-field-cost.md)). The
figures agree with the earlier run within its spread. Flat 64x64's real cycle reads 0.227 ms against
0.226, and WebGL2's eight steps 1.258 against 1.327.

| Shape | WebGPU 1 / 8 / 24 / 40 steps (ms) | WebGL2 1 / 8 / 24 / 40 steps (ms) | Drag adds (ms) |
| --- | --- | --- | --- |
| flat 64x64 | 0.014 / 0.061 / 0.168 / 0.277 | 0.078 / 1.258 / 5.630 / 11.643 | 0.021 / 0.118 |
| 4 layers of 128x128 | 0.019 / 0.111 / 0.321 / 0.530 | 0.083 / 1.235 / 5.975 / 11.883 | 0.056 / 0.376 |
| volume 64x24x64 | 0.022 / 0.137 / 0.395 / 0.648 | 0.081 / 1.318 / 6.057 / 11.896 | 0.074 / 0.152 |

The volume's 40 steps at 0.648 ms take the advection and projection floor of about 0.09 ms on top,
so its Ultra row is about 0.74 ms a frame at one cycle a frame. The layered shape's 24 steps at
0.321 ms make one cycle of about 0.41 ms, and High's 30 field steps a second is half a cycle a
frame, so about 0.21 ms. The flat 64x64 grid's 16 by 16 read answered in 49.470 ms on WebGPU, 3
frames late, and 62.910 ms on WebGL2, 4 frames late.

On WebGL2 the three shapes cost the same at each run count, which confirms the path's fixed cost a
run. The medium row's eighteen-run cycle at 15 cycles a second is 4.5 runs a frame at about 0.16 ms
a run, so about 0.7 ms a frame.

### The cloud devices

The iPad Pro 13's Safari 26.6.1, the Galaxy S25's Chrome 152 and the Galaxy Tab A9 Plus's Chrome 152
ran the plan at the shapes of the preset rows. Each ran on every path that its device offers. Each
page plays the field off, the solver's shipped cycle and a chain of the same work per step. Three
rounds of each side run in turn, with the drag beside the last. WebGPU and compatibility mode time
each pass, so the field's own GPU time is measured there. WebGL2 has no pass timer on a phone, so
its rows compare a frame with the field and a frame without it.

**WebGPU.** GPU milliseconds of the field's own pass, the median of three rounds. A dash is a pressure count
that the page does not run at that shape. "Below the timer" is a step under the device's timestamp
step, which the phones and the tablet report coarsely.

| Device | Shape | Shipped cycle | 1 step | 8 steps | 16 steps | 24 steps | 40 steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPad Pro 13 | flat 32x32 | 0.184 | 0.011 | 0.051 | - | - | - |
| iPad Pro 13 | flat 64x64 | 0.191 | 0.012 | 0.057 | 0.105 | - | - |
| iPad Pro 13 | 4 layers of 128x128 | not built | 0.029 | 0.191 | - | 0.578 | - |
| iPad Pro 13 | volume 64x24x64 | not built | 0.036 | - | - | 0.762 | 1.326 |
| Galaxy S25 | flat 32x32 | 0.393 | below the timer | 0.066 | - | - | - |
| Galaxy S25 | flat 64x64 | 0.426 | below the timer | 0.131 | 0.197 | - | - |
| Galaxy S25 | 4 layers of 128x128 | not built | 0.066 | 0.786 | - | 2.359 | - |
| Galaxy S25 | volume 64x24x64 | not built | 0.131 | - | - | 3.146 | 5.243 |
| Galaxy Tab A9 Plus | flat 32x32 | 0.262 | below the timer | 0.066 | - | - | - |
| Galaxy Tab A9 Plus | flat 64x64 | 0.983 | below the timer | 0.131 | 0.262 | - | - |
| Galaxy Tab A9 Plus | 4 layers of 128x128 | not built | 0.262 | 2.294 | - | 5.308 | - |
| Galaxy Tab A9 Plus | volume 64x24x64 | not built | 0.393 | - | - | 6.455 | 8.389 |

The drag adds 0.006, 0.012, 0.087 and 0.700 ms on the iPad's four shapes, and 0.032, 0.065 and 0.066
on the S25's three smaller ones. On the S25's volume the pass's own figure does not move at 40 steps,
while the frame's rises by 0.098 ms, because the device rounds a timestamp there.

The iPad's drag adds about a tenth to a flat step and about half again to the volume's, where one
more read joins six and the cells are many. The tablet's drag adds 1.966 ms to its layered shape and
1.114 to its volume, and 0.327 to the layered shape in compatibility mode.

**Compatibility mode.** The same backend under the compatibility limits. The devices' figures
match their WebGPU ones within a few hundredths of a millisecond.

| Device | Shape | Shipped cycle | 1 step | 8 steps | 16 steps | 24 steps | Drag adds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPad Pro 13 | flat 64x64 | 0.190 | 0.014 | 0.055 | 0.105 | - | 0.008 |
| iPad Pro 13 | 4 layers of 128x128 | not built | 0.031 | 0.187 | - | 0.560 | 0.076 |
| Galaxy S25 | flat 64x64 | 0.393 | below the timer | 0.131 | 0.197 | - | 0.065 |
| Galaxy Tab A9 Plus | flat 64x64 | 0.983 | below the timer | 0.131 | 0.262 | - | 0.000 |
| Galaxy Tab A9 Plus | 4 layers of 128x128 | not built | 0.262 | 1.966 | - | 5.145 | 0.327 |

**WebGL2.** A phone or tablet gives WebGL2 no per-pass timer, so these rows are the frame with the
field less the frame without it, with the interval and the busiest thread beside them. The iPad's
field does not rise above the query's floor at either flat shape.

| Device | Shape | Shipped cycle (ms) | 8 steps (ms) | Interval off (ms) | Interval real (ms) | CPU off (ms) | CPU real (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPad Pro 13 | flat 32x32 | 0.00 | 0.00 | 15.48 | 15.48 | 0.66 | 0.66 |
| iPad Pro 13 | flat 64x64 | 0.00 | 0.00 | 15.46 | 15.46 | 0.66 | 0.66 |
| Galaxy S25 | flat 32x32 | 0.00 | 0.00 | 33.32 | 33.33 | 0.50 | 0.56 |
| Galaxy S25 | flat 64x64 | 0.00 | 0.00 | 33.32 | 33.33 | 0.49 | 0.59 |
| Galaxy Tab A9 Plus | flat 32x32 | 0.00 | 0.00 | 11.14 | 11.14 | 0.30 | 0.30 |
| Galaxy Tab A9 Plus | flat 64x64 | 0.00 | 0.00 | 11.14 | 11.14 | 0.33 | 0.33 |

The field steps at a fixed 60 steps a second, whatever the frame rate (D-265). A row's figure a
frame therefore depends on the display: a 60 Hz frame owes one cycle, a 30 Hz frame two, and a
90 Hz frame two thirds. The three devices show the difference.

| Device, display | Ultra cycle (ms) | Cycles a frame | Ultra a frame (ms) | Against 6.25 |
| --- | --- | --- | --- | --- |
| iPad Pro 13, 60 Hz | 1.42 | 1 | 1.42 | inside |
| Galaxy Tab A9 Plus, 90 Hz | 9.29 | 0.67 | 6.20 | inside by 1 per cent |
| Galaxy S25, 30 Hz | 5.54 | 2 | 11.08 | over by 77 per cent |

Each cycle is the row's 40 steps plus the advection and projection floor, which the shipped cycle
fixes on each device. High's row is a cycle of 24 steps at 30 a second, and Medium's 16 at 30, and
both are inside every budget on every device. High is 0.33 ms a frame on the iPad and 2.1 on the
tablet, and Medium is 0.09 and 0.36.

The S25 is the one device whose frame owes two cycles. Its 11.08 ms is 2.2 per cent of the 499.8 ms
frame ceiling that D-241 gives this class at Ultra, so a Creek or forest page still holds that
ceiling there. It is over the wind's own 6.25 ms figure, which the Apple devices set. At 30 field
steps a second the frame owes one cycle and the row is 5.54 ms, inside the figure. The governor's
`double` step reaches that rate when the field's GPU time passes its budget, and M3-V16 gives it.
So Ultra on a 30 Hz display runs at 30 cycles a second until that device measures inside. The
S25's frame interval is its display's cap, not its work, so the field's pass times are the figures
that count there.

The tablet's Ultra row is at the budget's edge, and the canopy drag takes it over: the drag adds
1.114 ms a cycle there, so a frame carries about 6.9 ms. The governor's step covers that too.

### The readers

The grove page draws four oak variants in seven copies. The leaf and bark materials sway in the
field, and the sun's three cascades follow. Its `?field=analytic` switch gives the same materials a
field of no width, so every sample computes the steady field instead of reading the grid. `?motion`
draws the motion view. The two sides ran in turns at Medium on WebGPU.

| Pass | Field (ms) | Analytic (ms) | Delta (ms) |
| --- | --- | --- | --- |
| shadow cascade 0 | 0.793 | 0.811 | -0.018 |
| shadow cascade 1 | 1.009 | 1.049 | -0.040 |
| shadow cascade 2 | 1.037 | 1.173 | -0.136 |
| opaque, the main view | 5.653 | 5.739 | -0.085 |
| the field's own pass | 0.117 | 0.027 | +0.089 |
| whole frame | 6.298 | 6.237 | +0.061 |

The field's reader is cheaper than the analytic one in every pass that draws a plant. One texture
read replaces the steady field's five curl taps and its transcendentals. The saving is 0.018 to
0.136 ms in the cascades and 0.085 ms in the main view's opaque pass. The field's own pass costs
0.089 ms, so at Medium the field is about 0.06 ms dearer in the whole frame.

The motion view runs the offset a second time. Its whole frame reads 5.805 ms with the field and
5.902 without, and its opaque pass 5.017 against 5.194. The pass the engine names `motion` reads
4.966 against 5.162, and the pass it names `motion view` reads 4.783 against 5.150. The savings
there are 0.18 to 0.37 ms, because the second offset pays the reader's cost twice.

At Ultra the whole frame reads 6.545 ms with the field and 6.379 without. The field's own pass
costs about 0.05 ms more than the plants save across the larger sway distance. Its cascades are
within 0.01 ms of each other.

WebGL2 has no pass timer, so its one row is the whole frame. It is 37.653 ms with the field and
16.935 without at Medium, a difference of 20.7 ms. That figure does not isolate the reader. The
add-on today steps at a fixed sixty cycles a second, so a slower frame runs more cycles. The same
frame time raises the next frame's field work. At this row the display is at 26 frames a second, so
the pass runs about two cycles a frame. The field page's own 22-run cycle costs a few milliseconds.
The WebGL2 figure is therefore a bound that mixes the pass and the reader. It also says what the
governor must fix: a row at 15 cycles a second keeps WebGL2 inside its budget, and M3-V16 gives the
add-on that setting.

Reflections have no reader on this tree. Creek's and the forest's plants are not on the add-on yet,
so their passes and the reflections wait on M3-V11 and M3-V12.

### Branch poses with springs

The pose method is measured on its own branch, not here. M3-V10's record covers the spring tree
sweep. It gives the frame and the vertex view with per-vertex wind and with branch poses. The two
methods ran in turns at each preset and path on the Mac, the iPad Pro 13 and the Galaxy S25, with
the spring's figures and the pose pictures. This task does not repeat them. The count of trees that
carry springs at each preset is the governor's setting, which M3-V16 declares.

### The leaves

The two ways for leaves to ride the wind are not measured. Falling and drifting leaves are M3-V17's
work, and no page on this tree draws a leaf with a place and a speed of its own. The plan's first
form is an offset from the field on the closed-form particle path. It costs one texture read and
cannot carry a leaf along a gust. The second form is a compute pass with history that steps each
leaf, which M3-V13 now makes possible. The comparison at 500, 2,000 and 10,000 leaves waits on that
build.

## Look

The layered and the volume grids look better than the flat stand-ins, because the air gains height,
and the record takes them where their cost fits ([hard rule 40](../../AGENTS.md#hard-rules)). The
one look still open is the smallest tier's: a side-by-side of the formula wind and the 32x32 grid on
a phone, which the owner has not judged.

## Decision

The rows below stand, as the owner ruled. Each figure is the field's own GPU time a frame at that
row, not a whole frame. Each WebGPU and Mac WebGL2 figure is modelled from measured parts. Low's
phone figure is a bound, not a measurement, as the Data section says.

| Preset | Field | Grid | Pressure steps | Field steps a second | WebGPU (ms) | WebGL2 (ms) | Budget (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | analytic, or the smallest flat grid | none, or 32x32 | none, or 8 | none, or 15 | 0, or 0.04 | 0, or 0.43 | 0.5 |
| Medium | flat grid | 64x64 | 16 | 30, and 15 on WebGL2 | 0.10 | 0.77 | 1.2 |
| High | 4 layers of 128x128, and flat 128x128 until it is built | 4 layers of 128x128, or 128x128 | 24 | 30 | 0.20, or 0.14 on the flat grid | not drawn | 4.9 |
| Ultra | volume 64x24x64, and flat 256x256 until it is built | 64x24x64, or 256x256 | 40 | 60 | 0.73, or 0.58 on the flat grid | not drawn | 6.25 |

Every figure in this table is modelled from the measured parts, and the budget column is the
accepted ceiling. None of these figures is a phone measurement. Low's 0.5 ms is the planning
ceiling for the field. The phone rows in the Data section bound Low's cost with the frame interval,
and no phone read 0.5 ms there. A reader must not take 0.5 ms for a phone figure.

Three devices have now measured the rows, and the figures hold on all but one cell. The iPad Pro
13 is inside every budget: Ultra costs 1.42 ms a frame, High 0.33 and Medium 0.09. The Galaxy Tab A9
Plus holds Ultra at 6.20 ms of 6.25, at the edge, and the canopy drag takes it to about 6.9. The
Galaxy S25's 30 Hz display owes two cycles a frame, so its Ultra row is 11.08 ms; it holds D-241's
499.8 ms frame ceiling for the class at 2.2 per cent, but it is over the wind's own figure until the
governor steps Ultra to 30 field steps a second there, which brings it to 5.54 ms. That step is the
`double` governor that M3-V16 declares, and it is the one recommendation this record adds to the
owner's ruling.

- The grid's size is not the cost knob. The pressure count and the field rate set the cost, and both
  halve it when they halve. A row that needs less should take fewer steps a second before it takes a
  smaller grid. The smaller grid loses the eddies near the camera.
- WebGL2 pays a fixed cost for each solver run, so the Medium row steps 15 times a second there and
  30 times on the other paths. Readers mix the two states, so the slower field still moves smoothly
  (D-265). The governor's `webgl2` row gives 66 ms at Medium.
- Low keeps the analytic field on the phones until the phone GPU cost of the small grid is
  measured. The phones hold their display intervals under 4.4 to 8.8 times Low's run rate. That
  bound is looser than the 0.5 ms planning ceiling, because 22 runs a frame may cost as much as the
  display's interval. Low's 2.5 runs a frame is therefore bounded by a fraction of that interval,
  not by 0.5 ms. The iPhone's busiest thread rises 2.77 ms for the 22 runs, which puts Low's rate
  near 0.3 ms of CPU there. On the Mac's WebGL2 the row costs about 0.43 ms at 0.17 ms a run, inside
  the ceiling. So the formula field stays the safe row, and it is also the fallback for a device
  without a float target. The owner has not named the smallest-tier look, which a side-by-side of
  the formula wind and the 32x32 field would settle.
- High and Ultra take the plan's own shapes, four layers of 128x128 at High and the volume 64x24x64
  at Ultra. The layered and the volume grids look better where the air has height. They cost 0.20
  and 0.73 ms at their rows on WebGPU, well inside their budgets, so the better look wins when it is
  built (hard rule 40). Until the solver builds them, the flat 128x128 and 256x256 grids stand in,
  at 0.14 and 0.58 ms.
- The budgets are one tenth of the vegetation add-on's own: 0.5, 1.2, 4.9 and 6.25 ms. Every
  measured row is far inside them on WebGPU, and the phones hold their intervals. The owner accepted
  them as they stand.

## Consequences

- M3-V16 declares these rows with the budget, the `webgl2` row and the overlay row. That row reads
  like the water's. Its `windSpringTrees` value has no reader until M3-V10 lands.
- The drag is measured as one more read a cell a step, not as the scatter's grid. When M3-V17 gives
  the wind that grid, its cost is a read a cell a step. That is what this record measured.
- The readers are measured on the grove. It is the only dressed plant scene the add-on draws on this
  tree. Creek's and the forest's readers, and the reflections, follow M3-V11 and M3-V12.
- The two leaf forms wait on M3-V17. A leaf with its own speed needs the step that M3-V13 gives.
- The spring tree sweep is covered by M3-V10's record, which measured branch poses with springs
  beside per-vertex wind. This record does not repeat it.
- The flag and the water surface read the field through one texture. Their vertex read is not
  measured. The plant material uses four of its six texture slots, so two are free for the field's
  two states and the branch poses. The water material uses three of six, so three are free for a
  flag or a ripple.
- The device rows are measured on this Mac's Apple M3 Max, the iPhone 17, the Galaxy S24, the iPad
  Pro 13, the Galaxy S25 and the Galaxy Tab A9 Plus. The M5 Max that the task names is owed, because
  this machine is an M3 Max and no M5 Max ran the plan. The solver on this tree fixes 20 pressure
  steps and 60 cycles a second. The real cycles in the tables are that cycle, and the other pressure
  counts and field rates are the chain's.
- A row's cost a frame follows the display's rate, because the field steps at a fixed rate: a 30 Hz
  display carries two cycles in each frame and a 90 Hz display two thirds of one. M3-V16's governor
  must therefore read the field's GPU time a frame, not a cycle, so a slow display's row steps down
  when its frame goes over the budget. The S25's Ultra row is the case that proves it.
