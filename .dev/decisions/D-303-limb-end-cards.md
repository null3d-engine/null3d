# D-303: the live oak's cards ride its limb ends, and spread is not openness

Status: superseded by [D-323](D-323-plant-core-three-scales.md): the first generator that this record describes is removed, and the plant core grows the plants. Task: none.

Summary: the live oak's crown cards move out of its volume and onto its limb ends, which is the
reference's own arrangement. The crown's fill falls from 35.9 to 34.5 per cent and stays above a
third; the limb bones read through it. The aspen takes the opposite treatment, and the turntable
figure alone cannot tell the two apart.

## Question

The live oak's crown is a solid dome whose limbs the reference shows through it. The aspen's is an
open lattice whose limbs the reference also shows. Both read as irregular on a turntable. Can one
rule serve both?

## Rule

The live oak's limb-to-trunk ratio must not move, its crown fill must stay above a third, and its rim
and crown fills are measured at eight angles before and after. A species' tolerance is taken from its
own reference's openness, not from the catalogue's.

## Data

| Measure, eight angles | Volume fill | Cards on the limb ends |
| --- | --- | --- |
| crown fill, mean | 35.9 % | 34.5 % |
| rim fill, mean | 19.3 % | 18.8 % |
| rim variation over its mean | 41.7 % | 43.3 % |
| limb over trunk | 0.86 | 0.86 |

How the data was produced: eight whole views at 45-degree turns through `target/tree-render/render.ts`;
the crown and rim fills from a color mask over the crown's own box and the annulus beyond two thirds
of its half-width; the limb and trunk from `growSkeleton`'s radii times the flare scale.

The first attempt moved too much, with fill at 0.7 and volume at 0.05, and took the crown's mean
fill to 31.4 per cent, below the third that marks a shell. It was eased to fill 1.0 and volume 0.1,
which holds 34.5.

## Look

The standard view shows two effects at once: a limb's bark is visible through the crown's middle, and
the silhouette holds its dome. The batch `live-oak-2026-11-03-0915` carries the six views and the
eight turn frames.

## Decision

Take it for the live oak. It meets the rule: the limb ratio is unchanged, the crown stays above a
third, and the limb structure reads. The rim's variation grows slightly, 41.7 to 43.3 per cent, which
is the honest cost of the interior thinning.

The aspen takes the opposite treatment, and this record states it in one sentence so the two are not
averaged: **a spread figure alone cannot say whether a crown is too sparse or too open; only its own
reference can.** The aspen's reference is an open lattice with limbs visible through it, so closing
its crown would move it away from its photograph.

Two facts retire a family of hypotheses for the next reader. The limbs of every species leave on a
golden-angle fan, measured from their own directions, so no species has a limb plane. The crowns are
round in plan: the aspen measures 6.1 meters in x and 6.0 in z.

## Consequences

No new API: the change is the live oak's record. `Leaf.rim` stays for crowns that are a solid mass at
the edge. The turntable band is a per-species figure from here on, taken from the reference's own
openness.
