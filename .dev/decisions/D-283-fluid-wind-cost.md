# D-283: The fluid wind's cost, and its budget at each preset

Status: decided by the owner. The owner accepted the rows and budgets that this record proposes:
0.5, 1.2, 4.9 and 6.25 ms from Low to Ultra, with Medium on the flat 64x64 grid, High on four
layers of 128x128, Ultra on the volume 64x24x64, and Low on the formula wind on phones until a
phone measures the small grid. The ruling closes the rows and the budgets. The smallest-tier look is judged: shown the wind demo at
Low beside Medium, the owner answered that he can tell the difference, and shown Medium beside High
he answered that he finds little difference, so the smallest tier he cannot tell from the next one up
is Medium. The look clause is met: shown the wind demo's two tiers side by side, the owner answered "low looks fine, close it". Two clauses of the task's Done-when stay open: the cost of each tier on the M5 Max, because the machine here is an M3 Max and no M5 Max ran
the plan, while the iPad Pro 13, the Galaxy S25 and the Galaxy Tab A9 Plus now carry their rows; and
the proof that the chosen rows keep Creek and the forest within D-241's frame ceilings: the S25's
Ultra Creek row read 516.56 ms against the 511 ms ceiling before its governed settle and now holds by measurement, with the forest's rows measured over
their ceilings too, at 88, 111 and 97 ms on the iPad at Medium, High and Ultra against 54.8, 67.1 and
71.1, and 66 ms on the cloud S24 at Medium against 33.3. The three devices measured their rows. Every field row holds,
the Galaxy S25's Ultra cell included on its governed frame: its 30 Hz display owes two field cycles a frame, so the
modelled frame is 11.08 ms, from the measured 5.243 ms of its 40 volume steps plus the
advection and projection floor, doubled. That is over the wind's own 6.25 ms figure, and D-241's
499.8 ms is the measured Creek frame at Ultra on that phone, not a ceiling with room in it: the
frame with the wind is about 510.9 ms, over by 2.2 per cent, and the governor's 30 field steps a
second step gives about 505.3 ms, still over. That model is the history the measured row supersedes: run
`20261112-035733-vegetation.md` holds the creek Ultra page at the Ultra preset with no preset check and the
render scale at 1.00, draws 20.47M triangles and 867 draws, and its three window medians read 433.25, 433.31
and 366.63 ms against the 511 ms ceiling, 78 ms inside, with the p95 at 966.43, 814.95 and 733.27 ms as the
caveat. The owner ruled that the class ceiling includes the
wind's share. The S25-class Ultra ceiling is therefore 511 ms: the measured 499.8 ms plus the
modelled 11.08 ms, which D-241 now states beside its measured rows. The owner declined the two
other options that this record set out. Ultra does not skip the field, and the preset does not step
down there, which D-241 calls a failure. The tablet's field row holds at the budget's edge, and its
canopy drag takes it over, so the governor must step that row too. Built: the wind add-on's field
and its state-keeping solver
(M3-V13, M3-V15). Built too: the plant material's vertex reader (M3-V7) and the cost pages that
time them. Not built: the preset rows and budgets (M3-V16), branch poses (M3-V10, measured on its own branch),
and Creek's and the forest's plants on the add-on (M3-V11, M3-V12). M3-V17 built the canopy drag and
the falling leaves, with the open clauses that its addendum lists. Task: M3-V14.

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
([its run](../tested-devices/macbook-pro-m3-max-chrome/20261101-1044-wind-field-cost.md)). Neither
Mac record states a run-to-run spread, so a claim that a figure stayed within a spread has no
denominator. The re-measured cells moved: WebGL2's eight steps at flat 64x64 read 1.258 against
1.327 ms, 5.2 per cent lower, and its single step 0.078 against 0.128, 39 per cent lower. Four
figures in the Decision table come from shapes that run never played: Low's two, and the flat
128x128 and 256x256 stand-ins that High's and Ultra's fallbacks rest on. The devices' tables come from the plan's run at the same
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
and 0.075 nanoseconds a cell. The machine's load began at 8.0 and ended between 8.0 and 19.7 during
that run as other sessions worked. The per-pass figures stand on the GPU's own timestamps, and a frame-level
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
to 65,536 cells, about 0.16 to 0.17 ms a run. Sixteen runs cost about twice that. Past 16 runs a
frame the field's work passes the display's interval, so the GPU queues frames and the per-run
figure climbs. The 24, 40 and 80 run rows are saturation points, not a clean cost. The add-on's
shipped cycle, 22 runs at 60 cycles a second, costs 4.4 to 5.1 ms a frame. The single-step rows
scatter between 0.073 and 0.177 ms, and the least-squares line through them cannot separate a
step's fixed part from its cells. The eight-run rows are the clean measure.

The drag is one more read in a step's six. On WebGL2 it adds 0.118 ms to flat 64x64 at 40 runs,
0.376 to the layered shape and 0.152 to the volume (the `06e10a77f` run). The 16 by 16 read of flat
64x64 answered after 62.910 ms, 4 frames late, in that run.

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
re-measured cells moved, and no record states a spread to judge them by. Flat 64x64's real cycle
reads 0.227 ms against 0.226; WebGL2's eight steps 1.258 against 1.327, 5.2 per cent lower; and its
single step 0.078 against 0.128, 39 per cent lower.

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

**Compatibility mode.** The same backend under the compatibility limits. Most cells match their
WebGPU ones within 0.02 ms. The tablet's layered shape is the widest gap. Its eight steps cost
1.966 ms against 2.294 on WebGPU, its 24 steps 5.145 against 5.308, and its drag adds 0.327 against
1.966. The tablet's folder once recorded that compatibility mode lost the GPU there. It also said
that its figures must not be read. That note is stale: the run reports a WebGPU adapter and plays
every path, and these figures stand.

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
fixes on each device. The S25's cycle is its measured 5.243 ms of 40 volume steps plus a floor of
about 0.3 ms. That is the about 5.6 ms that the run states. The 5.54 and 11.08 are that
back-computed cycle and its double. High's row is a cycle of 24 steps at 30 a second, and Medium's
16 at 30, and both are inside every budget on every device. High is 0.33 ms a frame on the iPad and
2.1 on the tablet, and Medium is 0.09 and 0.36.

The S25 is the one device whose frame owes two cycles, and its Ultra row is open. D-241's 499.8 ms
at Ultra is that phone's measured Creek frame, not a ceiling with headroom: the frame already fills
it. Adding the wind's 11.08 ms gives about 510.9 ms, over the ceiling by the same 2.2 per cent. The
governor's 30 field steps a second step gives one cycle, about 5.54 ms, and a frame of about 505.3
ms, still over. So the row holds neither the wind's own 6.25 ms figure nor D-241's ceiling. The
owner must choose one of three options. The first is that the class ceiling includes the wind's
share. The second is that Ultra does not run the field on a display that owes two cycles. The third
is that the preset steps down there, which D-241 calls a failure. This record picks none. The S25's
frame interval is its display's cap, not its work, so
the field's pass times are the figures that count there.

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

Three devices have now measured the rows. The iPad Pro 13 is inside every budget: Ultra costs 1.42
ms a frame, High 0.33 and Medium 0.09. The Galaxy Tab A9 Plus holds Ultra at 6.20 ms of 6.25, at the
edge, and the canopy drag takes it to about 6.9. The Galaxy S25's Ultra row is open. Its 30 Hz
display owes two cycles a frame, so the modelled frame is 11.08 ms. That is over the wind's own
6.25 ms figure, and it takes D-241's 499.8 ms Creek frame to about 510.9 ms, over it. The
governor's step to 30 field steps a second gives about 505.3 ms, still over. The owner must choose
one of three options. The first is that the class ceiling includes the wind's share. The second is
that Ultra skips the field on a display that owes two cycles. The third is that the preset steps
down there, which D-241 calls a failure. This record picks none. The requirement that the governor
read the field's cost a frame rather than a cycle is recorded in M3-V16's plan block, with this
case as its test.

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
  without a float target. The owner has judged the smallest-tier look, having said that he can tell Low
  from Medium and that he finds little difference between Medium and High, so the tier he cannot tell
  from the next one up is Medium; a side-by-side of the formula wind and the 32x32 field would settle
  Low's.
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
- The two leaf forms are still uncompared, and the comparison has no owner. This record defers it to
  M3-V17, while M3-V17's line takes "the form that M3-V14's comparison picks". The loop must be
  broken: either the plan's V17 line names who runs the comparison, or this task does. A leaf with
  its own speed needs the step that M3-V13 gives.
- The spring tree sweep is covered by M3-V10's record, which measured branch poses with springs
  beside per-vertex wind. This record does not repeat it.
- The flag and the water surface read the field through one texture. Their vertex read is not
  measured, and no task owns that measurement, though the plan asks this task to time it. The plant
  material uses four of its six texture slots, so two are free for the field's
  two states and the branch poses. The water material uses three of six, so three are free for a
  flag or a ripple.
- The device rows are measured on this Mac's Apple M3 Max, the iPhone 17, the Galaxy S24, the iPad
  Pro 13, the Galaxy S25 and the Galaxy Tab A9 Plus. The M5 Max that the task names is owed, because
  this machine is an M3 Max and no M5 Max ran the plan. The solver on this tree fixes 20 pressure
  steps and 60 cycles a second. The real cycles in the tables are that cycle, and the other pressure
  counts and field rates are the chain's.
- A row's cost a frame follows the display's rate, because the field steps at a fixed rate: a 30 Hz
  display carries two cycles in each frame and a 90 Hz display two thirds of one. The S25's open
  Ultra row is the case that shows it. The requirement that the governor read the field's GPU time
  a frame rather than a cycle is M3-V16's. Its plan block names that case as the test.

## Addendum: the rows the add-on declares, and the governor's floor

M3-V16 declares the rows above in the wind add-on. The add-on names its work to the engine as one
feature, with the settings, the budget, the memory and the frame scope below. Nothing in this
addendum changes the owner's ruling; it records how the ruling reaches the engine.

| Setting | Low | Medium | High | Ultra | Governor |
| --- | --- | --- | --- | --- | --- |
| `windStepMs` | 0 | 33 | 33 | 16 | `double`, up to 133 ms |
| `windPressureSteps` | 0 | 16 | 24 | 40 | `scale` |
| `windSpringTrees` | 0 | 8 | 32 | 64 | `scale` |
| `windGrid` | 0, no grid | 64 | 128 | 256 | `none` |
| Budget, ms a frame | 0.5 | 1.2 | 4.9 | 6.25 | floor 0.25 |

- The `webgl2` row gives 66 ms at Medium and above, which is 15 cycles a second. That is the row
  this record already proposes for WebGL2, where each run costs about 0.16 ms whatever its cells.
- Low keeps the formula field on every path. Its settings are zero and it makes no pass. The owner
  has not judged the side-by-side with a small grid. No phone measured the grid's cost either. So
  the record's Low row stays the analytic field.
- High and Ultra name the flat 128 and 256 grids. The layered and volume grids are not built. The
  interface already takes a grid size, so the row moves to them when the solver does.
- A page that gives `grid` keeps it, on every preset. The record's rows then set only the interval
  and the pressure count for that page.
- The governor's floor is a quarter of the budget. At that step the interval is 133 ms at most, and
  the cycle keeps at least one pressure iteration. So the air still moves and still keeps its
  volume. A still valley does not meet the bar.
- Each budget is smaller than the room that D-241 leaves beside the vegetation's own budget. D-241's
  ceiling for a preset is one measured whole frame, and it already holds the vegetation and the
  scene. Take the smallest measured ceiling of each preset. The vegetation's 5, 12, 49.0 and 62.5
  ms leave 10.5, 31.9, 13.5 and 8.6 ms of room there. The wind's 0.5, 1.2, 4.9 and 6.25 ms fit
  inside that room. The check therefore says the field's budget fits in the room beside the
  vegetation, and no more. A frame that spends both grows by the field's share, and the governor is
  what holds such a frame.

### The cost per frame, not per cycle

This record recommends that the add-on read the field's cost per frame. The add-on does, and the
engine's shape gives it free. The feature's GPU scope is the field's pass, and the engine times a
pass over the runs that one frame records. A frame that owes two cycles therefore costs two cycles
in the figure. The settings take the budget's figures as they stand, in ms a frame. So the S25's
Ultra row steps down when the frame carries two cycles.

The engine's frame-budget governor still decides its steps from the whole frame's time. So the
wind's budget is a figure that the overlay shows beside the field's measured frame time. The
governor lightens the field with the sketch's other budgets. The record's recommendation holds for
the figure and the budget, not for the governor's input.

### What the branch proves, and what it owes

- Unit tests show that each preset moves each setting. They show that each of the governor's steps
  moves the interval, the pressure count and the spring trees, and that the budget's floor holds.
  They show too that a preset change that changes the grid makes a pass of the new size.
- `windSpringTrees` has no reader yet. Branch poses are M3-V10's work, so the setting waits for
  them. The vegetation add-on reads it when they land.
- The stress page drives the governor down and back up with a load of cards that read the field. It
  ran on this Mac at 2,097,152 cards. It ran on the cloud iPad Pro 13 and Galaxy S25 at 500,000.
  Every preset with a field stepped at least one step on every device, and every one came back.
  The records sit in the tested-devices folder for this Mac, the iPad and the S25.
- The load is the figure that makes the page work. At 400,000 cards the Mac stayed at its display's
  60 Hz. At 250,000 the S25 stayed inside its 33.3 ms frame in one run and stepped in another. A
  load that leaves the frame inside its budget gives the governor nothing to act on. The page
  therefore reads the heavy phase's frame and reports whether the load was over the budget before
  it asks for a step.
- The S25's Ultra row stepped from 16 to 32 ms in that run. That is 31.25 field steps a second,
  which is one cycle a frame. Its one cycle costs about 5.8 ms, inside the row's 6.25 ms budget,
  so the step makes the S25's Ultra row fit its own figure. The row alone does not make it happen.
  11.08 ms is inside the display's 33.3 ms frame, so the governor has no reason to step there. It
  steps only when other work makes the frame long. The governor's input is the whole frame, as the
  section above says.
- The step does not close D-241's Creek ceiling on the S25. A Creek frame there already measures at
  the class's 499.8 ms, and adding the field's share of about 5.5 ms still goes over it. The
  owner's three options for that ceiling therefore stand. This task neither changes nor settles
  them.
- The field's picture tests hold their old references. `wind-cards`, `wind-page`,
  `wind-cards-later` and the four vegetation wind tests pass. That is 21 tests on the Mac's GPU and
  21 on the software GPU. The change therefore moves no picture past its limit, and no reference is
  redrawn.
- The GPU check over the branch's own commits reads S4 and S6 at Medium and High as the same, each
  inside its noise. The scenes do not use the wind add-on. The check therefore shows that the
  add-on leaves the engine's drawing alone.
- `bunx @null3d/cli check-addon packages/wind` gives 6 passed, 1 failed and 1 skipped. The checkout
  has `packages/engine/lib` built. The package, the public API, the interface, the page, the
  cost per preset and the allocation per preset pass. The cost reads 0.75, 0.70, 1.10 and 1.62 ms
  of GPU time a frame, and the allocation reads 72, 61, 67 and 57 bytes a frame in the add-on's own
  code, on Chrome 156. The shader step fails at its build with `TypeScript parameter property is
  not supported in strip-only mode`, and the size step then skips. The same failure appears at the
  landing head, so it is not this branch's. That step would prove the add-on's WGSL compiles for
  both GPU paths, and it is owed to the tool. The pages did compile and run that WGSL in
  Chrome, in the picture tests and the stress runs.
- The tool's fix has landed, and a fresh run of the same command at `266a7d5d0` passes **all eight
  gates with nothing skipped**: the package, the public API, the interface, the shaders, the sizes,
  the page from another origin threaded and single-threaded, the cost per preset and the allocation
  per preset. The shader step now builds six files with WGSL for WebGPU and WebGL2, where it failed
  above with `TypeScript parameter property is not supported in strip-only mode`. The cost reads
  0.49, 0.83, 2.63 and 2.97 ms of GPU time a frame from low to ultra, and the allocation 67, 60, 52
  and 72 bytes a frame in the add-on's own code, both on Chrome 156.0.8078.80. So the failure above
  was the tool's and is closed; the pages' own figures still stand as the look witness.
- The same command passes all eight gates at `188601c05`, the tree the redraw's range was built on:
  the redraw ran `bun packages/cli/bin/null3d.js check-addon packages/wind` and read `8 passed`.
  `cdf1cb99f` is that tree's formatting-only descendant, so the two are the same code for this run's
  inputs. That is the range's own full pass, which the addendum above could not name. Its cost reads 5.07, 4.57, 8.28
  and 6.16 ms of GPU time a frame from low to ultra, and its allocation 64, 61, 65 and 56 bytes a
  frame in the add-on's own code. The add-on's code is byte-identical at the two heads, so the
  difference between their readings is the machine's state rather than the code, and each reading
  belongs to its own run. The run recorded no machine load, so no clean-window claim is made for its
  figures.

## Addendum: the leaves' two forms, and the flag and water readers

M3-V17 builds the falling and floating leaves in the vegetation add-on. It builds the two forms
that the leaf section above left unmeasured. It also builds the flag and the water readers that the
readers section named, and it measures one more texture read for each.

### The leaves' two forms

`createFloatingLeaves(ctx, { wind, camera, count, area, ride })` draws leaves in a box that follows
the camera. Each leaf falls from the box's top to its ground and starts again. Both forms draw the
same leaf card and the same fall.

- `ride: 'offset'` pushes a closed-form fall by the air at the leaf's place. It reads the field once
  for each leaf, and it keeps no state between frames. A gust moves a leaf only while the leaf
  stands in it.
- `ride: 'state'` keeps a place and a speed for each leaf in a pass that keeps its state. The pass
  samples the field, drags each leaf toward the air at its place, and wraps the leaf inside the
  box. A gust carries a leaf along its path, and the leaf keeps its speed after the gust passes.
  The state texture holds four numbers for each leaf. On WebGL2 the pass runs as its fragment
  form, which steps the same state, so a leaf moves the same way on every path.

The state form is the default. It is the form that carries a gust, which is why the leaves moved
from the CPU.

### The leaves' cost

The `leaves-wind-cost` plan draws one form at one count on one GPU path. Each page holds the camera
still and measures three seconds after a warm-up. The counts are 500, 2,000 and 10,000. The pages ran on the cloud iPad Pro 13 at Safari 26.6.1, in
[its leaves run](../tested-devices/ipad-pro-13-safari/20261101-074423-leaves-wind-cost.md).

WebGPU, median GPU milliseconds at High:

| Leaves | Offset, the field's pass | State, the field's and the leaves' passes | The state pass alone |
| --- | --- | --- | --- |
| 500 | 0.018 | 0.375 | 0.357 |
| 2,000 | 0.027 | 0.379 | 0.352 |
| 10,000 | 0.246 | 0.379 | 0.133 |

Compatibility mode, median GPU milliseconds at High:

| Leaves | Offset, the opaque pass | State, the opaque pass | Offset, the field's pass | State, both passes |
| --- | --- | --- | --- | --- |
| 500 | 1.085 | 1.101 | 0.091 | 0.166 |
| 2,000 | 1.096 | 1.097 | 0.116 | 0.165 |
| 10,000 | 1.101 | 1.099 | 0.170 | 0.092 |

The compatibility figures at 10,000 are lower than at 2,000 because the field's pass runs fewer
cycles when a frame is shorter. The opaque pass draws the leaves, and it moves 0.016 ms from 500 to
10,000 offset leaves, so the per-leaf read is cheap there. The state form's pass adds 0.05 to
0.08 ms.

On WebGPU the state pass alone is about 0.36 ms at 500 and 2,000 leaves. At 10,000 the offset
page's field pass is inflated by the extra cycles that its slow frames ran, so the difference there
is not the state pass's own cost.

Every page updated its sketch about 190 times in its 3 s, so neither form lost the page's update
rate at 10,000 leaves. The GPU timer's whole-frame median includes idle gaps of 0.7 to 23.6 s
between passes on several pages, so those medians do not compare the forms. The pass medians are
the figures above.

WebGL2 reports no GPU timer. Its pages updated their sketch 71, 63 and 63 times a second at 500,
2,000 and 10,000 offset leaves, with CPU medians of 1.82, 1.82 and 1.88 ms. The state pages updated
72, 63 and 63 times a second, with CPU medians of 1.88, 1.85 and 1.82 ms. Both forms therefore hold
the page's update rate at every count on that path.

### The flag and the water

The flag sketch `tests/pages/sketches/wind-reader-cost-sketch.ts` ripples from its pole, and a
custom vertex offset adds the push of the air at each vertex. The water add-on's surface lifts a
short wave under the air, read at each vertex. The `wind-reader-cost` plan draws each reader with
the read and without it, on each path. The run is
[the iPad's readers run](../tested-devices/ipad-pro-13-safari/20261101-075408-wind-reader-cost.md).

WebGPU and compatibility mode, the opaque pass that draws the reader, median GPU milliseconds:

| Reader | Path | With the field | Without | Difference |
| --- | --- | --- | --- | --- |
| Flag | WebGPU | 1.609 | 1.635 | -0.026 |
| Water | WebGPU | 1.633 | 1.598 | +0.035 |
| Flag | compatibility | 1.785 | 1.806 | -0.021 |
| Water | compatibility | 1.791 | 1.794 | -0.003 |

The differences fall inside the runs' noise. The largest is 0.035 ms, so one texture read for each
vertex costs no measurable time at these readers' vertex counts. The field's own pass runs in both
sides of each pair, so it is not in the difference.

WebGL2 reports no GPU timer. Both sides of each pair held the update rate, 63 to 76 updates a
second. The CPU median of each update was 3.38 to 3.50 ms for the flag and 2.54 to 3.40 ms for the
water.

The WebGL2 row does not isolate either read. The add-on steps the field at a fixed rate, and a
slower frame runs more cycles, as the readers section above says. The WebGPU rows are the clean
figures.

### The readers' texture slots

The field costs a reader one texture slot for the field and one for its steady settings, which the
grid's edge and a device without float targets need.

| Reader | Textures | Free slots of six |
| --- | --- | --- |
| Water surface | mirror, foam, junction, field, steady settings | 1 |
| Flag sketch | field, steady settings | 4 |
| Leaves, offset form | leaf atlas, field, steady settings | 3 |
| Leaves, state form's material | state texture, leaf atlas | 4 |
| Plants (M3-V7) | bark colour, bark surface, leaf colour, leaf surface, branch records, field | 0 |
| Grass | field, steady settings | 4 |

M3-V14 asked for the readers that have a slot free. They are the water surface, the flag, the grass
and the leaves. The plant material keeps none.

### Creek and the forest at the ceilings

The `vegetation` plan ran on the iPad on the same branch, in
[its vegetation run](../tested-devices/ipad-pro-13-safari/20261101-080738-vegetation.md). The forest
holds Low on all three paths. It misses Medium and above by 9 to 19 per cent. Creek misses its
WebGL2 ceilings by a factor of nine at Low and ten at Medium. The field's own pass is below that
device's WebGL2 timer floor at these shapes, so the cost is in the readers or the frame's other
work, not the field's pass. The iPad's rows ask the open ruling's question too: whether a preset's
ceiling includes the wind's share.

The Galaxy S25's run adds [its record](../tested-devices/galaxy-s25-sm-s931b-chrome/20261101-081343-vegetation.md).
Creek misses the class's 33.3 ms ceiling at Low (312.4 ms) and at Medium (166.6 ms), and its Ultra
frame reads 516.56 ms against D-241's measured 499.8. The forest holds Low and Medium WebGL2 at the
display's 33.3 ms floor.

The Galaxy Tab A9 Plus's run adds [its record](../tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-082204-vegetation.md).
Creek Low on WebGL2 reads 1,600.35 ms against 1,268.5, 26 per cent over. Its forest pages did not
run, because the session ended after the first page.

### The WebGL2 cost that the Creek rows carried

The Creek rows above miss their WebGL2 ceilings by nine to ten times, far beyond what the field's
own pass explains. A bisect found the cause on the development machine, between a milestone head
and the branch, at Creek's Low preset and the WebGL2 path, three seconds after a warm-up. The head
is `fcafb9cd7`, eighteen commits before `f800cc662`, the merge the branch was cut from; the wind
preset work between the two does not touch Creek.

| Scene | Frame interval | Frames in 3 s | Uploaded per frame |
| --- | --- | --- | --- |
| The milestone head, no wind, Low | 16.7 ms | 176 | 128 KB |
| The branch, as built, Low | 633 ms | 3 | 2.2 MB |
| The branch without the water, Low | 16.7 ms | 178 | 87 KB |
| The branch with the leaves riding the offset form, Low | 16.7 ms | 175 | 113 KB |
| The branch with the wind grid's pass, Medium | 683 ms | 3 | 4.3 MB |
| The branch with `grid: 0`, Medium | 33.3 ms | 105 | 96 KB |

The upload column is the engine's `uploadBytes` counter, which adds buffer writes and texture
uploads together, and the time sits on the render worker's replay phase, not on the drawing. D-286
splits the figures and records the cause.

The water draws the valley a second time for its reflection, at a cadence of two. Each frame the
reflection rested, its passes left the render plan, and each frame it drew, they rejoined it. A plan
that changed compiled again, made its targets and framebuffers again and bound everything again, and
a new framebuffer's completeness check waits for the GPU. The leaves' state pass and the wind grid's
are fragment forms on this path, which the graph placed with the view, so they left and rejoined the
plan with it. The same passes in a scene that draws once, as the forest does, pay nothing, and the
same scene with the reflection drawn every frame does not stall.

The figure in that column is the scene's first fill, at the preset's upload budget for each slow
frame: 2.2 MB is Low's 2 MiB budget and 4.3 MB is Medium's 4 MiB. A scene uploads each texel once,
so the measurement of the seconds after the start reads the fill that the slow frames spread.

Creek now keeps the leaves' state form and its preset's grid on every path. A reader without a grid,
such as one on a device whose float targets fail the probe, works the air out of the steady field.
The owner ruled that the gust must work on the WebGL2 path, so the steady field carries a gust that
a page sends: `gust()` writes its place, its strength and the time it was sent into the field's
reading, the readers' settings take them as a fourth vector, and the block adds the same travelling
wave from that place. A push still reaches readers only through the grid.

What this record proves is the air, not a person watching the demo. A probe sampled the block that
the readers carry, on a line across the ground with no grid, and the gust moved 6 m in the 1 s
between two reads against the field's own 6 m/s
([the run](../tested-devices/macbook-pro-m3-max-chrome/20261101-1915-gust-crossing.md)). The
readers take the fourth vector that carries it, and the vegetation add-on's copy test holds their
blocks, the cost page's and the probe's steady block equal to the canonical text; the probe keeps
only the reading function of the other block, since it samples no grid. Owed, and not taken: a held picture of Creek on the WebGL2 path with a
gust sent, which would show the grass, the water and the leaves moving. The machine barred image
runs when this landed.

The settings go up when a page sends a gust, so the frame pays one small upload for each press and
no upload in the frames between.

An earlier version of this record said the sent gust crossed the banks when it did not. That was
wrong, and the code now makes it true.

The cost was the render graph's, not the add-ons'.
[D-286](D-286-webgl2-texture-copies-beside-a-second-draw.md) records the cause and the fix.

The branch and the milestone head read the same rows on the cloud devices. The branch at 8363b20a6
runs [the iPad's rows](../tested-devices/ipad-pro-13-safari/20261101-091422-vegetation.md) and
[the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261101-091422-vegetation.md). The head at
`fcafb9cd7` runs [the iPad's](../tested-devices/ipad-pro-13-safari/20261101-091901-vegetation.md) and
[the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261101-091901-vegetation.md), and it
builds no wind field.

| Demo and preset | Path | Ceiling | Head | Branch |
| --- | --- | --- | --- | --- |
| Creek Low, iPad | WebGL2 | 30.8 | 31.06 | 30.98 |
| Creek Medium, iPad | WebGL2 | 90.8 | 78.74 | 78.82 |
| Creek Low, S25 | WebGL2 | 33.3 | 33.3 | 33.32 |
| Creek Medium, S25 | WebGL2 | 33.3 | 33.3 | 33.33 |

The branch's earlier rows of 287.1, 935.0, 312.4 and 166.59 ms were the stall beside the resting
reflection, not Creek's own. The head's rows show it: they read the same frames before the branch
added a reader. The rows at 8363b20a6 match the head because that commit moved the leaves and the
grid around the stall; the graph's fix removes the need for that move, and Creek draws both again.

The tablet's rows say the same. The head reads Creek Low at 1,487.16 ms against the class's
1,268.5 ms ([the head's tablet run](../tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-091901-vegetation.md)),
and the branch at 1,484.12
([the branch's tablet run](../tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-092544-vegetation.md)),
so that miss is the scene's on that device. Creek Medium draws no frame on either.

### The pictures this branch owes

The task asks that every picture the change moves is redrawn in both reference sets. The manifest
was then run on the Mac's GPU at the branch's head `582706315`, and it measured which pictures move
([the run](../tested-devices/macbook-pro-m3-max-chrome/20261101-1803-creek-images.md)). Four Creek
tests move on every path, against the 0.1 per cent limit:

| Test | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| `demo-creek` | 1.321 | 0.873 | 1.681 |
| `creek-render-scale-opening` | 2.282 | 1.748 | 1.839 |
| `creek-render-scale-route` | 1.644 | 1.323 | 1.456 |
| `creek-water-close` | 8.129 | 6.496 | 15.168 |

The figures are the percentage of each picture's pixels that differ from its reference. The water's
close view moves most, and three times as far on WebGL2 as on WebGPU, where Creek rides a different
leaf form.

The same run measured the forest, and `demo-forest` passes on all three tiers, so its sway does not
reach its held picture and it is not redrawn. `vegetation-versus-creek` passed too. M3-V11 then
deleted the painted oak that the picture drew beside the generated one, and removed the test with
it ([D-241](D-241-vegetation-foundation.md)). `creek-band` keeps no picture: it reads the route
picture's frame, so it re-runs after the references are drawn. `creek-lod` also kept no picture, and
M3-V11 removed it with the model files that it measured, so nothing re-runs there.

Those four are owed a drawing in each set. The machine's milestone gate bars browser image runs, so
the Mac's drawings wait for it to lift, and `bun run images:review --accept` then makes them
references. The software set comes only from CI's drawing: a full run on the branch saves the
images, and `bun run images:review --ci <run> --accept <name>` accepts them, as
[the image tests guide](../../.dev/image-tests.md#references) says.

### What the task's clauses stand at

M3-V17 delivers the readers, the two leaf forms and their comparison, the flag's and the water's
extra read, the gust on every path, and the Creek and forest rows that match the head on the iPad,
the S25 and the tablet. It is a partial delivery. These clauses stay open:

- **The particles add-on's wind input.** The task's bullet asks for a field texture and its box, so
  dust, motes, smoke and rain take an offset from the field. The add-on takes a constant vector
  still, so the bullet is unbuilt.
- **The pictures.** Four Creek drawings are owed; the section above names the tests and the run
  that measured them, and why they wait.
- **The iPhone 17's row.** The Done-when names four cloud devices. The branch has rows for the iPad,
  the S25 and the Tab A9 Plus, and none for the iPhone.
- **The forest at the head.** Its Medium and above rows were never measured at `fcafb9cd7`, so
  whether the wind's share sits inside those ceilings is open (D-241).

The task's evidence entry states the same, and names the runs that back the figures below.

### The forest's sketch and the feature demos' line rule

The wind work grew the forest demo's sketch past the 150 lines that a feature demo's sketch may
take, and landing it turned the branch's `tests/lib` red. The demo's build moved into helpers, the
way the dressed Creek's build did, so the rule holds without a change to it. `examples/forest/sway.ts`
holds the trees' material and the field's settings, and `examples/forest/planting.ts` holds the
batches, the hero fir and the counts that each preset draws. The sketch keeps the look, the field
and the frame, at 85 lines.

No picture or frame figure moved: the same rows, the same materials and the same counts are built,
and the demo's own rules still pass.
