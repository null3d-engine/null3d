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
  Apple M5 Max in Chrome at 1920 x 1080, with the governor off and a render scale of 1. The scene
  holds a wall of lit boxes under bloom, and the same scene runs with the look and without it in
  turns, three times each; each figure is the median with the look less the median without it.

  | Path | Low | Medium | High | Ultra |
  | --- | --- | --- | --- | --- |
  | WebGPU | owed | owed | owed | owed |
  | Compatibility mode | owed | owed | owed | owed |
  | WebGL2 | owed | owed | owed | owed |

  Compatibility mode draws no custom effect, so its figure is the core's grade, vignette and
  sharpening alone. Bloom stays on for both sides, so it is no part of any figure. The figures are
  owed: the timing run needs a quiet computer, and the machine that drew the picture tests was too
  busy to measure.
- The lens draws no depth of field. The scene keeps the engine's own `dof` setting, which turns on
  from the Post tab.
- The effect needs HDR color, as bloom does. On a device without a float target it stays off, and
  the grade and the vignette still apply.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
