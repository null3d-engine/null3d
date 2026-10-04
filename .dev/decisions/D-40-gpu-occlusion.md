# D-40: Two-phase GPU occlusion culling on WebGPU

Status: decided for the method; the iPad's timings pending. Date: 2026-10-04. Task: M2-I1.

## Question

How does the WebGPU path skip opaque objects that other objects hide, without a visible error? Where does the depth it tests against come from? What does it cost, and on which presets does it run? [D-22](D-22-occlusion-presets.md) records the preset rows and their timings; this record covers the method.

## Rule

- The image with occlusion culling equals the image without it, pixel for pixel. That holds on the Mac's GPU and on SwiftShader, in core WebGPU and compatibility mode, with MSAA and with one sample.
- No object that shows draws a frame late, even when the camera turns a quarter turn in one frame.
- It stays within WebGPU's default limits and compatibility mode's (AGENTS.md hard rule 6), uses no optional feature, and keeps first-instance at 0 (hard rule 8).
- No per-frame allocation (hard rule 1).
- A preset turns it on only where it saves more GPU time than it costs on that preset's devices (D-22).

## Options

| Option | How | Why not, or why |
| --- | --- | --- |
| (a) Two phases in each frame | Keep what showed last frame, build a depth pyramid from its depth, test everything against it, draw what shows. The method of Haar and Aaltonen's "GPU-Driven Rendering Pipelines" (SIGGRAPH 2015) and of Arseny Kapoulkine's Niagara renderer | Exact: the pyramid holds only depth drawn in the same frame. The plan (6.6) names it. Two ways to draw the first phase follow |
| (a1) The first phase draws in color, a second opaque pass draws the rest over it | The published form | Built first and measured: with MSAA the first pass must store 4 samples of color and depth per pixel for the second pass to load, where one pass keeps them in tile memory. S1 and S3 took about 0.55 ms more GPU time per frame on the Mac, 21% to 28% |
| (a2) The first phase draws depth alone into a target of its own, then one opaque pass draws every visible object (chosen) | The occluders' pass uses the depth prepass's pipelines | The opaque pass stays as it is without occlusion culling. The cost is a depth-only draw of last frame's visible objects, which the measurements in D-22 show is smaller |
| (b) One phase against last frame's depth | Test against the pyramid of the frame before, moved to the new camera | Objects that come out from behind an occluder show a frame late, and a fast turn misses many. Moving the depth to the new camera leaves holes |
| (c) Occlusion queries | One query per object, read back a frame or more later | A readback per object, results a frame or more late, and a CPU loop over objects that GPU culling avoids |
| (d) A pyramid from a full depth prepass | Draw every object's depth first, then test | Draws every object's vertices twice, the hidden ones too. The prepass made S2's GPU time 45% longer on the Mac (M1-A7) |

## How it works

- Each camera view keeps a history: one word per source, 1 when the source showed in the view's last frame. The history sits after the view's indirect draws, in their buffer. The culling group binds eight storage buffers then, the most that every device allows a shader stage. A ninth binding for the history made Chrome reject the pipeline layout.
- The first phase (`early` in `cull.wgsl`) culls as before, keeps only the sources whose history is 1, and counts them in the first set of indirect draws.
- The occluders' pass draws their depth alone, into a depth target of the scene depth's shape and samples. It uses the depth prepass's pipelines: the depth template's prepass build, which clips at the near plane as shading does. Masked, blended and custom materials have no such pipeline, so they hide nothing, which keeps the test conservative.
- The depth pyramid is one storage buffer, level after level. Level 0 is half the render size each way, rounded up, and each level halves the one before, down to one texel. Each texel holds the farthest depth of the 2 x 2 texels under it, the smallest value in reversed depth. A buffer, not a texture with mip levels, because the draw list binds whole textures, and every level reads the one before it.
- One dispatch builds up to five levels. Each workgroup of 8 x 8 threads builds a tile of 16 x 16 texels of the first level. It builds the tile's texels of the next four levels in workgroup memory. At 1280 x 720 that is 3 dispatches for 10 levels. One dispatch per level took about 0.39 ms on the Mac, as each small dispatch waits for the one before it.
- Level 0 reads the depth as a float texture: `texture_2d<f32>`, or with MSAA `texture_multisampled_2d<f32>`, keeping the farthest of the 4 samples. Compatibility mode refuses `textureLoad` on depth texture types, multisampled ones included, but allows depth formats bound as float textures. So compatibility mode needs no copy of the depth, which the task first planned.
- The second phase (`late`) tests every source in view against the pyramid and writes its history. It counts the visible ones in the second set of indirect draws, after the first. It writes over the bucket slices of the compacted instances, which the occluders' pass has finished reading. The opaque pass draws the second set.
- The test: interval arithmetic on the rows of the view-projection matrix gives the sphere's bounds on the screen and its nearest depth. It holds for perspective and orthographic lenses, and only makes the bounds larger. A sphere that reaches the camera's plane or the near plane never hides. The level is the first whose texels are at least as wide as the bounds, so at most 2 x 2 texels cover them.
- The render graph gained one rule for this. A pass that reads a resource "so far" runs after the writers declared before it, and before those declared after it. The occluders' pass reads the compacted instances that way, before the late phase writes them again. Every other read still runs after the last writer.
- Shadow cascades and tiles cull with the frustum test alone. See-through objects draw from the transparent pass's sorted rows, and hide nothing.
- It does not run with the depth prepass, which every preset leaves off.

## Data

The tests on 2026-10-04, Chrome 154 on the Mac (Apple M5 Max) and SwiftShader:

| Check | Result |
| --- | --- |
| The occlusion test page: six views of a room, each turned 65° to 180° from the one before, culled against unculled, at 320 x 180 and at 1280 x 720 | 0 differing pixels in each view, on core WebGPU and in compatibility mode |
| The image test manifest at the High preset, which turns occlusion culling on in core WebGPU | Every WebGPU test matched its references, which were made without it |
| Copies with `?occlusion=on` of the occlusion scene (MSAA and FXAA), shadows, transparency, the orthographic camera and S2 | Each matched its test's references, on core WebGPU and in compatibility mode |
| The renderer's mock backend and the no-allocation tests, with shadows, two views and render scale changes | Valid lists; no allocation in steady frames |

The cost and the saving are in [D-22](D-22-occlusion-presets.md).

## Decision

Option (a2), with the pyramid in a storage buffer built five levels per dispatch, the depth read as a float texture, and the history after the indirect draws. It meets the image rule on every WebGPU tier tested, with MSAA and with one sample.

## Consequences

- The preset table has the `gpuOcclusion` row, `createEngine` the `gpuOcclusion` option, and the page the `?occlusion=on|off` switch. WebGL2 keeps it false; M2-I2's software culling serves that path.
- `concepts/culling` and `concepts/quality-presets` describe it.
- The hidden share comes from the occlusion scene's geometry (`hiddenShare` in `bench/scenes/occlusion.ts`), not from a count on the GPU. The draw list has no buffer readback until M2-D6 adds one. A readback of the instance counts would let the stats overlay show what occlusion hides.
- Safari 26 encodes a render bundle with indirect draws again at every `executeBundles` (5.9). The occluders' pass adds one bundle per camera view, so Safari before 27.2 pays that cost twice for the camera. The iPad run measures it.
- Later options: test shadow casters against a light's own pyramid. Build every level in one dispatch, as AMD's single-pass downsampler does, if three dispatches still cost much on phones.
