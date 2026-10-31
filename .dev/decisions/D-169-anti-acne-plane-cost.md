# D-169: The anti-acne plane's cost on Apple GPUs: no cheaper form

Status: decided: no engine change, and the cost stays accepted. Task: M2-R25.

Summary: The directional light's shadow filter compares each texel with the receiver's plane, which is the anti-acne plane of [D-16](D-16-moving-casters-and-bias.md). The plane costs about 1.19 ms of S4's frame at Low on the owner's iPad, which the owner accepted ([D-83](D-83-m1-gate-rulings.md), rulings 11 to 13). No cheaper form keeps the shadow image: the per-texel comparison is the anti-acne mechanism, and #371 made the plane's arithmetic cheap. So M2-R25 closes with the cost accepted.

## Question

What makes the sun's receiver plane cost about 1.1 to 1.19 ms of a frame on Apple GPUs? Is there a cheaper method that keeps the shadow images? Does [D-79](D-79-lighting-defaults.md)'s AgX default, which changes the lit pass, make the task moot?

## Does the lighting-defaults change matter?

[D-79](D-79-lighting-defaults.md) sets Filament's punchy AgX as the default tone curve. It adds Filament's specular anti-aliasing kernel, the 0.045 roughness floor and horizon fading, and it redraws the lit references. It changes `crates/null3d-shaders/wgsl/lit.wgsl`, which calls the shadow lookup, but not `crates/null3d-shaders/wgsl/lib/shadows.wgsl`, which holds the plane.

The plane's file (blob `0304dd5b8`) differs from the one the prototypes were built on (blob `0392e53fe`) only in two doc comments. The defaults it reads are the same. The biases, the filter and the preset shadow settings are as [D-16](D-16-moving-casters-and-bias.md) sets them. AgX and the specular kernel add work to the lit pass, so the plane's share of the frame is a little smaller, not gone.

So [D-79](D-79-lighting-defaults.md) does not make the task moot. The task's prototypes are rebuilt on its lit pass, and its image checks run against its redrawn references.

## What the plane costs

| Measure | Value | Source |
| --- | --- | --- |
| Plane off against main, S4 at Low on the owner's iPad Pro 11 | 9.70 ms against 10.90 ms, so 1.19 ms, 11% of the frame | [D-16](D-16-moving-casters-and-bias.md#the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Plane off against main, S4 at Low on the Mac in Chrome | 0.10 ms of about 1.33 ms, 7.5% | [D-16](D-16-moving-casters-and-bias.md#the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Plane's arithmetic rewritten (#371) | 11.10 ms against 11.20 ms on the iPad, about 0.1 ms | [D-16](D-16-moving-casters-and-bias.md#the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Per-texel comparison (#313) | 1.454 ms against 1.560 ms on the Mac, 0.106 ms faster | [D-16](D-16-moving-casters-and-bias.md#one-depth-per-texel) |

Two figures separate the plane's two parts. The plane's arithmetic, rewritten by #371, wins about 0.1 ms on the iPad. Switching the whole plane off wins 1.19 ms there. So most of the iPad's cost lies in the per-texel comparison (#313), not in the arithmetic. The same comparison makes the Mac's frame 0.106 ms faster, so the cost follows Apple's GPU, not the shader's work.

## What a cheaper form gives up

The anti-acne effect is the comparison itself. [concepts/shadows](../../docs/concepts/shadows.md#flat-casters) gives it: the filter compares each texel with the receiving surface's plane at that texel's center, so a slab's own bottom stays below the plane and its lit top stays lit. Three levers remain, and none is free.

1. The plane's arithmetic. #371 reduces it to one matrix product of the normal and three dot products. A uniform that holds each cascade's light axes and its depth per meter would remove that matrix product too. It keeps the images, but #371's 0.1 ms bounds the gain, and it adds uniform data and a GPU check for less than one step of the Mac's GPU timer (0.066 ms).
2. One plane depth for each block of four texels (#257). It leaves stripes on S4's pavements at Low. One texel's bottom rises toward the light by more than the slab's own thickness, so a texel toward the light still shadows the lit top. The acne limits sit between the two forms: in the `far-slabs-low` view, 10.733% for the block form and 0.385% for the per-texel form, against a limit of 1.5% ([D-16](D-16-moving-casters-and-bias.md)).
3. The plane off. The owner rejected it ([D-16](D-16-moving-casters-and-bias.md#the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form)), because Low's slabs show the stripes again. The same check fails at 0.870% of open lit ground against a limit of 0.2%.

## The prototypes

Six shadow variants exist as patches outside the repository: `off`, `probe`, `light`, `block`, `lightblock` and `lightfast`. Each rewrites `receiver_plane`, its references, or both. The `light` form and its two mixes move the plane from the biased lookup point to the receiver's own surface. The `block` form and its mixes restore lever 2. The patches apply to the plane's file, because it differs only in comments from the file they were built on. No variant has a recorded figure, so no result supports one.

## Decision

M2-R25 closes with no engine change. The task's rule allows either a measured saving on the iPad with the same images, or a record giving the reason it cannot be cheaper. The record gives the reason: the per-texel comparison is the anti-acne mechanism, so removing it changes the shadow image, and the plane's arithmetic is already cheap after #371. The lighting-defaults change does not change that.

## Consequences

- No code change. `lib/shadows.wgsl` keeps the per-texel receiver plane of [D-16](D-16-moving-casters-and-bias.md).
- The plane's cost on the owner's iPad stays as the owner accepted it ([D-83](D-83-m1-gate-rulings.md), ruling 13).
- The levers stay open for a later scene that shows the cost again. A uniform that precomputes the cascades' light axes is the only one that keeps the images; it needs a measured saving first, as design principle 1 asks. Turning the plane off at Low alone trades the flat-caster acne, which the owner rejected.
- The breakdown's M2-R25 entry is closed. Its "Done when" is met by this record.

## The filter's square on an iPhone 17, and a cold first page

The iPhone 17's Safari ran Battle's comparison of the filter's square at 100 units on a 603 x 1009 canvas at a pixel ratio of 1.5, on the direct path. The first page of a cloud session is about 5 ms slower than every page after it with the same settings. A session whose first page is the square of 5 therefore shows 7.9 ms that belong to the page's place in the session, not to the filter:

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| Battle, the square of 5 | 24.4 | 32.01 ms | 304 |
| Battle, the square of 3 | 30.3 | 24.11 ms | 267 |

A run that alternates the two squares in one session gives the warm figures:

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| The square of 3, first page of the session | 25.1 | 29.90 ms | 298 |
| The square of 3 | 30.0 | 23.81 ms | 266 |
| The square of 3 | 29.8 | 24.06 ms | 266 |
| The square of 5 | 29.7 | 24.32 ms | 267 |
| The square of 5 | 29.5 | 24.67 ms | 265 |

- Warm, the two squares differ by less than the session's drift of about 1 ms. The smaller square saves nothing measurable on this phone, and it makes edges harder, so the default stays.
- On the Mac's Safari at 1,000 units the same change saves about 1.1 ms of 14.2, and 1.4 ms with the other effects off. Neither device justifies a device default.
- Rejected: one read of each 2 x 2 block through the comparison sampler's own filter, with the block's weights and the plane at the sample's place. WebGPU refuses it: the cascades bind as a float texture, so that compatibility mode can read four texels at once, and a comparison sample needs a depth texture. The shader build refuses all 45 affected variants.

The per-texel receiver plane and the preset's square stay. A comparison discards the first page of a session, because that page is not one to judge an engine by ([Battle's figures on the iPhone](../benchmarks.md#battles-iphone-webgpu-figure-and-the-cold-first-page)).
