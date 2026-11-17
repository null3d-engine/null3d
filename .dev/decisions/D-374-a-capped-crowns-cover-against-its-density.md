# D-374: A capped crown's cover against its density

Status: decided. Built: the dense row-place rule on the pull-request branch (fd1db3f7d) and the root-of-count
refinement on oak/levels-cap-walk (82692ca5a). The dense rule stands everywhere for now. The walk's green wedge is an
open look fault. Task: none.

Summary: A capped crown's cards must reach the leaf form's own covered area without overfilling the crown. Oak-A's eye
rules that neither approach reads as the same tree everywhere. The hawthorn keeps the dense row-place rule, whose
shape is within 2 per cent and whose grain is fine. The birch prefers the root-of-count refinement, which draws a real
crown where the dense rule was a null. The walk's green wedge blocks that preference. A per-species record value,
defaulting to dense, is the route.

## Question

Where a capped crown cannot draw its shoot rows, how should it spend its allowance? One option is many small cards
at the row places, which hold the outline. The other is fewer large cards that stand for several row places and match
the leaf form's own density.

## Rule

A capped crown's cards stand for the rows it cannot draw. Two measures bound them. The capped nearest level's outline
overlap against the uncapped plant must hold its floor at every maximum. The crown's fill must not exceed the leaf
form's own fill, the pair's boxes matching. A card that stands for several rows grows by the square root of that
count. The count is chosen so the covered area reaches the leaf form's own. The allowance left after that stays
unspent, as a maximum is a ceiling.

## Data

Both rules measured in the budget file's own state, seed 11, variant 0, detail low, on the tree named. Card counts are
the row-place cards beyond the clump cards; leaf triangles are the level's whole leaf draw against the allowance.

| Measure | Dense rule, fd1db3f7d | Root-of-count, 82692ca5a |
| --- | --- | --- |
| hawthorn at 250,000, outline overlap | 0.712 | 0.647 |
| hawthorn at 250,000, row-place cards | 3,062 | 14 |
| hawthorn at 250,000, leaf triangles of 52,067 | 19,124 | 828 |
| birch at 1,000,000, outline overlap | 0.857 | 0.820 |
| birch at 1,000,000, row-place cards | 13,112 | 31 |
| birch at 1,000,000, leaf triangles of 674,353 | 88,592 | 10,052 |
| birch at 250,000, outline overlap | 0.857 | 0.819 |
| birch at 250,000 sparseness 1, outline overlap | 0.588 | 0.591 |
| budget file, whole | 25 pass, 7 fail, no over-cap | 25 pass, 7 fail, no over-cap |
| twelve-species guard, four caps | 54 of 96 rows toward their caps, none past | 54 of 96, none past |

The overfill is not one number. On Oak-A's matched one-camera trios the dense rule overfills by 12.5 points on the
hawthorn and 5.5 on the birch. The refinement overfills by 7.5 and 3.5. So the refinement does lower the relative
overfill; Oak-A withdrew its earlier "it does not", which came from comparing across cameras. The figure belongs to a
species and a camera. The hawthorn's reads +7.8 at its recorded camera. The birch's reads a null at 42 meters.
The birch's null is not agreement: the uncapped leaf form is near-bare at that distance, so its overfill is not
measurable there, not zero.

How the data was produced: `bun test --conditions=null3d-source packages/vegetation/src/lod/budget.test.ts` on each
tree. The outline overlap is the suite's own matte of the capped nearest level against the uncapped plant. The
overfill figures come from Oak-L's level-branch pairs, build/crown/haw-*-sp0-l0 and haw-med-*, and from Oak-A's
matched one-camera trios. The refinement's allowance there was 71,545 with 14,550 place-card triangles on the older
price model. So those figure the shape of the trade, not a landed record's draw.

## Look

Oak-A's ruling on the pair: neither capped rule reads as the same tree on the hawthorn. The refinement's crowned
hawthorn is about 15 per cent narrower in angular width. It draws as oversized pale plates with dark holes. The dense
rule's crown is under 2 per cent narrower, with fine grain and a shape-matched look. The birch is the other way. The
refinement draws a real green crown where the dense rule was a null at that distance. Its plates are coarser. The
trade therefore splits by species: the hawthorn favors the dense rule, the birch favors the refinement.

The walk's green wedge. The dense rule's own picture at the birch's million cap carries a flat green sheet on the
crown's left flank, about 60 pixels long. The same still at 2ba74282e, the dense rule without the walk, draws a clean
lower left: build/crown/birch-crown-cap1m-dense-nowalk. The sheet's flat color, 68,102,20, covers 695 pixels there
in the walk run and none in the control. The card under the sheet's center is normal in every attribute. Its cell is
a valid leaf cell, its colors match its neighbours, and its gate is zero like every level-0 row card. Its place is
right too, 0.27 meters from its nearest row. The sheet is a run of these row cards. Each shows one small leaf
picture, which blurs to a flat plate at the camera's 28 meters. The control's crown shows the clump cards' tiled
pictures there instead. So the fault is the row cards' picture granularity where the crown already draws, not a
stray or degenerate triangle. It is an open look fault of the walk's card placement; the fix is a placement rule
there, not avoidance.

## Decision

The dense rule stands everywhere for now. The refinement does not enter the pull-request branch. The route is a
per-species record value for the coverage approach, defaulting to dense. The birch names the refinement only after
the green wedge is explained and fixed, and after a check at more than one angle. The eye chose the dense rule on the
hawthorn for its shape and grain. It did not reject the refinement for failing to reduce density, which it does. No
option was chosen on effort or schedule.

## Consequences

The coverage clause is its own recorded case in the budget suite. It names this record and the dense rule's 0.712
and 0.857 as its figures. The cap and allowance cases stay green while the coverage rail is open. The refinement
stays on oak/levels-cap-walk. The walk's row-place card placement holds an open look fault for the green wedge. Its
fix is in that placement and is checked at more than one angle. Three levers stay open for the density without the
outline. They are fewer planes a card, a smaller cap on a card's growth, and the card texture's own coverage. The
saguaro's capped-body fault keeps its own recorded case, apart from the cap assertions.
