# The plant material's wind offset: the batch view's cost per preset

Plans: M3-V7's cost per preset, the page `plant-wind-cost` in its batch view on the Mac's real GPU.
The page and material are at `70e546a38`. The runner carries the per-preset guard added with this
record. The page is `tests/pages/plant-wind-cost.html` with
`?gpu=webgpu&preset=<preset>&side=<on|off>&rounds=9&seconds=2`. It loads
`tests/pages/sketches/plant-review-sketch.ts?species=hawthorn-shrub&view=turntable&turns=30&size=960x540&preset=<preset>&wind=2`.
The off side adds `&sway=0.001`. The turntable sheet draws the plant once in each of 30 cells, so
the material's vertex work scales thirty times while the scene keeps one plant. The field runs on
both sides at strength 2, so its cost is common and cancels. The difference is the material's own
cost: its vertex offset and the far shadow redraws that its moving vertices force. The browser was
Chrome for Testing 156.0.8078.80 on this Mac's Apple M3 Max, macOS 26.2 (build 25C56), in a 1600 by
900 viewport with a 960 by 540 canvas at a pixel ratio of 1. The GPU timestamps are exact
(`GPU_TIMING_ARGS`). The run started at 13:06:53 and took 3 minutes 7 seconds.

Quiet window: `plant-wind-cost timing run, pid 73039, until about 15:05`, held by the runner. The
1-minute load before and after each preset was 4.04, 4.52, 4.52, 3.22, 3.22, 2.82, 2.82 and 3.15.
The load beside each side stayed from 2.7 to 5.0, under the gate of 8.

The guard's lines, as the runner printed them before each preset:

```
GUARD low: window open
GUARD medium: window open
GUARD high: window open
GUARD ultra: window open
```

Result: four batch pairs on WebGPU, all bounds. The batch view still swallowed every difference.
The material's own cost is under 3.435 ms at Low, 5.293 ms at Medium, 3.210 ms at High and
4.668 ms at Ultra. The measured differences were 0.681, -0.859, 0.111 and 0.048 ms.

## The batch pairs

Each side is the median of nine 2-second rounds; its spread is the range of those round medians. A
difference above the pair's spread is a figure. A difference at or below it is a bound.

| Preset | On (ms) | On spread (ms) | Off (ms) | Off spread (ms) | Difference (ms) | Shadow (ms) | Rest (ms) | Figure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 4.896 | 3.435 | 4.215 | 1.712 | 0.681 | 0.015 | 0.666 | bound under 3.435 ms |
| Medium | 9.448 | 3.223 | 10.306 | 5.293 | -0.859 | 0.398 | -1.256 | bound under 5.293 ms |
| High | 15.475 | 2.938 | 15.364 | 3.210 | 0.111 | 0.099 | 0.012 | bound under 3.210 ms |
| Ultra | 14.174 | 4.668 | 14.126 | 3.217 | 0.048 | 1.097 | -1.049 | bound under 4.668 ms |

The nine round medians, in the order the rounds ran:

- Low on: 3.849, 3.194, 5.015, 4.869, 5.783, 6.629, 4.896, 6.003, 4.108.
  Low off: 2.749, 3.074, 4.444, 4.255, 3.262, 4.215, 4.405, 4.461, 3.099.
- Medium on: 7.952, 10.527, 7.649, 8.281, 9.581, 10.871, 9.572, 9.448, 8.626.
  Medium off: 11.046, 9.336, 11.412, 8.543, 11.286, 13.836, 8.656, 10.306, 10.176.
- High on: 15.912, 15.525, 14.807, 15.475, 14.175, 15.971, 13.880, 14.627, 16.817.
  High off: 15.042, 15.446, 16.377, 15.364, 14.617, 15.195, 17.254, 14.043, 16.091.
- Ultra on: 11.389, 13.751, 13.672, 14.174, 14.441, 14.330, 13.233, 16.057, 14.268.
  Ultra off: 14.602, 13.914, 13.885, 15.301, 15.429, 14.126, 12.212, 14.041, 14.363.

The shadow split and the rest are inside the same spreads, so they are diagnostic only.

## The whole-view pairs, the first attempt

The earlier record `20261110-1214-plant-wind-cost.md` measured the same plant in the whole view.
Its 1-minute load before and after each preset was 6.95, 5.14, 5.14, 4.46, 4.46, 3.33, 3.33 and
3.64; every side stayed from 3.0 to 6.6, under 8. Its neighbours were Brave Browser helpers at 37
to 42%, the Orca helper at 10 to 16%, the helper session's claude process at 8 to 194%, the
coordination check-in shell at 29 to 31%, and the system's SkyLight, tccd and launchd.

| Preset | On (ms) | On spread (ms) | Off (ms) | Off spread (ms) | Difference (ms) | Shadow (ms) | Rest (ms) | Figure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 6.565 | 4.681 | 6.425 | 3.317 | 0.140 | -0.487 | 0.627 | bound under 4.681 ms |
| Medium | 5.114 | 5.219 | 3.327 | 1.689 | 1.787 | 0.448 | 1.339 | bound under 5.219 ms |
| High | 6.274 | 7.844 | 4.654 | 2.087 | 1.620 | 0.367 | 1.253 | bound under 7.844 ms |
| Ultra | 11.196 | 2.430 | 11.220 | 2.889 | -0.024 | 0.540 | -0.564 | bound under 2.889 ms |

Both views give bounds. The thirty-cell sheet scales the material's work thirty times, and the
difference still sits under the run's spread. An earlier batch run, with a 505% vite beside it, was
discarded and is not a figure.

## The audit's four checks

1. **Every preset is paired.** The on and off sides are two loads of the same page. They share the
   batch view, size, wind and measurement time. Only the material's sway distance differs: the
   preset's value on the on side, one millimeter on the off side. The spec asserts each page's
   species, view, cell count, size, preset, wind and distance.
2. **The difference is the material's own cost, not the field's.** The wind field runs at strength 2
   on both sides, so its pass and its sampling are common and cancel. The difference is the vertex
   offset and the far shadow redraws its moving vertices force.
3. **The run names its commit and its conditions.** The page and material are `70e546a38`. The
   runner carries the guard added with this record. The browser and machine are above. The quiet
   window and the processes are below.
4. **The quiet-window claim rests on the processes.** The guard, run inside the runner before each
   preset, read `window open` four times. The spec logged the 1-minute load and the top processes
   above 5% CPU at each side. The run's own processes were its Chrome for Testing pages, its node
   worker and the review page's vite. The coordinator named the window's heaviest before the run:
   Brave at 22.6%, another session's claude at 16.1%, the Orca renderer at 16.1%, a second claude at
   8.3%, WindowServer at 8.2% and the screen-sharing agent at 9.2%. The spec's lists agreed: Brave
   helpers at 26 to 29%, the Orca helper at 12 to 18%, claude at 9 to 16%, SkyLight at 9 to 16%,
   TCC at 14% and sysmond at 11 to 12%. No other null3D build, picture run or timing run appears.

## What the figures say

All four batch differences are at or below the pair's spread: 0.681, -0.859, 0.111 and 0.048 ms
against spreads of 3.435, 5.293, 3.210 and 4.668 ms. The batch view did not clear the instrument's
drift. The record is a bound at each preset: the material's own cost is under the pair's spread.
The whole view's four bounds stand beside them. The thirty-cell sheet scales the material's work
thirty times, and the difference still sits under the run's spread.

## What this does not show

- One species (the hawthorn) and one plant drawn in 30 cells, not the meadow.
- One GPU path, WebGPU on this Mac. Compatibility mode and WebGL2 are not measured.
- A bound does not give a value. It says the material's own cost is under the pair's spread. The
  spread is the instrument's limit on one plant at 960 by 540, and the batch sheet sits beyond it.
- The neighbours named above moved the frame; the spreads carry their effect.
