# D-169: The anti-acne plane's cost on Apple GPUs: no cheaper form

Status: decided, 13 October 2026. Task: M2-R25.

Summary: The directional light's shadow filter compares each texel with the receiver's plane, which is the anti-acne plane of [D-16](D-16-moving-casters-and-bias.md). The plane costs about 1.19 ms of S4's frame at Low on the owner's iPad, which the owner accepted on 6 October 2026 ([D-83](D-83-gate-rulings-2026-10-06.md), rulings 11 to 13). M2-R25 asks why it costs that much and for a cheaper method. The lighting-defaults change of [D-79](D-79-lighting-defaults.md) does not touch the plane or its file, so the task still stands. No cheaper form keeps the shadow image: the per-texel comparison is the anti-acne mechanism, and #371 already made the plane's arithmetic cheap. So M2-R25 closes with the cost accepted.

## Question

What makes the sun's receiver plane cost about 1.1 to 1.19 ms of a frame on Apple GPUs? Is there a cheaper method that keeps the shadow images? Does [D-79](D-79-lighting-defaults.md)'s AgX default, which changed the lit pass, make the task moot?

## Does the lighting-defaults change matter?

[D-79](D-79-lighting-defaults.md) landed on main as `38b4a3ee0` on 13 October 2026. It sets Filament's punchy AgX as the default tone curve. It adds Filament's specular anti-aliasing kernel, the 0.045 roughness floor and horizon fading. It also redraws the lit references. It changes `crates/null3d-shaders/wgsl/lit.wgsl`, which calls the shadow lookup, but not `crates/null3d-shaders/wgsl/lib/shadows.wgsl`, which holds the plane.

The 8 October main that the prototypes were built on held blob `0392e53fe` of the plane's file. This main holds blob `0304dd5b8`, and the two differ only in two doc comments. The defaults it reads did not change either. The biases, the filter and the preset shadow settings are as [D-16](D-16-moving-casters-and-bias.md) left them. AgX and the specular kernel add work to the lit pass, so the plane's share of the frame is a little smaller, not gone.

M2-R25 waited on [D-79](D-79-lighting-defaults.md) only for that change's lit pass and its redrawn references. The task's prototypes had to be rebuilt and its image checks rerun. The task is not made moot.

## What the plane costs

| Measure | Value | Source |
| --- | --- | --- |
| Plane off against main, S4 at Low on the owner's iPad Pro 11 | 9.70 ms against 10.90 ms, so 1.19 ms, 11% of the frame | [D-16](D-16-moving-casters-and-bias.md#addendum-2026-10-07-the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Plane off against main, S4 at Low on the Mac in Chrome | 0.10 ms of about 1.33 ms, 7.5% | [D-16](D-16-moving-casters-and-bias.md#addendum-2026-10-07-the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Plane's arithmetic rewritten (#371) | 11.10 ms against 11.20 ms on the iPad, about 0.1 ms | [D-16](D-16-moving-casters-and-bias.md#addendum-2026-10-07-the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form) |
| Per-texel comparison (#313) | 1.454 ms against 1.560 ms on the Mac, 0.106 ms faster | [D-16](D-16-moving-casters-and-bias.md#addendum-2026-10-05-one-depth-per-texel) |

Two figures separate the plane's two parts. The plane's arithmetic, rewritten by #371, won about 0.1 ms on the iPad. Switching the whole plane off won 1.19 ms there. So most of the iPad's cost lies in the per-texel comparison that #313 added, not in the arithmetic. The same comparison made the Mac's frame 0.106 ms faster, so the cost follows Apple's GPU, not the shader's work.

## What a cheaper form gives up

The anti-acne effect is the comparison itself. [concepts/shadows](../../docs/concepts/shadows.md#flat-casters) gives it: the filter compares each texel with the receiving surface's plane at that texel's center, so a slab's own bottom stays below the plane and its lit top stays lit. Three levers remain, and none is free.

1. The plane's arithmetic. #371 already reduced it to one matrix product of the normal and three dot products. A uniform that holds each cascade's light axes and its depth per meter would remove that matrix product too. It keeps the images, but #371's 0.1 ms bounds the gain, and it adds uniform data and a GPU check for less than one step of the Mac's GPU timer (0.066 ms).
2. One plane depth for each block of four texels. This is #257's first form and #313 replaced it, because it left stripes on S4's pavements at Low. One texel's bottom rises toward the light by more than the slab's own thickness, so a texel toward the light still shadowed the lit top. The acne limits sit between the two forms: in the `far-slabs-low` view, 10.733% before and 0.385% after against a limit of 1.5% ([D-16](D-16-moving-casters-and-bias.md)).
3. The plane off. The owner rejected it on 5 October 2026 ([D-16](D-16-moving-casters-and-bias.md#addendum-2026-10-07-the-receiver-planes-cost-on-the-ipad-and-a-cheaper-form)), because Low's slabs show the stripes again. The same check failed at 0.870% of open lit ground against a limit of 0.2%.

## The prototypes

The 8 October helper built six shadow variants in its worktrees: `off`, `probe`, `light`, `block`, `lightblock` and `lightfast`. Each rewrote `receiver_plane`, its references, or both. The `light` form and its two mixes moved the plane from the biased lookup point to the receiver's own surface. The `block` form and its mixes restored lever 2. The 8 October pause, then the machine restart of 12 October, wiped the scratchpad's A/B driver and the variant worktrees. No figure was recorded. The variant patches survive outside the repository, and they still apply, because the file changed only in comments. No variant was measured, so no result supports one.

## Decision

M2-R25 closes with no engine change. The task's rule allows either a measured saving on the iPad with the same images, or a record giving the reason it cannot be cheaper. The record gives the reason: the per-texel comparison is the anti-acne mechanism, so removing it changes the shadow image, and the plane's arithmetic is already cheap after #371. The lighting-defaults change does not change that.

## Consequences

- No code change. `lib/shadows.wgsl` keeps the per-texel receiver plane of [D-16](D-16-moving-casters-and-bias.md).
- The plane's cost on the owner's iPad stays as accepted on 6 October 2026 ([D-83](D-83-gate-rulings-2026-10-06.md), ruling 13).
- The levers stay open for a later scene that shows the cost again. A uniform that precomputes the cascades' light axes is the only one that keeps the images; it needs a measured saving first, as design principle 1 asks. Turning the plane off at Low alone trades the flat-caster acne, which the owner rejected.
- The breakdown's M2-R25 entry is closed. Its "Done when" is met by this record.

## Addendum, 2026-10-19: the smaller square on a phone

The iPhone 17's Safari ran Battle's comparison on 19 October 2026, at 100 units on a 603 x 1009 canvas at a pixel ratio of 1.5, on the direct path. The sun's shadow filter costs far more there than on a desktop GPU:

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| Battle, the square of 5 | 24.4 | 32.01 ms | 304 |
| Battle, the square of 3 | 30.3 | 24.11 ms | 267 |
| Factory | 45.6 | 15.86 ms | 152 |

The smaller square saves 7.9 ms of the phone's frame, 25%. On the Mac's Safari at 1,000 units the same change saves about 1.1 ms of 14.2, and 1.4 ms with the other effects off. So the cost is the shadow map's samples on this GPU, and the phone is where the square's size decides the frame.

What was tried and rejected: one read of each 2 x 2 block through the comparison sampler's own filter, with the block's weights and the plane at the sample's place. It keeps the shares and the anti-acne plane's place, but WebGPU refuses it: the cascades bind as a float texture, so that compatibility mode can read four texels at once, and a comparison sample needs a depth texture. The shader build refused all 45 affected variants.

The engine now gives a phone that runs Apple's WebKit the square of 3 for the sun's filter, and keeps the preset's square elsewhere. The flat casters' plane and its per-texel comparison are unchanged; the square is smaller, so the edges are slightly harder. A sketch's own `quality.set({ shadowFilter })` still wins. The page kinds that measure the filter keep the presets' values, so a benchmark can compare them.

The two phone defaults together, and the comparison's twelve pages, are in [Battle's figures on the iPhone](../benchmarks.md#the-sun-shadow-filter-on-a-phone).
