# D-154: WebGL2's multi-draw shaders read their draw records from a texture

Status: decided by the M2-R28 helper and the team lead, from the figures below. Built: the multi-draw builds read their records from a texture on every device. Task: M2-R28.

Summary: The WebGL2 builds that draw many buckets in one multi-draw call read each draw's record from a texture, at the draw index. Read from a uniform block, 444 of 557 such programs fail to link on a Galaxy Tab A9+ (Adreno 619), with an empty log. Every device takes the texture at no measurable cost: the renderer binds a uniform buffer range, and the WebGL2 backend copies it into a texture.

## Question

How should a WebGL2 vertex shader of a multi-draw build read its draw's record? Each call holds up to 256 draws, and each draw's record names its slice of the index list, its material and its data texture.

## Rule

- Every multi-draw program links on every tested device, the Adreno 619 among them.
- The engine never chooses by GPU name (hard rule 14).
- One path for every device wins over two, unless the one path costs measurable time.

## Data

The Galaxy Tab A9+ (SM-X216B, Adreno 619, Android 14, Chrome 152), BrowserStack's device cloud. A probe page linked the engine's failing programs in changed forms, each with its own fragment shader:

| Form of the vertex shader | Result |
| --- | --- |
| As built: a uniform block of 256 records, read at `gl_DrawID` | Fails |
| Index masked or clamped to 255 | Fails |
| No extension: the index in a uniform of the engine's own | Fails |
| A table of 64 or 16 records | Fails |
| A loop that picks the record with a constant index | Fails |
| The index mixed with `gl_VertexID` or `gl_InstanceID` | Fails |
| No `invariant gl_Position`, or the material set to a constant | Fails |
| The plain build's one record, read at a uniform in place of 0 | Fails |
| A constant index | Links |
| The table in an `RGBA32UI` texture, read with `texelFetch` (chosen) | Links |

The first three of the nine parts of the shader check hold 557 multi-draw programs. With the uniform block, 444 of them fail. With the texture, none fails. Small test programs that read a uniform table at `gl_DrawID` linked.

Cost, on a Google Pixel 9 in BrowserStack's cloud (Chrome 152, WebGL2, which links both forms). Each figure is the median of one 10-second run, 3 runs of each build, at the device's default preset. The render thread replays the draw list, so it pays for the copies. The phone gives no GPU timer on WebGL2, so the frame interval stands in for GPU time.

| Scene | Build | Render thread (ms) | Sketch thread (ms) | Frame interval (ms) |
| --- | --- | --- | --- | --- |
| S1 (100,000 objects, 3 draws) | Uniform block (main at 3f8825965) | 1.93, 2.04, 2.03 | 11.48, 11.46, 11.23 | 33.3 |
| S1 | Texture | 1.87, 1.91, 2.03 | 11.15, 11.17, 11.19 | 33.2 to 33.3 |
| S4 (the town, 111 draws) | Uniform block | 0.81, 0.85, 0.88 | 2.20, 1.97, 2.63 | 16.67 |
| S4 | Texture | 0.84, 0.92, 0.90 | 2.00, 2.76, 2.63 | 16.62 |

The runs are 20261012-150623-bench and 20261012-152539-bench.

Cost on the owner's Mac (M5 Max, Chrome 155, WebGL2 with a GPU timer), from `bun run bench:run -- --compare` of main at 3ed5e6c61 against the texture at 78b705b4a. Each page ran 3 times per build, with 10 s of warm-up and 10 s measured, at the Medium preset. Each figure is the median, with the lowest and highest run. The change is the median of each round's change, as the tool gives it:

| Scene | Measure | Uniform block (ms) | Texture (ms) | Change |
| --- | --- | --- | --- | --- |
| S1 | Busiest thread | 7.245 (6.630 to 8.690) | 8.135 (6.750 to 8.735) | +0.5%, noise 7.9% |
| S1 | GPU time | 5.678 (5.588 to 5.738) | 5.682 (5.512 to 5.692) | -0.8%, noise 0.6% |
| S4 | Busiest thread | 0.610 (0.600 to 0.635) | 0.585 (0.525 to 0.652) | -4.1%, noise 7.4% |
| S4 | GPU time | 7.188 (7.061 to 7.273) | 7.137 (7.126 to 7.246) | -0.4%, noise 0.5% |

The tool judged every page the same. The pages' window got only 5 animation frames a second in that run, so the frame rates do not count, but the times per frame do. The run is `target/bench/20261012-201959-compare`.

On both devices, the texture's figures lie within the spread of the uniform block's. It costs no time that these runs can find.

## Options weighed

- Multi-draw off where a test program fails to link at start-up. The small test programs linked on the Adreno 619, so such a test would pass there and the real programs would still fail. A test with a real program costs a link of a large program at every start. Multi-draw also saves draw calls on every device.
- A uniform block where it links and the texture elsewhere, chosen by a link test at start-up. The cost figures show nothing to gain, and two paths double the shader builds to test.
- The renderer writing the records into a texture. Each call would then need the row of its records, and WebGL2 has nothing per call to carry it. A bind group's dynamic offset already picks the call's range of the uniform buffer.
- A smaller table or another form of the index. Each failed.

## Decision

The `DRAW_INDEX` builds declare the draw records as a `texture_2d<u32>` at group 1, binding 0. They read the record at the draw index (`crates/null3d-shaders/wgsl/lib/mesh.wgsl`). The renderer binds the records as a uniform buffer range. A program may read a texture at a slot where a bind group left a buffer range. The WebGL2 backend then copies the range into an `RGBA32UI` texture of its own, one texel per 16 bytes, through `PIXEL_UNPACK_BUFFER`, and binds that. A copy stays until the buffer's next write, so the depth prepass, the opaque pass and the shadow passes share it. A new range takes over a copy that no draw read since that write. So the textures stay as many as the ranges that draws read between two writes.

A unit test fails when a multi-draw vertex shader reads a uniform array at the draw index (hard rule 21). The shader build's own test shader reads a texture too.
