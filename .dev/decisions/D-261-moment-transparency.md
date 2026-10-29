# D-261: Moment transparency, and what it beats

Status: decided. Built on both GPU paths and measured on this computer's GPU on 29 October 2026.
The owner's review is pending, and the run on a phone is owed. Task: M3-F13.

Summary: Order-independent transparency from a store of four depth moments beats the weighted
blending's own weight, in a model of the composite and in the image test. It is nearer the exact
result in most stacks. The layer draws the transparent surfaces twice, so it costs more than the
weighted blending, and it is off on every preset.

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

The figures come from a model of the composite. Each stack holds two to six surfaces. Each surface
has a random depth from 1 to 30 meters, a random optical depth from 0.15 to 1.2 and a random color.
Each method's result is compared with the exact back-to-front composite of the same stack. The
measure is the largest difference in any color channel.

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
about 11 meters. Within a room it therefore weighs every surface alike. What is left is a plain
average of the surfaces' colors, with no term for which one is in front.

The image test that settles the choice draws five panes of glass at different depths, and compares
each approximation with the exact sorted image. The moment layer's mean channel error is nearer the
exact image than the weighted blending's is, on WebGPU and on WebGL2.

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
the same. This form is exact for one surface and for two, and close for more.

## Decision

Build the layer with the four-moment store. The layer draws the transparent surfaces twice:

1. a moment pass, which adds four power moments of each fragment's optical depth into one target;
2. a color pass, which draws the same surfaces again. Each color is weighted by the transmittance
   that the moments give at that fragment's depth;
3. a composite, which reads both and blends the result over the scene.

The second draw cannot be avoided in this shape. A fragment's share of the picture depends on every
surface in front of it. No single draw knows its own transmittance. The one-pass alternative stores
color moments as well. That takes four color targets of 16-bit floats. No backend supports more
than two targets today, so that form is out of reach.

## Anti-aliasing

The scene color keeps MSAA's samples for opaque geometry. The layer's own targets have one sample,
so its surfaces get none. The moment store and the color sum are 16-bit float targets, which
compatibility mode cannot multisample. Four samples of the two would take 32 bytes per pixel.

A post-process anti-alias replaces those samples on the layer's surfaces. SMAA 1x, the subpixel
morphological method, runs in three steps: it marks the layer's edges, finds their ends and areas
from two lookup tables, and mixes each pixel with the neighbour that its weights name.

- **SMAA, not FXAA.** FXAA smooths the whole image, so it would soften the opaque edges that MSAA
  already smoothed and blur fine detail across the picture. SMAA runs under the share that the
  moment store covers, so it smooths the layer's edges alone and leaves the rest of the image as
  MSAA left it. It also reads the color's edges rather than the whole picture's contrast, which
  keeps thin glass and foliage sharper than FXAA does at the same cost.
- **SMAA, not more MSAA.** The layer cannot be multisampled on compatibility mode or on WebGL2
  devices without multisampled 16-bit float targets, and four samples of its two targets cost four
  times the bytes.

The share comes from the moment store's total optical depth, so no separate mask target is needed.
A pixel that the layer does not cover marks no edge. The three steps take 8 bytes per pixel for
their two 8-bit targets, plus the final color target they write.

## Cost

The moment store and the color sum take 8 bytes per pixel each. Each pass writes its own target
once a frame, so the layer writes 16 bytes per pixel, or 33 MB at 1920 by 1080. The color pass also
reads the store, so the traffic is about 50 MB a frame. The weighted blending writes 10 bytes a
pixel. The composite writes the scene color, and SMAA's two 8-bit steps take 8 bytes per pixel more.

The S1 benchmark page with its smoke switch measures the layer against the weighted blending on
this computer's GPU, at High. That figure and the run on a phone are still owed.

The layer also copies its two SMAA lookup tables, 362,496 bytes, into the upload arena at its first
frame. No other frame copies them, and no frame without the setting copies anything.

## Look

The layer keeps a near pane's color where the weighted blending washes it toward what lies behind.
The panes in the image test each draw their own color over the wall behind them. The moment image
is nearer the exact sorted image than the weighted one.

## Consequences

- The setting is one flag on the quality settings, and `createEngine`'s `momentTransparency` option
  or the `?moments=` switch sets it. It is fixed at the start, and it is off on every preset. The
  quality presets page gives its row and its cost, so a page sees what it pays.
- The setting covers every blended surface that a moment build covers, whether its material blends
  normally or with `'weighted'`, so only one layered pass draws. A material with a feature that the
  moment builds lack, such as a clear coat, transmission, parallax or a mask, keeps the transparent
  pass's sort. The moment builds carry vertex colors, skins, morph targets, row values, shadows,
  area lights, light through a thin surface, displacement and the device's bits.
- Both paths fall back to today's sort where the device cannot draw into 16-bit float targets.
- A page without the setting draws exactly as it does today. The frame graph declares and records
  none of the layer's passes, and the sorted layout asks for none of its pipelines. A unit test
  compares the frame's steps with and without the setting.
- The permutation word is full. The moment pass takes the value of the outline view's bit. No mesh
  template lists that bit, so no other mesh build moves. The outline mask's own builds would move
  with it, because a first-use bit takes the builds of every template that lists its name. The
  manifest's first-use table therefore names the six mesh templates that the bit serves, and the
  outline mask's builds keep their device modules.
- The color pass cannot share a second value. The shader build names a build's first-use file by
  the names of its bits. A shared value would pull another template's builds into the moment file.
  The color pass becomes six shader entries instead, one for each mesh template with a moment
  build.
- The two lookup tables port the SMAA reference implementation, under its MIT notice.

## Acceptance and tests

The image test draws the scene twice, with moment transparency on and with today's sort. It draws
the same scene a third time with the weighted blending. The test measures each image's distance
from the sorted one, as the mean of every color channel over the whole picture. It passes when the
moment image is nearer than the weighted image.

Two more tests guard the property that gives the feature its name. The same panes added in the
opposite order draw the same picture, and both draw nearer the exact image than the weighted
blending does.

The frame graph's test holds the passes, their order, their bind groups and the tables' first use.
It also holds that an unused layer declares and records nothing.

## Remaining work

1. The measured cost on this computer's GPU, which the S1 benchmark run fills in.
2. The run on an S24-class phone, which replaces the phone figure.
3. The SwiftShader references of the four image tests, which come from a CI run.
