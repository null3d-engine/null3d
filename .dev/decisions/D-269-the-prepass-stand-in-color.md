# D-269: A prepass's unwritten stand-in color costs Safari's WebGL2 path

Status: decided by the device runs below. The depth-only framebuffer is the engine's default. The two
other ways stay behind a page switch for measurement.

The charge is gone on both devices, in the frame time that each pays. The bar's own metric is the
render worker's time per frame. On the iPhone 18 Pro it reads under 0.5 ms at both render scales. On
the iPad 10 at its own preset it reads 0.52 and 0.64 ms at full scale, above the 0.5 ms bar, and 0.29
and 0.34 ms at half scale. That full-scale frame is GPU-bound, so the metric there is a slice of the
cost, and the frame interval shows the charge in full. A later run at the Low preset compared
ambient occlusion off with on, with the switch at its default in both halves, so it could not isolate
the fix. The owner ruled that "the iPad 10's 0.64 and 0.52 ms margin is accepted". Task: M3-R23.

Summary: When a screen step splits the depth prepass from the opaque pass on WebGL2, the prepass
drew into a framebuffer of its own. That framebuffer held the scene depth and a full-canvas stand-in
color that the prepass never wrote. The pass's end then invalidated that color. Safari 26.6 and later
charges time for that, by an amount that follows the texture's size. The device run chose a
depth-only framebuffer. On an iPhone 18 Pro it takes the charge from 3.6 ms to 0.2 ms. On an iPad 10
the same color costs 4.8 to 7.2 ms of frame time, and the fix gives it back. Keeping the color and clearing it
does not remove the charge. This is the whole of M2-R33's fixed cost, which D-193's addendum had
blamed on the horizon search and the denoise draws.

## Question

Ambient occlusion costs an iPhone 18 Pro about 3.6 ms of WebGL2 render-worker time a frame. It costs
the same at render scale 1 and at 0.5, while the same steps cost an iPad 0.2 to 0.7 ms. The cost does
not follow the drawn area, so it was read as a wait at the frame's end. What owns it?

## Data

### The browser fault

A stand-alone WebGL2 page with no engine code is attached to WebKit bug 328158. It binds a
framebuffer that holds only an unwritten color, and invalidates that color, once a frame. Cloud
devices ran it:

| Device, browser | Texture | Added per frame |
| --- | --- | --- |
| iPhone 18 Pro, Safari 27.0 | 603 x 1032, `RGBA16F` | 4.10 ms |
| iPhone 17, Safari 26.5 | 603 x 1032, `RGBA16F` | 0.02 ms |
| iPad 10, Safari 27.0 | 1230 x 1602, `RGBA16F` | 3.26 ms |
| iPad Pro 13, Safari 26.6.1 | 1548 x 1896, `RGBA16F` | 12.28 ms |
| iPhone 18 Pro, Safari 27.0 | 64 x 64, `RGBA16F` | 0.14 ms |

`RGBA8` costs about twice what `RGBA16F` costs. The page's copy of the engine's split frame added
3.78 to 3.92 ms on the iPhone 18 Pro. That page is not part of this repository, so these figures
carry the bug report as their record.

### The search for other passes

The compiler starts an attachment from what the texture holds by three routes. An earlier pass may
have written it. A kept target may start by keeping it. Or a pass may declare
`Pass::creates_overwriting`. The engine calls `creates_overwriting` in three places. One is the
prepass's stand-in color under the `load` switch. The other two are the ambient occlusion targets.
Those two are written whole by the passes that declare them and stored for the later reads. So they
pay no charge ([D-193](D-193-ambient-occlusion-targets-start-without-a-clear.md)). No other
attachment of a color takes either of the other two routes and then drops it. The new frame-graph
test walks every step of the ambient occlusion frame. It refuses a color that a pass loads and
discards, apart from the prepass's own.

### The engine's own page

The `ao-prepass-color` plan ran the ambient occlusion cost page on the cloud iPhone 18 Pro and the
cloud iPad 10, on WebGL2 at render scales 1 and 0.5. It ran once for each way the prepass starts its stand-in color. The render worker's
CPU time per frame, and the rise with ambient occlusion on, in milliseconds:

| Device, browser | Render scale | Load | Clear | Depth only |
| --- | --- | --- | --- | --- |
| iPhone 18 Pro, Safari 27.0 | 1 | +3.72 | +3.70 | +0.22 |
| iPhone 18 Pro, Safari 27.0 | 0.5 | +3.60 | +3.54 | +0.20 |
| iPad 10, Safari 27.0 | 1 | +0.65 | +0.48 | +0.52 |
| iPad 10, Safari 27.0 | 0.5 | +0.34 | +0.54 | +0.29 |

The same pages report the frame interval. That is where the iPad shows the charge whole:

| Device, browser | Render scale | Way | Off | On | Rise |
| --- | --- | --- | --- | --- | --- |
| iPhone 18 Pro, Safari 27.0 | 1 | `load` | 15.56 | 15.62 | 0.06 |
| iPhone 18 Pro, Safari 27.0 | 1 | `clear` | 15.56 | 15.62 | 0.06 |
| iPhone 18 Pro, Safari 27.0 | 1 | `none` | 15.56 | 15.56 | 0.00 |
| iPhone 18 Pro, Safari 27.0 | 0.5 | `load` | 15.56 | 15.62 | 0.06 |
| iPhone 18 Pro, Safari 27.0 | 0.5 | `clear` | 15.56 | 15.62 | 0.06 |
| iPhone 18 Pro, Safari 27.0 | 0.5 | `none` | 15.60 | 15.60 | 0.00 |
| iPad 10, Safari 27.0 | 1 | `load` | 22.12 | 32.38 | 10.26 |
| iPad 10, Safari 27.0 | 1 | `clear` | 21.92 | 34.63 | 12.71 |
| iPad 10, Safari 27.0 | 1 | `none` | 21.87 | 27.36 | 5.49 |
| iPad 10, Safari 27.0 | 0.5 | `load` | 20.60 | 24.95 | 4.35 |
| iPad 10, Safari 27.0 | 0.5 | `clear` | 20.56 | 27.44 | 6.88 |
| iPad 10, Safari 27.0 | 0.5 | `none` | 20.72 | 21.97 | 1.25 |

The prepass's stand-in color therefore costs the iPad 4.8 to 7.2 ms of frame time at render scale 1.
That is the interval with the color less the interval with no color: 10.26 less 5.49, and 12.71 less
5.49. At scale 0.5 it costs 3.1 to 5.6 ms by the same subtraction. The engine's drawing buffer is
1640 by 2136 pixels, 1.78 times the area of the stand-alone page's 1230 by 1602. Its 3.26 ms times
1.78 is about 5.8 ms, which sits inside both ranges. So that page's figure does transfer to the
engine's frame.

An earlier version of this record read the render worker's rise as the whole cost. It concluded that
the page's figure did not transfer, and that the iPad paid about a tenth of a millisecond. That was
wrong, and this record retracts it. The render worker's rise is a slice on the iPad because the frame
is GPU-bound: the worker waits once a frame inside Safari's GPU process, and the rest of the added
work only lengthens the frame.

The plan runs the ways in the order load, clear, then none. The fastest case ran last, so heat cannot
explain the order.

The depth-only framebuffer then became the default, and the `ao` plan's two WebGL2 pages ran again
on both devices. The iPhone's render-worker rise was 0.18 ms at render scale 1 and 0.22 ms at 0.5,
and its interval did not move. The iPad's was 0.64 ms at scale 1 and 0.34 ms at 0.5, with the
interval at 21.76 to 27.24 ms at full scale and 20.56 to 21.64 ms at half scale.

### The Low preset run

A third run took the iPad's two pages at the Low preset, which is the preset the phone uses. It
answers a different question, and it does not isolate the prepass.

1. The run compares the ambient occlusion cost page's own two halves. One draws the scene with the
   effect off, and the other draws it with the effect on. Both ran with `prepass-color` at the
   engine's default, which attaches no color. So the only difference between them is ambient
   occlusion, with the screen steps and the split prepass that it brings. The switch is not varied,
   and the stand-in color is in neither state.
2. The render worker moves 0.24 ms while the interval moves 5.09 ms because the frame is GPU-bound
   at that setting. With the effect off it drew at the display's rate, 15.60 ms. With it on it fell
   to 20.69 ms, which is 48 frames a second against 64. The worker waits once a frame inside
   Safari's GPU process, and that wait covers only part of the added GPU work. The rest lengthens
   the frame.
3. The iPad at Low does not hold 60 frames a second with the effect on. A 20.69 ms frame is over the
   16.7 ms that 60 Hz allows. So a charge that leaves the frame over budget is not shown to be gone
   by this run.

So the Low run cannot isolate the prepass either. Its 0.24 ms is not a figure for the stand-in
color, and it is not a reading under the bar. At half scale the page held its rate, 15.56 against
15.54 ms, and ambient occlusion's whole addition there was -0.02 ms.

The records are
[the iPhone comparison run](../tested-devices/iphone-18-pro-safari/20261025-174232-ao-prepass-color.md),
[the iPhone default run](../tested-devices/iphone-18-pro-safari/20261025-180313-ao.md), and the same
two, plus [the Low preset run](../tested-devices/ipad-10th-generation-safari/20261025-205925-ao.md),
in [the iPad folder](../tested-devices/ipad-10th-generation-safari/).

## Options

1. Give the prepass a depth-only framebuffer, with no color attachment at all.
2. Keep the color attachment and clear it in the prepass's clear, instead of loading it and
   invalidating it.

Both draw the same image: the stand-in color carries nothing that any pass reads.

## Decision

The depth-only framebuffer. It is the only way that removes the charge. On the iPhone 18 Pro it
takes the rise from 3.6 ms to 0.2 ms at both render scales. Keeping the color and clearing it pays
the whole charge, within 0.06 ms of the load at both scales. On the iPad the same two ways pay 4.8 to
7.2 ms of frame time and the depth-only framebuffer pays none of it.

The two candidate figures that the stand-alone page gave were too close to separate, 0.16 to 0.22 ms
against 0.22 to 0.24 ms. Inside the engine they are not close at all, which is why the run measured
each one there.

The bar reads the render worker's rise. On the iPhone 18 Pro it is met at both render scales. On the
iPad 10 at its own preset it is met at scale 0.5, at 0.29 and 0.34 ms. At scale 1 it reads 0.52 and
0.64 ms. That frame is GPU-bound: it drew at 37 frames a second with ambient occlusion on against 46
with it off, and its busiest thread used 1.46 ms of the 27.24 ms frame. So the metric there covers
0.64 ms of the 5.48 ms that the frame grew, and it cannot show the charge. The Low preset run cannot add a
reading: it compared ambient occlusion off with on, with the switch at its default in both halves,
so its 0.24 ms is not a figure for the stand-in color. So the full-scale iPad figure misses the bar
as written, and no run has given a clean full-scale reading of the fix on that device. The owner
accepted that margin: "the iPad 10's 0.64 and 0.52 ms margin is accepted".

## Consequences

- WebGPU does not change. Its clear is cheap, and a load there would read the whole target.
- The WebGL2 image tests of ambient occlusion match their references unchanged, since no pass reads
  the stand-in color. The `ao-prepass-color-clear` picture draws the same frame as `ao-wide`.
- A prepass that attaches no color draws into a depth-only framebuffer, whose draw buffers are
  `NONE`. The framebuffer holds one per depth target, as a shadow cascade's does.
- The engine's docs name the exception that a target is not cleared at its first write, which D-193
  gives. They also give the reason: on Safari's WebGL2 path an unwritten color costs time that
  follows its size.
- Three commits on the branch carry `Task: M3-R23` from queue and tooling work that came before the
  fix. They deliver no part of it, so a reader should not count them as the fix.
