# D-255: Car-paint glints

Status: decided by the helper of M3-B5 on 25 October 2026, for the owner's review. Built: the model
in `examples/addons/car-paint/`, with a shader-crate test that builds it on both paths. Owed: the
paint's picture references and its cost per preset, which need a quiet GPU. Date: 2026-10-25.
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
  in flake cells, the flake tilt, and a random value that stays the same over each footprint-sized
  block of cells.
- The lobe computes, for the main light, the number of facets in the footprint that reflect it into
  the eye. The facets inside the footprint are `N`; each reflects with the probability `p` that its
  normal lies in the light's specular region. The count `b` follows the binomial law of `N` trials.
- The lobe returns `specular * (b / (N p) - 1)`, which adds to the base specular. The mean of `b`
  is `N p`, so the mean highlight is the base lobe's, and the variation is the sparkle.
- Where no facet can reflect (`p = 0`), the lobe returns `-specular`. The smooth highlight is then
  gone, because the paint is the flakes, not a smooth mirror.
- The binomial's normal form draws `b` from a Gaussian sample: `b = N p + sqrt(N p (1 - p)) z`,
  clamped to `0` to `N`. `z` comes from two hashes of the block's random value, which Box and
  Muller turn into a Gaussian. The normal form is an approximation for small counts, and the
  add-on states it.
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

- The surface function computes two derivatives of the flake coordinates, one block coordinate and
  one hash for each pixel.
- The lobe computes the cap, the density, the light's solid angle, two hashes and a Gaussian sample
  for each pixel of the main light. The terms are a few dozen floating-point operations.
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
