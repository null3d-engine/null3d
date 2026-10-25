# D-265: A prepass's unwritten stand-in color costs Safari's WebGL2 path

Status: decided on 26 October 2026 by the device run below. The depth-only framebuffer is the
engine's default. The two other ways stay behind a page switch for measurement. The rise is
under 0.5 ms on the iPhone 18 Pro at both render scales. On the iPad 10 it is under 0.5 ms at render
scale 0.5. That page's noise leaves its scale 1 reading between 0.5 and 0.6 ms. Date:
2026-10-25, updated 2026-10-26. Task: M3-R23.

Summary: When a screen step splits the depth prepass from the opaque pass on WebGL2, the prepass
drew into a framebuffer of its own. That framebuffer held the scene depth and a full-canvas stand-in
color that the prepass never wrote. The pass's end then invalidated that color. Safari 26.6 and later charges render-worker
time for that, by an amount that follows the texture's size. The device run chose a depth-only
framebuffer, which took the charge from 3.6 ms to 0.2 ms on an iPhone 18 Pro. Keeping the color and
clearing it did not remove the charge. This is the whole of M2-R33's fixed cost, which D-193's
addendum had blamed on the horizon search and the denoise draws.

## Question

Ambient occlusion costs an iPhone 18 Pro about 3.6 ms of WebGL2 render-worker time a frame. It costs
the same at render scale 1 and at 0.5, while the same steps cost an iPad 0.2 to 0.7 ms. The cost does
not follow the drawn area, so it was read as a wait at the frame's end. What owns it?

## Data

### The browser fault

A stand-alone WebGL2 page with no engine code is attached to WebKit bug 328158. It binds a
framebuffer that holds only an unwritten color, and invalidates that color, once a frame. Cloud
devices ran it on 25 October 2026:

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
`Pass::creates_overwriting`. The engine
calls `creates_overwriting` in three places. One is the prepass's stand-in color under the `load`
switch. The other two are the ambient occlusion targets. Those two are written whole by the passes that declare them
and stored for the later reads. So they pay no charge ([D-193](D-193-ambient-occlusion-targets-start-without-a-clear.md)).
No other attachment of a color takes either of the other two routes and then drops it. The new
frame-graph test walks every step of the ambient occlusion frame. It refuses a color that a pass
loads and discards, apart from the prepass's own.

### The engine's own page

The `ao-prepass-color` plan ran the ambient occlusion cost page on 25 October 2026, which is
26 October locally. It ran on the cloud iPhone 18 Pro and the cloud iPad 10, on WebGL2 at render
scales 1 and 0.5. It ran once for each way the prepass starts its stand-in color. The render worker's CPU time per
frame, and the rise with ambient occlusion on:

| Device, browser | Render scale | Load | Clear | Depth only |
| --- | --- | --- | --- | --- |
| iPhone 18 Pro, Safari 27.0 | 1 | +3.72 ms | +3.70 ms | +0.22 ms |
| iPhone 18 Pro, Safari 27.0 | 0.5 | +3.60 ms | +3.54 ms | +0.20 ms |
| iPad 10, Safari 27.0 | 1 | +0.65 ms | +0.48 ms | +0.52 ms |
| iPad 10, Safari 27.0 | 0.5 | +0.34 ms | +0.54 ms | +0.29 ms |

The figures are the medians of three rounds on each side. The iPhone's page held 15.56 to 15.62 ms
a frame throughout. The iPad's page did not. Its ambient occlusion halves ran at 22 to 35 ms against
21 to 22 ms. So each of its figures carries the wait of its own slower frames. The spread across its
three ways, 0.29 to 0.65 ms, is the run's noise. The records are
[the iPhone run](../tested-devices/iphone-18-pro-safari/20261025-174232-ao-prepass-color.md) and
[the iPad run](../tested-devices/ipad-10th-generation-safari/20261025-174232-ao-prepass-color.md).

The depth-only framebuffer then became the default, and the `ao` plan's two WebGL2 pages ran again
on both devices. The iPhone's rise was 0.18 ms at render scale 1 and 0.22 ms at 0.5. The iPad's was
0.64 ms at scale 1 and 0.34 ms at 0.5. Its scale 1 page again did not hold the display rate,
27.24 ms against 21.76 ms. These are
[the iPhone run](../tested-devices/iphone-18-pro-safari/20261025-180313-ao.md) and
[the iPad run](../tested-devices/ipad-10th-generation-safari/20261025-180313-ao.md).

## Options

1. Give the prepass a depth-only framebuffer, with no color attachment at all.
2. Keep the color attachment and clear it in the prepass's clear, instead of loading it and
   invalidating it.

Both draw the same image: the stand-in color carries nothing that any pass reads.

## Decision

The depth-only framebuffer. It is the only way that removes the charge. On the iPhone 18 Pro it
takes the rise from 3.6 ms to 0.2 ms at both render scales. Keeping the color and clearing it pays
the whole charge, within 0.06 ms of the load at both scales. So that way is not a fix.

The two candidate figures that the stand-alone page gave were too close to separate, 0.16 to 0.22 ms
against 0.22 to 0.24 ms. Inside the engine they are not close at all, which is why the run measured
each one there.

The iPad 10 pays only a small part of the charge in the engine's own frame. The depth-only
framebuffer took its rise from 0.65 to 0.52 ms at render scale 1. At 0.5 it went from 0.34 to
0.29 ms. Both changes are inside that page's noise. The stand-alone page's 3.26 ms on this device does not transfer
to the engine's frame there. So the bar of under 0.5 ms is met on the iPhone 18 Pro at both scales.
On the iPad 10 it is met at scale 0.5, and the scale 1 rise reads 0.52 and 0.64 ms in the two runs.
That page's noise holds the answer at scale 1. It does not keep the display's rate with ambient
occlusion on, and Safari's WebGL2 path has no GPU timer there.

## Consequences

- WebGPU does not change. Its clear is cheap, and a load there would read the whole target.
- The WebGL2 image tests of ambient occlusion match their references unchanged, since no pass reads
  the stand-in color. The `ao-prepass-color-clear` and `ao-prepass-color-none` tests draw the same
  picture as `ao-wide`.
- A prepass that attaches no color draws into a depth-only framebuffer, whose draw buffers are
  `NONE`. The framebuffer holds one per depth target, as a shadow cascade's does.
- The engine's docs name the exception that a target is not cleared at its first write, which D-193
  gives. They also give the reason: on Safari's WebGL2 path an unwritten color costs time that
  follows its size.
