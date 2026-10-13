# D-167: Two-step output below scale 1, with GSR 1: the design, and why it is not built yet

Status: proposed (design recorded, the change not built), 13 October 2026. Task: M2-F10.

Summary: Below render scale 1, today's final pass runs four tone curves for each canvas pixel. It
also runs four sRGB encodes and four dither hashes, and it draws no FXAA. The planned fix splits
the pass in two. Step 1 runs the output transform and FXAA at the render size into an 8-bit
target. Step 2 upscales into the canvas, with the colour table, the vignette and the dither last.
This record holds the design read from the code, the questions still open, and the prototype that
decides the upscaler. Qualcomm's own figures put GSR 1 at 0.14 to 0.23 ms over a bilinear upscale
on Snapdragon 888 to 8 Gen 2 phones.

## Question

How does the final pass below scale 1 avoid its work per canvas pixel, and gain anti-aliasing?
Which upscaler runs in its second step, and how does scale 1 stay unchanged?

## Rule

M2-F10's rule, from prototype P1: GSR 1 is within 0.2 ms of today's pass at scale 0.5 on the
Galaxy S25 with WebGL2 forced. The upscaled image must also be closer to the scale-1 image than
today's is. The prototype compares GSR 1, a bilinear upscale, an EASU with RCAS, and today's path.
It runs with the mip bias on and off, and with a nearest baseline at 0.5. The devices are the
iPad, the Mac and the cloud S25, Pixel 9 and Pixel 11. Design principle 1 adds the engine's rule:
nothing ships without the measurement.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| Tone curves, sRGB encodes and dither hashes a canvas pixel runs below scale 1 | 4, 4 and 4 | `final.wgsl`, the `fs` four-tap loop below `whole` |
| FXAA below scale 1 | Not drawn | the same, the `whole` test skips the smoothing path |
| Low's lowest render scale | 0.5 | `packages/engine/src/quality/presets.ts` |
| GSR 1 over a bilinear upscale | 0.14 to 0.23 ms | Qualcomm, `snapdragon-gsr`, `sgsr/v1/README.md`, recorded as S-15 |
| FSR 1 EASU and RCAS | 1.8 ms and 0.9 ms, iPhone 12, 1772x819 to 2532x1170 | atyuwen, 2021-08-25, recorded as S-15 |

How the data was produced: the final pass's four-tap loop and the preset table were read on the
branch's main. The upscaler figures come from Qualcomm's `snapdragon-gsr` repository at
`sgsr/v1/README.md` (SGSR 1.0.0) and atyuwen's 2021 note on optimizing FSR. The post-processing
study of 4 October 2026 records both as S-15. Prototype P1 has not run, so no engine figure exists
yet.

## Decision

The two steps are designed as follows, and are not built yet.

1. Step 1 draws at the render size, one texel per render pixel. It runs the output transform,
   which is the tone curve and the sRGB encode. It also runs FXAA and bloom. It writes an 8-bit
   display-colour target of the render size. The pass is today's `final.wgsl` with a render-size
   target. That is `Size::Scaled`, which the frame makes whole at the render scale. So the pass's
   `whole` test is true and the four-tap loop is skipped. A runtime settings flag tells the shader
   to use the render size for its frame and to leave out the dither.
2. Step 2 draws at the canvas size, reading step 1's target. It upscales, with the upscaler that
   prototype P1 picks (GSR 1 by default). Then it applies the colour table, the vignette, the
   dither and the outline, in that order. Its frame is the canvas. So it reuses the canvas-space
   code of today's pass for the vignette, the outline and the grading.
3. At scale 1 nothing changes. Step 1 is off, and the final pass reads the scene colour as today.
4. `sharpen` is an RCAS value, off by default. It runs after the upscale, and only after the
   bilinear or EASU choice, because GSR 1 sharpens itself. `SharpenNode` maps to it.

The split does not ship until prototype P1's phone figures meet its rule. The open questions below
are why it is held. The prototype must also answer them.

## Open questions

1. **Per-frame scale routing.** The graph's topology does not depend on the current render scale.
   Today's final pass handles any scale in one pass. The two-step needs the scale below 1 while its
   declaration depends only on the capability. That capability is true when the minimum render
   scale is below 1, so High counts at 0.75. The switch must then run each frame, in the role's
   draw test and in the final pass's binding. So the render-size target is allocated whenever the
   capability holds, even at scale 1. High would then hold a canvas-size 8-bit target at scale 1.
   The memory budget must allow that.
2. **Where the outline draws.** The plan puts the outline in step 1. But the outline's code frames
   a place with the canvas as its size and the render corner as its drawn part. Step 2 keeps that
   frame unchanged. Step 1, which draws at the render size, would need a render-size frame for the
   mask and the line's width. Step 2 is the cheaper fit, so this record keeps the outline there
   until the prototype shows otherwise.
3. **Bloom's frame.** Bloom reads the chain's base through a place and the base's drawn corner.
   Today that place is in canvas space, because the pass draws the canvas. In step 1 it is in
   render space. The base covers the same corner, so the read should not change. It must be
   checked against the base's corner before the split ships.
4. **Coverage against luma in alpha.** The plan stores luma in the alpha channel, as Filament does,
   for the upscaler to read. In null3D the alpha channel holds premultiplied coverage instead. A
   transparent canvas and the outline need that coverage. So storing luma there would break them.
   The upscaler should compute luma from the colour channels, which GSR 1 can do.
5. **RCAS fused into the upscale.** `sharpen` is designed as a pass over the upscaled image. Fused
   into step 2 it reads the render-size texels instead. So its strength scaling against the scale
   ratio needs checking on the devices.

## Consequences

- When the split ships, two docs pages change with it. They are `concepts/quality-presets`, for the
  render scale, and `api/post`, for `sharpen`. The mapping's `SharpenNode` row changes too.
- Prototype P1 runs before the split ships. It covers the iPad, the Mac and the cloud S25, Pixel 9
  and Pixel 11, each with WebGL2 forced. Its images and GPU times decide the upscaler and the
  default.
- A test switch and a quality setting let the prototype and the image tests draw both paths before
  the split becomes the default.
