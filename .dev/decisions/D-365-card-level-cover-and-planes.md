# D-365: The first card level's cover factor, gate and crossed planes

Status: decided. The gate, the closing factor and the planes are built and landed; the opening direction is rejected and
the planes ship unused. Task: none.

Summary: The first card level carries a factor on its cut alpha, read from the species record and found by a mark in the
card quads' second texture coordinate. A factor above one closes a crown and is kept where the eye accepts the coarser
leaf, the beech names 1.35, and a factor below one is not used, because opening a crown that way coarsens its leaf. A
record may name crossed planes a card level. The willow named one during the experiment and it moved its sky by 0.2 of a
point for 11,492 triangles, so no species ships one and the willow's landing removes its value.

## Question

At a distance where the crown is drawn by leaf cards rather than leaves, how does a species close a crown that reads too
open, and can a card level be made to cover more without enlarging its picture?

## Rule

A change to a card's cover must move the crown's open sky toward its photograph without changing the leaf's grain to the
eye, and it must be measurable on one camera with one record value. A lever that needs another value to pay for its own
cost is not kept.

## Data

| Measure | No value | 0.65 | 0.80 | 1.35 | Device |
| --- | --- | --- | --- | --- | --- |
| Birch picture 01, sky on the matte | 0.142 | 0.204 | 0.1682 |, | this Mac, real GPU |
| Birch picture 01, leaf delta-E | 10.63 | 14.39 | 12.86 |, | same |
| Beech picture 01, sky on the matte (picture 0.0729) | 0.1872 |, |, | 0.1422 | same |
| Beech picture 01, leaf delta-E | 10.68 |, |, | 8.99 | same |
| Willow picture 01, sky on the matte (picture 0.0223) | 0.1278 |, |, | 0.1255 with one crossed plane | same |

How the data was produced: `bun run plants:review` through `draw.sh`, one run a setting, each naming its own references
and slot; the runs are in `build/cover10`, `build/cover12` and `build/planes` of the oak-reset build.

The tiled grid was judged the same way at the deciding camera: three pictures a side reads 0.1305 by the colour rule and
4.56 leaf delta-E against four's 0.1369 and 5.64, at 11,214 more card triangles for four.

## Look

Opening coarsens the leaf: shown three settings side by side, the birch's crowns read alike in density while the opened
ones draw bigger, blockier, paler plates. Closing does not thin the leaf and the beech at 1.35 reads fuller and greener
by eye. The finer tiling speckles a crown where the coarser one gathers into mass.

## Decision

The gate rides the card quads' second texture coordinate, 0.5 at the first card level and 0 at the second, with the
first coordinate untouched so card flutter reads what it always read. A species may close its first card level's crown
with a factor above one; it may not open one with a factor below it. `cardCover` is validated from 0.5 to 2 and
`cardPlanes` as a pair of whole counts from 0 to 2, defaulting to none. The clump card tiles three pictures a side at
both levels. Opening a crown must come from the fill, the cards' count or the clumps they stand on, not from the cut.
