# D-205: Sharpening at the whole canvas's render scale, in the final pass

Status: decided by the M3-A10 task on 21 October 2026, for the owner's review. Built: the
`post.set({ sharpen })` value, RCAS in `final.wgsl`, the two-step pass at the whole canvas's scale,
the image tests and the cost page. The Mac's cost and the device costs are not recorded yet. Date:
2026-10-21. Task: M3-A10.

Summary: A sharpening value from 0 to 1 sharpens display color with FSR 1's RCAS in the second step
of the final pass. That step now draws at the whole canvas's render scale while the value is set. It
is off by default, and a page that leaves it off draws the frame it drew before: no extra pass, and
no changed pixel.

## Question

Below a render scale of 1 the final pass has sharpened its upscale since M2-F10, with the sharpening
built into GSR 1. A page at the whole canvas's scale had no sharpening at all, and no way to ask for
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
sharpen-cost.spec.ts` with `NULL3D_SHARPEN_COST=1` drew a wall of 32 x 32 boxes at 1920 x 1080. It
timed the frame with the sharpening off and on, in turns, three times each.

| Measure | Off | On | Device and browser |
| --- | --- | --- | --- |

## Decision

The sharpening is a value of the post-processing settings, from 0 for off to 1 for the most. It
draws in the second step of the two-step pass, with FSR 1's RCAS over the four texels that cross each
pixel. A sketch that sets it draws those two steps at every render scale, so the sharpening reads
display color after one tone curve for each pixel. The first step's settings carry no sharpening, and
neither do the one-pass build or the still build. Each of them draws its frame as before.

Below a render scale of 1 the second step sharpens its upscale with GSR 1's own edge-aware
sharpening, which D-195 ships and every preset gets. The value adds nothing there: a second RCAS over
the upscaled image would need the upscale again for each of the four neighbors.

## Consequences

- `post.set({ sharpen })` is public API, on `api/post` and in the post-processing concepts page. The
  three.js mapping gains a `SharpenNode` row, and its FSR 1 row no longer says that the engine has no
  sharpening control.
- The two-step pass's target and its unfused effects come with the value, as D-167 says of a
  droppable render scale: a sketch whose render scale can drop already pays both.
- A still view keeps drawing while the sharpening is set: the sharpening draws in the moving frame's
  second step, so the still build's history is not sharpened. The image tests and hold mode draw one
  frame and are unaffected.
- The image tests `sharpen` and `sharpen-8-bit` draw a wall of small boxes at the most that the value
  takes, on both GPU paths. Their threshold is tighter than the default, because the sharpening moves
  an edge by about 10 steps, which the default threshold would not count.
- The sharpening keeps each pixel's coverage and sharpens premultiplied color, as the upscale does
  below a render scale of 1, so a transparent canvas's edges sharpen the same way there.
- The cost on the iPad and on an S24-class phone is owed, and the phone rows follow from the device
  runs that the coordinator plans.
