# D-255: Car-paint glints

Status: decided by the helper of M3-B5, for the owner's review. Built: the model in
`examples/addons/car-paint/`, with a shader-crate test that builds it on both paths, and its
picture references in both sets, drawn by the Mac and by CI. Owed: its cost per preset, which needs
a quiet GPU. Task: M3-B5.

Summary: The flakes are the metal's microfacets. For each pixel, the paint counts the facets in the
pixel's footprint that reflect the main light into the eye, with the binomial model of Deliot and
Belcour, and uses that count in place of the smooth highlight. The count's mean is the smooth lobe,
so the sparkle follows the light and smooths with distance.

## Question

Ruling 17 ([D-179](D-179-technique-rulings.md)) makes the car paint's flakes with
Deliot and Belcour's glints, and one random normal tilt per cell is not that model. The surface
function cannot see a light, so the model needs the material lobe hook
([D-252](D-252-material-lobes.md)). How does the add-on use it?

## Rule

- The surface function places the flakes. It passes four values to the lobe: the pixel's footprint
  in flake cells, the flake tilt, and a random value for the flake's own cell.
- The lobe computes, for the main light, the number of facets in the footprint that reflect it into
  the eye. The facets inside the footprint are `N`; each reflects with the probability `p` that its
  normal lies in the light's specular region. The count `b` follows the binomial law of `N` trials.
- The lobe returns `specular * (b / (N p) - 1)`, which adds to the base specular. The mean of `b`
  is `N p`, so the mean highlight is the base lobe's, and the variation is the sparkle.
- Where no facet can reflect (`p = 0`), the lobe returns `-specular`. The smooth highlight is then
  gone, because the paint is the flakes, not a smooth mirror.
- The binomial of many facets and a small chance is a Poisson law. The add-on samples it exactly
  from the inverse of its sum while the expected count is 16 or less, and with the normal form
  above that: `b = 0,1,2...` with the mean `N p`. The count is clamped to `0` to `N`. The normal
  form alone draws a positive count about half the time where the chance is small, which draws a
  block of white glints; the Poisson form keeps the sparkle sparse. Two hashes of the cell's
  random value feed the sample.
- A count above `max` times the smooth lobe is clamped, to bound a single bright flake.

## The facets

- The flake normals lie in a cap around the surface normal. The tilt sets the cap's half angle:
  `atan(1.414 * tilt)`, the corner of the square that the two random tilts span.
- The facet density is `1 / (2 pi (1 - cos(cap)))`.
- The light's solid angle is `2 pi (1 - cos(angle))`, where `angle` is its angular radius. A
  directional light has no size in the engine, so the paint gives it one. The default is `0.25`
  radians, a softbox 28.6 degrees across. A look can set a smaller sun or a broader light.
- The chance that one facet reflects is `density * solid / (4 cos(half, light))`, clamped to 1.
  This is the small-source form of the paper's probability.
- The footprint's area in cells is `step.x * step.y`, clamped to at least 1.

## Why this is the model, not a lookalike

| Option | Verdict |
| --- | --- |
| A: count the reflecting facets in the footprint, with the lobe hook | Chosen. The count, its mean and its variance come from the paper's binomial law |
| B: one random normal tilt per cell, faded below a pixel | Rejected. It is not the paper's model, and its variance does not follow the footprint |
| C: draw one facet per pixel from the flake distribution | Rejected. It is unbiased only with a weight by the chance, which the lobe already gives |

## Cost

- The surface function computes two derivatives of the flake coordinates and one hash for each
  pixel.
- The lobe computes the cap, the density, the light's solid angle, two hashes and either a short
  Poisson sum or a Gaussian sample for each pixel of each light that reaches it. The terms are a few
  dozen floating-point operations.
- The plan estimates 0.3 to 1 ms on a full screen. The paint's own cost per preset is owed, and the
  command is `NULL3D_PAINT_COST=1 bun run test:browser -- car-paint-cost.spec.ts`, in a quiet
  window on a computer with a GPU of its own.

## Every light

The lobe hook runs for the main directional light and for each point and spot light that reaches the
surface ([D-252](D-252-material-lobes.md)). The paint's glints therefore follow every such light,
and a scene without the sun still sparkles under a lamp. Area lights draw the base highlight alone.
The model gives each light the same angular radius, `flakes.angle`, since a point light has no size
in the engine either.

## Consequences

- Code: `examples/addons/car-paint/paint.wgsl` holds `lobe` and the footprint values.
  `examples/addons/car-paint/index.ts` takes `flakes.angle` and `flakes.max`.
- Tests: `crates/null3d-shaders/tests/material.rs` builds the shipped WGSL on both paths. The
  add-on's pictures hold the glints, and the paint spec measures each part against the body without
  it.
- Owed: the cost per preset, which needs a quiet GPU. At a load near 100, as the Mac ran in every
  attempt, a timing run measures nothing.
- The guide `docs/guides/car-paint.md` and the add-on README describe the model, its options and its
  limit.

## The light's size the glints need

The light's size decides whether a glint draws at all. The chance that one flake reflects the main
light is the light's solid angle over the cap of flake normals. At a radius of 0.02 radians, a light
2.3 degrees across, about one flake in 1,400 reflects it. The count is almost always zero. Each
caught flake adds its light where the smooth highlight is already clipped or too dim to show.

At that size, the paint with its flakes and the paint without them differ only where the count
takes the smooth highlight away. Across all six references no pixel grows brighter than one step.
The highlight falls by 76 to 77 steps over about 1,100 pixels. The sparkle that the model describes
does not draw at all, and a test that only compares the two pictures passes such a paint.

The default is 0.25 radians, a softbox 28.6 degrees across. These figures are radii, not widths: a
radius of 0.02 radians spans 2.3 degrees, and one of 0.25 spans 28.6.

Measured on the Mac's GPU with the paint test's own body, the pixels that grew brighter than 8 steps
were none at 0.02 radians. They were 14 at 0.08, 49 at 0.15, 161 at 0.25 and 442 at 0.4, with the
test sketch's flake cells of that sweep. The brightest glint fell from 154 to 103 to 58 steps over
that range. The default is the fourth of the five sizes tried. There the sparkle is many flakes,
each with a strong contrast: 228 pixels on that body, the brightest 103 steps above it. The test
sketch's flake cells cover the same distance along each texture coordinate, so a glint draws as a
2 by 2 pixel dot. Cells of unequal sides draw it as a six to one dash, which is the cell's shape on
screen, not the flake's. The paint spec also checks that the flakes brighten pixels, so a model that
only removes the highlight fails it.

The Showroom demo's wide shot shows none of this sparkle, and its picture stays inside the
comparison's tolerance. Its car covers little of the frame. A flake there falls below a pixel, and
the model smooths it, as this record intends for a distant car. That leaves the demo unable to show
the feature. A closer camera in the demo, or coarser flake cells on its paint, would show it. The
choice belongs to the owner's eye, and the demo keeps its settings until the owner makes it.

## Runs

The light-size sweep above is a live measurement on the Mac's GPU, by a probe spec that is not
kept. The other figures of the light's size are the two reference sets' picture pairs. The runs below measure the flakes' share at 0.01630 to 0.01653 and
the weave's at 0.12952 to 0.13030. Both sit a little above the pairs' 0.01607 to 0.01631 and 0.12667
to 0.12770. The first two runs below are the ones that commit `491a4a077` records, and the full image run is the one that commit `3b77c0268` records. All three ran on the Mac that holds this checkout, before the fix was committed as `40b6e92c4`. No log of any run below is kept:

- On the Mac's GPU, `images.spec.ts car-paint.spec.ts -g car-paint`: 7
  passed and 9 failed (31.6 s). The failures were the nine paint pictures against references without
  glints, and this run drew their candidates. The part test passed, with flakes mean 0.00267,
  share 0.01650 and 228 glints.
- `car-paint.spec.ts` with `CI=1`, on SwiftShader, 1 passed (53.7 s): mean
  0.00267, share 0.01651, 232 glints.
- `bun run test:images` on the Mac's GPU, in about 27 minutes: 1,590 passed and 1 failed.
  `demo-aurora` on webgl2 failed with E1408. That is the sky layer's fault
  ([D-242](D-242-sky-layers.md#the-cubes-texture-unit-on-webgl2)), not this paint.
  `demo-coat-and-sheen` passed on all three tiers. The 0.25 default therefore moves that picture by
  less than the comparison's 0.1 percent.
- On the merged tip 383c16bde, `images.spec.ts car-paint.spec.ts -g car-paint`, 16 passed (36.7 s)
  on the Mac's GPU. The same run with `CI=1` passed 16 (1.0 m) against the software set that CI
  drew.
- CI run 40192893324 drew that software set, and the nine paint candidates of
  its browser shards 13 and 14 were accepted.
