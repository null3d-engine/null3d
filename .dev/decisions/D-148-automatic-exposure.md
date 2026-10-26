# D-148: Automatic exposure

Status: decided. Built: automatic exposure ships in the engine on all three GPU paths. Task: M2-EX31.

Summary: `post.set({ autoExposure })` adapts the picture to the scene's brightness, from a GPU meter that reads the frame's linear color in the same frame. WebGPU meters with a compute histogram, WebGL2 and Low with a small downsample, and the final pass applies the factor before the vignette and tone curve. Its settings give the meter, center weight, speeds, limits and compensation; hold mode settles at once, and the feature costs nothing while off.

## Question

The showcase scenes walk from bright to dark places, such as a sunlit street into a dark hall. The owner pulled automatic exposure into this release ([D-142](D-142-more-techniques-before-1-0.md)). A fixed exposure shows one of the two well and the other badly. How does the engine adapt the exposure on WebGPU, its compatibility mode and WebGL2? Where does the factor apply, given that the core puts the camera's exposure into each light ([D-60](D-60-exposure-in-the-lights.md))? What do its settings look like, and what does each quality preset pay?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)): a luminance histogram where the GPU can build one, with a mean or percentile meter, center weighting, separate speeds for brighter and darker scenes, exposure limits and compensation.
- One look on all three GPU paths, with image references for each.
- Hold mode draws one frame, with no frame before it. Its image must be the adapted image, the same in every run.
- It works with bloom, every tone curve, custom effects, depth of field and the vignette.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1). Nothing costs anything while it is off, and its shaders load on first use ([D-56](D-56-first-use-shader-files.md)).
- Phones take a cheap path.

## Options

### Where the factor applies

| Option | What it does | Verdict |
| --- | --- | --- |
| A: read the meter back to the CPU, and let the core put the adapted exposure into the lights, as [D-60](D-60-exposure-in-the-lights.md) does with the camera's exposure | The scene draws at the adapted exposure, two or three frames late, as Unreal's pre-exposure does | Rejected. Hold mode draws one frame with no frame before it, so the readback never arrives in time, and its image would show the camera's exposure. A readback each frame also costs a promise or a fence each frame |
| B: the scene shaders read the factor from a GPU buffer | Every material, custom materials included, multiplies by a value that the meter wrote | Rejected. It changes every scene shader, and the meter must read the frame before, so hold mode fails as in A |
| C: the meter runs after the scene in the same frame, and the final pass multiplies the HDR color by the factor | One texel of a texture holds the factor. The final pass reads it before FXAA, the vignette and the tone curve | Chosen |

Option C is how pmndrs's adaptive tone mapping and Bevy apply their factor. Everything before the tone curve is linear, so the factor at the end gives the picture that a factor in the lights would give. The scene color keeps the camera's exposure, so values stay where [D-60](D-60-exposure-in-the-lights.md) puts them. A 16-bit float keeps its precision from 2^-14 to 2^15, so the factor's default limit of 16 times either way loses nothing that shows. A scene that adapts much further should set the camera's exposure near the middle of its range.

The factor multiplies the scene's texels, the output of custom effects that fold into the final pass, and bloom's glow, each before they meet. FXAA then compares edges in adapted color, so a dark place that the eye has brightened keeps its smoothing. Custom effects, depth of field and bloom's threshold see the camera's exposure: the threshold keeps its meaning in the scene's units, as [D-60](D-60-exposure-in-the-lights.md) set it.

### The 8-bit path

The 8-bit path tone maps inside the scene shaders, so no linear color reaches a final pass. Automatic exposure joins bloom, custom effects and custom tone curves: in compatibility mode with MSAA it moves the engine to HDR color with FXAA, and on a WebGL2 device without float targets it stays off, and development builds warn once.

### The meter

| Option | Verdict |
| --- | --- |
| A: a histogram of log luminance in compute shaders, then a scan that takes the mean or a trimmed mean | Chosen on WebGPU, core and compatibility mode. Every sample of the grid counts, and the percentiles are exact to a bin |
| B: a chain of downsamples to one texel of mean log luminance | Chosen where there is no compute, on WebGL2, and on Low. It has no percentiles of its own |
| C: B with a small histogram in the last step | Chosen for B's last step: the step reads 256 cells of mean log luminance, and builds a histogram of them in its one fragment, so the percentile meter works there too |
| D: three.js's old `AdaptiveToneMappingPass` and pmndrs's method: a mip chain of luminance, read at its last level | Rejected. Mean only, and a mip chain of the full frame costs more passes than C |

The steps run just before the final pass, after bloom's chain. The meter owns its few small GPU objects, which persist from frame to frame, so the render graph has no new targets. The frame graph records the meter's steps before the final pass's render pass, as it records the transmission copy's mip levels after its pass. While automatic exposure is off, the frame records none of it.

**The histogram path** (WebGPU, Medium and above). Compatibility mode has compute shaders too, and the engine already culls with them there, so it takes the histogram as core WebGPU does. Its storage texture is `rgba32float`, which compatibility mode allows in compute shaders.

1. A compute step reads a grid of the color output's drawn corner, 128 samples on its short side, with one filtered tap each. Each sample adds its center weight to one of 128 bins of `log2(luminance / 0.18)`, from -16 to +16 stops, in workgroup memory, and then in a storage buffer.
2. A second compute step scans the bins. It takes the weighted mean of the bins' stops, or with `metering: 'percentile'` the mean between the two percentiles. It clamps the result to the limits, moves the stored exposure toward it, writes the new state, and stores the factor in one texel.

**The downsample path** (WebGL2, and Low on every path):

1. A full-screen step draws 16 x 16 cells. Each cell takes the mean `log2(luminance / 0.18)` of 4 x 4 filtered taps over its part of the drawn corner, and its center weight.
2. A full-screen step into one texel reads the 256 cells and the stored state. It builds a histogram of the cells in its one fragment, meters it as the histogram path does, and writes the factor and the new state.
3. The frame copies that texel into the state texel for the next frame.

### Adaptation

The meter gives the scene's brightness in stops, relative to the camera's exposure: 0 when the scene's metered luminance shows as middle gray, 0.18, at the camera's exposure. The eye adapts to scenes from `minEv` to `maxEv`, and a darker or brighter scene shows darker or brighter. The factor is `2^(compensation - adapted)`.

The adapted value moves toward the metered one at `speedUp` stops per second when the scene grows brighter, and `speedDown` when it grows darker. Within one stop of the target it slows down, exponentially at the same rate, so it settles without a jump. The defaults are 3 and 1 stops per second, as an eye closes faster than it opens, and as Unreal and Bevy set them. The first metered frame after automatic exposure turns on takes the target at once. Hold mode's one frame is such a frame, so its image is the adapted image, and the same in every run.

With `ev100`, the camera's EV100 plus the meter's stops is the scene's brightness on the EV100 scale, give or take the key's constant. `minEv: -8` with `ev100: 15` lets the eye adapt down to a scene of about EV100 7.

### The API

```ts
post.set({
  autoExposure: {
    metering: 'percentile', // or 'mean'
    percentiles: [0.1, 0.9],
    centerWeight: 0.5,
    speedUp: 3,
    speedDown: 1,
    minEv: -4,
    maxEv: 4,
    compensation: 0,
  },
});
```

`autoExposure: {}` takes the defaults, and `false` turns it off. The camera's `exposure` and `ev100` keep their meanings: the scene draws at that exposure, and the eye adapts from there.

## Data

The twelve automatic-exposure image tests and the demo's draw on WebGPU, compatibility mode and WebGL2, in both reference sets (`chrome-real-gpu` and `chromium-swiftshader`). A dark hall and a sunny street both adapt toward middle gray: the difference between the two images is what the meter removes. The percentile and the mean meters, a center weight, a compensation and an eye range each move the image. The eye adapts with bloom and AgX, and at half the render scale. Turning it on during play draws the image of turning it on at the start, since the meter's first frame settles at once. The downsample meter draws its own image, and a device with no HDR target keeps the camera's exposure.

The engine downloads the meter's shaders on the first `post.set({ autoExposure })`: `js/shaders-exposure-glsl.js` is 2,532 bytes after Brotli, and `js/shaders-exposure-wgsl.js` is 2,767 bytes. The meter adds 2.8% to the WebAssembly after Brotli: 402,578 bytes against 391,494 without it on the threaded build, and 401,154 against 390,306 on the single build.

The GPU check of the benchmark scenes S4 and S6, which keep automatic exposure off, measured the median GPU time per frame moving from 3.98 to 3.99 ms on S4 at Medium (+0.2%), from 4.89 to 5.08 ms on S6 at Medium (+4.6%), from 4.96 to 4.78 ms on S4 at High (-2.4%) and from 6.08 to 6.94 ms on S6 at High (+12.1%), all within the check's limits. The feature costs about nothing while it is off.

The allocation check (`bun run bench:allocation --exposure`) passes on WebGPU and WebGL2: the meter adds no allocation of its own, only the browser's own per-frame objects, within budget.

## Decision

Chosen: option C, where the meter runs after the scene in the same frame and the final pass multiplies the HDR color by the factor, with the histogram where the GPU has compute and the downsample plus its own small histogram elsewhere. Hold mode settles at once, so its images are deterministic. The feature costs nothing while it is off, and one API and one look serve WebGPU, compatibility mode and WebGL2.

## Consequences

- Code: `crates/null3d-render/src/exposure.rs`, the final pass's binding 12 and its flag, the frame graph's hook before the final pass, `exposure.wgsl` and the `null3d::exposure` module, the first-use shader set `exposure`, both backends' layouts and templates, the post values and `post.set`, and the quality setting `exposureMeter`.
- The final pass's group binds the outline mask at binding 11 and the automatic exposure's texel at binding 12, which every build binds (a blank texel while the meter is off). The group's tests name the mask's own binding and expect six entries, so a binding added later cannot break them.
- Docs: `api/post`, `concepts/post-processing`, `concepts/color-management`, the mapping, both skills.
