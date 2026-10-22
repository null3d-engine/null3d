# Lens kit

An example add-on that gives a scene one lens: a grade, a sharpening, a vignette and the camera's
own marks. The grade, the sharpening and the vignette are the engine's own `post` settings, which
the kit sets from one look; the kit adds no second way to do any of them. The film grain, the
colour fringes, the anamorphic streak and the speed blur are one full-screen effect of the add-on's
own, each with a value and off at 0.

## Use

```ts
import { createLensKit, nightGrade } from '../../addons/lens-kit/index';

const lens = await createLensKit(ctx, {
	sharpen: 0.35,                                     // the core's sharpening
	vignette: { intensity: 0.55, size: 1.05, falloff: 2.2 },
	grade: { data: nightGrade(), intensity: 0.85 },     // the core's grading table
	aberration: 0.8,                                    // the effect below
	streak: 0.45,
	grain: 0.045,
	speedBlur: 0.1,
});
// Later, change a part of the look:
lens.set({ vignette: false });
```

- The grade is a colour table that the add-on bakes from numbers at the setup and gives to the
  core's grading table. Two ship with it: `nightGrade()` for a night city, and `neutralGrade()` for
  a view that must show a material's own color. A different grade needs its own table.
- The effect runs on linear HDR color before bloom and the tone curve, as every effect does. Each
  of its four values is off at 0, and a look with all four at 0 adds no effect at all.
- The aberration and the streak read the pixels around each one. At the whole canvas's render scale
  they join one pass; below it, each effect draws a pass of its own
  ([The post-processing chain](../../../docs/concepts/post-processing.md#below-the-whole-canvass-render-scale)).
- Grain changes at 24 steps a second, whatever the frame rate.

## Costs and limits

- The core's sharpening, the vignette and the grading table cost the frame nothing extra: they run
  in the final pass. The effect costs one full-screen pass with about 18 taps where all four of its
  values are above 0; a look that leaves one at 0 skips its taps.
- The lens draws no depth of field. The scene keeps the engine's own `dof` setting, which turns on
  from the Post tab.
- The effect needs HDR color, as bloom does. On a device without a float target it stays off, and
  the grade and the vignette still apply.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
