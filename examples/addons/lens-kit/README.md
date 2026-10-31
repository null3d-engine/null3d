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
  blurring the picture again, and it carries the light's own color: a red reflection flares red.
  Bloom must be on, or the streak reads black.
- The color fringes hold a smaller offset in the frame's outermost band. A sample pulled beyond the
  picture reads the frame's edge row, which paints a line of that color along the edge.
- The aberration and the speed blur read the pixels around each one. The streak reads bloom's level,
  so the effect draws a pass of its own; at the whole canvas's render scale, effects that only read
  their pixels join one pass
  ([The post-processing chain](../../../docs/concepts/post-processing.md#below-the-whole-canvass-render-scale)).
- Grain changes at 24 steps a second, whatever the frame rate.

## Costs and limits

- The grading table, the vignette and the sharpening run in the final pass, so the grade and the
  vignette cost the frame nothing extra. The sharpening value draws the final pass in its two steps
  at the whole canvas's render scale, which adds one full-screen pass there.
- The effect costs one full-screen pass with up to 18 reads of neighboring pixels where all four of
  its values are above 0; a look that leaves one at 0 skips its reads.
- A lit scene's own frame time moves by a millisecond or two between seconds, which hides part of
  the look. The cost test therefore measures it on a quiet machine with the scene cleared to its
  background and the bars that feed bloom. A mark alone is a fraction of a millisecond, so its cell
  draws the marks' effect eight times in every frame and divides what it measures by eight. Each
  side takes eight rounds of a second, with the sides in the opposite order on alternate rounds, and
  a cell is the whole frame's difference, so it holds every pass that the look adds. The canvas is
  3840 by 2160 CSS pixels with the pixel ratio held at 2,
  which draws into a 7680 by 4320 buffer, at a render scale of 1 with the governor off. Run it with
  `NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts` on a quiet machine. The figures
  below come from a MacBook Pro with an Apple M3 Max in Chrome 156, at a load under 8. Each cell is
  the median over the rounds, with the lowest and highest rounds in brackets.

  | Path | Low | Medium | High | Ultra |
  | --- | --- | --- | --- | --- |
  | WebGPU | 3.91 (1.36 to 4.10) | 3.49 (1.84 to 4.54) | 3.22 (1.80 to 4.23) | 3.13 (1.47 to 4.53) |
  | Compatibility mode | 3.82 (2.47 to 4.45) | 3.46 (1.71 to 4.92) | 3.12 (0.69 to 4.31) | 3.64 (2.24 to 5.47) |

  The look costs about 3.1 to 3.9 ms at every preset on both paths, and every cell keeps its whole
  range above zero. The cost follows the pixels rather than the preset, since the page holds the
  render scale at 1: the canvas draws 33 megapixels, so a megapixel costs about a tenth of a
  millisecond. WebGL2 keeps no figure in this table. Its cleared frame reads about 9 ms and moves by
  about a millisecond between rounds, which hides the look's own change there, so its marks stand in
  the table below instead.
- Each mark alone costs, at the highest preset its path allows, with every other value at 0. The
  marks draw eight times in each frame and the figure divides by eight, so each is a cost of its own
  at the same 33 megapixel canvas.

  | Mark | WebGPU | Compatibility mode | WebGL2 |
  | --- | --- | --- | --- |
  | Color fringes | 0.207 (0.102 to 0.429) | 0.189 (-0.080 to 0.417) | 0.400 (0.064 to 0.499) |
  | Streak | 0.589 (0.449 to 0.713) | 0.259 (0.212 to 0.495) | 0.425 (0.250 to 0.509) |
  | Grain | 0.308 (0.161 to 0.455) | 0.514 (0.417 to 0.732) | 0.349 (0.166 to 0.499) |
  | Speed blur | 0.382 (0.315 to 0.501) | 0.700 (0.597 to 0.861) | 0.373 (0.066 to 0.635) |
  | Sharpening | 1.316 (0.560 to 2.940) | 1.094 (0.272 to 1.864) | not resolved |

  The compatibility cells repeat the Medium preset, which the quality chooser's cap makes their
  highest. The color fringes' range in compatibility mode touches zero, so that cell is at the edge
  of what the run tells apart. The sharpening draws the first step of the engine's two-step pass,
  which WebGL2's whole-frame timer does not separate from the frame's own movement. The grade and
  the vignette stay inside the final pass: their cells read between -0.38 and 0.14 ms across the
  paths, so they cost less than this method resolves, under about 0.2 ms.
- The lens draws no depth of field. The scene keeps the engine's own `dof` setting, which turns on
  from the Post tab.
- The effect needs HDR color, as bloom does. On a device without a float target it stays off, and
  the grade and the vignette still apply.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
