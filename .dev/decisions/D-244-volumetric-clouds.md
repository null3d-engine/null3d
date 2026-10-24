# D-244: The sky's volumetric cloud tier

Status: decided by the helper of M3-F11 on 24 October 2026, for the owner's review. Built: the cloud
march, its noise field, the background draws of both skies, the sky map's steps, the `cloudSteps`
quality setting and the image tests. Date: 2026-10-24. Task: M3-F11.

Summary: On the High and Ultra presets the sky draws volumetric clouds in place of the flat layer:
a ray marched through a noise volume, drawn as a second blended draw over the sky and in the sky's
environment map, from the same cloud settings and with the same meaning. The noise field and the
tier's four shaders are made for the page and load at the tier's first use, so a page on the flat
tiers downloads none of them. A new live quality setting, `cloudSteps`, publishes the tier's cost
and lets a page reach it on a GPU path that caps its preset lower.

## Question

D-173's ruling of 21 October 2026 says that the sky's High tier and above draw volumetric clouds,
behind the same cloud settings that draw the flat layer on Low and Medium. What draws them, where
does its cost sit, how do the tiers differ without two places for one feature, and what keeps a page
that never draws them from paying?

## Rule

- **One tier of the core sky, not a second feature.** The same `scene.setBackground` cloud settings
  drive both layers: `cloudScale`, `cloudSpeed`, `cloudCoverage`, `cloudDensity`, `cloudElevation`
  and `time`. A setting keeps its meaning on every tier: coverage still bounds the share of the sky
  that clouds cover, density their solidity, elevation their height, scale their size, speed and time
  their drift. The flat layer's coverage goes to zero in the shader values while the tier draws, so
  no frame draws both.
- **The flat tiers download nothing.** The tier is four shaders of their own in the shader
  manifest's `[first_use.clouds]` family (the two backgrounds and the two sky-map steps), and the
  noise field is a 64-cube that the renderer generates and uploads on the tier's first frame. The
  sky's own shaders and the environment generator's shader stay as they were.
- **The cost is a setting.** `cloudSteps` is a live quality setting: Low 0, Medium 0, High 32,
  Ultra 48. 0 draws the flat layer; above 0 the sky marches that many steps along each ray. The
  preset table publishes it, so the tier's cost is visible beside the settings it trades against.
  WebGL2 and WebGPU's compatibility mode cap their presets at Medium, so a page there reaches the
  tier through the setting alone.
- **Both skies, and their maps.** The analytic sky and the physical sky each draw the march over
  their own light, and each sky map's steps draw it in the same place of the map that the flat layer
  took: the generator's `sky` step for the analytic sky, and its `panorama` step for the physical
  sky, which reads the panorama that the physical pass filled without its flat layer.
- **The clouds light the scene as the flat layer did.** The CPU diffuse light keeps its model of the
  flat layer, driven by the same settings. The lights, the shadows and the fog therefore keep the
  meaning that a page's settings had: the sun's and moon's light on the clouds, the cloud's shade
  overhead and the air's fade at the horizon.

## Data

| Preset | `cloudSteps` | What draws |
| --- | --- | --- |
| Low | 0 | The flat layer, a few reads of two-dimensional noise |
| Medium | 0 | The flat layer |
| High | 32 | The march, 32 steps along each ray |
| Ultra | 48 | The march, 48 steps along each ray |

The noise field is 64 x 64 x 64 RGBA8 texels, 1 MiB, made on the CPU in the browser at the tier's
first frame and uploaded once. It holds a cloud's shape, its detail, its billows and the coverage
across the sky, each a tiling noise, so the march wraps it without a seam.

The march jitters its first step by a hash of the pixel, so the steps do not band; the seed does not
move between frames, so the jitter adds no temporal noise.

## Decision

A second draw in the background pass, after the sky, in the same place and depth state, with
premultiplied alpha. A cloud shader of each sky kind draws the box that the sky draws and blends its
light over the sky's. The environment maps take the tier in their own step shaders, packed as the
other steps pack their texels.

The march sits in a slab along each ray whose height follows the elevation setting, and it samples
the same pattern that the flat layer samples, so a cloud of the same setting stands in the same place
on both tiers and at the same size.

The clouds of a reflected sky take their light from the sky that they cover: the analytic map's
clouds read the analytic sky's sun, air and overhead light, and the physical panorama's clouds read
the panorama's own color. A reflected sky is filtered for a roughness before anyone sees it, so the
simpler light of the panorama costs nothing that a viewer can see.

## Consequences

- A page on Low or Medium downloads no cloud shader and makes no noise field. The engine test that
  a page which uses no feature that loads on first use downloads none of their files covers the
  family.
- `quality.set({ cloudSteps })` changes the tier during play. The sky shows the change in its next
  frame; a sky map takes it when its next fill starts, which a change of the sky's values starts. A
  page that turns the tier on after its first frame shows no clouds in its existing sky map until
  the sky changes again, because the map's cloud shaders load with the map's generator at the page's
  start. Recorded as a limit rather than a fault: the preset chooses the tier, and a page that
  starts on High or Ultra has the clouds in its map from its first fill.
- A sky layer (D-242) draws after the cloud tier's draw, so an aurora stands over the clouds. The
  layer's draw is that branch's; the background pass's cloud draw comes before it.
- The image tests `clouds-volume` and `clouds-flat` compare the High tier with the flat layer of the
  same scene, on all three GPU paths and on both reference sets.
- The demo showcase's sky shows the tier (M3-J3).

## Alternatives rejected

- **An add-on that draws its own clouds.** Rejected by D-173's addendum of 21 October 2026: two
  places for one feature, with two sets of settings.
- **The march inside the sky's own shader.** A flat-tier page downloads the sky's first-use file, so
  it would download the march and its noise with it.
- **A marching cloud that ignores the flat layer's pattern.** The tier would move every cloud when a
  page's preset changes, and a setting would not keep its meaning.
