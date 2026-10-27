# Lens kit

An example add-on that gives a scene one lens: a grade, a sharpening, a vignette and the camera's
own marks. The grade, the sharpening and the vignette are the engine's own `post` settings, which
the kit sets from one look; the kit adds no second way to do any of them. The film grain, the
color fringes, the anamorphic streak and the speed blur are one full-screen effect of the add-on's
own, each with a value and off at 0.

## Use

```ts
import { createLensKit } from '../../addons/lens-kit/index';

const lens = createLensKit(ctx, {
	sharpen: 0.35,                                      // the core's sharpening
	vignette: { intensity: 0.55, size: 1.05, falloff: 2.2 },
	grading: {                                          // the core's grading controls
		lift: [-0.02, -0.02, -0.02],
		gain: [1.05, 1.05, 1.05],
		saturation: 1.08,
		splitToning: { shadows: [0.35, 0.55, 1], highlights: [1, 0.86, 0.66], strength: 0.08 },
	},
	aberration: 0.8,                                     // the effect below
	streak: 0.45,
	bloomLevel: 2,                                       // the level of bloom's chain the streak reads
	grain: 0.045,
	speedBlur: 0.1,
});
// Later, change a part of the look:
lens.set({ vignette: false });
```

- The grade is the core's grading controls, and a job worker bakes them into the table that the
  final pass reads. The kit keeps no table of its own. A look that must show a material's own color
  passes `grading: false`.
- The effect runs on linear HDR color after the exposure and before the tone curve. Each of its
  four values is off at 0, and a look with all four at 0 adds no effect at all. A later `set` that
  raises a mark builds the effect then, and one that lowers every mark to 0 drops it again.
- The streak reads a level of bloom's chain with `effectBloom`, so the chain holds the light that
  passed bloom's threshold, already blurred. The effect spreads that light sideways instead of
  blurring the picture again. Bloom must be on, or the streak reads black.
- The aberration and the speed blur read the pixels around each one. The streak reads bloom's level,
  so the effect draws a pass of its own; at the whole canvas's render scale, effects that only read
  their pixels join one pass
  ([The post-processing chain](../../../docs/concepts/post-processing.md#below-the-whole-canvass-render-scale)).
- Grain changes at 24 steps a second, whatever the frame rate.

## Costs and limits

- The grading table, the vignette and the sharpening run in the final pass, so the grade and the
  vignette cost the frame nothing extra. The sharpening value draws the final pass in its two steps
  at the whole canvas's render scale, which adds one full-screen pass there.
- The effect costs one full-screen pass with about 18 taps where all four of its values are above
  0; a look that leaves one at 0 skips its taps.
- The whole look's cost, as GPU time per frame in milliseconds, measured on a MacBook Pro with an
  Apple M3 Max in Chrome 156, at a canvas of 3840 x 2160 CSS pixels with the pixel ratio held at 2,
  which draws into a 7680 x 4320 buffer, with the governor off and a render scale of 1. The scene
  holds a wall of lit boxes under bloom, and the same scene runs with the look and without it in
  turns, five rounds each, the sides in the opposite order on alternate rounds. Each figure is the
  median with the look less the median without it; its range is the lowest and highest of the five
  rounds' differences.

  | Path | Low | Medium | High | Ultra |
  | --- | --- | --- | --- | --- |
  | WebGPU | 2.00 (1.64 to 2.77) | 3.41 (2.71 to 5.16) | 2.02 (0.68 to 3.29) | 1.27 (0.47 to 6.10) |
  | Compatibility mode | 5.42 (5.35 to 5.46) | 2.35 (0.78 to 2.88) | 0.87 (-0.73 to 5.54) | 2.00 (0.52 to 8.10) |
  | WebGL2 | 1.41 (0.50 to 2.39) | 1.64 (-7.02 to 1.64) | 0.71 (0.43 to 7.37) | 1.46 (1.42 to 8.77) |

  Ten of the twelve cells keep their whole range above zero. Compatibility High's and WebGL2
  Medium's ranges cross it. A range that wide is the scene's own variation between rounds, where
  the off side moved by several milliseconds; the look costs no frames at any of these cells,
  because every row held the display's 16.665 ms interval.
- Each mark alone costs, at the highest preset its path allows, with every other value at 0:
  sharpen, streak and speed on WebGPU, grade and grain in compatibility mode, and vignette and
  grain on WebGL2. Those seven cells read between 0.38 and 1.58 ms with their whole range above
  zero. The other fourteen cross zero, so this canvas does not resolve their marks from the scene's
  own variation; treat their cost as below what five rounds here can tell apart.
- Compatibility mode draws no custom effect, so its figure is the core's grade, vignette and
  sharpening alone. The quality chooser caps compatibility mode and WebGL2 at Medium, so their High
  and Ultra cells repeat Medium's settings.
- The lens draws no depth of field. The scene keeps the engine's own `dof` setting, which turns on
  from the Post tab.
- The effect needs HDR color, as bloom does. On a device without a float target it stays off, and
  the grade and the vignette still apply.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
