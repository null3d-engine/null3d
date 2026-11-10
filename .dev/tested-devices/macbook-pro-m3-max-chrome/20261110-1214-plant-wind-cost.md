# The plant material's wind offset: cost per preset

Plans: M3-V7's cost per preset, the page `plant-wind-cost` on the Mac's real GPU. The branch is
`feat/v7-sway-picture` at `ca8801bd8`, whose content is the test commit that lands with this
record (`984e0039e`). The page is `tests/pages/plant-wind-cost.html` with
`?gpu=webgpu&preset=<preset>&side=<on|off>&rounds=9&seconds=2`. It loads
`tests/pages/sketches/plant-review-sketch.ts?species=hawthorn-shrub&view=whole&size=960x540&preset=<preset>&wind=2`.
The off side adds `&sway=0.001`. The field runs on both sides at strength 2, so its cost is
common and cancels. The difference is the material's own cost: its vertex offset and the far shadow
redraws that its moving vertices force. The browser was Chrome for Testing 156.0.8078.80 on this
Mac's Apple M3 Max, macOS 26.2 (build 25C56), in a 1600 by 900 viewport with a 960 by 540 canvas at
a pixel ratio of 1. The GPU timestamps are exact (`GPU_TIMING_ARGS`). The run started at 12:14:41
and took 3 minutes 11 seconds.

Quiet window: `plant-wind-cost timing run, pid 11593, until about 12:44`, held by the runner. The
1-minute load before and after each preset was 6.95, 5.14, 5.14, 4.46, 4.46, 3.33, 3.33 and 3.64.
The load beside each side stayed from 3.0 to 6.6, under the gate of 8.

Result: four preset pairs on WebGPU, all bounds. The material's own cost is under 4.681 ms at Low,
5.219 ms at Medium, 7.844 ms at High and 2.889 ms at Ultra. The measured differences were 0.140,
1.787, 1.620 and -0.024 ms, each at or below its pair's spread.

## The pairs

Each side is the median of nine 2-second rounds; its spread is the range of those round medians. A
difference above the pair's spread is a figure. A difference at or below it is not resolved, and the
preset is recorded as a bound: the material's own cost is under that spread.

| Preset | On (ms) | On spread (ms) | Off (ms) | Off spread (ms) | Difference (ms) | Shadow (ms) | Rest (ms) | Figure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 6.565 | 4.681 | 6.425 | 3.317 | 0.140 | -0.487 | 0.627 | bound under 4.681 ms |
| Medium | 5.114 | 5.219 | 3.327 | 1.689 | 1.787 | 0.448 | 1.339 | bound under 5.219 ms |
| High | 6.274 | 7.844 | 4.654 | 2.087 | 1.620 | 0.367 | 1.253 | bound under 7.844 ms |
| Ultra | 11.196 | 2.430 | 11.220 | 2.889 | -0.024 | 0.540 | -0.564 | bound under 2.889 ms |

The nine round medians, in the order the rounds ran:

- Low on: 6.095, 6.000, 5.071, 7.730, 7.060, 9.752, 6.565, 7.080, 6.290.
  Low off: 6.429, 5.872, 5.166, 4.636, 6.425, 6.693, 7.952, 6.293, 7.022.
- Medium on: 9.175, 5.114, 5.755, 3.978, 5.957, 4.479, 4.265, 3.957, 5.851.
  Medium off: 3.632, 3.327, 4.631, 3.532, 4.641, 3.126, 3.231, 3.063, 2.952.
- High on: 7.136, 4.892, 11.558, 12.735, 5.709, 11.131, 5.326, 6.274, 5.548.
  High off: 5.519, 4.654, 4.627, 5.294, 6.083, 4.221, 4.266, 4.654, 3.997.
- Ultra on: 11.154, 10.760, 10.398, 11.157, 11.517, 12.249, 12.828, 11.196, 12.788.
  Ultra off: 9.367, 11.628, 11.742, 11.441, 10.996, 10.725, 12.256, 11.220, 10.797.

## The audit's four checks

1. **Every preset is paired.** The on and off sides are two loads of the same page. They share the
   fixed view, size, wind and measurement time. Only the material's sway distance differs: the
   preset's value on the on side, one millimeter on the off side. The spec asserts each page's
   species, view, size, preset, wind and distance.
2. **The difference is the material's own cost, not the field's.** The wind field runs at strength 2
   on both sides, so its pass and its sampling are common and cancel. The difference is the vertex
   offset and the far shadow redraws its moving vertices force. The shadow column is the forced
   share; the rest is the offset's own work in the passes that draw in both.
3. **The run names its commit and its conditions.** The code is `ca8801bd8`, the page and sketch
   above, the browser and machine above, and the quiet window below.
4. **The quiet-window claim rests on the processes.** The spec logged the 1-minute load and the top
   processes above 5% CPU before and after each side. The run's own processes were its Chrome for
   Testing page, its node worker and the review page's vite. Beside them stood the owner's
   applications and system helpers. Brave Browser helpers ran at 37 to 42%, the Orca helper at 10 to
   16%, and the helper session's claude process at 8 to 194%. The coordination check-in shell ran at
   29 to 31%, and the system's SkyLight, tccd and launchd also ran. No other null3D build, picture
   run or timing run appears.

## What the figures say

All four differences are at or below the pair's spread. The record is therefore a bound at each
preset: the material's own cost is under the pair's spread.

- Low: under 4.681 ms, with the measured difference at 0.140 ms.
- Medium: under 5.219 ms, with the measured difference at 1.787 ms.
- High: under 7.844 ms, with the measured difference at 1.620 ms.
- Ultra: under 2.889 ms, with the measured difference at -0.024 ms.

The shadow split and the rest are inside the same spread, so they are diagnostic and not figures.
The material's own cost is smaller than this instrument resolves on one plant at 960 by 540.

## What this does not show

- One species (the hawthorn) and one plant in the review page's whole view, not the meadow.
- One GPU path, WebGPU on this Mac. Compatibility mode and WebGL2 are not measured.
- A bound does not give a value. It says the material's own cost is under the pair's spread. The
  spread is the resolution of this instrument on this page.
- The vertex offset alone is not separated from the far shadow redraws it forces, except by the
  shadow split. Both parts are inside the spread.
