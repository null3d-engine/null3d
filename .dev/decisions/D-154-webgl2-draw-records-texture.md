# D-154: WebGL2's multi-draw shaders read their draw records from a texture

Status: decided. Date: 12 October 2026. Task: M2-R28.

Summary: The WebGL2 builds that draw many buckets in one multi-draw call read each draw's record from a texture, at the draw index. They read it from a uniform block before. On a Galaxy Tab A9+ (Adreno 619), 444 of 557 such programs then failed to link, with an empty log. Every device takes the texture, so there is one path. The renderer still binds the records as a uniform buffer range, and the WebGL2 backend copies the range into a texture on the GPU.

## Question

How should a WebGL2 vertex shader of a multi-draw build read its draw's record? Each call holds up to 256 draws, and each draw's record names its slice of the index list, its material and its data texture.

## Rule

- Every multi-draw program links on every tested device, the Adreno 619 among them.
- The engine never chooses by GPU name (hard rule 14).
- One path for every device wins over two, unless the one path costs measurable time.

## Data

The Galaxy Tab A9+ (SM-X216B, Adreno 619, Android 14, Chrome 152), BrowserStack's device cloud, 12 October 2026. A probe page linked the engine's failing programs in changed forms, each with its own fragment shader:

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

Over the first three of the nine parts of the shader check, 444 of 557 multi-draw programs failed as built and none failed with the texture. Small test programs that read a uniform table at `gl_DrawID` linked.

Cost, on a Google Pixel 9 in BrowserStack's cloud (Chrome 152, WebGL2, which links both forms). Each figure is the median of one 10-second run, 3 runs of each build, at the device's default preset. The render thread replays the draw list, so it pays for the copies. The phone gives no GPU timer on WebGL2, so the frame interval stands in for GPU time.

| Scene | Build | Render thread (ms) | Sketch thread (ms) | Frame interval (ms) |
| --- | --- | --- | --- | --- |
| S1 (100,000 objects, 3 draws) | Uniform block (main at 3f8825965) | 1.93, 2.04, 2.03 | 11.48, 11.46, 11.23 | 33.3 |
| S1 | Texture | 1.87, 1.91, 2.03 | 11.15, 11.17, 11.19 | 33.2 to 33.3 |
| S4 (the town, 111 draws) | Uniform block | 0.81, 0.85, 0.88 | 2.20, 1.97, 2.63 | 16.67 |
| S4 | Texture | 0.84, 0.92, 0.90 | 2.00, 2.76, 2.63 | 16.62 |

The runs are 20261012-150623-bench and 20261012-152539-bench. The texture's figures lie within the spread of the uniform block's, so it costs no time that these runs can find.

## Options weighed

- Multi-draw off where a test program fails to link at start-up. The small test programs linked on the Adreno 619, so such a test would pass there and the real programs would still fail. A test with a real program costs a link of a large program at every start. Multi-draw also saves draw calls on every device.
- A uniform block where it links and the texture elsewhere, chosen by a link test at start-up. The cost figures show nothing to gain, and two paths double the shader builds to test.
- The renderer writing the records into a texture. Each call would then need the row of its records, and WebGL2 has nothing per call to carry it. A bind group's dynamic offset already picks the call's range of the uniform buffer.
- A smaller table or another form of the index. Each failed.

## Decision

The `DRAW_INDEX` builds declare the draw records as a `texture_2d<u32>` at group 1, binding 0, and read the record at the draw index (`crates/null3d-shaders/wgsl/lib/mesh.wgsl`). The renderer binds the same uniform buffer range as before. When a program reads a texture at a slot where a bind group left a buffer range, the WebGL2 backend copies the range into an `RGBA32UI` texture of its own, one texel per 16 bytes, through `PIXEL_UNPACK_BUFFER`, and binds that. A copy stays until the buffer's next write, so the depth prepass, the opaque pass and the shadow passes share it. A copy that no draw read since that write takes a new range, so the textures stay as many as the ranges that draws read between two writes.

A unit test fails when a multi-draw vertex shader reads a uniform array at the draw index (hard rule 21). It found the shader build's own test shader doing so, which now reads a texture too.

Decided by the M2-R28 helper and team-lead, from the figures above, on 12 October 2026.
