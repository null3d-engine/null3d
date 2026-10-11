# D-129: Temporal anti-aliasing

Status: proposed on 11 October 2026 by the helper of M2-EX18, for the owner to rule on. The prototype is on the branch `proto/m2-ex18-taa`, which has no pull request. Date: 2026-10-11. Task: M2-EX18.

Summary: Draft. The prototype runs; the shimmer, smear and cost figures are being gathered, and the recommendation follows them.

## Question

Dense grass draws with alpha to coverage under 4x MSAA. Does it shimmer when the camera moves, and do thin lines and fences? What does a temporal anti-aliasing pass (TAA) cost on the Mac, what does it fix, and what does it break? Should the engine ship TAA, and as the default where ([D-117](D-117-showcase-features-before-1-0.md))?

## Rule

The owner rules from these figures:

- **Shimmer:** how much frame-to-frame change each mode adds beyond the true image's, in the Creek's grass and in thin geometry, with the camera still and moving.
- **Smear:** how much true change each mode loses, and how soft each mode draws against a reference of 64 samples per pixel.
- **Cost:** GPU time per frame at 1920 x 1080 on the Mac at High, with and without each mode.
- The engine's rules for any feature that ships: no allocation per frame, nothing costs anything while it is off, and its shaders load on first use ([AGENTS.md](../../AGENTS.md#hard-rules)).

## The prototype

The prototype follows Brian Karis's "High quality temporal supersampling" (SIGGRAPH 2014) and Playdead's INSIDE, which most engines' TAA descend from:

- **Offsets.** Each frame moves the camera's projection by a part of a pixel, from the Halton sequence of bases 2 and 3, eight frames long, as Unreal Engine does. Over eight frames each pixel sees eight places within itself.
- **Reprojection.** Each pixel finds where its surface lay in the last frame from its depth and the last frame's camera. It takes the nearest depth of its 3 x 3 neighbors, so a thin edge in front keeps its own place. This follows every move of the camera, but not objects that move or bend by themselves, such as swaying grass: there is no motion vector target.
- **History.** The last frame's result, read where the surface lay, with a Catmull-Rom filter of five linear taps.
- **Neighborhood limit.** The 3 x 3 neighbors give the colors that the pixel can take in this frame: their mean and spread in YCoCg, within their smallest and largest values. The history moves toward that box until it lies inside it, so a surface that moved or came into view leaves no trail.
- **Blend.** The pixel keeps 90% of the history and takes 10% from this frame, less history where the brightness changed much (Lottes's weight). Colors blend after a squeeze by their brightness, so one bright sample does not flicker.

It runs after the camera's transparent pass and before the custom effects, depth of field, bloom and the final pass, on HDR color. Two kept targets hold the history and take turns by frame number. Each frame reads the one the frame before it wrote and writes the other, so a frame drawn again, as `captureFrame` draws it, leaves the same history. A copy step writes the resolve's target into the history. A shipping version would draw into the history directly and save that copy.

In code: `crates/null3d-render/src/taa.rs`, `crates/null3d-shaders/wgsl/taa.wgsl` and `taa_keep.wgsl`, the frame graph's three steps, and pipeline templates 48 to 50, which reuse depth of field's bind layouts. A sketch turns it on with `post.set({ taa: true })`, an internal setting for the prototype only. `post.set({ msaaFxaa: true })` runs the final pass's FXAA over a scene drawn with MSAA, which no mode offered before. Both GPU paths draw it.

One fault came out of the first sequences. The resolve reprojected each pixel through this frame's projection with its offset, so even a still camera read the history half a pixel away in a new direction each frame, and the history blurred: the rocks drew at about half the reference's sharpness. Each pixel's center now reprojects through the projections without their offsets. A unit test checks that a still camera reprojects every pixel onto itself.

## How the figures were made

**Scenes.** The Creek showcase (M2-EX8) in its Afternoon mood, with its dense swaying grass in instance batches that cast and receive shadows, and a thin geometry scene (`tests/pages/sketches/taa-thin-sketch.ts`): a picket fence of 3 cm pickets, a far fence whose 2 cm pickets are narrower than a pixel, three 1 cm power wires against the sky, and a mesh of lines one pixel wide.

**Modes.** MSAA (4x, with alpha to coverage on the grass), MSAA + FXAA, and TAA over MSAA. TAA ran three ways: the prototype's defaults, a linear history filter in place of Catmull-Rom, and a history share of 80% in place of 90%.

**Sequences.** The capture page (`tests/pages/taa-sequence.html`) starts the engine at 960 x 540 with a fixed step of 1/60 s per frame, so every run draws the same frames, and throttles the frame loop to 6 frames a second, so each `captureFrame` returns the next frame. Each capture records the sketch frames that the page heard of, which shows that all 16 frames of each sequence are consecutive, frames 121 to 136. The camera circles the scene's target at 0.1 radians per second (slow), 0.3 (a brisk orbit), or 0 (still; the grass still sways).

**Reference.** The same 16 frames drawn at 3840 x 2160 with MSAA, which is 64 samples per pixel, and shrunk to 960 x 540 by averaging 4 x 4 blocks in linear light.

**Figures.** In 8-bit levels of the luma of the displayed color, per region of the frame, over the 15 steps between the 16 frames (`analyze.py`, kept with the sequences):

| Figure | What it measures |
| --- | --- |
| Shimmer | Frame-to-frame change beyond the reference's: the mean of max(\|dI\| - \|dR\|, 0) per pixel and step |
| Smear | True change that the frames lack: the mean of max(\|dR\| - \|dI\|, 0), the lag and blur of motion |
| Error | The mean distance from the reference in each frame |
| Sharpness | The mean size of each frame's gradients over the reference's: 1 is as sharp, below 1 softer |
| Still | Frame-to-frame change where the reference does not change at all, as the still regions of the still camera |

**Cost.** The effect cost page (`tests/pages/effect-cost.html?effect=taa` and `effect=msaafxaa`) at 1920 x 1080, render scale 1, at High, in headless Chrome on the Mac's GPU. It plays the scene with the mode off and on in turns, three rounds of 2 seconds each, and reports the medians of GPU time per frame. Runs in a quiet window at loads of 3.2 to 4.3, on 11 October 2026.

## Data

DATA

## Trade-offs

TRADEOFFS

## Recommendation

RECOMMENDATION

## Consequences

CONSEQUENCES
