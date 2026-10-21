# D-129: Temporal anti-aliasing

Status: decided by the owner on 11 October 2026, as the recommendation proposed: no TAA for 1.0. Per-object motion vectors move before 1.0, as task M2-EX25. The prototype is on the branch `proto/m2-ex18-taa`, which has no pull request and does not merge. On 15 October 2026 the owner left TAA to M3-A11: if it says no, TAA is dropped (see the addendum). Date: 2026-10-11. Task: M2-EX18.

Summary: The owner ruled: do not ship temporal anti-aliasing (TAA) for 1.0. Keep FXAA on Low and MSAA 4x from Medium up. Per-object motion vectors come before 1.0 (M2-EX25), as the base for a later TAA attempt. A prototype cut the shimmer of the Creek's far grass by 92% against MSAA. But it drew the scene at 0.55 to 0.75 of a 64-sample reference's sharpness. It smeared swaying grass two to three times as much, and it made still thin lines crawl. On the Mac it cost about 0.3 ms in the Creek and 1 to 2 ms in a light scene with WebGPU, and 7.5 ms in the Creek with WebGL2.

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

One fault came out of the first sequences. The resolve reprojected each pixel through this frame's projection with its offset. So even a still camera read the history half a pixel away, in a new direction each frame, and the history blurred. The rocks drew at about half the reference's sharpness. Each pixel's center now reprojects through the projections without their offsets. A unit test checks that a still camera reprojects every pixel onto itself.

## How the figures were made

**Scenes.** The Creek showcase (M2-EX8) in its Afternoon mood, with its dense swaying grass in instance batches that cast and receive shadows. And a thin geometry scene (`tests/pages/sketches/taa-thin-sketch.ts`) with four parts: a fence of 3 cm pickets, and a far fence whose 2 cm pickets are narrower than a pixel. Three 1 cm power wires against the sky, and a mesh of lines one pixel wide.

**Modes.** MSAA (4x, with alpha to coverage on the grass), MSAA + FXAA, TAA over MSAA, TAA without MSAA, and no anti-aliasing. TAA ran three ways: the prototype's defaults, a linear history filter in place of Catmull-Rom, and a history share of 80% in place of 90%.

**Sequences.** The capture page (`tests/pages/taa-sequence.html`) starts the engine at 960 x 540 with a fixed step of 1/60 s per frame, so every run draws the same frames. It throttles the frame loop to 6 frames a second, so each `captureFrame` returns the next frame. Each capture records the sketch frames that the page heard of. They show that all 16 frames of each sequence are consecutive, frames 121 to 136. The camera circles the scene's target at 0.1 radians per second (slow), 0.3 (a brisk orbit), or 0 (still; the grass still sways).

**Reference.** The same 16 frames drawn at 3840 x 2160 with MSAA, which is 64 samples per pixel. They are shrunk to 960 x 540 by averaging 4 x 4 blocks in linear light.

**Figures.** In 8-bit levels of the luma of the displayed color, per region of the frame, over the 15 steps between the 16 frames (`analyze.py`, kept with the sequences):

| Figure | What it measures |
| --- | --- |
| Shimmer | Frame-to-frame change beyond the reference's: the mean of max(\|dI\| - \|dR\|, 0) per pixel and step |
| Smear | True change that the frames lack: the mean of max(\|dR\| - \|dI\|, 0), the lag and blur of motion |
| Error | The mean distance from the reference in each frame |
| Sharpness | The mean size of each frame's gradients over the reference's: 1 is as sharp, below 1 softer |
| Still | Frame-to-frame change where the reference does not change at all, as the still regions of the still camera |

**Cost.** The effect cost page (`tests/pages/effect-cost.html?effect=taa` and `effect=msaafxaa`) at 1920 x 1080, render scale 1, at High, in headless Chrome on the Mac's GPU. It plays the scene with the mode off and on in turns, three rounds of 2 seconds each, and reports the medians of GPU time per frame. Each run had the Mac to itself, at loads of 2.3 to 4.3, on 11 October 2026. TAA without MSAA ran against no anti-aliasing (`&antialias=none`). A per-pass probe (`tests/pages/taa-sequence.html?measure=3`) timed each mode for 3 seconds at the same size.

## Data

All shimmer, smear and sharpness figures come from the 16-frame sequences at 960 x 540 on the Mac's GPU with WebGPU. All 44 sequences hold consecutive frames, 121 to 136. "TAA, no MSAA" is the same TAA drawn over a scene without MSAA. Lower shimmer and smear are better; sharpness is best near 1.

### The Creek, slow orbit (0.1 radians per second)

Shimmer / smear / sharpness for each region:

| Region | MSAA | MSAA + FXAA | TAA over MSAA | TAA, no MSAA |
| --- | --- | --- | --- | --- |
| Near grass | 2.00 / 1.61 / 1.07 | 1.23 / 2.99 / 0.82 | 1.16 / 5.57 / 0.53 | 1.36 / 4.96 / 0.62 |
| Far-bank grass | 2.88 / 0.65 / 1.23 | 2.26 / 0.72 / 1.00 | 0.24 / 1.73 / 0.55 | 0.49 / 1.46 / 0.67 |
| Water | 1.86 / 1.60 / 1.02 | 1.22 / 2.27 / 0.82 | 0.47 / 4.05 / 0.49 | 0.69 / 3.61 / 0.58 |
| Rocks | 0.55 / 0.52 / 0.97 | 0.49 / 0.56 / 0.92 | 0.22 / 0.97 / 0.69 | 0.24 / 0.93 / 0.70 |
| Whole frame | 1.52 / 0.97 / 1.10 | 1.04 / 1.53 / 0.89 | 0.54 / 2.86 / 0.56 | 0.70 / 2.54 / 0.65 |

TAA cuts the far grass's shimmer by 92% and the water's by 75%. It also draws the whole frame at a little over half the reference's sharpness. The near grass and the water lose two to three times as much of their true motion as with MSAA. They sway and ripple by themselves, and without motion vectors TAA reads their history from the wrong place.

### The Creek, other camera speeds (whole frame)

| Camera | MSAA | MSAA + FXAA | TAA over MSAA | TAA, no MSAA |
| --- | --- | --- | --- | --- |
| Still (the grass still sways) | 0.92 / 0.33 / 1.09 | 0.78 / 0.32 / 0.87 | 0.24 / 0.54 / 0.63 | 0.42 / 0.45 / 0.74 |
| Brisk orbit (0.3 radians per second) | 1.34 / 1.00 / 1.10 | 0.99 / 1.41 / 0.92 | 0.72 / 2.84 / 0.55 | 0.84 / 2.59 / 0.63 |

With the camera still, the rocks still draw at 0.76 of the reference's sharpness with TAA, against 1.04 with MSAA.

### The thin geometry scene

With the camera still, nothing in the scene moves. MSAA and MSAA + FXAA then draw the same image every frame. TAA does not: the offsets move sub-pixel lines and the limit box cuts the history back to this frame's samples, so the lines crawl. Mean change between frames:

| Region | MSAA | MSAA + FXAA | TAA over MSAA | TAA, no MSAA |
| --- | --- | --- | --- | --- |
| Whole frame | 0.00 | 0.00 | 0.47 | 0.96 |
| Line mesh | 0.00 | 0.00 | 2.03 | 4.02 |
| Far fence | 0.00 | 0.00 | 1.96 | 4.18 |
| Wires | 0.00 | 0.00 | 0.17 | 0.77 |

With the camera on its slow orbit (shimmer / smear / sharpness):

| Region | MSAA | MSAA + FXAA | TAA over MSAA | TAA, no MSAA |
| --- | --- | --- | --- | --- |
| Far fence | 2.11 / 0.47 / 1.55 | 1.79 / 0.49 / 1.45 | 0.39 / 0.93 / 0.91 | 8.41 / 0.28 / 1.72 |
| Line mesh | 4.48 / 1.42 / 1.94 | 3.83 / 2.89 / 1.65 | 2.08 / 5.76 / 1.11 | 3.24 / 4.89 / 1.46 |
| Near fence | 0.89 / 0.51 / 1.28 | 0.84 / 0.63 / 1.19 | 1.01 / 1.55 / 1.01 | 1.03 / 1.33 / 1.07 |
| Wires | 0.29 / 0.19 / 1.11 | 0.26 / 0.19 / 1.01 | 0.22 / 0.33 / 0.80 | 0.56 / 0.21 / 1.15 |

TAA over MSAA calms the far fence, whose pickets are narrower than a pixel, by 82%. TAA without MSAA makes the far fence four times worse than MSAA. With one sample per pixel, each frame finds the pickets in a new pattern, and the limit box keeps that pattern.

### Distance from the reference

The mean distance from the reference, whole frame, counts aliasing and blur together:

| Scene and camera | MSAA | MSAA + FXAA | TAA over MSAA | TAA, no MSAA |
| --- | --- | --- | --- | --- |
| Creek, still | 2.58 | 2.63 | 2.93 | 2.96 |
| Creek, slow | 2.44 | 2.50 | 3.35 | 3.30 |
| Creek, brisk | 2.01 | 2.05 | 3.08 | 3.02 |
| Thin, still | 2.42 | 2.47 | 2.34 | 2.96 |
| Thin, slow | 2.30 | 2.32 | 2.77 | 3.15 |
| Thin, brisk | 1.96 | 1.95 | 2.39 | 2.66 |

MSAA is closest in five of six runs. TAA over MSAA wins only the thin scene with a still camera.

### The variants

| Creek, slow orbit, whole frame | Shimmer | Smear | Sharpness |
| --- | --- | --- | --- |
| TAA over MSAA (90% history, Catmull-Rom history) | 0.54 | 2.86 | 0.56 |
| 80% history | 0.62 | 2.43 | 0.64 |
| Linear history filter | 0.41 | 3.20 | 0.49 |

Less history is a little sharper and shimmers a little more. The linear filter is softer still. Neither changes the picture. In the thin scene with a still camera, 80% history flickers more (0.78 against 0.47).

### Cost

GPU time per frame that each mode adds, at 1920 x 1080 and render scale 1, at High. All runs used headless Chrome on the Mac (Apple M5 Max). Each figure is the difference of the medians, off and on, in one page:

| Scene and path | Base | MSAA + FXAA | TAA over MSAA | TAA, no MSAA (against no anti-aliasing) |
| --- | --- | --- | --- | --- |
| Creek, WebGPU | 6.0 to 8.0 ms | -0.07 and +0.13 ms | +0.26, +0.00, +0.26 ms | +0.13, +0.52 ms |
| Thin scene, WebGPU (8-bit color, so TAA adds the move to HDR) | 1.1 ms | +0.20, +0.13 ms | +1.97, +2.03 ms | - |
| Thin scene with bloom, WebGPU (HDR both ways) | 1.8 to 1.9 ms | - | +2.10, +2.16 ms | +0.98, +0.98 ms |
| Creek, WebGL2 | 6.4 to 7.7 ms | -0.01 ms | +7.55, +7.53, +7.46 ms | +0.75 ms (a second round's base rose by 5 ms, so it is left out) |
| Thin scene with bloom, WebGL2 | 3.9 ms with MSAA, 4.1 ms without | - | +2.88, +2.80 ms | +1.45, +1.46 ms |

WebGPU's timer counts in steps of about 0.07 ms. The thin scene draws as fast with MSAA as without it (1.84 ms both ways).

The per-pass probe (`tests/pages/taa-sequence.html?measure=3`) splits the frame into its first six render passes and puts every later pass into the sixth. On the Mac the passes overlap, so their times do not add up to the frame's. Medians of two rounds:

| Frame | Thin scene with bloom | Creek |
| --- | --- | --- |
| MSAA | 1.90 ms | 7.21, 6.09 ms |
| TAA over MSAA (36 depth samples per pixel) | 4.59, 4.19 ms | 6.29, 7.14 ms |
| TAA over MSAA, one depth sample per pixel (`depth: 'light'`) | 2.88, 2.88 ms | 6.29, 7.80 ms |
| TAA without offsets | 4.59, 4.13 ms | 8.65, 9.18 ms |

In the thin scene the extra time falls in the passes right after the scene pass, where TAA's steps run. The fourth pass grows from 0.72 ms to 2.69 ms, and to 1.38 ms with one depth sample. The Creek's frame varies by about 1 ms from round to round, more than TAA's cost. Its TAA steps fall into the sixth slot, with the scene pass.

### Why TAA's cost differs so much

- **Thin scene against the Creek on WebGPU.** The resolve takes the nearest depth of 3 x 3 pixels of 4 samples each: 36 depth reads per pixel. In the thin scene these cost about 1.5 ms (2.3 to 2.7 ms against 1.0 ms with one sample). In the Creek they cost nothing that the probe can see. The shader and the size are the same, so the GPU must run it faster in the Creek. The likely cause is the GPU's clock. The thin scene keeps the GPU busy for about 2 ms in each 16.7 ms frame. The Mac then runs the GPU at a low clock, so each step takes longer. The Creek keeps it busy for 6 to 8 ms, at a higher clock. [D-119](D-119-depth-of-field.md) measured a like cost: reading every depth sample cost depth of field about 0.5 ms more per frame. A second cause adds a little in the thin scene. No other step there reads the depth, so the scene pass would keep its multisampled depth on chip and throw it away. TAA makes it write that depth to memory, about 33 MB per frame at 1920 x 1080. The Creek's ambient occlusion already reads its depth.
- **TAA without MSAA** reads 9 depth values per pixel in place of 36, and the scene's depth has one sample. It costs about 1 ms in the thin scene and 0.1 to 0.5 ms in the Creek.
- **WebGL2.** The cost comes with MSAA. Without MSAA, TAA costs 0.75 ms in the Creek and 1.45 ms in the thin scene. With MSAA it costs 7.5 ms and 2.8 ms. A WebGL2 shader cannot read a multisampled depth. So after each pass that keeps the depth, the backend copies one sample of each pixel into a texture with a blit. ANGLE on Metal draws each such blit as a pass of its own. TAA reads the depth after the last scene pass, so each pass that writes the depth must keep it and copy it. The Creek draws its scene in more passes than the thin scene, which fits its larger cost. The number of copies per frame was not counted. The WebGL2 timer has no per-pass figures.

So in a light scene on this Mac, TAA's own work costs about 1 ms without MSAA and 2 ms over it. In a busy scene it costs little. A phone's GPU is several times slower, and its cost there is unknown.

## Trade-offs

What TAA fixes:

- The shimmer of grass and water far from the camera: 75% to 92% less than MSAA with the camera moving.
- Pickets narrower than a pixel, over MSAA: 82% less shimmer.

What it breaks:

- **Blur.** TAA draws the Creek at 0.55 to 0.75 of the reference's sharpness, even with the camera still. MSAA draws at about 1. TAA blurs the rocks too, which only the camera moves. Part of the blur comes from offsets of up to a pixel on top of MSAA's own spread of samples. So each pixel averages samples from about 2 pixels wide. Without MSAA, TAA is a little sharper (0.62 to 0.80).
- **Smear.** Grass and water that move by themselves smear two to three times as much as with MSAA, because nothing tells TAA how they moved.
- **Flicker on a still camera.** Thin lines that MSAA holds still crawl with TAA. The mean change per frame reaches 2 levels over MSAA and 4 without it.
- **Distance from the reference.** MSAA is closer than TAA in five of the six runs.
- **Cost.** In a light scene on the Mac, 1 to 2 ms with WebGPU and about 3 ms with WebGL2. In the Creek with WebGL2 and MSAA, 7.5 ms.

TAA without MSAA saves the MSAA sample cost, but it fails worst on the thinnest geometry. The far fence shimmers four times as much as with MSAA.

MSAA + FXAA is a milder trade. It gives 20% to 35% less shimmer than MSAA and 0.8 to 0.9 of the reference's sharpness, for about 0.15 ms. Its distance from the reference stays the same. It only exchanges shimmer for softness.

A TAA worth shipping would need, at the least:

1. A motion vector target, written by every moving, bending and skinned surface, the grass's wind among them.
2. A fix for the still camera's flicker. For example, a longer history while the camera holds still, or a limit box that lets sub-pixel lines keep their history.
3. Less blur: smaller offsets over MSAA, a sharper filter of this frame's samples, or a sharpening step after the resolve.
4. A WebGL2 path that costs about what WebGPU's does, and figures from phones.

## Recommendation

Do not ship TAA for 1.0, neither as a default nor as an option on any preset. Keep the anti-aliasing presets as they are: FXAA on Low and MSAA 4x from Medium up.

- In the Creek, TAA swaps shimmer for blur and smear that are easier to see than the shimmer it removes. The animated crops show it most in the near grass.
- It adds flicker to still scenes with thin lines, which MSAA draws without any.
- Its cost on WebGL2 is too high for the path that phones without WebGPU draw.

Do not add MSAA + FXAA as a preset either. It trades shimmer for softness and moves no closer to the reference. A later task can offer it as an anti-aliasing mode for foliage-heavy scenes if the owner wants that choice.

If TAA comes back after 1.0, build it as TAA over MSAA on WebGPU, for High and Ultra only. Do the four items under "Trade-offs" first. Then measure it again with these sequences, and on phones. On this Mac it should cost about 0.3 ms in the Creek and 1 to 2 ms in a light scene.

The prototype stays on the branch `proto/m2-ex18-taa`. Its capture page, thin scene, analysis and fixed-step clock can come back with it.

## Decision

The owner ruled on 11 October 2026:

- TAA does not ship for 1.0, neither as a default nor as an option on any preset.
- The anti-aliasing presets stay as they are: FXAA on Low, and MSAA 4x from Medium up.
- Per-object motion vectors move before 1.0, as task M2-EX25. Every moving, bending and skinned surface writes them, the grass's wind among them. They are the first of the four items under "Trade-offs".
- TAA can come back on top of those motion vectors, once the other three items are done. Then it is measured again with this record's sequences, and on phones, as the recommendation says.

## Consequences

- No change to the engine, its presets or its docs. `post.set({ taa })` and `post.set({ msaaFxaa })` exist only on the prototype branch.
- Screen-space reflections, which wait on TAA for a temporal pass, keep their blur by roughness instead.
- The Creek's grass keeps MSAA with alpha to coverage, and its far-bank shimmer stays. A look task can thin or soften the far grass if the owner finds the shimmer too strong.

## Addendum, 15 October 2026: M3-A11 rules on TAA

The owner ruled on 15 October 2026 ([D-179](D-179-technique-rulings-2026-10-15.md), rulings 15, 16 and 24). M3-A11, the second look at a temporal resolve, decides TAA for 0.1.0. If it says no, TAA is dropped, not left for after 1.0, and the three.js mapping says so. Two techniques hang on the same answer:

- many lights at a fixed cost: prototyped in M3, shipped only with a temporal resolve;
- a temporal upscaler that keeps MSAA: in M4 with a temporal resolve.

Without a temporal resolve, both are dropped.

## Addendum, 21 October 2026: the second look refuses TAA

M3-A11, the second look at a temporal resolve, decided on 21 October 2026 ([D-200](D-200-temporal-resolve.md)). The resolve does not ship for 0.1.0. Its prototype drew the scene live on WebGPU, but a captured frame was black, which breaks image tests, hold mode and the command-line screenshot, and a live toggle on WebGPU destroyed a motion target or the scene depth in a flight. Its cost in the Creek at 1080p was 0.3 to 1.3 ms on WebGPU and 2.8 to 9.1 ms on WebGL2. The figures of this record's quality bar could not be measured from black captures.

So TAA is dropped, not deferred, as [D-179](D-179-technique-rulings-2026-10-15.md)'s ruling 24 asks. The presets keep FXAA on Low and MSAA 4x from Medium up. The three.js mapping says that TAA is not planned. The prototype's code was not kept, as a "no" lands the measurement and the record alone.
