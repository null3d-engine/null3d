# D-255: Car-paint glints

Status: decided by the helper of M3-B5 on 25 October 2026, for the owner's review. Built: the model
in `examples/addons/car-paint/`, with a shader-crate test that builds it on both paths, and its
picture references in both sets, drawn by the Mac and by CI. Owed: its cost per preset, which needs
a quiet GPU. Date: 2026-10-25.
Task: M3-B5.

Summary: The flakes are the metal's microfacets. For each pixel, the paint counts the facets in the
pixel's footprint that reflect the main light into the eye, with the binomial model of Deliot and
Belcour, and uses that count in place of the smooth highlight. The count's mean is the smooth lobe,
so the sparkle follows the light and smooths with distance.

## Question

Ruling 17 ([D-179](D-179-technique-rulings-2026-10-15.md)) makes the car paint's flakes with
Deliot and Belcour's glints, and the audit of 24 October 2026 found one random normal tilt per cell
instead. The surface function cannot see a light, so the model needs the material lobe hook
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
  form alone drew a positive count about half the time where the chance was small, which drew a
  block of white glints; the Poisson form is why the sparkle is sparse. Two hashes of the cell's
  random value feed the sample.
- A count above `max` times the smooth lobe is clamped, to bound a single bright flake.

## The facets

- The flake normals lie in a cap around the surface normal. The tilt sets the cap's half angle:
  `atan(1.414 * tilt)`, the corner of the square that the two random tilts span.
- The facet density is `1 / (2 pi (1 - cos(cap)))`.
- The light's solid angle is `2 pi (1 - cos(angle))`, where `angle` is its angular radius. A
  directional light has no size in the engine, so the paint gives it one: the default is `0.02`
  radians, about a studio softbox, and a look can set a smaller sun or a broader light.
- The chance that one facet reflects is `density * solid / (4 cos(half, light))`, clamped to 1.
  This is the small-source form of the paper's probability.
- The footprint's area in cells is `step.x * step.y`, clamped to at least 1.

## Why this is the model, not a lookalike

| Option | Verdict |
| --- | --- |
| A: count the reflecting facets in the footprint, with the lobe hook | Chosen. The count, its mean and its variance come from the paper's binomial law |
| B: one random normal tilt per cell, faded below a pixel | Rejected. It is the model the audit pulled, and its variance does not follow the footprint |
| C: draw one facet per pixel from the flake distribution | Rejected. It is unbiased only with a weight by the chance, which the lobe already gives |

## Cost

- The surface function computes two derivatives of the flake coordinates and one hash for each
  pixel.
- The lobe computes the cap, the density, the light's solid angle, two hashes and either a short
  Poisson sum or a Gaussian sample for each pixel of the main light. The terms are a few dozen
  floating-point operations.
- The plan estimates 0.3 to 1 ms on a full screen. The paint's own cost per preset is owed, and the
  command is `NULL3D_PAINT_COST=1 bun run test:browser -- car-paint-cost.spec.ts`, in a quiet
  window on a computer with a GPU of its own.

## The main light alone

The lobe hook runs for the main directional light alone ([D-252](D-252-material-lobes.md)). Point,
spot and area lights draw the base highlight with no glints, and the guide and the add-on README
say so.

## Consequences

- Code: `examples/addons/car-paint/paint.wgsl` gains `lobe` and the footprint values, and drops the
  per-cell normal tilt and the roughness spread. `examples/addons/car-paint/index.ts` takes
  `flakes.angle` and `flakes.max` in place of `flakes.spread`.
- Tests: `crates/null3d-shaders/tests/material.rs` builds the shipped WGSL on both paths. The
  add-on's pictures are redrawn, and the paint spec measures each part against the body without it.
- Owed: the picture references on every tier and in both sets, and the cost per preset. The machine
  ran near a load of 100 on 25 October 2026, where neither run measures anything.
- The guide `docs/guides/car-paint.md` and the add-on README describe the model, its options and its
  limit.

## Addendum, 25 October 2026: the light's size the glints need

The pictures drawn for this record showed no glint. The paint with its flakes and the paint without
them differed only where the count takes the smooth highlight away. Across all six references no
pixel grew brighter than one step. The highlight fell by up to 76 steps over about 1,100 pixels. The
sparkle the model describes had not drawn at all.

The chance that one flake reflects the light is the light's solid angle over the cap of flake
normals. A radius of 0.02 radians is a light 1.1 degrees across. About one flake in 1,400 caught it
in the paint's footprint. Each caught flake added its light where the smooth highlight was already
clipped or too dim to show. The default now names 0.25 radians, a softbox 14 degrees across. That is
what the option's text claimed before it.

Measured on the Mac's GPU with the paint test's own body, the pixels that grew brighter than 8 steps
were none at 0.02 radians. They were 14 at 0.08, 49 at 0.15, 161 at 0.25 and 442 at 0.4, with the
cells the sketch drew then. The brightest glint fell from 154 to 103 to 58 steps over that range.
The default takes the middle. There the sparkle is many flakes, each with a strong contrast: 228
pixels on that body, the brightest 103 steps above it. The test sketch's flake cells now cover the
same distance along each texture coordinate. A glint therefore draws as a 2 by 2 pixel dot rather
than a six to one dash. The dash was the cell's shape on screen, not the flake's. The paint spec also
checks that the flakes brighten pixels, so a model that only removes the highlight fails it.
