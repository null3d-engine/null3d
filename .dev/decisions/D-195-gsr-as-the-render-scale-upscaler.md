# D-195: GSR 1 scales the render corner up below the whole canvas's scale

Status: decided and built. Task: M2-F10.

Summary: Below the whole canvas's render scale, the final pass scales the render corner up with GSR 1 instead of a bilinear filter. GSR measured 0.77 ms faster than the bilinear pass on an iPhone and within 0.01 ms on the phones that tie, with a closer image in every case. The shader is straight-line code, because one phone's driver stalls while linking the looped form.

## Question

Which filter should scale the render corner up to the canvas when the render scale is below 1, and how must its shader be written?

## Rule

The upscaler meets the rule when it costs at most 0.2 ms a frame more than the bilinear pass on any measured phone, and moves the image closer to the scale-1 reference by SSIM and by mean absolute error.

## Data

| Measure | Bilinear pass | GSR 1 | Device and browser |
| --- | --- | --- | --- |
| Frame cost, mip 0 | 1.074 ms | 0.307 ms | iPhone 17, Safari 26.5, WebGL2 |
| Frame cost, mip 1 | 1.136 ms | 0.320 ms | iPhone 17, Safari 26.5, WebGL2 |
| Difference from the bilinear pass | 0 | +0.00275 ms | Galaxy S25, Chrome, WebGL2 |
| Difference from the bilinear pass | 0 | +0.007 ms | Pixel 11, Chrome, WebGL2 |
| Difference from the bilinear pass | 0 | +0.007 ms | Pixel 9, Chrome, WebGL2, unrolled form only |
| SSIM at mip 0 | 0.9532 | 0.9552 | iPhone 17, Safari 26.5 |
| SSIM at mip 0 | 0.9536 | 0.9556 | Galaxy S25, Chrome |

How the data was produced: `bench/probes/f10-upscalers`, run through the cloud device runner. The page draws a fixed scene, scales it with each candidate, and measures frame cost and image distance. The Pixel 9 stalls while linking the form of the shader that indexes arrays inside loops; the form that names every tap links and completes in five seconds.

## Decision

GSR 1 is the upscaler below the whole canvas's scale. It is the only candidate that meets the rule on every phone: the iPhone gains most, the phones that tie stay inside the band, and the image is closer everywhere. The pass writes the taps and the weights as straight-line code inside a loop of zero or one rounds, so no array or index reaches a driver, and a software GPU still skips the work at the whole canvas's scale.

## Consequences

- `crates/null3d-shaders/wgsl/final.wgsl` holds the GSR path; the second step of the two-step pass uses it at every render scale below 1. There is no setting: every preset that lets the scale drop gets it.
- The pass costs twelve texel reads and one edge vote for each canvas pixel that covers a smaller corner. The bilinear filter costs four reads.
- `docs/concepts/post-processing.md` and `docs/concepts/quality-presets.md` describe GSR 1, and the three.js port reference names it for FSR 1.
- The references of pictures that tests take below a render scale of 1 are drawn with GSR 1.
- A phone driver that stalls on the looped and array form of a shader is a real hazard for any shader. The straight-line rule here is the precedent.
