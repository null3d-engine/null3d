# D-260: Moment transparency, and what it beats

Status: proposed, the layer built on 25 October 2026 and waiting for the owner's review. Date:
2026-10-25. Task: M3-F13. Built: the moment pass, the colour pass, the composite, the setting end to
end and the SMAA steps are on branch `feat/m3-f13-moment-transparency-build`. The figures below
still come from the model and arithmetic; the device run that replaces them is pending.

Summary: Order-independent transparency from a store of four depth moments beats the weighted blending's own weight in a model of the composite. It is nearer the exact result in 78% of stacks. The layer draws the transparent surfaces twice, and a phone run must settle that cost.

## Question

Does a store of depth moments give a better picture than the weighted blending that the engine
draws today, and at what cost? Task M3-F13 asks for order-independent transparency in which
overlapping glass, foliage and particles blend correctly whatever order they draw in.

## Rule

The better look decides between options (hard rule 40). The test is whether the new technique is
nearer the exact back-to-front result than the weighted blending is. The cost then decides how it
ships. A technique that a phone cannot afford becomes a documented limit or a preset choice. It is
never a dropped feature (hard rule 39).

## Data

The figures come from a model of the composite, not from a GPU. Each stack holds two to six
surfaces. Each surface has a random depth from 1 to 30 meters, a random optical depth from 0.15 to
1.2 and a random color. Each engine's result is compared with the exact back-to-front composite of
the same stack. The measure is the largest difference in any color channel.

| Measure | Four moments | Weighted blending |
| --- | --- | --- |
| Mean error over 400 stacks | 0.050 | 0.086 |
| Median error | 0.042 | 0.077 |
| 90th percentile | 0.102 | 0.167 |
| Worst stack | 0.188 | 0.279 |
| Stacks that four moments draws nearer | 314 of 400 (78%) | 86 of 400 |
| Two panes 8 meters apart | 0.000 | 0.183 |

The model evaluates the four-moment reconstruction as the shader does. It fits two atoms in the
warped depth. The weighted blending uses the engine's own weight: `alpha * clamp(0.03 / (1e-5 +
z^4), 1e-2, 3e3)`, where `z` is the depth over 200 meters.

Weighted blending loses because of that weight. It reaches its ceiling of 3e3 at every depth below
about 20 meters. Within a room it therefore weighs every surface alike. What is left is a plain
average of the surfaces' colors, with no term for which one is in front.

A first attempt fitted the moments with a two-point Gaussian. It placed the atoms at the mean plus
and minus one standard deviation. It did not beat weighted blending. That is why the store holds
four power moments, and why the fit is the orthogonal-polynomial one and not a moment-matching
approximation. The fit is exact for one and for two surfaces. That is why the two-pane case shows
no error at all.

## The reconstruction

The record keeps the formula here because it is the part that takes work to derive. The moments
`b` are `(b0, b1, b2, b3)`, where `b0` is the total optical depth. The depth `u` is warped into 0 to
1 by a logarithm between the camera's planes. This gives the transmittance from the eye to `u`:

```wgsl
let mean = b.y / b.x;
let second = b.z / b.x;
let third = b.w / b.x;
let spread = second - mean * mean;          // the variance of the depth
let a0 = (mean * third - second * second) / spread;
let a1 = (mean * second - third) / spread;
let root = sqrt(max(a1 * a1 - 4.0 * a0, 0.0));
let low = clamp((-a1 - root) * 0.5, 0.0, 1.0);
let high = clamp((-a1 + root) * 0.5, 0.0, 1.0);
let near_share = clamp((high - mean) / (high - low), 0.0, 1.0);
let far_share = 1.0 - near_share;
let absorbed = select(0.0, near_share, u > low) + select(0.0, far_share, u > high);
let shown = exp(-b.x * absorbed);
```

A spread of nearly zero puts all the optical depth at the mean depth. A span of nearly zero does
the same. This form was checked against a reference implementation in Python: it is exact for one
surface and for two, and close for more.

## Look

No pictures exist yet. The model says the moment layer keeps a near pane's color. The weighted
blending washes that color toward what lies behind it. The image test that settles it compares both
against an exact sorted render of the same scene.

## Decision

Build the layer with the four-moment store. Judge it by the image test, and not by the model alone.
The layer draws the transparent surfaces twice:

1. a moment pass, which adds four power moments of each fragment's optical depth into one target;
2. a color pass, which draws the same surfaces again. Each color is weighted by the transmittance
   that the moments give at that fragment's depth;
3. a composite, which reads both and blends the result over the scene.

The second draw cannot be avoided in this shape. A fragment's share of the picture depends on every
surface in front of it. No single draw knows its own transmittance. The one-pass alternative stores
color moments as well. That takes four color targets of 16-bit floats. No backend supports more
than two targets today, so that form is out of reach.

The store costs 16 bytes per pixel, written by each of the two passes. At 1920 by 1080 that is 33 MB
written a frame. The traffic is about 66 MB. The weighted blending writes 10 bytes a pixel. These
figures are arithmetic, not measurements. A run on an S24-class phone must replace them. The result
goes in this record and in the preset table.

## Consequences

- The setting is one flag on the quality settings. It is fixed at the start, and it is off on every
  preset. The preset table carries its row and its cost, so a page sees what it pays.
- The scene color keeps MSAA's samples for opaque geometry. The layer's targets have one sample, so
  its surfaces get none. The composite writes the share it covers into a mask. SMAA 1x runs under
  that mask, not over the whole image, so opaque edges keep MSAA's smoothing.
- SMAA's two lookup tables are made at first use, like the engine's other generated assets. Their
  build cost goes in this record when it is measured.
- A masked surface is opaque, so it keeps today's path. The setting covers the blended surfaces
  only: glass, blended foliage and particles.
- The permutation word is full. The moment pass takes the value of the outline view's bit. No mesh
  template lists that bit, so no other mesh build moves. The outline mask's own builds would move
  with it, because a first-use bit takes the builds of every template that lists its name. The
  manifest's first-use table therefore names the six mesh templates that the bit serves, and the
  outline mask's builds keep their device modules (this was found while building the layer; the
  record's first wording said the move could not happen).
- The color pass cannot share a second value. The shader build names a build's first-use file by
  the names of its bits. A shared value would pull another template's builds into the moment file.
  The color pass becomes six shader entries instead, one for each mesh template with a moment
  build.
- Both paths fall back to today's sort where the device cannot draw into 16-bit float targets.
- A page without the setting draws exactly as it does today. No demo changes.

## Built, 25 October 2026

The layer, its quality setting and its anti-aliasing are built on branch
`feat/m3-f13-moment-transparency-build`. The build follows the shape above, with these differences
and answers:

- The setting takes every blended surface that a moment build covers, whether its material blends
  normally or with `'weighted'`, so only one layered pass draws. A material with a feature that the
  moment builds lack, such as a clear coat, transmission, parallax or a mask, keeps the transparent
  pass's sort. The moment builds carry vertex colors, skins, morph targets, row values, shadows,
  area lights, light through a thin surface, displacement and the device's bits.
- The anti-aliasing reads the share that the layer covers from the moment store's total optical
  depth, one minus its transmittance, rather than from a separate mask target. A mask that the
  composite writes would have to be multisampled like the scene color, and every path draws into a
  one-sample mask no better. The look is the same: SMAA runs only under the layer's share, and the
  rest of the image keeps MSAA's samples or FXAA.
- SMAA 1x is three full-screen steps, as the reference implementation has them: the edges, the
  blending weights from the two tables, and the resolve. The tables are made in the engine core at
  the layer's first use, from the reference's own generator, which the engine carries under the
  MIT notice. The search table equals the reference's byte for byte. The area table differs from it
  by at most 3 of 255 in 4,210 of its 89,600 texels, from the order of the floating-point sums; the
  tables are 8-bit approximations in either case.
