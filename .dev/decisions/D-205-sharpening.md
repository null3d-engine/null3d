# D-205: Sharpening at the whole canvas's render scale, in the final pass

Status: decided by the M3-A10 task, for the owner's review. Built: the `post.set({ sharpen })`
value, RCAS in `final.wgsl`, the two-step pass at the whole canvas's scale, the image tests and the
cost page. The Mac's cost and the iPad's and the phones' costs are recorded below. Task: M3-A10.

Summary: A sharpening value from 0 to 1 sharpens display color with FSR 1's RCAS in the second step
of the final pass. That step draws at the whole canvas's render scale while the value is set. It is
off by default, and a page that leaves it off draws no extra pass and no changed pixel.

## Question

Below a render scale of 1 the final pass sharpens its upscale, with the sharpening built into GSR 1
(M2-F10). Without a value, a page at the whole canvas's scale has no sharpening and no way to ask for
one. How does the engine sharpen a full-resolution image without the work that M2-F10 removed below
scale 1, and what does the value mean below scale 1?

## Rule

- The picture at the whole canvas's scale must not change unless the sketch sets the value.
- The sharpening works on display color, after the tone curve, so a bright edge cannot gain colored
  rings (the technique review's ruling on M3-A10).
- It costs one output transform for each pixel, as M2-F10's split does: sharpening must not tone map
  the neighbors of each pixel.
- Both GPU paths draw it, in every thread mode.

## Data

A sharpening at the whole canvas's scale needs the display colors of the four texels around each
pixel. On the HDR path the final pass reads exposed high dynamic range color. So a tap in the
one-pass build would run the tone curve per tap: five tone curves, five sRGB encodes and five
FXAA-free reads for each pixel. That is the work that M2-F10's split removed below scale 1, where it
ran four.

| Measure | One pass, a tone curve per tap | The two steps |
| --- | --- | --- |
| Tone curves for each pixel | 5 | 1 |
| Full-screen passes while sharpening | 1 | 2 |
| Canvas-sized 8-bit targets | 0 | The one that a droppable render scale already keeps |

How the data was produced: the pass's builds and taps were read from `final.wgsl` and
`frame_graph.rs`, and D-167 records the split's own figures.

The cost of the sharpening, measured on the Mac, is in the table below. `bun run test:browser --
sharpen-cost.spec.ts` with `NULL3D_SHARPEN_COST=1` drew a wall of 32 x 32 boxes. The canvas was
1920 x 1080. It timed the frame with the sharpening off and on, in turns, three times each. The
frame interval was 16.665 ms on every side, the rate of the headless window. The drawing thread's
CPU time stayed between 0.09 and 0.12 ms.

| Measure | Off | On | Device and browser |
| --- | --- | --- | --- |
| GPU time per frame, WebGPU, scale 1 | 0.852 ms | 1.245 ms | Apple M5 Max, Chrome 155, load 7.4 before and 6.6 after |
| GPU time per frame, WebGPU, scale 0.5 | 0.852 ms | 0.852 ms | Apple M5 Max, Chrome 155, load 6.6 before and 7.0 after |
| GPU time per frame, compatibility mode, scale 1 | 0.786 ms | 1.245 ms | Apple M5 Max, Chrome 155, load 7.0 before and 7.2 after |
| GPU time per frame, compatibility mode, scale 0.5 | 0.852 ms | 0.852 ms | Apple M5 Max, Chrome 155, load 7.2 before and 9.1 after |
| GPU time per frame, WebGL2, scale 1 | 1.550 ms | 1.932 ms | Apple M5 Max, Chrome 155, load 7.9 before and 7.4 after |
| GPU time per frame, WebGL2, scale 0.5 | 1.289 ms | 1.289 ms | Apple M5 Max, Chrome 155, load 7.4 before and 6.7 after |

So at the whole canvas's scale the sharpening adds 0.393 ms on WebGPU, 0.459 ms in compatibility
mode and 0.382 ms on WebGL2. Each is the cost of one more full-screen pass at this size, plus the
four taps that cross each pixel. That is the cost the rule counts, and no preset setting changes. At
scale 0.5 the value adds nothing on any path, because the upscale sharpens there already.

Chrome rounds a GPU timestamp to a 65.536 µs step unless a run turns the rounding off. The Mac's
run did not, so each whole-scale WebGPU and compatibility figure is a whole multiple of that step,
and each of those costs is ±0.066 ms. The WebGL2 figures come from timer queries and are not
rounded.

How the data was produced: a local Playwright run of the cost page through `heavy.sh` in the quiet
window, the run that commit `8d3c1fbb6` records. The run took one test at a time. Each test waited until the 1-minute load
fell under 8 and printed it before and after. The device column gives those readings. The load rose
to 9.1 after the compatibility-mode half-scale test, when other work started. That test's two sides
read the same figure.

The same page ran on the iPad and on two phones through BrowserStack Automate, one session at a
time ([the iPad's run](../tested-devices/ipad-pro-13-safari/20261024-201742-sharpen.md), [the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261024-201742-sharpen.md) and [the S24's](../tested-devices/galaxy-s24-sm-s921b-chrome/20261024-202547-sharpen.md)). Each side is the median of three turns of two seconds. Each device ran both
render scales on WebGPU and WebGL2, the two paths that each has. The iPad's window was 1,032 by
1,264 CSS pixels at 2x,
and its display ran at 59 Hz. The phones' window was 360 by 621 CSS pixels at 3x, and their
displays ran at 30 Hz.

| Measure | Off | On | Device and browser |
| --- | --- | --- | --- |
| GPU time per frame, WebGPU, scale 1 | 4.686 ms | 5.634 ms | iPad Pro 13 (2025), iOS 26, Safari 26.6.1 |
| GPU time per frame, WebGPU, scale 0.5 | 4.337 ms | 4.265 ms | iPad Pro 13 (2025), iOS 26, Safari 26.6.1 |
| Frame interval, WebGL2, scale 1 | 15.53 ms | 15.54 ms | iPad Pro 13 (2025), iOS 26, Safari 26.6.1 |
| Frame interval, WebGL2, scale 0.5 | 15.56 ms | 15.56 ms | iPad Pro 13 (2025), iOS 26, Safari 26.6.1 |
| GPU time per frame, WebGPU, scale 1 | 3.801 ms | 5.177 ms | Galaxy S25 (SM-S931B), Android 15, Chrome 152.0.7977.54 |
| GPU time per frame, WebGPU, scale 0.5 | 4.588 ms | 4.588 ms | Galaxy S25 (SM-S931B), Android 15, Chrome 152.0.7977.54 |
| Frame interval, WebGL2, scale 1 | 33.330 ms | 33.325 ms | Galaxy S25 (SM-S931B), Android 15, Chrome 152.0.7977.54 |
| Frame interval, WebGL2, scale 0.5 | 33.330 ms | 33.330 ms | Galaxy S25 (SM-S931B), Android 15, Chrome 152.0.7977.54 |
| Frame interval, WebGL2, scale 1 | 33.323 ms | 33.325 ms | Galaxy S24 (SM-S921B), Android 16, Chrome 152.0.7977.54 |
| Frame interval, WebGL2, scale 0.5 | 33.328 ms | 33.325 ms | Galaxy S24 (SM-S921B), Android 16, Chrome 152.0.7977.54 |

At the whole canvas's scale the sharpening adds 0.948 ms on the iPad, which is 20 percent of its
4.686 ms frame. On the Galaxy S25 it adds 1.376 ms, which is 36 percent of that device's 3.801 ms
frame. At half scale it adds nothing on either device, as on the Mac. The S25's four WebGPU
figures sit on whole multiples of 65.536 µs, Chrome's timestamp step, so each is ±0.066 ms; the
iPad's Safari figures are not on that step.

The iPad draws at 2,064 by 2,528 pixels, where one full-screen pass costs 0.948 ms. The Mac's
1,920 by 1,080 pixels cost 0.393 ms on the same path. So the tablet pays about 2.4 times as much
for 2.5 times the pixels. The Galaxy S25's cost per pixel is higher still, which is the shape of a
phone GPU.

WebGL2 gives no GPU timer on the iPad or on either phone, and both Android displays ran at 30 Hz.
So those four rows hold the frame interval alone, and the value fits inside a frame there. On the
S24 the render worker's CPU time is 1.125 ms with the value on at the whole canvas's scale, and
0.955 ms off. At half scale the two are the same. The S24 has no WebGPU adapter, so its two WebGPU
pages skipped.

The cloud devices control neither heat nor display settings, so their figures are guides. The GPU
times come from each device's own timer and do not follow the display's rate.

The Galaxy S25 answers the finish line's "S24+": the owner ruled that this cloud phone closes the
S24+ line. The cloud iPad Pro 13 stands in for the team's iPad Pro 11-inch (2018), which did not
run, as [Device sessions](../devices.md#which-device-runs-a-check) allows. Its GPU is much faster
than the team's tablet's, so its figure guides that tablet's cost rather than giving it.

## Decision

The sharpening is a value of the post-processing settings, from 0 for off to 1 for the most. It
draws in the second step of the two-step pass, with FSR 1's RCAS over the four texels that cross each
pixel. A sketch that sets it draws those two steps at every render scale, so the sharpening reads
display color after one tone curve for each pixel. The first step's settings carry no sharpening, and
neither do the one-pass build or the still build. Each of them draws its frame as it does without
the value.

Below a render scale of 1 the second step sharpens its upscale with GSR 1's own edge-aware
sharpening, which D-195 ships and every preset gets. The value adds nothing there: a second RCAS over
the upscaled image would need the upscale again for each of the four neighbors.

## Consequences

- `post.set({ sharpen })` is public API, on `api/post` and in the post-processing concepts page. The
  three.js mapping has a `SharpenNode` row, and its FSR 1 row names the sharpening value.
- The two-step pass's target and its unfused effects come with the value, as D-167 says of a
  droppable render scale: a sketch whose render scale can drop already pays both.
- A still view keeps drawing while the sharpening is set: the sharpening draws in the moving frame's
  second step, so the still build's history is not sharpened. The image tests and hold mode draw one
  frame and are unaffected.
- The image tests `sharpen` and `sharpen-8-bit` draw a wall of small boxes at the most that the value
  takes, on both GPU paths. Their threshold is tighter than the default, because the sharpening moves
  an edge by about 10 steps, which the default threshold would not count: 0.02 against the real GPU's
  references and 0.05 against the software GPU's. A picture that lost the sharpening moves about 7
  per cent of the pixels, so both sets fail it, where the software GPU's own drawing of the test
  differs from the real GPU's in 0.2 per cent. The software set is CI's own drawing, as
  [D-238](D-238-gate-pictures-from-ci.md) asks.
- The sharpening keeps each pixel's coverage and sharpens premultiplied color, as the upscale does
  below a render scale of 1, so a transparent canvas's edges sharpen the same way there.
- The sharpening adds 0.948 ms on an iPad Pro 13 at the whole canvas's scale, and 1.376 ms on a
  Galaxy S25. It adds nothing at half scale on either. WebGL2 gives no GPU timer on the iPad and on
  both phones, and the Galaxy S24 has no WebGPU adapter. Those rows keep the frame interval alone.
