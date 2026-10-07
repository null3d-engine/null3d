# D-40: Two-phase GPU occlusion culling on WebGPU

Status: method decided, 2026-10-04; off on every preset (D-22); the stall between passes open for the owner; the iPad's timings pending. Task: M2-I1.

Summary: Marked occluders that showed last frame and look large draw their depth at one sample per pixel. A compute pass builds a depth pyramid in a storage buffer, and a second culling phase tests every object against it, so the image equals culling without it and no object shows a frame late. Its shaders load on first use, once a scene marks an occluder.

## Question

How does the WebGPU path skip opaque objects that other objects hide, without a visible error? Where does the depth it tests against come from, and which objects hide others? What does it cost? [D-22](D-22-occlusion-presets.md) records the preset rows and their timings; this record covers the method.

## Rule

- The image with occlusion culling equals the image without it, pixel for pixel. That holds on the Mac's GPU and on SwiftShader, in core WebGPU and compatibility mode, with MSAA and with one sample.
- No object that shows draws a frame late, even when the camera turns a quarter turn in one frame.
- It stays within WebGPU's default limits and compatibility mode's (AGENTS.md hard rule 6), uses no optional feature, and keeps first-instance at 0 (hard rule 8).
- No per-frame allocation (hard rule 1).
- A scene that does not use it pays nothing for it.
- A preset turns it on only where it saves more GPU time than it costs on that preset's devices (D-22).

## Options

| Option | How | Why not, or why |
| --- | --- | --- |
| (a) Two phases in each frame | Keep what showed last frame, build a depth pyramid from its depth, test everything against it, draw what shows. The method of Haar and Aaltonen's "GPU-Driven Rendering Pipelines" (SIGGRAPH 2015) and of Arseny Kapoulkine's Niagara renderer | Exact: the pyramid holds only depth drawn in the same frame. The plan (6.6) names it. Three ways to draw the first phase follow |
| (a1) Every object that showed last frame draws in color; a second opaque pass draws the rest over it | The published form | Built first. With MSAA the first pass stores 4 samples of color and depth per pixel for the second pass to load, where one pass keeps them in tile memory. S1 and S3 took about 0.55 ms more GPU time per frame on the Mac, 21% to 28% |
| (a2) Every object that showed last frame draws its depth alone, into a target of its own, at the scene's samples; then one opaque pass draws what shows | The occluders' pass uses the depth prepass's pipelines | Built second. Drawing every visible object twice made S1's GPU time 88% longer, and reading 4 depth samples per pixel cost the pyramid 1.2 ms |
| (a3) As (a2), but only objects that the sketch marks as occluders, and that look large on the screen, draw their depth, at one sample per pixel; a frame with none culls once, as without occlusion culling (chosen) | `setOccluder(true)` and the `occluder` option, the same marks as WebGL2's software culling (D-41) | An unmarked scene costs nothing: S1 and S3 equal main's GPU time. A sketch marks objects one way for both paths |
| (b) One phase against last frame's depth | Test against the pyramid of the frame before, moved to the new camera | Objects that come out from behind an occluder show a frame late, and a fast turn misses many. Moving the depth to the new camera leaves holes |
| (c) Occlusion queries | One query per object, read back a frame or more later | A readback per object, results a frame or more late, and a CPU loop over objects that GPU culling avoids |
| (d) A pyramid from a full depth prepass | Draw every object's depth first, then test | Draws every object's vertices twice, the hidden ones too. The prepass made S2's GPU time 45% longer on the Mac (M1-A7) |

## How it works

- Each camera view keeps a history: one word per source, 1 when the source showed in the view's last frame. The history sits after the view's indirect draws, in their buffer. The culling group binds eight storage buffers, the most that every device allows a shader stage. A ninth binding for the history made Chrome reject the pipeline layout.
- Each source's entry in the bucket table carries an occluder bit, bit 22, below the cell index. So a layout holds at most 4,194,304 buckets, and fails with the error of too many sources past that. A change of an object's occluder mark marks the object changed in the core, as a change of its bounds does. The builder then rewrites its entry from the next frame, with no rebuild.
- The builder counts the shown occluders. A frame with none runs the plain culling pipeline into the draws that the opaque pass reads. It records no occluders' pass, pyramid or second phase. A view that does not cull in two phases binds a 16-byte placeholder where the pyramid goes.
- Otherwise the first phase (`early` in `cull.wgsl`) keeps the marked sources in view whose history is 1. Each must look large: its bounds span at least a sixteenth of the render size's longer side, or it reaches the camera's plane. It counts them in the pyramid's first word, and in the first set of indirect draws.
- The occluders' pass draws their depth alone, into a depth target of one sample per pixel. It uses the depth prepass's pipelines: the depth template's prepass build, which clips at the near plane as shading does. Masked, blended and custom materials have no such pipeline, so they hide nothing, which keeps the test conservative.
- The depth pyramid is one storage buffer: a word that counts the frame's occluders, then each level. Level 0 is half the render size each way, rounded up, and each level halves the one before, down to one texel. Each texel holds the farthest depth under it, the smallest value in reversed depth. A buffer, not a texture with mip levels, because the draw list binds whole textures, and every level reads the one before it.
- Level 0 reads the occluders' depth as a float texture (`texture_2d<f32>`). Compatibility mode refuses `textureLoad` on depth texture types, but allows depth formats bound as float textures. So compatibility mode needs no copy of the depth, which the task first planned.
- The occluders' depth has one sample, at each pixel's center, where the scene may draw with 4. So each texel of level 0 keeps the farthest of the 4 x 4 pixels around its own 2 x 2. Take an object that shows at one sample of a pixel whose center an occluder covers. It lies within a pixel of a center that the occluders leave open. Only a gap between occluders thinner than a pixel could hide such a sliver.
- One dispatch builds up to four levels. Each workgroup has 8 x 8 threads, and each thread builds one texel of the batch's first level. The workgroup then builds the next three levels of its tile in workgroup memory. At 1280 x 720 that is 3 dispatches for 10 levels. Every workgroup returns at once in a frame with no occluder.
- The second phase (`late`) tests every source in view against the pyramid and writes its history. It counts the visible ones in the second set of indirect draws, after the first, which the opaque pass draws. It writes over the bucket slices of the compacted instances, which the occluders' pass has finished reading.
- The test: interval arithmetic on the rows of the view-projection matrix gives the sphere's bounds on the screen and its nearest depth. It holds for perspective and orthographic lenses, and only makes the bounds larger. A sphere that reaches the camera's plane or the near plane never hides. The level is the first whose texels are at least as wide as the bounds, so at most 2 x 2 texels cover them.
- The render graph gained one rule for this. A pass that reads a resource "so far" runs after the writers declared before it, and before those declared after it. The occluders' pass reads the compacted instances that way, before the second phase writes them again. Every other read still runs after the last writer.
- Shadow cascades and tiles cull with the frustum test alone. See-through objects draw from the transparent pass's sorted rows, and hide nothing. Instance rows are never occluders.
- It does not run with the depth prepass, which every preset leaves off.

## The stall between passes

In the room scene with 96-segment spheres, with MSAA, Chrome's GPU timer gave these times per frame. They are medians of each part, so they do not add up exactly.

| Part of the frame | Culling off | Culling on |
| --- | --- | --- |
| Before the first pass | 0.26 ms | 1.31 ms |
| The occluders' pass | none | 0.10 ms |
| The compute pass of the pyramid and the second phase | none | 0.20 ms |
| The opaque pass | 0.92 ms | 0.39 ms |
| The final pass | 0.56 ms | 0.33 ms |
| Between passes | 0.36 ms | 2.56 ms |
| The whole frame | 2.16 ms | 3.70 ms |

What is known:

- The culling does its job: the opaque pass is 0.53 ms shorter, and the passes that culling adds take 0.30 ms.
- The extra time falls outside every pass: about 1 ms more before the first pass, and about 2.2 ms more between passes. A pipeline switch happens inside a pass, so it would count in the pass's own time. The time lies between command encoders instead.
- It is not the timer's rounding: its steps are 0.066 ms, and the gap is 3 ms.
- So the likely cause is a resource barrier. The frame with culling on has two more passes, and two more hand-overs between a render pass and a compute pass. A compute pass reads the occluders' depth, which a render pass wrote. The opaque pass reads the second set of indirect draws, which a compute pass wrote. At each hand-over the browser's Metal backend can make the next pass wait until the one before ends. That fits the gap, but it is not measured. A Metal frame capture of the room scene would show which hand-over waits. A later run on a quiet GPU points to another cause: see the addendum below.
- The time before the first pass also grows, from 0.26 to 1.31 ms. That part holds the frame's uploads, and with culling on also the previous frame's tail, if its passes are still running.

## Data

The tests on 2026-10-04, Chrome 154 on the Mac (Apple M5 Max) and SwiftShader:

| Check | Result |
| --- | --- |
| The GPU occlusion page: six views of the room, each turned 65° to 180° from the one before, culled against unculled, at 320 x 180 and at 1280 x 720, with MSAA | 0 differing pixels in each view, on core WebGPU and in compatibility mode. At 320 x 180 SwiftShader gives the same |
| The same with FXAA | 4 to 38 differing pixels per view at 320 x 180. Two runs of FXAA without culling also differ by up to 37 pixels, so this is not from culling |
| The room's hold images, culled against unculled | Equal on SwiftShader; equal on the Mac with MSAA, and within 91 pixels of 230,400 with FXAA |
| Copies with `?occlusion=on` of the room (MSAA and FXAA), shadows, transparency, the orthographic camera and S2 | Each matched its test's references, on core WebGPU and in compatibility mode |
| The renderer's mock backend and the no-allocation tests, with shadows, two views, render scale changes, and occluders marked and unmarked | Valid lists; no allocation in steady frames |

The cost and the saving are in [D-22](D-22-occlusion-presets.md).

## Decision

Option (a3). Marked occluders that look large draw their depth at one sample per pixel. A pyramid in a storage buffer holds it, and the history sits after the indirect draws. It meets the image rule on every WebGPU tier tested with MSAA. It stays off on every preset until a device shows that it saves more than it costs (D-22).

## Consequences

- The preset table has the `gpuOcclusion` row, off on every preset. `createEngine` has the `gpuOcclusion` option, and `?occlusion=on|off` sets it on WebGPU and `softwareOcclusion` on WebGL2.
- `concepts/culling`, `concepts/quality-presets` and `api/objects` describe it.
- The culling stage is full. Its group binds 8 storage buffers: the matrices, the bucket table and records, the compacted instances, the indirect draws with the history, the layer table, the cell order and the pyramid. That is the most that every device allows one shader stage, compatibility mode included. A feature that culls with more data must share one of these buffers, as the history shares the indirect draws', or read it from a texture.
- The hidden share comes from the room's geometry (`hiddenShare` in `bench/scenes/room.ts`), not from a count on the GPU. The draw list has no buffer readback until M2-D6 adds one. A readback of the instance counts would let `engine.measure` report what it hides on WebGPU too, in `occludedEntries`.
- Safari 26 encodes a render bundle with indirect draws again at every `executeBundles` (5.9). The occluders' pass adds one bundle per camera view, so Safari before 27.2 pays that cost twice for the camera. The iPad run measures it.
- FXAA images vary by a few dozen pixels from run to run, with or without culling. The cause is not known.
- Later options: find and remove the stall between passes. Test shadow casters against a light's own pyramid. Build every level in one dispatch, as AMD's single-pass downsampler does.

## Addendum, 2026-10-04: culling saves time on a quiet GPU

The tables above and D-22's room figures come from a Mac that other helpers' browser tests shared. A later run measured the room scene again, with 96-segment spheres, MSAA and 1280 x 720, in Chrome 154 on the same Mac, with precise timestamps.

| Run | Culling off | Culling on |
| --- | --- | --- |
| Nothing else heavy on the GPU (3 runs, 3 rounds each) | 1.64 ms | 1.04 ms (37% less) |
| A second Chrome drawing a heavy shader, 4 passes per frame (3 rounds) | 1.25 ms | 1.49 ms (19% more) |
| The same load, 1 round of 8 s | 1.49 ms | 2.09 ms (40% more) |

- On the quiet GPU no gap shows between passes, and culling pays: the opaque pass falls from 1.48 to 0.65 ms.
- Under load each pass runs faster, as the GPU's clock rises, but the frame with culling grows between passes. That is the pattern of the table above.
- Images match pixel for pixel in all six views in every run.

So the stall is probably not a barrier in the engine's frame. Other programs' GPU work runs in the gaps between its passes. Culling makes a chain of 5 dependent passes in place of 3, so a frame has more points where it waits behind other work. The GPU timestamps count that wait. A Metal trace under load, which would show whose work fills the gaps, is not read yet. Safari's WebGPU on a quiet Mac is not measured yet.

The preset rules for it were decided in [D-53](D-53-technique-defaults.md) on 4 October 2026:

- Desktops: High and Ultra turn GPU occlusion culling on only if a second run on a quiet Mac saves time, and a run with another program loading the GPU loses no more than 5%. Today's loaded runs lose 19 to 40%, so it stays off for now.
- Android: it stays off until prototype G1 passes on the GPUs whose drivers Bevy and Unity block for GPU culling. These are Adreno 730 and older, Mali drivers before r48, and the PowerVR GPUs of the Pixel 10 and 11.
