# D-283: The fluid wind's cost, and its budget at each preset

Status: proposed by the measurements of task M3-V14. Built: the wind add-on's field and its
state-keeping solver (M3-V13, M3-V15). Built too: the plant material's vertex reader (M3-V7) and the
cost pages that time them. Not built: the preset rows and budgets (M3-V16), the canopy drag and the
falling leaves (M3-V17), branch poses (M3-V10, measured on its own branch), and Creek's and the
forest's plants on the add-on (M3-V11, M3-V12). The owner rules on the rows, on the budgets and on
the Low grid. Task: M3-V14.

Summary: On the Mac's WebGPU path the field costs 0.10 ms a frame at the Medium row and 0.74 ms at
the Ultra row. The grid's size moves it far less than the pressure count and the field rate do.
WebGL2 pays a fixed cost per solver run, so its row sets the field rate. The record proposes
budgets of 0.5, 1.2, 4.9 and 6.25 ms from Low to Ultra, one tenth of the vegetation add-on's own
budget.

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

The measurements are at `c4504a038`, on the Mac's installed Chrome 156, on an Apple M3 Max with
36 GB of memory. The display is 60 Hz and the window is 640 by 400. The run began at a 1-minute load
of 7.4 and ended between 2.2 and 6.3. Each side is the median GPU time of three rounds, alternating
the order. WebGPU and compatibility mode time each pass. WebGL2 on a phone has no pass timer, so its
rows give the frame interval and the busiest thread's CPU time.

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
| flat 32x32 | 1,024 | 16 KiB | 0.226 | 0.0067 | 0.532 | +0.091 |
| flat 64x64 | 4,096 | 64 KiB | 0.230 | 0.0076 | 0.610 | noise |
| flat 128x128 | 16,384 | 256 KiB | 0.244 | 0.0089 | 0.711 | noise |
| flat 256x256 | 65,536 | 1.0 MiB | 0.369 | 0.0114 | 0.910 | +0.126 |
| 4 layers of 64x64 | 16,384 | 256 KiB | not built | 0.0086 | 0.688 | +0.060 |
| 8 layers of 64x64 | 32,768 | 512 KiB | not built | 0.0103 | 0.822 | +0.068 |
| 4 layers of 128x128 | 65,536 | 1.0 MiB | not built | 0.0105 | 0.841 | +0.013 |
| 8 layers of 128x128 | 131,072 | 2.0 MiB | not built | 0.0137 | 1.095 | noise |
| volume 32x32x32 | 32,768 | 512 KiB | not built | 0.0102 | 0.815 | +0.067 |
| volume 48x16x48 | 36,864 | 576 KiB | not built | 0.0105 | 0.838 | +0.081 |
| volume 64x24x64 | 98,304 | 1.5 MiB | not built | 0.0162 | 1.292 | +0.139 |

The task's pressure sweep comes from the real cycle's floor and the chain's step:
`field step(p) = advect and project + p * chain step`. The floor is the real cycle less the twenty
chain steps that model its pressure iterations. The rows are a cycle a frame at sixty steps a
second. At thirty a second they halve, and at fifteen they quarter.

| Flat grid | 8 pressure | 16 | 20, the real cycle | 24 | 40 | 80 |
| --- | --- | --- | --- | --- | --- | --- |
| 32x32 | 0.146 | 0.200 | 0.226 | 0.253 | 0.359 | 0.629 |
| 64x64 | 0.138 | 0.199 | 0.230 | 0.260 | 0.382 | 0.687 |
| 128x128 | 0.137 | 0.208 | 0.244 | 0.279 | 0.421 | 0.777 |
| 256x256 | 0.232 | 0.323 | 0.369 | 0.414 | 0.596 | 1.053 |

The least-squares line through the flat shapes' single steps gives 0.013 ms of fixed cost a step
and 0.079 nanoseconds a cell. At 256x256 the cells make 0.005 ms of a 0.011 ms step. Below 128x128
the step's fixed cost is nearly all of it.

The real cycle shows the same shape. Its twenty-two runs cost 0.226 ms at 32x32 and 0.369 ms at
256x256. Five times the cells add 0.14 ms. About 0.09 ms is the advection that evaluates the
analytic field with five curl taps, with the projection and the dispatch beside it.

Drag, one more read a cell a step, is inside the run-to-run spread on the middle grids. It shows
where the cells dominate: +0.126 ms of the 256x256 chain's 0.910, and +0.139 of the volume's 1.292.
That is about one read against the six a step already makes.

### Compatibility mode

Compatibility mode runs the same WebGPU backend under the compatibility limits. Its per-pass figures
match WebGPU within about 3 per cent. The real cycle costs 0.220, 0.225, 0.242 and 0.358 ms from
32x32 to 256x256. The least-squares line through the flat shapes is 0.013 ms of fixed cost a step
and 0.059 nanoseconds a cell. The machine's load rose from 6.9 to between 22 and 43 during that run
as other sessions worked. The per-pass figures stand on the GPU's own timestamps, and a frame-level
figure from that run would not.

### WebGL2 on the Mac

The field's whole-frame GPU time less the same frame without it, median of three rounds. WebGL2 has
no per-pass timer, so the figure carries the field's pass as the frame's commands show it.

| Shape | 1 step (ms) | 8 steps (ms) | 16 steps (ms) | 24 steps (ms) | 40 steps (ms) | 80 steps (ms) | Real cycle, 20 pressure (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flat 32x32 | 0.919 | 1.513 | 3.359 | 5.864 | 12.638 | 25.716 | 5.781 |
| flat 64x64 | 0.102 | 1.251 | 3.080 | 6.031 | 12.187 | 22.739 | 4.306 |
| flat 128x128 | 0.079 | 1.279 | 3.019 | 6.263 | 11.731 | 23.303 | 4.315 |
| flat 256x256 | 0.087 | 1.326 | 2.864 | 6.438 | 12.028 | 27.385 | 4.717 |

The cost is fixed per run, not per cell. Eight runs cost 1.25 to 1.51 ms at every shape from 1,024
to 65,536 cells, about 0.16 to 0.19 ms a run. Sixteen runs cost about twice that. From 24 runs a
frame the field's work passes the display's interval, so the GPU queues frames and the per-run
figure climbs. The 24, 40 and 80 run rows are saturation points, not a clean cost. The add-on's
shipped cycle, 22 runs at 60 cycles a second, costs 4.3 to 5.8 ms a frame. The one-step row at
32x32, 0.919 ms, is an outlier against the other three grids' 0.08 to 0.10. The least-squares fit
through the single steps is meaningless for the same reason.

Drag is one read in six and stays inside the run-to-run spread at every count. The 16 by 16 read
answered after 62.6 to 66.4 ms, 4 frames late.

Low's row is a cycle of ten runs at 15 cycles a second. That cycle is eight pressure steps, the
advection and the projection. The rate is 2.5 runs a frame. At the Mac's 0.17 ms a run that is about
0.43 ms. At 30 cycles a second it is 0.85 ms. Medium's eighteen-run cycle is 0.77 ms a frame at 15
cycles a second and 1.53 ms at 30. So Medium takes 15 cycles a second on this path, inside its
1.2 ms ceiling.

### The read of a small summary

The real pass's 16 by 16 region reads back through `render.readPass`'s promise. The wait was 44.8
to 52.4 ms on the two WebGPU paths, and the read answered 3 frames late. The wait covers the GPU
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

## Decision

The rows below are proposed, and the owner rules on them. Each figure is the field's own GPU time a
frame at that row, not a whole frame. Each WebGPU and Mac WebGL2 figure is modelled from measured
parts. Low's phone figure is a bound, not a measurement, as the Data section says.

| Preset | Field | Grid | Pressure steps | Field steps a second | WebGPU (ms) | WebGL2 (ms) | Budget (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | analytic, or the smallest flat grid | none, or 32x32 | none, or 8 | none, or 15 | 0, or 0.04 | 0, or 0.43 | 0.5 |
| Medium | flat grid | 64x64 | 16 | 30, and 15 on WebGL2 | 0.10 | 0.77 | 1.2 |
| High | flat grid now, 4 layers later | 128x128, or 4 layers of 128x128 | 24 | 30 | 0.14 | not drawn | 4.9 |
| Ultra | flat grid now, a volume later | 256x256, or 64x24x64 | 40 | 60 | 0.65 | not drawn | 6.25 |

Every figure in this table is modelled from the measured parts, and the budget column is a proposed
ceiling. None of these figures is a phone measurement. Low's 0.5 ms is the planning ceiling for the
field. The phone rows in the Data section bound Low's cost with the frame interval, and no phone
read 0.5 ms there. A reader must not take 0.5 ms for a phone figure.

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
  without a float target. The owner may still choose the small grid on the look, which a
  side-by-side of the formula wind and the 32x32 field settles.
- High and Ultra keep the flat grids that the solver builds today. The layered and the volume grids
  look better where the air has height. They cost 0.16 and 0.74 ms at their rows on WebGPU, well
  inside their budgets, so the better look wins when it is built (hard rule 40).
- The budgets stay at one tenth of the vegetation add-on's own: 0.5, 1.2, 4.9 and 6.25 ms. Every
  measured row is far inside them on WebGPU, and the phones hold their intervals. The owner may
  trade the margin for a better flow.

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
- The Mac here is an Apple M3 Max, not the M5 Max that the task names. The solver on this tree fixes
  20 pressure steps and 60 cycles a second. The real cycles in the tables are that cycle, and the
  other pressure counts and field rates are the chain's.
