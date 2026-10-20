# D-197: See-through surfaces never take the color of what stands in front of them

Status: decided by the engine helper of M2-EX8 on 20 October 2026, for the owner's review. Built: the depth code in the copy of the opaque color, the check in the surfaces that let light through, and the `transmission-in-front` image test. Date: 2026-10-20. Task: M2-EX8.

Summary: The copy of the camera's opaque color keeps a code of the opaque depth's distance in its alpha. Where a bent ray lands on an opaque surface in front of the see-through surface, the surface samples its own pixel instead. The Creek's near-bank flowers no longer leave dim copies in the stream. Where the HDR scene color has no alpha, the copy takes 16-bit floats while such surfaces draw. That costs 19.66 MB more at a 2,560 x 1,440 canvas.

## Question

On 20 October 2026 the owner saw dim copies of the near-bank flowers in the Creek's stream, just past the real flowers, as the camera turned. Why does the water show the color of a flower in front of it? How does the engine stop it without a new texture in the surface shaders?

## Rule

- Author intent over three.js's pixels ([D-52](D-52-intent-parity.md)). Water shows what lies behind or under it, never an object between it and the camera.
- No new texture binding in the lit shader. It already uses WebGPU's default of 16 sampled textures in a fragment stage, which is why the parallax builds give up the screen reflections.
- Both GPU paths and every scene color format follow the same rule.
- The shaders grow little, and only the surfaces that let light through pay.

## The finding

The Creek's water is a custom material with `transmission: 1` and a thickness of up to 0.62 m (`examples/showcase/creek/water.ts`). The engine follows three.js's `getIBLVolumeRefraction`. It bends the view ray into the volume and follows it for the thickness. It projects the exit point onto the screen, and samples the copy of the opaque color there (`copied_light` in `lib/refraction.wgsl`). Nothing checked depth.

Looking across the stream, the bent ray goes down into the water. Its exit point projects lower on the screen than the surface's own pixel. Just past a flower on the near bank, that point lands on the flower. The water then showed the flower's color, in a band as tall as the bend, which moved as the camera turned. three.js draws the same band. A true reflection of the flowers falls under the near bank, out of sight, and the planar reflection pass is not the cause.

## Options

| Option | Verdict |
| --- | --- |
| A: the copy pass reads the opaque depth and keeps a code of its distance in the copy's alpha, which the surface shader samples already | Chosen |
| B: the depth in a second layer of the copy's texture array | Rejected. It needs as much memory as the 16-bit alpha below, and the frame would make its mip levels for nothing |
| C: the scene depth as a texture of its own in the surface shaders | Rejected. It is one sampled texture past WebGPU's default limit |
| D: no change, as three.js draws it | Rejected by the owner's look check |

The copy's alpha had no reader. Screen-space reflections share the copy ([D-134](D-134-screen-space-reflections.md)), but they read its color alone. The mip levels average the alpha, and only the first level's alpha is read.

### The code

The copy pass reads the scene depth as the opaque pass and the debug lines leave it. That depth holds the masked surfaces, such as the Creek's flowers, which the depth prepass leaves out. On WebGPU a multisampled depth gives its sample 0, through the copy's DEPTH_MULTISAMPLED builds and a layout of their own. WebGL2's backend binds a copy of one sample, as it does for every multisampled depth that a shader reads.

The code is `saturate(-log2(depth) / 16)` (`distance_code` in `lib/depth.wgsl`). The engine's reversed depth halves as the distance doubles. So the code gives the same share of its steps to every distance, up to 65,536 times the near plane's. One 8-bit step is about 4% of the distance. The code needs no camera values, so the copy pass reads only the depth. The surface works out the same code from its own fragment depth.

### The tolerance

An opaque surface counts as in front when its code is smaller than the surface's own by more than a tolerance. The tolerance is one step of the alpha, plus about 2% of the distance for where the two surfaces meet. That gives 1.5 / 255 on the 8-bit path, whose sRGB copy has 8-bit alpha: about 6.7% of the distance. The HDR path's copy has 16-bit float alpha, so its tolerance is 0.5 / 255 + 1 / 2048: about 2.7%.

### The fallback

The surface reads the code at the landing pixel and at the four pixels beside it, and takes the nearest. The filter reads those pixels too. A multisampled edge pixel can also hold the front surface's color with the back surface's depth. The test's first image read one pixel, and kept a one-pixel magenta outline there.

Where the nearest code stands in front, the surface samples its own pixel, unbent. The depth test guarantees that the opaque surface there lies behind it. That pixel can show another part of the scene than its bent neighbors, so the fallback has a seam. In the Creek both sides show the stream's bed.

### The copy's format

On the HDR path the copy had the scene color's format. WebGPU's default HDR scene color is `rg11b10ufloat`, which has no alpha. With that scene color, the copy is now `rgba16float` while some surface that lets light through wants the copy. A copy that only screen-space reflections read keeps `rg11b10ufloat`, as they read its color alone. The 8-bit path's sRGB copy and an `rgba16float` scene color have alpha already, so they cost nothing more. The copy has the canvas's size at every render scale, with its whole chain of mip levels. The wider copy takes 4 more bytes for each texel of the chain:

| Canvas | Copy in `rg11b10ufloat` | Copy in `rgba16float` | More |
| --- | --- | --- | --- |
| 1,920 x 1,080 | 11.06 MB | 22.12 MB | 11.06 MB |
| 2,560 x 1,440 | 19.66 MB | 39.32 MB | 19.66 MB |

A depth texture of its own, one channel at half size, would take about 2 MB at 2,560 x 1,440. It would be a seventeenth sampled texture in every lit build with maps. Their frame group holds eight, and their maps eight more. That passes WebGPU's default limit of 16, so the copy's alpha holds the code instead.

The copy samples the scene depth. Ambient occlusion, contact shadows, screen-space reflections, soft particles and decals sample it already. In a frame with none of them, the camera's depth can no longer share a texture with another view's depth of the same shape.

## Data

**The new image test.** `transmission-in-front` puts a magenta post on a near bank, in front of clear water with a volume 0.6 m thick over a striped bed. Without the check, the water just past the post's top would take the post's color. On the Mac's GPU (Chrome, 20 October 2026), the first image after the check showed no magenta copy in the water. It kept a one-pixel magenta outline, up to 34 steps of red, around the area that fell back. Reading the codes beside the landing pixel too removed it. At most 13 steps of red remain, in the corner pixel. The references show the water past the post as the background straight behind it.

**An image that moved, and why.** `transmission-water` had the same leak. Its picture showed a band of the banks' own green in the water just past each bank's top. The new picture shows the stream's bed there. On the Mac's GPU 0.93% of the pixels changed on WebGPU, 0.63% in compatibility mode and 0.94% on WebGL2, against the limit of 0.1%. On SwiftShader 0.93%, 0.63% and 0.95% changed, along the same bands. Its references moved in both sets. The other `transmission*` tests and every `ssr*` test kept their pictures: 45 of 45 passed on the Mac's GPU on the final code. On SwiftShader, the `transmission*`, `ssr-*`, `alpha-*`, `ao-*`, `contact*`, `lod-fade*` and `translucency*` tests ran too: 137 of 146 passed, and the other 9 were the three tests above.

**Size.** `bun tools/build-wasm.ts --check-size --base 199160dd8` measured the fixes against the commit before them, after Brotli. The 12 start shader files grew by 10 to 239 bytes each, at most 0.8%. The 12 tables of glass's shared paragraphs grew by 320 to 343 bytes each. That is 9% for GLSL, and 25 to 29% for WGSL, whose tables are smaller. One other file grew 2.1%, and every other file less than 2%. The two WebAssembly files grew by 92 bytes together. The first build of the fixes grew 454 files past the check's 2%. Its new names renumbered the names of the code around them in every build ([Implementation notes](../implementation-notes.md#new-shader-code-keeps-the-shared-paragraphs-shared)).

**The whole manifest on the Mac's GPU.** `bun run test:images` ran at a load of 60 to 130 on 20 October 2026. 1,153 tests passed. Of the 171 that failed, 6 were the new tests with no reference yet, 3 were `transmission-water` and 3 were `demo-creek`. The other 159 ran out of time at that load. A second run of all 171 passed 163, and a third run passed the 5 that ran out of time again. Only `demo-creek` still differs. Its references move with that day's scenery work, so they are made with it.

## Decision

Option A. The copy keeps the opaque depth's distance code in its alpha. A surface that lets light through samples its own pixel where its bent ray lands on an opaque surface in front of it.

## Consequences

- Code: `transmission_copy.wgsl` reads the depth and writes the code, `lib/depth.wgsl` has `distance_code`, and `lib/refraction.wgsl` checks the codes and falls back. `lit.wgsl` passes the fragment's position. `crates/null3d-render/src/transmission.rs` binds the scene color and depth. `frame_graph.rs` declares the depth read and picks the copy's format. The layout table in `null3d-gpu` and `pipelines.ts` add the multisampled layout.
- Docs: Transmission on the Materials page, and the `mat-transmission` mapping entry, which names the difference from three.js. The porting skill's materials table says the same.
- Tests: the image test `transmission-in-front`, with references in both sets, and the frame graph's test that the copy reads the depth into a target with alpha.
